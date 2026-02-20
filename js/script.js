/* ================= IMPORTS ================= */
import { db } from "./services/firebase.js";
import { reverseGeocodeNominatim } from "./services/nominatim.js";

import {
  getProvinciasConDatos,
  getCantonesConDatos,
  getParroquiasConDatos
} from "./app/selects.js";

import { findNearest } from "./app/actions.js";
import { dataList, setUserLocation, getUserLocation } from "./app/state.js";

import {
  map,
  renderMarkers,
  clearMarkers,
  clearRoute,
  drawRoute,
  drawTwoLegOSRM,
  drawRouteBetweenPoints
} from "./map/map.js";

import {
  cargarLineasTransporte,
  clearTransportLayers,
  planAndShowBusStops
} from "./transport/transport_controller.js";

import { getLineasByTipoAll, isLineOperatingNow } from "./transport/core/transport_data.js";
import { getCollectionCache } from "./app/cache_db.js";

/* ================= ESTADO GLOBAL ================= */
let activePlace = null;
let activeMode = "walking";

/**
 * ✅ Fachada detectada (solo UI)
 */
let detectedAdmin = {
  provincia: "",
  canton: "",
  parroquia: ""
};

/**
 * ✅ Contexto lógico usado en filtros (puede diferir de fachada)
 */
let ctxGeo = {
  provincia: "",
  canton: "",
  parroquia: "",
  specialSevilla: false
};

/* ================= ELEMENTOS DEL DOM ================= */
const provincia = document.getElementById("provincia");
const canton = document.getElementById("canton");
const parroquia = document.getElementById("parroquia");
const category = document.getElementById("category");
const extra = document.getElementById("extra-controls");

/* ================= UX: ocultar selects base desde el inicio ================= */
function hideBaseSelects() {
  // no los quitamos, solo los ocultamos
  provincia?.classList?.add("d-none");
  canton?.classList?.add("d-none");
  parroquia?.classList?.add("d-none");
}
hideBaseSelects();

/* ================= HELPERS ================= */
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
}

