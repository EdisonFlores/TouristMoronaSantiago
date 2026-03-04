//js/script.js
/* ================= IMPORTS ================= */
import { findNearest, updateUserLocation, setTravelMode, setActivePlaceAction } from "./app/actions.js";
import { dataList, getUserLocation, getMode } from "./app/state.js";
import { translatePage } from "./app/translate.js";
import {
  map,
  baseLayers,
  markersLayer,
  routeOverlay,
  renderMarkers,
  clearMarkers,
  clearRoute,
  drawRoute,
  drawRouteToPoint
} from "./map/map.js";

import {
  cargarLineasTransporte,
  clearTransportLayers,
  planAndShowBusStops,
  hasBusCoverage
} from "./transport/transport_controller.js";

import { getLineasByTipoAll, isLineOperatingNow } from "./transport/core/transport_data.js";
import { getCollectionCache } from "./app/cache_db.js";
import { getStopsLayer, getRouteLayer, getAccessLayer } from "./transport/core/transport_state.js";

import { installMapContextMenu } from "./map/context_menu.js";
import { initLayersUI } from "./map/layers_ui.js";
import { shouldShowVisitMorona, applyVisitMorona } from "./app/virtual_visit.js";

import { detectAdminContextFromLatLng, detectPointContext } from "./app/admin_detection.js";
import { createManualRouting } from "./app/manual_route.js";

/* ✅ NUEVO: header controls / clima / tema / idioma */
import { applyLanguageUI, toggleLanguage } from "./app/i18n.js";
import { applyThemeUI, toggleTheme } from "./app/theme.js";
import { updateWeatherBadge, startWeatherAutoRefresh } from "./services/weather.js";
import { initWeatherPopup } from "./app/weather_popup.js";

/* ================= ESTADO GLOBAL (UI) ================= */
let activePlace = null;
let userMarker = null;
let layersUI = null;

/** ✅ Fachada detectada (solo UI) */
let detectedAdmin = { provincia: "", canton: "", parroquia: "" };

/** ✅ Contexto lógico usado en filtros */
let ctxGeo = {
  provincia: "",
  canton: "",
  parroquia: "",
  specialSevilla: false,
  entornoUser: "",
  busEnabled: true,
  virtualMorona: false
};

const getCtxGeo = () => ctxGeo;

// ✅ Flag interno para “visita/virtual”
let forceVirtualMoronaNext = false;

/* ================= ELEMENTOS DEL DOM ================= */
const category = document.getElementById("category");
const extra = document.getElementById("extra-controls");

// ✅ Banner fijo (NO lo pisa manual_route)
const bannerWrap = document.getElementById("loc-banner-wrap");

/* ================= HEADER INIT ================= */
applyThemeUI();
applyLanguageUI();

const btnTheme = document.getElementById("btnTheme");
const btnLang = document.getElementById("btnLang");

if (btnTheme) btnTheme.addEventListener("click", () => toggleTheme());

function isMobileDevice() {
  // 1) User-Agent (útil y rápido)
  const ua = navigator.userAgent || "";
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(ua);

  // 2) Fallback: touch + pantalla pequeña
  const touch = ("ontouchstart" in window) || (navigator.maxTouchPoints > 0);
  const small = window.matchMedia?.("(max-width: 768px)")?.matches;

  return uaMobile || (touch && small);
}

function getBrowserLang() {
  return (navigator.language || navigator.userLanguage || "es").toLowerCase();
}

