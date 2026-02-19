// js/transport/transport_controller.js
import * as urbano from "./urbano/urbano_controller.js";
import * as rural from "./rural/rural_controller.js";

export function clearTransportLayers() {
  urbano.clearTransportLayers();
  rural.clearTransportLayers();
}

export async function cargarLineasTransporte(tipo, container, ctx = {}) {
  const t = String(tipo || "").toLowerCase();
  if (t === "rural") return rural.cargarLineasTransporte(tipo, container, ctx);
  return urbano.cargarLineasTransporte(tipo, container, ctx);
}

export async function mostrarRutaLinea(linea, opts = {}, ctx = {}) {
  const t = String(linea?.tipo || "").toLowerCase();
  if (t === "rural") return rural.mostrarRutaLinea(linea, opts, ctx);
  return urbano.mostrarRutaLinea(linea, opts, ctx);
}

/**
 * ✅ MODO BUS (AUTO):
 * - prueba urbano primero (como estaba)
 * - si no hay solución, prueba rural
 * - Sevilla Don Bosco: permite combinado (rural + urbano Morona)
 */
export async function planAndShowBusStops(userLoc, destPlace, ctx = {}, ui = {}) {
  const specialSevilla = ctx?.specialSevilla === true;

  // 1) intento urbano
  const urbanoRes = await urbano.planAndShowBusStopsForPlace(userLoc, destPlace, {
    ...ctx,
    tipo: "urbano",
  }, ui);

  if (urbanoRes) return urbanoRes;

  // 2) intento rural (enganchar a ruta)
  const ruralRes = await rural.planAndShowBusStopsForPlace(userLoc, destPlace, {
    ...ctx,
    tipo: "rural",
    specialSevilla
  }, ui);

  return ruralRes;
}
