// js/transport/core/transport_osrm.js
import { map } from "../../map/map.js";
import { setAccessLayer, getAccessLayer } from "./transport_state.js";

/* =====================================================
   DASHED usuario -> punto/parada (OSRM)
   ✅ FIX: permitir 2+ dashed sin borrar el anterior
===================================================== */
export async function drawDashedAccessRoute(userLoc, stopLatLng, color = "#444") {
  let layer = getAccessLayer();

  // ✅ si no existe, creamos un LayerGroup para acumular dashed
  if (!layer) {
    layer = L.layerGroup().addTo(map);
    setAccessLayer(layer);
  }

  // ✅ si por alguna razón era un polyline antiguo, lo envolvemos
  if (layer && typeof layer.addLayer !== "function") {
    try { map.removeLayer(layer); } catch {}
    layer = L.layerGroup().addTo(map);
    setAccessLayer(layer);
  }

  const profile = "foot";
  const url =
    `https://router.project-osrm.org/route/v1/${profile}/` +
    `${userLoc[1]},${userLoc[0]};${stopLatLng[1]},${stopLatLng[0]}` +
    `?overview=full&geometries=geojson`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!data.routes?.length) return null;

    const route = data.routes[0];

    const poly = L.polyline(route.geometry.coordinates.map(c => [c[1], c[0]]), {
      color,
      weight: 4,
      dashArray: "8,10",
      opacity: 0.9,
    });

    layer.addLayer(poly);
    return poly;
  } catch (e) {
    console.error("Error OSRM acceso:", e);
    return null;
  }
}

/* =====================================================
   RUTA de línea siguiendo calles (OSRM) por chunks
===================================================== */
function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchOSRMRouteChunk(latlngs, profile = "car") {
  const coords = latlngs.map(p => `${p[1]},${p[0]}`).join(";");
  const url =
    `https://router.project-osrm.org/route/v1/${profile}/${coords}` +
    `?overview=full&geometries=geojson&continue_straight=true`;

  const res = await fetch(url);
  const data = await res.json();
  if (!data.routes?.length) return null;

  const r = data.routes[0];
  return {
    coords: r.geometry.coordinates.map(c => [c[1], c[0]]),
    distance: Number(r.distance) || 0
  };
}

export async function drawLineRouteFollowingStreets(latlngs, color = "#000") {
  if (!latlngs || latlngs.length < 2) return null;

  const profile = "car";
  const MAX_POINTS = 99;

  const chunks = chunkArray(latlngs, MAX_POINTS);
  const full = [];

  for (let i = 0; i < chunks.length; i++) {
    let points = chunks[i];

    if (i > 0) {
      const prevLast = chunks[i - 1][chunks[i - 1].length - 1];
      points = [prevLast, ...points];
    }

    const r = await fetchOSRMRouteChunk(points, profile);

    // fallback si OSRM falla
    if (!r?.coords?.length) {
      if (full.length) points.shift();
      full.push(...points);
      continue;
    }

    // distancia recta aproximada del chunk (sumatoria)
    let straight = 0;
    for (let k = 1; k < points.length; k++) {
      straight += map.distance(points[k - 1], points[k]);
    }

    const osrmDist = r.distance || 0;

    // anti-loop chunk (solo para chunks cortos)
    const isWeird = straight > 0 && straight <= 450 && osrmDist > straight * 2.2;
    const geom = isWeird ? points : r.coords;

    if (full.length && geom.length) geom.shift();
    full.push(...geom);
  }

  if (!full.length) {
    return L.polyline(latlngs, { color, weight: 4, opacity: 0.9 }).addTo(map);
  }

  return L.polyline(full, { color, weight: 4, opacity: 0.9 }).addTo(map);
}
