/* ================= IMPORTS ================= */
import { reverseGeocodeNominatim } from "./services/nominatim.js";

import { findNearest } from "./app/actions.js";
import { dataList, setUserLocation, getUserLocation } from "./app/state.js";

import {
  map,
  renderMarkers,
  clearMarkers,
  clearRoute,
  drawRoute
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
 *    + entornoUser (nuevo)
 */
let ctxGeo = {
  provincia: "",
  canton: "",
  parroquia: "",
  specialSevilla: false,
  entornoUser: "" // "urbano" | "rural" | ""
};

/* ================= ELEMENTOS DEL DOM ================= */
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

function normLite(s) {
  return String(s || "").trim().toLowerCase();
}

/* =====================================================
   ✅ FALLBACK BD: detectar provincia/cantón/parroquia
   + (NUEVO) inferir entornoUser por cercanía
===================================================== */
function llFromDoc(doc) {
  const u = doc?.ubicacion;
  const { latitude, longitude } = u || {};
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  return [latitude, longitude];
}

function normalizeAdminFromDoc(source, doc) {
  const s = String(source || "").toLowerCase();

  if (s === "lugar") {
    return {
      provincia: String(doc?.provincia || ""),
      canton: String(doc?.ciudad || ""),   // lugar.ciudad = cantón
      parroquia: String(doc?.parroquia || "")
    };
  }

  if (s === "paradas_rurales") {
    return {
      provincia: String(doc?.provincia || ""),
      canton: String(doc?.cantonorigen || ""),
      parroquia: String(doc?.parroquiaorigen || "")
    };
  }

  if (s === "paradas_transporte") {
    return {
      provincia: String(doc?.provincia || ""),
      canton: String(doc?.canton || ""),
      parroquia: String(doc?.ciudad || "") // paradas_transporte.ciudad = parroquia/sector
    };
  }

  return { provincia: "", canton: "", parroquia: "" };
}

function isAdminUsable(a) {
  const p = String(a?.provincia || "").trim();
  const c = String(a?.canton || "").trim();
  return Boolean(p && c);
}

function passTypeFilter(source, doc) {
  const t = normLite(doc?.tipo);

  // lugar: sin tipo (o indiferente)
  if (source === "lugar") return true;

  // paradas_transporte: solo "urbana"
  if (source === "paradas_transporte") return t === "urbana";

  // paradas_rurales: solo "rural"
  if (source === "paradas_rurales") return t === "rural";

  return true;
}

/**
 * ✅ Inferir ENTORNO por doc más cercano:
 * - Si el doc es paradas_transporte => urbano
 * - Si el doc es paradas_rurales   => rural
 * - Si el doc es lugar y tiene entorno => usa ese
 * - Si no hay nada, retorna ""
 */
async function inferEntornoFromDBByNearest(userLoc, opts = {}) {
  const MAX_RADIUS_M = opts.maxRadiusM ?? 7000;

  const sources = [
    { name: "lugar",              priority: 1 },
    { name: "paradas_transporte", priority: 2 },
    { name: "paradas_rurales",    priority: 3 }
  ];

  let best = null;

  for (const src of sources) {
    const all = await getCollectionCache(src.name);
    const arr = Array.isArray(all) ? all : [];

    for (const doc of arr) {
      if (doc?.activo === false) continue;
      if (!passTypeFilter(src.name, doc)) continue;

      const ll = llFromDoc(doc);
      if (!ll) continue;

      const d = map.distance(userLoc, ll);
      if (d > MAX_RADIUS_M) continue;

      const cand = { source: src.name, distM: d, priority: src.priority, doc };

      if (!best) best = cand;
      else {
        const betterDist = cand.distM < best.distM;
        const tie = Math.abs(cand.distM - best.distM) < 80;
        const betterPriority = tie && cand.priority < best.priority;
        if (betterDist || betterPriority) best = cand;
      }
    }
  }

  if (!best) return "";

  if (best.source === "paradas_transporte") return "urbano";
  if (best.source === "paradas_rurales") return "rural";

  // lugar
  const ent = normLite(best.doc?.entorno);
  if (ent === "urbano" || ent === "rural") return ent;

  return "";
}

async function inferAdminFromDBByNearest(userLoc, opts = {}) {
  const MAX_RADIUS_M = opts.maxRadiusM ?? 7000;  // tolerante (zona rural)
  const HARD_ACCEPT_M = opts.hardAcceptM ?? 1200;

  const sources = [
    { name: "lugar",              priority: 1 },
    { name: "paradas_transporte", priority: 2 },
    { name: "paradas_rurales",    priority: 3 }
  ];

  let best = null;

  for (const src of sources) {
    const all = await getCollectionCache(src.name);
    const arr = Array.isArray(all) ? all : [];

    for (const doc of arr) {
      if (doc?.activo === false) continue;
      if (!passTypeFilter(src.name, doc)) continue;

      const ll = llFromDoc(doc);
      if (!ll) continue;

      const d = map.distance(userLoc, ll);
      if (d > MAX_RADIUS_M) continue;

      const admin = normalizeAdminFromDoc(src.name, doc);
      if (!isAdminUsable(admin)) continue;

      const cand = { admin, distM: d, source: src.name, priority: src.priority };

      // ✅ si está MUY cerca -> aceptar inmediato
      if (d <= HARD_ACCEPT_M) {
        return { ...cand.admin, _source: cand.source, _distM: cand.distM };
      }

      if (!best) {
        best = cand;
      } else {
        const betterDist = cand.distM < best.distM;
        const tie = Math.abs(cand.distM - best.distM) < 80;
        const betterPriority = tie && cand.priority < best.priority;
        if (betterDist || betterPriority) best = cand;
      }
    }
  }

  if (!best) return null;
  return { ...best.admin, _source: best.source, _distM: best.distM };
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

/* ================= MAPA: LUGAR ÚNICO ================= */
function showSinglePlace(place) {
  clearMarkers();
  renderMarkers([place], () => {
    // en bus NO se dibuja ruta normal
    if (activeMode !== "bus") {
      drawRoute(getUserLocation(), place, activeMode, document.getElementById("route-info"));
    }
  });
}

/* ================= RUTA (modo normal vs bus) ================= */
async function buildRoute() {
  if (!activePlace) return;

  // ✅ limpieza fuerte
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
        entornoUser: ctxGeo.entornoUser, // ✅ NUEVO
        now: new Date()
      },
      { infoEl }
    );
    return;
  }

  drawRoute(getUserLocation(), activePlace, activeMode, infoEl);
}

