// js/transport/urbano/urbano_controller.js
import { getUserLocation } from "../../app/state.js";
import { map } from "../../map/map.js";

import { renderLineaExtraControls } from "../core/transport_ui.js";
import {
  getLineasByTipo,
  getParadasByLinea,
  normStr,
  titleCase,
  normCobertura
} from "../core/transport_data.js";

import {
  buildStopPopupHTML,
  startPopupLiveUpdate,
  stopPopupLiveUpdate,
  computeStopOffsets
} from "../core/transport_time.js";

import {
  drawDashedAccessRoute,
  drawLineRouteFollowingStreets
} from "../core/transport_osrm.js";

import {
  clearTransportState,
  setCurrentLinea,
  setCurrentParadas,
  setCurrentStopMarkers,
  setCurrentStopOffsets,
  setStopsLayer,
  setRouteLayer,
  setAccessLayer,
  resetNearestHighlight,
  setNearestHighlight,
  getCurrentStopMarkers
} from "../core/transport_state.js";

import { planLineBoardAlightByOrder } from "../core/transport_bus_planner.js";

/* =====================================================
   LIMPIEZA
===================================================== */
export function clearTransportLayers() {
  stopPopupLiveUpdate();
  clearTransportState();
}

/* =====================================================
   CARGAR LÍNEAS (URBANO)
===================================================== */
export async function cargarLineasTransporte(tipo, container, ctx = {}) {
  container.innerHTML = "";
  clearTransportLayers();

  if (!tipo) return;

  const lineas = await getLineasByTipo(tipo, ctx);

  if (!lineas.length) {
    container.innerHTML = "<p>No hay líneas disponibles</p>";
    return;
  }

  container.innerHTML = `
    <select id="select-linea" class="form-select mb-2">
      <option value="">Seleccione línea</option>
    </select>
    <div id="linea-extra"></div>
  `;

  const selectLinea = container.querySelector("#select-linea");

  lineas
    .sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0))
    .forEach(l => {
      selectLinea.innerHTML += `<option value="${l.codigo}">${l.nombre}</option>`;
    });

  let currentLineaSel = null;
  let sentidosCache = [];
  let currentSentido = "";
  let currentCobertura = "";

  container.onchange = async (ev) => {
    const target = ev.target;
    if (!target || !target.id) return;

    if (target.id === "select-linea") {
      const codigo = target.value;
      const linea = lineas.find(l => l.codigo === codigo);

      clearTransportLayers();
      const extraWrap = container.querySelector("#linea-extra");
      if (extraWrap) extraWrap.innerHTML = "";

      currentLineaSel = linea || null;
      currentSentido = "";
      currentCobertura = "";

      if (!linea) return;

      const needsSentido = ["l3", "l4", "l5"].includes(normStr(linea.codigo));
      if (!needsSentido) {
        await mostrarRutaLinea(linea, {}, ctx);
        return;
      }

      const paradas = await getParadasByLinea(linea.codigo, ctx);

      sentidosCache = [...new Set(
        paradas.map(p => titleCase(normStr(p.sentido))).filter(Boolean)
      )].filter(Boolean).sort();

      if (!sentidosCache.length) {
        await mostrarRutaLinea(linea, {}, ctx);
        return;
      }

      renderLineaExtraControls(container, {
        sentidos: sentidosCache,
        showCobertura: false,
        coberturas: [],
      });
      return;
    }

    if (!currentLineaSel) return;

    const isL5 = normStr(currentLineaSel.codigo) === "l5";

    if (target.id === "select-sentido") {
      const sentidoSel = titleCase(normStr(target.value));

      clearTransportLayers();
      currentSentido = sentidoSel;
      currentCobertura = "";

      if (!sentidoSel) {
        renderLineaExtraControls(container, {
          sentidos: sentidosCache,
          showCobertura: false,
          coberturas: [],
        });
        return;
      }

      if (!isL5) {
        await mostrarRutaLinea(currentLineaSel, { sentido: currentSentido }, ctx);
        return;
      }

      renderLineaExtraControls(container, {
        sentidos: sentidosCache,
        showCobertura: true,
        coberturas: ["Interna", "Externa"],
      });

      const selSentido2 = container.querySelector("#select-sentido");
      if (selSentido2) selSentido2.value = currentSentido;

      const selCob = container.querySelector("#select-cobertura");
      if (selCob) selCob.value = "";

      return;
    }

    if (target.id === "select-cobertura") {
      if (!isL5) return;

      const covSel = normCobertura(target.value);

      clearTransportLayers();
      currentCobertura = covSel;

      if (!currentSentido || !currentCobertura) return;

      await mostrarRutaLinea(currentLineaSel, {
        sentido: currentSentido,
        cobertura: currentCobertura,
      }, ctx);

      return;
    }
  };
}

