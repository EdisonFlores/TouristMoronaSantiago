// js/transport/urbano/urbano_controller.js
import { getUserLocation } from "../../app/state.js";
import { map } from "../../map/map.js";

import { renderLineaExtraControls } from "../core/transport_ui.js";
import {
  getLineasByTipo,
  getParadasByLinea,
  normStr,
  titleCase,
  normCobertura,
  isLineOperatingNow,
  formatLineScheduleHTML
} from "../core/transport_data.js";

import {
  buildStopPopupHTML,
  startPopupLiveUpdate,
  stopPopupLiveUpdate,
  computeStopOffsets
} from "../core/transport_time.js";

import {
  drawDashedAccessRoute,
  drawLineRouteFollowingStreets
} from "../core/transport_osrm.js";

import {
  clearTransportState,
  setCurrentLinea,
  setCurrentParadas,
  setCurrentStopMarkers,
  setCurrentStopOffsets,
  setStopsLayer,
  setRouteLayer,
  setAccessLayer,
  resetNearestHighlight,
  setNearestHighlight,
  getCurrentStopMarkers
} from "../core/transport_state.js";

import { planLineBoardAlightByOrder } from "../core/transport_bus_planner.js";

/* =====================================================
   ✅ NUEVO: validación geo (provincia/cantón/parroquia)
===================================================== */
function normLite(s) {
  return String(s || "").trim().toLowerCase();
}

function geoMatches(ctx = {}, place = {}) {
  const pCtx = normLite(ctx.provincia);
  const cCtx = normLite(ctx.canton);
  const paCtx = normLite(ctx.parroquia);

  if (!pCtx && !cCtx && !paCtx) return true;

  const pPl = normLite(place.provincia);
  const cPl = normLite(place.canton || place.ciudad);
  const paPl = normLite(place.parroquia);

  // si falta info en el destino, no bloqueamos
  if ((pCtx && !pPl) || (cCtx && !cPl) || (paCtx && !paPl)) return true;

  if (pCtx && pPl && pCtx !== pPl) return false;
  if (cCtx && cPl && cCtx !== cPl) return false;
  if (paCtx && paPl && paCtx !== paPl) return false;

  return true;
}

/* =====================================================
   MODAL (Bootstrap) - solo para "Líneas de transporte"
===================================================== */
function ensureTransportModal() {
  let el = document.getElementById("tm-linea-modal");
  if (el) return el;

  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="modal fade" id="tm-linea-modal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">

          <div class="modal-header">
            <h5 class="modal-title" id="tm-linea-modal-title">Información de la línea</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>
          </div>

          <div class="modal-body">
            <div id="tm-linea-modal-body" class="small"></div>

            <div class="alert alert-info py-2 mt-3 mb-0">
              ℹ️ <b>Nota:</b> horarios, frecuencias, tiempos y “próximo bus” son <b>aproximados</b>.
            </div>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cerrar</button>
          </div>

        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap.firstElementChild);
  return document.getElementById("tm-linea-modal");
}

