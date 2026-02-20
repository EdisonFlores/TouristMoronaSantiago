// js/transport/transport_controller.js
import { clearRoute } from "../map/map.js";
import { clearTransportState } from "./core/transport_state.js";

// Controladores
import { cargarLineasTransporte as cargarUrbano } from "./urbano/urbano_controller.js";
import { cargarLineasTransporte as cargarRural, planAndShowBusStopsForPlace } from "./rural/rural_controller.js";

/* =====================================================
   LIMPIEZA GENERAL
===================================================== */
export function clearTransportLayers() {
  try { clearRoute?.(); } catch {}
  try { clearTransportState?.(); } catch {}
}

/* =====================================================
   CARGAR LÍNEAS (select "Líneas de transporte")
===================================================== */
export async function cargarLineasTransporte(tipo, container, ctx = {}) {
  const t = String(tipo || "").toLowerCase();

  clearTransportLayers();

  if (t === "urbano") {
    return cargarUrbano(tipo, container, ctx);
  }

  if (t === "rural") {
    return cargarRural(tipo, container, ctx);
  }

  container.innerHTML = `<div class="alert alert-warning py-2">Tipo no soportado</div>`;
  return;
}

/* =====================================================
   MODO BUS desde UI general (🚌)
   (por ahora: RURAL directo, sin trasbordo)
===================================================== */
export async function planAndShowBusStops(userLoc, destPlace, ctx = {}, ui = {}) {
  return planAndShowBusStopsForPlace(userLoc, destPlace, ctx, ui);
}
