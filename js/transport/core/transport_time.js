// js/transport/core/transport_time.js
import { map } from "../../map/map.js";
import { getCurrentLinea, getCurrentParadas, getCurrentStopOffsets } from "./transport_state.js";

/* =====================================================
   PARSEO DE CÓDIGO (prefijo+numeral) PARA OFFSETS
   ✅ key única: "prefijo:num" evita colisiones (pfi1 vs pfis1)
===================================================== */
function parseCodigoParts(codigo) {
  const c = String(codigo || "").trim().toLowerCase();
  const m = c.match(/^([a-z_]+?)(\d+)$/);
  if (!m) return { prefix: c, num: null };
  return { prefix: m[1], num: Number(m[2]) };
}

function getOrdenKey(p) {
  // ✅ RURAL con campo numeral (prioridad)
  const num = Number(p?.numeral);
  if (Number.isFinite(num)) return String(num);

  // urbano: usa orden numérico si existe
  const o = Number(p?.orden);
  if (Number.isFinite(o)) return String(o);

  // fallback: usa prefijo:num (por compatibilidad)
  const { prefix, num: n2 } = parseCodigoParts(p?.codigo);
  if (!Number.isFinite(n2)) return null;
  return `${prefix}:${n2}`;
}

/* =====================================================
   TIMER popup
===================================================== */
let activePopupTimer = null;
let activePopupMarker = null;
let activePopupParada = null;

export function stopPopupLiveUpdate() {
  if (activePopupTimer) {
    clearInterval(activePopupTimer);
    activePopupTimer = null;
  }
  activePopupMarker = null;
  activePopupParada = null;
}

export function startPopupLiveUpdate(marker, parada) {
  stopPopupLiveUpdate();
  activePopupMarker = marker;
  activePopupParada = parada;

  tickPopupUpdate();
  activePopupTimer = setInterval(tickPopupUpdate, 1000);
}

function tickPopupUpdate() {
  const linea = getCurrentLinea();
  const paradas = getCurrentParadas();
  if (!activePopupMarker || !activePopupParada || !linea) return;

  if (!(activePopupMarker.isPopupOpen && activePopupMarker.isPopupOpen())) {
    stopPopupLiveUpdate();
    return;
  }

  const popup = activePopupMarker.getPopup();
  const el = popup?.getElement?.();
  if (!el) return;

  const info = getNextBusInfoForStop(linea, paradas, activePopupParada, new Date());

  if (!info.activo) {
    activePopupMarker.setPopupContent(buildStopPopupHTML(activePopupParada, linea));
    return;
  }

  const nextSpan = el.querySelector(".js-nextbus");
  const cdSpan = el.querySelector(".js-countdown");

  if (nextSpan) nextSpan.textContent = info.proximaHHMM;

  // ✅ rural: min / horas / días; urbano: formato original
  const tipo = String(linea?.tipo || "").toLowerCase();
  if (cdSpan) cdSpan.textContent = (tipo === "rural")
    ? formatCountdownSmart(info.countdown)
    : formatCountdown(info.countdown);
}

/* =====================================================
   UTIL tiempo
===================================================== */
function isWeekend(date = new Date()) {
  const d = date.getDay();
  return d === 0 || d === 6;
}

