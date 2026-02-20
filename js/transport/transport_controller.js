// js/transport/transport_controller.js
import { clearRoute } from "../map/map.js";
import { clearTransportState } from "./core/transport_state.js";

// Controladores (selector "Líneas de transporte")
import { cargarLineasTransporte as cargarUrbano } from "./urbano/urbano_controller.js";
import { cargarLineasTransporte as cargarRural } from "./rural/rural_controller.js";

// Planners (modo 🚌 desde UI general)
import { planAndShowBusStopsForPlace as planUrbanoForPlace } from "./urbano/urbano_controller.js";
import { planAndShowBusStopsForPlace as planRuralForPlace } from "./rural/rural_controller.js";

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

  if (t === "urbano") return cargarUrbano(tipo, container, ctx);
  if (t === "rural") return cargarRural(tipo, container, ctx);

  container.innerHTML = `<div class="alert alert-warning py-2">Tipo no soportado</div>`;
}

/* =====================================================
   ENTORNO: decide prioridad de tipo bus
===================================================== */
function normEntorno(v) {
  const s = String(v || "").trim().toLowerCase();
  if (s === "urbano") return "urbano";
  if (s === "rural") return "rural";
  return ""; // desconocido
}

function decidePreferredTipo(entornoUser, entornoDest) {
  const u = normEntorno(entornoUser);
  const d = normEntorno(entornoDest);

  // reglas pedidas
  if (u === "rural" && d === "rural") return "rural";
  if (u === "rural" && d === "urbano") return "rural";
  if (u === "urbano" && d === "urbano") return "urbano";
  if (u === "urbano" && d === "rural") return "rural";

  return ""; // si no hay dato, usamos fallback por score como antes
}

/* =====================================================
   🚌 MODO BUS (UI general)
   ✅ Primero determina tipo por entorno
   ✅ Luego usa score dentro de ese tipo
   ✅ Si falla, fallback al otro tipo
===================================================== */
export async function planAndShowBusStops(userLoc, destPlace, ctx = {}, ui = {}) {
  if (!userLoc || !destPlace?.ubicacion) return null;

  if (!ctx?.preserveLayers) clearTransportLayers();

  const now = (ctx?.now instanceof Date) ? ctx.now : new Date();

  const entornoUser = ctx?.entornoUser;           // "Urbano" | "Rural"
  const entornoDest = destPlace?.entorno;         // "Urbano" | "Rural"

  const preferred = decidePreferredTipo(entornoUser, entornoDest);

  // ctx base consistente
  const baseCtx = {
    ...ctx,
    now,
    tipo: ctx?.tipo || "auto",
  };

  // helper para ejecutar un planner con/ sin dryRun
  async function runTipo(tipo, { dryRun, preserveLayers }, uiArg) {
    const c = { ...baseCtx, dryRun: !!dryRun, preserveLayers: !!preserveLayers };

    if (tipo === "urbano") {
      // urbano usa paradas_transporte internamente (ctx.tipo no debe ser "rural")
      return planUrbanoForPlace(userLoc, destPlace, { ...c, tipo: "auto" }, uiArg);
    }

    // rural: importante ctx.tipo="rural" para que getParadasByLinea lea paradas_rurales
    return planRuralForPlace(userLoc, destPlace, { ...c, tipo: "rural" }, uiArg);
  }

  // =========================
  // 1) Si tenemos preferencia por entorno -> intentamos SOLO ese tipo
  // =========================
  if (preferred) {
    if (ui?.infoEl) {
      ui.infoEl.innerHTML = `
        <div class="alert alert-info py-2 mb-2">
          🧭 Entorno detectado: <b>${normEntorno(entornoUser) || "?"}</b> → <b>${normEntorno(entornoDest) || "?"}</b><br>
          ✅ Priorizando bus <b>${preferred}</b>…
        </div>
      `;
    }

    // Evaluación (dryRun) SOLO del tipo preferido (para confirmar que existe plan)
    let evalPreferred = null;
    try {
      evalPreferred = await runTipo(preferred, { dryRun: true, preserveLayers: true }, { infoEl: null });
    } catch (e) {
      console.warn(`Eval ${preferred} falló:`, e);
    }

    // Si hay plan, dibujamos el mismo tipo (ya escogerá mejor línea por score dentro del tipo)
    if (evalPreferred) {
      clearTransportLayers(); // limpiamos antes de dibujar la ruta final
      return runTipo(preferred, { dryRun: false, preserveLayers: false }, ui);
    }

    // Fallback: si no encontró plan, probamos el otro tipo
    const other = (preferred === "urbano") ? "rural" : "urbano";

    if (ui?.infoEl) {
      ui.infoEl.innerHTML += `
        <div class="alert alert-warning py-2 mt-2 mb-2">
          ⚠️ No se encontró ruta <b>${preferred}</b>. Probando <b>${other}</b>…
        </div>
      `;
    }

    let evalOther = null;
    try {
      evalOther = await runTipo(other, { dryRun: true, preserveLayers: true }, { infoEl: null });
    } catch (e) {
      console.warn(`Eval ${other} falló:`, e);
    }

    if (!evalOther) {
      if (ui?.infoEl) {
        ui.infoEl.innerHTML += `
          <div class="alert alert-danger py-2 mb-0">
            ❌ No se encontró ruta en bus (ni ${preferred} ni ${other}).
          </div>
        `;
      }
      return null;
    }

    clearTransportLayers();
    return runTipo(other, { dryRun: false, preserveLayers: false }, ui);
  }

  // =========================
  // 2) Si NO hay entorno (o desconocido), usamos el comportamiento anterior:
  //    eval urbano vs rural y elegimos por score (fallback legacy)
  // =========================
  const evalCtx = { ...baseCtx, dryRun: true, preserveLayers: true };

  let urbanoEval = null;
  let ruralEval = null;

  try { urbanoEval = await runTipo("urbano", evalCtx, { infoEl: null }); } catch (e) { console.warn("Eval urbano falló:", e); }
  try { ruralEval  = await runTipo("rural",  evalCtx, { infoEl: null }); } catch (e) { console.warn("Eval rural falló:", e); }

  const uScore = Number.isFinite(urbanoEval?.score) ? urbanoEval.score : Infinity;
  const rScore = Number.isFinite(ruralEval?.score) ? ruralEval.score : Infinity;

  let winner = null;
  if (uScore < rScore) winner = "urbano";
  else if (rScore < uScore) winner = "rural";
  else winner = urbanoEval ? "urbano" : (ruralEval ? "rural" : null);

  if (!winner) {
    if (ui?.infoEl) {
      ui.infoEl.innerHTML = `
        <div class="alert alert-warning py-2 mb-0">
          ❌ No se encontró ruta en bus (urbano ni rural).
        </div>
      `;
    }
    return null;
  }

  clearTransportLayers();
  return runTipo(winner, { dryRun: false, preserveLayers: false }, ui);
}