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

/* =====================================================
   ✅ NUEVO: validación geo (provincia/cantón/parroquia)
===================================================== */
function normLite(s) {
  return String(s || "").trim().toLowerCase();
}

/**
 * Si ctx trae provincia/cantón/parroquia, validamos contra destPlace.
 * Si destPlace no tiene esos campos -> no bloqueamos (lo dejamos pasar).
 */
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
   MODAL (Bootstrap) - PRÓXIMAS SALIDAS
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
            <div id="tm-dep-modal-body" class="small"></div>
            <div class="text-muted small mt-2">
              ℹ️ “Salidas” se filtra solo por la próxima hora. El “retorno” mostrado es el próximo retorno aproximado.
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

function showDeparturesModal(html, now = new Date()) {
  const modalEl = ensureDeparturesModal();
  const titleEl = modalEl.querySelector("#tm-dep-modal-title");
  const bodyEl = modalEl.querySelector("#tm-dep-modal-body");

  titleEl.textContent = `Próximas salidas (desde ${hhmmNow(now)} hasta ${hhmmNow(new Date(now.getTime() + 60 * 60000))})`;
  bodyEl.innerHTML = html;

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
  // ⚠️ ya NO llamamos clearRoute() global (para no pisar rutas no-transporte)
}

/* =====================================================
   HELPERS GEOM
===================================================== */
function getParadaLatLng(p) {
  const { latitude, longitude } = p?.ubicacion || {};
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  return [latitude, longitude];
}

// ✅ incluir: denominacion=parada + uso=fija/recorrido
function isMarcadorVisible(p) {
  const d = String(p?.denominacion || "").toLowerCase().trim();
  const uso = String(p?.uso || "").toLowerCase().trim();
  return d === "parada" || uso === "fija" || uso === "recorrido";
}

