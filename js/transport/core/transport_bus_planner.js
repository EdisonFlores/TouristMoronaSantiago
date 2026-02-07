// js/transport/core/transport_bus_planner.js
import { map } from "../../map/map.js";

function stopLatLng(p) {
  const u = p?.ubicacion;
  if (!u) return null;
  const { latitude, longitude } = u;
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  return [latitude, longitude];
}

function distMeters(a, b) {
  return map.distance(a, b);
}

function normSentido(s) {
  const v = String(s || "").trim().toLowerCase();
  if (!v) return "";
  if (v.includes("sur") && v.includes("norte")) return "sur-norte";
  if (v.includes("norte") && v.includes("sur")) return "norte-sur";
  return v;
}

function normalizeStops(stops) {
  return (Array.isArray(stops) ? stops : [])
    .map(s => ({ s, ll: stopLatLng(s) }))
    .filter(x => x.ll);
}

function nearestK(stopsNorm, pointLatLng, k = 25) {
  const ranked = [];
  for (const x of stopsNorm) {
    ranked.push({ stop: x.s, ll: x.ll, d: distMeters(pointLatLng, x.ll) });
  }
  ranked.sort((a, b) => a.d - b.d);
  return ranked.slice(0, Math.max(1, k));
}

/**
 * Segmentos por sentido:
 * - Recorre la lista ordenada y crea "segmentId" cada vez que cambia sentido.
 * - Si NO hay sentido en una parada, se hereda el último (si existe).
 */
function buildSentidoSegments(ordered) {
  const segIdByIdx = new Array(ordered.length).fill(0);
  let seg = 0;
  let last = "";

  for (let i = 0; i < ordered.length; i++) {
    const s = ordered[i];
    const cur = normSentido(s?.sentido) || last;

    if (i === 0) {
      last = cur;
      segIdByIdx[i] = seg;
      continue;
    }

    if (cur && last && cur !== last) seg += 1;
    segIdByIdx[i] = seg;

    if (cur) last = cur;
  }

  return segIdByIdx; // [idx] => segId
}

/**
 * Distancia aproximada "por orden" siguiendo recorrido real.
 * - Normal (no circular): SOLO forward (idxA >= idxB) y dentro del mismo segmento de sentido (si aplica)
 * - Circular one-way (L1/L2): forward con wrap
 */
function busDistanceMetersForward(orderedStops, idxB, idxA, isCircularOneWay) {
  const n = orderedStops.length;
  if (n < 2) return Infinity;

  if (!isCircularOneWay) {
    if (idxA < idxB) return Infinity;
    let acc = 0;
    for (let i = idxB + 1; i <= idxA; i++) {
      const prev = stopLatLng(orderedStops[i - 1]);
      const cur = stopLatLng(orderedStops[i]);
      if (!prev || !cur) continue;
      acc += distMeters(prev, cur);
    }
    return acc;
  }

  // circular one-way: SOLO avanzar con wrap
  let acc = 0;
  let steps = 0;
  let i = idxB;
  while (i !== idxA) {
    const j = (i + 1) % n;
    const prev = stopLatLng(orderedStops[i]);
    const cur = stopLatLng(orderedStops[j]);
    if (prev && cur) acc += distMeters(prev, cur);
    i = j;
    steps++;
    if (steps > n + 2) return Infinity;
    if (acc > 200000) return Infinity; // 200 km => absurdo
  }
  return acc;
}

function forwardStopsCount(idxB, idxA, n, isCircularOneWay) {
  if (!isCircularOneWay) {
    if (idxA < idxB) return Infinity;
    return idxA - idxB;
  }
  if (idxA >= idxB) return idxA - idxB;
  return (n - idxB) + idxA;
}

function buildPathStops(ordered, idxB, idxA, isCircularOneWay) {
  const n = ordered.length;
  if (!n) return [];

  if (!isCircularOneWay) {
    if (idxA < idxB) return [];
    return ordered.slice(idxB, idxA + 1);
  }

  const path = [];
  let i = idxB;
  path.push(ordered[i]);
  let steps = 0;
  while (i !== idxA) {
    i = (i + 1) % n;
    path.push(ordered[i]);
    steps++;
    if (steps > n + 2) break;
  }
  return path;
}

