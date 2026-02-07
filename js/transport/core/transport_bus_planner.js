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

function normalizeStops(stops) {
  return (Array.isArray(stops) ? stops : [])
    .map(s => ({ s, ll: stopLatLng(s) }))
    .filter(x => x.ll);
}

function nearestK(stopsNorm, pointLatLng, k = 25, requireSentido = null) {
  const ranked = [];
  for (const x of stopsNorm) {
    const s = x.s;
    if (requireSentido && s?.sentido && String(s.sentido) !== String(requireSentido)) continue;
    ranked.push({ stop: s, ll: x.ll, d: distMeters(pointLatLng, x.ll) });
  }
  ranked.sort((a, b) => a.d - b.d);
  return ranked.slice(0, Math.max(1, k));
}

/**
 * Distancia aproximada "por orden" siguiendo el recorrido real.
 * - NO circular one-way: solo permite ir hacia adelante (idxA < idxB => Infinity)
 * - circular one-way: avanzar con wrap (siempre posible)
 */
function busDistanceMetersForward(orderedStops, idxB, idxA, isCircularOneWay) {
  const n = orderedStops.length;
  if (n < 2) return Infinity;

  // NO circular one-way: solo forward sin wrap
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

  // circular one-way: SOLO avanzar (con wrap)
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

    // seguridad
    if (steps > n + 2) return Infinity;
    if (acc > 200000) return Infinity; // 200 km
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
 * Devuelve:
 * - boardStop, alightStop, direction
 * - metrics: walk1, walk2, busDist, stopsCount
 * - pathStops: paradas reales del tramo
 * - score: ponderado (para comparar líneas)
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

  // pesos para score (comparar líneas)
  wWalk1 = 1.2,
  wWalk2 = 1.6,
  wBus = 1.0,
  wStops = 25,

  // penalización opcional por paradas en desempate interno
  stopsPenalty = 15
}) {
  if (!userLoc || !destLoc) return null;

  const ordered = [...(Array.isArray(stops) ? stops : [])]
    .filter(s => stopLatLng(s))
    .sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0));

  if (ordered.length < 2) return null;

  const stopsNorm = normalizeStops(ordered);

  // candidatos cercanos
  const boards = nearestK(stopsNorm, userLoc, kBoard);
  const dests = nearestK(stopsNorm, destLoc, kDest);

  let best = null;

  // mapa ref->idx
  const idxByRef = new Map();
  ordered.forEach((s, i) => idxByRef.set(s, i));

  for (const b of boards) {
    if (b.d > maxWalkToBoard) continue;

    for (const a of dests) {
      if (a.d > maxWalkToDest) continue;

      // sentido coherente si ambos lo tienen
      if (b.stop?.sentido && a.stop?.sentido && String(b.stop.sentido) !== String(a.stop.sentido)) {
        continue;
      }

      const idxB = idxByRef.get(b.stop);
      const idxA = idxByRef.get(a.stop);
      if (idxB == null || idxA == null) continue;

      const busDist = busDistanceMetersForward(ordered, idxB, idxA, isCircularOneWay);
      if (!Number.isFinite(busDist) || busDist === Infinity) continue;

      const stopsCount = forwardStopsCount(idxB, idxA, ordered.length, isCircularOneWay);
      if (!Number.isFinite(stopsCount) || stopsCount === Infinity) continue;

      // ---- CRITERIO BALANCEADO (minimax) ----
      const maxWalk = Math.max(b.d, a.d);
      const sumWalk = b.d + a.d;

      // score ponderado (para comparar líneas)
      const score = (wWalk1 * b.d) + (wWalk2 * a.d) + (wBus * busDist) + (wStops * stopsCount);

      // desempate interno
      const tieScore = sumWalk + busDist + (stopsPenalty * stopsCount);

      const candidate = {
        boardStop: b.stop,
        alightStop: a.stop,
        direction:
          b.stop?.sentido ??
          (isCircularOneWay ? "CIRCULAR" : "ADELANTE"),
        metrics: {
          walk1: b.d,
          walk2: a.d,
          busDist,
          stopsCount
        },
        pathStops: buildPathStops(ordered, idxB, idxA, isCircularOneWay),

        score, // ✅ clave: ya existe plan.score
        _rank: { maxWalk, sumWalk, busDist, stopsCount, tieScore }
      };

      if (!best) {
        best = candidate;
        continue;
      }

      // Selección dentro de la línea: minimax primero (evita caminar demasiado en uno de los dos)
      const r1 = candidate._rank;
      const r2 = best._rank;

      const better =
        r1.maxWalk < r2.maxWalk ||
        (r1.maxWalk === r2.maxWalk && r1.sumWalk < r2.sumWalk) ||
        (r1.maxWalk === r2.maxWalk && r1.sumWalk === r2.sumWalk && r1.busDist < r2.busDist) ||
        (r1.maxWalk === r2.maxWalk && r1.sumWalk === r2.sumWalk && r1.busDist === r2.busDist && r1.stopsCount < r2.stopsCount) ||
        (r1.maxWalk === r2.maxWalk && r1.sumWalk === r2.sumWalk && r1.busDist === r2.busDist && r1.stopsCount === r2.stopsCount && r1.tieScore < r2.tieScore);

      if (better) best = candidate;
    }
  }

  if (!best) return null;
  delete best._rank;
  return best;
}
