// js/transport/core/transport_multimodal_planner.js
import { map } from "../../map/map.js";
import { getCollectionCache } from "../../app/cache_db.js";

import {
  getLineasByTipo,
  getParadasByLinea,
  normStr
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
  // stopsCount ya viene ponderado dentro del planLineBoardAlightByOrder, pero aquí ayuda a desempatar
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

function makeTransferPlan({
  first,   // { tipo,linea,plan }
  second,  // { tipo,linea,plan }
  transferWalk_m = 0,
  firstToTransferWalk_m = 0,
  transferToDestWalk_m = 0
}) {
  const w1 = (first.plan?.metrics?.walk1 || 0);
  const w2 = (first.plan?.metrics?.walk2 || 0);
  const w3 = (second.plan?.metrics?.walk1 || 0);
  const w4 = (second.plan?.metrics?.walk2 || 0);

  const walk_m = w1 + w2 + transferWalk_m + w3 + w4 + firstToTransferWalk_m + transferToDestWalk_m;

  const stopsCount =
    (first.plan?.metrics?.stopsCount || 0) +
    (second.plan?.metrics?.stopsCount || 0);

  return {
    type: "transfer",
    transfers: 1,
    legs: [
      {
        kind: "bus",
        tipo: first.tipo,
        linea: first.linea,
        boardStop: first.plan.boardStop,
        alightStop: first.plan.alightStop,
        pathStops: first.plan.pathStops || []
      },
      {
        kind: "walk-transfer",
        meters: transferWalk_m
      },
      {
        kind: "bus",
        tipo: second.tipo,
        linea: second.linea,
        boardStop: second.plan.boardStop,
        alightStop: second.plan.alightStop,
        pathStops: second.plan.pathStops || []
      }
    ],
    metrics: { walk_m, stopsCount, transferWalk_m },
    score: scoreFromWalkAndStops({ walk_m, transfers: 1, stopsCount })
  };
}

/* =========================
   PLANNERS DIRECTOS
========================= */
async function bestUrbanoDirect(userLoc, destLoc, ctx) {
  const lineas = await getLineasByTipo("urbano", ctx);
  if (!lineas?.length) return null;

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
      const paradasAll = await getParadasByLinea(linea.codigo, ctx);
      if (!paradasAll?.length) continue;

      const origen = String(linea?.origen || "").toLowerCase();
      const codigo = normStr(linea.codigo);

      const isCirculacion = (origen === "circulacion" || codigo === "l1" || codigo === "l2");
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

      // preferimos alight cerca del destino cuando hay empate
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

async function getOrderedStopsRuralForPlanner(lineaCodigo, ctx, sentidoSel = "ida") {
  // tomamos la lógica exacta de rural_controller: orden por prefijos + corte finderuta
  // para no duplicar lógica aquí, reutilizamos directamente lo que ya haces en rural_controller
  // => lo resolvemos con una función exportada (ver patch rural_controller más abajo).
  //
  // Este módulo la importará desde rural_controller para no duplicar.
  return null;
}

async function bestRuralDirect(userLoc, destLoc, ctx, ruralHelpers) {
  const lineas = await getLineasByTipo("rural", ctx);
  if (!lineas?.length) return null;

  const BOARD_STEPS = [350, 550, 800, 1100, 1400, 1800];
  const DEST_STEPS  = [350, 550, 800, 1100, 1400];

  // pesos un poco más “tolerantes” en rural
  const W = { wWalk1: 1.1, wWalk2: 1.4, wBus: 1.0, wStops: 22 };

  let best = null;

  for (let i = 0; i < Math.max(BOARD_STEPS.length, DEST_STEPS.length); i++) {
    const maxWalkToBoard = BOARD_STEPS[Math.min(i, BOARD_STEPS.length - 1)];
    const maxWalkToDest  = DEST_STEPS[Math.min(i, DEST_STEPS.length - 1)];

    let levelBest = null;

    for (const linea of lineas) {
      // probamos dos sentidos: ida y vuelta
      for (const sentido of ["ida", "vuelta"]) {
        const orderedAll = await ruralHelpers.getOrderedStops(linea, ctx, sentido);
        if (!orderedAll?.length) continue;

        // para SUBIR/BAJAR: solo paradas “parada”
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

/* =========================
   MULTIMODAL (1 trasbordo)
========================= */
async function bestTransfer_RuralToUrbano(userLoc, destLoc, ctx, ruralHelpers) {
  const urbanoStops = await getUrbanoStopsAll();
  const candidates = nearestKStops(urbanoStops, destLoc, CFG.K_TRANSFER_STOPS)
    .filter(x => x.d <= 1600);

  if (!candidates.length) return null;

  const urbanoLineas = await getLineasByTipo("urbano", ctx);
  if (!urbanoLineas?.length) return null;

  // 1) para cada parada urbana cerca del destino, intentamos:
  //    rural (usuario -> cerca de esa parada) + caminata transferencia + urbano (esa parada -> destino)
  let best = null;

  for (const u of candidates) {
    const transferTarget = u.ll;

    // rural leg hacia “transferTarget”
    const ruralLeg = await bestRuralDirect(userLoc, transferTarget, ctx, ruralHelpers);
    if (!ruralLeg) continue;

    const ruralAlightLL = llFromStop(ruralLeg.legs[0].alightStop);
    if (!ruralAlightLL) continue;

    const transferWalk = dist(ruralAlightLL, transferTarget);
    if (transferWalk > CFG.TRANSFER_MAX_M) continue;

    // urbano leg desde transferTarget hacia destino:
    // lo tratamos como userLoc=transferTarget para planner urbano directo.
    const urbanoLeg = await bestUrbanoDirect(transferTarget, destLoc, ctx);
    if (!urbanoLeg) continue;

    const cand = makeTransferPlan({
      first: { tipo: "rural", linea: ruralLeg.linea, plan: ruralLeg.legs[0] ? { ...ruralLeg.legs[0], ...ruralLeg.legs[0] } : null },
      second: { tipo: "urbano", linea: urbanoLeg.linea, plan: urbanoLeg.legs[0] ? { ...urbanoLeg.legs[0], ...urbanoLeg.legs[0] } : null },
      transferWalk_m: transferWalk
    });

    // Ajuste real: makeTransferPlan necesita “plan” en el formato de planLineBoard...:
    // aquí simplificamos: mejor construimos una estructura manual abajo.
    // Para no enredar, devolvemos un objeto directo:
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

async function bestTransfer_UrbanoToRural(userLoc, destLoc, ctx, ruralHelpers) {
  const ruralStops = (await getRuralStopsAll()).filter(isRuralVisibleStop);
  const candidates = nearestKStops(ruralStops, destLoc, CFG.K_TRANSFER_STOPS)
    .filter(x => x.d <= 2200);

  if (!candidates.length) return null;

  let best = null;

  for (const r of candidates) {
    const transferTarget = r.ll;

    const urbanoLeg = await bestUrbanoDirect(userLoc, transferTarget, ctx);
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
========================= */
export async function planBestBusTrip({ userLoc, destPlace, ctx = {}, ruralHelpers }) {
  if (!userLoc || !destPlace?.ubicacion) return null;
  const destLoc = [destPlace.ubicacion.latitude, destPlace.ubicacion.longitude];

  // 1) Directos
  const urbano = await bestUrbanoDirect(userLoc, destLoc, ctx);
  const rural  = await bestRuralDirect(userLoc, destLoc, ctx, ruralHelpers);

  let best = null;
  if (urbano) best = urbano;
  if (rural && (!best || rural.score < best.score)) best = rural;

  // si el mejor directo deja razonablemente cerca, lo aceptamos
  if (best?.type === "direct") {
    const alightLL = llFromStop(best.legs[0].alightStop);
    if (alightLL && dist(alightLL, destLoc) <= CFG.NEAR_DEST_M) return best;
  }

  // 2) Trasbordos (1)
  const t1 = await bestTransfer_RuralToUrbano(userLoc, destLoc, ctx, ruralHelpers);
  const t2 = await bestTransfer_UrbanoToRural(userLoc, destLoc, ctx, ruralHelpers);

  if (t1 && (!best || t1.score < best.score)) best = t1;
  if (t2 && (!best || t2.score < best.score)) best = t2;

  return best;
}
