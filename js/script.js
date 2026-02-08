/* ================= IMPORTS ================= */
import { db } from "./services/firebase.js";
import { reverseGeocodeNominatim, toTitleCase } from "./services/nominatim.js";

import { getParroquiasConDatos } from "./app/selects.js";

import { findNearest } from "./app/actions.js";
import { dataList, setUserLocation, getUserLocation } from "./app/state.js";

import { map, renderMarkers, clearMarkers, clearRoute, drawRoute } from "./map/map.js";
import {
  cargarLineasTransporte,
  clearTransportLayers,
  planAndShowBusStops
} from "./transport/transport_controller.js";

// (esto ya lo estabas usando)
import { getLineasByTipoAll, isLineOperatingNow } from "./transport/core/transport_data.js";

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
}

function showInfoBox(html, type = "info") {
  extra.innerHTML = `
    <div class="alert alert-${type} py-2 mb-2">
      ${html}
    </div>
  `;
}

function clearExtraMessageOnly() {
  // deja los controles normales que ya renderizas, solo limpia alerts simples
  // (si estás usando extra para UI completa, NO lo limpies aquí)
}

/**
 * Muestra solo un lugar en el mapa y traza la ruta desde la ubicación del usuario
 */
function showSinglePlace(place) {
  clearMarkers();
  renderMarkers([place], () => {
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
    if (infoEl) {
      infoEl.innerHTML = `
        <div class="alert alert-info py-2 mb-0">
          ⏳ Por favor espere… estamos buscando una ruta en bus.
        </div>
      `;
    }

    await planAndShowBusStops(
      getUserLocation(),
      activePlace,
      {
        tipo: "urbano",
        provincia: provincia.value,
        canton: canton.value,
        parroquia: parroquia.value,
        now: new Date()
      },
      { infoEl }
    );
    return;
  }

  drawRoute(getUserLocation(), activePlace, activeMode, infoEl);
}

/* =========================================================
   GEOLOCALIZACIÓN + AUTO-SELECT (Nominatim)
   - Provincia/Cantón: siempre desde Nominatim (aunque no haya BD)
   - Parroquias: SOLO desde BD (lugar) según provincia/cantón
========================================================= */
navigator.geolocation.getCurrentPosition(async pos => {
  const loc = [pos.coords.latitude, pos.coords.longitude];
  setUserLocation(loc);

  // ✅ mover/centrar mapa en el usuario
  map.setView(loc, 14);
  L.marker(loc).addTo(map).bindPopup("📍 Tu ubicación").openPopup();

  try {
    const admin = await reverseGeocodeNominatim(loc[0], loc[1]);

    const prov = toTitleCase(admin.provincia);
    const can = toTitleCase(admin.canton);
    const parrDetect = toTitleCase(admin.parroquia);

    // ✅ set provincia/cantón aunque no existan en BD
    provincia.innerHTML = `<option value="${prov}">${prov || "Desconocida"}</option>`;
    provincia.value = prov;
    provincia.disabled = true;

    canton.innerHTML = `<option value="${can}">${can || "Desconocido"}</option>`;
    canton.value = can;
    canton.disabled = true;

    // ✅ parroquias SOLO desde BD
    const parroquiasBD = await getParroquiasConDatos(prov, can);

    parroquia.classList.remove("d-none");
    parroquia.disabled = false;
    parroquia.innerHTML = `<option value="">🏘️ Seleccione parroquia</option>`;

    if (!parroquiasBD.length) {
      // no hay datos todavía para ese cantón/provincia
      parroquia.disabled = true;
      category.classList.add("d-none");
      showInfoBox(
        `❌ Aún no hay datos en la BD para <b>${prov || "Provincia"}</b>, <b>${can || "Cantón"}</b>.<br>
         Muy pronto estará disponible para tu zona.`,
        "warning"
      );
      return;
    }

    parroquiasBD.forEach(p => {
      parroquia.innerHTML += `<option value="${p}">${p}</option>`;
    });

    // ✅ si la parroquia detectada existe en BD, la seleccionamos
    if (parrDetect && parroquiasBD.includes(parrDetect)) {
      parroquia.value = parrDetect;
    }

    // habilitar categoría
    category.classList.remove("d-none");
    category.value = "";
    extra.innerHTML = "";

  } catch (e) {
    console.error(e);
    showInfoBox("❌ No se pudo detectar provincia/cantón/parroquia automáticamente.", "danger");
  }
});

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
      <div id="lineas-status" class="small mb-2"></div>

      <select id="tipo" class="form-select mb-2">
        <option value="">🚍 Tipo de transporte</option>
        <option value="urbano">Urbano</option>
        <option value="rural">Rural</option>
      </select>

      <div id="lineas"></div>
    `;

    const tipoSel = document.getElementById("tipo");
    const lineasContainer = document.getElementById("lineas");
    const statusEl = document.getElementById("lineas-status");

    tipoSel.onchange = async e => {
      const tipo = e.target.value;
      lineasContainer.innerHTML = "";
      if (statusEl) statusEl.innerHTML = "";

      if (!tipo) return;

      const ctxGeo = {
        canton: canton.value,
        parroquia: parroquia.value
      };

      const allLineas = await getLineasByTipoAll(tipo, ctxGeo);
      const now = new Date();

      const fuera = allLineas
        .filter(l => !isLineOperatingNow(l, now))
        .sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0));

      // ✅ esto solo informa, NO molesta con popups aquí.
      // (El popup “fuera de servicio” lo harás cuando el usuario elija la línea,
      // eso lo controlas en tu UI de urbano_controller/rural_controller)
      if (statusEl) {
        statusEl.innerHTML = `
          <div class="alert alert-info py-2 mb-2">
            ℹ️ Las frecuencias y horarios mostrados son <b>aproximados</b>.
          </div>
        `;
      }

      // UI normal (tu controlador puede filtrar/mostrar según horario)
      cargarLineasTransporte(tipo, lineasContainer, {
        provincia: provincia.value,
        canton: canton.value,
        parroquia: parroquia.value,
        now
      });
    };

    return;
  }

  /* ===== LUGARES POR CATEGORÍA (solo parroquia seleccionada) ===== */
  /* ===== LUGARES POR CATEGORÍA
   ✅ Trae lugares de TODO el cantón (todas las parroquias)
   ✅ Prioriza los de la parroquia seleccionada
===== */
const snap = await getDocs(collection(db, "lugar"));
const all = [];

const provSel = provincia.value;
const cantonSel = canton.value;      // en "lugar" el cantón está en ciudad
const catSel = String(category.value || "").toLowerCase();
const parroquiaSel = parroquia.value; // puede estar vacío si el usuario no elige

snap.forEach(d => {
  const l = d.data();
  if (!l?.activo) return;

  // mismo territorio base
  if (l.provincia !== provSel) return;
  if (l.ciudad !== cantonSel) return;

  // misma subcategoria
  if (String(l.subcategoria || "").toLowerCase() !== catSel) return;

  all.push(l);
});

if (!all.length) {
  extra.innerHTML = `
    <div class="alert alert-info py-2 mb-2">
      ❌ No hay lugares en esta categoría .
      <br>Muy pronto estará disponible para tu zona.
    </div>
  `;
  return;
}

// ✅ ordenar: 1) parroquia seleccionada primero, 2) el resto, 3) por nombre
all.sort((a, b) => {
  const aP = String(a.parroquia,a.ciudad || "");
  const bP = String(b.parroquia || "");

  // si no hay parroquia seleccionada, solo orden alfabético
  if (!parroquiaSel) {
    return String(a.nombre || "").localeCompare(String(b.nombre || ""));
  }

  const aKey = (aP === parroquiaSel) ? 0 : 1;
  const bKey = (bP === parroquiaSel) ? 0 : 1;

  if (aKey !== bKey) return aKey - bKey;

  // dentro del mismo grupo, orden alfabético por parroquia y nombre
  const pCmp = aP.localeCompare(bP);
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
    sel.innerHTML += `<option value="${i}">${l.nombre || "Lugar"}</option>`;
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
