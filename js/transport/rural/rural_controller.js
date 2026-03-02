// js/transport/rural/rural_controller.js
import { map } from "../../map/map.js";
import { getCollectionCache } from "../../app/cache_db.js";

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
import { getUserLocation } from "../../app/state.js";
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
   LIMITES (RURAL)
===================================================== */
const RURAL_BOARD_STEPS = [150, 300, 500, 800, 1000, 1200, 1500, 2000, 2600, 3200];
const RURAL_DEST_STEPS  = [250, 450, 650, 900, 1200, 1500, 2000, 2600, 3200];

const LEVELS_RURAL = Math.max(RURAL_BOARD_STEPS.length, RURAL_DEST_STEPS.length);
const EXAGGERATED_WALK_WARN_M = 2300;

// ✅ regla nueva: si la bajada queda a <=700m del destino, caminar
const WALK_AFTER_ALIGHT_M = 700;

// ✅ cuántas paradas candidatas usar para optimizar auto (OSRM)
const K_ALIGHT_CANDIDATES = 8;

/* =====================================================
   MODAL (Bootstrap) - INFO LÍNEA
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
   MODAL (Bootstrap) - PRÓXIMAS SALIDAS / RETORNOS (tabs)
===================================================== */
function ensureDeparturesModal() {
  let el = document.getElementById("tm-dep-modal");
  if (el) return el;

  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="modal fade" id="tm-dep-modal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-lg modal-dialog-centered">
        <div class="modal-content">

          <div class="modal-header">
            <h5 class="modal-title" id="tm-dep-modal-title">Próximas salidas (1 hora)</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>
          </div>

          <div class="modal-body">
            <ul class="nav nav-tabs" id="tm-dep-tabs" role="tablist">
              <li class="nav-item" role="presentation">
                <button class="nav-link active" id="tm-tab-salidas" data-bs-toggle="tab" data-bs-target="#tm-pane-salidas" type="button" role="tab">
                  Salidas (Ida)
                </button>
              </li>
              <li class="nav-item" role="presentation">
                <button class="nav-link" id="tm-tab-retornos" data-bs-toggle="tab" data-bs-target="#tm-pane-retornos" type="button" role="tab">
                  Retornos (Vuelta)
                </button>
              </li>
            </ul>

            <div class="tab-content border border-top-0 rounded-bottom p-2" id="tm-dep-tabcontent">
              <div class="tab-pane fade show active" id="tm-pane-salidas" role="tabpanel">
                <div id="tm-dep-modal-body-salidas" class="small"></div>
              </div>
              <div class="tab-pane fade" id="tm-pane-retornos" role="tabpanel">
                <div id="tm-dep-modal-body-retornos" class="small"></div>
              </div>
            </div>

            <div class="text-muted small mt-2">
              ℹ️ Listas filtradas por la próxima hora. Horarios aproximados.
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
  return document.getElementById("tm-dep-modal");
}

function showDeparturesModal(htmlSalidas, htmlRetornos, now = new Date()) {
  const modalEl = ensureDeparturesModal();
  const titleEl = modalEl.querySelector("#tm-dep-modal-title");
  const bodySal = modalEl.querySelector("#tm-dep-modal-body-salidas");
  const bodyRet = modalEl.querySelector("#tm-dep-modal-body-retornos");

  titleEl.textContent = `Próxima hora (${hhmmNow(now)} → ${hhmmNow(new Date(now.getTime() + 60 * 60000))})`;

  bodySal.innerHTML = htmlSalidas;
  bodyRet.innerHTML = htmlRetornos;

  const modal = window.bootstrap?.Modal?.getOrCreateInstance(modalEl, {
    backdrop: true,
    keyboard: true
  });
  modal?.show();
}

/* =====================================================
   ✅ LIMPIEZA (sin borrar routeOverlay global)
===================================================== */
export function clearTransportLayers() {
  try { stopPopupLiveUpdate(); } catch {}
  try { clearTransportState(); } catch {}
}

/* =====================================================
   HELPERS GEOM
===================================================== */
function getParadaLatLng(p) {
  const { latitude, longitude } = p?.ubicacion || {};
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  return [latitude, longitude];
}

function distMeters(a, b) {
  return map.distance(a, b);
}

/**
 * ✅ REGLA NUEVA (TU PEDIDO):
 * - denominacion="referencial": SÍ se considera para crear la ruta
 *   y su marcador es un puntito pequeño, mismo color, SIN popup.
 * - denominacion="parada": marcador normal con popup.
 */
function getDenom(p) {
  return String(p?.denominacion || "").toLowerCase().trim();
}

function getMarkerSpec(p, linea) {
  const denom = getDenom(p);
  const color = linea?.color || "#000";

  if (denom === "referencial") {
    return {
      draw: true,
      popup: false,
      style: {
        radius: 2.6,
        color,
        fillColor: color,
        fillOpacity: 0.85,
        weight: 1,
        opacity: 0.9
      }
    };
  }

  // "parada" (y cualquier otra no referencial que quieras mostrar como parada)
  return {
    draw: true,
    popup: true,
    style: {
      radius: 7,
      color,
      fillColor: color,
      fillOpacity: 0.9,
      weight: 2,
      opacity: 1
    }
  };
}

