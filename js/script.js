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

import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* ================= ESTADO GLOBAL ================= */
let activePlace = null;
let activeMode = "walking";
let userProvinciaName = "";
let userProvinciaCode = "";

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

/* ================= MODAL (POP-UP) ================= */
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
  const snap = await getDocs(collection(db, "lugar"));
  const provSel = provincia.value;
  const cantonSel = canton.value;

  let terminal = null;

  snap.forEach(d => {
    const l = d.data();
    if (!l?.activo) return;
    if (l.provincia !== provSel) return;
    if (l.ciudad !== cantonSel) return; // ciudad = cantón
    if (String(l.subcategoria || "").toLowerCase() !== "terminal") return;
    terminal = l;
  });

  return terminal;
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

/* ================= GEOLOCALIZACIÓN + AUTO-SELECT ================= */
navigator.geolocation.getCurrentPosition(async pos => {
  const loc = [pos.coords.latitude, pos.coords.longitude];
  setUserLocation(loc);

  map.setView(loc, 14);
  L.marker(loc).addTo(map).bindPopup("📍 Tu ubicación").openPopup();

  try {
    const admin = await reverseGeocodeNominatim(loc[0], loc[1]);
    const provDetected = titleCaseWords(admin.provincia);
    const cantonDetected = titleCaseWords(admin.canton);
    const parroquiaDetected = titleCaseWords(admin.parroquia);

    userProvinciaName = provDetected;

    const provincias = await getProvinciasConDatos();
    provincia.innerHTML = `<option value="">🏞️ Seleccione provincia</option>`;
    provincias.forEach(p => (provincia.innerHTML += `<option value="${p}">${p}</option>`));

    if (provDetected && provincias.includes(provDetected)) {
      provincia.value = provDetected;
      provincia.disabled = true;
    } else {
      extra.innerHTML = `❌ Aún no hay datos para tu provincia: <b>${provDetected || "desconocida"}</b>`;
      return;
    }

    const cantones = await getCantonesConDatos(provincia.value);
    canton.disabled = false;
    canton.innerHTML = `<option value="">🏙️ Seleccione cantón</option>`;
    cantones.forEach(c => (canton.innerHTML += `<option value="${c}">${c}</option>`));

    if (cantonDetected && cantones.includes(cantonDetected)) {
      canton.value = cantonDetected;
      canton.disabled = true;
    } else {
      extra.innerHTML = `❌ Aún no hay datos para tu cantón: <b>${cantonDetected || "desconocido"}</b>`;
      return;
    }

    const parroquias = await getParroquiasConDatos(provincia.value, canton.value);
    parroquia.disabled = false;
    parroquia.classList.remove("d-none");
    parroquia.innerHTML = `<option value="">🏘️ Seleccione parroquia</option>`;
    parroquias.forEach(p => (parroquia.innerHTML += `<option value="${p}">${p}</option>`));

    if (parroquiaDetected && parroquias.includes(parroquiaDetected)) parroquia.value = parroquiaDetected;

    category.value = "";
    category.classList.remove("d-none");

    // código de provincia del usuario (para filtrar cantones destino)
    const provSnap = await getDocs(collection(db, "provincias"));
    provSnap.forEach(d => {
      const p = d.data();
      const nombre = titleCaseWords(p.Nombre || p.nombre);
      if (nombre === titleCaseWords(userProvinciaName)) {
        userProvinciaCode = String(p.codigo || "").trim();
      }
    });

  } catch (e) {
    extra.innerHTML = "❌ No se pudo detectar provincia/cantón/parroquia automáticamente.";
    console.error(e);
  }
});

/* ================= EVENTOS SELECTS BASE ================= */
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