function showTranslateHelpModal() {
  const mobile = isMobileDevice();
  const lang = getBrowserLang();

  // ✅ Si empieza con "en" => inglés, caso contrario => español (fallback)
  const isEnglish = lang.startsWith("en");

  // ================= TEXTS (ES/EN) =================
  const title = isEnglish ? "🌐 Browser translation" : "🌐 Traducción del navegador";

  const subtitle = isEnglish
    ? `Your browser language is <b>English</b> (${lang}).`
    : `Tu navegador está en <b>español</b> (${lang}).`;

  const infoText = isEnglish
    ? `This web app does not translate by itself yet (it will in the future). For now, please use your browser translator. Thank you.`
    : `Este app web de momento no traduce por sí misma (a futuro lo hará). Por ahora usa el traductor del navegador. Gracias.`;

  const stepsDesktop = isEnglish
    ? `
      <div class="mt-2">
        <b>On desktop (Chrome/Edge):</b><br>
        1️⃣ Right click anywhere on the page<br>
        2️⃣ Click <b>“Translate to English”</b> (or your language)<br>
        <div class="small opacity-75 mt-1">
          Tip: You can also open the browser menu ⋮ and look for <b>Translate…</b>
        </div>
      </div>
    `
    : `
      <div class="mt-2">
        <b>En computadora (Chrome/Edge):</b><br>
        1️⃣ Click derecho en la página<br>
        2️⃣ Selecciona <b>“Traducir al inglés”</b> (o el idioma)<br>
        <div class="small opacity-75 mt-1">
          Tip: también puedes abrir el menú ⋮ del navegador y buscar <b>Traducir…</b>
        </div>
      </div>
    `;

  const stepsMobile = isEnglish
    ? `
      <div class="mt-2">
        <b>On Android (Chrome):</b><br>
        1️⃣ Tap the menu <b>⋮</b> (top-right)<br>
        2️⃣ Tap <b>“Translate…”</b><br>
        3️⃣ Choose your language<br>

        <hr class="my-2">

        <b>On iPhone (Safari / Chrome):</b><br>
        • Safari: tap <b>aA</b> (address bar) → <b>Translate</b><br>
        • Chrome iOS: menu <b>⋯</b> → <b>Translate</b>
        <div class="small opacity-75 mt-1">
          *Some iPhones show the option only when the language is supported and you have internet.
        </div>
      </div>
    `
    : `
      <div class="mt-2">
        <b>En teléfono (Chrome Android):</b><br>
        1️⃣ Toca el menú <b>⋮</b> (arriba a la derecha)<br>
        2️⃣ Presiona <b>“Traducir…”</b><br>
        3️⃣ Elige <b>Inglés</b> u otro idioma<br>

        <hr class="my-2">

        <b>En iPhone (Safari / Chrome):</b><br>
        • Safari: toca <b>aA</b> (barra de direcciones) → <b>Traducir</b><br>
        • Chrome iOS: menú <b>⋯</b> → <b>Translate</b> / <b>Traducir</b>
        <div class="small opacity-75 mt-1">
          *En algunos iPhone la opción aparece solo si el idioma está soportado y tienes internet.
        </div>
      </div>
    `;

  showModal(
    title,
    `
      <div class="alert alert-info py-2 mb-2">
        ${subtitle}<br>
        ${infoText}
      </div>
      ${mobile ? stepsMobile : stepsDesktop}
    `
  );
}

/* ✅ Siempre disponible al click (ES/EN según navegador) */
if (btnLang) {
  btnLang.addEventListener("click", showTranslateHelpModal);
}

/* ✅ (Opcional pro) Mostrar aviso automático SOLO si NO está en español */
(function autoHintIfNotSpanish() {
  const lang = getBrowserLang();
  if (!lang.startsWith("es")) {
    const key = "tm_translate_hint_shown";
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");

    setTimeout(() => {
      showTranslateHelpModal();
    }, 1200);
  }
})();
/* ================= WEATHER HELPERS ================= */
function getMapCenterLatLng() {
  const c = map.getCenter?.();
  if (!c) return null;
  return { lat: c.lat, lng: c.lng };
}

async function refreshWeatherFromCenterOrUser() {
  const c = getMapCenterLatLng();
  if (c) {
    await updateWeatherBadge(c.lat, c.lng);
    return;
  }
  const loc = getUserLocation?.();
  if (loc) await updateWeatherBadge(loc[0], loc[1]);
}

/* ✅ Click en clima abre pronóstico (prioridad: centro del mapa) */
initWeatherPopup({
  getUserLoc: () => getUserLocation(),
  getMapCenter: () => map.getCenter()
});

/* ================= HELPERS UI ================= */
function clearRouteInfo() {
  const el = document.getElementById("route-info");
  if (el) el.innerHTML = "";
}

function resetMap() {
  clearMarkers();
  clearRoute();
  clearTransportLayers();
  clearRouteInfo();
  activePlace = null;
  setActivePlaceAction(null);

  // ✅ si venías usando indicaciones manuales, limpiamos
  manual.clearManualDest();
  manual.clearManualStart();
}

// ✅ volver al modo normal (limpia indicaciones manuales)
function clearDirections() {
  manual.clearManualDest();
  manual.clearManualStart();

  clearRoute();
  clearTransportLayers();
  clearRouteInfo();

  // opcional: recentrar al usuario
  const loc = getUserLocation();
  if (loc) map.setView(loc, 14);

  refreshLayersOverlays();

  // ✅ el banner debe volver a aparecer al quitar indicaciones
  showDetectedFacade();
}

/* ================= MODAL GENERAL ================= */
function ensureModal() {
  if (document.getElementById("tm-modal")) return;
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="modal fade" id="tm-modal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="tm-modal-title">Aviso</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>
          </div>
          <div class="modal-body" id="tm-modal-body"></div>
          <div class="modal-footer">
            <button type="button" class="btn btn-primary" data-bs-dismiss="modal">Cerrar</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
}

function showModal(title, html) {
  ensureModal();
  document.getElementById("tm-modal-title").textContent = title;
  document.getElementById("tm-modal-body").innerHTML = html;
  const modal = new bootstrap.Modal(document.getElementById("tm-modal"));
  modal.show();
}

