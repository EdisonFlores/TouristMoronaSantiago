import { calcularTiempo } from "./routing.js";

export const map = L.map("map").setView([-2.309948, -78.124482], 13);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);

export const markersLayer = L.layerGroup().addTo(map);

let routeLine = null;
let routeRequestId = 0;

// ================== LIMPIAR RUTA ==================
export function clearRoute() {
  routeRequestId++; // invalida cualquier request en curso

  if (routeLine) {
    map.removeLayer(routeLine);
    routeLine = null;
  }
}

// ================== MARKERS ==================
export function renderMarkers(dataList, onSelect) {
  clearMarkers();

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
    clearRoute();
    infoBox.innerHTML = `
      🚌 Bus<br>
      ⚠️ El modo de transporte en bus aún no está disponible
    `;
    return;
  }

  clearRoute();
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
    if (
      currentRequestId !== routeRequestId ||
      !json.routes ||
      !json.routes.length
    ) return;

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
  clearMarkers();

  L.marker([place.lat, place.lng])
    .addTo(markersLayer)
    .bindPopup(`
      <b>${place.nombre}</b><br>
      🕒 ${place.horario}<br>
      📞 ${place.telefono}
    `)
    .openPopup();
}

// ================== LIMPIAR MARKERS Y RUTA ==================
export function clearMarkers() {
  markersLayer.clearLayers();
  clearRoute();
}
