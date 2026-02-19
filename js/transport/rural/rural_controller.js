// js/transport/rural/rural_controller.js
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
  setAccessLayer,
  resetNearestHighlight,
  setNearestHighlight,
  getCurrentStopMarkers
} from "../core/transport_state.js";

import { getCollectionCache } from "../../app/cache_db.js";

/* =====================================================
   ✅ LIMITES (RURAL)
   Regla:
   - buscar primero con límites pequeños
   - si no hay ruta, ampliar
   - si termina con caminata exagerada, avisar
===================================================== */
const RURAL_BOARD_STEPS = [150, 300, 500, 800, 1000, 1200, 1500];
const RURAL_DEST_STEPS  = [250, 450, 650, 900, 1200, 1500];

const LEVELS_RURAL = Math.max(RURAL_BOARD_STEPS.length, RURAL_DEST_STEPS.length);
const EXAGGERATED_WALK_WARN_M = 2300;

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
   Regla:
   - Si usuario está en parroquia/cantón origen -> ida
   - Si usuario está fuera del origen -> vuelta
===================================================== */
function autoSentidoFromUserAndDestino({ userCanton, userParroquia, linea, destPlace }) {
  const uC = normStr(userCanton);
  const uP = normStr(userParroquia);

  const origenC = normStr(linea?.cantonorigen);
  const origenP = normStr(linea?.parroquiaorigen);

  // destino (si existe)
  const dC = normStr(destPlace?.canton || destPlace?.ciudad);
  const dP = normStr(destPlace?.parroquia);

  const userEnOrigen =
    (origenC && uC && origenC === uC) ||
    (origenP && uP && origenP === uP);

  // Si no hay info suficiente, default ida
  if (!uC && !uP) return "ida";

  // Si usuario está en origen y destino no está en origen => ida
  if (userEnOrigen) return "ida";

  // Si usuario está fuera del origen => vuelta
  return "vuelta";
}

/* =====================================================
   CARGAR LÍNEAS (RURAL)
===================================================== */
export async function cargarLineasTransporte(tipo, container, ctx = {}) {
  container.innerHTML = "";
  clearTransportLayers();

  const t = String(tipo || "").toLowerCase();
  if (t !== "rural") return;

  const now = (ctx?.now instanceof Date) ? ctx.now : new Date();

  // ✅ Sevilla o pedido explícito => traer todas (para que salgan las 20)
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

      // ✅ Modal al elegir línea rural
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
   MOSTRAR RUTA (RURAL) - igual que antes
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

  const COLOR_BASE = linea.color || "#000";
  const COLOR_FINAL = "#FFD500";

  const applyYellowFromPFV12 = (sentidoLower === "vuelta") && isLR1to14(linea);

  if (!applyYellowFromPFV12) {
    const lineLayer = await drawLineRouteFollowingStreets(coords, COLOR_BASE);
    if (lineLayer) routesGroup.addLayer(lineLayer);

    map.fitBounds(L.latLngBounds(coords).pad(0.12));
    return;
  }

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
}

