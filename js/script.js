/* ================= IMPORTS ================= */
import { db } from "./services/firebase.js";

import {
  getProvinciasConDatos,
  getCantonesConDatos,
  getParroquiasConDatos
} from "./app/selects.js";

import { findNearest } from "./app/actions.js";
import { dataList, setUserLocation, getUserLocation } from "./app/state.js";

import { map, renderMarkers, clearMarkers, clearRoute, drawRoute } from "./map/map.js";
import { cargarLineasTransporte, clearTransportLayers, planAndShowBusStops } from "./transport/transport_controller.js";

import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* ================= ESTADO GLOBAL ================= */
let activePlace = null;
let activeMode = "walking";

/* ================= ELEMENTOS DEL DOM ================= */
const provincia = document.getElementById("provincia");
const canton = document.getElementById("canton");
const parroquia = document.getElementById("parroquia");
const category = document.getElementById("category");
const extra = document.getElementById("extra-controls");

/* ================= HELPERS ================= */
function clearRouteInfo() {
  const el = document.getElementById("route-info");
  if (el) el.innerHTML = "";
}

/**
 * Reinicia el mapa: quita rutas y marcadores (incluye transporte)
 */
function resetMap() {
  clearMarkers();
  clearRoute();
  clearTransportLayers();
  clearRouteInfo();
  activePlace = null;
}

/**
 * Muestra solo un lugar en el mapa y traza la ruta desde la ubicación del usuario
 * @param {Object} place Lugar a mostrar
 */
function showSinglePlace(place) {
  clearMarkers();
  renderMarkers([place], () => {
    // solo dibujamos ruta "normal" si NO es bus
    if (activeMode !== "bus") {
      drawRoute(getUserLocation(), place, activeMode, document.getElementById("route-info"));
    }
  });
}

/**
 * Construye la ruta usando el lugar activo y el modo activo
 */
async function buildRoute() {
  if (!activePlace) return;

  clearRoute();
  clearTransportLayers();
  clearRouteInfo();

  const infoEl = document.getElementById("route-info");

  if (activeMode === "bus") {
    // ✅ ctx para filtrar líneas por cantonpasa/ciudadpasa (parroquia)
    await planAndShowBusStops(
      getUserLocation(),
      activePlace,
      {
        tipo: "urbano",
        provincia: provincia.value,
        canton: canton.value,
        ciudad: parroquia.value // (parroquia)
      },
      { infoEl }
    );
    return;
  }

  drawRoute(getUserLocation(), activePlace, activeMode, infoEl);
}

/* ================= GEOLOCALIZACIÓN ================= */
navigator.geolocation.getCurrentPosition(pos => {
  const loc = [pos.coords.latitude, pos.coords.longitude];
  setUserLocation(loc);

  L.marker(loc).addTo(map).bindPopup("📍 Tu ubicación");
});

/* ================= CARGAR PROVINCIAS ================= */
(async () => {
  const provincias = await getProvinciasConDatos();
  provincia.innerHTML = `<option value="">🏞️ Seleccione provincia</option>`;
  provincias.forEach(p => (provincia.innerHTML += `<option value="${p}">${p}</option>`));
})();

/* ================= EVENTO PROVINCIA ================= */
provincia.onchange = async () => {
  resetMap();

  canton.disabled = false;
  canton.innerHTML = `<option value="">🏙️ Seleccione cantón</option>`;

  parroquia.classList.add("d-none");
  parroquia.disabled = true;
  parroquia.innerHTML = `<option value="">🏘️ Seleccione parroquia</option>`;

  category.value = "";
  category.classList.add("d-none");

  extra.innerHTML = "";

  const cantones = await getCantonesConDatos(provincia.value);
  cantones.forEach(c => (canton.innerHTML += `<option value="${c}">${c}</option>`));
};

/* ================= EVENTO CANTÓN ================= */
canton.onchange = async () => {
  resetMap();

  parroquia.disabled = false;
  parroquia.classList.remove("d-none");
  parroquia.innerHTML = `<option value="">🏘️ Seleccione parroquia</option>`;

  category.value = "";
  category.classList.add("d-none");

  extra.innerHTML = "";

  const parroquias = await getParroquiasConDatos(provincia.value, canton.value);
  parroquias.forEach(p => (parroquia.innerHTML += `<option value="${p}">${p}</option>`));
};

/* ================= EVENTO PARROQUIA ================= */
parroquia.onchange = () => {
  resetMap();

  category.value = "";
  category.classList.remove("d-none");

  extra.innerHTML = "";
};

/* ================= EVENTO CATEGORÍA ================= */
category.onchange = async () => {
  resetMap();
  extra.innerHTML = "";
  dataList.length = 0;

  if (!category.value) return;

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

    tipoSel.onchange = e => {
      cargarLineasTransporte(e.target.value, lineasContainer, {
        provincia: provincia.value,
        canton: canton.value,
        ciudad: parroquia.value
      });
    };

    return;
  }

  /* ===== LUGARES POR CATEGORÍA =====
     ✅ ahora incluye lugares de otras parroquias del mismo cantón,
     pero PRIORIZA los de la parroquia seleccionada y muestra el indicativo.
  */
  const snap = await getDocs(collection(db, "lugar"));
  const all = [];

  snap.forEach(d => {
    const l = d.data();
    if (!l?.activo) return;

    if (l.provincia !== provincia.value) return;
    if (l.ciudad !== canton.value) return; // ciudad = cantón en "lugar"
    if (l.subcategoria?.toLowerCase() !== category.value.toLowerCase()) return;

    all.push(l);
  });

  if (!all.length) {
    extra.innerHTML = "❌ No hay lugares en esta categoría.";
    return;
  }

  // ✅ ordenar: primero parroquia seleccionada, luego el resto
  const parroquiaSel = parroquia.value;
  all.sort((a, b) => {
    const aKey = (a.parroquia === parroquiaSel) ? 0 : 1;
    const bKey = (b.parroquia === parroquiaSel) ? 0 : 1;
    if (aKey !== bKey) return aKey - bKey;
    return String(a.nombre || "").localeCompare(String(b.nombre || ""));
  });

  dataList.push(...all);

  /* ===== CONTROLES ===== */
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
    const ptxt = l.parroquia ? ` (Parroquia: ${l.parroquia})` : "";
    sel.innerHTML += `<option value="${i}">${l.nombre || "Lugar"}${ptxt}</option>`;
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