/**
 * ✅ Para planificador BUS:
 * - NO usar "referencial" como candidata de subida/bajada (evita sugerencias raras).
 * - sí usar "parada"/fija/recorrido.
 */
function isStopCandidateForBoardAlight(p) {
  const denom = getDenom(p);
  if (denom === "referencial") return false;
  const uso = String(p?.uso || "").toLowerCase().trim();
  return denom === "parada" || uso === "fija" || uso === "recorrido";
}

function findNearestCoordOnPath(point, coords) {
  let best = null;
  let min = Infinity;
  for (const ll of coords) {
    const d = distMeters(point, ll);
    if (d < min) {
      min = d;
      best = ll;
    }
  }
  return best ? { ll: best, d: min } : null;
}

function findNearestStop(point, stops) {
  let best = null;
  let min = Infinity;
  for (const p of stops) {
    const ll = getParadaLatLng(p);
    if (!ll) continue;
    const d = distMeters(point, ll);
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
   NUMERAL + PREFIJO
===================================================== */
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

/* =====================================================
   ✅ Paradas por lineasruralpasan (robusto)
===================================================== */
function normCode(x) {
  const s = String(x ?? "").trim().toLowerCase();
  return s.replace(/\s+/g, "").replace(/[-_]/g, "");
}

function extractCodesFromLineasruralpasan(p) {
  const arr = Array.isArray(p?.lineasruralpasan) ? p.lineasruralpasan : [];
  const out = [];
  for (const it of arr) {
    if (typeof it === "string" || typeof it === "number") {
      out.push(normCode(it));
      continue;
    }
    if (it && typeof it === "object") {
      if (it.codigo != null) out.push(normCode(it.codigo));
      else if (it.code != null) out.push(normCode(it.code));
      else if (it.id != null) out.push(normCode(it.id));
    }
  }
  return out.filter(Boolean);
}

function belongsToLineaByArray(p, codigoLinea) {
  const need = normCode(codigoLinea);
  if (!need) return false;
  return extractCodesFromLineasruralpasan(p).includes(need);
}

async function getParadasRuralesByLineaPasan(codigoLinea) {
  const code = normCode(codigoLinea);

  const all = await getCollectionCache("paradas_rurales");
  const arr = Array.isArray(all) ? all : [];

  const filtered = arr.filter(p => {
    if (!p?.activo) return false;
    if (normStr(p?.tipo) !== "rural") return false;

    const codes = extractCodesFromLineasruralpasan(p);
    return codes.includes(code);
  });

  if (filtered.length) return filtered;

  // fallback legacy
  try {
    const fb = await getParadasByLinea(String(codigoLinea || ""), { tipo: "rural", sentido: "Ida" });
    return Array.isArray(fb) ? fb : [];
  } catch {
    return [];
  }
}

/* =====================================================
   ✅ ESQUEMAS DE ORDEN (SELECCIÓN POR LÍNEA)
   - "Entra Sevilla": pfi -> pfis -> recorrido (IDA)
                     recorrido -> pfvs -> pfv (VUELTA)
   ✅ FIX: solo stops donde lineasruralpasan incluya el código
===================================================== */
function usesSevillaSchema(linea) {
  return normLite(linea?.denominacion) === "entra sevilla";
}

function dedupByCodigo(arr) {
  const seen = new Set();
  const out = [];
  for (const p of (Array.isArray(arr) ? arr : [])) {
    const key = String(p?.codigo || "").trim();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function buildOrderedStops_Sevilla(paradasAll, sentidoLower, linea) {
  const s = normStr(sentidoLower);
  const codigoLinea = linea?.codigo;

  // ✅ SOLO paradas del sentido + de esta línea
  const base = (Array.isArray(paradasAll) ? paradasAll : [])
    .filter(p => normStr(p?.sentido) === s)
    .filter(p => belongsToLineaByArray(p, codigoLinea));

  // ✅ FIX: detectar "fijas" por uso O por prefijo (pfi/pfis/pfv/pfvs)
  const pref = (p) => getPrefix(p);
  const isFixedByPrefix =
    (p) => pref(p).startsWith("pfi") || pref(p).startsWith("pfis") || pref(p).startsWith("pfv") || pref(p).startsWith("pfvs");

  const isRec  = (p) => normStr(p?.uso) === "recorrido";
  const isFija = (p) => normStr(p?.uso) === "fija" || isFixedByPrefix(p);

  const isPfi  = (p) => pref(p).startsWith("pfi")  && !pref(p).startsWith("pfis");
  const isPfis = (p) => pref(p).startsWith("pfis");
  const isPfvs = (p) => pref(p).startsWith("pfvs");
  const isPfv  = (p) => pref(p).startsWith("pfv")  && !pref(p).startsWith("pfvs");

  const recorrido = sortByNumeralStable(base.filter(isRec));
  const fijas = base.filter(p => isFija(p) && !isRec(p));

  if (s === "ida") {
    // ✅ IDA: pfi asc -> pfis asc -> recorrido asc
    const pfi  = sortByNumeralStable(fijas.filter(isPfi));
    const pfis = sortByNumeralStable(fijas.filter(isPfis));
    return dedupByCodigo([...pfi, ...pfis, ...recorrido]);
  }

  if (s === "vuelta") {
    // (mantienes tu vuelta como ya estaba funcionando)
    const pfvs = sortByNumeralStable(fijas.filter(isPfvs));
    const pfv  = sortByNumeralStable(fijas.filter(isPfv));
    return dedupByCodigo([...recorrido, ...pfvs, ...pfv]);
  }

  return dedupByCodigo(sortByNumeralStable(base));
}

function buildOrderedStops_ByLineaPasan(paradasAll, sentido, codigoLinea) {
  const s = normStr(sentido);
  const code = normCode(codigoLinea);

  const base = (Array.isArray(paradasAll) ? paradasAll : [])
    .filter(p => normStr(p?.sentido) === s)
    .filter(p => extractCodesFromLineasruralpasan(p).includes(code));

  if (!base.length) return [];

  const isRec = (p) => normStr(p?.uso) === "recorrido";
  const isFija = (p) => normStr(p?.uso) === "fija" || (!isRec(p)); // ✅ FIX: todo lo NO-recorrido se trata como fija

  let out = [];

  if (s === "ida") {
    // ✅ IDA: fijas (incluye referenciales) -> recorrido
    const fijas = sortByNumeralStable(base.filter(isFija));
    const rec   = sortByNumeralStable(base.filter(isRec));
    out = [...fijas, ...rec];
  } else if (s === "vuelta") {
    // ✅ VUELTA: recorrido -> fijas (para que termine en fija finderuta=true si existe)
    const rec   = sortByNumeralStable(base.filter(isRec));
    const fijas = sortByNumeralStable(base.filter(isFija));
    out = [...rec, ...fijas];
  } else {
    out = sortByNumeralStable(base);
  }

  // dedup por codigo
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
function buildOrderedStopsForLinea(paradasAll, sentidoLower, linea) {
  const s = normStr(sentidoLower);

  if (usesSevillaSchema(linea)) {
    return buildOrderedStops_Sevilla(paradasAll, s, linea);
  }

  const out = buildOrderedStops_ByLineaPasan(paradasAll, s, linea);
  if (!out.length) return buildOrderedStops_Sevilla(paradasAll, s, linea);
  return out;
}

/* =====================================================
   ✅ FIN DE RUTA (IDA y VUELTA)
   - Corta en la ÚLTIMA parada con finderuta=true (incluida)
   - Si no hay finderuta:
       IDA: corta en la última con uso=recorrido (incluida)
       VUELTA: no corta (se usa toda la lista)
===================================================== */
function cutStopsAtEnd(paradas, sentidoLower) {
  if (!Array.isArray(paradas) || !paradas.length) return [];

  let lastIdx = -1;
  for (let i = 0; i < paradas.length; i++) {
    if (paradas[i]?.finderuta === true) lastIdx = i;
  }
  if (lastIdx !== -1) return paradas.slice(0, lastIdx + 1);

  if (normStr(sentidoLower) === "ida") {
    let lastRec = -1;
    for (let i = 0; i < paradas.length; i++) {
      if (normStr(paradas[i]?.uso) === "recorrido") lastRec = i;
    }
    if (lastRec !== -1) return paradas.slice(0, lastRec + 1);
  }

  return paradas;
}

/* =====================================================
   OSRM: distancia de ruta (para escoger bajada con auto más corto)
===================================================== */
async function osrmRouteDistanceMeters(fromLL, toLL, profile = "driving") {
  try {
    const [lat1, lon1] = fromLL;
    const [lat2, lon2] = toLL;
    const url =
      `https://router.project-osrm.org/route/v1/${encodeURIComponent(profile)}` +
      `/${lon1},${lat1};${lon2},${lat2}?overview=false&alternatives=false&steps=false`;
    const res = await fetch(url);
    if (!res.ok) return Infinity;
    const json = await res.json();
    const d = json?.routes?.[0]?.distance;
    return Number.isFinite(d) ? d : Infinity;
  } catch {
    return Infinity;
  }
}

/* =====================================================
   ✅ NUEVO: dibujar tramo "auto" dentro del layer del transporte
===================================================== */
async function drawDriveOSRMIntoLayer(layerGroup, fromLL, toLL, color = "#0d6efd") {
  try {
    if (!layerGroup || !fromLL || !toLL) return null;

    const [lat1, lon1] = fromLL;
    const [lat2, lon2] = toLL;

    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=geojson`;

    const res = await fetch(url);
    const data = await res.json();
    if (!data.routes?.length) return null;

    const r = data.routes[0];
    const coords = r.geometry.coordinates.map(c => [c[1], c[0]]);
    const line = L.polyline(coords, { color, weight: 5 }).addTo(layerGroup);

    return { route: r, line };
  } catch {
    return null;
  }
}

/* =====================================================
   ✅ DIBUJO RUTA RURAL (ANTI-OSRM-CRUCE)
   - Para segmentos donde ambos puntos son uso="recorrido":
       dibuja línea directa (straight)
   - Caso contrario: OSRM siguiendo calles
   ✅ Importante: "referencial" YA viene en la lista y por eso entra en la ruta
===================================================== */
async function drawRuralRouteSmart(paradas, linea, routesGroup) {
  const color = linea?.color || "#000";

  // ✅ Respeta el orden recibido (ya viene ordenado por numeral en tu pipeline)
  const coordsOrdered = (Array.isArray(paradas) ? paradas : [])
    .map(p => getParadaLatLng(p))
    .filter(Boolean);

  if (coordsOrdered.length < 2) return null;

  // ✅ OSRM tiene límites: dividimos en bloques para evitar fallos con muchas paradas
  const CHUNK = 80; // puedes bajar a 60 si OSRM se pone inestable
  let any = false;

  // Conexión SIEMPRE por calles, en el orden del array
  for (let i = 0; i < coordsOrdered.length - 1; i += (CHUNK - 1)) {
    const slice = coordsOrdered.slice(i, i + CHUNK);
    if (slice.length < 2) continue;

    const lineLayer = await drawLineRouteFollowingStreets(slice, color);
    if (lineLayer) {
      routesGroup.addLayer(lineLayer);
      any = true;
    }
  }

  return any;
}
/* =====================================================
   HORARIO: parse / generación (para modal de próximas salidas)
===================================================== */
function parseHHMM(s) {
  const m = String(s || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

function fmtHHMM(mins) {
  const m = ((mins % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function nowMinutes(now = new Date()) {
  return now.getHours() * 60 + now.getMinutes();
}

function getFreqMin(linea) {
  const a = Number(linea?.frecuencia_min);
  const b = Number(linea?.frecuencia_max);
  if (Number.isFinite(a) && a > 0) return a;
  if (Number.isFinite(b) && b > 0) return b;
  return null;
}

function departuresNextHour(linea, sentidoLower, now = new Date(), windowMin = 60) {
  const start = nowMinutes(now);
  const end = start + windowMin;

  const ida = Array.isArray(linea?.horario_ida) ? linea.horario_ida : [];
  const ret = Array.isArray(linea?.horario_retorno) ? linea.horario_retorno : [];

  const listRaw = (normStr(sentidoLower) === "vuelta") ? ret : ida;
  const list = (Array.isArray(listRaw) ? listRaw : [])
    .map(parseHHMM)
    .filter(v => v != null)
    .sort((a, b) => a - b);

  if (list.length) {
    return list.filter(t => t >= start && t <= end).map(fmtHHMM);
  }

  const ini = parseHHMM(linea?.horario_inicio);
  const fin = parseHHMM(linea?.horario_fin);
  const freq = getFreqMin(linea);
  if (ini == null || fin == null || !freq) return [];

  const out = [];
  const inWindow = (t) => t >= start && t <= end;

  if (ini <= fin) {
    let t = Math.max(start, ini);
    const k = Math.ceil((t - ini) / freq);
    t = ini + k * freq;
    while (t <= Math.min(end, fin)) {
      if (inWindow(t)) out.push(fmtHHMM(t));
      t += freq;
    }
    return out;
  }

  const maxT = Math.min(end, 24 * 60 - 1);

  if (start >= ini) {
    let t = start;
    const k = Math.ceil((t - ini) / freq);
    t = ini + k * freq;
    while (t <= maxT) {
      if (inWindow(t)) out.push(fmtHHMM(t));
      t += freq;
    }
  } else {
    const maxM = Math.min(end, fin);
    let t = start;
    const k = Math.ceil((t - 0) / freq);
    t = 0 + k * freq;
    while (t <= maxM) {
      if (inWindow(t)) out.push(fmtHHMM(t));
      t += freq;
    }
  }

  return out;
}

/* =====================================================
   BOTÓN: próximas salidas (debajo del select sentido)
===================================================== */
function upsertDeparturesButton(container, lineas, ctx = {}) {
  const extraWrap = container.querySelector("#linea-extra");
  if (!extraWrap) return;

  let btn = extraWrap.querySelector("#btn-next-departures");
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "btn-next-departures";
    btn.type = "button";
    btn.className = "btn btn-primary w-100 mt-2 d-flex align-items-center justify-content-center gap-2";
    btn.innerHTML = `🕐 <span>Ver próximas salidas de líneas</span>`;
    extraWrap.appendChild(btn);
  }

  btn.onclick = async () => {
    const now = new Date();
    const rowsSal = [];
    const rowsRet = [];

    const sorted = [...(Array.isArray(lineas) ? lineas : [])]
      .sort((a, b) => (Number(a?.orden) || 0) - (Number(b?.orden) || 0));

    for (const l of sorted) {
      if (!l?.activo) continue;
      if (normStr(l?.tipo) !== "rural") continue;

      const op = isLineOperatingNow(l, now);

      const salidas = departuresNextHour(l, "ida", now, 60);
      if (salidas.length) {
        rowsSal.push(`
          <div class="p-2 border rounded mb-2">
            <div class="d-flex justify-content-between align-items-start gap-2">
              <div>
                <div style="font-weight:700">${l.codigo || ""} ${l.nombre ? `- ${l.nombre}` : ""}</div>
              </div>
              <span class="badge ${op ? "text-bg-success" : "text-bg-warning"}">${op ? "Operativa" : "Fuera de servicio"}</span>
            </div>
            <div class="mt-2">
              <b>Salidas (ida) en la próxima hora:</b><br>
              ${salidas.map(x => `<span class="badge text-bg-light border me-1 mb-1">${x}</span>`).join("")}
            </div>
          </div>
        `);
      }

      const retornos = departuresNextHour(l, "vuelta", now, 60);
      if (retornos.length) {
        rowsRet.push(`
          <div class="p-2 border rounded mb-2">
            <div class="d-flex justify-content-between align-items-start gap-2">
              <div>
                <div style="font-weight:700">${l.codigo || ""} ${l.nombre ? `- ${l.nombre}` : ""}</div>
              </div>
              <span class="badge ${op ? "text-bg-success" : "text-bg-warning"}">${op ? "Operativa" : "Fuera de servicio"}</span>
            </div>
            <div class="mt-2">
              <b>Retornos (vuelta) en la próxima hora:</b><br>
              ${retornos.map(x => `<span class="badge text-bg-light border me-1 mb-1">${x}</span>`).join("")}
            </div>
          </div>
        `);
      }
    }

    const htmlSal = rowsSal.length
      ? rowsSal.join("")
      : `<div class="alert alert-warning py-2 mb-0">No hay salidas (ida) registradas en la próxima hora.</div>`;

    const htmlRet = rowsRet.length
      ? rowsRet.join("")
      : `<div class="alert alert-warning py-2 mb-0">No hay retornos (vuelta) registrados en la próxima hora.</div>`;

    showDeparturesModal(htmlSal, htmlRet, now);
  };
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

  // ✅ NUEVO: mostrar botón de próximas salidas apenas se elige Rural
  upsertDeparturesButton(container, lineas, ctx);

  let currentLineaSel = null;
  const sentidosCache = ["Ida", "Vuelta"];
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

      // (puede quedarse, no estorba)
      upsertDeparturesButton(container, lineas, ctx);
      return;
    }

    if (!currentLineaSel) return;

    if (target.id === "select-sentido") {
      const sentidoSel = titleCase(normStr(target.value));

      clearTransportLayers();
      currentSentido = sentidoSel;

      renderLineaExtraControls(container, {
        sentidos: sentidosCache,
        showCobertura: false,
        coberturas: [],
      });

      // (puede quedarse, no estorba)
      upsertDeparturesButton(container, lineas, ctx);

      if (!sentidoSel) return;

      await mostrarRutaLinea(currentLineaSel, { sentido: currentSentido }, ctx);
      return;
    }
  };
}
/* =====================================================
   MOSTRAR RUTA (RURAL)
   ✅ Ahora "referencial" sí:
     - entra en la ruta (coords)
     - muestra puntito sin popup
===================================================== */
export async function mostrarRutaLinea(linea, opts = {}, ctx = {}) {
  clearTransportLayers();
  setCurrentLinea(linea);

  const sentidoSel = titleCase(normStr(opts.sentido));
  const sentidoLower = normStr(sentidoSel);

  const paradasRaw = usesSevillaSchema(linea)
    ? await getParadasByLinea(linea.codigo, { ...ctx, tipo: "rural", sentido: sentidoSel })
    : await getParadasRuralesByLineaPasan(linea.codigo);

  if (!paradasRaw?.length) return;

  const ordered = buildOrderedStopsForLinea(paradasRaw, sentidoLower, linea);
  const paradas = cutStopsAtEnd(ordered, sentidoLower);

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

    // ✅ SIEMPRE entra en coords (incluye "referencial")
    coords.push(ll);

    const spec = getMarkerSpec(p, linea);
    if (!spec?.draw) continue;

    const marker = L.circleMarker(ll, spec.style).addTo(layerParadas);

    if (spec.popup) {
      marker.bindPopup(buildStopPopupHTML(p, linea), { autoPan: true });

      marker.on("popupopen", () => {
        marker.setPopupContent(buildStopPopupHTML(p, linea));
        startPopupLiveUpdate(marker, p);
      });

      marker.on("popupclose", () => stopPopupLiveUpdate());

      stopMarkers.push({ marker, parada: p });
    } else {
      // ✅ "referencial": sin popup, pero lo guardamos igual para limpieza/estado
      stopMarkers.push({ marker, parada: p });
    }
  }

  setCurrentStopMarkers(stopMarkers);

  // ✅ NUEVO: resaltar (verde) la parada más cercana + ruta punteada desde el usuario
  try {
    const userLoc = getUserLocation?.();
    if (userLoc && stopMarkers.length) {
      let bestMarker = null;
      let bestLL = null;
      let bestD = Infinity;

      for (const it of stopMarkers) {
        const m = it?.marker;
        const p = it?.parada;
        if (!m || !p) continue;

        // ✅ solo paradas reales (no "referencial")
        const denom = String(p?.denominacion || "").toLowerCase().trim();
        if (denom === "referencial") continue;

        const llObj = m.getLatLng?.();
        if (!llObj) continue;

        const d = map.distance(userLoc, llObj);
        if (d < bestD) {
          bestD = d;
          bestMarker = m;
          bestLL = [llObj.lat, llObj.lng];
        }
      }

      if (bestMarker && bestLL) {
        // 🟢 pintar marcador verde
        bestMarker.setStyle({
          color: "#2e7d32",
          fillColor: "#2e7d32",
          fillOpacity: 1,
          weight: 4
        });
        if (bestMarker.setRadius) bestMarker.setRadius(9);
        bestMarker.bindTooltip("🟢 Parada más cercana", { direction: "top", sticky: true });

        // ➖➖➖ dibujar ruta punteada usuario → parada más cercana
        const accessLayer = L.layerGroup().addTo(map);
        setAccessLayer(accessLayer);

        // Esta función ya dibuja “dashed” (entrecortado) siguiendo OSRM
        await drawDashedAccessRoute(userLoc, bestLL, "#2e7d32");
      }
    }
  } catch {}

  if (coords.length < 2) return;

  await drawRuralRouteSmart(paradas, linea, routesGroup);
  map.fitBounds(L.latLngBounds(coords).pad(0.12));
}

/* =====================================================
   🚌 MODO BUS (RURAL)
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

async function withTimeout(promise, ms = 12000) {
  let t = null;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error("timeout")), ms);
  });
  try {
    const out = await Promise.race([promise, timeout]);
    return out;
  } finally {
    if (t) clearTimeout(t);
  }
}

export async function planAndShowBusStopsForPlace(userLoc, destPlace, ctx = {}, ui = {}) {
  try {
    return await withTimeout(_planAndShowBusStopsForPlace(userLoc, destPlace, ctx, ui), 12000);
  } catch (e) {
    if (ui?.infoEl && !ctx?.dryRun) {
      ui.infoEl.innerHTML = `
        <div class="alert alert-warning py-2 mb-0">
          ❌ No se encontró una ruta óptima en bus (tiempo de búsqueda excedido).
        </div>
      `;
    }
    return null;
  }
}

async function _planAndShowBusStopsForPlace(userLoc, destPlace, ctx = {}, ui = {}) {
  if (!userLoc || !destPlace?.ubicacion) return null;

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

  if (!ctx?.preserveLayers) clearTransportLayers();

  const now = (ctx?.now instanceof Date) ? ctx.now : new Date();
const destLoc = [destPlace.ubicacion.latitude, destPlace.ubicacion.longitude];

const lineasAll = await getLineasByTipo("rural", {
  ...ctx,
  ignoreGeoFilter: ctx?.ignoreGeoFilter === true || ctx?.specialSevilla === true
});

if (!lineasAll?.length) {
  if (ui?.infoEl && !ctx?.dryRun) ui.infoEl.innerHTML = "❌ No hay líneas rurales disponibles.";
  return null;
}

// ✅ NUEVO: si estamos en modo bus automático, preferir solo líneas operativas ahora
// (si no hay ninguna operativa, hacemos fallback para no dejar al usuario sin ruta)
let lineas = [...lineasAll];

const requireOpNow = (ctx?.requireOperatingNow !== false); // default: true
if (requireOpNow) {
  const operativas = lineasAll.filter(l => l?.activo && isLineOperatingNow(l, now));

  if (operativas.length) {
    lineas = operativas;
  } else {
    // fallback: no hay ninguna operativa ahora, usamos todas
    lineas = [...lineasAll];

    // opcional: aviso
    if (ui?.infoEl && !ctx?.dryRun) {
      ui.infoEl.innerHTML = `
        <div class="alert alert-warning py-2 mb-2">
          ⚠️ No hay líneas rurales marcadas como <b>operativas ahora</b>.
          Se mostrará la mejor ruta registrada (puede no estar disponible en este momento).
        </div>
      `;
    }
  }
}

  let routesGroup = null;
  let layerStops = null;
  let walkLayer = null;

  if (!ctx?.dryRun) {
    walkLayer = L.layerGroup().addTo(map);
    setAccessLayer(walkLayer);

    routesGroup = L.layerGroup().addTo(map);
    setRouteLayer(routesGroup);

    layerStops = L.layerGroup().addTo(map);
    setStopsLayer(layerStops);
  }

  let best = null;
  const W_TIME = 12;

  const reqSentido = normStr(ctx?.sentido || "auto");
  const sentidosToTry = (reqSentido === "ida" || reqSentido === "vuelta") ? [reqSentido] : ["ida", "vuelta"];

  const stopsCacheByLinea = new Map();

  for (let level = 0; level < LEVELS_RURAL; level++) {
    const maxBoard = RURAL_BOARD_STEPS[Math.min(level, RURAL_BOARD_STEPS.length - 1)];
    const maxDest  = RURAL_DEST_STEPS[Math.min(level, RURAL_DEST_STEPS.length - 1)];

    for (const linea of lineas) {
      if (!linea?.activo) continue;

      let baseStops = stopsCacheByLinea.get(linea.codigo);
      if (!baseStops) {
        baseStops = await getParadasRuralesByLineaPasan(linea.codigo);
        stopsCacheByLinea.set(linea.codigo, baseStops || []);
      }
      if (!baseStops?.length) continue;

      for (const sentidoTry of sentidosToTry) {
        const sentidoLower = normStr(sentidoTry);

        const ordered = buildOrderedStopsForLinea(baseStops, sentidoLower, linea);
        const paradas = cutStopsAtEnd(ordered, sentidoLower);

        const coords = paradas.map(getParadaLatLng).filter(Boolean);
        if (coords.length < 2) continue;

        // ✅ candidatos para subir/bajar: excluye "referencial"
        const visibles = paradas.filter(isStopCandidateForBoardAlight);
        if (visibles.length < 2) continue;

        // SUBIDA
        const nearestStopUser = findNearestStop(userLoc, visibles);
        const nearestCoordUser = findNearestCoordOnPath(userLoc, coords);

        let boardLL = null;
        let boardDist = Infinity;
        let boardLabel = "";

        if (nearestStopUser && nearestStopUser.d <= maxBoard) {
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

        // BAJADA: SOLO después de idxBoard (usar paradas candidatas, no referenciales)
        const candidates = [];
        for (let i = idxBoard + 1; i < paradas.length; i++) {
          const pStop = paradas[i];
          if (!isStopCandidateForBoardAlight(pStop)) continue;

          const ll = getParadaLatLng(pStop);
          if (!ll) continue;

          const dLine = distMeters(destLoc, ll);
          if (dLine <= maxDest) {
            candidates.push({ idx: i, ll, dLine, stop: pStop });
          }
        }

        // fallback: punto sobre ruta (después de subida)
        if (!candidates.length) {
          const nearestCoordDest = findNearestCoordOnPath(destLoc, coords.slice(idxBoard + 1));
          if (!nearestCoordDest || nearestCoordDest.d > maxDest) continue;

          const alightLL = nearestCoordDest.ll;
          const idxAlight = findNearestCoordIndex(coords, alightLL);
          if (idxAlight < 0) continue;
          if (!(idxBoard < idxAlight)) continue;

          const tramoCoords = coords.slice(idxBoard, idxAlight + 1);
          if (tramoCoords.length < 2) continue;

          let tramoDist = 0;
          for (let j = 1; j < tramoCoords.length; j++) tramoDist += distMeters(tramoCoords[j - 1], tramoCoords[j]);

          const dtMin = 0;

          const walkToDest = nearestCoordDest.d;
          const useAuto = walkToDest > WALK_AFTER_ALIGHT_M;

          const extra = useAuto ? 0 : walkToDest;
          const score = boardDist + extra + tramoDist + (dtMin * W_TIME);

          const cand = {
            linea,
            sentido: sentidoTry,
            sentidoLower,
            paradas,
            coords,
            visibles,
            boardLL,
            boardDist,
            boardLabel,
            idxBoard,
            alightLL,
            alightLabel: "Punto de la ruta",
            idxAlight,
            tramoCoords,
            fromIdx: idxBoard,
            toIdx: idxAlight,
            walkToDest,
            useAuto,
            dtMin,
            score,
            _driveMeters: Infinity
          };

          if (!best || cand.score < best.score) best = cand;
          continue;
        }

        candidates.sort((a, b) => a.dLine - b.dLine);
        const top = candidates.slice(0, Math.max(1, K_ALIGHT_CANDIDATES));

        let chosen = null;
        const walkables = top.filter(x => x.dLine <= WALK_AFTER_ALIGHT_M);
        if (walkables.length) {
          chosen = walkables[0];
        } else {
          let bestDrive = Infinity;
          for (const c of top) {
            const drive = await osrmRouteDistanceMeters(c.ll, destLoc, "driving");
            const val = Number.isFinite(drive) ? drive : Infinity;
            if (val < bestDrive) {
              bestDrive = val;
              chosen = { ...c, driveMeters: val };
            }
          }
          if (!chosen) chosen = top[0];
        }

        const alightLL = chosen.ll;
        const idxAlight = chosen.idx;
        if (!(idxBoard < idxAlight)) continue;

        const tramoCoords = coords.slice(idxBoard, idxAlight + 1);
        if (tramoCoords.length < 2) continue;

        let tramoDist = 0;
        for (let j = 1; j < tramoCoords.length; j++) tramoDist += distMeters(tramoCoords[j - 1], tramoCoords[j]);

        const dtMin = 0;

        const walkToDest = chosen.dLine;
        const useAuto = walkToDest > WALK_AFTER_ALIGHT_M;

        const driveMeters = useAuto
          ? (Number.isFinite(chosen.driveMeters) ? chosen.driveMeters : Infinity)
          : Infinity;

        const extra = useAuto ? 0 : walkToDest;

        const score =
          boardDist +
          extra +
          tramoDist +
          (dtMin * W_TIME) +
          (useAuto && Number.isFinite(driveMeters) ? (driveMeters * 0.35) : 0);

        const cand = {
          linea,
          sentido: sentidoTry,
          sentidoLower,

          paradas,
          coords,
          visibles,

          boardLL,
          boardDist,
          boardLabel,
          idxBoard,

          alightLL,
          alightLabel: "Parada",
          idxAlight,

          tramoCoords,
          fromIdx: idxBoard,
          toIdx: idxAlight,

          walkToDest,
          useAuto,
          dtMin,
          score,
          _driveMeters: driveMeters
        };

        if (!best || cand.score < best.score) best = cand;
      }
    }

    if (best) break;
  }

  if (!best) {
    if (ui?.infoEl && !ctx?.dryRun) {
      ui.infoEl.innerHTML = `
        <div class="alert alert-warning py-2 mb-2">
          ❌ No se encontró una ruta rural cercana con límites razonables.
        </div>
      `;
    }
    return null;
  }

  if (ctx?.dryRun) {
    const metrics = {
      walk1: best.boardDist || 0,
      walk2: best.useAuto ? 0 : (best.walkToDest || 0),
      stopsCount: Math.max(0, (best.toIdx - best.fromIdx))
    };
    return {
      tipo: "rural",
      linea: best.linea,
      sentido: titleCase(normStr(best.sentido)),
      useAuto: best.useAuto,
      metrics,
      score: best.score
    };
  }

  // ======= pintar resultado =======
  setCurrentLinea(best.linea);
  setCurrentParadas(best.paradas);
  setCurrentStopOffsets(computeStopOffsets(best.paradas, best.linea));

  const idxMap = buildIndexByLatLng(best.coords);

  const stopMarkers = [];
  for (const p of best.paradas) {
    const ll = getParadaLatLng(p);
    if (!ll) continue;

    const idx = idxMap.get(llKey(ll));
    if (idx == null) continue;
    if (idx < best.fromIdx || idx > best.toIdx) continue;

    const spec = getMarkerSpec(p, best.linea);
    if (!spec?.draw) continue;

    const marker = L.circleMarker(ll, spec.style).addTo(layerStops);

    if (spec.popup) {
      marker.bindPopup(buildStopPopupHTML(p, best.linea), { autoPan: true });
      marker.on("popupopen", () => {
        marker.setPopupContent(buildStopPopupHTML(p, best.linea));
        startPopupLiveUpdate(marker, p);
      });
      marker.on("popupclose", () => stopPopupLiveUpdate());
    }

    stopMarkers.push({ marker, parada: p });
  }
  setCurrentStopMarkers(stopMarkers);

  // subir/bajar
  L.circleMarker(best.boardLL, {
    radius: 10, color: "#2e7d32", fillColor: "#2e7d32", fillOpacity: 1, weight: 3
  }).addTo(layerStops).bindPopup(`<b>✅ Subir aquí</b><br>${best.boardLabel}`);

  L.circleMarker(best.alightLL, {
    radius: 10, color: "#c62828", fillColor: "#c62828", fillOpacity: 1, weight: 3
  }).addTo(layerStops).bindPopup(`<b>⛔ Bajar aquí</b><br>${best.alightLabel}`);

  await drawDashedAccessRoute(userLoc, best.boardLL, "#666");

  const tramoParadas = best.paradas.slice(best.fromIdx, best.toIdx + 1);
  await drawRuralRouteSmart(tramoParadas, best.linea, routesGroup);

  if (best.useAuto) {
    await drawDriveOSRMIntoLayer(routesGroup, best.alightLL, destLoc, "#0d6efd");
  } else {
    await drawDashedAccessRoute(best.alightLL, destLoc, "#666");
  }

  const op = isLineOperatingNow(best.linea, now);
  const exagerated = (best.boardDist > EXAGGERATED_WALK_WARN_M || best.walkToDest > EXAGGERATED_WALK_WARN_M);

  if (ui?.infoEl) {
    ui.infoEl.innerHTML = `
      <b>Ruta (bus rural${best.useAuto ? " + auto" : ""})</b><br>
      🚌 Línea: <b>${best.linea.codigo}</b> - ${best.linea.nombre || ""}<br>
      🧭 Sentido: <b>${titleCase(normStr(best.sentido))}</b><br>
      ${op ? "✅ Operativa ahora" : "⛔ Fuera de servicio ahora"}<br>
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
  return { tipo: "rural", linea: best.linea, sentido: titleCase(normStr(best.sentido)), useAuto: best.useAuto, score: best.score };
}
function highlightNearestStopOnLine(stopMarkers, userLoc) {
  if (!userLoc || !Array.isArray(stopMarkers) || !stopMarkers.length) return;

  let best = null;
  let bestD = Infinity;

  for (const it of stopMarkers) {
    const m = it?.marker;
    const p = it?.parada;

    // ✅ solo "paradas" reales (evita "referencial")
    const denom = String(p?.denominacion || "").toLowerCase().trim();
    if (denom === "referencial") continue;

    if (!m) continue;
    const ll = m.getLatLng?.();
    if (!ll) continue;

    const d = map.distance(userLoc, ll);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }

  if (!best) return;

  // ✅ ponerlo verde (sin cambiar lógica del planner)
  try {
    best.setStyle({
      color: "#2e7d32",
      fillColor: "#2e7d32",
      fillOpacity: 1,
      weight: 4
    });

    // opcional: un poco más grande
    if (best.setRadius) best.setRadius(9);

    // opcional: tooltip al pasar el mouse
    best.bindTooltip("🟢 Parada más cercana", { direction: "top", sticky: true });
  } catch {}
}