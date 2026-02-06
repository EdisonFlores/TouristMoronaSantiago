// js/app/actions.js
import { setActivePlace, getUserLocation, setMode } from "./state.js";
import { drawRoute, clearMarkers, renderMarkers } from "../map/map.js";
import { planAndShowBusStops } from "../transport/transport_controller.js";

/* =========================
   Seleccionar un lugar
========================= */
export function selectPlace(place, infoBox) {
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
      if (infoEl) infoEl.innerHTML = ""; // ✅ limpia antes de pintar algo nuevo

      if (mode === "bus") {
        const userLoc = getUserLocation();

        // ✅ ctx CORRECTO para filtrar lineas por cantonpasa / ciudadpasa
        // - canton: cantón del lugar (en tu BD "ciudad" suele ser el cantón en lugar)
        // - parroquia: parroquia real del lugar destino
        // Si en tu BD el cantón está en `place.ciudad`, usamos ese fallback.
        const ctx = {
          tipo: "urbano",
          canton: place.canton || place.ciudad || "",
          parroquia: place.parroquia || ""
        };

        await planAndShowBusStops(userLoc, place, ctx, { infoEl });
        return;
      }

      // otros modos: OSRM normal
      drawRoute(getUserLocation(), place, mode, infoEl);
    };
  });
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