/* ================= Map: marker de usuario ================= */
function setUserMarker(loc, open = false) {
  try { if (userMarker) map.removeLayer(userMarker); } catch {}
  userMarker = L.marker(loc).addTo(map).bindPopup("📍 Tu ubicación");
  if (open) userMarker.openPopup();
}

/* ================= Capas: overlays dinámicos ================= */
function refreshLayersOverlays() {
  if (!layersUI) return;

  const overlays = {
    "📌 Lugares": markersLayer,
    "🧭 Ruta": routeOverlay
  };

  const tStops = getStopsLayer?.();
  const tRoute = getRouteLayer?.();
  const tAcc = getAccessLayer?.();

  if (tStops) overlays["🚌 Paradas (bus)"] = tStops;
  if (tRoute) overlays["🚌 Ruta (bus)"] = tRoute;
  if (tAcc) overlays["🚶 Accesos (bus)"] = tAcc;

  layersUI.updateOverlays(overlays);
}

/* ================= UI banner ubicación ================= */
function showLocatingBanner() {
  if (!bannerWrap) return;
  bannerWrap.innerHTML = `
    <div id="loc-banner" class="alert alert-info py-2 mb-2">
      📡 <b>Estamos ubicándote…</b><br>
      <small>Esto puede tardar unos segundos.</small>
    </div>
  `;
}

function enableCategoryUI() {
  if (!category) return;
  category.disabled = false;
  category.classList.remove("d-none");
  category.value = "";
}

function showDetectedFacade() {
  if (!bannerWrap) return;

  let banner = bannerWrap.querySelector("#loc-banner");
  if (!banner) {
    bannerWrap.innerHTML = `<div id="loc-banner" class="alert alert-info py-2 mb-2"></div>`;
    banner = bannerWrap.querySelector("#loc-banner");
  }

  const p = String(detectedAdmin?.provincia || "").trim();
  const c = String(detectedAdmin?.canton || "").trim();
  const pa = String(detectedAdmin?.parroquia || "").trim();
  const ent = String(ctxGeo?.entornoUser || "").trim();

  const renderExploreMoronaButton = (variant = "primary") => `
    <div class="mt-2 tm-visit-box">
      <div class="small mb-2">Mientras tanto, puedes explorar Morona:</div>
      <button id="btn-explore-morona" class="btn btn-${variant} w-100">
        🧭 Explorar Morona
      </button>
    </div>
  `;

  const wireExploreMorona = () => {
    const btn = document.getElementById("btn-explore-morona");
    if (!btn) return;

    btn.onclick = async () => {
      forceVirtualMoronaNext = true;

      applyVisitMorona({
        setUserLocation: updateUserLocation,
        map,
        onAfterSet: async (loc) => {
          setUserMarker(loc, true);

          const res = await detectAdminContextFromLatLng(loc);
          detectedAdmin = res.detectedAdmin;
          ctxGeo = res.ctxGeo;

          // entorno fijo al visitar Morona
          ctxGeo.entornoUser = "urbano";
          ctxGeo.virtualMorona = true;
          ctxGeo.busEnabled = true;

          showDetectedFacade();
          enableCategoryUI();
          refreshLayersOverlays();

          // ✅ clima desde centro (al visitar morona también)
          await refreshWeatherFromCenterOrUser();
        }
      });
    };
  };

  // ✅ SIN COBERTURA (no prov/cant)
  if (!p || !c) {
    banner.className = "alert alert-info py-2 mb-2";
    banner.innerHTML = `
      <b>📍 Sin cobertura por ahora</b><br>
      <div class="mt-1">
        De momento no hay datos registrados en la zona, pronto habrá cobertura.
      </div>
      ${renderExploreMoronaButton("primary")}
    `;

    wireExploreMorona();

    if (category) {
      category.disabled = true;
      category.classList.add("d-none");
    }
    return;
  }

  // ✅ CON COBERTURA (prov/cant detectados)
  banner.className = "alert alert-success py-2 mb-2";
  banner.innerHTML = `
    ✅ <b>Usted se encuentra en:</b><br>
    <b>Provincia:</b> ${p}<br>
    <b>Cantón:</b> ${c}<br>
    <b>Parroquia:</b> ${pa || "(no detectada)"}
    ${
      ctxGeo?.specialSevilla
        ? `<div class="small mt-1">⚠️ Caso especial Sevilla activo (Sevilla + Morona)</div>`
        : ""
    }
    ${
      ent
        ? `<div class="small mt-1">🧭 <b>Entorno detectado:</b> ${ent}</div>`
        : `<div class="small mt-1">🧭 <b>Entorno detectado:</b> (no disponible)</div>`
    }
  `;

  if (shouldShowVisitMorona(ctxGeo)) {
    banner.innerHTML += renderExploreMoronaButton("outline-primary");
    wireExploreMorona();
  }
}

