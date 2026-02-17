// js/transport/core/transport_data.js
import { getCollectionCache } from "../../app/cache_db.js";

/* ==========================
   NORMALIZACIÓN
========================== */
export function normStr(s) {
  return String(s ?? "").trim().toLowerCase();
}

export function normKey(s) {
  const t = String(s ?? "").trim().toLowerCase();
  try {
    return t
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return t.replace(/\s+/g, " ").trim();
  }
}

export function titleCase(s) {
  const t = String(s ?? "").trim();
  if (!t) return "";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function normCobertura(v) {
  const s = normStr(v);
  if (s === "normal") return "Normal";
  if (s === "interna") return "Interna";
  if (s === "externa") return "Externa";
  return "";
}

function toNormArrayKey(v) {
  if (Array.isArray(v)) return v.map(normKey).filter(Boolean);
  if (v == null) return [];
  const s = normKey(v);
  return s ? [s] : [];
}

/* ==========================
   HELPERS HORARIO
========================== */
function isWeekend(now = new Date()) {
  const d = now.getDay();
  return d === 0 || d === 6;
}

function parseHHMM(s) {
  const m = String(s || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

function nowMinutes(now) {
  return now.getHours() * 60 + now.getMinutes();
}

// "06:00 a 08:00"
function parseRangeES(s) {
  const t = String(s || "").trim();
  const m = t.match(/(\d{1,2}:\d{2})\s*a\s*(\d{1,2}:\d{2})/i);
  if (!m) return null;
  const a = parseHHMM(m[1]);
  const b = parseHHMM(m[2]);
  if (a == null || b == null) return null;
  return { start: a, end: b };
}

// ✅ "05:22 a 20:52" / "05:22 - 20:52" / "05:22 – 20:52"
function parseRangeAny(s) {
  const t = String(s || "").trim();
  const m = t.match(/(\d{1,2}:\d{2})\s*(?:a|-|–)\s*(\d{1,2}:\d{2})/i);
  if (!m) return null;
  const start = parseHHMM(m[1]);
  const end = parseHHMM(m[2]);
  if (start == null || end == null) return null;
  return { start, end };
}

// ✅ "15 a 30 minutos" / "15-30" / "15 min"
function parseFreqRange(s) {
  const t = String(s || "").toLowerCase();
  const nums = t.match(/\d+/g)?.map(Number).filter(n => Number.isFinite(n)) || [];
  if (!nums.length) return null;
  if (nums.length === 1) return { min: nums[0], max: nums[0] };
  const a = Math.min(nums[0], nums[1]);
  const b = Math.max(nums[0], nums[1]);
  return { min: a, max: b };
}

/* ==========================
   PARSEO CÓDIGO: prefijo + numeral
   ej: "pfi11" -> {prefix:"pfi", num:11}
========================== */
function parseCodigoParts(codigo) {
  const c = String(codigo || "").trim().toLowerCase();
  const m = c.match(/^([a-z_]+?)(\d+)$/);
  if (!m) return { prefix: c, num: null };
  return { prefix: m[1], num: Number(m[2]) };
}

function getOrdenDerivado(p) {
  const o = Number(p?.orden);
  if (Number.isFinite(o)) return o;

  const { num } = parseCodigoParts(p?.codigo);
  return Number.isFinite(num) ? num : null;
}

function safeOrdenDerivado(p, fallback = 999999) {
  const n = getOrdenDerivado(p);
  return Number.isFinite(n) ? n : fallback;
}

/* ==========================
   Reglas de orden por prefijo (RURAL)
   - ida: pfi antes que pfis
   - vuelta: pfv antes que pfvs
========================== */
function prefixWeight(prefix, sentidoLower) {
  const p = String(prefix || "").toLowerCase();
  const s = String(sentidoLower || "").toLowerCase();

  if (s === "ida") {
    if (p === "pfi") return 10;
    if (p === "pfis") return 20;
  }
  if (s === "vuelta") {
    if (p === "pfv") return 10;
    if (p === "pfvs") return 20;
  }

  return 50; // otras (referenciales/ramales/etc.)
}

/* ==========================
   OPERATIVIDAD
========================== */
export function isLineOperatingNow(linea, now = new Date()) {
  if (!linea?.activo) return false;

  const tipo = normStr(linea?.tipo);

  // ✅ RURAL: (A) listas ida/retorno o (B) horario+frecuencia (lr15)
  if (tipo === "rural") {
    const ida = Array.isArray(linea.horario_ida) ? linea.horario_ida : [];
    const ret = Array.isArray(linea.horario_retorno) ? linea.horario_retorno : [];

    const anyValid =
      ida.some(x => parseHHMM(x) != null) || ret.some(x => parseHHMM(x) != null);

    if (anyValid) return true;

    const r = parseRangeAny(linea?.horario);
    if (!r) return false;

    const cur = nowMinutes(now);
    if (r.start <= r.end) return cur >= r.start && cur <= r.end;
    return cur >= r.start || cur <= r.end;
  }

  // ✅ URBANO (tu lógica)
  const cur = nowMinutes(now);
  const wknd = isWeekend(now);

  if (wknd && Array.isArray(linea.horariofinsem) && linea.horariofinsem.length) {
    for (const r of linea.horariofinsem) {
      const rr = parseRangeES(r);
      if (!rr) continue;
      if (rr.start <= cur && cur <= rr.end) return true;
    }
    return false;
  }

  const ini = parseHHMM(linea.horario_inicio);
  const fin = parseHHMM(linea.horario_fin);
  if (ini == null || fin == null) return true;

  if (ini <= fin) return cur >= ini && cur <= fin;
  return cur >= ini || cur <= fin;
}

/* ==========================
   HTML HORARIOS PARA MODAL
========================== */
export function formatLineScheduleHTML(linea) {
  const tipo = normStr(linea?.tipo);

  // ✅ RURAL
  if (tipo === "rural") {
    const dias = String(linea?.dias || "").trim() || "(sin dato)";

    const ida = Array.isArray(linea?.horario_ida) ? linea.horario_ida : [];
    const ret = Array.isArray(linea?.horario_retorno) ? linea.horario_retorno : [];

    const hasList =
      ida.some(x => parseHHMM(x) != null) || ret.some(x => parseHHMM(x) != null);

    // modo B (lr15): horario+frecuencia
    if (!hasList) {
      const r = parseRangeAny(linea?.horario);
      const fr = parseFreqRange(linea?.frecuencia);

      const horarioTxt = r ? String(linea?.horario).trim() : "(sin horario)";
      const freqTxt = fr
        ? (fr.min === fr.max
          ? `⏱️ <b>Frecuencia</b>: cada ${fr.min} min`
          : `⏱️ <b>Frecuencia</b>: cada ${fr.min}–${fr.max} min`)
        : `⏱️ <b>Frecuencia</b>: (sin dato)`;

      return `
        🗓️ <b>Días</b>: ${dias}<br>
        🕒 <b>Horario</b>: ${horarioTxt}<br>
        ${freqTxt}
      `;
    }

    // modo A: listas ida/retorno
    const fmtList = (arr) => {
      const clean = (arr || []).map(x => String(x || "").trim()).filter(Boolean);
      return clean.length ? clean.map(x => `• ${x}`).join("<br>") : "(sin horarios)";
    };

    return `
      🗓️ <b>Días</b>: ${dias}<br><br>
      🧭 <b>Ida</b>:
      <div class="mt-1">${fmtList(ida)}</div>
      <br>
      🧭 <b>Retorno</b>:
      <div class="mt-1">${fmtList(ret)}</div>
    `;
  }

  // ✅ URBANO
  const hIni = String(linea?.horario_inicio || "").trim();
  const hFin = String(linea?.horario_fin || "").trim();
  const freq = Number(linea?.frecuencia_min);
  const freqFS = Number(linea?.frecuenciafinsem);

  const weekday = (hIni && hFin)
    ? `🗓️ <b>Lun–Vie</b>: ${hIni} – ${hFin}`
    : `🗓️ <b>Lun–Vie</b>: (sin horario registrado)`;

  const freqTxt = Number.isFinite(freq)
    ? `⏱️ <b>Frecuencia</b>: cada ${freq} min`
    : `⏱️ <b>Frecuencia</b>: (sin dato)`;

  let weekend = "";
  if (Array.isArray(linea?.horariofinsem) && linea.horariofinsem.length) {
    weekend = `
      📆 <b>Fin de semana</b>:
      <div class="mt-1">${linea.horariofinsem.map(x => `• ${x}`).join("<br>")}</div>
    `;
  } else if (hIni && hFin) {
    weekend = `📆 <b>Fin de semana</b>: ${hIni} – ${hFin}`;
  } else {
    weekend = `📆 <b>Fin de semana</b>: (sin horario registrado)`;
  }

  const freqFSTxt = Number.isFinite(freqFS)
    ? `⏱️ <b>Frecuencia (FS)</b>: cada ${freqFS} min`
    : ``;

  return `
    ${weekday}<br>
    ${freqTxt}<br>
    ${weekend}<br>
    ${freqFSTxt ? `${freqFSTxt}<br>` : ""}
  `;
}

/* ==========================
   LÍNEAS (cacheadas)
   - urbano => lineas_transporte
   - rural => lineas_rurales
========================== */
export async function getLineasByTipo(tipo, ctx = {}) {
  const t = normStr(tipo);
  const collection = (t === "rural") ? "lineas_rurales" : "lineas_transporte";
  const all = await getCollectionCache(collection);

  const cantonSel = normKey(ctx?.canton);
  const parroquiaSel = normKey(ctx?.parroquia);

  const out = [];

  all.forEach(l => {
    if (!l?.activo) return;
    if (normStr(l.tipo) !== t) return;

    if (cantonSel) {
      const cantones = toNormArrayKey(l.cantonpasa);
      const ok =
        cantones.includes(cantonSel) ||
        normKey(l.canton) === cantonSel ||
        normKey(l.cantonorigen) === cantonSel;
      if (!ok) return;
    }

    if (parroquiaSel) {
      const parroquias = toNormArrayKey(l.ciudadpasa);
      const ok =
        parroquias.includes(parroquiaSel) ||
        normKey(l.ciudad) === parroquiaSel ||
        normKey(l.parroquia) === parroquiaSel;
      if (!ok) return;
    }

    out.push(l);
  });

  return out;
}

// ✅ para evitar tu error de export faltante
export async function getLineasByTipoAll(tipo, ctx = {}) {
  return getLineasByTipo(tipo, ctx);
}

/* ==========================
   PARADAS (cacheadas)
========================== */
export async function getParadasByLinea(codigoLinea, ctx = {}) {
  const tipo = normStr(ctx?.tipo);

  // =========================
  // ✅ RURAL: paradas_rurales
  // - filtra por lineasruralpasan incluye codigoLinea
  // - filtra por sentido si viene en ctx
  // - ordena por numeral (number)
  // =========================
  if (tipo === "rural") {
    const all = await getCollectionCache("paradas_rurales");
    const paradas = [];

    const sentidoSel = normStr(ctx?.sentido); // "ida" / "vuelta" (puede venir como "Ida" -> normStr ok)

    all.forEach(p => {
      if (!p?.activo) return;
      if (normStr(p?.tipo) !== "rural") return;

      const lineas = Array.isArray(p?.lineasruralpasan) ? p.lineasruralpasan : [];
      if (!lineas.includes(codigoLinea)) return;

      if (sentidoSel) {
        if (normStr(p?.sentido) !== sentidoSel) return;
      }

      paradas.push(p);
    });

    // ✅ orden REAL por numeral
    paradas.sort((a, b) => (Number(a?.numeral) || 0) - (Number(b?.numeral) || 0));
    return paradas;
  }

  // =========================
  // URBANO (como lo tenías)
  // =========================
  const all = await getCollectionCache("paradas_transporte");
  const paradas = [];

  all.forEach(p => {
    if (p?.activo && p.codigo_linea === codigoLinea) paradas.push(p);
  });

  paradas.sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0));
  return paradas;
}
