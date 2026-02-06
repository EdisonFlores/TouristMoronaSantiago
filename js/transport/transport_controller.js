// js/transport/transport_controller.js
import * as urbano from "./urbano/urbano_controller.js";
import * as rural from "./rural/rural_controller.js";

/**
 * API pública (se mantiene)
 * - cargarLineasTransporte(tipo, container, ctx)
 * - mostrarRutaLinea(linea, opts, ctx)
 * - clearTransportLayers()
 */

export function clearTransportLayers() {
  // limpia lo que esté activo (urbano o rural)
  urbano.clearTransportLayers();
  rural.clearTransportLayers();
}

export async function cargarLineasTransporte(tipo, container, ctx = {}) {
  const t = String(tipo || "").toLowerCase();
  if (t === "rural") return rural.cargarLineasTransporte(tipo, container, ctx);
  return urbano.cargarLineasTransporte(tipo, container, ctx);
}

export async function mostrarRutaLinea(linea, opts = {}, ctx = {}) {
  // por seguridad: si una línea viene con tipo, enrutar; si no, urbano default
  const t = String(linea?.tipo || "").toLowerCase();
  if (t === "rural") return rural.mostrarRutaLinea(linea, opts, ctx);
  return urbano.mostrarRutaLinea(linea, opts, ctx);
}
