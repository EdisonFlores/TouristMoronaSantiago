// js/transport/core/transport_multimodal_planner.js
import { map } from "../../map/map.js";
import { getCollectionCache } from "../../app/cache_db.js";

import {
  getLineasByTipo,
  getParadasByLinea,
  normStr,
  normKey
} from "./transport_data.js";

import { planLineBoardAlightByOrder } from "./transport_bus_planner.js";

/* =========================
   CONFIG (ajustable)
========================= */
const CFG = {
  // “cerca del destino”
  NEAR_DEST_M: 950,

  // caminata máxima inicial y final
  URB_MAX_WALK_BOARD: 1200,
  URB_MAX_WALK_DEST: 900,

  RUR_MAX_WALK_BOARD: 1800,
  RUR_MAX_WALK_DEST: 1300,

  // trasbordo
  TRANSFER_MAX_M: 550,

  // top candidates
  K_TRANSFER_STOPS: 18,

  // pesos score (minimiza caminata + bus + stops + penaliza trasbordo)
  SCORE: {
    WALK_M_TO_MIN: 1 / 80,   // 80m ~ 1 min caminando
    TRANSFER_PENALTY_MIN: 9
  }
};

/* =========================
   HELPERS
========================= */
function normLite(s) {
  // ✅ robusto: quita tildes y normaliza espacios
  return normKey(s);
}

function includesKey(haystack, needle) {
  const h = normLite(haystack);
  const n = normLite(needle);
  if (!h || !n) return false;
  return h.includes(n);
}

function isProanoOrRioBlanco(ctx = {}, destPlace = {}) {
  const p1 = normLite(ctx?.parroquia);
  const p2 = normLite(destPlace?.parroquia);
  const c1 = normLite(ctx?.canton);
  const c2 = normLite(destPlace?.canton || destPlace?.ciudad);

  const hayProano =
    (p1.includes("proano") || p2.includes("proano") || c1.includes("proano") || c2.includes("proano"));

  const hayRioBlanco =
    (p1.includes("rio blanco") || p2.includes("rio blanco") || c1.includes("rio blanco") || c2.includes("rio blanco"));

  return hayProano || hayRioBlanco;
}

function isMacasContext(ctx = {}, destPlace = {}) {
  // Tu proyecto mezcla "Morona/Macas" según BD. Aceptamos ambos.
  const c1 = normLite(ctx?.canton);
  const c2 = normLite(destPlace?.canton || destPlace?.ciudad);
  const p1 = normLite(ctx?.parroquia);
  const p2 = normLite(destPlace?.parroquia);

  return (
    c1.includes("macas") || c2.includes("macas") ||
    p1.includes("macas") || p2.includes("macas") ||
    c1.includes("morona") || c2.includes("morona")
  );
}

function llFromStop(p) {
  const u = p?.ubicacion;
  const { latitude, longitude } = u || {};
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  return [latitude, longitude];
}

function dist(a, b) {
  return map.distance(a, b);
}

function isRuralVisibleStop(p) {
  return String(p?.denominacion || "").toLowerCase().trim() === "parada";
}

function nearestKStops(stops, point, k = 15) {
  const out = [];
  for (const s of stops) {
    const ll = llFromStop(s);
    if (!ll) continue;
    out.push({ stop: s, ll, d: dist(point, ll) });
  }
  out.sort((a, b) => a.d - b.d);
  return out.slice(0, Math.max(1, k));
}

function scoreFromWalkAndStops({ walk_m, transfers = 0, stopsCount = 0 }) {
  const walkMin = walk_m * CFG.SCORE.WALK_M_TO_MIN;
  const transferMin = transfers * CFG.SCORE.TRANSFER_PENALTY_MIN;
  return walkMin + transferMin + (stopsCount * 0.05);
}

function makeDirectPlan({ tipo, linea, plan, walkExtra = 0 }) {
  const walk_m = (plan?.metrics?.walk1 || 0) + (plan?.metrics?.walk2 || 0) + walkExtra;
  const stopsCount = plan?.metrics?.stopsCount || 0;

  return {
    type: "direct",
    transfers: 0,
    tipo,
    linea,
    legs: [
      {
        kind: "bus",
        tipo,
        linea,
        boardStop: plan.boardStop,
        alightStop: plan.alightStop,
        pathStops: plan.pathStops || []
      }
    ],
    metrics: { walk_m, stopsCount },
    score: scoreFromWalkAndStops({ walk_m, transfers: 0, stopsCount })
  };
}

