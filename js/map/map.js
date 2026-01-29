// map/map.js
import { formatDurationFromSeconds } from "../app/helpers.js";

export const map = L.map("map").setView([-2.309948, -78.124482], 13);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap"
}).addTo(map);

export const markersLayer = L.layerGroup().addTo(map);

let routeLine = null;       // Línea de la ruta actual
let markerSelected = null;  // Marcador del lugar seleccionado

/* ================= LIMPIEZA ================= */
export function clearMarkers() {
  markersLayer.clearLayers();
}

export function clearRoute() {
  if (routeLine) {
    map.removeLayer(routeLine);
    routeLine = null;
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

/* ================= RUTAS ================= */
export async function drawRoute(userLoc, place, mode, infoBox) {
  if (!userLoc || !place?.ubicacion) return;

  // limpiar ruta y marcador previo
  clearRoute();

  const { latitude, longitude } = place.ubicacion;

  // marcador del lugar seleccionado
  markerSelected = L.marker([latitude, longitude])
    .addTo(map)
    .bindPopup(`<b>${place.nombre}</b><br>📞 ${place.telefono || "-"}<br>⏰ ${place.horario || "-"}`)
    .openPopup();

  // perfil para OSRM
  const profile = {
    walking: "foot",
    driving: "car",
    cycling: "bike",
    bicycle: "bike",
    motorcycle: "car",
    bus: "car" // temporal, se puede reemplazar si hay rutas de bus
  }[mode] || "foot";

  const url =
    `https://router.project-osrm.org/route/v1/${profile}/` +
    `${userLoc[1]},${userLoc[0]};${longitude},${latitude}?overview=full&geometries=geojson`;

  const res = await fetch(url);
  const data = await res.json();

  if (!data.routes?.length) return;

  const route = data.routes[0];

  // dibujar línea de la ruta
  routeLine = L.polyline(
    route.geometry.coordinates.map(c => [c[1], c[0]]),
    { color: "#1e88e5", weight: 5 }
  ).addTo(map);

  map.fitBounds(routeLine.getBounds());

  // calcular tiempo y distancia
  const distanciaKm = route.distance / 1000;

  const velocidadPorModo = {
    walking: 5,
    cycling: 15,
    bicycle: 15,
    motorcycle: 35,
    driving: 30
  };

  // si bus o no hay velocidad definida, usamos OSRM (segundos)
  const usaTiempoOsrm = mode === "bus" || !velocidadPorModo[mode];

  const tiempoSeg = usaTiempoOsrm
    ? Math.round(route.duration)
    : Math.round((distanciaKm / velocidadPorModo[mode]) * 3600);

  // ✅ AQUÍ EL CAMBIO: ahora muestra horas/min si pasa de 59 min
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
