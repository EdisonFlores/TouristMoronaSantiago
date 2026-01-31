import { getUserLocation } from "../app/state.js";
import { map } from "../map/map.js";
import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "../services/firebase.js";

/* =====================================================
   LAYERS / ESTADO
===================================================== */
let layerLineas = null;
let layerParadas = null;

// ruta (dashed) desde usuario a la parada más cercana
let layerAcceso = null;

// refs actuales
let currentLinea = null;
let currentParadas = [];
let currentStopMarkers = []; // [{ marker, parada }]

// resaltado de parada más cercana (sin marcador extra)
let nearestStopMarker = null;
let nearestStopMarkerOriginalStyle = null;

// timer por popup abierto (1 segundo)
let activePopupTimer = null;
let activePopupMarker = null;
let activePopupParada = null;

/* =====================================================
   UTIL: Sábado/Domingo
===================================================== */
function isWeekend(date = new Date()) {
  const d = date.getDay(); // 0=Dom, 6=Sáb
  return d === 0 || d === 6;
}

/* =====================================================
   UTIL: "HH:MM" -> minutos del día
===================================================== */
function timeToMinutes(t) {
  const [h, m] = String(t || "0:0").split(":").map(Number);
  return (h * 60) + (m || 0);
}

/* =====================================================
   UTIL: minutos del día -> "HH:MM"
===================================================== */
function minutesToHHMM(m) {
  const h = Math.floor(m / 60) % 24;
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/* =====================================================
   CALCULAR PRÓXIMO BUS (aprox.)
===================================================== */
function getNextBusInfo(linea, now = new Date()) {
  const inicioStr = linea?.horario_inicio || "06:00";
  const finStr = linea?.horario_fin || "19:30";

  const inicioMin = timeToMinutes(inicioStr);
  const finMin = timeToMinutes(finStr);

  const nowMin = now.getHours() * 60 + now.getMinutes();

  const freq = isWeekend(now)
    ? (Number(linea?.frecuenciafinsem) || Number(linea?.frecuencia_min) || 15)
    : (Number(linea?.frecuencia_min) || 15);

  // fuera de horario
  if (nowMin < inicioMin || nowMin > finMin) {
    return {
      activo: false,
      proximaHHMM: null,
      countdown: null,
      freq,
      mensaje: "⛔ Fuera de horario",
      horario: `${inicioStr} - ${finStr}`
    };
  }

  const elapsed = nowMin - inicioMin;
  const steps = Math.floor(elapsed / freq);
  const nextMin = inicioMin + (steps + 1) * freq;

  if (nextMin > finMin) {
    return {
      activo: false,
      proximaHHMM: null,
      countdown: null,
      freq,
      mensaje: "⛔ Servicio finalizado por hoy",
      horario: `${inicioStr} - ${finStr}`
    };
  }

  const minutesLeft = nextMin - nowMin;
  const secLeft = (minutesLeft * 60) - now.getSeconds();

  return {
    activo: true,
    proximaHHMM: minutesToHHMM(nextMin),
    countdown: Math.max(0, secLeft),
    freq,
    mensaje: null,
    horario: `${inicioStr} - ${finStr}`
  };
}

/* =====================================================
   FORMATO CUENTA REGRESIVA
===================================================== */
function formatCountdown(sec) {
  const s = Math.max(0, Math.floor(sec));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  if (mm <= 0) return `${ss}s`;
  return `${mm}m ${String(ss).padStart(2, "0")}s`;
}

/* =====================================================
   HTML POPUP (con spans para actualización live)
===================================================== */
function buildStopPopupHTML(parada, linea) {
  const info = getNextBusInfo(linea, new Date());

  const base = `
    <strong>${parada.nombre_linea || linea.nombre || "Línea"}</strong><br>
    🧭 Parada #${parada.orden}<br>
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
    <small>Frecuencia: ${info.freq} min • Horario: ${info.horario}</small>
  `;
}

/* =====================================================
   TIMER: actualiza el popup cada 1 segundo SOLO si está abierto
===================================================== */
function startPopupLiveUpdate(marker, parada) {
  stopPopupLiveUpdate();

  activePopupMarker = marker;
  activePopupParada = parada;

  // tick inmediato
  tickPopupUpdate();

  activePopupTimer = setInterval(tickPopupUpdate, 1000);
}

function stopPopupLiveUpdate() {
  if (activePopupTimer) {
    clearInterval(activePopupTimer);
    activePopupTimer = null;
  }
  activePopupMarker = null;
  activePopupParada = null;
}

function tickPopupUpdate() {
  if (!activePopupMarker || !activePopupParada || !currentLinea) return;

  // si ya no está abierto, detener
  if (!(activePopupMarker.isPopupOpen && activePopupMarker.isPopupOpen())) {
    stopPopupLiveUpdate();
    return;
  }

  const popup = activePopupMarker.getPopup();
  const el = popup?.getElement?.();
  if (!el) return;

  const info = getNextBusInfo(currentLinea, new Date());

  // fuera de horario: si cambia durante el popup, refrescamos todo el HTML
  if (!info.activo) {
    activePopupMarker.setPopupContent(buildStopPopupHTML(activePopupParada, currentLinea));
    return;
  }

  const nextSpan = el.querySelector(".js-nextbus");
  const cdSpan = el.querySelector(".js-countdown");

  if (nextSpan) nextSpan.textContent = info.proximaHHMM;
  if (cdSpan) cdSpan.textContent = formatCountdown(info.countdown);
}

/* =====================================================
   RUTA DASHED usuario -> parada (siguiendo calles OSRM)
===================================================== */
async function drawDashedAccessRoute(userLoc, stopLatLng, color = "#444") {
  // limpiar anterior
  if (layerAcceso) {
    map.removeLayer(layerAcceso);
    layerAcceso = null;
  }

  const profile = "foot";
  const url =
    `https://router.project-osrm.org/route/v1/${profile}/` +
    `${userLoc[1]},${userLoc[0]};${stopLatLng[1]},${stopLatLng[0]}?overview=full&geometries=geojson`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!data.routes?.length) return;

    const route = data.routes[0];

    layerAcceso = L.polyline(
      route.geometry.coordinates.map(c => [c[1], c[0]]),
      {
        color,
        weight: 4,
        dashArray: "8,10",
        opacity: 0.9
      }
    ).addTo(map);
  } catch (e) {
    console.error("Error OSRM acceso:", e);
  }
}