function timeToMinutesStrict(t) {
  const m = String(t || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
  return h * 60 + mm;
}

function minutesToHHMM(m) {
  const mmInt = Math.max(0, Math.round(Number(m) || 0));
  const h = Math.floor(mmInt / 60) % 24;
  const min = mmInt % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

// ✅ urbano (original)
export function formatCountdown(sec) {
  const s = Math.max(0, Math.floor(sec));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  if (mm <= 0) return `${ss}s`;
  return `${mm}m ${String(ss).padStart(2, "0")}s`;
}

// ✅ rural: en minutos; si pasa 60 => horas; si pasa 24h => días
function formatCountdownSmart(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const totalMin = Math.ceil(s / 60);

  if (totalMin < 60) return `${totalMin} min`;

  const totalH = Math.floor(totalMin / 60);
  const remMin = totalMin % 60;

  if (totalH < 24) {
    if (remMin === 0) return `${totalH} h`;
    return `${totalH} h ${remMin} min`;
  }

  const days = Math.floor(totalH / 24);
  const remH = totalH % 24;

  if (remH === 0 && remMin === 0) return `${days} d`;
  if (remMin === 0) return `${days} d ${remH} h`;
  return `${days} d ${remH} h ${remMin} min`;
}

/* =====================================================
   Ventanas fin de semana (urbano)
===================================================== */
function parseWindow(str) {
  const m = String(str || "").match(/(\d{1,2}:\d{2})\s*(?:a|-|–)\s*(\d{1,2}:\d{2})/i);
  if (!m) return null;
  const a = timeToMinutesStrict(m[1]);
  const b = timeToMinutesStrict(m[2]);
  if (a == null || b == null) return null;
  return { startMin: a, endMin: b };
}

function getServiceWindowsUrbano(linea, now) {
  if (isWeekend(now) && Array.isArray(linea?.horariofinsem) && linea.horariofinsem.length) {
    const windows = linea.horariofinsem.map(parseWindow).filter(Boolean);
    if (windows.length) return windows;
  }

  return [{
    startMin: timeToMinutesStrict(linea?.horario_inicio || "06:00") ?? 360,
    endMin: timeToMinutesStrict(linea?.horario_fin || "19:30") ?? 1170,
  }];
}

function pickActiveWindow(windows, nowMin) {
  return windows.find(w => nowMin >= w.startMin && nowMin <= w.endMin) || null;
}

/* =====================================================
   ✅ HELPERS RURAL (lr15)
===================================================== */
function parseRangeAny(s) {
  const t = String(s || "").trim();
  const m = t.match(/(\d{1,2}:\d{2})\s*(?:a|-|–)\s*(\d{1,2}:\d{2})/i);
  if (!m) return null;
  const a = timeToMinutesStrict(m[1]);
  const b = timeToMinutesStrict(m[2]);
  if (a == null || b == null) return null;
  return { startMin: a, endMin: b };
}

function parseFreqRange(s) {
  const t = String(s || "").toLowerCase();
  const nums = t.match(/\d+/g)?.map(Number).filter(n => Number.isFinite(n) && n > 0) || [];
  if (!nums.length) return null;
  if (nums.length === 1) return { min: nums[0], max: nums[0] };
  const a = Math.min(nums[0], nums[1]);
  const b = Math.max(nums[0], nums[1]);
  return { min: a, max: b };
}

/* =====================================================
   Headway (urbano)
===================================================== */
function computeHeadwayMin(linea, paradasOrdenadas, now) {
  const weekendFreq = Number(linea?.frecuenciafinsem);
  const weekdayFreq = Number(linea?.frecuencia_min);

  if (isWeekend(now) && Number.isFinite(weekendFreq) && weekendFreq > 0) return weekendFreq;
  if (!isWeekend(now) && Number.isFinite(weekdayFreq) && weekdayFreq > 0) return weekdayFreq;

  const cupo = Math.max(1, Number(linea?.cupo) || 1);
  const speedKmH = Number(linea?.velocidad_promedio) || 16.5;

  let totalMeters = 0;
  for (let i = 1; i < paradasOrdenadas.length; i++) {
    const a = paradasOrdenadas[i - 1]?.ubicacion;
    const b = paradasOrdenadas[i]?.ubicacion;
    if (!a || !b) continue;
    totalMeters += map.distance([a.latitude, a.longitude], [b.latitude, b.longitude]);
  }

  const totalKm = totalMeters / 1000;
  const oneWayMin = speedKmH > 0 ? (totalKm / speedKmH) * 60 : 0;
  const cycleMin = oneWayMin * 2;

  const headway = cycleMin > 0 ? (cycleMin / cupo) : 15;
  return Math.max(3, Math.round(headway));
}

/* =====================================================
   ✅ Offsets por parada (incluye referenciales con orden null)
   ✅ Usa key = getOrdenKey(p)
===================================================== */
export function computeStopOffsets(paradasOrdenadas, linea) {
  const offsets = new Map();

  const speedKmH = Number(linea?.velocidad_promedio) || 16.5;
  const speedMPerMin = (speedKmH * 1000) / 60;

  let accMin = 0;
  let hasFirst = false;

  for (let i = 0; i < paradasOrdenadas.length; i++) {
    const p = paradasOrdenadas[i];
    const key = getOrdenKey(p);
    const u = p?.ubicacion;

    if (!key || !u) continue;

    if (!hasFirst) {
      offsets.set(key, 0);
      hasFirst = true;
      continue;
    }

    // buscar anterior válido
    let prev = null;
    for (let j = i - 1; j >= 0; j--) {
      const pj = paradasOrdenadas[j];
      const kj = getOrdenKey(pj);
      if (!kj || !pj?.ubicacion) continue;
      prev = pj;
      break;
    }
    if (!prev?.ubicacion) continue;

    const dMeters = map.distance(
      [prev.ubicacion.latitude, prev.ubicacion.longitude],
      [u.latitude, u.longitude]
    );

    const segMin = speedMPerMin > 0 ? (dMeters / speedMPerMin) : 0;
    accMin += segMin;

    offsets.set(key, accMin);
  }

  return offsets;
}

/* =====================================================
   Próximo bus por parada
   - URBANO: headway + windows
   - RURAL:
      A) horario_ida/horario_retorno (lista)
      B) horario + frecuencia (lr15)
   + extras rural:
      - salida desde numeral 0 (salida0HHMM)
      - llegada a última parada (llegadaFinalHHMM)
===================================================== */
function getNextBusInfoForStop(linea, paradasOrdenadas, parada, now = new Date()) {
  const tipo = String(linea?.tipo || "").toLowerCase();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const offsets = getCurrentStopOffsets();

  const keyStop = getOrdenKey(parada);
  const offsetStop = keyStop ? (offsets.get(keyStop) || 0) : 0;

  // última parada (para ETA final)
  const last = Array.isArray(paradasOrdenadas) && paradasOrdenadas.length
    ? paradasOrdenadas[paradasOrdenadas.length - 1]
    : null;
  const keyLast = last ? getOrdenKey(last) : null;
  const offsetLast = keyLast ? (offsets.get(keyLast) || 0) : 0;

  /* ==========================
     ✅ RURAL
  ========================== */
  if (tipo === "rural") {
    const sentido = String(parada?.sentido || "").toLowerCase().trim();

    const ida = Array.isArray(linea?.horario_ida) ? linea.horario_ida : [];
    const ret = Array.isArray(linea?.horario_retorno) ? linea.horario_retorno : [];

    const list = (sentido === "vuelta") ? ret : ida;

    const depMins0 = (list || [])
      .map(timeToMinutesStrict)
      .filter(m => m != null)
      .sort((a, b) => a - b);

    // -------- MODO A: lista ida/retorno --------
    if (depMins0.length) {
      // siguiente salida desde "numeral 0"
      const next0 = depMins0.find(m => m >= nowMin);

      if (next0 == null) {
        return {
          activo: false,
          proximaHHMM: null,
          countdown: null,
          freq: null,
          mensaje: "⛔ No hay más salidas hoy",
          horario: (list || []).join(", "),
        };
      }

      // llegada a esta parada
      const nextAtStop = next0 + offsetStop;
      const secLeft = (nextAtStop - nowMin) * 60 - now.getSeconds();

      return {
        activo: true,
        proximaHHMM: minutesToHHMM(nextAtStop),
        countdown: Math.max(0, secLeft),
        freq: null,
        mensaje: null,
        horario: (list || []).join(", "),
        salida0HHMM: minutesToHHMM(next0),
        llegadaFinalHHMM: minutesToHHMM(next0 + offsetLast),
      };
    }

    // -------- MODO B: lr15 (horario + frecuencia) --------
    const win = parseRangeAny(linea?.horario);
    const fr = parseFreqRange(linea?.frecuencia);

    if (!win || !fr) {
      return {
        activo: false,
        proximaHHMM: null,
        countdown: null,
        freq: null,
        mensaje: "⛔ Sin horarios válidos registrados",
        horario: "(sin horarios)",
      };
    }

    const start0 = win.startMin;         // salida desde numeral 0
    const end0 = win.endMin;

    const startAtStop = start0 + offsetStop;
    const endAtStop = end0 + offsetStop;

    if (nowMin < startAtStop) {
      const secLeft = (startAtStop - nowMin) * 60 - now.getSeconds();
      return {
        activo: true,
        proximaHHMM: minutesToHHMM(startAtStop),
        countdown: Math.max(0, secLeft),
        freq: null,
        mensaje: null,
        horario: `${minutesToHHMM(start0)} - ${minutesToHHMM(end0)} • cada ${fr.min}-${fr.max} min`,
        salida0HHMM: minutesToHHMM(start0),
        llegadaFinalHHMM: minutesToHHMM(start0 + offsetLast),
      };
    }

    if (nowMin > endAtStop) {
      return {
        activo: false,
        proximaHHMM: null,
        countdown: null,
        freq: null,
        mensaje: "⛔ Servicio finalizado por hoy",
        horario: `${minutesToHHMM(start0)} - ${minutesToHHMM(end0)}`,
      };
    }

    const freqAvg = Math.max(3, Math.round((fr.min + fr.max) / 2));
    const elapsed = nowMin - startAtStop;
    const steps = Math.floor(elapsed / freqAvg);
    const nextAtStop = startAtStop + (steps + 1) * freqAvg;

    if (nextAtStop > endAtStop) {
      return {
        activo: false,
        proximaHHMM: null,
        countdown: null,
        freq: null,
        mensaje: "⛔ Servicio finalizado por hoy",
        horario: `${minutesToHHMM(start0)} - ${minutesToHHMM(end0)}`,
      };
    }

    // reconstruir next0 desde la parada 0
    const next0 = (nextAtStop - offsetStop);
    const secLeft = (nextAtStop - nowMin) * 60 - now.getSeconds();

    return {
      activo: true,
      proximaHHMM: minutesToHHMM(nextAtStop),
      countdown: Math.max(0, secLeft),
      freq: null,
      mensaje: null,
      horario: `${minutesToHHMM(start0)} - ${minutesToHHMM(end0)} • cada ${fr.min}-${fr.max} min`,
      salida0HHMM: minutesToHHMM(next0),
      llegadaFinalHHMM: minutesToHHMM(next0 + offsetLast),
    };
  }

  /* ==========================
     ✅ URBANO
  ========================== */
  const windows = getServiceWindowsUrbano(linea, now);
  const activeWin = pickActiveWindow(windows, nowMin);
  const horarioTxt = windows
    .map(w => `${minutesToHHMM(w.startMin)} - ${minutesToHHMM(w.endMin)}`)
    .join(" | ");

  if (!activeWin) {
    return {
      activo: false,
      proximaHHMM: null,
      countdown: null,
      freq: null,
      mensaje: "⛔ Fuera de horario",
      horario: horarioTxt,
    };
  }

  const headway = computeHeadwayMin(linea, paradasOrdenadas, now);

  const startAtStop = activeWin.startMin + offsetStop;
  const endAtStop = activeWin.endMin + offsetStop;

  if (nowMin < startAtStop) {
    const secLeft = (startAtStop - nowMin) * 60 - now.getSeconds();
    return {
      activo: true,
      proximaHHMM: minutesToHHMM(startAtStop),
      countdown: Math.max(0, secLeft),
      freq: headway,
      mensaje: null,
      horario: `${minutesToHHMM(activeWin.startMin)} - ${minutesToHHMM(activeWin.endMin)}`,
    };
  }

  const elapsed = nowMin - startAtStop;
  const steps = Math.floor(elapsed / headway);
  const nextMin = startAtStop + (steps + 1) * headway;

  if (nextMin > endAtStop) {
    return {
      activo: false,
      proximaHHMM: null,
      countdown: null,
      freq: headway,
      mensaje: "⛔ Servicio finalizado por hoy",
      horario: `${minutesToHHMM(activeWin.startMin)} - ${minutesToHHMM(activeWin.endMin)}`,
    };
  }

  const secLeft = (nextMin - nowMin) * 60 - now.getSeconds();

  return {
    activo: true,
    proximaHHMM: minutesToHHMM(nextMin),
    countdown: Math.max(0, secLeft),
    freq: headway,
    mensaje: null,
    horario: `${minutesToHHMM(activeWin.startMin)} - ${minutesToHHMM(activeWin.endMin)}`,
  };
}

/* =====================================================
   HTML Popup
===================================================== */
export function buildStopPopupHTML(parada, linea) {
  const lineaAct = getCurrentLinea() || linea;
  const paradasAct = getCurrentParadas();
  const info = getNextBusInfoForStop(lineaAct, paradasAct, parada, new Date());

  const tipo = String(lineaAct?.tipo || "").toLowerCase();

  // ✅ RURAL: popup minimal según tu pedido
  if (tipo === "rural") {
    const codigoTxt = parada?.codigo
      ? `<small><b>Código:</b> ${parada.codigo}</small><br>`
      : "";

    if (!info.activo) {
      return `
        <strong>${lineaAct?.nombre || "Línea rural"}</strong><br>
        ${codigoTxt}
        ${info.mensaje || "⛔ Sin información"}<br>
        <small>${info.horario || ""}</small>
      `;
    }

    return `
      <strong>${lineaAct?.nombre || "Línea rural"}</strong><br>
      ${codigoTxt}
      🚌 Pasa en: <b><span class="js-countdown">${formatCountdownSmart(info.countdown)}</span></b><br>
      🕒 Sale desde #0: <b>${info.salida0HHMM || "--:--"}</b><br>
      ⏱️ Llega al final: <b>${info.llegadaFinalHHMM || "--:--"}</b>
    `;
  }

  // ✅ URBANO (mantener como estaba)
  const sentidoTxt = parada?.sentido ? `🧭 Sentido: ${parada.sentido}<br>` : "";
  const cobTxt = parada?.cobertura ? `🧩 Cobertura: ${parada.cobertura}<br>` : "";

  const codigoTxt = parada?.codigo
    ? `<small><b>Código:</b> ${parada.codigo}</small><br>`
    : "";

  const base = `
    <strong>${parada.nombre_linea || lineaAct.nombre || "Línea"}</strong><br>
    ${codigoTxt}
    ${Number.isFinite(Number(parada.orden)) ? `🧭 Parada #${parada.orden}<br>` : ""}
    ${sentidoTxt}
    ${cobTxt}
  `;

  if (!info.activo) {
    return base + `
      ${info.mensaje}<br>
      <small>Horario: ${info.horario}</small>
    `;
  }

  return base + `
    🚌 Próximo bus <i>(aprox.)</i> <span class="js-nextbus">${info.proximaHHMM}</span><br>
    ⏳ Llega en: <span class="js-countdown">${formatCountdown(info.countdown)}</span><br>
    <small>${info.freq ? `Intervalo aprox.: ${info.freq} min • ` : ""}Horario: ${info.horario}</small>
  `;
}