/**
 * ✅ Cuando se selecciona un lugar:
 * Oculta SOLO el banner verde de ubicación (“Usted se encuentra en...”)
 */
function hideDetectedFacadeOnPlaceSelection() {
  if (!bannerWrap) return;

  const banner = bannerWrap.querySelector("#loc-banner");
  if (!banner) return;

  const isSuccessBanner = banner.classList.contains("alert-success");
  if (!isSuccessBanner) return;

  bannerWrap.innerHTML = "";
}

/**
 * ✅ Cuando se selecciona una CATEGORÍA (primer select),
 * ocultar el banner verde “Usted se encuentra en...”
 */
function hideDetectedFacadeOnCategoryChange() {
  if (!bannerWrap) return;

  const banner = bannerWrap.querySelector("#loc-banner");
  if (!banner) return;

  // Solo ocultamos el banner verde (no el de “Sin cobertura”)
  if (banner.classList.contains("alert-success")) {
    bannerWrap.innerHTML = "";
  }
}

/* ================= Manual routing module ================= */
const manual = createManualRouting({
  map,
  extraEl: extra,

  getUserLoc: () => getUserLocation(),

  getActivePlace: () => activePlace,
  setActivePlace: (p) => { activePlace = p; setActivePlaceAction(p); },

  getMode: () => getMode(),
  setMode: (m) => setTravelMode(m),

  clearMarkers,
  clearRoute,
  clearTransportLayers,
  drawRoute,
  drawRouteToPoint,
  planAndShowBusStops,

  getCtxGeo,
  refreshLayersOverlays,
  clearRouteInfo,

  detectPointContext
});

/* ================= Layers UI init ================= */
function initMapControls() {
  if (layersUI) return;

  layersUI = initLayersUI({
    map,
    baseLayers,
    overlays: {
      "📌 Lugares": markersLayer,
      "🧭 Ruta": routeOverlay
    },
    onMyLocation: () => {
      const loc = getUserLocation();
      if (!loc) return;
      map.setView(loc, 14);
      if (userMarker) userMarker.openPopup();
    }
  });

  refreshLayersOverlays();

  installMapContextMenu(map, {
    onDirectionsFromHere: (latlng) => manual.setManualStartPoint(latlng),
    onDirectionsToHere: (latlng) => manual.setManualDestination(latlng),

    onClearDirections: () => clearDirections(),

    onCenterHere: (latlng) => map.setView(latlng, map.getZoom())
  });
}

/* ✅ EJECUCIÓN */
showLocatingBanner();
initMapControls();

/* ================= WEATHER: update on map move ================= */
let lastWeatherCenter = null;
let weatherMoveTimer = null;

// distancia en metros (haversine)
function distanceMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;

  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);

  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(s));
}

function installWeatherOnMapMove() {
  if (!map) return;

  const handler = () => {
    if (weatherMoveTimer) clearTimeout(weatherMoveTimer);

    weatherMoveTimer = setTimeout(async () => {
      const c = map.getCenter(); // Leaflet LatLng {lat,lng}
      if (!c) return;

      if (!lastWeatherCenter) {
        lastWeatherCenter = { lat: c.lat, lng: c.lng };
        await updateWeatherBadge(c.lat, c.lng);
        return;
      }

      const moved = distanceMeters(lastWeatherCenter, { lat: c.lat, lng: c.lng });

      // ✅ umbral: 300m (ajústalo si quieres)
      if (moved < 300) return;

      lastWeatherCenter = { lat: c.lat, lng: c.lng };
      await updateWeatherBadge(c.lat, c.lng);
    }, 900);
  };

  map.on("moveend", handler);
  map.on("zoomend", handler);
}

// ✅ INSTALAR ACTUALIZACIÓN POR MOVIMIENTO (ANTES de ubicar, ya funciona igual)
installWeatherOnMapMove();

/* ================= GEOLOC ================= */
const USE_TEST_LOCATION = false;
const TEST_LOCATION = [-2.53699, -78.16339];