/* ================= GEOLOCALIZACIÓN ================= */
const USE_TEST_LOCATION = false;
const TEST_LOCATION = [-2.384849, -78.116655];

function showLocatingBanner() {
  if (!extra) return;

  extra.innerHTML = `
    <div id="loc-banner" class="alert alert-info py-2 mb-2">
      📡 <b>Estamos ubicándote…</b><br>
      <small>Esto puede tardar unos segundos.</small>
    </div>
  `;
}

function showDetectedFacade() {
  if (!extra) return;

  const banner = document.getElementById("loc-banner");
  if (!banner) return;

  const p = String(detectedAdmin?.provincia || "").trim();
  const c = String(detectedAdmin?.canton || "").trim();
  const pa = String(detectedAdmin?.parroquia || "").trim();
  const ent = String(ctxGeo?.entornoUser || "").trim();

  if (!p || !c) {
    banner.className = "alert alert-danger py-2 mb-2";
    banner.innerHTML = `
      ❌ <b>No se pudo determinar tu ubicación</b><br>
      <div class="mt-1">
        No hay lugares/paradas registrados cerca de la zona en la que te encuentras.
      </div>
      <div class="small mt-1">
        Pronto ampliaremos la cobertura.
      </div>
    `;
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
}

async function detectAdminFromLatLng(loc) {
  let admin = { provincia: "", canton: "", parroquia: "" };

  try {
    const a = await reverseGeocodeNominatim(loc[0], loc[1], {
      retries: 1,
      timeoutMs: 6500,
      initialDelayMs: 900
    });

    admin = {
      provincia: titleCaseWords(a.provincia),
      canton: titleCaseWords(a.canton),
      parroquia: titleCaseWords(a.parroquia)
    };
  } catch (e) {
    console.warn("Nominatim falló. Usando fallback BD por cercanía.", e);

    const fromDB = await inferAdminFromDBByNearest(loc, {
      maxRadiusM: 7000,
      hardAcceptM: 1200
    });

    if (fromDB) {
      admin = {
        provincia: titleCaseWords(fromDB.provincia),
        canton: titleCaseWords(fromDB.canton),
        parroquia: titleCaseWords(fromDB.parroquia)
      };
      console.log(`✅ ctxGeo inferido por ${fromDB._source} a ${Math.round(fromDB._distM)} m`, fromDB);
    } else {
      admin = { provincia: "", canton: "", parroquia: "" };
      console.warn("❌ Fallback BD no encontró nada. Ubicación no determinable.");
    }
  }

  // ✅ ENTORNO USER por cercanía (siempre intentamos, aun si admin sale vacío)
  const entornoUser = await inferEntornoFromDBByNearest(loc, { maxRadiusM: 7000 });

  // ✅ Caso especial Sevilla
  const anySevilla =
    normLite(admin.canton).includes("sevilla") ||
    normLite(admin.parroquia).includes("sevilla");

  if (anySevilla) {
    detectedAdmin = {
      provincia: "Morona Santiago",
      canton: "Sevilla Don Bosco",
      parroquia: "Sevilla Don Bosco"
    };

    ctxGeo = {
      provincia: "Morona Santiago",
      canton: "Sevilla Don Bosco",
      parroquia: "Sevilla Don Bosco",
      specialSevilla: true,
      entornoUser: entornoUser || "" // se intenta igual
    };
    return;
  }

  detectedAdmin = {
    provincia: admin.provincia || "",
    canton: admin.canton || "",
    parroquia: admin.parroquia || ""
  };

  ctxGeo = {
    provincia: detectedAdmin.provincia,
    canton: detectedAdmin.canton,
    parroquia: detectedAdmin.parroquia,
    specialSevilla: false,
    entornoUser: entornoUser || ""
  };
}

function enableCategoryUI() {
  if (!category) return;
  category.disabled = false;
  category.classList.remove("d-none");
  category.value = "";
}

/* ✅ EJECUCIÓN ÚNICA */
showLocatingBanner();

if (USE_TEST_LOCATION) {
  (async () => {
    const loc = TEST_LOCATION;
    setUserLocation(loc);

    map.setView(loc, 13);
    L.marker(loc).addTo(map).bindPopup("🧪 Ubicación de prueba").openPopup();

    await detectAdminFromLatLng(loc);
    showDetectedFacade();
    enableCategoryUI();
  })();
} else {
  navigator.geolocation.getCurrentPosition(async pos => {
    const loc = [pos.coords.latitude, pos.coords.longitude];
    setUserLocation(loc);

    map.setView(loc, 14);
    L.marker(loc).addTo(map).bindPopup("📍 Tu ubicación").openPopup();

    await detectAdminFromLatLng(loc);
    showDetectedFacade();
    enableCategoryUI();
  }, () => {
    const banner = document.getElementById("loc-banner");
    if (banner) {
      banner.className = "alert alert-danger py-2 mb-2";
      banner.innerHTML = `❌ <b>No se pudo obtener tu ubicación.</b>`;
    } else if (extra) {
      extra.innerHTML = `
        <div class="alert alert-danger py-2 mb-2">
          ❌ No se pudo obtener tu ubicación.
        </div>
      `;
    }
  });
}

/* ================= EVENTO CATEGORÍA ================= */
category.onchange = async () => {
  resetMap();
  dataList.length = 0;

  if (!category.value) return;

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

  console.log(`📦 Lugares obtenidos (${catSel}):`, all);

 if (!all.length) {
  showModal(
    "📍 Sin cobertura por ahora",
    `
      <div class="alert alert-info py-2 mb-2">
        <b>De momento no hay datos registrados en tu zona</b> para esta categoría.
      </div>

      <div class="small">
        Estamos trabajando para ampliar la cobertura y añadir más lugares y rutas.
        <br><br>
        ✅ Puedes probar otra categoría o volver a intentarlo más tarde.
      </div>
    `
  );
  extra.innerHTML = "";
  return;
}

  // orden
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
    // ✅ si estás en bus, limpia antes (evita restos si clickeas rápido)
    if (activeMode === "bus") {
      clearRoute();
      clearTransportLayers();
      clearRouteInfo();
    }

    activePlace = place;
    showSinglePlace(place);
    buildRoute();
  });

  sel.onchange = () => {
    // ✅ limpieza previa si bus
    if (activeMode === "bus") {
      clearRoute();
      clearTransportLayers();
      clearRouteInfo();
    }

    activePlace = dataList[sel.value];
    if (!activePlace) return;
    showSinglePlace(activePlace);
    buildRoute();
  };

  document.getElementById("near").onclick = () => {
    if (activeMode === "bus") {
      clearRoute();
      clearTransportLayers();
      clearRouteInfo();
    }

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