function hhmmNow(date = new Date()) {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function showLineaModal(linea, now = new Date()) {
  const modalEl = ensureTransportModal();
  const titleEl = modalEl.querySelector("#tm-linea-modal-title");
  const bodyEl = modalEl.querySelector("#tm-linea-modal-body");

  const code = linea?.codigo || "";
  const name = linea?.nombre ? ` - ${linea.nombre}` : "";

  const isOp = isLineOperatingNow(linea, now);

  titleEl.textContent = `🚌 ${code}${name}`;

  const scheduleHTML = formatLineScheduleHTML(linea);

  if (!isOp) {
    bodyEl.innerHTML = `
      <div class="alert alert-warning py-2 mb-2">
        ⛔ <b>Fuera de servicio ahora</b><br>
        Hora actual: <b>${hhmmNow(now)}</b>
      </div>

      <div class="p-2 border rounded">
        ${scheduleHTML}
      </div>
    `;
  } else {
    bodyEl.innerHTML = `
      <div class="alert alert-success py-2 mb-2">
        ✅ <b>Operativa ahora</b><br>
        Hora actual: <b>${hhmmNow(now)}</b>
      </div>

      <div class="p-2 border rounded">
        ${scheduleHTML}
      </div>
    `;
  }

  const modal = window.bootstrap?.Modal?.getOrCreateInstance(modalEl, {
    backdrop: true,
    keyboard: true
  });
  modal?.show();
}

/* =====================================================
   LIMPIEZA
===================================================== */
export function clearTransportLayers() {
  stopPopupLiveUpdate();
  clearTransportState();
}

/* =====================================================
   CARGAR LÍNEAS (URBANO)
===================================================== */
export async function cargarLineasTransporte(tipo, container, ctx = {}) {
  container.innerHTML = "";
  clearTransportLayers();

  if (!tipo) return;

  const lineas = await getLineasByTipo(tipo, ctx);

  if (!lineas.length) {
    container.innerHTML = "<p>No hay líneas disponibles</p>";
    return;
  }

  container.innerHTML = `
    <select id="select-linea" class="form-select mb-2">
      <option value="">Seleccione línea</option>
    </select>
    <div id="linea-extra"></div>
  `;

  const selectLinea = container.querySelector("#select-linea");

  lineas
    .sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0))
    .forEach(l => {
      selectLinea.innerHTML += `<option value="${l.codigo}">${l.nombre}</option>`;
    });

  let currentLineaSel = null;
  let sentidosCache = [];
  let currentSentido = "";
  let currentCobertura = "";

  container.onchange = async (ev) => {
    const target = ev.target;
    if (!target || !target.id) return;

    const now = (ctx?.now instanceof Date) ? ctx.now : new Date();

    if (target.id === "select-linea") {
      const codigo = target.value;
      const linea = lineas.find(l => l.codigo === codigo);

      clearTransportLayers();
      const extraWrap = container.querySelector("#linea-extra");
      if (extraWrap) extraWrap.innerHTML = "";

      currentLineaSel = linea || null;
      currentSentido = "";
      currentCobertura = "";

      if (!linea) return;

      showLineaModal(linea, now);

      const needsSentido = ["l3", "l4", "l5"].includes(normStr(linea.codigo));
      if (!needsSentido) {
        await mostrarRutaLinea(linea, {}, ctx);
        return;
      }

      const paradas = await getParadasByLinea(linea.codigo, ctx);

      sentidosCache = [...new Set(
        paradas.map(p => titleCase(normStr(p.sentido))).filter(Boolean)
      )].filter(Boolean).sort();

      if (!sentidosCache.length) {
        await mostrarRutaLinea(linea, {}, ctx);
        return;
      }

      renderLineaExtraControls(container, {
        sentidos: sentidosCache,
        showCobertura: false,
        coberturas: [],
      });
      return;
    }

    if (!currentLineaSel) return;

    const isL5 = normStr(currentLineaSel.codigo) === "l5";

    if (target.id === "select-sentido") {
      const sentidoSel = titleCase(normStr(target.value));

      clearTransportLayers();
      currentSentido = sentidoSel;
      currentCobertura = "";

      if (!sentidoSel) {
        renderLineaExtraControls(container, {
          sentidos: sentidosCache,
          showCobertura: false,
          coberturas: [],
        });
        return;
      }

      if (!isL5) {
        await mostrarRutaLinea(currentLineaSel, { sentido: currentSentido }, ctx);
        return;
      }

      renderLineaExtraControls(container, {
        sentidos: sentidosCache,
        showCobertura: true,
        coberturas: ["Interna", "Externa"],
      });

      const selSentido2 = container.querySelector("#select-sentido");
      if (selSentido2) selSentido2.value = currentSentido;

      const selCob = container.querySelector("#select-cobertura");
      if (selCob) selCob.value = "";

      return;
    }

    if (target.id === "select-cobertura") {
      if (!isL5) return;

      const covSel = normCobertura(target.value);

      clearTransportLayers();
      currentCobertura = covSel;

      if (!currentSentido || !currentCobertura) return;

      await mostrarRutaLinea(currentLineaSel, {
        sentido: currentSentido,
        cobertura: currentCobertura,
      }, ctx);

      return;
    }
  };
}