async function afterLocate(loc) {
  updateUserLocation(loc);

  map.setView(loc, 14);
  setUserMarker(loc, true);

  const res = await detectAdminContextFromLatLng(loc);
  detectedAdmin = res.detectedAdmin;
  ctxGeo = res.ctxGeo;

  // ✅ si venimos de “Explorar Morona”, forzamos
  if (forceVirtualMoronaNext) {
    forceVirtualMoronaNext = false;
    ctxGeo.virtualMorona = true;
    ctxGeo.busEnabled = true;
    ctxGeo.entornoUser = "urbano";
  } else {
    ctxGeo.virtualMorona = false;

    // ✅ calcular disponibilidad real de bus en la zona
    try {
      const okBus = await hasBusCoverage({ map, userLoc: loc, destLoc: loc });
      ctxGeo.busEnabled = !!okBus;
    } catch {
      ctxGeo.busEnabled = false;
    }
  }

  showDetectedFacade();

  if (String(detectedAdmin?.provincia || "").trim() && String(detectedAdmin?.canton || "").trim()) {
    enableCategoryUI();
  }

  refreshLayersOverlays();

  // ✅ Clima: usar centro del mapa (no userLoc fijo)
  await refreshWeatherFromCenterOrUser();

  // ✅ Auto refresh (5 min) usando centro del mapa como prioridad
  startWeatherAutoRefresh(() => {
    const c = map.getCenter?.();
    if (c && typeof c.lat === "number" && typeof c.lng === "number") return [c.lat, c.lng];
    const u = getUserLocation?.();
    return u || null;
  }, 5);
}

if (USE_TEST_LOCATION) {
  afterLocate(TEST_LOCATION);
} else {
  navigator.geolocation.getCurrentPosition(
    async pos => afterLocate([pos.coords.latitude, pos.coords.longitude]),
    () => {
      // ✅ sin geolocalización: mostramos banner + botón “Visitar Morona”
      if (!bannerWrap) return;
      bannerWrap.innerHTML = `
        <div id="loc-banner" class="alert alert-info py-2 mb-2">
          <b>📍 Sin cobertura por ahora</b><br>
          <div class="mt-1">De momento no hay datos registrados en la zona, pronto habrá cobertura.</div>
          <div class="mt-2 tm-visit-box">
            <div class="small mb-2">Mientras tanto, puedes explorar Morona:</div>
            <button id="btn-visit-morona" class="btn btn-primary w-100">
              🧭 Visitar Morona
            </button>
          </div>
        </div>
      `;

      const btn = document.getElementById("btn-visit-morona");
      if (btn) {
        btn.onclick = async () => {
          forceVirtualMoronaNext = true;
          applyVisitMorona({
            setUserLocation: updateUserLocation,
            map,
            onAfterSet: async (loc2) => {
              await afterLocate(loc2);
            }
          });
        };
      }

      // ✅ aún sin geoloc, intenta clima por centro inicial del mapa
      refreshWeatherFromCenterOrUser();
      startWeatherAutoRefresh(() => {
        const c = map.getCenter?.();
        if (c && typeof c.lat === "number" && typeof c.lng === "number") return [c.lat, c.lng];
        return null;
      }, 5);
    }
  );
}

