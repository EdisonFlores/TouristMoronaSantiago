// js/transport/rural/rural_controller.js
import { map, drawRouteBetweenPoints } from "../../map/map.js";

import { renderLineaExtraControls } from "../core/transport_ui.js";
import {
  getLineasByTipo,
  getParadasByLinea,
  normStr,
  titleCase,
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
  setAccessLayer
} from "../core/transport_state.js";

/* =====================================================
   LIMITES (RURAL)
===================================================== */
const RURAL_BOARD_STEPS = [150, 300, 500, 800, 1000, 1200, 1500, 2000, 2600, 3200];
const RURAL_DEST_STEPS  = [250, 450, 650, 900, 1200, 1500, 2000, 2600, 3200];

const LEVELS_RURAL = Math.max(RURAL_BOARD_STEPS.length, RURAL_DEST_STEPS.length);
const EXAGGERATED_WALK_WARN_M = 2300;

// ✅ si la parada más cercana está a más de 1km,
// NO caminar hasta la parada, enganchar a la ruta
const MAX_WALK_TO_STOP_M = 1000;

// ✅ si caminata al destino es demasiado grande -> bajar en finderuta y luego AUTO
const MAX_WALK_TO_DEST_M = 1500; // ajustable

/* =====================================================
   MODAL (Bootstrap)
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
              ℹ️ <b>Nota:</b> horarios, tiempos y “próximo bus” son <b>aproximados</b>.
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

  bodyEl.innerHTML = `
    <div class="alert ${isOp ? "alert-success" : "alert-warning"} py-2 mb-2">
      ${isOp ? "✅ <b>Operativa</b>" : "⛔ <b>Fuera de servicio</b>"}<br>
      Hora actual: <b>${hhmmNow(now)}</b>
    </div>
    <div class="p-2 border rounded">${scheduleHTML}</div>
  `;

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
   HELPERS GEOM
===================================================== */
function getParadaLatLng(p) {
  const { latitude, longitude } = p?.ubicacion || {};
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  return [latitude, longitude];
}

function isMarcadorVisible(p) {
  const d = String(p?.denominacion || "").toLowerCase().trim();
  return d === "parada";
}

function parseCodigoParts(codigo) {
  const c = String(codigo || "").trim().toLowerCase();
  const m = c.match(/^([a-z_]+?)(\d+)$/);
  if (!m) return { prefix: c, num: null };
  return { prefix: m[1], num: Number(m[2]) };
}

function getNumeral(p) {
  const n = Number(p?.numeral);
  if (Number.isFinite(n)) return n;

  const o = Number(p?.orden);
  if (Number.isFinite(o)) return o;

  const { num } = parseCodigoParts(p?.codigo);
  return Number.isFinite(num) ? num : Infinity;
}

function getPrefix(p) {
  const { prefix } = parseCodigoParts(p?.codigo);
  return String(prefix || "").toLowerCase().trim();
}

function sortByNumeralStable(arr) {
  return [...arr].sort((a, b) => {
    const na = getNumeral(a);
    const nb = getNumeral(b);
    if (na !== nb) return na - nb;
    return String(a?.codigo || "").localeCompare(String(b?.codigo || ""));
  });
}

/**
 * Orden exacto por prefijos:
 * IDA: pfi -> pfis -> prism -> resto
 * VUELTA: prvsm -> pfvsm/pfvs -> pfv -> resto
 */
function buildOrderedStopsForLinea(paradasAll, sentido) {
  const s = normStr(sentido);

  const byPrefix = new Map();
  for (const p of paradasAll) {
    const pref = getPrefix(p);
    if (!byPrefix.has(pref)) byPrefix.set(pref, []);
    byPrefix.get(pref).push(p);
  }

  const orderIda = ["pfi", "pfis", "prism"];
  const orderVuelta = ["prvsm", "pfvsm", "pfvs", "pfv"];
  const wanted = (s === "vuelta") ? orderVuelta : orderIda;

  const out = [];

  for (const pref of wanted) {
    const group = byPrefix.get(pref);
    if (!group?.length) continue;
    out.push(...sortByNumeralStable(group));
    byPrefix.delete(pref);
  }

  const restPrefixes = [...byPrefix.keys()].sort((a, b) => a.localeCompare(b));
  for (const pref of restPrefixes) {
    const group = byPrefix.get(pref);
    if (!group?.length) continue;
    out.push(...sortByNumeralStable(group));
  }

  const seen = new Set();
  const final = [];
  for (const p of out) {
    const key = String(p?.codigo || "").trim();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    final.push(p);
  }
  return final;
}

