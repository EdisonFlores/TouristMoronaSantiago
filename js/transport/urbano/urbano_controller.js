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
  resetNearestHighlight,
  setNearestHighlight,
  getCurrentStopMarkers
} from "../core/transport_state.js";

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

  // estado local
  let currentLineaSel = null;
  let sentidosCache = [];
  let currentSentido = "";
  let currentCobertura = "";

  // delegation
  container.onchange = async (ev) => {
    const target = ev.target;
    if (!target || !target.id) return;

    // CAMBIO LÍNEA
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

    // CAMBIO SENTIDO
    if (target.id === "select-sentido") {
      const sentidoSel = titleCase(normStr(target.value));

      // SIEMPRE: al cambiar sentido, limpiar y resetear cobertura
      clearTransportLayers();
      currentSentido = sentidoSel;
      currentCobertura = "";

      // sin sentido => solo sentido sin cobertura
      if (!sentidoSel) {
        renderLineaExtraControls(container, {
          sentidos: sentidosCache,
          showCobertura: false,
          coberturas: [],
        });
        return;
      }

      // L3/L4 dibuja directo
      if (!isL5) {
        await mostrarRutaLinea(currentLineaSel, { sentido: currentSentido }, ctx);
        return;
      }

      // L5: re-render sentido + cobertura, pero cobertura VACÍA y NO dibuja
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

    // CAMBIO COBERTURA (L5)
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

    marker.on("popupclose", () => {
      stopPopupLiveUpdate();
    });

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
