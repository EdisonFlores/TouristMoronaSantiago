import { calcularTiempo } from "./routing.js";

export const map = L.map("map").setView([-2.309948, -78.124482], 13);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);

export const markersLayer = L.layerGroup().addTo(map);

let routeLine = null;
let routeRequestId = 0;

// ================== MARKERS ==================
export function renderMarkers(dataList, onSelect) {
  markersLayer.clearLayers();

  dataList.forEach(place => {
    const marker = L.marker([place.lat, place.lng])
      .bindPopup(`
        <b>${place.nombre}</b><br>
        🕒 ${place.horario}<br>
        📞 ${place.telefono}
      `)
      .on("click", () => onSelect(place));

    markersLayer.addLayer(marker);
  });
}

// ================== RUTA ==================
export async function drawRoute(userLocation, place, mode, infoBox) {
  if (!userLocation || !place) return;

  // 🚫 BUS AÚN NO IMPLEMENTADO
  if (mode === "bus") {
    infoBox.innerHTML = `
      🚌 Bus<br>
      ⚠️ El modo de transporte en bus aún no está disponible
    `;
    return;
  }

  // Limpiar ruta anterior
  if (routeLine) {
    map.removeLayer(routeLine);
    routeLine = null;
  }

  const currentRequestId = ++routeRequestId;

  const profileMap = {
    walking: "foot",
    bicycle: "bike",
    motorcycle: "car",
    driving: "car"
  };

  const profile = profileMap[mode] || "foot";

  try {
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/${profile}/` +
      `${userLocation[1]},${userLocation[0]};${place.lng},${place.lat}` +
      `?overview=full&geometries=geojson`
    );

    const json = await res.json();
    if (currentRequestId !== routeRequestId || !json.routes?.length) return;

    const route = json.routes[0];

    routeLine = L.polyline(
      route.geometry.coordinates.map(c => [c[1], c[0]]),
      { weight: 5 }
    ).addTo(map);

    const info = calcularTiempo(route, mode);

    infoBox.innerHTML = `
      🚦 ${mode}<br>
      ⏱ ${info.tiempo}<br>
      📏 ${info.distancia} km
    `;
  } catch (err) {
    console.error(err);
    infoBox.innerHTML = "⚠️ Error al calcular la ruta";
  }
}

// ================== SOLO UN MARKER ==================
export function showSingleMarker(place) {
  markersLayer.clearLayers();

  L.marker([place.lat, place.lng])
    .addTo(markersLayer)
    .bindPopup(`
      <b>${place.nombre}</b><br>
      🕒 ${place.horario}<br>
      📞 ${place.telefono}
    `)
    .openPopup();
}
// ================== LIMPIAR TODOS LOS MARKERS ==================
export function clearMarkers() {
  markersLayer.clearLayers();
}
