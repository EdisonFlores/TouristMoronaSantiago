// js/transport/core/transport_time.js
import { map } from "../../map/map.js";
import { getCurrentLinea, getCurrentParadas, getCurrentStopOffsets } from "./transport_state.js";

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
  if (cdSpan) cdSpan.textContent = formatCountdown(info.countdown);
}

/* =====================================================
   UTIL tiempo
===================================================== */
function isWeekend(date = new Date()) {
  const d = date.getDay();
  return d === 0 || d === 6;
}

function timeToMinutes(t) {
  const [h, m] = String(t || "0:0").split(":").map(Number);
  return h * 60 + (m || 0);
}

function minutesToHHMM(m) {
  const mmInt = Math.max(0, Math.round(Number(m) || 0)); // evita decimales
  const h = Math.floor(mmInt / 60) % 24;
  const min = mmInt % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function formatCountdown(sec) {
  const s = Math.max(0, Math.floor(sec));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  if (mm <= 0) return `${ss}s`;
  return `${mm}m ${String(ss).padStart(2, "0")}s`;
}

/* =====================================================
   Ventanas fin de semana (horariofinsem)
===================================================== */
function parseWindow(str) {
  const m = String(str || "").match(/(\d{1,2}:\d{2})\s*(?:a|-)\s*(\d{1,2}:\d{2})/i);
  if (!m) return null;
  return { startMin: timeToMinutes(m[1]), endMin: timeToMinutes(m[2]) };
}

function getServiceWindows(linea, now) {
  if (isWeekend(now) && Array.isArray(linea?.horariofinsem) && linea.horariofinsem.length) {
    const windows = linea.horariofinsem.map(parseWindow).filter(Boolean);
    if (windows.length) return windows;
  }

  return [{
    startMin: timeToMinutes(linea?.horario_inicio || "06:00"),
    endMin: timeToMinutes(linea?.horario_fin || "19:30"),
  }];
}

function pickActiveWindow(windows, nowMin) {
  return windows.find(w => nowMin >= w.startMin && nowMin <= w.endMin) || null;
}

/* =====================================================
   Headway (intervalo)
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
   Offsets por parada
===================================================== */
export function computeStopOffsets(paradasOrdenadas, linea) {
  const offsets = new Map();
  const speedKmH = Number(linea?.velocidad_promedio) || 16.5;
  const speedMPerMin = (speedKmH * 1000) / 60;

  let accMin = 0;

  for (let i = 0; i < paradasOrdenadas.length; i++) {
    const p = paradasOrdenadas[i];
    const o = Number(p?.orden);
    const u = p?.ubicacion;

    if (!Number.isFinite(o) || !u) continue;

    if (i === 0) {
      offsets.set(o, 0);
      continue;
    }

    const prev = paradasOrdenadas[i - 1];
    if (!prev?.ubicacion) continue;

    const dMeters = map.distance(
      [prev.ubicacion.latitude, prev.ubicacion.longitude],
      [u.latitude, u.longitude]
    );

    const segMin = speedMPerMin > 0 ? (dMeters / speedMPerMin) : 0;
    accMin += segMin;

    offsets.set(o, accMin);
  }

  return offsets;
}

/* =====================================================
   Próximo bus por parada (realista)
===================================================== */
function getNextBusInfoForStop(linea, paradasOrdenadas, parada, now = new Date()) {
  const windows = getServiceWindows(linea, now);
  const nowMin = now.getHours() * 60 + now.getMinutes();

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

  const orden = Number(parada?.orden);
  const offsets = getCurrentStopOffsets();
  const offsetMin = Number.isFinite(orden) ? (offsets.get(orden) || 0) : 0;

  const startAtStop = activeWin.startMin + offsetMin;
  const endAtStop = activeWin.endMin + offsetMin;

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

  const sentidoTxt = parada?.sentido ? `🧭 Sentido: ${parada.sentido}<br>` : "";
  const cobTxt = parada?.cobertura ? `🧩 Cobertura: ${parada.cobertura}<br>` : "";

  const base = `
    <strong>${parada.nombre_linea || linea.nombre || "Línea"}</strong><br>
    🧭 Parada #${parada.orden}<br>
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
    <small>Intervalo aprox.: ${info.freq} min • Horario: ${info.horario}</small>
  `;
}
