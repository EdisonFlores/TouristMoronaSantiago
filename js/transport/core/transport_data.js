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
   HELPERS HORARIO
========================== */
function isWeekend(now = new Date()) {
  const d = now.getDay(); // 0 dom ... 6 sab
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

/**
 * ¿Está operativa ahora?
 * - Semana: horario_inicio / horario_fin
 * - Finde:
 *   - si trae horariofinsem (array de rangos "HH:MM a HH:MM"), valida por rangos
 *   - si no trae, usa horario_inicio/horario_fin como fallback
 */
export function isLineOperatingNow(linea, now = new Date()) {
  if (!linea?.activo) return false;

  const cur = nowMinutes(now);
  const wknd = isWeekend(now);

  if (wknd && Array.isArray(linea.horariofinsem) && linea.horariofinsem.length) {
    for (const r of linea.horariofinsem) {
      const rr = parseRangeES(r);
      if (!rr) continue;
      // rango normal (no cruza medianoche)
      if (rr.start <= cur && cur <= rr.end) return true;
    }
    return false;
  }

  // fallback horario normal
  const ini = parseHHMM(linea.horario_inicio);
  const fin = parseHHMM(linea.horario_fin);
  if (ini == null || fin == null) return true; // si no hay datos, no bloqueamos

  if (ini <= fin) return cur >= ini && cur <= fin;

  // si cruzara medianoche (raro en tus datos, pero por seguridad)
  return cur >= ini || cur <= fin;
}

export function formatLineScheduleHTML(linea) {
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
   LÍNEAS (filtradas) para el app
   ctx: { canton, parroquia }
========================== */
export async function getLineasByTipo(tipo, ctx = {}) {
  const t = normStr(tipo);
  const snap = await getDocs(collection(db, "lineas_transporte"));
  const out = [];

  const cantonSel = normKey(ctx?.canton);
  const parroquiaSel = normKey(ctx?.parroquia); // en tu BD: ciudadpasa = parroquias

  snap.forEach(d => {
    const l = d.data();
    if (!l?.activo) return;
    if (normStr(l.tipo) !== t) return;

    // filtro cantón
    if (cantonSel) {
      const cantones = toNormArrayKey(l.cantonpasa);
      const ok = cantones.includes(cantonSel) || normKey(l.canton) === cantonSel;
      if (!ok) return;
    }

    // filtro parroquia (ciudadpasa)
    if (parroquiaSel) {
      const parroquias = toNormArrayKey(l.ciudadpasa);
      const ok = parroquias.includes(parroquiaSel) || normKey(l.ciudad) === parroquiaSel;
      if (!ok) return;
    }

    out.push({ id: d.id, ...l });
  });

  return out;
}

/**
 * ✅ Necesaria para la UI de “líneas”: trae TODAS (aunque estén fuera de servicio),
 * pero sí respeta canton/pasa + parroquia/pasa (zona).
 */
export async function getLineasByTipoAll(tipo, ctx = {}) {
  return getLineasByTipo(tipo, ctx);
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