/* =====================================================
   🚌 MODO BUS (RURAL) - IMPLEMENTADO
   - engancha a parada cercana si hay
   - si no hay, engancha a punto cercano de la ruta
   - dibuja: walk -> engancho, ruta -> fin, walk -> destino
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

export async function planAndShowBusStopsForPlace(userLoc, destPlace, ctx = {}, ui = {}) {
  if (!userLoc || !destPlace?.ubicacion) return null;

  clearTransportLayers();

  const now = (ctx?.now instanceof Date) ? ctx.now : new Date();
  const destLoc = [destPlace.ubicacion.latitude, destPlace.ubicacion.longitude];

  // ✅ traer líneas (Sevilla => todas)
  const lineas = await getLineasByTipo("rural", {
    ...ctx,
    ignoreGeoFilter: ctx?.ignoreGeoFilter === true || ctx?.specialSevilla === true
  });

  if (!lineas?.length) {
    if (ui?.infoEl) ui.infoEl.innerHTML = "❌ No hay líneas rurales disponibles.";
    return null;
  }

  // capas
  const walkLayer = L.layerGroup().addTo(map);
  setAccessLayer(walkLayer);

  const routesGroup = L.layerGroup().addTo(map);
  setRouteLayer(routesGroup);

  const layerStops = L.layerGroup().addTo(map);
  setStopsLayer(layerStops);

  let best = null;

  for (let level = 0; level < LEVELS_RURAL; level++) {
    const maxBoard = RURAL_BOARD_STEPS[Math.min(level, RURAL_BOARD_STEPS.length - 1)];
    const maxDest  = RURAL_DEST_STEPS[Math.min(level, RURAL_DEST_STEPS.length - 1)];

    for (const linea of lineas) {
      if (!linea?.activo) continue;

      // ✅ si quieres exigir operativa, ponlo aquí; por ahora NO bloqueamos,
      // solo informamos (porque tú preguntaste y pediste que funcione igual)
      const sentidoAuto = autoSentidoFromUserAndDestino({
        userCanton: ctx?.canton,
        userParroquia: ctx?.parroquia,
        linea,
        destPlace
      });

      const paradasRaw = await getParadasByLinea(linea.codigo, {
        ...ctx,
        tipo: "rural",
        sentido: sentidoAuto
      });

      if (!paradasRaw?.length) continue;

      const ordered = buildOrderedStopsForLinea(paradasRaw, sentidoAuto);
      const paradas = cutStopsAtFinDeRuta(ordered);

      const coords = paradas.map(getParadaLatLng).filter(Boolean);
      if (coords.length < 2) continue;

      // 1) intentar parada visible más cercana
      const visibles = paradas.filter(isMarcadorVisible);
      const nearestStop = findNearestStop(userLoc, visibles);

      // 2) si no hay parada cerca, enganchar a punto cercano de la ruta
      const nearestCoord = findNearestCoordOnPath(userLoc, coords);

      // candidato board
      let boardLL = null;
      let boardDist = Infinity;
      let boardLabel = "";

      if (nearestStop && nearestStop.d <= maxBoard) {
        boardLL = nearestStop.ll;
        boardDist = nearestStop.d;
        boardLabel = "Parada";
      } else if (nearestCoord && nearestCoord.d <= maxBoard) {
        boardLL = nearestCoord.ll;
        boardDist = nearestCoord.d;
        boardLabel = "Punto de la ruta";
      } else {
        continue;
      }

      // punto final / bajada: el más cercano al destino dentro de la ruta, o el final
      const idxNearDest = findNearestCoordIndex(coords, destLoc);
      if (idxNearDest < 0) continue;

      const nearDestLL = coords[idxNearDest];
      const walkToDest = distMeters(nearDestLL, destLoc);

      // si el destino queda demasiado lejos de la ruta en este nivel, probar ampliar
      if (walkToDest > maxDest) continue;

      // recorte de ruta desde board -> nearDest
      const idxBoard = findNearestCoordIndex(coords, boardLL);
      if (idxBoard < 0) continue;

      // sentido ya viene en paradas; si idxBoard > idxNearDest, igual dibujamos full hasta fin
      const fromIdx = Math.min(idxBoard, idxNearDest);
      const toIdx = Math.max(idxBoard, idxNearDest);

      const tramoCoords = coords.slice(fromIdx, toIdx + 1);
      if (tramoCoords.length < 2) continue;

      // score simple: caminar + caminar destino + longitud aproximada de tramo
      let tramoDist = 0;
      for (let i = 1; i < tramoCoords.length; i++) tramoDist += distMeters(tramoCoords[i - 1], tramoCoords[i]);

      const score = boardDist + walkToDest + tramoDist;

      const cand = {
        linea,
        sentido: sentidoAuto,
        boardLL,
        boardDist,
        boardLabel,
        alightLL: nearDestLL,
        walkToDest,
        tramoCoords,
        coordsAll: coords,
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

  // set estado
  setCurrentLinea(best.linea);

  // marcadores (solo "parada") para el tramo completo de esa línea/sentido
  const paradasRaw2 = await getParadasByLinea(best.linea.codigo, {
    ...ctx,
    tipo: "rural",
    sentido: best.sentido
  });
  const ordered2 = buildOrderedStopsForLinea(paradasRaw2, best.sentido);
  const paradas2 = cutStopsAtFinDeRuta(ordered2);

  setCurrentParadas(paradas2);
  setCurrentStopOffsets(computeStopOffsets(paradas2, best.linea));

  const stopMarkers = [];
  for (const p of paradas2) {
    const ll = getParadaLatLng(p);
    if (!ll) continue;
    if (!isMarcadorVisible(p)) continue;

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

  // destacar board y alight
  const boardMk = L.circleMarker(best.boardLL, {
    radius: 10, color: "#2e7d32", fillColor: "#2e7d32", fillOpacity: 1, weight: 3
  })
    .addTo(layerStops)
    .bindPopup(`<b>✅ Subir aquí</b><br>${best.boardLabel}`);

  const alightMk = L.circleMarker(best.alightLL, {
    radius: 10, color: "#c62828", fillColor: "#c62828", fillOpacity: 1, weight: 3
  })
    .addTo(layerStops)
    .bindPopup(`<b>⛔ Bajar aquí</b><br>Punto cercano al destino`);

  // caminata a board
  const w1 = await drawWalkOSRM(walkLayer, userLoc, best.boardLL);

  // ruta rural siguiendo vías
  const ruralLine = await drawLineRouteFollowingStreets(best.tramoCoords, best.linea.color || "#000");
  if (ruralLine) routesGroup.addLayer(ruralLine);

  // caminata desde alight a destino
  const w2 = await drawWalkOSRM(walkLayer, best.alightLL, destLoc);

  // info
  const op = isLineOperatingNow(best.linea, now);
  const walk1m = w1?.route?.distance ? Math.round(w1.route.distance) : Math.round(best.boardDist);
  const walk2m = w2?.route?.distance ? Math.round(w2.route.distance) : Math.round(best.walkToDest);

  const exagerated = (walk1m > EXAGGERATED_WALK_WARN_M || walk2m > EXAGGERATED_WALK_WARN_M);

  if (ui?.infoEl) {
    ui.infoEl.innerHTML = `
      <b>Ruta (bus rural)</b><br>
      🚌 Línea: <b>${best.linea.codigo}</b> - ${best.linea.nombre || ""}<br>
      🧭 Sentido: <b>${best.sentido}</b><br>
      ${op ? "✅ Operativa ahora" : "⛔ Fuera de servicio ahora"}<br>
      🚶 Camina a subir (${best.boardLabel}): <b>${walk1m} m</b><br>
      🚶 Camina al destino: <b>${walk2m} m</b><br>
      ${exagerated ? `<div class="alert alert-warning py-2 mt-2 mb-0">⚠️ Se encontró ruta pero requiere caminata grande.</div>` : ""}
    `;
  }

  map.fitBounds(L.latLngBounds([userLoc, destLoc, best.boardLL, best.alightLL]).pad(0.2));
  return { linea: best.linea, sentido: best.sentido };
}