function titleCaseWords(s) {
  const t = String(s || "").trim();
  if (!t) return "";
  return t
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function normLite(s) {
  return String(s || "").trim().toLowerCase();
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

/* ================= TERMINAL DEL CANTÓN ACTUAL ================= */
async function getUserCantonTerminal() {
  const lugares = await getCollectionCache("lugar");

  // ciudad hace las veces de cantón (según tu BD)
  // usamos ctxGeo.canton lógico
  const provSel = ctxGeo.provincia;
  const cantonSel = ctxGeo.canton;

  return (
    lugares.find(l => {
      if (!l?.activo) return false;
      if (String(l.provincia || "") !== String(provSel || "")) return false;
      if (String(l.ciudad || "") !== String(cantonSel || "")) return false;
      if (String(l.subcategoria || "").toLowerCase() !== "terminal") return false;
      return true;
    }) || null
  );
}

/* ================= MAPA: LUGAR ÚNICO ================= */
function showSinglePlace(place) {
  clearMarkers();
  renderMarkers([place], () => {
    if (activeMode !== "bus") {
      drawRoute(getUserLocation(), place, activeMode, document.getElementById("route-info"));
    }
  });
}

/* ================= RUTA (modo normal vs bus) ================= */
async function buildRoute() {
  if (!activePlace) return;

  clearRoute();
  clearTransportLayers();
  clearRouteInfo();

  const infoEl = document.getElementById("route-info");

  if (activeMode === "bus") {
    if (infoEl) {
      infoEl.innerHTML = `
        <div class="alert alert-info py-2 mb-2">
          ⏳ Buscando ruta en bus (urbano/rural)…
        </div>
      `;
    }

    await planAndShowBusStops(
      getUserLocation(),
      activePlace,
      {
        tipo: "auto",
        provincia: ctxGeo.provincia,
        canton: ctxGeo.canton,
        parroquia: ctxGeo.parroquia,
        specialSevilla: ctxGeo.specialSevilla,
        now: new Date()
      },
      { infoEl }
    );
    return;
  }

  drawRoute(getUserLocation(), activePlace, activeMode, infoEl);
}

/* ================= GEOLOCALIZACIÓN (con ubicación de prueba) =================
   ✅ Para probar: deja USE_TEST_LOCATION=true
   ✅ Para producción: ponlo en false y listo
============================================================================= */
const USE_TEST_LOCATION = false;
const TEST_LOCATION = [-2.385050, -78.115910];

function showLocatingBanner() {
  extra.innerHTML = `
    <div class="alert alert-info py-2 mb-2">
      📡 <b>Estamos ubicándote…</b><br>
      <small>Esto puede tardar unos segundos.</small>
    </div>
  `;
}



if (USE_TEST_LOCATION) {
  const loc = TEST_LOCATION;
  setUserLocation(loc);

  map.setView(loc, 13);
  L.marker(loc).addTo(map).bindPopup("🧪 Ubicación de prueba").openPopup();

  await detectAdminFromLatLng(loc);
  showDetectedFacade();

  // ✅ AÑADE ESTA LÍNEA
  enableCategoryUI();

} else {
  navigator.geolocation.getCurrentPosition(async pos => {
    const loc = [pos.coords.latitude, pos.coords.longitude];
    setUserLocation(loc);

    map.setView(loc, 14);
    L.marker(loc).addTo(map).bindPopup("📍 Tu ubicación").openPopup();

    await detectAdminFromLatLng(loc);
    showDetectedFacade();

    // ✅ AÑADE ESTA LÍNEA
    enableCategoryUI();

  }, () => {
    extra.innerHTML = `
      <div class="alert alert-danger py-2 mb-2">
        ❌ No se pudo obtener tu ubicación.
      </div>
    `;
  });
}

async function detectAdminFromLatLng(loc) {
  // fallback suave
  let admin = { provincia: "", canton: "", parroquia: "" };

  try {
    const a = await reverseGeocodeNominatim(loc[0], loc[1]);
    admin = {
      provincia: titleCaseWords(a.provincia),
      canton: titleCaseWords(a.canton),
      parroquia: titleCaseWords(a.parroquia)
    };
  } catch (e) {
    console.warn("Nominatim falló:", e);
  }

  // ✅ Caso especial: Nominatim puede decir Sevilla Don Bosco o algo con Sevilla
  const anySevilla =
    normLite(admin.canton).includes("sevilla") ||
    normLite(admin.parroquia).includes("sevilla");

  if (anySevilla) {
    detectedAdmin = {
      provincia: "Morona Santiago",
      canton: "Sevilla Don Bosco",
      parroquia: "Sevilla Don Bosco"
    };

    // lógica: Sevilla se maneja como “parroquia especial” pero puede mostrar Morona también
    ctxGeo = {
      provincia: "Morona Santiago",
      canton: "Sevilla Don Bosco",
      parroquia: "Sevilla Don Bosco",
      specialSevilla: true
    };
    return;
  }

  detectedAdmin = {
    provincia: admin.provincia || "",
    canton: admin.canton || "",
    parroquia: admin.parroquia || ""
  };

  // lógica normal
  ctxGeo = {
    provincia: detectedAdmin.provincia,
    canton: detectedAdmin.canton,
    parroquia: detectedAdmin.parroquia,
    specialSevilla: false
  };
}

showLocatingBanner();

// ✅ ubicación: prueba o GPS real
if (USE_TEST_LOCATION) {
  const loc = TEST_LOCATION;
  setUserLocation(loc);

  map.setView(loc, 13);
  L.marker(loc).addTo(map).bindPopup("🧪 Ubicación de prueba").openPopup();

  await detectAdminFromLatLng(loc);
  showDetectedFacade();

} else {
  navigator.geolocation.getCurrentPosition(async pos => {
    const loc = [pos.coords.latitude, pos.coords.longitude];
    setUserLocation(loc);

    map.setView(loc, 14);
    L.marker(loc).addTo(map).bindPopup("📍 Tu ubicación").openPopup();

    await detectAdminFromLatLng(loc);
    showDetectedFacade();

  }, () => {
    extra.innerHTML = `
      <div class="alert alert-danger py-2 mb-2">
        ❌ No se pudo obtener tu ubicación.
      </div>
    `;
  });
}

/* ================= EVENTO CATEGORÍA ================= */
category.onchange = async () => {
  resetMap();
  dataList.length = 0;

  if (!category.value) return;

  // debug fachada y lógica
  console.log("📍 Fachada:", detectedAdmin);
  console.log("🧠 ctxGeo (lógico):", ctxGeo);

  /* ===== LÍNEAS DE TRANSPORTE ===== */
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

      // ✅ para rural: Sevilla => trae todas
      const allLineas = await getLineasByTipoAll(tipo, {
        provincia: ctxGeo.provincia,
        canton: ctxGeo.canton,
        parroquia: ctxGeo.parroquia,
        ignoreGeoFilter: (tipo === "rural" && ctxGeo.specialSevilla)
      });

      // ✅ “fuera de servicio” como POPUP (no en panel)
      const fuera = allLineas
        .filter(l => !isLineOperatingNow(l, now))
        .sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0));

      if (fuera.length) {
        const hh = String(now.getHours()).padStart(2, "0");
        const mm = String(now.getMinutes()).padStart(2, "0");
        const items = fuera
          .map(l => `• <b>${l.codigo}</b> - ${l.nombre || ""}`)
          .join("<br>");

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
    };

    return;
  }

  /* ===== LUGARES POR CATEGORÍA ===== */
  const lugares = await getCollectionCache("lugar");
  const all = [];

  const provSel = ctxGeo.provincia;
  const cantonSel = ctxGeo.canton;
  const parroquiaSel = ctxGeo.parroquia;
  const catSel = String(category.value || "").toLowerCase();

  // ✅ filtro base por provincia + subcategoria
  const base = lugares.filter(l => {
    if (!l?.activo) return false;
    if (String(l.provincia || "") !== String(provSel || "")) return false;
    if (String(l.subcategoria || "").toLowerCase() !== catSel) return false;
    return true;
  });

  // ✅ caso Sevilla: mostrar Sevilla Don Bosco + Morona
  // ciudad == cantón
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

  // ✅ debug en consola
  console.log(`📦 Lugares obtenidos (${catSel}):`, all);

  if (!all.length) {
    showModal(
      "Sin datos",
      `
        <div class="alert alert-info py-2 mb-0">
          ❌ No hay lugares registrados en la BD para:<br>
          <b>${provSel || "?"}</b> / <b>${cantonSel || "?"}</b> / <b>${parroquiaSel || "(sin parroquia detectada)"}</b><br>
          <div class="small mt-2">* Si Nominatim no detecta parroquia, se muestra por cantón.</div>
        </div>
      `
    );
    extra.innerHTML = "";
    return;
  }

  // ✅ ordenar: prioridad parroquia (si existe), y Sevilla primero si special
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

    // si Nominatim no dio parroquia, no priorizamos
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
    activePlace = place;
    showSinglePlace(place);
    buildRoute();
  });

  sel.onchange = () => {
    activePlace = dataList[sel.value];
    if (!activePlace) return;
    showSinglePlace(activePlace);
    buildRoute();
  };

  document.getElementById("near").onclick = () => {
    activePlace = findNearest(dataList);
    if (!activePlace) return;
    showSinglePlace(activePlace);
    buildRoute();
  };

  document.querySelectorAll("[data-mode]").forEach(btn => {
    btn.onclick = () => {
      activeMode = btn.dataset.mode;
      buildRoute();
    };
  });
};
function enableCategoryUI() {
  if (!category) return;
  category.disabled = false;
  category.classList.remove("d-none");   // <-- clave
  category.value = "";                  // reset
}