/* =========================================================
   ✅ IR A PROVINCIA / IR A CANTÓN (vía Terminal) con mismos modos
   (igual que categorías normales, excepto transporte_lineas)
========================================================= */
if (category.value === "ir_provincia" || category.value === "ir_canton") {
  extra.innerHTML = `
    <div class="mb-2">
      <label class="form-label small mb-1">${
        category.value === "ir_provincia" ? "Provincia destino" : "Cantón destino"
      }</label>
      <select id="dest_admin" class="form-select">
        <option value="">Seleccione...</option>
      </select>
    </div>

    <div class="mb-2">
      <label class="form-label small mb-1">Modo de traslado</label>
      <div class="btn-group w-100">
        <button class="btn btn-outline-primary active" data-admin-mode="driving">🚗</button>
        <button class="btn btn-outline-primary" data-admin-mode="walking">🚶</button>
        <button class="btn btn-outline-primary" data-admin-mode="bicycle">🚴</button>
        <button class="btn btn-outline-primary" data-admin-mode="motorcycle">🏍️</button>
        <button class="btn btn-outline-primary" data-admin-mode="bus">🚌</button>
      </div>
    </div>

    <div id="admin-route-info" class="small"></div>
  `;

  const destSel = document.getElementById("dest_admin");
  const infoEl = document.getElementById("admin-route-info");

  let adminMode = "driving";
  let targetLL = null; // latlng destino

  // ====== cargar destinos ======
  if (category.value === "ir_provincia") {
    const provSnap = await getDocs(collection(db, "provincias"));
    const provs = [];

    provSnap.forEach(d => {
      const p = d.data();
      const n = titleCaseWords(p.Nombre || p.nombre);
      if (!n) return;

      // excluir provincia actual del usuario
      if (titleCaseWords(n) === titleCaseWords(provincia.value)) return;

      provs.push(n);
    });

    provs.sort((a, b) => a.localeCompare(b));
    provs.forEach(n => (destSel.innerHTML += `<option value="${n}">${n}</option>`));

  } else {
    // cantones de la provincia del usuario (por codigo_provincia) excluyendo su cantón
    const cantSnap = await getDocs(collection(db, "cantones"));
    const cants = [];

    cantSnap.forEach(d => {
      const c = d.data();
      const cp = String(c.codigo_provincia || "").trim().toLowerCase();

      if (!userProvinciaCode || cp !== String(userProvinciaCode).toLowerCase()) return;

      const n = titleCaseWords(c.nombre || c.Nombre);
      if (!n) return;

      if (titleCaseWords(n) === titleCaseWords(canton.value)) return; // excluir cantón actual

      cants.push(n);
    });

    cants.sort((a, b) => a.localeCompare(b));
    cants.forEach(n => (destSel.innerHTML += `<option value="${n}">${n}</option>`));
  }

  // ====== helper: calcular y pintar (se llama al cambiar destino o modo) ======
  async function recomputeAdminRoute() {
    if (!destSel.value || !targetLL) {
      infoEl.innerHTML = "";
      return;
    }

    const userLoc = getUserLocation();
    if (!userLoc) {
      infoEl.innerHTML = "❌ No hay ubicación de usuario.";
      return;
    }

    // auto = directo al destino
    if (adminMode === "driving") {
      clearTransportLayers();
      clearRoute();

      infoEl.innerHTML = `
        <div class="alert alert-info py-2 mb-2">
          📌 Ruta directa al destino (Auto).
        </div>
      `;

      // usa tu drawRoute normal pero necesita un "place" con ubicacion
      const fakePlace = { nombre: destSel.value, ubicacion: { latitude: targetLL[0], longitude: targetLL[1] } };
      await drawRoute(userLoc, fakePlace, "driving", infoEl);

      return;
    }

    // walking/bicycle/motorcycle/bus = vía terminal
    const terminal = await getUserCantonTerminal(); // debe devolverte doc lugar terminal del cantón usuario
    if (!terminal?.ubicacion?.latitude || !terminal?.ubicacion?.longitude) {
      infoEl.innerHTML = `
        <div class="alert alert-danger py-2 mb-2">
          ❌ No hay un <b>Terminal</b> registrado en tu cantón (${canton.value}).
        </div>
      `;
      return;
    }

    const terminalLL = [terminal.ubicacion.latitude, terminal.ubicacion.longitude];

    // popup cerrable (solo aquí)
    showModal(
      "Transporte interprovincial",
      `Debes tomar <b>transporte interprovincial</b> desde el <b>Terminal Terrestre</b> del cantón <b>${canton.value}</b>.`
    );

    clearTransportLayers();
    clearRoute();

    // BUS: mostrar línea que te deja cerca al terminal
    if (adminMode === "bus") {
      infoEl.innerHTML = `
        <div class="alert alert-info py-2 mb-2">
          ⏳ Buscando línea en bus hacia el <b>Terminal</b>…
        </div>
      `;

      await planAndShowBusStops(
        userLoc,
        terminal,
        {
          tipo: "urbano",
          provincia: provincia.value,
          canton: canton.value,
          parroquia: parroquia.value,
          now: new Date()
        },
        { infoEl }
      );

      // tramo 2: terminal -> destino en auto (otro color)
      await drawRouteBetweenPoints({
        from: terminalLL,
        to: targetLL,
        mode: "driving",
        color: "#0d6efd",
        dash: false
      });

      infoEl.innerHTML += `
        <div class="mt-2">
          <b>Tramo 2</b>: Terminal → ${destSel.value}<br>
          <small>* Ruta referencial (aprox.).</small>
        </div>
      `;

      map.fitBounds(L.latLngBounds([userLoc, terminalLL, targetLL]).pad(0.2));
      return;
    }

    // walking/bicycle/motorcycle: 2 tramos OSRM con colores diferentes
    const osrmMode = (adminMode === "motorcycle") ? "driving" : adminMode;

    await drawTwoLegOSRM({
      userLoc,
      terminalLoc: terminalLL,
      targetLoc: targetLL,
      mode: osrmMode,
      color1: "#6c757d", // usuario->terminal (gris)
      color2: "#0d6efd", // terminal->destino (azul)
      infoBox: infoEl,
      title: `Ruta vía Terminal → ${destSel.value}`
    });

    infoEl.innerHTML += `<div class="small mt-1">* Ruta referencial (aprox.).</div>`;
  }

  // ====== cuando elige destino: resolver ubicación del doc ======
  destSel.onchange = async () => {
    const name = destSel.value;
    targetLL = null;

    if (!name) {
      infoEl.innerHTML = "";
      return;
    }

    if (category.value === "ir_provincia") {
      const provSnap = await getDocs(collection(db, "provincias"));
      provSnap.forEach(d => {
        const p = d.data();
        const n = titleCaseWords(p.Nombre || p.nombre);
        if (titleCaseWords(n) !== titleCaseWords(name)) return;
        const ub = p.ubicación || p.ubicacion;
        if (ub?.latitude && ub?.longitude) targetLL = [ub.latitude, ub.longitude];
      });
    } else {
      const cantSnap = await getDocs(collection(db, "cantones"));
      cantSnap.forEach(d => {
        const c = d.data();
        const n = titleCaseWords(c.nombre || c.Nombre);
        if (titleCaseWords(n) !== titleCaseWords(name)) return;
        const ub = c.ubicación || c.ubicacion;
        if (ub?.latitude && ub?.longitude) targetLL = [ub.latitude, ub.longitude];
      });
    }

    if (!targetLL) {
      infoEl.innerHTML = `❌ El destino seleccionado no tiene ubicación registrada.`;
      return;
    }

    await recomputeAdminRoute();
  };

  // ====== al cambiar modo: recalcular ======
  extra.querySelectorAll("[data-admin-mode]").forEach(btn => {
    btn.onclick = async () => {
      adminMode = btn.dataset.adminMode || "driving";
      extra.querySelectorAll("[data-admin-mode]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      await recomputeAdminRoute();
    };
  });

  return;
}



  /* ===== LÍNEAS DE TRANSPORTE (tu bloque ya existente) ===== */
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

      const ctxGeo = { canton: canton.value, parroquia: parroquia.value };
      const allLineas = await getLineasByTipoAll(tipo, ctxGeo);
      const now = new Date();

      const fuera = allLineas
        .filter(l => !isLineOperatingNow(l, now))
        .sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0));

      if (statusEl) {
        if (!allLineas.length) statusEl.innerHTML = `❌ No hay líneas registradas para esta zona.`;
        else if (!fuera.length) statusEl.innerHTML = `✅ Todas las líneas están operativas ahora.`;
        else {
          const hh = String(now.getHours()).padStart(2, "0");
          const mm = String(now.getMinutes()).padStart(2, "0");
          const items = fuera.map(l => `• <b>${l.codigo}</b> ${l.nombre ? `- ${l.nombre}` : ""}`).join("<br>");
          statusEl.innerHTML = `
            <div class="alert alert-warning py-2 mb-2">
              ⛔ <b>Fuera de servicio ahora</b> (hora actual ${hh}:${mm}):
              <div class="mt-1">${items}</div>
              <div class="small mt-2">* Horarios referenciales (aprox.).</div>
            </div>
          `;
        }
      }

      cargarLineasTransporte(tipo, lineasContainer, {
        provincia: provincia.value,
        canton: canton.value,
        parroquia: parroquia.value,
        now
      });
    };

    return;
  }

  /* ===== LUGARES POR CATEGORÍA (todo el cantón, prioridad parroquia) ===== */
  const snap = await getDocs(collection(db, "lugar"));
  const all = [];

  const provSel = provincia.value;
  const cantonSel = canton.value;
  const catSel = String(category.value || "").toLowerCase();
  const parroquiaSel = parroquia.value;

  snap.forEach(d => {
    const l = d.data();
    if (!l?.activo) return;

    if (l.provincia !== provSel) return;
    if (l.ciudad !== cantonSel) return;
    if (String(l.subcategoria || "").toLowerCase() !== catSel) return;

    all.push(l);
  });

  if (!all.length) {
    extra.innerHTML = `
      <div class="alert alert-info py-2 mb-2">
        ❌ No hay lugares en esta categoría.
        <br>Muy pronto estará disponible para tu zona.
      </div>
    `;
    return;
  }

  all.sort((a, b) => {
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
