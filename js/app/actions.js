// js/app/actions.js
import { setActivePlace, getUserLocation, setMode } from "./state.js";
import { drawRoute, clearMarkers, renderMarkers, clearRoute } from "../map/map.js";
import { clearTransportLayers, planAndShowBusStops } from "../transport/transport_controller.js";

/* =========================
   Seleccionar un lugar
   ✅ ahora recibe ctxGeo (del usuario)
========================= */
export function selectPlace(place, infoBox, ctxGeo = {}) {
  if (!place) return;

  setActivePlace(place);

  // Limpiar marcadores y mostrar solo el seleccionado
  clearMarkers();
  renderMarkers([place], () => {});

  // Construir la info del lugar y botones de modos de traslado
  infoBox.innerHTML = `
    <h6>${place.nombre}</h6>
    📞 ${place.telefono || "No disponible"}<br>
    ⏰ ${place.horario || "No especificado"}<br><br>

    <div class="btn-group w-100 mb-2" id="transport-modes">
      <button class="btn btn-outline-primary" data-mode="walking">🚶</button>
      <button class="btn btn-outline-success" data-mode="bicycle">🚴</button>
      <button class="btn btn-outline-warning" data-mode="motorcycle">🏍️</button>
      <button class="btn btn-outline-danger" data-mode="driving">🚗</button>
      <button class="btn btn-outline-secondary" data-mode="bus">🚌</button>
    </div>

    <div id="route-info" class="small mt-1"></div>
  `;

  // Asociar evento a los botones de modos de transporte
  infoBox.querySelectorAll("button[data-mode]").forEach(btn => {
    btn.onclick = async () => {
      const mode = btn.dataset.mode;
      setMode(mode);

      const infoEl = document.getElementById("route-info");
      if (infoEl) infoEl.innerHTML = "";

      // ✅ limpiar antes de redibujar
      clearRoute();
      clearTransportLayers();

     if (mode === "bus") {
  const userLoc = getUserLocation();

  // ✅ Si NO estamos en "Líneas de transporte", bus = ruta normal (OSRM)
  if (!isTransportCategoryActive()) {
    drawRoute(userLoc, place, "bus", infoEl);
    return;
  }

  // ✅ Si SÍ estamos en "Líneas de transporte", entonces sí usar planner (urbano/rural)
  const ctx = {
    tipo: "auto",
    provincia: ctxGeo.provincia || "",
    canton: ctxGeo.canton || "",
    parroquia: ctxGeo.parroquia || "",
    specialSevilla: ctxGeo.specialSevilla === true,
    now: new Date()
  };

  await planAndShowBusStops(userLoc, place, ctx, { infoEl });
  return;
}

      // otros modos: OSRM normal
      drawRoute(getUserLocation(), place, mode, infoEl);
    };
  });
}
function isTransportCategoryActive() {
  // intenta detectar el select de categoría
  const el =
    document.getElementById("category") ||
    document.getElementById("select-category") ||
    document.querySelector('select[name="category"]');

  const v = String(el?.value || el?.options?.[el?.selectedIndex]?.text || "")
    .toLowerCase()
    .trim();

  // ajusta si tu value es distinto, pero esto cubre "Líneas de transporte"
  return v.includes("lineas") || v.includes("líneas") || v.includes("transporte");
}
/* =========================
   Encontrar el lugar más cercano
========================= */
export function findNearest(list) {
  const userLoc = getUserLocation();
  if (!userLoc || !list.length) return null;

  let nearest = null;
  let minDistance = Infinity;

  list.forEach(p => {
    const { latitude, longitude } = p.ubicacion;
    const d = L.latLng(userLoc).distanceTo([latitude, longitude]);
    if (d < minDistance) {
      minDistance = d;
      nearest = p;
    }
  });

  return nearest;
}
