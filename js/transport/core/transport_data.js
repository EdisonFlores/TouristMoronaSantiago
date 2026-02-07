// js/transport/core/transport_data.js
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "../../services/firebase.js";

/* ==========================
   NORMALIZACIÓN FUERTE
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
   HORARIOS
========================== */
function parseHHMM(s) {
  const m = String(s || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]), mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return (hh * 60) + mm;
}

function minutesNow(now) {
  return now.getHours() * 60 + now.getMinutes();
}

function isWeekend(now) {
  const d = now.getDay(); // 0 dom, 6 sáb
  return d === 0 || d === 6;
}

// Ej: "06:00 a 08:00"
function parseRangeText(txt) {
  const t = String(txt || "").toLowerCase();
  const m = t.match(/(\d{1,2}:\d{2})\s*a\s*(\d{1,2}:\d{2})/);
  if (!m) return null;
  const a = parseHHMM(m[1]);
  const b = parseHHMM(m[2]);
  if (a == null || b == null) return null;
  return { a, b };
}

function isNowInAnyWeekendRange(linea, now) {
  if (!Array.isArray(linea?.horariofinsem) || !linea.horariofinsem.length) return null;

  const cur = minutesNow(now);
  for (const r of linea.horariofinsem) {
    const range = parseRangeText(r);
    if (!range) continue;
    if (cur >= range.a && cur <= range.b) return true;
  }
  return false;
}

/**
 * ✅ Exportada: sirve para “fuera de servicio”
 */
export function isLineOperatingNow(linea, now = new Date()) {
  if (!linea?.activo) return false;

  const weekend = isWeekend(now);

  // 1) Si es finde y trae horariofinsem => manda
  if (weekend) {
    const okByRanges = isNowInAnyWeekendRange(linea, now);
    if (okByRanges === true) return true;
    if (okByRanges === false) return false;
    // si null => no tiene horariofinsem, caemos al fallback diario
  }

  // 2) Fallback: horario_inicio/fin
  const a = parseHHMM(linea.horario_inicio);
  const b = parseHHMM(linea.horario_fin);
  if (a == null || b == null) return true; // si faltan horarios, no bloqueamos

  const cur = minutesNow(now);

  // rango normal
  if (a <= b) return cur >= a && cur <= b;

  // rango cruzando medianoche
  return cur >= a || cur <= b;
}

/* ==========================
   FILTROS POR UBICACIÓN
========================== */
function passGeoFilters(l, ctx = {}) {
  const cantonSel = normKey(ctx?.canton);
  const parroquiaSel = normKey(ctx?.parroquia); // ciudadpasa = parroquias

  // ✅ FILTRO CANTÓN
  if (cantonSel) {
    const cantones = toNormArrayKey(l.cantonpasa);
    const ok = cantones.includes(cantonSel) || normKey(l.canton) === cantonSel;
    if (!ok) return false;
  }

  // ✅ FILTRO PARROQUIA (ciudadpasa)
  if (parroquiaSel) {
    const parroquias = toNormArrayKey(l.ciudadpasa);
    const ok = parroquias.includes(parroquiaSel) || normKey(l.ciudad) === parroquiaSel;
    if (!ok) return false;
  }

  return true;
}

/* ==========================
   LÍNEAS (solo operativas)
   ctx: { canton, parroquia, now }
========================== */
export async function getLineasByTipo(tipo, ctx = {}) {
  const t = normStr(tipo);
  const snap = await getDocs(collection(db, "lineas_transporte"));
  const out = [];
  const now = (ctx?.now instanceof Date) ? ctx.now : new Date();

  snap.forEach(d => {
    const l = d.data();
    if (!l?.activo) return;
    if (normStr(l.tipo) !== t) return;

    // geo
    if (!passGeoFilters(l, ctx)) return;

    // horario
    if (!isLineOperatingNow(l, now)) return;

    out.push({ id: d.id, ...l });
  });

  return out;
}

/* ==========================
   LÍNEAS (todas, incluso fuera de servicio)
   ✅ para mostrar “fuera de servicio” en UI
========================== */
export async function getLineasByTipoAll(tipo, ctx = {}) {
  const t = normStr(tipo);
  const snap = await getDocs(collection(db, "lineas_transporte"));
  const out = [];

  snap.forEach(d => {
    const l = d.data();
    if (!l?.activo) return;
    if (normStr(l.tipo) !== t) return;
    if (!passGeoFilters(l, ctx)) return;

    out.push({ id: d.id, ...l });
  });

  return out;
}

/* ==========================
   PARADAS
========================== */
export async function getParadasByLinea(codigoLinea, ctx = {}) {
  const snap = await getDocs(collection(db, "paradas_transporte"));
  const paradas = [];

  snap.forEach(d => {
    const p = d.data();
    if (p?.activo && p.codigo_linea === codigoLinea) {
      paradas.push(p);
    }
  });

  paradas.sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0));
  return paradas;
}