/**
 * PLAN BALANCEADO (minimax walk) + coherencia por orden/sentido.
 *
 * Reglas:
 * - Solo considera board en las kBoard paradas más cercanas al usuario
 * - Solo considera alight en las kDest paradas más cercanas al destino
 * - Si hay sentido (L3/L4/L5), board y alight deben estar en el MISMO tramo de sentido
 * - No circular: solo forward (idxA >= idxB)
 * - Circular one-way (L1/L2): forward wrap
 */
export function planLineBoardAlightByOrder({
  userLoc,
  destLoc,
  stops,
  isCircularOneWay = false,

  kBoard = 25,
  kDest = 35,

  maxWalkToBoard = 650,
  maxWalkToDest = 650,

  // pesos para score final (línea vs línea)
  wWalk1 = 1.0,
  wWalk2 = 1.0,
  wBus = 1.0,
  wStops = 15
}) {
  if (!userLoc || !destLoc) return null;

  const ordered = [...(Array.isArray(stops) ? stops : [])]
    .filter(s => stopLatLng(s))
    .sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0));

  if (ordered.length < 2) return null;

  const stopsNorm = normalizeStops(ordered);
  const boards = nearestK(stopsNorm, userLoc, kBoard);
  const dests = nearestK(stopsNorm, destLoc, kDest);

  const idxByRef = new Map();
  ordered.forEach((s, i) => idxByRef.set(s, i));

  // segmentos por sentido (para L3/L4/L5)
  const segByIdx = buildSentidoSegments(ordered);

  let best = null;

  for (const b of boards) {
    if (b.d > maxWalkToBoard) continue;

    const idxB = idxByRef.get(b.stop);
    if (idxB == null) continue;

    // Segmento del board (si hay sentido en la línea)
    const segB = segByIdx[idxB];

    for (const a of dests) {
      if (a.d > maxWalkToDest) continue;

      const idxA = idxByRef.get(a.stop);
      if (idxA == null) continue;

      // ✅ si NO es circular one-way, exigir mismo segmento de sentido
      // (si la línea no tiene sentido real, todos quedarán en seg 0 y no afecta)
      if (!isCircularOneWay) {
        const segA = segByIdx[idxA];
        if (segA !== segB) continue;
      }

      // ✅ coherencia fuerte: forward (y wrap solo si circular)
      const busDist = busDistanceMetersForward(ordered, idxB, idxA, isCircularOneWay);
      if (!Number.isFinite(busDist) || busDist === Infinity) continue;

      const stopsCount = forwardStopsCount(idxB, idxA, ordered.length, isCircularOneWay);
      if (!Number.isFinite(stopsCount) || stopsCount === Infinity) continue;

      // ✅ Balance minimax: primero minimiza la peor caminata
      const maxWalk = Math.max(b.d, a.d);
      const sumWalk = b.d + a.d;

      const score = (wWalk1 * b.d) + (wWalk2 * a.d) + (wBus * busDist) + (wStops * stopsCount);

      const candidate = {
        boardStop: b.stop,
        alightStop: a.stop,
        direction: normSentido(b.stop?.sentido) || (isCircularOneWay ? "circular" : "adelante"),
        metrics: { walk1: b.d, walk2: a.d, busDist, stopsCount },
        score,
        _rank: { maxWalk, sumWalk, busDist, stopsCount, score },
        pathStops: buildPathStops(ordered, idxB, idxA, isCircularOneWay)
      };

      if (!best) {
        best = candidate;
        continue;
      }

      // Lexicográfico: minimax -> sumWalk -> score
      const r1 = candidate._rank;
      const r2 = best._rank;

      const better =
        r1.maxWalk < r2.maxWalk ||
        (r1.maxWalk === r2.maxWalk && r1.sumWalk < r2.sumWalk) ||
        (r1.maxWalk === r2.maxWalk && r1.sumWalk === r2.sumWalk && r1.score < r2.score) ||
        (r1.maxWalk === r2.maxWalk && r1.sumWalk === r2.sumWalk && r1.score === r2.score && r1.busDist < r2.busDist) ||
        (r1.maxWalk === r2.maxWalk && r1.sumWalk === r2.sumWalk && r1.score === r2.score && r1.busDist === r2.busDist && r1.stopsCount < r2.stopsCount);

      if (better) best = candidate;
    }
  }

  if (!best) return null;

  delete best._rank;
  return best;
}
