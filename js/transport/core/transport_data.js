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

// "05:22 a 20:52" / "05:22 - 20:52" / "05:22 – 20:52"
function parseRangeAny(s) {
  const t = String(s || "").trim();
  const m = t.match(/(\d{1,2}:\d{2})\s*(?:a|-|–)\s*(\d{1,2}:\d{2})/i);
  if (!m) return null;
  const start = parseHHMM(m[1]);
  const end = parseHHMM(m[2]);
  if (start == null || end == null) return null;
  return { start, end };
}

// "15 a 30 minutos" / "15-30" / "15 min"
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
   DÍAS (RURAL / GENERAL)
========================== */
function normDias(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function isOperatingTodayByDias(linea, now = new Date()) {
  const dias = normDias(linea?.dias);
  if (!dias) return true;

  if (dias.includes("lunes a domingo") || dias.includes("todos") || dias.includes("diario")) return true;

  const day = now.getDay(); // 0 dom ... 6 sab
  const isWk = day >= 1 && day <= 5;

  if (dias.includes("lunes a viernes")) return isWk;

  const hasLun = dias.includes("lunes");
  const hasMar = dias.includes("martes");
  const hasMie = dias.includes("miercoles") || dias.includes("miércoles");
  const hasJue = dias.includes("jueves");
  const hasVie = dias.includes("viernes");
  const hasSab = dias.includes("sabado") || dias.includes("sábado");
  const hasDom = dias.includes("domingo");

  const any = hasLun || hasMar || hasMie || hasJue || hasVie || hasSab || hasDom;
  if (!any) return true;

  if (day === 1) return hasLun;
  if (day === 2) return hasMar;
  if (day === 3) return hasMie;
  if (day === 4) return hasJue;
  if (day === 5) return hasVie;
  if (day === 6) return hasSab;
  if (day === 0) return hasDom;

  return true;
}

/* ==========================
   OPERATIVIDAD
========================== */
export function isLineOperatingNow(linea, now = new Date()) {
  if (!linea?.activo) return false;

  // respeta días si existe
  if (!isOperatingTodayByDias(linea, now)) return false;

  const tipo = normStr(linea?.tipo);
  const cur = nowMinutes(now);

  // RURAL
  if (tipo === "rural") {
    const ida = Array.isArray(linea.horario_ida) ? linea.horario_ida : [];
    const ret = Array.isArray(linea.horario_retorno) ? linea.horario_retorno : [];

    const all = [...ida, ...ret].map(parseHHMM).filter(v => v != null).sort((a, b) => a - b);
    if (all.length) {
      const first = all[0];
      const last = all[all.length - 1];
      if (first <= last) return cur >= first && cur <= last;
      return cur >= first || cur <= last;
    }

    const ini = parseHHMM(linea?.horario_inicio);
    const fin = parseHHMM(linea?.horario_fin);
    if (ini != null && fin != null) {
      if (ini <= fin) return cur >= ini && cur <= fin;
      return cur >= ini || cur <= fin;
    }

    const r = parseRangeAny(linea?.horario);
    if (!r) return true;
    if (r.start <= r.end) return cur >= r.start && cur <= r.end;
    return cur >= r.start || cur <= r.end;
  }

  // URBANO
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

  const esc = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");

  // RURAL
  if (tipo === "rural") {
    const dias = String(linea?.dias || "").trim() || "(sin dato)";

    const ida = Array.isArray(linea?.horario_ida) ? linea.horario_ida : [];
    const ret = Array.isArray(linea?.horario_retorno) ? linea.horario_retorno : [];

    const hasList =
      ida.some(x => parseHHMM(x) != null) || ret.some(x => parseHHMM(x) != null);

    if (hasList) {
      const fmtItems = (arr) => {
        const clean = (arr || []).map(x => String(x || "").trim()).filter(Boolean);
        if (!clean.length) return `<li>(sin horarios)</li>`;
        return clean.map(x => `<li>${esc(x)}</li>`).join("");
      };

      return `
        <div class="mb-2"><b>🗓️ Días:</b> ${esc(dias)}</div>
        <div style="display:flex; gap:14px; align-items:flex-start">
          <div style="flex:1">
            <div style="font-weight:600; margin-bottom:6px">🧭 Ida</div>
            <ul style="margin:0; padding-left:18px">${fmtItems(ida)}</ul>
          </div>
          <div style="flex:1">
            <div style="font-weight:600; margin-bottom:6px">🔁 Retorno</div>
            <ul style="margin:0; padding-left:18px">${fmtItems(ret)}</ul>
          </div>
        </div>
      `;
    }

    const hIni = String(linea?.horario_inicio || "").trim();
    const hFin = String(linea?.horario_fin || "").trim();

    const fmin = Number(linea?.frecuencia_min);
    const fmax = Number(linea?.frecuencia_max);

    const horarioTxt = (hIni && hFin) ? `${esc(hIni)} a ${esc(hFin)}` : "(sin horario)";

    let freqTxt = "(sin dato)";
    if (Number.isFinite(fmin) && fmin > 0 && Number.isFinite(fmax) && fmax > 0) {
      freqTxt = `${fmin} - ${fmax} min`;
    } else if (Number.isFinite(fmin) && fmin > 0) {
      freqTxt = `${fmin} min`;
    } else {
      const fr = parseFreqRange(linea?.frecuencia);
      if (fr) freqTxt = (fr.min === fr.max) ? `${fr.min} min` : `${fr.min} - ${fr.max} min`;
    }

    return `
      <div class="mb-2"><b>🗓️ Días:</b> ${esc(dias)}</div>
      <div class="mb-2"><b>🕒 Horario:</b> ${horarioTxt}</div>
      <div class="mb-2"><b>⏱️ Frecuencia:</b> ${esc(freqTxt)}</div>
    `;
  }

  // URBANO
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
   ctx.ignoreGeoFilter => trae TODO
========================== */
export async function getLineasByTipo(tipo, ctx = {}) {
  const t = normStr(tipo);
  const collection = (t === "rural") ? "lineas_rurales" : "lineas_transporte";
  const all = await getCollectionCache(collection);

  if (ctx?.ignoreGeoFilter) {
    return (Array.isArray(all) ? all : []).filter(l => l?.activo && normStr(l?.tipo) === t);
  }

  const cantonSel = normKey(ctx?.canton);
  const parroquiaSel = normKey(ctx?.parroquia);

  const out = [];

  (Array.isArray(all) ? all : []).forEach(l => {
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

export async function getLineasByTipoAll(tipo, ctx = {}) {
  return getLineasByTipo(tipo, ctx);
}

/* ==========================
   PARADAS (cacheadas)
========================== */
export async function getParadasByLinea(codigoLinea, ctx = {}) {
  const tipo = normStr(ctx?.tipo);

  // ✅ RURAL: paradas_rurales
  if (tipo === "rural") {
    const all = await getCollectionCache("paradas_rurales");
    const paradas = [];

    const sentidoSel = normStr(ctx?.sentido);
    const codeNeed = normStr(codigoLinea);

    (Array.isArray(all) ? all : []).forEach(p => {
      if (!p?.activo) return;
      if (normStr(p?.tipo) !== "rural") return;

      // ✅ case-insensitive match en lineasruralpasan
      const lineas = Array.isArray(p?.lineasruralpasan) ? p.lineasruralpasan : [];
      const okLinea = lineas.some(x => normStr(x) === codeNeed);
      if (!okLinea) return;

      if (sentidoSel) {
        if (normStr(p?.sentido) !== sentidoSel) return;
      }

      paradas.push(p);
    });

    paradas.sort((a, b) => (Number(a?.numeral) || 0) - (Number(b?.numeral) || 0));
    return paradas;
  }

  // ✅ URBANO
  const all = await getCollectionCache("paradas_transporte");
  const paradas = [];

  (Array.isArray(all) ? all : []).forEach(p => {
    if (p?.activo && p.codigo_linea === codigoLinea) paradas.push(p);
  });

  paradas.sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0));
  return paradas;
}
