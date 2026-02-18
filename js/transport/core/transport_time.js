// js/transport/core/transport_time.js
import { map } from "../../map/map.js";
import { getCurrentLinea, getCurrentParadas, getCurrentStopOffsets } from "./transport_state.js";

/* =====================================================
   PARSEO DE CÓDIGO (prefijo+numeral) PARA OFFSETS
===================================================== */
function parseCodigoParts(codigo) {
  const c = String(codigo || "").trim().toLowerCase();
  const m = c.match(/^([a-z_]+?)(\d+)$/);
  if (!m) return { prefix: c, num: null };
  return { prefix: m[1], num: Number(m[2]) };
}

/**
 * ✅ Key estable para offsets (rural + urbano):
 * 1) numeral (si existe)
 * 2) orden (urbano)
 * 3) prefijo:num (parseado del codigo)
 */
function getOrdenKey(p) {
  const n = Number(p?.numeral);
  if (Number.isFinite(n)) return `n:${n}`;

  const o = Number(p?.orden);
  if (Number.isFinite(o)) return `o:${o}`;

  const { prefix, num } = parseCodigoParts(p?.codigo);
  if (!Number.isFinite(num)) return null;
  return `c:${prefix}:${num}`;
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

  const tipo = String(linea?.tipo || "").toLowerCase();

  // URBANO: actualizar spans (compatibilidad)
  if (tipo === "urbano") {
    const info = getNextBusInfoForStop(linea, paradas, activePopupParada, new Date());

    if (!info.activo) {
      activePopupMarker.setPopupContent(buildStopPopupHTML(activePopupParada, linea));
      return;
    }

    const nextSpan = el.querySelector(".js-nextbus");
    const cdSpan = el.querySelector(".js-countdown");

    if (nextSpan) nextSpan.textContent = info.proximaHHMM;
    if (cdSpan) cdSpan.textContent = formatCountdown(info.countdown);
    return;
  }

  // RURAL: refresco completo (popup compacto)
  activePopupMarker.setPopupContent(buildStopPopupHTML(activePopupParada, linea));
}

/* =====================================================
   UTIL tiempo
===================================================== */
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

// Urbano original
export function formatCountdown(sec) {
  const s = Math.max(0, Math.floor(sec));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  if (mm <= 0) return `${ss}s`;
  return `${mm}m ${String(ss).padStart(2, "0")}s`;
}

/**
 * ✅ Formato humano para RURAL: "X min" o "H h M min"
 */