/* =========================
   STOP SETS PARA TRASBORDO
========================= */
async function getUrbanoStopsAll() {
  const all = await getCollectionCache("paradas_transporte");
  return (Array.isArray(all) ? all : [])
    .filter(p => p?.activo && normStr(p?.tipo) === "urbana");
}

async function getRuralStopsAll() {
  const all = await getCollectionCache("paradas_rurales");
  return (Array.isArray(all) ? all : [])
    .filter(p => p?.activo && normStr(p?.tipo) === "rural");
}

/**
 * ✅ “Paradas fijas de Macas”
 * - Macas/Morona (por ciudad/parroquia)
 * - NO referencial (si existe)
 * - si existe uso => solo "fija"
 */
function isFixedMacasStop(p) {
  const ciudad = normLite(p?.ciudad);
  const parroquia = normLite(p?.parroquia);

  const esMacas =
    ciudad.includes("macas") ||
    parroquia.includes("macas") ||
    ciudad.includes("morona");

  if (!esMacas) return false;

  // si existe referencial y es true => NO es fija
  if (p?.referencial === true) return false;

  // si existe uso: "fija" => sí (si existe y no es fija => no)
  const uso = normLite(p?.uso);
  if (uso) return uso === "fija";

  // si no hay "uso", aceptamos
  return true;
}

/* =========================
   PLANNERS DIRECTOS
========================= */
async function bestUrbanoDirect(userLoc, destLoc, ctx, opts = {}) {
  const lineas = await getLineasByTipo("urbano", ctx);
  if (!lineas?.length) return null;

  const allowedLineCodes = opts?.allowedLineCodes instanceof Set ? opts.allowedLineCodes : null;

  // mismos parámetros base del urbano_controller (respetando “circulación”)
  const BOARD_STEPS = [150, 250, 350, 450, 650, 800, 1000, 1200];
  const DEST_STEPS  = [150, 250, 350, 450, 650, 900, 1100];

  const BASE = { wWalk1: 1.2, wWalk2: 1.6, wBus: 1.0,  wStops: 25 };
  const CIRC = { wWalk1: 1.2, wWalk2: 1.6, wBus: 1.25, wStops: 45 };

  let best = null;

  for (let i = 0; i < Math.max(BOARD_STEPS.length, DEST_STEPS.length); i++) {
    const maxWalkToBoard = BOARD_STEPS[Math.min(i, BOARD_STEPS.length - 1)];
    const maxWalkToDest  = DEST_STEPS[Math.min(i, DEST_STEPS.length - 1)];

    let levelBest = null;

    for (const linea of lineas) {
      const code = normStr(linea?.codigo);
      if (allowedLineCodes && !allowedLineCodes.has(code)) continue;

      const paradasAll = await getParadasByLinea(linea.codigo, ctx);
      if (!paradasAll?.length) continue;

      const origen = String(linea?.origen || "").toLowerCase();
      const isCirculacion = (origen === "circulacion" || code === "l1" || code === "l2");
      const W = isCirculacion ? CIRC : BASE;

      const plan = planLineBoardAlightByOrder({
        userLoc,
        destLoc,
        stops: paradasAll,
        isCircularOneWay: isCirculacion,

        kBoard: 35,
        kDest: 45,

        maxWalkToBoard,
        maxWalkToDest,

        wWalk1: W.wWalk1,
        wWalk2: W.wWalk2,
        wBus:   W.wBus,
        wStops: W.wStops
      });

      if (!plan) continue;

      const cand = makeDirectPlan({ tipo: "urbano", linea, plan });
      if (!levelBest || cand.score < levelBest.score) levelBest = cand;
    }

    if (levelBest) {
      best = levelBest;
      break;
    }
  }

  return best;
}