/* =====================================================
   MOSTRAR RUTA (URBANO) - modo "ver línea completa"
===================================================== */
export async function mostrarRutaLinea(linea, opts = {}, ctx = {}) {
  clearTransportLayers();
  setCurrentLinea(linea);

  const sentidoSel = titleCase(normStr(opts.sentido));
  const coberturaSel = normCobertura(opts.cobertura);

  const paradasAll = await getParadasByLinea(linea.codigo, ctx);

  let paradas = paradasAll;
  if (sentidoSel) {
    paradas = paradas.filter(p => titleCase(normStr(p.sentido)) === sentidoSel);
  }

  const isL5 = normStr(linea.codigo) === "l5";
  if (isL5 && coberturaSel) {
    const byOrder = new Map();
    paradas.forEach(p => {
      const o = Number(p.orden);
      if (!Number.isFinite(o)) return;
      if (!byOrder.has(o)) byOrder.set(o, []);
      byOrder.get(o).push(p);
    });

    const ordenes = [...byOrder.keys()].sort((a, b) => a - b);
    const finalParadas = [];

    for (const o of ordenes) {
      const group = byOrder.get(o) || [];
      const pickCob = group.find(p => normCobertura(p.cobertura) === coberturaSel);
      const pickNorm = group.find(p => normCobertura(p.cobertura) === "Normal");
      const chosen = pickCob || pickNorm || group[0];
      if (chosen) finalParadas.push(chosen);
    }

    paradas = finalParadas;
  }

  if (!paradas.length) return;

  paradas.sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0));

  setCurrentParadas(paradas);
  setCurrentStopOffsets(computeStopOffsets(paradas, linea));

  const layerParadas = L.layerGroup().addTo(map);
  setStopsLayer(layerParadas);

  const stopMarkers = [];
  const coordsStops = [];

  paradas.forEach(p => {
    const { latitude, longitude } = p.ubicacion || {};
    if (typeof latitude !== "number" || typeof longitude !== "number") return;

    const latlng = [latitude, longitude];
    coordsStops.push(latlng);

    const marker = L.circleMarker(latlng, {
      radius: 6,
      color: linea.color || "#000",
      fillOpacity: 0.9,
    })
      .addTo(layerParadas)
      .bindPopup(buildStopPopupHTML(p, linea), { autoPan: true });

    marker.on("popupopen", () => {
      marker.setPopupContent(buildStopPopupHTML(p, linea));
      startPopupLiveUpdate(marker, p);
    });

    marker.on("popupclose", () => stopPopupLiveUpdate());

    stopMarkers.push({ marker, parada: p });
  });

  setCurrentStopMarkers(stopMarkers);

  if (coordsStops.length < 2) return;

  const codigo = normStr(linea.codigo);
  const esLineaCerrada = (codigo === "l1" || codigo === "l2");
  const debeCerrar = esLineaCerrada && !sentidoSel;
  if (debeCerrar) coordsStops.push(coordsStops[0]);

  const lineLayer = await drawLineRouteFollowingStreets(coordsStops, linea.color || "#000");
  setRouteLayer(lineLayer);

  if (lineLayer) map.fitBounds(lineLayer.getBounds());

  resaltarYConectarParadaMasCercana(paradas, linea);
}

function resaltarYConectarParadaMasCercana(paradas, linea) {
  const user = getUserLocation();
  if (!user) return;

  let nearest = null;
  let minDist = Infinity;

  paradas.forEach(p => {
    const { latitude, longitude } = p.ubicacion || {};
    if (typeof latitude !== "number" || typeof longitude !== "number") return;

    const d = map.distance(user, [latitude, longitude]);
    if (d < minDist) {
      minDist = d;
      nearest = p;
    }
  });

  if (!nearest) return;

  const markers = getCurrentStopMarkers();
  const found = markers.find(x => Number(x.parada.orden) === Number(nearest.orden));
  if (!found) return;

  resetNearestHighlight();
  setNearestHighlight(found.marker);

  found.marker.bindPopup(buildStopPopupHTML(nearest, linea));

  const stopLatLng = [nearest.ubicacion.latitude, nearest.ubicacion.longitude];
  drawDashedAccessRoute(user, stopLatLng, "#666");
}

/* =====================================================
   🚌 MODO BUS: planner URBANO
===================================================== */
async function drawWalkOSRM(layerGroup, fromLatLng, toLatLng) {
  const profile = "foot";
  const url =
    `https://router.project-osrm.org/route/v1/${profile}/` +
    `${fromLatLng[1]},${fromLatLng[0]};${toLatLng[1]},${toLatLng[0]}?overview=full&geometries=geojson`;

  const res = await fetch(url);
  const data = await res.json();
  if (!data.routes?.length) return null;

  const route = data.routes[0];
  const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);
  const line = L.polyline(coords, { weight: 4, dashArray: "6 10" }).addTo(layerGroup);

  return { line, route };
}

