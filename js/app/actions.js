// js/app/actions.js
import { setActivePlace, getUserLocation, setMode } from "./state.js";
import { drawRoute, clearMarkers, renderMarkers, clearRoute } from "../map/map.js";
import { clearTransportLayers, planAndShowBusStops } from "../transport/transport_controller.js";

export function selectPlace(place, infoBox, ctxGeo = {}) {
  if (!place) return;

  setActivePlace(place);

  clearMarkers();
  renderMarkers([place], () => {});

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

  infoBox.querySelectorAll("button[data-mode]").forEach(btn => {
    btn.onclick = async () => {
      const mode = btn.dataset.mode;
      setMode(mode);

      const infoEl = document.getElementById("route-info");
      if (infoEl) infoEl.innerHTML = "";

      clearRoute();
      clearTransportLayers();

      const userLoc = getUserLocation();

      if (mode === "bus") {
        const ctx = {
          tipo: "auto",
          provincia: ctxGeo.provincia || "",
          canton: ctxGeo.canton || "",
          parroquia: ctxGeo.parroquia || "",
          specialSevilla: ctxGeo.specialSevilla === true,
          entornoUser: ctxGeo.entornoUser || ctxGeo.entorno || "",
          now: new Date(),
          // sentido en bus rural: auto por defecto (se comparan ida/vuelta)
          sentido: "auto"
        };

        await planAndShowBusStops(userLoc, place, ctx, { infoEl });
        return;
      }

      drawRoute(userLoc, place, mode, infoEl);
    };
  });
}

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