/* =====================================================
   RUTA DE LA LÍNEA SIGUIENDO CALLES (OSRM)
   - OSRM limita cantidad de puntos; lo hacemos por chunks
===================================================== */
function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchOSRMRouteChunk(latlngs, profile = "car") {
  // latlngs: [[lat,lng], ...]
  const coords = latlngs.map(p => `${p[1]},${p[0]}`).join(";");
  const url =
    `https://router.project-osrm.org/route/v1/${profile}/${coords}?overview=full&geometries=geojson`;

  const res = await fetch(url);
  const data = await res.json();
  if (!data.routes?.length) return null;
  return data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
}

async function drawLineRouteFollowingStreets(latlngs, color = "#000") {
  // limpiar ruta anterior si existía
  if (layerLineas) {
    map.removeLayer(layerLineas);
    layerLineas = null;
  }

  if (!latlngs || latlngs.length < 2) return;

  const profile = "car";

  // OSRM suele aguantar ~100 coords, pero vamos conservadores
  const MAX_POINTS = 99;

  // Para que no se “corte” entre chunks: solapamos 1 punto
  const chunks = chunkArray(latlngs, MAX_POINTS);
  const full = [];

  for (let i = 0; i < chunks.length; i++) {
    let points = chunks[i];

    // solape con el último punto del chunk anterior
    if (i > 0) {
      const prevLast = chunks[i - 1][chunks[i - 1].length - 1];
      points = [prevLast, ...points];
    }

    const geom = await fetchOSRMRouteChunk(points, profile);
    if (!geom || !geom.length) continue;

    // evitar duplicar el primer punto de cada tramo
    if (full.length && geom.length) geom.shift();

    full.push(...geom);
  }

  if (!full.length) {
    // fallback: si OSRM falla, al menos mostramos la polyline directa
    layerLineas = L.polyline(latlngs, {
      color,
      weight: 4,
      opacity: 0.9
    }).addTo(map);
    return;
  }

  layerLineas = L.polyline(full, {
    color,
    weight: 4,
    opacity: 0.9
  }).addTo(map);
}

/* =====================================================
   LIMPIEZA TOTAL TRANSPORTE
===================================================== */
export function clearTransportLayers() {
  if (layerLineas) {
    map.removeLayer(layerLineas);
    layerLineas = null;
  }
  if (layerParadas) {
    map.removeLayer(layerParadas);
    layerParadas = null;
  }
  if (layerAcceso) {
    map.removeLayer(layerAcceso);
    layerAcceso = null;
  }

  // quitar resaltado de parada cercana (sin marcador extra)
  if (nearestStopMarker && nearestStopMarkerOriginalStyle) {
    nearestStopMarker.setStyle(nearestStopMarkerOriginalStyle);
  }
  nearestStopMarker = null;
  nearestStopMarkerOriginalStyle = null;

  stopPopupLiveUpdate();

  currentLinea = null;
  currentParadas = [];
  currentStopMarkers = [];
}