/* =====================================================
   MOSTRAR RUTA (URBANO)
===================================================== */
export async function mostrarRutaLinea(linea, opts = {}, ctx = {}) {
  clearTransportLayers();
  setCurrentLinea(linea);

  const sentidoSel = titleCase(normStr(opts.sentido));
  const coberturaSel = normCobertura(opts.cobertura);

  const paradasAll = await getParadasByLinea(linea.codigo, ctx);

  let paradas = paradasAll;
  if (sentidoSel) {
    paradas = paradas.filter(p => titleCase(normStr(p.sentido)) === sentidoSel);
  }

  const isL5 = normStr(linea.codigo) === "l5";
  if (isL5 && coberturaSel) {
    const byOrder = new Map();
    paradas.forEach(p => {
      const o = Number(p.orden);
      if (!Number.isFinite(o)) return;
      if (!byOrder.has(o)) byOrder.set(o, []);
      byOrder.get(o).push(p);
    });

    const ordenes = [...byOrder.keys()].sort((a, b) => a - b);
    const finalParadas = [];

    for (const o of ordenes) {
      const group = byOrder.get(o) || [];
      const pickCob = group.find(p => normCobertura(p.cobertura) === coberturaSel);
      const pickNorm = group.find(p => normCobertura(p.cobertura) === "Normal");
      const chosen = pickCob || pickNorm || group[0];
      if (chosen) finalParadas.push(chosen);
    }

    paradas = finalParadas;
  }

  if (!paradas.length) return;

  paradas.sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0));

  setCurrentParadas(paradas);
  setCurrentStopOffsets(computeStopOffsets(paradas, linea));

  const layerParadas = L.layerGroup().addTo(map);
  setStopsLayer(layerParadas);

  const stopMarkers = [];
  const coordsStops = [];

  paradas.forEach(p => {
    const { latitude, longitude } = p.ubicacion || {};
    if (typeof latitude !== "number" || typeof longitude !== "number") return;

    const latlng = [latitude, longitude];
    coordsStops.push(latlng);

    const marker = L.circleMarker(latlng, {
      radius: 6,
      color: linea.color || "#000",
      fillOpacity: 0.9,
    })
      .addTo(layerParadas)
      .bindPopup(buildStopPopupHTML(p, linea), { autoPan: true });

    marker.on("popupopen", () => {
      marker.setPopupContent(buildStopPopupHTML(p, linea));
      startPopupLiveUpdate(marker, p);
    });

    marker.on("popupclose", () => stopPopupLiveUpdate());

    stopMarkers.push({ marker, parada: p });
  });

  setCurrentStopMarkers(stopMarkers);

  if (coordsStops.length < 2) return;

  const codigo = normStr(linea.codigo);
  const esLineaCerrada = (codigo === "l1" || codigo === "l2");
  const debeCerrar = esLineaCerrada && !sentidoSel;

  if (debeCerrar) coordsStops.push(coordsStops[0]);

  const lineLayer = await drawLineRouteFollowingStreets(coordsStops, linea.color || "#000");
  setRouteLayer(lineLayer);

  if (lineLayer) map.fitBounds(lineLayer.getBounds());

  resaltarYConectarParadaMasCercana(paradas, linea);
}