function pathStopsToLatLngs(pathStops) {
  const out = [];
  for (const s of (Array.isArray(pathStops) ? pathStops : [])) {
    const u = s?.ubicacion;
    if (!u) continue;
    const { latitude, longitude } = u;
    if (typeof latitude !== "number" || typeof longitude !== "number") continue;
    out.push([latitude, longitude]);
  }
  return out;
}

export async function planAndShowBusStopsForPlace(userLoc, destPlace, ctx = {}, ui = {}) {
  if (!userLoc || !destPlace?.ubicacion) return null;

  // ✅ GEO check (igual que selects)
  if (!geoMatches(ctx, destPlace)) {
    if (ui?.infoEl && !ctx?.dryRun) {
      ui.infoEl.innerHTML = `
        <div class="alert alert-info py-2 mb-0">
          ℹ️ Este destino no coincide con el filtro actual (provincia/cantón/parroquia),
          por eso el modo <b>bus</b> no se habilita aquí.
        </div>
      `;
    }
    return null;
  }

  if (!ctx?.preserveLayers) {
    clearTransportLayers();
  }

  const now = (ctx?.now instanceof Date) ? ctx.now : new Date();
  const destLoc = [destPlace.ubicacion.latitude, destPlace.ubicacion.longitude];

  // ====== 1) Cargar líneas urbanas ======
  let lineasAll = await getLineasByTipo("urbano", ctx);
  lineasAll = Array.isArray(lineasAll) ? lineasAll : [];

  // ✅ Proaño / Río Blanco => SOLO Línea 5
  const isProanoOrRioBlanco = () => {
    const pCtx = normLite(ctx?.parroquia);
    const pDest = normLite(destPlace?.parroquia);
    const cCtx = normLite(ctx?.canton);
    const cDest = normLite(destPlace?.canton || destPlace?.ciudad);

    const hayProano = (pCtx.includes("proa") || pDest.includes("proa") || cCtx.includes("proa") || cDest.includes("proa"));
    const hayRioBlanco =
      (pCtx.includes("rio blanco") || pDest.includes("rio blanco") || cCtx.includes("rio blanco") || cDest.includes("rio blanco")) ||
      (pCtx.includes("río blanco") || pDest.includes("río blanco") || cCtx.includes("río blanco") || cDest.includes("río blanco"));

    return hayProano || hayRioBlanco;
  };

  if (isProanoOrRioBlanco()) {
    lineasAll = lineasAll.filter(l => normStr(l?.codigo) === "l5");
  }

  if (!lineasAll.length) {
    if (ui?.infoEl && !ctx?.dryRun) ui.infoEl.innerHTML = "❌ No hay líneas urbanas disponibles.";
    return null;
  }

  // ====== 2) ✅ NUEVO: Filtrar por líneas operativas ahora ======
  const requireOpNow = (ctx?.requireOperatingNow !== false); // default true
  let lineas = [...lineasAll];

  if (requireOpNow) {
    const operativas = lineasAll.filter(l => l?.activo && isLineOperatingNow(l, now));

    if (operativas.length) {
      lineas = operativas;
    } else {
      // fallback: no hay operativas ahora => usamos todas (para no quedarnos sin ruta)
      lineas = [...lineasAll];

      // opcional: aviso (solo si NO es dryRun)
      if (ui?.infoEl && !ctx?.dryRun) {
        ui.infoEl.innerHTML = `
          <div class="alert alert-warning py-2 mb-2">
            ⚠️ No hay líneas urbanas marcadas como <b>operativas ahora</b>.
            Se calculará la mejor ruta registrada (puede no estar disponible en este momento).
          </div>
        `;
      }
    }
  }

  // ====== 3) Tu lógica original de scoring ======
  const BOARD_STEPS = [25, 100, 150, 250, 350, 450, 550, 650, 800, 1000, 1200, 1300];
  const DEST_STEPS  = [100, 150, 250, 350, 450, 550, 650];
  const LEVELS = Math.max(BOARD_STEPS.length, DEST_STEPS.length);

  const BASE = { wWalk1: 1.2, wWalk2: 1.6, wBus: 1.0, wStops: 25 };
  const CIRC = { wWalk1: 1.2, wWalk2: 1.6, wBus: 1.25, wStops: 45 };

  const MAX_LOOP_RATIO = 0.65;

  let best = null;
  let bestLinea = null;
  let bestParadas = null;

  for (let level = 0; level < LEVELS; level++) {
    const maxWalkToBoard = BOARD_STEPS[Math.min(level, BOARD_STEPS.length - 1)];
    const maxWalkToDest  = DEST_STEPS[Math.min(level, DEST_STEPS.length - 1)];

    let levelBest = null;
    let levelBestLinea = null;
    let levelBestParadas = null;
    let levelBestScore = Infinity;

    for (const linea of lineas) {
      const paradasAll = await getParadasByLinea(linea.codigo, ctx);
      if (!paradasAll?.length) continue;

      const origen = String(linea?.origen || "").toLowerCase();
      const codigo = normStr(linea.codigo);

      const isCirculacion = (origen === "circulacion" || codigo === "l1" || codigo === "l2");
      const isCircularOneWay = isCirculacion;

      const W = isCirculacion ? CIRC : BASE;

      const plan = planLineBoardAlightByOrder({
        userLoc,
        destLoc,
        stops: paradasAll,
        isCircularOneWay,

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

      if (isCirculacion) {
        const total = paradasAll.length;
        if (total >= 10) {
          const ratio = plan.metrics.stopsCount / total;
          if (ratio > MAX_LOOP_RATIO) continue;
        }
      }

      const score = plan.score;

      const better =
        score < levelBestScore ||
        (levelBest && Math.abs(score - levelBestScore) < 80 &&
          Math.max(plan.metrics.walk1, plan.metrics.walk2) < Math.max(levelBest.metrics.walk1, levelBest.metrics.walk2));

      const tieCirculationBetter =
        levelBest &&
        (String(levelBestLinea?.origen || "").toLowerCase() === "circulacion") &&
        isCirculacion &&
        Math.abs(score - levelBestScore) < 120 &&
        plan.metrics.stopsCount < levelBest.metrics.stopsCount;

      if (better || tieCirculationBetter) {
        levelBestScore = score;
        levelBest = plan;
        levelBestLinea = linea;
        levelBestParadas = paradasAll;
      }
    }

    if (levelBest && levelBestLinea && levelBestParadas) {
      best = levelBest;
      bestLinea = levelBestLinea;
      bestParadas = levelBestParadas;
      break;
    }
  }

  if (!best || !bestLinea || !bestParadas) {
    if (ui?.infoEl && !ctx?.dryRun) ui.infoEl.innerHTML = "❌ No se encontró una línea adecuada (paradas cercanas).";
    return null;
  }

  if (ctx?.dryRun) {
    return {
      tipo: "urbano",
      linea: bestLinea,
      plan: best,
      metrics: best.metrics || {
        walk1: best?.metrics?.walk1 || 0,
        walk2: best?.metrics?.walk2 || 0,
        stopsCount: best?.metrics?.stopsCount || 0
      },
      score: Number.isFinite(best.score) ? best.score : best?.score
    };
  }

  // ====== DIBUJAR ======
  setCurrentLinea(bestLinea);
  bestParadas.sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0));
  setCurrentParadas(bestParadas);
  setCurrentStopOffsets(computeStopOffsets(bestParadas, bestLinea));

  setRouteLayer(null);

  const layerStops = L.layerGroup().addTo(map);
  setStopsLayer(layerStops);

  const walkLayer = L.layerGroup().addTo(map);
  setAccessLayer(walkLayer);

  const boardLL = [best.boardStop.ubicacion.latitude, best.boardStop.ubicacion.longitude];
  const alightLL = [best.alightStop.ubicacion.latitude, best.alightStop.ubicacion.longitude];

  // dibujar tramo bus siguiendo calles (subida -> bajada)
  try {
    const tramoLatLngs = pathStopsToLatLngs(best.pathStops);
    if (tramoLatLngs.length >= 2) {
      const color = bestLinea.color || "#0d6efd";
      const lineLayer = await drawLineRouteFollowingStreets(tramoLatLngs, color);
      setRouteLayer(lineLayer);
    }
  } catch (e) {
    console.warn("No se pudo dibujar la línea del tramo bus (urbano):", e);
  }

  if (Array.isArray(best.pathStops) && best.pathStops.length) {
    best.pathStops.forEach(p => {
      const { latitude, longitude } = p.ubicacion || {};
      if (typeof latitude !== "number" || typeof longitude !== "number") return;

      const isBoard = Number(p.orden) === Number(best.boardStop.orden);
      const isAlight = Number(p.orden) === Number(best.alightStop.orden);
      if (isBoard || isAlight) return;

      const mk = L.circleMarker([latitude, longitude], {
        radius: 5,
        color: bestLinea.color || "#000",
        fillOpacity: 0.6,
        weight: 2
      })
        .addTo(layerStops)
        .bindPopup(buildStopPopupHTML(p, bestLinea), { autoPan: true });

      mk.on("popupopen", () => {
        mk.setPopupContent(buildStopPopupHTML(p, bestLinea));
        startPopupLiveUpdate(mk, p);
      });
      mk.on("popupclose", stopPopupLiveUpdate);
    });
  }

  const boardMarker = L.circleMarker(boardLL, {
    radius: 10, color: "#2e7d32", fillColor: "#2e7d32", fillOpacity: 1, weight: 3
  })
    .addTo(layerStops)
    .bindPopup(`<div><b>✅ Subir aquí</b><br>${buildStopPopupHTML(best.boardStop, bestLinea)}</div>`, { autoPan: true });

  const alightMarker = L.circleMarker(alightLL, {
    radius: 10, color: "#c62828", fillColor: "#c62828", fillOpacity: 1, weight: 3
  })
    .addTo(layerStops)
    .bindPopup(`<div><b>⛔ Bajar aquí</b><br>${buildStopPopupHTML(best.alightStop, bestLinea)}</div>`, { autoPan: true });

  boardMarker.on("popupopen", () => {
    boardMarker.setPopupContent(`<div><b>✅ Subir aquí</b><br>${buildStopPopupHTML(best.boardStop, bestLinea)}</div>`);
    startPopupLiveUpdate(boardMarker, best.boardStop);
  });
  alightMarker.on("popupopen", () => {
    alightMarker.setPopupContent(`<div><b>⛔ Bajar aquí</b><br>${buildStopPopupHTML(best.alightStop, bestLinea)}</div>`);
    startPopupLiveUpdate(alightMarker, best.alightStop);
  });
  boardMarker.on("popupclose", stopPopupLiveUpdate);
  alightMarker.on("popupclose", stopPopupLiveUpdate);

  const w1 = await drawWalkOSRM(walkLayer, userLoc, boardLL);
  const w2 = await drawWalkOSRM(walkLayer, alightLL, destLoc);

  if (ui?.infoEl) {
    const walk1m = w1?.route?.distance ? Math.round(w1.route.distance) : Math.round(best.metrics.walk1);
    const walk2m = w2?.route?.distance ? Math.round(w2.route.distance) : Math.round(best.metrics.walk2);

    const warnWalkMeters = 2300;
    const totalWalk = walk1m + walk2m;

    const warnHTML = (totalWalk >= warnWalkMeters)
      ? `<div class="alert alert-warning py-2 mt-2 mb-0">
           ⚠️ Se encontró ruta pero requiere caminar ~${(totalWalk / 1000).toFixed(1)} km.
         </div>`
      : "";

    ui.infoEl.innerHTML = `
      <b>Ruta (bus)</b><br>
      🚌 Línea: <b>${bestLinea.codigo}</b> ${bestLinea.nombre ? `- ${bestLinea.nombre}` : ""}<br>
      🧭 Sentido: ${best.direction}<br>
      🚶 Camina a subir: ${walk1m} m<br>
      🚍 Tramo bus (aprox): ${(best.metrics.busDist / 1000).toFixed(2)} km<br>
      🛑 Paradas aprox.: ${best.metrics.stopsCount}<br>
      🚶 Camina al destino: ${walk2m} m
      ${warnHTML}
    `;
  }

  map.fitBounds(L.latLngBounds([userLoc, destLoc, boardLL, alightLL]).pad(0.2));
  return { tipo: "urbano", linea: bestLinea, plan: best, metrics: best.metrics, score: best.score };
}