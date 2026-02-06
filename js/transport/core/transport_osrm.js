// js/transport/core/transport_osrm.js
import { map } from "../../map/map.js";
import { setAccessLayer, getAccessLayer } from "./transport_state.js";

/* =====================================================
   DASHED usuario -> parada (OSRM)
===================================================== */
export async function drawDashedAccessRoute(userLoc, stopLatLng, color = "#444") {
  const prev = getAccessLayer();
  if (prev) {
    map.removeLayer(prev);
    setAccessLayer(null);
  }

  const profile = "foot";
  const url =
    `https://router.project-osrm.org/route/v1/${profile}/` +
    `${userLoc[1]},${userLoc[0]};${stopLatLng[1]},${stopLatLng[0]}?overview=full&geometries=geojson`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!data.routes?.length) return;

    const route = data.routes[0];

    const layer = L.polyline(route.geometry.coordinates.map(c => [c[1], c[0]]), {
      color,
      weight: 4,
      dashArray: "8,10",
      opacity: 0.9,
    }).addTo(map);

    setAccessLayer(layer);
  } catch (e) {
    console.error("Error OSRM acceso:", e);
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
  const url = `https://router.project-osrm.org/route/v1/${profile}/${coords}?overview=full&geometries=geojson`;

  const res = await fetch(url);
  const data = await res.json();
  if (!data.routes?.length) return null;
  return data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
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

    const geom = await fetchOSRMRouteChunk(points, profile);
    if (!geom || !geom.length) continue;

    if (full.length && geom.length) geom.shift();
    full.push(...geom);
  }

  if (!full.length) {
    // fallback: directo
    return L.polyline(latlngs, { color, weight: 4, opacity: 0.9 }).addTo(map);
  }

  return L.polyline(full, { color, weight: 4, opacity: 0.9 }).addTo(map);
}