/* =====================================================
   CARGAR LÍNEAS POR TIPO (urbano/rural)
===================================================== */
export async function cargarLineasTransporte(tipo, container) {
  container.innerHTML = "";
  clearTransportLayers();

  if (!tipo) return;

  const snap = await getDocs(collection(db, "lineas_transporte"));
  const lineas = [];

  snap.forEach(d => {
    const l = d.data();
    if (l.activo && String(l.tipo).toLowerCase() === String(tipo).toLowerCase()) {
      lineas.push({ id: d.id, ...l });
    }
  });

  if (!lineas.length) {
    container.innerHTML = "<p>No hay líneas disponibles</p>";
    return;
  }

  container.innerHTML = `
    <select id="select-linea" class="form-select mb-2">
      <option value="">Seleccione línea</option>
    </select>
  `;

  const select = document.getElementById("select-linea");

  lineas
    .sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0))
    .forEach(l => {
      select.innerHTML += `<option value="${l.codigo}">${l.nombre}</option>`;
    });

  select.onchange = e => {
    const codigo = e.target.value;
    const linea = lineas.find(l => l.codigo === codigo);
    if (linea) mostrarRutaLinea(linea);
  };
  

}

/* =====================================================
   MOSTRAR RUTA DE UNA LÍNEA (paradas + ruta por calles)
===================================================== */
export async function mostrarRutaLinea(linea) {
  clearTransportLayers();
  currentLinea = linea;

  const snap = await getDocs(collection(db, "paradas_transporte"));
  const paradas = [];

  snap.forEach(d => {
    const p = d.data();
    if (p.activo && p.codigo_linea === linea.codigo) {
      paradas.push(p);
    }
  });

  if (!paradas.length) return;

  paradas.sort((a, b) => a.orden - b.orden);
  currentParadas = paradas;

  layerParadas = L.layerGroup().addTo(map);
  currentStopMarkers = [];

  const coordsStops = [];

  paradas.forEach(p => {
    const { latitude, longitude } = p.ubicacion;
    const latlng = [latitude, longitude];
    coordsStops.push(latlng);

    const marker = L.circleMarker(latlng, {
      radius: 6,
      color: linea.color || "#000",
      fillOpacity: 0.9
    })
      .addTo(layerParadas)
      .bindPopup(buildStopPopupHTML(p, linea), { autoPan: true });

    // al abrir: refresca y activa el live update 1s
    marker.on("popupopen", () => {
      marker.setPopupContent(buildStopPopupHTML(p, linea));
      startPopupLiveUpdate(marker, p);
    });

    // al cerrar: detener el timer
    marker.on("popupclose", () => {
      stopPopupLiveUpdate();
    });

    currentStopMarkers.push({ marker, parada: p });
  });

  // cerrar el recorrido
  coordsStops.push(coordsStops[0]);

  // ✅ AQUÍ EL CAMBIO CLAVE: RUTA DE LA LÍNEA SIGUIENDO CALLES
  await drawLineRouteFollowingStreets(coordsStops, linea.color || "#000");

  // encuadrar
  if (layerLineas) map.fitBounds(layerLineas.getBounds());

  // resaltado + ruta dashed a parada más cercana (sin marcador extra)
  resaltarYConectarParadaMasCercana(paradas, linea);
}

/* =====================================================
   PARADA MÁS CERCANA: resaltar MISMO marker + ruta dashed
===================================================== */
function resaltarYConectarParadaMasCercana(paradas, linea) {
  const user = getUserLocation();
  if (!user) return;

  let nearest = null;
  let minDist = Infinity;

  paradas.forEach(p => {
    const { latitude, longitude } = p.ubicacion;
    const d = map.distance(user, [latitude, longitude]);
    if (d < minDist) {
      minDist = d;
      nearest = p;
    }
  });

  if (!nearest) return;

  // encontrar el marker correspondiente a esa parada
  const found = currentStopMarkers.find(x => x.parada.orden === nearest.orden);
  if (!found) return;

  // quitar resaltado previo
  if (nearestStopMarker && nearestStopMarkerOriginalStyle) {
    nearestStopMarker.setStyle(nearestStopMarkerOriginalStyle);
  }

  nearestStopMarker = found.marker;

  // guardar estilo original
  nearestStopMarkerOriginalStyle = {
    radius: nearestStopMarker.options.radius,
    color: nearestStopMarker.options.color,
    fillColor: nearestStopMarker.options.fillColor,
    fillOpacity: nearestStopMarker.options.fillOpacity,
    weight: nearestStopMarker.options.weight
  };

  // aplicar estilo resaltado (sin crear nuevo marcador)
  nearestStopMarker.setStyle({
    radius: 10,
    color: "#FFD700",
    fillColor: "#FFD700",
    fillOpacity: 1,
    weight: 3
  });

  // popup con info (y live update 1s cuando se abra)
  nearestStopMarker.bindPopup(buildStopPopupHTML(nearest, linea));

  // ruta dashed desde usuario a esta parada (siguiendo calles)
  const stopLatLng = [nearest.ubicacion.latitude, nearest.ubicacion.longitude];
  drawDashedAccessRoute(user, stopLatLng, "#666");
}