const THRESH_MIN_TO_HOURS = 60;
function formatWaitHumanFromMinutes(minsFloat) {
  const mins = Math.max(0, Math.round(Number(minsFloat) || 0));
  if (mins < THRESH_MIN_TO_HOURS) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h} h ${m} min`;
}

/* =====================================================
   DÍAS (para que lr15 marque operativa bien)
===================================================== */
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

/* =====================================================
   ✅ FIN DE RUTA (finderuta=true) o última
===================================================== */
function getEndStop(paradasOrdenadas) {
  const fin = paradasOrdenadas?.find(p => p?.finderuta === true);
  if (fin) return fin;
  return paradasOrdenadas?.[paradasOrdenadas.length - 1] || null;
}

/* =====================================================
   ✅ Offsets por parada
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
   - URBANO: headway + windows (sin cambios)
   - RURAL:
      A) horario_ida/horario_retorno (emparejado por índice)
      B) lr15-like: horario_inicio/fin + frecuencia_min/max
===================================================== */
function isWeekend(date = new Date()) {
  const d = date.getDay();
  return d === 0 || d === 6;
}

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

function getNextBusInfoForStop(linea, paradasOrdenadas, parada, now = new Date()) {
  const tipo = String(linea?.tipo || "").toLowerCase();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const key = getOrdenKey(parada);
  const offsets = getCurrentStopOffsets();
  const offsetMin = key ? (offsets.get(key) || 0) : 0;

  /* ==========================
     ✅ RURAL (popup nuevo)
  ========================== */
  if (tipo === "rural") {
    // respeta días
    const todayOk = isOperatingTodayByDias(linea, now);
    if (!todayOk) {
      return {
        activo: false,
        operativo: false,
        proximaHHMM: null,
        countdown: null,
        depOriginHHMM: null,
        arrEndHHMM: null,
        retHHMM: null,
        mensaje: "⛔ Hoy no opera",
        modo: "dias",
      };
    }

    const sentido = String(parada?.sentido || "").toLowerCase().trim();

    const ida = Array.isArray(linea?.horario_ida) ? linea.horario_ida : [];
    const ret = Array.isArray(linea?.horario_retorno) ? linea.horario_retorno : [];

    const depList = (sentido === "vuelta") ? ret : ida;
    const retList = (sentido === "vuelta") ? ida : ret; // emparejado por índice

    const depPairs = (depList || [])
      .map((t, idx) => ({ idx, depOriginMin: timeToMinutesStrict(t) }))
      .filter(x => x.depOriginMin != null)
      .sort((a, b) => a.depOriginMin - b.depOriginMin);

    // -------- MODO A: lista ida/retorno --------
    if (depPairs.length) {
      let chosen = null;
      for (const p of depPairs) {
        const atStop = p.depOriginMin + offsetMin;
        if (atStop >= nowMin) {
          chosen = p;
          break;
        }
      }

      const lastDep = depPairs[depPairs.length - 1].depOriginMin;
      const lastAtStop = lastDep + offsetMin;

      const operativo = nowMin <= lastAtStop;

      if (!chosen) {
        return {
          activo: false,
          operativo,
          proximaHHMM: null,
          countdown: null,
          depOriginHHMM: null,
          arrEndHHMM: null,
          retHHMM: null,
          mensaje: "⛔ No hay más salidas hoy",
          modo: "lista",
        };
      }

      const depOrigin = chosen.depOriginMin;
      const atStop = depOrigin + offsetMin;
      const secLeft = (atStop - nowMin) * 60 - now.getSeconds();

      const endStop = getEndStop(paradasOrdenadas);
      const endKey = endStop ? getOrdenKey(endStop) : null;
      const endOffset = endKey ? (offsets.get(endKey) || 0) : offsetMin;

      const arrEnd = depOrigin + endOffset;

      let retHHMM = null;
      if (retList?.length) {
        const tRet = retList[chosen.idx];
        const retMin = timeToMinutesStrict(tRet);
        if (retMin != null) retHHMM = minutesToHHMM(retMin);
      }

      return {
        activo: true,
        operativo: true,
        proximaHHMM: minutesToHHMM(atStop),
        countdown: Math.max(0, secLeft),
        depOriginHHMM: minutesToHHMM(depOrigin),
        arrEndHHMM: minutesToHHMM(arrEnd),
        retHHMM,
        mensaje: null,
        modo: "lista",
      };
    }

    // -------- MODO B: lr15-like (inicio/fin + frecuencia min/max) --------
    const start = timeToMinutesStrict(linea?.horario_inicio);
    const end = timeToMinutesStrict(linea?.horario_fin);
    const fmin = Number(linea?.frecuencia_min);
    const fmax = Number(linea?.frecuencia_max);

    if (start == null || end == null || !Number.isFinite(fmin) || fmin <= 0) {
      return {
        activo: false,
        operativo: false,
        proximaHHMM: null,
        countdown: null,
        depOriginHHMM: null,
        arrEndHHMM: null,
        retHHMM: null,
        mensaje: "⛔ Sin horarios válidos registrados",
        modo: "frecuencia",
      };
    }

    const max = (Number.isFinite(fmax) && fmax > 0) ? fmax : fmin;
    const freqAvg = Math.max(3, Math.round((fmin + max) / 2));

    const startAtStop = start + offsetMin;
    const endAtStop = end + offsetMin;

    const endStop = getEndStop(paradasOrdenadas);
    const endKey = endStop ? getOrdenKey(endStop) : null;
    const endOffset = endKey ? (offsets.get(endKey) || 0) : offsetMin;

    let nextAtStop = null;
    let nextDepOrigin = null;

    if (nowMin < startAtStop) {
      nextAtStop = startAtStop;
      nextDepOrigin = start;
    } else if (nowMin > endAtStop) {
      nextAtStop = null;
      nextDepOrigin = null;
    } else {
      const elapsed = nowMin - startAtStop;
      const steps = Math.floor(elapsed / freqAvg);
      nextAtStop = startAtStop + (steps + 1) * freqAvg;
      nextDepOrigin = start + (steps + 1) * freqAvg;
      if (nextAtStop > endAtStop) {
        nextAtStop = null;
        nextDepOrigin = null;
      }
    }

    const operativo = (nowMin >= startAtStop && nowMin <= endAtStop);

    if (nextAtStop == null || nextDepOrigin == null) {
      return {
        activo: false,
        operativo,
        proximaHHMM: null,
        countdown: null,
        depOriginHHMM: null,
        arrEndHHMM: null,
        retHHMM: null,
        mensaje: "⛔ Servicio finalizado por hoy",
        modo: "frecuencia",
      };
    }

    const secLeft = (nextAtStop - nowMin) * 60 - now.getSeconds();
    const arrEnd = nextDepOrigin + endOffset;

    const retEst = nextDepOrigin + 2 * endOffset;

    return {
      activo: true,
      operativo: true,
      proximaHHMM: minutesToHHMM(nextAtStop),
      countdown: Math.max(0, secLeft),
      depOriginHHMM: minutesToHHMM(nextDepOrigin),
      arrEndHHMM: minutesToHHMM(arrEnd),
      retHHMM: minutesToHHMM(retEst),
      mensaje: null,
      modo: "frecuencia",
    };
  }

  /* ==========================
     ✅ URBANO (SIN CAMBIOS)
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
   ✅ Urbano: igual que antes
   ✅ Rural: compacto (no sobrecargado)
===================================================== */
export function buildStopPopupHTML(parada, linea) {
  const lineaAct = getCurrentLinea() || linea;
  const paradasAct = getCurrentParadas();
  const tipo = String(lineaAct?.tipo || "").toLowerCase();

  // ============ RURAL (compacto) ============
  if (tipo === "rural") {
    const info = getNextBusInfoForStop(lineaAct, paradasAct, parada, new Date());

    const nombreRuta = lineaAct?.nombre || lineaAct?.denominacion || "Ruta rural";
    const sentidoTxt = parada?.sentido ? String(parada.sentido) : "";

    const estadoTxt = info?.operativo ? "✅ Operativa" : "⛔ No operativa";

    // “Pasa en” en formato humano
    let pasaTxt = "—";
    if (info?.activo && typeof info.countdown === "number") {
      pasaTxt = formatWaitHumanFromMinutes(info.countdown / 60);
    }

    if (!info?.activo) {
      return `
        <div style="min-width:240px">
          <div><b>${nombreRuta}</b></div>
          <div>${estadoTxt}</div>
          ${sentidoTxt ? `<div>🧭 Sentido: ${sentidoTxt}</div>` : ""}
          <hr class="my-2">
          <div>${info?.mensaje || "⛔ Sin próxima salida"}</div>
        </div>
      `;
    }

    return `
      <div style="min-width:240px">
        <div><b>${nombreRuta}</b></div>
        <div>${estadoTxt}</div>
        ${sentidoTxt ? `<div>🧭 Sentido: ${sentidoTxt}</div>` : ""}
        <hr class="my-2">
        <div>🚌 <b>Pasa en:</b> ${pasaTxt}</div>

        <div style="display:flex; gap:10px; margin-top:8px">
          <div style="flex:1">
            <div><b>🕒 Ida</b></div>
            <div style="opacity:.95">${info.depOriginHHMM || "—"}</div>
          </div>
          <div style="flex:1; text-align:right">
            <div><b>🔁 Retorno</b></div>
            <div style="opacity:.95">${info.retHHMM || "—"}</div>
          </div>
        </div>

        <div style="margin-top:8px">⏱️ <b>Llega:</b> ${info.arrEndHHMM || "—"}</div>
      </div>
    `;
  }

  // ============ URBANO (SIN CAMBIOS) ============
  const info = getNextBusInfoForStop(lineaAct, paradasAct, parada, new Date());

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
