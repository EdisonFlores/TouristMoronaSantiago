// js/map/map.js
import { formatDurationFromSeconds } from "../app/helpers.js";

export const map = L.map("map").setView([-2.309948, -78.124482], 13);

// ===== Base layers =====
export const baseLayers = {
  "OSM (Standard)": L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap"
  }),
  "OpenTopoMap": L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenTopoMap (CC-BY-SA) / © OpenStreetMap"
  })
};

baseLayers["OSM (Standard)"].addTo(map);

// ===== Overlays principales =====
export const markersLayer = L.layerGroup().addTo(map);

// ✅ capa de rutas “no-transporte”
export const routeOverlay = L.layerGroup().addTo(map);

// ✅ capa EXCLUSIVA para transporte
export const transportOverlay = L.layerGroup().addTo(map);

let routeLine = null;
let routeLines = [];
let markerSelected = null;

let transportLines = [];

/* ================= POPUP HELPERS ================= */
/**
 * ✅ Si hay popupHTML (eventos), lo usamos.
 * ✅ Si no, usamos formato estándar (lugares).
 */
function buildPopupHTML(p) {
  if (!p) return `<b>Lugar</b>`;
  if (p.popupHTML && String(p.popupHTML).trim()) return String(p.popupHTML);

  const nombre = p.nombre || "Lugar";
  const tel = p.telefono || "N/D";
  const horario = p.horario || "N/D";

  return `
    <b>${nombre}</b><br>
    📞 ${tel}<br>
    🕒 ${horario}
  `;
}

/* ================= LIMPIEZA ================= */
export function clearMarkers() {
  markersLayer.clearLayers();
}

export function clearRoute() {
  if (routeLine) {
    try { routeOverlay.removeLayer(routeLine); } catch {}
    routeLine = null;
  }
  if (routeLines.length) {
    routeLines.forEach(l => {
      try { routeOverlay.removeLayer(l); } catch {}
    });
    routeLines = [];
  }
  if (markerSelected) {
    try { routeOverlay.removeLayer(markerSelected); } catch {}
    markerSelected = null;
  }
}

export function clearTransportRoute() {
  if (transportLines.length) {
    transportLines.forEach(l => {
      try { transportOverlay.removeLayer(l); } catch {}
    });
    transportLines = [];
  }
  try { transportOverlay.clearLayers(); } catch {}
}

/* ================= MARKERS ================= */
export function renderMarkers(list, onSelect) {
  clearMarkers();

  list.forEach(p => {
    if (!p?.ubicacion?.latitude || !p?.ubicacion?.longitude) return;

    const { latitude, longitude } = p.ubicacion;

    L.marker([latitude, longitude])
      .addTo(markersLayer)
      .bindPopup(buildPopupHTML(p))
      .on("click", () => onSelect(p));
  });
}

/* ================= RUTAS (1 tramo - normal) ================= */
export async function drawRoute(userLoc, place, mode, infoBox) {
  if (!userLoc || !place?.ubicacion) return;

  clearRoute();

  const { latitude, longitude } = place.ubicacion;

  markerSelected = L.marker([latitude, longitude])
    .addTo(routeOverlay)
    .bindPopup(buildPopupHTML(place))
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
  ).addTo(routeOverlay);

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

/* ================= ruta hacia un punto (normal) ================= */
export async function drawRouteToPoint({ from, to, mode = "walking", infoBox = null, title = "Ruta" }) {
  if (!from || !to) return null;

  clearRoute();

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
    `${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`;

  const res = await fetch(url);
  const data = await res.json();
  if (!data.routes?.length) return null;

  const r = data.routes[0];

  routeLine = L.polyline(
    r.geometry.coordinates.map(c => [c[1], c[0]]),
    { color: "#1e88e5", weight: 5 }
  ).addTo(routeOverlay);

  map.fitBounds(routeLine.getBounds());

  const distanciaKm = (Number(r.distance) || 0) / 1000;

  const velocidadPorModo = {
    walking: 5,
    cycling: 15,
    bicycle: 15,
    motorcycle: 35,
    driving: 30
  };

  const usaTiempoOsrm = mode === "bus" || !velocidadPorModo[mode];

  const tiempoSeg = usaTiempoOsrm
    ? Math.round(Number(r.duration) || 0)
    : Math.round((distanciaKm / velocidadPorModo[mode]) * 3600);

  if (infoBox) {
    infoBox.innerHTML = `
      <b>${title} (${mode})</b><br>
      ⏱ ${formatDurationFromSeconds(tiempoSeg)}<br>
      📏 ${distanciaKm.toFixed(2)} km
    `;
  }

  return r;
}

/* ================= utilidades OSRM ================= */
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
 * - Por defecto dibuja en routeOverlay (normal)
 * - layerTarget: "transport" => transportOverlay
 * - layerGroup (L.layerGroup) => prioridad
 */
export async function drawRouteBetweenPoints({
  from,
  to,
  mode = "driving",
  color = "#0d6efd",
  dashed = false,
  weight = 5,
  layerTarget = "normal",
  layerGroup = null
}) {
  if (!from || !to) return null;

  const r = await fetchOSRMRoute(from, to, modeToProfile(mode));
  if (!r) return null;

  const coords = r.geometry.coordinates.map(c => [c[1], c[0]]);
  const line = L.polyline(coords, {
    color,
    weight,
    dashArray: dashed ? "8 10" : null
  });

  const target =
    layerGroup
      ? layerGroup
      : (layerTarget === "transport" ? transportOverlay : routeOverlay);

  line.addTo(target);

  if (!layerGroup && layerTarget === "transport") transportLines.push(line);
  if (!layerGroup && layerTarget !== "transport") routeLines.push(line);

  return { route: r, line };
}

export async function drawTwoLegOSRM({
  userLoc,
  terminalLoc,
  targetLoc,
  mode = "driving",
  color1 = "#6c757d",
  color2 = "#0d6efd",
  infoBox = null,
  title = "Ruta vía Terminal",
  layerTarget = "normal",
  layerGroup = null
}) {
  if (!userLoc || !terminalLoc || !targetLoc) return null;

  if (layerTarget === "transport") clearTransportRoute();
  else clearRoute();

  const r1 = await fetchOSRMRoute(userLoc, terminalLoc, modeToProfile(mode));
  const r2 = await fetchOSRMRoute(terminalLoc, targetLoc, modeToProfile(mode));
  if (!r1 || !r2) return null;

  const coords1 = r1.geometry.coordinates.map(c => [c[1], c[0]]);
  const coords2 = r2.geometry.coordinates.map(c => [c[1], c[0]]);

  const line1 = L.polyline(coords1, { color: color1, weight: 5, dashArray: "8 10" });
  const line2 = L.polyline(coords2, { color: color2, weight: 5 });

  const target =
    layerGroup
      ? layerGroup
      : (layerTarget === "transport" ? transportOverlay : routeOverlay);

  line1.addTo(target);
  line2.addTo(target);

  if (!layerGroup && layerTarget === "transport") transportLines = [line1, line2];
  if (!layerGroup && layerTarget !== "transport") routeLines = [line1, line2];

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