async function bestRuralDirect(userLoc, destLoc, ctx, ruralHelpers) {
  const lineas = await getLineasByTipo("rural", ctx);
  if (!lineas?.length) return null;

  const BOARD_STEPS = [350, 550, 800, 1100, 1400, 1800];
  const DEST_STEPS  = [350, 550, 800, 1100, 1400];

  const W = { wWalk1: 1.1, wWalk2: 1.4, wBus: 1.0, wStops: 22 };

  let best = null;

  for (let i = 0; i < Math.max(BOARD_STEPS.length, DEST_STEPS.length); i++) {
    const maxWalkToBoard = BOARD_STEPS[Math.min(i, BOARD_STEPS.length - 1)];
    const maxWalkToDest  = DEST_STEPS[Math.min(i, DEST_STEPS.length - 1)];

    let levelBest = null;

    for (const linea of lineas) {
      for (const sentido of ["ida", "vuelta"]) {
        const orderedAll = await ruralHelpers.getOrderedStops(linea, ctx, sentido);
        if (!orderedAll?.length) continue;

        const stopsPlanner = orderedAll.filter(isRuralVisibleStop);
        if (stopsPlanner.length < 2) continue;

        const plan = planLineBoardAlightByOrder({
          userLoc,
          destLoc,
          stops: stopsPlanner,
          isCircularOneWay: false,

          kBoard: 40,
          kDest: 55,

          maxWalkToBoard,
          maxWalkToDest,

          wWalk1: W.wWalk1,
          wWalk2: W.wWalk2,
          wBus:   W.wBus,
          wStops: W.wStops
        });

        if (!plan) continue;

        const cand = makeDirectPlan({ tipo: "rural", linea, plan });
        cand._sentido = sentido;
        if (!levelBest || cand.score < levelBest.score) levelBest = cand;
      }
    }

    if (levelBest) {
      best = levelBest;
      break;
    }
  }

  return best;
}

/* =========================
   MULTIMODAL (1 trasbordo)
   ✅ Regla: transbordo urbano SOLO L1↔L2
   ✅ Caso Proaño/Río Blanco: urbano SOLO L5
   ✅ Caso Macas: usar paradas fijas de Macas como targets de transferencia
   ✅ Prioriza terminales como target de transferencia
========================= */
function getAllowedUrbanoForTransfer(ctx, destPlace) {
  if (isProanoOrRioBlanco(ctx, destPlace)) return new Set(["l5"]);
  return new Set(["l1", "l2"]);
}

function prioritizeTerminalFirst(cands) {
  // ✅ terminales primero, sin excluir los demás
  const a = [];
  const b = [];
  for (const x of (cands || [])) {
    if (x?.stop?.es_terminal === true) a.push(x);
    else b.push(x);
  }
  return [...a, ...b];
}

async function bestTransfer_RuralToUrbano(userLoc, destLoc, ctx, ruralHelpers, destPlace) {
  const urbanoStops = await getUrbanoStopsAll();

  // ✅ si el contexto es Macas, preferimos transfer targets en “paradas fijas Macas”
  let pool = urbanoStops;
  if (isMacasContext(ctx, destPlace)) {
    const fixed = urbanoStops.filter(isFixedMacasStop);
    // ✅ fallback si quedó vacío
    if (fixed.length) pool = fixed;
  }

  let candidates = nearestKStops(pool, destLoc, CFG.K_TRANSFER_STOPS)
    .filter(x => x.d <= 1600);

  candidates = prioritizeTerminalFirst(candidates);

  if (!candidates.length) return null;

  const allowedUrb = getAllowedUrbanoForTransfer(ctx, destPlace);

  let best = null;

  for (const u of candidates) {
    const transferTarget = u.ll;

    const ruralLeg = await bestRuralDirect(userLoc, transferTarget, ctx, ruralHelpers);
    if (!ruralLeg) continue;

    const ruralAlightLL = llFromStop(ruralLeg.legs[0].alightStop);
    if (!ruralAlightLL) continue;

    const transferWalk = dist(ruralAlightLL, transferTarget);
    if (transferWalk > CFG.TRANSFER_MAX_M) continue;

    const urbanoLeg = await bestUrbanoDirect(transferTarget, destLoc, ctx, { allowedLineCodes: allowedUrb });
    if (!urbanoLeg) continue;

    const plan = {
      type: "transfer",
      transfers: 1,
      metrics: {
        walk_m: (ruralLeg.metrics.walk_m || 0) + transferWalk + (urbanoLeg.metrics.walk_m || 0),
        stopsCount: (ruralLeg.metrics.stopsCount || 0) + (urbanoLeg.metrics.stopsCount || 0),
        transferWalk_m: transferWalk
      },
      score: scoreFromWalkAndStops({
        walk_m: (ruralLeg.metrics.walk_m || 0) + transferWalk + (urbanoLeg.metrics.walk_m || 0),
        transfers: 1,
        stopsCount: (ruralLeg.metrics.stopsCount || 0) + (urbanoLeg.metrics.stopsCount || 0)
      }),
      legs: [
        { kind: "bus", tipo: "rural",  linea: ruralLeg.linea,  ...ruralLeg.legs[0],  _sentido: ruralLeg._sentido },
        { kind: "walk-transfer", meters: transferWalk, from: ruralAlightLL, to: transferTarget },
        { kind: "bus", tipo: "urbano", linea: urbanoLeg.linea, ...urbanoLeg.legs[0] }
      ]
    };

    if (!best || plan.score < best.score) best = plan;
  }

  return best;
}