/**
 * finderuta=true SOLO en VUELTA
 */
function cutStopsAtFinDeRuta(paradas, sentidoLower) {
  if (!Array.isArray(paradas) || !paradas.length) return [];
  if (normStr(sentidoLower) !== "vuelta") return paradas;

  const idx = paradas.findIndex(p => p?.finderuta === true);
  if (idx === -1) return paradas;
  return paradas.slice(0, idx + 1);
}

function distMeters(a, b) {
  return map.distance(a, b);
}

function findNearestCoordOnPath(userLoc, coords) {
  let best = null;
  let min = Infinity;
  for (const ll of coords) {
    const d = distMeters(userLoc, ll);
    if (d < min) {
      min = d;
      best = ll;
    }
  }
  return best ? { ll: best, d: min } : null;
}

function findNearestStop(userLoc, stops) {
  let best = null;
  let min = Infinity;
  for (const p of stops) {
    const ll = getParadaLatLng(p);
    if (!ll) continue;
    const d = distMeters(userLoc, ll);
    if (d < min) {
      min = d;
      best = p;
    }
  }
  return best ? { stop: best, ll: getParadaLatLng(best), d: min } : null;
}

function findNearestCoordIndex(coords, targetLL) {
  if (!coords?.length || !targetLL) return -1;
  let bestIdx = -1;
  let min = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = distMeters(coords[i], targetLL);
    if (d < min) {
      min = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/* =====================================================
   SENTIDO AUTO (IDA/VUELTA)
===================================================== */
function autoSentidoFromUserAndDestino({ userCanton, userParroquia, linea }) {
  const uC = normStr(userCanton);
  const uP = normStr(userParroquia);

  const origenC = normStr(linea?.cantonorigen);
  const origenP = normStr(linea?.parroquiaorigen);

  const userEnOrigen =
    (origenC && uC && origenC === uC) ||
    (origenP && uP && origenP === uP);

  if (!uC && !uP) return "ida";
  if (userEnOrigen) return "ida";
  return "vuelta";
}

/* =====================================================
   HORARIO: escoger línea con salida más cercana a "now"
===================================================== */
function parseHHMM(s) {
  const m = String(s || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

function nowMinutes(now = new Date()) {
  return now.getHours() * 60 + now.getMinutes();
}

function nextDepartureDeltaMin(linea, sentidoLower, now = new Date()) {
  const cur = nowMinutes(now);

  const ida = Array.isArray(linea?.horario_ida) ? linea.horario_ida : [];
  const ret = Array.isArray(linea?.horario_retorno) ? linea.horario_retorno : [];

  const arr = (normStr(sentidoLower) === "vuelta") ? ret : ida;
  const times = arr.map(parseHHMM).filter(v => v != null).sort((a, b) => a - b);

  if (!times.length) return 9999;

  for (const t of times) {
    if (t >= cur) return (t - cur);
  }
  return (24 * 60 - cur) + times[0];
}

/* =====================================================
   CARGAR LÍNEAS (RURAL) - selector "Líneas de transporte"
===================================================== */
export async function cargarLineasTransporte(tipo, container, ctx = {}) {
  container.innerHTML = "";
  clearTransportLayers();

  const t = String(tipo || "").toLowerCase();
  if (t !== "rural") return;

  const now = (ctx?.now instanceof Date) ? ctx.now : new Date();

  const lineas = await getLineasByTipo("rural", {
    ...ctx,
    ignoreGeoFilter: ctx?.ignoreGeoFilter === true || ctx?.specialSevilla === true
  });

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
      selectLinea.innerHTML += `<option value="${l.codigo}">${l.codigo} - ${l.nombre}</option>`;
    });

  let currentLineaSel = null;
  let sentidosCache = ["Ida", "Vuelta"];
  let currentSentido = "";

  container.onchange = async (ev) => {
    const target = ev.target;
    if (!target || !target.id) return;

    if (target.id === "select-linea") {
      const codigo = target.value;
      const linea = lineas.find(l => l.codigo === codigo);

      clearTransportLayers();
      const extraWrap = container.querySelector("#linea-extra");
      if (extraWrap) extraWrap.innerHTML = "";

      currentLineaSel = linea || null;
      currentSentido = "";

      if (!linea) return;

      showLineaModal(linea, now);

      renderLineaExtraControls(container, {
        sentidos: sentidosCache,
        showCobertura: false,
        coberturas: [],
      });
      return;
    }

    if (!currentLineaSel) return;

    if (target.id === "select-sentido") {
      const sentidoSel = titleCase(normStr(target.value));

      clearTransportLayers();
      currentSentido = sentidoSel;

      if (!sentidoSel) {
        renderLineaExtraControls(container, {
          sentidos: sentidosCache,
          showCobertura: false,
          coberturas: [],
        });
        return;
      }

      await mostrarRutaLinea(currentLineaSel, { sentido: currentSentido }, ctx);
      return;
    }
  };
}

/* =====================================================
   MOSTRAR RUTA (RURAL) - línea completa (igual a tu base)
===================================================== */
export async function mostrarRutaLinea(linea, opts = {}, ctx = {}) {
  clearTransportLayers();
  setCurrentLinea(linea);

  const sentidoSel = titleCase(normStr(opts.sentido));
  const sentidoLower = normStr(sentidoSel);

  const paradasRaw = await getParadasByLinea(linea.codigo, {
    ...ctx,
    tipo: "rural",
    sentido: sentidoSel
  });

  if (!paradasRaw?.length) return;

  const ordered = buildOrderedStopsForLinea(paradasRaw, sentidoLower);
  const paradas = cutStopsAtFinDeRuta(ordered, sentidoLower);

  setCurrentParadas(paradas);
  setCurrentStopOffsets(computeStopOffsets(paradas, linea));

  const layerParadas = L.layerGroup().addTo(map);
  setStopsLayer(layerParadas);

  const routesGroup = L.layerGroup().addTo(map);
  setRouteLayer(routesGroup);

  const stopMarkers = [];
  const coords = [];

  for (const p of paradas) {
    const ll = getParadaLatLng(p);
    if (!ll) continue;

    coords.push(ll);

    if (!isMarcadorVisible(p)) continue;

    const marker = L.circleMarker(ll, {
      radius: 7,
      color: linea.color || "#000",
      fillOpacity: 0.9,
      weight: 2
    }).addTo(layerParadas);

    marker.bindPopup(buildStopPopupHTML(p, linea), { autoPan: true });

    marker.on("popupopen", () => {
      marker.setPopupContent(buildStopPopupHTML(p, linea));
      startPopupLiveUpdate(marker, p);
    });

    marker.on("popupclose", () => stopPopupLiveUpdate());

    stopMarkers.push({ marker, parada: p });
  }

  setCurrentStopMarkers(stopMarkers);

  if (coords.length < 2) return;

  const lineLayer = await drawLineRouteFollowingStreets(coords, linea.color || "#000");
  if (lineLayer) routesGroup.addLayer(lineLayer);

  map.fitBounds(L.latLngBounds(coords).pad(0.12));
}

/* =====================================================
   🚌 MODO BUS (RURAL)
   ✅ FIX MINIMOS:
   1) bajar en PARADA cercana al destino (si existe)
   2) pintar SOLO paradas del tramo real (no todas)
   3) si caminata al destino es muy grande -> finderuta + AUTO
   4) dashed doble visible (lo logra el fix en transport_osrm.js)
===================================================== */
function llKey(ll) {
  if (!ll) return "";
  return `${Number(ll[0]).toFixed(6)},${Number(ll[1]).toFixed(6)}`;
}

function buildIndexByLatLng(coords) {
  const m = new Map();
  for (let i = 0; i < coords.length; i++) {
    const k = llKey(coords[i]);
    if (!m.has(k)) m.set(k, i);
  }
  return m;
}

export async function planAndShowBusStopsForPlace(userLoc, destPlace, ctx = {}, ui = {}) {
  if (!userLoc || !destPlace?.ubicacion) return null;

  clearTransportLayers();

  const now = (ctx?.now instanceof Date) ? ctx.now : new Date();
  const destLoc = [destPlace.ubicacion.latitude, destPlace.ubicacion.longitude];

  const lineas = await getLineasByTipo("rural", { ...ctx, ignoreGeoFilter: true });

  if (!lineas?.length) {
    if (ui?.infoEl) ui.infoEl.innerHTML = "❌ No hay líneas rurales disponibles.";
    return null;
  }

  const walkLayer = L.layerGroup().addTo(map);
  setAccessLayer(walkLayer);

  const routesGroup = L.layerGroup().addTo(map);
  setRouteLayer(routesGroup);

  const layerStops = L.layerGroup().addTo(map);
  setStopsLayer(layerStops);

  let best = null;

  const W_TIME = 12; // peso horario

  for (let level = 0; level < LEVELS_RURAL; level++) {
    const maxBoard = RURAL_BOARD_STEPS[Math.min(level, RURAL_BOARD_STEPS.length - 1)];
    const maxDest  = RURAL_DEST_STEPS[Math.min(level, RURAL_DEST_STEPS.length - 1)];

    for (const linea of lineas) {
      if (!linea?.activo) continue;

      const sentidoAuto = autoSentidoFromUserAndDestino({
        userCanton: ctx?.canton,
        userParroquia: ctx?.parroquia,
        linea
      });
      const sentidoLower = normStr(sentidoAuto);

      const paradasRaw = await getParadasByLinea(linea.codigo, {
        ...ctx,
        tipo: "rural",
        sentido: sentidoAuto
      });
      if (!paradasRaw?.length) continue;

      const ordered = buildOrderedStopsForLinea(paradasRaw, sentidoLower);
      const paradas = cutStopsAtFinDeRuta(ordered, sentidoLower);

      const coords = paradas.map(getParadaLatLng).filter(Boolean);
      if (coords.length < 2) continue;

      const visibles = paradas.filter(isMarcadorVisible);

      // SUBIR
      const nearestStopUser = findNearestStop(userLoc, visibles);
      const nearestCoordUser = findNearestCoordOnPath(userLoc, coords);

      let boardLL = null;
      let boardDist = Infinity;
      let boardLabel = "";

      if (nearestStopUser && nearestStopUser.d <= maxBoard && nearestStopUser.d <= MAX_WALK_TO_STOP_M) {
        boardLL = nearestStopUser.ll;
        boardDist = nearestStopUser.d;
        boardLabel = "Parada";
      } else if (nearestCoordUser && nearestCoordUser.d <= maxBoard) {
        boardLL = nearestCoordUser.ll;
        boardDist = nearestCoordUser.d;
        boardLabel = "Punto de la ruta";
      } else {
        continue;
      }

      const idxBoard = findNearestCoordIndex(coords, boardLL);
      if (idxBoard < 0) continue;

      // BAJAR: ✅ PRIORIDAD A PARADA
      const nearestStopDest = findNearestStop(destLoc, visibles);
      const nearestCoordDest = findNearestCoordOnPath(destLoc, coords);

      let alightLL = null;
      let alightDistToDest = Infinity;
      let alightLabel = "";

      if (nearestStopDest && nearestStopDest.d <= maxDest) {
        alightLL = nearestStopDest.ll;
        alightDistToDest = nearestStopDest.d;
        alightLabel = "Parada";
      } else if (nearestCoordDest && nearestCoordDest.d <= maxDest) {
        alightLL = nearestCoordDest.ll;
        alightDistToDest = nearestCoordDest.d;
        alightLabel = "Punto de la ruta";
      } else {
        continue;
      }

      // ✅ si caminata al destino es demasiado grande => fin de ruta (finderuta) + auto
      let useAuto = false;
      let finLL = null;

      if (alightDistToDest > MAX_WALK_TO_DEST_M && sentidoLower === "vuelta") {
        const last = paradas[paradas.length - 1];
        if (last?.finderuta === true) {
          finLL = getParadaLatLng(last);
          if (finLL) {
            useAuto = true;
            alightLL = finLL;
            alightLabel = "Fin de ruta (finderuta)";
          }
        }
      }

      const idxAlight = findNearestCoordIndex(coords, alightLL);
      if (idxAlight < 0) continue;

      const fromIdx = Math.min(idxBoard, idxAlight);
      const toIdx = Math.max(idxBoard, idxAlight);

      const tramoCoords = coords.slice(fromIdx, toIdx + 1);
      if (tramoCoords.length < 2) continue;

      let tramoDist = 0;
      for (let i = 1; i < tramoCoords.length; i++) tramoDist += distMeters(tramoCoords[i - 1], tramoCoords[i]);

      const dtMin = nextDepartureDeltaMin(linea, sentidoLower, now);

      const extra = useAuto ? 0 : alightDistToDest;
      const score = boardDist + extra + tramoDist + (dtMin * W_TIME);

      const cand = {
        linea,
        sentido: sentidoAuto,
        sentidoLower,
        paradas,
        coords,
        visibles,

        boardLL,
        boardDist,
        boardLabel,
        idxBoard,

        alightLL,
        alightLabel,
        idxAlight,

        tramoCoords,
        fromIdx,
        toIdx,

        walkToDest: alightDistToDest,
        useAuto,
        dtMin,
        score
      };

      if (!best || cand.score < best.score) best = cand;
    }

    if (best) break;
  }

  if (!best) {
    if (ui?.infoEl) {
      ui.infoEl.innerHTML = `
        <div class="alert alert-warning py-2 mb-2">
          ❌ No se encontró una ruta rural cercana con límites razonables.
        </div>
      `;
    }
    return null;
  }

  // ======= pintar resultado =======
  setCurrentLinea(best.linea);
  setCurrentParadas(best.paradas);
  setCurrentStopOffsets(computeStopOffsets(best.paradas, best.linea));

  // ✅ pintar SOLO paradas dentro del tramo real
  const idxMap = buildIndexByLatLng(best.coords);

  const stopMarkers = [];
  for (const p of best.paradas) {
    if (!isMarcadorVisible(p)) continue;

    const ll = getParadaLatLng(p);
    if (!ll) continue;

    const idx = idxMap.get(llKey(ll));
    if (idx == null) continue;

    if (idx < best.fromIdx || idx > best.toIdx) continue;

    const marker = L.circleMarker(ll, {
      radius: 7,
      color: best.linea.color || "#000",
      fillOpacity: 0.9,
      weight: 2
    }).addTo(layerStops);

    marker.bindPopup(buildStopPopupHTML(p, best.linea), { autoPan: true });
    marker.on("popupopen", () => {
      marker.setPopupContent(buildStopPopupHTML(p, best.linea));
      startPopupLiveUpdate(marker, p);
    });
    marker.on("popupclose", () => stopPopupLiveUpdate());

    stopMarkers.push({ marker, parada: p });
  }
  setCurrentStopMarkers(stopMarkers);

  // board / alight markers
  L.circleMarker(best.boardLL, {
    radius: 10, color: "#2e7d32", fillColor: "#2e7d32", fillOpacity: 1, weight: 3
  })
    .addTo(layerStops)
    .bindPopup(
      best.boardLabel === "Punto de la ruta"
        ? `<b>✅ Subir aquí</b><br>Punto sobre la ruta (paradas lejos)`
        : `<b>✅ Subir aquí</b><br>Parada cercana`
    );

  L.circleMarker(best.alightLL, {
    radius: 10, color: "#c62828", fillColor: "#c62828", fillOpacity: 1, weight: 3
  })
    .addTo(layerStops)
    .bindPopup(`<b>⛔ Bajar aquí</b><br>${best.alightLabel}`);

  // ✅ dashed 1 (usuario -> subir)
  await drawDashedAccessRoute(userLoc, best.boardLL, "#666");

  // ✅ ruta rural (tramo)
  const ruralLine = await drawLineRouteFollowingStreets(best.tramoCoords, best.linea.color || "#000");
  if (ruralLine) routesGroup.addLayer(ruralLine);

  // ✅ tramo final: caminar o auto
  if (best.useAuto) {
    await drawRouteBetweenPoints({
      from: best.alightLL,
      to: destLoc,
      mode: "driving",
      dashed: false
    });
  } else {
    // dashed 2 (bajar -> destino)
    await drawDashedAccessRoute(best.alightLL, destLoc, "#666");
  }

  const op = isLineOperatingNow(best.linea, now);
  const exagerated = (best.boardDist > EXAGGERATED_WALK_WARN_M || best.walkToDest > EXAGGERATED_WALK_WARN_M);

  if (ui?.infoEl) {
    ui.infoEl.innerHTML = `
      <b>Ruta (bus rural${best.useAuto ? " + auto" : ""})</b><br>
      🚌 Línea: <b>${best.linea.codigo}</b> - ${best.linea.nombre || ""}<br>
      🧭 Sentido: <b>${best.sentido}</b><br>
      ${op ? "✅ Operativa ahora" : "⛔ Fuera de servicio ahora"}<br>
      ${(() => {
  if (best.dtMin >= 9999) return `⏳ Próxima salida aprox.: <b>sin dato</b><br>`;
  const h = Math.floor(best.dtMin / 60);
  const m = best.dtMin % 60;
  const txt = (h > 0) ? `${h} h ${m} min` : `${m} min`;
  return `⏳ Próxima salida aprox.: <b>${txt}</b><br>`;
})()}

      🚶 Camina a subir (${best.boardLabel}): <b>${Math.round(best.boardDist)} m</b><br>
      ${best.useAuto
        ? `🏁 Bajar en: <b>${best.alightLabel}</b><br>🚗 Auto al destino.`
        : `🚶 Camina al destino (${best.alightLabel}): <b>${Math.round(best.walkToDest)} m</b>`}
      ${(!best.useAuto && exagerated)
        ? `<div class="alert alert-warning py-2 mt-2 mb-0">⚠️ Se encontró ruta pero requiere caminata grande.</div>`
        : ""}
    `;
  }

  map.fitBounds(L.latLngBounds([userLoc, destLoc, best.boardLL, best.alightLL]).pad(0.2));
  return { linea: best.linea, sentido: best.sentido, useAuto: best.useAuto };
}
