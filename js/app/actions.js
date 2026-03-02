import { setActivePlace, getUserLocation, setMode, setUserLocation } from "./state.js";
import { drawRoute, clearMarkers, renderMarkers, clearRoute } from "../map/map.js";
import { clearTransportLayers, planAndShowBusStops } from "../transport/transport_controller.js";

/** ✅ NUEVO: mutación centralizada */
export function updateUserLocation(loc) {
  setUserLocation(loc);
}

export function setTravelMode(mode) {
  setMode(mode);
}

export function setActivePlaceAction(place) {
  setActivePlace(place);
}

export function selectPlace(place, infoBox, ctxGeo = {}) {
  if (!place) return;

  setActivePlace(place);

  clearMarkers();
  renderMarkers([place], () => {});

  const busEnabled = (ctxGeo?.busEnabled !== false);

  const busBtnHTML = busEnabled
    ? `<button class="btn btn-outline-secondary" data-mode="bus">🚌</button>`
    : "";

  infoBox.innerHTML = `
    <h6>${place.nombre}</h6>
    📞 ${place.telefono || "No disponible"}<br>
    ⏰ ${place.horario || "No especificado"}<br><br>

    <div class="btn-group w-100 mb-2" id="transport-modes">
      <button class="btn btn-outline-primary" data-mode="walking">🚶</button>
      <button class="btn btn-outline-success" data-mode="bicycle">🚴</button>
      <button class="btn btn-outline-warning" data-mode="motorcycle">🏍️</button>
      <button class="btn btn-outline-danger" data-mode="driving">🚗</button>
      ${busBtnHTML}
    </div>

    <div id="route-info" class="small mt-1"></div>
  `;

  infoBox.querySelectorAll("button[data-mode]").forEach(btn => {
    btn.onclick = async () => {
      const mode = btn.dataset.mode;

      // ✅ si no hay bus, no debería existir el botón, pero por seguridad:
      if (mode === "bus" && !busEnabled) {
        const infoEl = document.getElementById("route-info");
        if (infoEl) {
          infoEl.innerHTML = `
            <div class="alert alert-info py-2 mb-0">
              En esta zona no hay datos registrados para transporte en bus.
            </div>
          `;
        }
        setMode("walking");
        return;
      }

      setMode(mode);

      const infoEl = document.getElementById("route-info");
      if (infoEl) infoEl.innerHTML = "";

      clearRoute();
      clearTransportLayers();

      const userLoc = getUserLocation();
      if (!userLoc) return;

      if (mode === "bus") {
        const ctx = {
          tipo: "auto",
          provincia: ctxGeo.provincia || "",
          canton: ctxGeo.canton || "",
          parroquia: ctxGeo.parroquia || "",
          specialSevilla: ctxGeo.specialSevilla === true,
          entornoUser: ctxGeo.entornoUser || ctxGeo.entorno || "",
          now: new Date(),
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
  if (!userLoc || !Array.isArray(list) || !list.length) return null;

  let nearest = null;
  let minDistance = Infinity;

  list.forEach(p => {
    const { latitude, longitude } = p?.ubicacion || {};
    if (typeof latitude !== "number" || typeof longitude !== "number") return;

    const d = L.latLng(userLoc).distanceTo([latitude, longitude]);
    if (d < minDistance) {
      minDistance = d;
      nearest = p;
    }
  });

  return nearest;
}