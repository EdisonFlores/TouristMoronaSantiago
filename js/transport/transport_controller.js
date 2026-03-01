// js/transport/transport_controller.js
import { clearTransportRoute, map as leafletMap } from "../map/map.js";
import { clearTransportState } from "./core/transport_state.js";
import { getCollectionCache } from "../app/cache_db.js";

// Controladores (selector "Líneas de transporte")
import { cargarLineasTransporte as cargarUrbano } from "./urbano/urbano_controller.js";
import { cargarLineasTransporte as cargarRural } from "./rural/rural_controller.js";

// Planners (modo 🚌 desde UI general)
import { planAndShowBusStopsForPlace as planUrbanoForPlace } from "./urbano/urbano_controller.js";
import { planAndShowBusStopsForPlace as planRuralForPlace } from "./rural/rural_controller.js";

export function clearTransportLayers() {
  try { clearTransportRoute?.(); } catch {}
  try { clearTransportState?.(); } catch {}
}

export async function cargarLineasTransporte(tipo, container, ctx = {}) {
  const t = String(tipo || "").toLowerCase();

  clearTransportLayers();

  if (t === "urbano") return cargarUrbano(tipo, container, ctx);
  if (t === "rural") return cargarRural(tipo, container, ctx);

  container.innerHTML = `<div class="alert alert-warning py-2">Tipo no soportado</div>`;
}

function normEntorno(v) {
  const s = String(v || "").trim().toLowerCase();
  if (s === "urbano") return "urbano";
  if (s === "rural") return "rural";
  return "";
}

function decidePreferredTipo(entornoUser, entornoDest) {
  const u = normEntorno(entornoUser);
  const d = normEntorno(entornoDest);
  if (u && d && u === d) return u;
  return "";
}

// ✅ NUEVO: cobertura bus mínima (paradas cerca de user o destino)
function llFromStop(p) {
  const u = p?.ubicacion;
  const { latitude, longitude } = u || {};
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  return [latitude, longitude];
}

function distMeters(map, a, b) {
  try { return map.distance(a, b); } catch { return Infinity; }
}

export async function hasBusCoverage({ map, userLoc, destLoc, radiusUrb = 2200, radiusRur = 4200 } = {}) {
  if (!map || !userLoc || !destLoc) return false;

  const urbanoAll = await getCollectionCache("paradas_transporte");
  const ruralAll  = await getCollectionCache("paradas_rurales");

  const urbano = (Array.isArray(urbanoAll) ? urbanoAll : [])
    .filter(p => p?.activo && String(p?.tipo || "").toLowerCase().trim() === "urbana");

  const rural = (Array.isArray(ruralAll) ? ruralAll : [])
    .filter(p => p?.activo && String(p?.tipo || "").toLowerCase().trim() === "rural");

  const nearAny = (arr, rad) => {
    for (const p of arr) {
      const ll = llFromStop(p);
      if (!ll) continue;
      const d1 = distMeters(map, userLoc, ll);
      const d2 = distMeters(map, destLoc, ll);
      if (d1 <= rad || d2 <= rad) return true;
    }
    return false;
  };

  const okU = nearAny(urbano, radiusUrb);
  const okR = nearAny(rural, radiusRur);
  return okU || okR;
}

// ✅ timeout global para modo bus (evita “1 minuto pensando”)
async function withTimeout(promise, ms = 12000) {
  let t = null;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error("timeout")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (t) clearTimeout(t);
  }
}

export async function planAndShowBusStops(userLoc, destPlace, ctx = {}, ui = {}) {
  if (!userLoc || !destPlace?.ubicacion) return null;

  const now = (ctx?.now instanceof Date) ? ctx.now : new Date();

  const destLoc = [destPlace.ubicacion.latitude, destPlace.ubicacion.longitude];
  const ok = await hasBusCoverage({ map: leafletMap, userLoc, destLoc });

  if (!ok) {
    if (ui?.infoEl) {
      ui.infoEl.innerHTML = `
        <div class="alert alert-info py-2 mb-0">
          De momento no hay datos registrados en la zona para planificar <b>bus</b>. Pronto habrá cobertura.
        </div>
      `;
    }
    return null;
  }

  if (!ctx?.preserveLayers) clearTransportLayers();

  const entornoUser = ctx?.entornoUser;
  const entornoDest = destPlace?.entorno;
  const preferred = decidePreferredTipo(entornoUser, entornoDest);

  const baseCtx = {
    ...ctx,
    now,
    tipo: ctx?.tipo || "auto",
  };

  async function runTipo(tipo, { dryRun, preserveLayers }, uiArg) {
    const c = { ...baseCtx, dryRun: !!dryRun, preserveLayers: !!preserveLayers };

    if (tipo === "urbano") {
      return planUrbanoForPlace(userLoc, destPlace, { ...c, tipo: "auto" }, uiArg);
    }

    return planRuralForPlace(
      userLoc,
      destPlace,
      { ...c, tipo: "rural", sentido: c?.sentido || "auto" },
      uiArg
    );
  }

  try {
    return await withTimeout((async () => {
      if (preferred) {
        let evalPreferred = null;
        try {
          evalPreferred = await runTipo(preferred, { dryRun: true, preserveLayers: true }, { infoEl: null });
        } catch (e) {
          console.warn(`Eval ${preferred} falló:`, e);
        }

        if (evalPreferred) {
          clearTransportLayers();
          return runTipo(preferred, { dryRun: false, preserveLayers: false }, ui);
        }

        const other = (preferred === "urbano") ? "rural" : "urbano";

        let evalOther = null;
        try {
          evalOther = await runTipo(other, { dryRun: true, preserveLayers: true }, { infoEl: null });
        } catch (e) {
          console.warn(`Eval ${other} falló:`, e);
        }

        if (!evalOther) {
          if (ui?.infoEl) {
            ui.infoEl.innerHTML = `
              <div class="alert alert-warning py-2 mb-0">
                ❌ No se encontró una ruta en bus para llegar a este destino.
              </div>
            `;
          }
          return null;
        }

        clearTransportLayers();
        return runTipo(other, { dryRun: false, preserveLayers: false }, ui);
      }

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
              ❌ No se encontró una ruta en bus para llegar a este destino.
            </div>
          `;
        }
        return null;
      }

      clearTransportLayers();
      return runTipo(winner, { dryRun: false, preserveLayers: false }, ui);
    })(), 12000);
  } catch (e) {
    if (ui?.infoEl) {
      ui.infoEl.innerHTML = `
        <div class="alert alert-warning py-2 mb-0">
          ❌ No se encontró una ruta óptima en bus (tiempo de búsqueda excedido).
        </div>
      `;
    }
    return null;
  }
}