/* ================= EVENTOS: helpers ================= */
function parseDDMMYYYY(s) {
  const m = String(s || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yy = Number(m[3]);
  if (!Number.isFinite(dd) || !Number.isFinite(mm) || !Number.isFinite(yy)) return null;
  return new Date(yy, mm - 1, dd, 0, 0, 0, 0);
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function isFutureEvent(ev) {
  // ✅ futuro = fecha_fin >= hoy (si no hay fecha_fin, usa fecha_inicio)
  const fi = parseDDMMYYYY(ev?.fecha_inicio);
  const ff = parseDDMMYYYY(ev?.fecha_fin);
  const end = ff || fi;
  if (!end) return false;
  return end.getTime() >= startOfToday().getTime();
}

function eventToPlace(ev) {
  // Adaptador para que drawRoute / planAndShowBusStops funcionen igual
  return {
    ...ev,
    nombre: ev?.nombre || "Evento",
    telefono: ev?.organizador ? `Organizador: ${ev.organizador}` : "No disponible",
    horario: `${ev?.fecha_inicio || ""} ${ev?.hora_inicio || ""} → ${ev?.fecha_fin || ""} ${ev?.hora_fin || ""}`.trim(),
    ubicacion: ev?.ubicacion
  };
}

function buildEventPopupHTML(ev) {
  const nombre = ev?.nombre || "Evento";
  const org = ev?.organizador || "No disponible";
  const ent = ev?.entrada || "No disponible";
  const fi = ev?.fecha_inicio || "N/D";
  const ff = ev?.fecha_fin || "N/D";
  const hi = ev?.hora_inicio || "N/D";
  const hf = ev?.hora_fin || "N/D";

  return `
    <b>📅 ${nombre}</b><br>
    👤 ${org}<br>
    🎟️ ${ent}<br>
    🗓️ ${fi} ${hi} → ${ff} ${hf}
  `;
}

function renderEventMarkers(list, onSelect) {
  clearMarkers();

  (Array.isArray(list) ? list : []).forEach(ev => {
    const u = ev?.ubicacion;
    const lat = u?.latitude;
    const lon = u?.longitude;
    if (typeof lat !== "number" || typeof lon !== "number") return;

    const marker = L.marker([lat, lon]).addTo(markersLayer);

    marker.bindPopup(buildEventPopupHTML(ev));

    // ✅ popup por hover (como pediste)
    marker.on("mouseover", () => marker.openPopup());
    marker.on("mouseout", () => marker.closePopup());

    marker.on("click", () => onSelect(ev));
  });
}

/* ================= EVENTO CATEGORÍA ================= */
category.onchange = async () => {
  resetMap();
  dataList.length = 0;

  // ✅ si el usuario vuelve a "Seleccione categoría", mostramos el banner otra vez
  if (!category.value) {
    showDetectedFacade();
    return;
  }

  // ✅ al elegir una categoría, ocultar banner verde "Usted se encuentra en..."
  hideDetectedFacadeOnCategoryChange();

  console.log("📍 Fachada:", detectedAdmin);
  console.log("🧠 ctxGeo (lógico):", ctxGeo);

  /* =====================================================
     ✅ EVENTOS (colección eventosms)
     - NO rompe nada de "lugar"
  ===================================================== */
  if (category.value === "eventos" || category.value === "eventosms") {
    const provSel = String(ctxGeo.provincia || "");
    const cantonSel = String(ctxGeo.canton || "");
    const parroquiaSel = String(ctxGeo.parroquia || "");

    const eventos = await getCollectionCache("eventosms");
    const arr = Array.isArray(eventos) ? eventos : [];

    // Filtro geo + futuros
    let filtered = arr.filter(ev => {
      if (!ev?.ubicacion) return false;

      if (String(ev.provincia || "") !== provSel) return false;

      // cantón
      if (ctxGeo.specialSevilla) {
        const c = String(ev.canton || ev.ciudad || "");
        if (c !== "Sevilla Don Bosco" && c !== "Morona") return false;
      } else {
        const c = String(ev.canton || ev.ciudad || "");
        if (c !== cantonSel) return false;
      }

      // parroquia: si el usuario tiene parroquia detectada, priorizamos coincidencia
      if (parroquiaSel && String(ev.parroquia || "") !== parroquiaSel) {
        // no lo bloqueamos totalmente
      }

      // futuro
      if (!isFutureEvent(ev)) return false;

      return true;
    });

    if (!filtered.length) {
      showModal(
        "📅 Sin eventos futuros",
        `
          <div class="alert alert-info py-2 mb-2">
            No hay <b>eventos futuros</b> registrados en esta zona.
          </div>
          <div class="small">
            Revisa que tus documentos tengan <b>fecha_inicio/fecha_fin</b> en formato <b>DD/MM/YYYY</b>.
          </div>
        `
      );
      extra.innerHTML = "";
      return;
    }

    // Orden: primero misma parroquia si existe, luego por fecha_inicio y nombre
    filtered.sort((a, b) => {
      const ap = String(a.parroquia || "");
      const bp = String(b.parroquia || "");
      if (parroquiaSel) {
        const ak = (ap === parroquiaSel) ? 0 : 1;
        const bk = (bp === parroquiaSel) ? 0 : 1;
        if (ak !== bk) return ak - bk;
      }

      const afi = parseDDMMYYYY(a.fecha_inicio)?.getTime() ?? Infinity;
      const bfi = parseDDMMYYYY(b.fecha_inicio)?.getTime() ?? Infinity;
      if (afi !== bfi) return afi - bfi;

      return String(a.nombre || "").localeCompare(String(b.nombre || ""));
    });

    // Adaptamos para que el resto del flujo (rutas) funcione igual
    const places = filtered.map(eventToPlace);
    dataList.push(...places);

    const busBtnHTML = (ctxGeo.busEnabled === true)
      ? `<button class="btn btn-outline-primary" data-mode="bus">🚌</button>`
      : "";

    extra.innerHTML = `
      <select id="lugares" class="form-select mb-2">
        <option value="">📅 Seleccione evento</option>
      </select>

      <button id="near" class="btn btn-primary w-100 mb-2">
        📏 Evento más cercano
      </button>

      <div class="btn-group w-100 mb-2">
        <button class="btn btn-outline-primary" data-mode="walking">🚶</button>
        <button class="btn btn-outline-primary" data-mode="bicycle">🚴</button>
        <button class="btn btn-outline-primary" data-mode="motorcycle">🏍️</button>
        <button class="btn btn-outline-primary" data-mode="driving">🚗</button>
        ${busBtnHTML}
      </div>

      <div id="route-info" class="small"></div>
    `;

    const sel = document.getElementById("lugares");
    dataList.forEach((ev, i) => {
      const when = `${ev?.fecha_inicio || ""} ${ev?.hora_inicio || ""}`.trim();
      const par = ev?.parroquia ? `(${ev.parroquia})` : "";
      sel.innerHTML += `<option value="${i}">${ev.nombre || "Evento"} ${par} ${when ? `- ${when}` : ""}</option>`;
    });

    // Marcadores con popup por hover
    renderEventMarkers(dataList, (ev) => {
      clearRoute();
      clearTransportLayers();
      clearRouteInfo();

      manual.clearManualDest();
      manual.clearManualStart();

      activePlace = ev;
      setActivePlaceAction(activePlace);

      hideDetectedFacadeOnPlaceSelection();

      manual.buildRoute();
      refreshLayersOverlays();
    });

    sel.onchange = () => {
      clearRoute();
      clearTransportLayers();
      clearRouteInfo();

      manual.clearManualDest();
      manual.clearManualStart();

      activePlace = dataList[sel.value];
      setActivePlaceAction(activePlace);

      if (!activePlace) return;

      hideDetectedFacadeOnPlaceSelection();

      manual.buildRoute();
      refreshLayersOverlays();
    };

    document.getElementById("near").onclick = () => {
      clearRoute();
      clearTransportLayers();
      clearRouteInfo();

      manual.clearManualDest();
      manual.clearManualStart();

      activePlace = findNearest(dataList);
      setActivePlaceAction(activePlace);

      if (!activePlace) return;

      hideDetectedFacadeOnPlaceSelection();

      manual.buildRoute();
      refreshLayersOverlays();
    };

    document.querySelectorAll("[data-mode]").forEach(btn => {
      btn.onclick = () => {
        const m = btn.dataset.mode;

        if (m === "bus" && ctxGeo.busEnabled !== true) {
          showModal(
            "🚌 Transporte no disponible",
            `
              <div class="alert alert-info py-2 mb-0">
                En esta zona no hay datos registrados para transporte en bus.
                Puedes usar otros modos o presionar <b>Explorar Morona</b>.
              </div>
            `
          );
          setTravelMode("walking");
          manual.buildRoute();
          refreshLayersOverlays();
          return;
        }

        setTravelMode(m);
        manual.buildRoute();
        refreshLayersOverlays();
      };
    });

    return;
  }

  /* =====================================================
     TRANSPORTE LINEAS (ya existente)
  ===================================================== */
  if (category.value === "transporte_lineas") {
    extra.innerHTML = `
      <select id="tipo" class="form-select mb-2">
        <option value="">🚍 Tipo de transporte</option>
        <option value="urbano">Urbano</option>
        <option value="rural">Rural</option>
      </select>

      <div id="lineas"></div>
    `;

    const tipoSel = document.getElementById("tipo");
    const lineasContainer = document.getElementById("lineas");

    tipoSel.onchange = async e => {
      const tipo = e.target.value;
      lineasContainer.innerHTML = "";
      if (!tipo) return;

      const now = new Date();

      const allLineas = await getLineasByTipoAll(tipo, {
        provincia: ctxGeo.provincia,
        canton: ctxGeo.canton,
        parroquia: ctxGeo.parroquia,
        ignoreGeoFilter: (tipo === "rural" && ctxGeo.specialSevilla)
      });

      const fuera = allLineas
        .filter(l => !isLineOperatingNow(l, now))
        .sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0));

      if (fuera.length) {
        const hh = String(now.getHours()).padStart(2, "0");
        const mm = String(now.getMinutes()).padStart(2, "0");
        const items = fuera.map(l => `• <b>${l.codigo}</b> - ${l.nombre || ""}`).join("<br>");

        showModal(
          "⛔ Fuera de servicio ahora",
          `
            <div class="alert alert-warning py-2 mb-2">
              <b>Fuera de servicio ahora</b> (hora actual ${hh}:${mm}):<br><br>
              ${items}
              <div class="small mt-2">* Horarios referenciales (aprox.).</div>
            </div>
          `
        );
      }

      await cargarLineasTransporte(tipo, lineasContainer, {
        provincia: ctxGeo.provincia,
        canton: ctxGeo.canton,
        parroquia: ctxGeo.parroquia,
        specialSevilla: ctxGeo.specialSevilla,
        ignoreGeoFilter: (tipo === "rural" && ctxGeo.specialSevilla),
        now
      });

      refreshLayersOverlays();
    };

    return;
  }

  /* =====================================================
     FLUJO GENÉRICO (colección lugar) - ya existente
  ===================================================== */

  const lugares = await getCollectionCache("lugar");
  const all = [];

  const provSel = ctxGeo.provincia;
  const cantonSel = ctxGeo.canton;
  const parroquiaSel = ctxGeo.parroquia;
  const catSel = String(category.value || "").toLowerCase();

  const base = (Array.isArray(lugares) ? lugares : []).filter(l => {
    if (!l?.activo) return false;
    if (String(l.provincia || "") !== String(provSel || "")) return false;
    if (String(l.subcategoria || "").toLowerCase() !== catSel) return false;
    return true;
  });

  if (ctxGeo.specialSevilla) {
    base.forEach(l => {
      const ciudad = String(l.ciudad || "");
      if (ciudad === "Sevilla Don Bosco" || ciudad === "Morona") all.push(l);
    });
  } else {
    base.forEach(l => {
      const ciudad = String(l.ciudad || "");
      if (ciudad === cantonSel) all.push(l);
    });
  }

  if (!all.length) {
    showModal(
      "📍 Sin cobertura por ahora",
      `
        <div class="alert alert-info py-2 mb-2">
          <b>De momento no hay datos registrados en la zona</b> para esta categoría.
        </div>
        <div class="small">
          Pronto habrá cobertura. Puedes probar otra categoría.
        </div>
      `
    );
    extra.innerHTML = "";
    return;
  }

  all.sort((a, b) => {
    const aCity = String(a.ciudad || "");
    const bCity = String(b.ciudad || "");

    if (ctxGeo.specialSevilla) {
      const aKey = (aCity === "Sevilla Don Bosco") ? 0 : 1;
      const bKey = (bCity === "Sevilla Don Bosco") ? 0 : 1;
      if (aKey !== bKey) return aKey - bKey;
    }

    const aPar = String(a.parroquia || "");
    const bPar = String(b.parroquia || "");

    if (parroquiaSel) {
      const aKey = (aPar === parroquiaSel) ? 0 : 1;
      const bKey = (bPar === parroquiaSel) ? 0 : 1;
      if (aKey !== bKey) return aKey - bKey;
    }

    const pCmp = aPar.localeCompare(bPar);
    if (pCmp !== 0) return pCmp;

    return String(a.nombre || "").localeCompare(String(b.nombre || ""));
  });

  dataList.push(...all);

  const busBtnHTML = (ctxGeo.busEnabled === true)
    ? `<button class="btn btn-outline-primary" data-mode="bus">🚌</button>`
    : "";

  extra.innerHTML = `
    <select id="lugares" class="form-select mb-2">
      <option value="">📍 Seleccione lugar</option>
    </select>

    <button id="near" class="btn btn-primary w-100 mb-2">
      📏 Lugar más cercano
    </button>

    <div class="btn-group w-100 mb-2">
      <button class="btn btn-outline-primary" data-mode="walking">🚶</button>
      <button class="btn btn-outline-primary" data-mode="bicycle">🚴</button>
      <button class="btn btn-outline-primary" data-mode="motorcycle">🏍️</button>
      <button class="btn btn-outline-primary" data-mode="driving">🚗</button>
      ${busBtnHTML}
    </div>

    <div id="route-info" class="small"></div>
  `;

  const sel = document.getElementById("lugares");
  dataList.forEach((l, i) => {
    const par = l.parroquia ? `(${l.parroquia})` : "(sin parroquia)";
    sel.innerHTML += `<option value="${i}">${l.nombre || "Lugar"} ${par}</option>`;
  });

  renderMarkers(dataList, place => {
    clearRoute();
    clearTransportLayers();
    clearRouteInfo();

    manual.clearManualDest();
    manual.clearManualStart();

    activePlace = place;
    setActivePlaceAction(place);

    hideDetectedFacadeOnPlaceSelection();

    manual.buildRoute();
    refreshLayersOverlays();
  });

  sel.onchange = () => {
    clearRoute();
    clearTransportLayers();
    clearRouteInfo();

    manual.clearManualDest();
    manual.clearManualStart();

    activePlace = dataList[sel.value];
    setActivePlaceAction(activePlace);

    if (!activePlace) return;

    hideDetectedFacadeOnPlaceSelection();

    manual.buildRoute();
    refreshLayersOverlays();
  };

  document.getElementById("near").onclick = () => {
    clearRoute();
    clearTransportLayers();
    clearRouteInfo();

    manual.clearManualDest();
    manual.clearManualStart();

    activePlace = findNearest(dataList);
    setActivePlaceAction(activePlace);

    if (!activePlace) return;

    hideDetectedFacadeOnPlaceSelection();

    manual.buildRoute();
    refreshLayersOverlays();
  };

  document.querySelectorAll("[data-mode]").forEach(btn => {
    btn.onclick = () => {
      const m = btn.dataset.mode;

      if (m === "bus" && ctxGeo.busEnabled !== true) {
        showModal(
          "🚌 Transporte no disponible",
          `
            <div class="alert alert-info py-2 mb-0">
              En esta zona no hay datos registrados para transporte en bus.
              Puedes usar otros modos o presionar <b>Explorar Morona</b>.
            </div>
          `
        );
        setTravelMode("walking");
        manual.buildRoute();
        refreshLayersOverlays();
        return;
      }

      setTravelMode(m);
      manual.buildRoute();
      refreshLayersOverlays();
    };
  });
};