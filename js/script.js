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

import { map, renderMarkers, clearMarkers, clearRoute, drawRoute } from "./map/map.js";
import {
  cargarLineasTransporte,
  clearTransportLayers,
  planAndShowBusStops
} from "./transport/transport_controller.js";

// ✅ horario + estado operación
import {
  getLineasByTipoAll,
  isLineOperatingNow,
  formatLineScheduleHTML
} from "./transport/core/transport_data.js";

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

function ensureModal() {
  let modal = document.getElementById("app-modal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "app-modal";
  modal.className = "modal fade";
  modal.tabIndex = -1;
  modal.innerHTML = `
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title" id="app-modal-title">Aviso</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>
        </div>
        <div class="modal-body" id="app-modal-body"></div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cerrar</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

function showAppPopup(html, { title = "Aviso" } = {}) {
  const modalEl = ensureModal();
  modalEl.querySelector("#app-modal-title").textContent = title;

  modalEl.querySelector("#app-modal-body").innerHTML = `
    ${html}
    <div class="small text-muted mt-3">
      ⓘ Los tiempos y paradas mostrados son <b>aproximados</b> (no en tiempo real).
    </div>
  `;

  // Bootstrap Modal (requiere bootstrap.js cargado)
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl, {
    backdrop: true,
    keyboard: true
  });
  modal.show();
}

function clearPopupIfAny() {
  const modalEl = document.getElementById("app-modal");
  if (!modalEl) return;
  const inst = bootstrap.Modal.getInstance(modalEl);
  if (inst) inst.hide();
}


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
  clearPopupIfAny();
  activePlace = null;
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
  clearPopupIfAny();

  const infoEl = document.getElementById("route-info");

  if (activeMode === "bus") {
    if (infoEl) {
      infoEl.innerHTML = `
        <div class="alert alert-info py-2 mb-2">
          🚌 <b>Por favor espere…</b><br>
          Estamos buscando una ruta de bus (paradas cercanas + línea idónea)…
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

/* ================= GEOLOCALIZACIÓN + AUTO-SELECT ================= */
navigator.geolocation.getCurrentPosition(async pos => {
  const loc = [pos.coords.latitude, pos.coords.longitude];
  setUserLocation(loc);

  L.marker(loc).addTo(map).bindPopup("📍 Tu ubicación");

  try {
    const admin = await reverseGeocodeNominatim(loc[0], loc[1]);

    // 1) cargar provincias
    const provincias = await getProvinciasConDatos();
    provincia.innerHTML = `<option value="">🏞️ Seleccione provincia</option>`;
    provincias.forEach(p => (provincia.innerHTML += `<option value="${p}">${p}</option>`));

    // 2) set provincia
    if (admin.provincia && provincias.includes(admin.provincia)) {
      provincia.value = admin.provincia;
      provincia.disabled = true;
    } else {
      extra.innerHTML = `
        <div class="alert alert-info py-2">
          ❌ Aún no hay datos para tu provincia: <b>${admin.provincia || "desconocida"}</b><br>
          Muy pronto estará disponible para tu zona.
        </div>
      `;
      return;
    }

    // 3) cantones
    const cantones = await getCantonesConDatos(provincia.value);
    canton.disabled = false;
    canton.innerHTML = `<option value="">🏙️ Seleccione cantón</option>`;
    cantones.forEach(c => (canton.innerHTML += `<option value="${c}">${c}</option>`));

    if (admin.canton && cantones.includes(admin.canton)) {
      canton.value = admin.canton;
      canton.disabled = true;
    } else {
      extra.innerHTML = `
        <div class="alert alert-info py-2">
          ❌ Aún no hay datos para tu cantón: <b>${admin.canton || "desconocido"}</b><br>
          Muy pronto estará disponible para tu zona.
        </div>
      `;
      return;
    }

    // 4) parroquias (✅ SOLO las que tienen lugares en BD)
    const parroquias = await getParroquiasConDatos(provincia.value, canton.value);

    parroquia.disabled = false;
    parroquia.classList.remove("d-none");
    parroquia.innerHTML = `<option value="">🏘️ Seleccione parroquia</option>`;
    parroquias.forEach(p => (parroquia.innerHTML += `<option value="${p}">${p}</option>`));

    if (admin.parroquia && parroquias.includes(admin.parroquia)) {
      parroquia.value = admin.parroquia;
    }

    // 5) activar categoría
    category.value = "";
    category.classList.remove("d-none");

  } catch (e) {
    extra.innerHTML = `
      <div class="alert alert-warning py-2">
        ❌ No se pudo detectar provincia/cantón/parroquia automáticamente.
      </div>
    `;
    console.error(e);
  }
});

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

  // ✅ SOLO parroquias con lugares
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

    // cache local para mostrar popup al elegir línea
    let lineMap = new Map();
    let tipoActual = "";

    // Delegación: solo en esta categoría
    lineasContainer.addEventListener("change", (ev) => {
      const t = ev.target;

      // popup SOLO cuando se selecciona una línea
      if (t && t.id === "select-linea") {
        const codigo = t.value;
        if (!codigo) return;

        const l = lineMap.get(codigo);
        if (!l) return;

        const now = new Date();
        const op = isLineOperatingNow(l, now);

        const nowTxt = now.toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" });

        if (!op) {
          showAppPopup(
            `
              ⛔ <b>${l.codigo}</b> ${l.nombre ? `- ${l.nombre}` : ""}<br>
              <div class="mt-2">
                <b>Estado:</b> Fuera de servicio ahora<br>
                🕒 <b>Hora actual:</b> ${nowTxt}
              </div>
              <hr class="my-2">
              ${formatLineScheduleHTML(l)}
            `,
            { title: "Línea fuera de servicio" }
          );
        } else {
          showAppPopup(
            `
              ✅ <b>${l.codigo}</b> ${l.nombre ? `- ${l.nombre}` : ""}<br>
              <div class="mt-2">
                <b>Estado:</b> Operativa ahora<br>
                🕒 <b>Hora actual:</b> ${nowTxt}
              </div>
              <hr class="my-2">
              ${formatLineScheduleHTML(l)}
            `,
            { title: "Horario y frecuencia" }
          );
        }
      }
    });

    tipoSel.onchange = async (e) => {
      const tipo = e.target.value;
      tipoActual = tipo;
      lineasContainer.innerHTML = "";
      lineMap = new Map();
      clearPopupIfAny();

      if (!tipoActual) return;

      // ✅ 1) traer líneas del área para poder mostrar popup por código
      const ctxGeo = {
        canton: canton.value,
        parroquia: parroquia.value
      };

      const allLineas = await getLineasByTipoAll(tipoActual, ctxGeo);
      allLineas.forEach(l => lineMap.set(l.codigo, l));

      // ✅ 2) UI normal (tu módulo urbano/rural se encarga)
      cargarLineasTransporte(tipoActual, lineasContainer, {
        provincia: provincia.value,
        canton: canton.value,
        parroquia: parroquia.value,
        now: new Date()
      });
    };

    return;
  }

  /* ===== LUGARES POR CATEGORÍA (prioriza parroquia seleccionada) ===== */
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
    extra.innerHTML = `
      <div class="alert alert-info py-2 mb-2">
        ❌ No hay lugares en esta categoría para <b>${parroquia.value || "este cantón"}</b>.<br>
        Muy pronto estará disponible para tu zona.
      </div>
    `;
    return;
  }

  // ordenar: primero parroquia seleccionada, luego el resto
  const parroquiaSel = parroquia.value;
  all.sort((a, b) => {
    const aKey = (a.parroquia === parroquiaSel) ? 0 : 1;
    const bKey = (b.parroquia === parroquiaSel) ? 0 : 1;
    if (aKey !== bKey) return aKey - bKey;
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
