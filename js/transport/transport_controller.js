import { getUserLocation } from "../app/state.js";
import { map } from "../map/map.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "../services/firebase.js";

let layerLineas = null;       // ruta bus (siguiendo calles)
let layerParadas = null;      // layerGroup de paradas
let layerUserToStop = null;   // ruta entrecortada usuario -> parada cercana
let countdownTimer = null;    // interval para actualizar countdown

// =========================
// Config horario municipal
// =========================
const HORARIO_INICIO = "06:00";
const HORARIO_FIN = "19:30";

// Intervalos (min)
const INTERVALO_SEMANA_MIN = 14; // 13–15 -> promedio
const INTERVALO_FINDE_MIN = 24;

// Velocidad comercial (km/h) para offsets si OSRM no da duration
const VELOCIDAD_COMERCIAL_KMH = 16.5;

/* =====================================================
   HELPERS TIEMPO
===================================================== */
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function pad2(n) {
  return String(n).padStart(2, "0");
}
function minutesToHHMM(min) {
  const h = Math.floor(min / 60) % 24;
  const m = Math.floor(min % 60);
  return `${pad2(h)}:${pad2(m)}`;
}
function isWeekend(date = new Date()) {
  const d = date.getDay(); // 0=domingo,6=sábado
  return d === 0 || d === 6;
}
function getHeadwayMinutes(date = new Date()) {
  return isWeekend(date) ? INTERVALO_FINDE_MIN : INTERVALO_SEMANA_MIN;
}
function calcNextArrivalForStop(offsetMin, date = new Date()) {
  const startMin = toMinutes(HORARIO_INICIO);
  const endMin = toMinutes(HORARIO_FIN);

  const nowMin = date.getHours() * 60 + date.getMinutes();
  const headway = getHeadwayMinutes(date);

  const firstAtStop = startMin + Math.round(offsetMin);

  if (nowMin < firstAtStop) {
    return { nextMin: firstAtStop, inService: firstAtStop <= endMin };
  }
  if (nowMin > endMin) {
    return { nextMin: null, inService: false };
  }

  const elapsed = nowMin - firstAtStop;
  const k = Math.floor(elapsed / headway) + 1;
  const nextMin = firstAtStop + k * headway;

  return { nextMin: nextMin <= endMin ? nextMin : null, inService: nextMin <= endMin };
}
function formatCountdownSeconds(seconds) {
  if (seconds < 0) seconds = 0;
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${mm}:${pad2(ss)}`;
}

/* =====================================================
   HELPERS OSRM
===================================================== */
async function osrmRoute(profile, coordsLngLat) {
  const coordsStr = coordsLngLat.map(c => `${c[0]},${c[1]}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/${profile}/${coordsStr}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  const json = await res.json();
  if (!json.routes?.length) return null;
  return json.routes[0];
}

