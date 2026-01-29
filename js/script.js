/* ================= IMPORTS ================= */
import { db } from "./services/firebase.js";

import { getProvinciasConDatos, getCantonesConDatos, getParroquiasConDatos } from "./app/selects.js";
import { findNearest } from "./app/actions.js";
import { dataList, setUserLocation, getUserLocation } from "./app/state.js";

import { map, renderMarkers, clearMarkers, clearRoute, drawRoute } from "./map/map.js";
import { cargarLineasTransporte } from "./transport/transport_controller.js";

import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* ================= ESTADO GLOBAL ================= */
let activePlace = null;      // Lugar seleccionado
let activeMode = "walking";  // Modo de transporte seleccionado

/* ================= ELEMENTOS DEL DOM ================= */
const provincia = document.getElementById("provincia");
const canton = document.getElementById("canton");
const parroquia = document.getElementById("parroquia");
const category = document.getElementById("category");
const extra = document.getElementById("extra-controls");

/* ================= HELPERS ================= */

/**
 * Reinicia el mapa: quita rutas y marcadores
 */
function resetMap() {
  clearMarkers();
  clearRoute();
  activePlace = null;
}

/**
 * Muestra solo un lugar en el mapa y traza la ruta desde la ubicación del usuario
 * @param {Object} place Lugar a mostrar
 */
function showSinglePlace(place) {
  clearMarkers();  // Solo se muestra este marcador
  renderMarkers([place], () => {
    drawRoute(getUserLocation(), place, activeMode, document.getElementById("route-info"));
  });
}

/**
 * Construye la ruta usando el lugar activo y el modo activo
 */
function buildRoute() {
  if (!activePlace) return;
  clearRoute();
  drawRoute(getUserLocation(), activePlace, activeMode, document.getElementById("route-info"));
}

/* ================= GEOLOCALIZACIÓN ================= */
navigator.geolocation.getCurrentPosition(pos => {
  const loc = [pos.coords.latitude, pos.coords.longitude];
  setUserLocation(loc);

  // Marcador de la ubicación del usuario
  L.marker(loc)
    .addTo(map)
    .bindPopup("📍 Tu ubicación");
});

/* ================= CARGAR PROVINCIAS ================= */
(async () => {
  const provincias = await getProvinciasConDatos();
  provincia.innerHTML = `<option value="">🏞️ Seleccione provincia</option>`;
  provincias.forEach(p => provincia.innerHTML += `<option value="${p}">${p}</option>`);
})();

/* ================= EVENTO PROVINCIA ================= */
provincia.onchange = async () => {
  resetMap();
  canton.disabled = false;
  canton.innerHTML = `<option value="">🏙️ Seleccione cantón</option>`;
  parroquia.classList.add("d-none");
  category.classList.add("d-none");
  extra.innerHTML = "";

  const cantones = await getCantonesConDatos(provincia.value);
  cantones.forEach(c => canton.innerHTML += `<option value="${c}">${c}</option>`);
};

/* ================= EVENTO CANTÓN ================= */
canton.onchange = async () => {
  resetMap();
  parroquia.disabled = false;
  parroquia.classList.remove("d-none");
  parroquia.innerHTML = `<option value="">🏘️ Seleccione parroquia</option>`;
  category.classList.add("d-none");
  extra.innerHTML = "";

  const parroquias = await getParroquiasConDatos(provincia.value, canton.value);
  parroquias.forEach(p => parroquia.innerHTML += `<option value="${p}">${p}</option>`);
};

/* ================= EVENTO PARROQUIA ================= */
parroquia.onchange = () => {
  resetMap();
  category.classList.remove("d-none");
  extra.innerHTML = "";
};

/* ================= EVENTO CATEGORÍA ================= */
category.onchange = async () => {
  resetMap();
  extra.innerHTML = "";
  dataList.length = 0;

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

    document.getElementById("tipo").onchange = e =>
      cargarLineasTransporte(e.target.value, document.getElementById("lineas"));

    return;
  }

  /* ===== LUGARES POR CATEGORÍA ===== */
  const snap = await getDocs(collection(db, "lugar"));
  snap.forEach(d => {
    const l = d.data();
    if (
      l.activo &&
      l.provincia === provincia.value &&
      l.ciudad === canton.value &&
      l.parroquia === parroquia.value &&
      l.subcategoria?.toLowerCase() === category.value.toLowerCase()
    ) dataList.push(l);
  });

  if (!dataList.length) {
    extra.innerHTML = "❌ No hay lugares en esta categoría.";
    return;
  }

  /* ===== CONTROLES DE SELECCIÓN ===== */
  extra.innerHTML = `
    <select id="lugares" class="form-select mb-2">
      <option value="">📍 Seleccione lugar</option>
    </select>

    <button id="near" class="btn btn-primary w-100 mb-2">
      📏 Lugar más cercano
    </button>

    <div class="btn-group w-100 mb-2">
      <button class="btn btn-outline-primary" data-mode="walking">🚶</button>
      <button class="btn btn-outline-primary" data-mode="cycling">🚴</button>
      <button class="btn btn-outline-primary" data-mode="motorcycle">🏍️</button>
      <button class="btn btn-outline-primary" data-mode="driving">🚗</button>
      <button class="btn btn-outline-primary" data-mode="bus">🚌</button>
    </div>

    <div id="route-info" class="small"></div>
  `;

  const sel = document.getElementById("lugares");

  // Rellenar select de lugares
  dataList.forEach((l, i) => sel.innerHTML += `<option value="${i}">${l.nombre}</option>`);

  // Marcadores clicables
  renderMarkers(dataList, place => {
    activePlace = place;
    showSinglePlace(place);
    buildRoute();
  });

  // Selección de lugar desde dropdown
  sel.onchange = () => {
    activePlace = dataList[sel.value];
    if (!activePlace) return;
    showSinglePlace(activePlace);
    buildRoute();
  };

  // Lugar más cercano
  document.getElementById("near").onclick = () => {
    activePlace = findNearest(dataList);
    if (!activePlace) return;
    showSinglePlace(activePlace);
    buildRoute();
  };

  // Botones de modos de transporte
  document.querySelectorAll("[data-mode]").forEach(btn => {
    btn.onclick = () => {
      activeMode = btn.dataset.mode;
      buildRoute();
    };
  });
};
