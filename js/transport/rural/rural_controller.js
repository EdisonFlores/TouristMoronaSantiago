// js/transport/rural/rural_controller.js
import { getUserLocation } from "../../app/state.js";
import { map } from "../../map/map.js";

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
  resetNearestHighlight,
  setNearestHighlight,
  getCurrentStopMarkers
} from "../core/transport_state.js";

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
   HELPERS
===================================================== */
function getParadaLatLng(p) {
  const { latitude, longitude } = p?.ubicacion || {};
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  return [latitude, longitude];
}

function isMarcadorVisible(p) {
  // ✅ SOLO marcadores para "parada"
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

function isLR1to14(linea) {
  const c = String(linea?.codigo || "").trim().toLowerCase();
  const m = c.match(/^lr(\d+)$/);
  if (!m) return false;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 1 && n <= 14;
}

function isPFVFromThreshold(p, threshold = 12) {
  const pref = getPrefix(p);
  const num = getNumeral(p);
  return pref === "pfv" && Number.isFinite(num) && num >= threshold;
}

/**
 * ✅ Orden exacto por prefijos:
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

  // quitar duplicados por código
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
 * ✅ CORTA la lista en el primer finderuta:true (incluye ese punto)
 */
function cutStopsAtFinDeRuta(paradas) {
  if (!Array.isArray(paradas) || !paradas.length) return [];
  const idx = paradas.findIndex(p => p?.finderuta === true);
  if (idx === -1) return paradas;
  return paradas.slice(0, idx + 1);
}

/* =====================================================
   CARGAR LÍNEAS (RURAL)
===================================================== */
export async function cargarLineasTransporte(tipo, container, ctx = {}) {
  container.innerHTML = "";
  clearTransportLayers();

  const t = String(tipo || "").toLowerCase();
  if (t !== "rural") return;

  const lineas = await getLineasByTipo("rural", ctx);

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
      sentidosCache = [];

      if (!linea) return;

      showLineaModal(linea, now);

      const allStops = await getParadasByLinea(linea.codigo, { ...ctx, tipo: "rural" });

      sentidosCache = [...new Set(
        allStops.map(p => titleCase(normStr(p.sentido))).filter(Boolean)
      )].filter(Boolean).sort();

      if (!sentidosCache.length) sentidosCache = ["Ida", "Vuelta"];

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
   MOSTRAR RUTA (RURAL)
   ✅ Marcadores: SOLO "parada"
   ✅ Ruta incluye referenciales (sin marcador)
   ✅ Ruta termina en finderuta:true
   ✅ split amarillo (vuelta lr1..lr14 desde pfv12)
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
  const paradas = cutStopsAtFinDeRuta(ordered);

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

    // ✅ SIEMPRE entra a la geometría (incluye referenciales)
    coords.push(ll);

    // ✅ marcador solo si denominacion="parada"
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

  const COLOR_BASE = linea.color || "#000";
  const COLOR_FINAL = "#FFD500";

  const applyYellowFromPFV12 = (sentidoLower === "vuelta") && isLR1to14(linea);

  if (!applyYellowFromPFV12) {
    const lineLayer = await drawLineRouteFollowingStreets(coords, COLOR_BASE);
    if (lineLayer) routesGroup.addLayer(lineLayer);

    map.fitBounds(L.latLngBounds(coords).pad(0.12));
    resaltarYConectarParadaMasCercana(stopMarkers, linea);
    return;
  }

  // split desde primera pfv>=12 (si existe)
  let cutIndex = -1;
  for (let i = 0; i < paradas.length; i++) {
    if (isPFVFromThreshold(paradas[i], 12)) {
      cutIndex = i;
      break;
    }
  }

  if (cutIndex === -1) {
    const lineLayer = await drawLineRouteFollowingStreets(coords, COLOR_BASE);
    if (lineLayer) routesGroup.addLayer(lineLayer);

    map.fitBounds(L.latLngBounds(coords).pad(0.12));
    resaltarYConectarParadaMasCercana(stopMarkers, linea);
    return;
  }

  const tramoBase = [];
  const tramoFinal = [];

  for (let i = 0; i < paradas.length; i++) {
    const ll = getParadaLatLng(paradas[i]);
    if (!ll) continue;

    if (i <= cutIndex) tramoBase.push(ll);
    if (i >= cutIndex) tramoFinal.push(ll);
  }

  if (tramoBase.length >= 2) {
    const baseLayer = await drawLineRouteFollowingStreets(tramoBase, COLOR_BASE);
    if (baseLayer) routesGroup.addLayer(baseLayer);
  }

  if (tramoFinal.length >= 2) {
    const finalLayer = await drawLineRouteFollowingStreets(tramoFinal, COLOR_FINAL);
    if (finalLayer) routesGroup.addLayer(finalLayer);
  }

  const allCoords = [...tramoBase, ...tramoFinal];
  if (allCoords.length) map.fitBounds(L.latLngBounds(allCoords).pad(0.12));

  resaltarYConectarParadaMasCercana(stopMarkers, linea);
}

function resaltarYConectarParadaMasCercana(stopMarkers, linea) {
  const user = getUserLocation();
  if (!user) return;

  let nearest = null;
  let minDist = Infinity;

  stopMarkers.forEach(({ parada }) => {
    const ll = getParadaLatLng(parada);
    if (!ll) return;

    const d = map.distance(user, ll);
    if (d < minDist) {
      minDist = d;
      nearest = parada;
    }
  });

  if (!nearest) return;

  const markers = getCurrentStopMarkers();
  const found = markers.find(x => String(x.parada.codigo) === String(nearest.codigo));
  if (!found) return;

  resetNearestHighlight();
  setNearestHighlight(found.marker);

  found.marker.bindPopup(buildStopPopupHTML(nearest, linea));

  const stopLatLng = [nearest.ubicacion.latitude, nearest.ubicacion.longitude];
  drawDashedAccessRoute(user, stopLatLng, "#666");
}

/* =====================================================
   🚌 MODO BUS (RURAL) pendiente
===================================================== */
export async function planAndShowBusStopsForPlace(userLoc, destPlace, ctx = {}, ui = {}) {
  if (ui?.infoEl) ui.infoEl.innerHTML = "ℹ️ Modo bus rural: pendiente de implementar.";
  return null;
}