function resaltarYConectarParadaMasCercana(paradas, linea) {
  const user = getUserLocation();
  if (!user) return;

  let nearest = null;
  let minDist = Infinity;

  paradas.forEach(p => {
    const { latitude, longitude } = p.ubicacion || {};
    if (typeof latitude !== "number" || typeof longitude !== "number") return;

    const d = map.distance(user, [latitude, longitude]);
    if (d < minDist) {
      minDist = d;
      nearest = p;
    }
  });

  if (!nearest) return;

  const markers = getCurrentStopMarkers();
  const found = markers.find(x => Number(x.parada.orden) === Number(nearest.orden));
  if (!found) return;

  resetNearestHighlight();
  setNearestHighlight(found.marker);

  found.marker.bindPopup(buildStopPopupHTML(nearest, linea));

  const stopLatLng = [nearest.ubicacion.latitude, nearest.ubicacion.longitude];
  drawDashedAccessRoute(user, stopLatLng, "#666");
}

/* =====================================================
   🚌 MODO BUS: línea idónea + paradas + caminatas
===================================================== */
async function drawWalkOSRM(layerGroup, fromLatLng, toLatLng) {
  const profile = "foot";
  const url =
    `https://router.project-osrm.org/route/v1/${profile}/` +
    `${fromLatLng[1]},${fromLatLng[0]};${toLatLng[1]},${toLatLng[0]}?overview=full&geometries=geojson`;

  const res = await fetch(url);
  const data = await res.json();
  if (!data.routes?.length) return null;

  const route = data.routes[0];
  const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);
  const line = L.polyline(coords, { weight: 4, dashArray: "6 10" }).addTo(layerGroup);

  return { line, route };
}