function distMeters(a, b) {
  return map.distance(a, b);
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
   ✅ ESQUEMAS DE ORDEN (SELECCIÓN POR LÍNEA)
   - Esquema A (actual): SOLO líneas con denominacion === "Entra Sevilla"
   - Esquema B (escalable): por lineasruralpasan + numeral (pfi inicio ida, pfv final vuelta)
===================================================== */
function usesSevillaSchema(linea) {
  return normLite(linea?.denominacion) === "entra sevilla";
}

/**
 * Esquema A (actual): orden por prefijos + numeral
 * IDA: pfi -> pfis -> prism -> resto
 * VUELTA: prvsm -> pfvsm -> pfvs -> pfv -> resto
 */
// ✅ Esquema 1 (Entra Sevilla)
// Reglas:
// - IDA:  pfi  -> pfis -> (recorrido de la línea por lineasruralpasan)
// - VUELTA: (recorrido de la línea por lineasruralpasan) -> pfvs -> pfv
// Orden siempre por numeral (fallback: orden, fallback: número en código)

function buildOrderedStops_Sevilla(paradasAll, sentido, codigoLinea) {
  const s = normStr(sentido);              // "ida" | "vuelta"
  const lineNeed = normCodeLoose(codigoLinea);

  // 1) Filtra por sentido (clave: no mezclar ida/vuelta)
  const base = (Array.isArray(paradasAll) ? paradasAll : [])
    .filter(p => normStr(p?.sentido) === s);

  // Helpers: prefijo / numeral / pertenencia a línea
  function normCodeLoose(x) {
    const t = String(x ?? "").trim().toLowerCase();
    return t.replace(/\s+/g, "").replace(/[-_]/g, "");
  }

  function extractLineCodes(p) {
    const arr = Array.isArray(p?.lineasruralpasan) ? p.lineasruralpasan : [];
    const out = [];
    for (const it of arr) {
      if (typeof it === "string" || typeof it === "number") {
        out.push(normCodeLoose(it));
        continue;
      }
      if (it && typeof it === "object") {
        if (it.codigo != null) out.push(normCodeLoose(it.codigo));
        else if (it.code != null) out.push(normCodeLoose(it.code));
        else if (it.id != null) out.push(normCodeLoose(it.id));
      }
    }
    return out.filter(Boolean);
  }

  function belongsToLinea(p) {
    if (!lineNeed) return false;
    const codes = extractLineCodes(p);
    return codes.includes(lineNeed);
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

  function sortByNumeralStable(arr) {
    return [...arr].sort((a, b) => {
      const na = getNumeral(a);
      const nb = getNumeral(b);
      if (na !== nb) return na - nb;
      return String(a?.codigo || "").localeCompare(String(b?.codigo || ""));
    });
  }

  function getPrefix(p) {
    const { prefix } = parseCodigoParts(p?.codigo);
    return String(prefix || "").toLowerCase().trim();
  }

  // Reglas de selección por grupos
  const isUsoRecorrido = (p) => normStr(p?.uso) === "recorrido";
  const isPfi = (p) => getPrefix(p).startsWith("pfi");   // pfi0, pfi1...
  const isPfis = (p) => getPrefix(p).startsWith("pfis"); // pfis0...
  const isPfvs = (p) => getPrefix(p).startsWith("pfvs"); // pfvs1...
  const isPfv = (p) => getPrefix(p).startsWith("pfv");   // pfv0...

  // Grupo: paradas "recorrido" que pertenecen a la línea (por array)
  const recorridoLinea = base.filter(p => isUsoRecorrido(p) && belongsToLinea(p));

  // ✅ Importante: asegurar consecutividad por numeral
  // Tomamos el "tramo" desde el numeral más bajo hasta el más alto donde siga existiendo la línea.
  // Si hay huecos, igual avanzamos; si el conjunto es disjunto, tomamos todo el conjunto ordenado.
  function buildRecorridoConsecutivo(recArr) {
    const ord = sortByNumeralStable(recArr);
    // si no quieres recortar nada, devuelve ord directo:
    // return ord;

    // Versión "tramo principal": del minNumeral al maxNumeral presentes
    const nums = ord.map(getNumeral).filter(n => Number.isFinite(n));
    if (!nums.length) return ord;

    const minN = Math.min(...nums);
    const maxN = Math.max(...nums);

    // Incluimos solo los que estén dentro del rango [minN..maxN]
    // (normalmente será todo; ayuda si hay valores raros)
    const out = ord.filter(p => {
      const n = getNumeral(p);
      return Number.isFinite(n) && n >= minN && n <= maxN;
    });

    return out.length ? out : ord;
  }

  const tramoRecorrido = buildRecorridoConsecutivo(recorridoLinea);

  // Armar salida según sentido
  let out = [];

  if (s === "ida") {
    const pfi = sortByNumeralStable(base.filter(isPfi));
    const pfis = sortByNumeralStable(base.filter(isPfis));

    // IDA: pfi -> pfis -> recorridoLinea
    out = [...pfi, ...pfis, ...tramoRecorrido];
  } else if (s === "vuelta") {
    const pfvs = sortByNumeralStable(base.filter(isPfvs));
    const pfv = sortByNumeralStable(base.filter(isPfv));

    // VUELTA: recorridoLinea -> pfvs -> pfv
    out = [...tramoRecorrido, ...pfvs, ...pfv];
  } else {
    // fallback: por si llega algo raro
    out = sortByNumeralStable(base);
  }

  // dedup por codigo (por si algún grupo se solapa)
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
 * Esquema B (escalable):
 * - Filtra SOLO paradas cuyo lineasruralpasan incluye el código de la línea
 * - Ordena por numeral (y desempate por codigo)
 * - Mantiene pfi como “inicio” natural en ida, y pfv como “final” natural en vuelta (si existen)
 *   (no fuerza prefijos; el orden lo manda el numeral)
 */
function buildOrderedStops_ByLineaPasan(paradasAll, sentido, codigoLinea) {
  const s = normStr(sentido);
  const code = normCode(codigoLinea);

  const base = (Array.isArray(paradasAll) ? paradasAll : [])
    .filter(p => normStr(p?.sentido) === s)
    .filter(p => {
      const codes = extractCodesFromLineasruralpasan(p);
      return codes.includes(code);
    });

  // si por alguna razón no hay nada, devolvemos vacío (caller hace fallback)
  if (!base.length) return [];

  // Orden principal por numeral
  const sorted = sortByNumeralStable(base);

  // Dedup por codigo
  const seen = new Set();
  const final = [];
  for (const p of sorted) {
    const key = String(p?.codigo || "").trim();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    final.push(p);
  }
  return final;
}

/**
 * Wrapper: decide qué esquema usar según la línea
 */
function buildOrderedStopsForLinea(paradasAll, sentido, linea) {
  const s = normStr(sentido);

  // ✅ Esquema A (solo "Entra Sevilla")
  if (usesSevillaSchema(linea)) {
    return buildOrderedStops_Sevilla(paradasAll, s, linea?.codigo);
  }

  // ✅ Esquema B (escalable: por lineasruralpasan + numeral)
  const out = buildOrderedStops_ByLineaPasan(paradasAll, s, linea?.codigo);

  // fallback: si por alguna razón no encontró nada con lineasruralpasan
  if (!out.length) {
    return buildOrderedStops_Sevilla(paradasAll, s, linea?.codigo);
  }

  return out;
}

/**
 * finderuta=true SOLO en VUELTA => corta el listado allí
 */
function cutStopsAtFinDeRuta(paradas, sentidoLower) {
  if (!Array.isArray(paradas) || !paradas.length) return [];
  if (normStr(sentidoLower) !== "vuelta") return paradas;

  const idx = paradas.findIndex(p => p?.finderuta === true);
  if (idx === -1) return paradas;
  return paradas.slice(0, idx + 1);
}

/* =====================================================
   HORARIO: parse / generación
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

function nextDepartureDeltaMin(linea, sentidoLower, now = new Date()) {
  const cur = nowMinutes(now);

  const ida = Array.isArray(linea?.horario_ida) ? linea.horario_ida : [];
  const ret = Array.isArray(linea?.horario_retorno) ? linea.horario_retorno : [];

  const arr = (normStr(sentidoLower) === "vuelta") ? ret : ida;
  const times = arr.map(parseHHMM).filter(v => v != null).sort((a, b) => a - b);

  if (times.length) {
    for (const t of times) if (t >= cur) return (t - cur);
    return (24 * 60 - cur) + times[0];
  }

  // fallback por rango inicio/fin (si no hay lista)
  const ini = parseHHMM(linea?.horario_inicio);
  const fin = parseHHMM(linea?.horario_fin);
  if (ini == null || fin == null) return 9999;

  if (cur <= ini) return ini - cur;

  if (ini <= fin) {
    if (cur <= fin) return 0;
    return (24 * 60 - cur) + ini;
  } else {
    if (cur >= ini || cur <= fin) return 0;
    return ini - cur;
  }
}

function getFreqMin(linea) {
  const a = Number(linea?.frecuencia_min);
  const b = Number(linea?.frecuencia_max);
  if (Number.isFinite(a) && a > 0) return a;
  if (Number.isFinite(b) && b > 0) return b;
  return null;
}

function departuresNextHour_Ida(linea, now = new Date(), windowMin = 60) {
  const start = nowMinutes(now);
  const end = start + windowMin;

  const ida = Array.isArray(linea?.horario_ida) ? linea.horario_ida : [];
  const list = ida.map(parseHHMM).filter(v => v != null).sort((a, b) => a - b);
  if (list.length) {
    return list.filter(t => t >= start && t <= end).map(fmtHHMM);
  }

  const ini = parseHHMM(linea?.horario_inicio);
  const fin = parseHHMM(linea?.horario_fin);
  const freq = getFreqMin(linea);

  if (ini == null || fin == null) return [];
  if (!freq) return [];

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

function nextReturnTime(linea, now = new Date()) {
  const cur = nowMinutes(now);
  const ret = Array.isArray(linea?.horario_retorno) ? linea.horario_retorno : [];
  const list = ret.map(parseHHMM).filter(v => v != null).sort((a, b) => a - b);
  if (list.length) {
    const t = list.find(x => x >= cur);
    if (t != null) return fmtHHMM(t);
    return fmtHHMM(list[0]);
  }

  const d = nextDepartureDeltaMin(linea, "vuelta", now);
  if (!Number.isFinite(d) || d >= 9999) return "";
  return fmtHHMM(cur + d);
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
  return out;
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
   (NO routeOverlay global)
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
    const rows = [];

    const sorted = [...(Array.isArray(lineas) ? lineas : [])].sort((a, b) => (Number(a?.orden) || 0) - (Number(b?.orden) || 0));

    for (const l of sorted) {
      if (!l?.activo) continue;
      if (normStr(l?.tipo) !== "rural") continue;

      const salidas = departuresNextHour_Ida(l, now, 60);
      if (!salidas.length) continue;

      const retTxt = nextReturnTime(l, now);
      const op = isLineOperatingNow(l, now);

      rows.push(`
        <div class="p-2 border rounded mb-2">
          <div class="d-flex justify-content-between align-items-start gap-2">
            <div>
              <div style="font-weight:700">${l.codigo || ""} ${l.nombre ? `- ${l.nombre}` : ""}</div>
              <div class="small text-muted">🧭 Sentido recomendado en popup de paradas (referencial)</div>
            </div>
            <span class="badge ${op ? "text-bg-success" : "text-bg-warning"}">${op ? "Operativa" : "Fuera de servicio"}</span>
          </div>

          <div class="mt-2">
            <b>Salidas (ida) en la próxima hora:</b><br>
            ${salidas.map(x => `<span class="badge text-bg-light border me-1 mb-1">${x}</span>`).join("")}
          </div>

          ${retTxt ? `<div class="mt-2"><b>Próximo retorno (vuelta) aprox.:</b> <span class="badge text-bg-secondary">${retTxt}</span></div>` : ""}
        </div>
      `);
    }

    const html = rows.length
      ? rows.join("")
      : `<div class="alert alert-warning py-2 mb-0">No hay salidas (ida) registradas en la próxima hora.</div>`;

    showDeparturesModal(html, now);
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

      upsertDeparturesButton(container, lineas, ctx);

      if (!sentidoSel) return;

      await mostrarRutaLinea(currentLineaSel, { sentido: currentSentido }, ctx);
      return;
    }
  };
}

/* =====================================================
   MOSTRAR RUTA (RURAL)
   ✅ Usa esquema A para "Entra Sevilla"
   ✅ Usa esquema B (lineasruralpasan+numeral) para el resto
===================================================== */
export async function mostrarRutaLinea(linea, opts = {}, ctx = {}) {
  clearTransportLayers();
  setCurrentLinea(linea);

  const sentidoSel = titleCase(normStr(opts.sentido));
  const sentidoLower = normStr(sentidoSel);

  // ✅ clave: dataset de paradas según esquema
  const paradasRaw = usesSevillaSchema(linea)
    ? await getParadasByLinea(linea.codigo, { ...ctx, tipo: "rural", sentido: sentidoSel })
    : await getParadasRuralesByLineaPasan(linea.codigo);

  if (!paradasRaw?.length) return;

const ordered = buildOrderedStopsForLinea(paradasRaw, sentidoLower, linea);
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

  if (!ctx?.preserveLayers) clearTransportLayers();

  const now = (ctx?.now instanceof Date) ? ctx.now : new Date();
  const destLoc = [destPlace.ubicacion.latitude, destPlace.ubicacion.longitude];

  // ✅ FIX: respetar geoFilter salvo casos especiales
  const lineas = await getLineasByTipo("rural", {
    ...ctx,
    ignoreGeoFilter: ctx?.ignoreGeoFilter === true || ctx?.specialSevilla === true
  });

  if (!lineas?.length) {
    if (ui?.infoEl && !ctx?.dryRun) ui.infoEl.innerHTML = "❌ No hay líneas rurales disponibles.";
    return null;
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

        // ✅ esquema A/B según linea.denominacion
        const ordered = buildOrderedStopsForLinea(baseStops, sentidoLower, linea);
        const paradas = cutStopsAtFinDeRuta(ordered, sentidoLower);

        const coords = paradas.map(getParadaLatLng).filter(Boolean);
        if (coords.length < 2) continue;

        const visibles = paradas.filter(isMarcadorVisible);
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

        // BAJADA: SOLO después de idxBoard
        const candidates = [];
        for (let i = idxBoard + 1; i < paradas.length; i++) {
          const ll = getParadaLatLng(paradas[i]);
          if (!ll) continue;

          const dLine = distMeters(destLoc, ll);
          if (dLine <= maxDest) {
            candidates.push({ idx: i, ll, dLine, stop: paradas[i] });
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

          const dtMin = nextDepartureDeltaMin(linea, sentidoLower, now);

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

        const dtMin = nextDepartureDeltaMin(linea, sentidoLower, now);

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

  // subir/bajar
  L.circleMarker(best.boardLL, {
    radius: 10, color: "#2e7d32", fillColor: "#2e7d32", fillOpacity: 1, weight: 3
  }).addTo(layerStops).bindPopup(`<b>✅ Subir aquí</b><br>${best.boardLabel}`);

  L.circleMarker(best.alightLL, {
    radius: 10, color: "#c62828", fillColor: "#c62828", fillOpacity: 1, weight: 3
  }).addTo(layerStops).bindPopup(`<b>⛔ Bajar aquí</b><br>${best.alightLabel}`);

  // caminata a subir
  await drawDashedAccessRoute(userLoc, best.boardLL, "#666");

  // ruta bus SOLO hasta la bajada
  const ruralLine = await drawLineRouteFollowingStreets(best.tramoCoords, best.linea.color || "#000");
  if (ruralLine) routesGroup.addLayer(ruralLine);

  // final: caminar si <=700, caso contrario auto (DENTRO DEL routesGroup)
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
  return { tipo: "rural", linea: best.linea, sentido: titleCase(normStr(best.sentido)), useAuto: best.useAuto, score: best.score };
}