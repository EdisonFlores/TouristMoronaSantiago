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

/** ✅ MODO BUS para categorías normales */
export async function planAndShowBusStops(userLoc, destPlace, ctx = {}, ui = {}) {
  const t = String(ctx?.tipo || "urbano").toLowerCase();
  if (t === "rural") {
    return rural.planAndShowBusStopsForPlace(userLoc, destPlace, ctx, ui);
  }
  return urbano.planAndShowBusStopsForPlace(userLoc, destPlace, ctx, ui);
}
