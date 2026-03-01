/* ================= IMPORTS ================= */
import { findNearest, updateUserLocation, setTravelMode, setActivePlaceAction } from "./app/actions.js";
import { dataList, getUserLocation, getMode } from "./app/state.js";

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
  planAndShowBusStops
} from "./transport/transport_controller.js";

import { getLineasByTipoAll, isLineOperatingNow } from "./transport/core/transport_data.js";
import { getCollectionCache } from "./app/cache_db.js";
import { getStopsLayer, getRouteLayer, getAccessLayer } from "./transport/core/transport_state.js";

import { installMapContextMenu } from "./map/context_menu.js";
import { initLayersUI } from "./map/layers_ui.js";
import { shouldShowVisitMorona, applyVisitMorona } from "./app/virtual_visit.js";

// ✅ IMPORT actualizado: incluye detectPointContext
import { detectAdminContextFromLatLng, detectPointContext } from "./app/admin_detection.js";
import { createManualRouting } from "./app/manual_route.js";

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
  entornoUser: ""
};

const getCtxGeo = () => ctxGeo;

/* ================= ELEMENTOS DEL DOM ================= */
const category = document.getElementById("category");
const extra = document.getElementById("extra-controls");

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

// ✅ NUEVO: Volver al modo normal (limpia indicaciones manuales)
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
  if (!extra) return;
  extra.innerHTML = `
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
  if (!extra) return;

  const banner = document.getElementById("loc-banner");
  if (!banner) return;

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
      applyVisitMorona({
        setUserLocation: updateUserLocation, // ✅ via actions
        map,
        onAfterSet: async (loc) => {
          setUserMarker(loc, true);

          const res = await detectAdminContextFromLatLng(loc);
          detectedAdmin = res.detectedAdmin;
          ctxGeo = res.ctxGeo;

          // entorno fijo al visitar Morona
          ctxGeo.entornoUser = "urbano";

          showDetectedFacade();
          enableCategoryUI();
          refreshLayersOverlays();
        }
      });
    };
  };

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

/* ================= Manual routing module ================= */
const manual = createManualRouting({
  map,
  extraEl: extra,

  getUserLoc: () => getUserLocation(),

  // ✅ place centralizado
  getActivePlace: () => activePlace,
  setActivePlace: (p) => { activePlace = p; setActivePlaceAction(p); },

  // ✅ modo REAL desde state.js
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

  // ✅ detectar contexto prov/cant/parr + entorno para puntos manuales
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

    // ✅ limpiar indicaciones (volver al modo normal)
    onClearDirections: () => clearDirections(),

    onCenterHere: (latlng) => map.setView(latlng, map.getZoom())
  });
}

/* ✅ EJECUCIÓN */
showLocatingBanner();
initMapControls();

const USE_TEST_LOCATION = false;
const TEST_LOCATION = [-2.53699, -78.16339];

async function afterLocate(loc) {
  updateUserLocation(loc);

  map.setView(loc, 14);
  setUserMarker(loc, true);

  const res = await detectAdminContextFromLatLng(loc);
  detectedAdmin = res.detectedAdmin;
  ctxGeo = res.ctxGeo;

  showDetectedFacade();
  if (String(detectedAdmin?.provincia || "").trim() && String(detectedAdmin?.canton || "").trim()) {
    enableCategoryUI();
  }
  refreshLayersOverlays();
}

if (USE_TEST_LOCATION) {
  afterLocate(TEST_LOCATION);
} else {
  navigator.geolocation.getCurrentPosition(
    async pos => afterLocate([pos.coords.latitude, pos.coords.longitude]),
    () => {
      const banner = document.getElementById("loc-banner");
      if (banner) {
        banner.className = "alert alert-info py-2 mb-2";
        banner.innerHTML = `
          <b>📍 Sin cobertura por ahora</b><br>
          <div class="mt-1">De momento no hay datos registrados en la zona, pronto habrá cobertura.</div>
          <div class="mt-2 tm-visit-box">
            <div class="small mb-2">Mientras tanto, puedes explorar Morona:</div>
            <button id="btn-visit-morona" class="btn btn-primary w-100">
              🧭 Visitar Morona
            </button>
          </div>
        `;

        const btn = document.getElementById("btn-visit-morona");
        if (btn) {
          btn.onclick = async () => {
            applyVisitMorona({
              setUserLocation: updateUserLocation,
              map,
              onAfterSet: async (loc2) => {
                await afterLocate(loc2);
              }
            });
          };
        }
      }
    }
  );
}

/* ================= EVENTO CATEGORÍA ================= */
category.onchange = async () => {
  resetMap();
  dataList.length = 0;

  if (!category.value) return;

  console.log("📍 Fachada:", detectedAdmin);
  console.log("🧠 ctxGeo (lógico):", ctxGeo);

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

  // ===== LUGARES POR CATEGORÍA =====
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
      <button class="btn btn-outline-primary" data-mode="bus">🚌</button>
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
    manual.buildRoute();
    refreshLayersOverlays();
  };

  document.querySelectorAll("[data-mode]").forEach(btn => {
    btn.onclick = () => {
      setTravelMode(btn.dataset.mode);
      manual.buildRoute();
      refreshLayersOverlays();
    };
  });
};