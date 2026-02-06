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

// distancia por secuencia del orden (aprox)
function busDistanceMeters(orderedStops, idxA, idxB, isCircularOneWay) {
  const n = orderedStops.length;
  if (n < 2) return Infinity;

  if (!isCircularOneWay) {
    // si no es one-way circular: tomamos el tramo corto entre idxA y idxB (en orden de lista)
    const a = Math.min(idxA, idxB);
    const b = Math.max(idxA, idxB);

    let acc = 0;
    for (let i = a + 1; i <= b; i++) {
      const prev = stopLatLng(orderedStops[i - 1]);
      const cur = stopLatLng(orderedStops[i]);
      if (!prev || !cur) continue;
      acc += distMeters(prev, cur);
    }
    return acc;
  }

  // one-way circular: SOLO avanzar (con wrap)
  let acc = 0;
  let i = idxA;
  while (i !== idxB) {
    const j = (i + 1) % n;
    const prev = stopLatLng(orderedStops[i]);
    const cur = stopLatLng(orderedStops[j]);
    if (prev && cur) acc += distMeters(prev, cur);
    i = j;

    // seguridad para evitar loops raros
    if (acc > 100000) break; // 100 km
  }
  return acc;
}

function forwardStopsCount(idxA, idxB, n, isCircularOneWay) {
  if (!isCircularOneWay) return Math.abs(idxB - idxA);
  // one-way circular: contar avanzando con wrap
  if (idxB >= idxA) return idxB - idxA;
  return (n - idxA) + idxB;
}

/**
 * PLAN BALANCEADO (minimax walk) + coherencia por orden/sentido.
 *
 * - Evalúa kBoard paradas más cercanas al usuario y kDest más cercanas al destino
 * - Filtra por umbrales (maxWalkToBoard / maxWalkToDest)
 * - Respeta sentido si existe (mismo sentido si ambos lo traen)
 * - Respeta circular one-way (L1/L2): solo avanzar con wrap
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

  // penalización opcional por paradas
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

  // mapa orden->idx (por si hay orden repetido, usa idx real)
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

      // circular one-way: siempre se puede llegar avanzando (wrap), OK.
      // no circular one-way: aceptamos ambos sentidos.
      const busDist = busDistanceMeters(ordered, idxB, idxA, isCircularOneWay);
      if (!Number.isFinite(busDist) || busDist === Infinity) continue;

      const stopsCount = forwardStopsCount(idxB, idxA, ordered.length, isCircularOneWay);

      // ---- CRITERIO BALANCEADO (minimax) ----
      const maxWalk = Math.max(b.d, a.d);
      const sumWalk = b.d + a.d;

      // score auxiliar para desempate final
      const tieScore = sumWalk + busDist + (stopsPenalty * stopsCount);

      const candidate = {
        boardStop: b.stop,
        alightStop: a.stop,
        direction:
          b.stop?.sentido ??
          (isCircularOneWay ? "CIRCULAR" : (idxB <= idxA ? "ADELANTE" : "ATRAS")),
        metrics: {
          walk1: b.d,
          walk2: a.d,
          busDist,
          stopsCount
        },
        // para selección
        _rank: { maxWalk, sumWalk, busDist, stopsCount, tieScore },
        // opcional: paradas del tramo real para dibujar puntos
        pathStops: buildPathStops(ordered, idxB, idxA, isCircularOneWay)
      };

      if (!best) {
        best = candidate;
        continue;
      }

      // orden lexicográfico de criterios (minimax)
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

  // limpia campos internos
  delete best._rank;
  return best;
}

function buildPathStops(ordered, idxB, idxA, isCircularOneWay) {
  const n = ordered.length;
  if (!n) return [];

  if (!isCircularOneWay) {
    const a = Math.min(idxB, idxA);
    const b = Math.max(idxB, idxA);
    return ordered.slice(a, b + 1);
  }

  // one-way circular: avanzar con wrap desde idxB hasta idxA
  const path = [];
  let i = idxB;
  path.push(ordered[i]);
  while (i !== idxA) {
    i = (i + 1) % n;
    path.push(ordered[i]);
    if (path.length > n + 2) break;
  }
  return path;
}
