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
 * Distancia aproximada siguiendo el recorrido real por orden:
 * - NO circular one-way: SOLO forward (idxA >= idxB) sin wrap.
 * - circular one-way (L1/L2): forward con wrap.
 */
function busDistanceMetersForward(orderedStops, idxB, idxA, isCircularOneWay) {
  const n = orderedStops.length;
  if (n < 2) return Infinity;

  if (!isCircularOneWay) {
    if (idxA < idxB) return Infinity; // no se puede “ir hacia atrás”
    let acc = 0;
    for (let i = idxB + 1; i <= idxA; i++) {
      const prev = stopLatLng(orderedStops[i - 1]);
      const cur = stopLatLng(orderedStops[i]);
      if (!prev || !cur) continue;
      acc += distMeters(prev, cur);
    }
    return acc;
  }

  // circular one-way: avanzar con wrap
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
    if (steps > n + 2) return Infinity; // seguridad (más de una vuelta)
    if (acc > 200000) return Infinity; // seguridad (200km)
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
 * Selección BALANCEADA:
 * 1) minimizar maxWalk (evita que una caminata se dispare)
 * 2) minimizar sumWalk
 * 3) minimizar stopsCount (muy importante para L1/L2 y evitar “vuelta”)
 * 4) minimizar busDist
 * 5) desempate: si lo demás es parecido => preferir walk1 menor (subida más cerca)
 */
function isBetterCandidate(cand, best) {
  const r1 = cand._rank;
  const r2 = best._rank;

  // tolerancias para evitar que por “ganar 1m en walk2” te mueva la subida 200m
  const T_MAXW = 25;   // m
  const T_SUMW = 35;   // m
  const T_STOP = 1;    // paradas
  const T_BUS  = 80;   // m

  if (r1.maxWalk < r2.maxWalk - T_MAXW) return true;
  if (Math.abs(r1.maxWalk - r2.maxWalk) <= T_MAXW) {
    if (r1.sumWalk < r2.sumWalk - T_SUMW) return true;
    if (Math.abs(r1.sumWalk - r2.sumWalk) <= T_SUMW) {
      if (r1.stopsCount < r2.stopsCount - T_STOP) return true;
      if (Math.abs(r1.stopsCount - r2.stopsCount) <= T_STOP) {
        if (r1.busDist < r2.busDist - T_BUS) return true;

        // ✅ FIX CLAVE: si está “empatado”, preferir subida más cerca
        if (Math.abs(r1.busDist - r2.busDist) <= T_BUS) {
          if (cand.metrics.walk1 < best.metrics.walk1) return true;
        }
      }
    }
  }

  // fallback estricto por tieScore
  return r1.tieScore < r2.tieScore;
}

/**
 * PLAN BALANCEADO (minimax walk) + coherencia por orden/sentido.
 *
 * - Evalúa kBoard paradas más cercanas al usuario y kDest más cercanas al destino
 * - Filtra por umbrales (maxWalkToBoard / maxWalkToDest)
 * - Respeta sentido si ambos lo tienen (si ambos traen sentido, deben coincidir)
 * - Respeta circular one-way (L1/L2): avanzar con wrap
 * - NO circular: solo forward (idxA >= idxB)
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

  // penalización por paradas (sube esto para L1/L2 y evitar vueltas)
  stopsPenalty = 25
}) {
  if (!userLoc || !destLoc) return null;

  const ordered = [...(Array.isArray(stops) ? stops : [])]
    .filter(s => stopLatLng(s))
    .sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0));

  if (ordered.length < 2) return null;

  const stopsNorm = normalizeStops(ordered);

  const boards = nearestK(stopsNorm, userLoc, kBoard);
  const dests = nearestK(stopsNorm, destLoc, kDest);

  let best = null;

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

      const maxWalk = Math.max(b.d, a.d);
      const sumWalk = b.d + a.d;

      const tieScore = (maxWalk * 2) + sumWalk + busDist + (stopsPenalty * stopsCount);

      const candidate = {
        boardStop: b.stop,
        alightStop: a.stop,
        direction: b.stop?.sentido ?? (isCircularOneWay ? "CIRCULAR" : "ADELANTE"),
        metrics: {
          walk1: b.d,
          walk2: a.d,
          busDist,
          stopsCount
        },
        _rank: { maxWalk, sumWalk, busDist, stopsCount, tieScore },
        pathStops: buildPathStops(ordered, idxB, idxA, isCircularOneWay)
      };

      if (!best) {
        best = candidate;
        continue;
      }

      if (isBetterCandidate(candidate, best)) best = candidate;
    }
  }

  if (!best) return null;
  delete best._rank;
  return best;
}
