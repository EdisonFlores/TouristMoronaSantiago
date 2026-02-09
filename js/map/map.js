// map/map.js
import { formatDurationFromSeconds } from "../app/helpers.js";

export const map = L.map("map").setView([-2.309948, -78.124482], 13);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap"
}).addTo(map);

export const markersLayer = L.layerGroup().addTo(map);

let routeLine = null;            // ruta simple
let routeLines = [];             // rutas extra (multi / admin)
let markerSelected = null;

/* ================= LIMPIEZA ================= */
export function clearMarkers() {
  markersLayer.clearLayers();
}

export function clearRoute() {
  if (routeLine) {
    map.removeLayer(routeLine);
    routeLine = null;
  }
  if (routeLines.length) {
    routeLines.forEach(l => map.removeLayer(l));
    routeLines = [];
  }
  if (markerSelected) {
    map.removeLayer(markerSelected);
    markerSelected = null;
  }
}

/* ================= MARKERS ================= */
export function renderMarkers(list, onSelect) {
  clearMarkers();

  list.forEach(p => {
    if (!p.ubicacion?.latitude || !p.ubicacion?.longitude) return;

    const { latitude, longitude } = p.ubicacion;

    L.marker([latitude, longitude])
      .addTo(markersLayer)
      .bindPopup(`
        <b>${p.nombre}</b><br>
        📞 ${p.telefono || "N/D"}<br>
        🕒 ${p.horario || "N/D"}
      `)
      .on("click", () => onSelect(p));
  });
}

/* ================= RUTAS (1 tramo - tu función original) ================= */
export async function drawRoute(userLoc, place, mode, infoBox) {
  if (!userLoc || !place?.ubicacion) return;

  clearRoute();

  const { latitude, longitude } = place.ubicacion;

  markerSelected = L.marker([latitude, longitude])
    .addTo(map)
    .bindPopup(
      `<b>${place.nombre}</b><br>📞 ${place.telefono || "-"}<br>⏰ ${place.horario || "-"}`
    )
    .openPopup();

  const profile = {
    walking: "foot",
    driving: "car",
    cycling: "bike",
    bicycle: "bike",
    motorcycle: "car",
    bus: "car"
  }[mode] || "foot";

  const url =
    `https://router.project-osrm.org/route/v1/${profile}/` +
    `${userLoc[1]},${userLoc[0]};${longitude},${latitude}?overview=full&geometries=geojson`;

  const res = await fetch(url);
  const data = await res.json();

  if (!data.routes?.length) return;

  const route = data.routes[0];

  routeLine = L.polyline(
    route.geometry.coordinates.map(c => [c[1], c[0]]),
    { color: "#1e88e5", weight: 5 }
  ).addTo(map);

  map.fitBounds(routeLine.getBounds());

  const distanciaKm = route.distance / 1000;

  const velocidadPorModo = {
    walking: 5,
    cycling: 15,
    bicycle: 15,
    motorcycle: 35,
    driving: 30
  };

  const usaTiempoOsrm = mode === "bus" || !velocidadPorModo[mode];

  const tiempoSeg = usaTiempoOsrm
    ? Math.round(route.duration)
    : Math.round((distanciaKm / velocidadPorModo[mode]) * 3600);

  const tiempoTexto = formatDurationFromSeconds(tiempoSeg);
  const distanciaKmTexto = distanciaKm.toFixed(2);

  if (infoBox) {
    infoBox.innerHTML = `
      <b>Ruta (${mode})</b><br>
      ⏱ ${tiempoTexto}<br>
      📏 ${distanciaKmTexto} km
    `;
  }
}

/* ================= NUEVO: utilidades para rutas entre puntos ================= */
function modeToProfile(mode) {
  return ({
    walking: "foot",
    bicycle: "bike",
    driving: "car"
  }[mode] || "car");
}

async function fetchOSRMRoute(from, to, profile) {
  const url =
    `https://router.project-osrm.org/route/v1/${profile}/` +
    `${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`;

  const res = await fetch(url);
  const data = await res.json();
  if (!data.routes?.length) return null;
  return data.routes[0];
}

/**
 * Dibuja un tramo sin borrar capas de transporte.
 * Útil para: Terminal -> Provincia/Cantón cuando el primer tramo fue BUS.
 */
export async function drawRouteBetweenPoints({
  from,
  to,
  mode = "driving",
  color = "#0d6efd",
  dashed = false,
  weight = 5
}) {
  if (!from || !to) return null;

  const r = await fetchOSRMRoute(from, to, modeToProfile(mode));
  if (!r) return null;

  const coords = r.geometry.coordinates.map(c => [c[1], c[0]]);
  const line = L.polyline(coords, {
    color,
    weight,
    dashArray: dashed ? "8 10" : null
  }).addTo(map);

  routeLines.push(line);
  return { route: r, line };
}

/**
 * Dibuja 2 tramos OSRM (para modos: walking/bicycle/driving).
 * (Para bus, el tramo 1 lo hace tu planner; aquí solo usarás drawRouteBetweenPoints para tramo 2)
 */
export async function drawTwoLegOSRM({
  userLoc,
  terminalLoc,
  targetLoc,
  mode = "driving",
  color1 = "#6c757d", // usuario->terminal
  color2 = "#0d6efd", // terminal->destino
  infoBox = null,
  title = "Ruta vía Terminal"
}) {
  if (!userLoc || !terminalLoc || !targetLoc) return null;

  clearRoute(); // aquí sí limpiamos todo lo “no-transporte”

  const r1 = await fetchOSRMRoute(userLoc, terminalLoc, modeToProfile(mode));
  const r2 = await fetchOSRMRoute(terminalLoc, targetLoc, modeToProfile(mode));
  if (!r1 || !r2) return null;

  const coords1 = r1.geometry.coordinates.map(c => [c[1], c[0]]);
  const coords2 = r2.geometry.coordinates.map(c => [c[1], c[0]]);

  const line1 = L.polyline(coords1, { color: color1, weight: 5, dashArray: "8 10" }).addTo(map);
  const line2 = L.polyline(coords2, { color: color2, weight: 5 }).addTo(map);

  routeLines = [line1, line2];

  const totalDist = (Number(r1.distance) || 0) + (Number(r2.distance) || 0);
  const totalDur = (Number(r1.duration) || 0) + (Number(r2.duration) || 0);

  if (infoBox) {
    infoBox.innerHTML = `
      <b>${title}</b><br>
      ⏱ ${formatDurationFromSeconds(Math.round(totalDur))}<br>
      📏 ${(totalDist / 1000).toFixed(2)} km
    `;
  }

  map.fitBounds(L.latLngBounds([userLoc, terminalLoc, targetLoc]).pad(0.2));
  return { r1, r2, line1, line2 };
}