async function bestTransfer_UrbanoToRural(userLoc, destLoc, ctx, ruralHelpers, destPlace) {
  const ruralStops = (await getRuralStopsAll()).filter(isRuralVisibleStop);
  let candidates = nearestKStops(ruralStops, destLoc, CFG.K_TRANSFER_STOPS)
    .filter(x => x.d <= 2200);

  // (para urbano->rural, los candidates son rurales, no hay es_terminal urbano aquí)
  if (!candidates.length) return null;

  const allowedUrb = getAllowedUrbanoForTransfer(ctx, destPlace);

  let best = null;

  for (const r of candidates) {
    const transferTarget = r.ll;

    const urbanoLeg = await bestUrbanoDirect(userLoc, transferTarget, ctx, { allowedLineCodes: allowedUrb });
    if (!urbanoLeg) continue;

    const urbanoAlightLL = llFromStop(urbanoLeg.legs[0].alightStop);
    if (!urbanoAlightLL) continue;

    const transferWalk = dist(urbanoAlightLL, transferTarget);
    if (transferWalk > CFG.TRANSFER_MAX_M) continue;

    const ruralLeg = await bestRuralDirect(transferTarget, destLoc, ctx, ruralHelpers);
    if (!ruralLeg) continue;

    const plan = {
      type: "transfer",
      transfers: 1,
      metrics: {
        walk_m: (urbanoLeg.metrics.walk_m || 0) + transferWalk + (ruralLeg.metrics.walk_m || 0),
        stopsCount: (urbanoLeg.metrics.stopsCount || 0) + (ruralLeg.metrics.stopsCount || 0),
        transferWalk_m: transferWalk
      },
      score: scoreFromWalkAndStops({
        walk_m: (urbanoLeg.metrics.walk_m || 0) + transferWalk + (ruralLeg.metrics.walk_m || 0),
        transfers: 1,
        stopsCount: (urbanoLeg.metrics.stopsCount || 0) + (ruralLeg.metrics.stopsCount || 0)
      }),
      legs: [
        { kind: "bus", tipo: "urbano", linea: urbanoLeg.linea, ...urbanoLeg.legs[0] },
        { kind: "walk-transfer", meters: transferWalk, from: urbanoAlightLL, to: transferTarget },
        { kind: "bus", tipo: "rural",  linea: ruralLeg.linea,  ...ruralLeg.legs[0], _sentido: ruralLeg._sentido }
      ]
    };

    if (!best || plan.score < best.score) best = plan;
  }

  return best;
}

/* =========================
   API PRINCIPAL
   ✅ Proaño/Río Blanco => urbano solo L5 (directo o transfer)
========================= */
export async function planBestBusTrip({ userLoc, destPlace, ctx = {}, ruralHelpers }) {
  if (!userLoc || !destPlace?.ubicacion) return null;
  const destLoc = [destPlace.ubicacion.latitude, destPlace.ubicacion.longitude];

  const onlyL5 = isProanoOrRioBlanco(ctx, destPlace);
  const urbAllowedDirect = onlyL5 ? new Set(["l5"]) : null;

  // 1) Directos
  const urbano = await bestUrbanoDirect(userLoc, destLoc, ctx, { allowedLineCodes: urbAllowedDirect });
  const rural  = await bestRuralDirect(userLoc, destLoc, ctx, ruralHelpers);

  let best = null;
  if (urbano) best = urbano;
  if (rural && (!best || rural.score < best.score)) best = rural;

  if (best?.type === "direct") {
    const alightLL = llFromStop(best.legs[0].alightStop);
    if (alightLL && dist(alightLL, destLoc) <= CFG.NEAR_DEST_M) return best;
  }

  // 2) Trasbordos (1) con restricciones
  const t1 = await bestTransfer_RuralToUrbano(userLoc, destLoc, ctx, ruralHelpers, destPlace);
  const t2 = await bestTransfer_UrbanoToRural(userLoc, destLoc, ctx, ruralHelpers, destPlace);

  if (t1 && (!best || t1.score < best.score)) best = t1;
  if (t2 && (!best || t2.score < best.score)) best = t2;

  return best;
}