/* =====================================================
   LIMPIEZA
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
  if (layerUserToStop) {
    map.removeLayer(layerUserToStop);
    layerUserToStop = null;
  }
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

/* =====================================================
   CARGAR LÍNEAS POR TIPO
===================================================== */
export async function cargarLineasTransporte(tipo, container) {
  // al cambiar tipo: limpiar todo transporte anterior
  clearTransportLayers();
  container.innerHTML = "";

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
    container.innerHTML = "<p class='small mb-0'>No hay líneas disponibles.</p>";
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
   MOSTRAR RUTA DE UNA LÍNEA (SIGUIENDO CALLES)
===================================================== */
export async function mostrarRutaLinea(linea) {
  clearTransportLayers();

  // 1) Traer paradas
  const snap = await getDocs(collection(db, "paradas_transporte"));
  const paradas = [];

  snap.forEach(d => {
    const p = d.data();
    if (p.activo && p.codigo_linea === linea.codigo && p.ubicacion) {
      paradas.push(p);
    }
  });

  if (!paradas.length) return;

  // 2) Ordenar paradas
  paradas.sort((a, b) => (a.orden || 0) - (b.orden || 0));

  // 3) Ruta OSRM cerrando el ciclo
  const coords = paradas.map(p => [p.ubicacion.longitude, p.ubicacion.latitude]);
  coords.push(coords[0]);

  const routeBus = await osrmRoute("driving", coords);

  if (routeBus) {
    layerLineas = L.polyline(
      routeBus.geometry.coordinates.map(c => [c[1], c[0]]),
      { color: linea.color || "#000", weight: 4 }
    ).addTo(map);
    map.fitBounds(layerLineas.getBounds());
  } else {
    // fallback si OSRM falla
    const latlngs = coords.map(c => [c[1], c[0]]);
    layerLineas = L.polyline(latlngs, { color: linea.color || "#000", weight: 4 }).addTo(map);
    map.fitBounds(layerLineas.getBounds());
  }

  // 4) Paradas + tooltip + countdown
  layerParadas = L.layerGroup().addTo(map);

  // Duración total (min) para offsets
  let totalTripMinutes = routeBus?.duration ? (routeBus.duration / 60) : null;

  if (!totalTripMinutes) {
    // estimación por distancia entre paradas + velocidad comercial
    let totalMeters = 0;
    for (let i = 0; i < paradas.length - 1; i++) {
      const a = paradas[i].ubicacion;
      const b = paradas[i + 1].ubicacion;
      totalMeters += map.distance([a.latitude, a.longitude], [b.latitude, b.longitude]);
    }
    const km = totalMeters / 1000;
    totalTripMinutes = (km / VELOCIDAD_COMERCIAL_KMH) * 60;
  }

  const n = paradas.length;
  const offsets = paradas.map((_, i) => (n <= 1 ? 0 : (i / (n - 1)) * totalTripMinutes));

  // meta de markers para actualizar countdown
  const markerMeta = [];

  paradas.forEach((p, i) => {
    const { latitude, longitude } = p.ubicacion;
    const latlng = [latitude, longitude];

    const idNext = `next_${linea.codigo}_${i}`;
    const idCd = `cd_${linea.codigo}_${i}`;

    const marker = L.circleMarker(latlng, {
      radius: 6,
      color: linea.color || "#000",
      fillOpacity: 0.9
    }).addTo(layerParadas);

    marker.bindTooltip(
      `
      <div style="min-width:190px">
        <strong>${linea.nombre}</strong><br>
        Parada #${p.orden ?? (i + 1)}<br>
        🕒 Próximo: <span id="${idNext}">--:--</span><br>
        ⏳ Faltan: <span id="${idCd}">--:--</span>
        <br>
        <strong>El tiempo de llegada es aproximado y puede variar según el tráfico.</strong><br>
        
      </div>
      `,
      { sticky: true }
    );

    markerMeta.push({
      marker,
      stop: p,
      offsetMin: offsets[i],
      idNext,
      idCd
    });
  });

  // 5) Resaltar la parada más cercana (SIN crear marcador extra)
  const nearestMeta = getNearestMeta(markerMeta);
  if (nearestMeta) {
    highlightNearestMarker(nearestMeta, linea);
    await drawDashedUserRouteToStop(nearestMeta.stop);
  }

  // 6) Countdown updater
  startCountdownUpdater(markerMeta);
}

/* =====================================================
   PARADA MÁS CERCANA (META)
===================================================== */
function getNearestMeta(markerMeta) {
  const user = getUserLocation();
  if (!user) return null;

  let nearest = null;
  let minDist = Infinity;

  markerMeta.forEach(m => {
    const { latitude, longitude } = m.stop.ubicacion;
    const d = map.distance(user, [latitude, longitude]);
    if (d < minDist) {
      minDist = d;
      nearest = m;
    }
  });

  return nearest;
}

/**
 * Resalta el MISMO marcador de la parada más cercana (con la misma info)
 * y abre el tooltip.
 */
function highlightNearestMarker(meta, linea) {
  meta.marker.setStyle({
    radius: 11,
    color: "#FFD700",
    fillColor: "#FFD700",
    fillOpacity: 1
  });

  // Tooltip ya tiene toda la info, lo abrimos
  meta.marker.openTooltip();

  // Popup opcional (si lo quieres)
  meta.marker.bindPopup(`🚏 Parada más cercana<br><b>${linea.nombre}</b>`).openPopup();
}

/* =====================================================
   RUTA ENTRE CORTADA usuario -> parada (por calles)
===================================================== */
async function drawDashedUserRouteToStop(stop) {
  const user = getUserLocation();
  if (!user) return;

  if (layerUserToStop) {
    map.removeLayer(layerUserToStop);
    layerUserToStop = null;
  }

  const from = [user[1], user[0]]; // lng,lat
  const to = [stop.ubicacion.longitude, stop.ubicacion.latitude];

  const route = await osrmRoute("foot", [from, to]);
  if (!route) return;

  layerUserToStop = L.polyline(
    route.geometry.coordinates.map(c => [c[1], c[0]]),
    {
      color: "#666",
      weight: 4,
      dashArray: "8 10",
      opacity: 0.9
    }
  ).addTo(map);
}

/* =====================================================
   COUNTDOWN (1s)
===================================================== */
function startCountdownUpdater(markerMeta) {
  updateCountdown(markerMeta);

  countdownTimer = setInterval(() => {
    updateCountdown(markerMeta);
  }, 1000);
}

function updateCountdown(markerMeta) {
  const now = new Date();

  markerMeta.forEach(meta => {
    const { nextMin, inService } = calcNextArrivalForStop(meta.offsetMin, now);

    const elNext = document.getElementById(meta.idNext);
    const elCd = document.getElementById(meta.idCd);

    if (!elNext || !elCd) return;

    if (!inService || nextMin == null) {
      elNext.textContent = "Fuera";
      elCd.textContent = "--:--";
      return;
    }

    elNext.textContent = minutesToHHMM(nextMin);

    const nowSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const nextSeconds = (Math.floor(nextMin / 60) * 3600) + ((nextMin % 60) * 60);
    const diff = nextSeconds - nowSeconds;

    elCd.textContent = formatCountdownSeconds(diff);
  });
}