export async function planAndShowBusStopsForPlace(userLoc, destPlace, ctx = {}, ui = {}) {
  if (!userLoc || !destPlace?.ubicacion) return null;

  clearTransportLayers();

  const destLoc = [destPlace.ubicacion.latitude, destPlace.ubicacion.longitude];

  // ✅ líneas filtradas por cantonpasa / ciudadpasa desde transport_data.js
  const lineas = await getLineasByTipo("urbano", ctx);

  // ✅ umbrales duros (si están demasiado estrictos, te dirá “no hay línea”)
  const MAX_WALK_TO_BOARD = 450;
  const MAX_WALK_TO_DEST  = 350;

  // ✅ pesos balanceados (minimax ya decide bien, pero score ayuda entre líneas)
  // - wWalk2 un poco mayor, pero NO exagerado para no sacrificar walk1
  const wWalk1 = 1.2;
  const wWalk2 = 1.6;
  const wBus   = 1.0;
  const wStops = 25;

  let best = null;
  let bestLinea = null;
  let bestParadas = null;
  let bestScore = Infinity;

  for (const linea of lineas) {
    const paradasAll = await getParadasByLinea(linea.codigo, ctx);
    if (!paradasAll?.length) continue;

    const codigo = normStr(linea.codigo);

    // ✅ L1/L2: circular one-way (wrap forward)
    const isCircularOneWay = (codigo === "l1" || codigo === "l2");

    const plan = planLineBoardAlightByOrder({
      userLoc,
      destLoc,
      stops: paradasAll,
      isCircularOneWay,

      kBoard: 35,
      kDest: 45,

      maxWalkToBoard: MAX_WALK_TO_BOARD,
      maxWalkToDest: MAX_WALK_TO_DEST,

      wWalk1, wWalk2, wBus, wStops
    });

    if (!plan) continue;

    const m = plan.metrics;

    // seguridad extra
    if (m.walk1 > MAX_WALK_TO_BOARD) continue;
    if (m.walk2 > MAX_WALK_TO_DEST) continue;

    const score = plan.score; // ya viene ponderado del planner

    // tie-break: si score parecido, preferir menor maxWalk (más balance real)
    const better =
      score < bestScore ||
      (best && Math.abs(score - bestScore) < 80 && Math.max(m.walk1, m.walk2) < Math.max(best.metrics.walk1, best.metrics.walk2));

    if (better) {
      bestScore = score;
      best = plan;
      bestLinea = linea;
      bestParadas = paradasAll;
    }
  }

  if (!best || !bestLinea || !bestParadas) {
    if (ui?.infoEl) ui.infoEl.innerHTML = "❌ No se encontró una línea adecuada (paradas cercanas).";
    return null;
  }

  // estado popups live
  setCurrentLinea(bestLinea);
  bestParadas.sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0));
  setCurrentParadas(bestParadas);
  setCurrentStopOffsets(computeStopOffsets(bestParadas, bestLinea));

  // capas
  setRouteLayer(null);

  const layerStops = L.layerGroup().addTo(map);
  setStopsLayer(layerStops);

  const walkLayer = L.layerGroup().addTo(map);
  setAccessLayer(walkLayer); // ✅ se limpia con clearTransportLayers()

  const boardLL = [best.boardStop.ubicacion.latitude, best.boardStop.ubicacion.longitude];
  const alightLL = [best.alightStop.ubicacion.latitude, best.alightStop.ubicacion.longitude];

  // puntos del tramo real (opcional)
  if (Array.isArray(best.pathStops) && best.pathStops.length) {
    best.pathStops.forEach(p => {
      const { latitude, longitude } = p.ubicacion || {};
      if (typeof latitude !== "number" || typeof longitude !== "number") return;

      const isBoard = Number(p.orden) === Number(best.boardStop.orden);
      const isAlight = Number(p.orden) === Number(best.alightStop.orden);
      if (isBoard || isAlight) return;

      const mk = L.circleMarker([latitude, longitude], {
        radius: 5,
        color: bestLinea.color || "#000",
        fillOpacity: 0.6,
        weight: 2
      })
        .addTo(layerStops)
        .bindPopup(buildStopPopupHTML(p, bestLinea), { autoPan: true });

      mk.on("popupopen", () => {
        mk.setPopupContent(buildStopPopupHTML(p, bestLinea));
        startPopupLiveUpdate(mk, p);
      });
      mk.on("popupclose", stopPopupLiveUpdate);
    });
  }

  // subir/bajar
  const boardMarker = L.circleMarker(boardLL, {
    radius: 10, color: "#2e7d32", fillColor: "#2e7d32", fillOpacity: 1, weight: 3
  })
    .addTo(layerStops)
    .bindPopup(`<div><b>✅ Subir aquí</b><br>${buildStopPopupHTML(best.boardStop, bestLinea)}</div>`, { autoPan: true });

  const alightMarker = L.circleMarker(alightLL, {
    radius: 10, color: "#c62828", fillColor: "#c62828", fillOpacity: 1, weight: 3
  })
    .addTo(layerStops)
    .bindPopup(`<div><b>⛔ Bajar aquí</b><br>${buildStopPopupHTML(best.alightStop, bestLinea)}</div>`, { autoPan: true });

  boardMarker.on("popupopen", () => {
    boardMarker.setPopupContent(`<div><b>✅ Subir aquí</b><br>${buildStopPopupHTML(best.boardStop, bestLinea)}</div>`);
    startPopupLiveUpdate(boardMarker, best.boardStop);
  });
  alightMarker.on("popupopen", () => {
    alightMarker.setPopupContent(`<div><b>⛔ Bajar aquí</b><br>${buildStopPopupHTML(best.alightStop, bestLinea)}</div>`);
    startPopupLiveUpdate(alightMarker, best.alightStop);
  });
  boardMarker.on("popupclose", stopPopupLiveUpdate);
  alightMarker.on("popupclose", stopPopupLiveUpdate);

  // caminatas OSRM
  const w1 = await drawWalkOSRM(walkLayer, userLoc, boardLL);
  const w2 = await drawWalkOSRM(walkLayer, alightLL, destLoc);

  if (ui?.infoEl) {
    const walk1m = w1?.route?.distance ? Math.round(w1.route.distance) : Math.round(best.metrics.walk1);
    const walk2m = w2?.route?.distance ? Math.round(w2.route.distance) : Math.round(best.metrics.walk2);

    ui.infoEl.innerHTML = `
      <b>Ruta (bus)</b><br>
      🚌 Línea: <b>${bestLinea.codigo}</b> ${bestLinea.nombre ? `- ${bestLinea.nombre}` : ""}<br>
      🧭 Sentido: ${best.direction}<br>
      🚶 Camina a subir: ${walk1m} m<br>
      🚍 Tramo bus (aprox): ${(best.metrics.busDist / 1000).toFixed(2)} km<br>
      🛑 Paradas aprox.: ${best.metrics.stopsCount}<br>
      🚶 Camina al destino: ${walk2m} m
    `;
  }

  map.fitBounds(L.latLngBounds([userLoc, destLoc, boardLL, alightLL]).pad(0.2));
  return { linea: bestLinea, plan: best };
}
