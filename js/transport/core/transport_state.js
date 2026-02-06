// js/transport/core/transport_state.js
import { map } from "../../map/map.js";

let layerLineas = null;
let layerParadas = null;
let layerAcceso = null;

let currentLinea = null;
let currentParadas = [];
let currentStopMarkers = [];
let currentStopOffsets = new Map();

let nearestStopMarker = null;
let nearestStopMarkerOriginalStyle = null;

/* ================= SETTERS / GETTERS ================= */
export function setRouteLayer(layer) {
  if (layerLineas) map.removeLayer(layerLineas);
  layerLineas = layer || null;
}
export function getRouteLayer() {
  return layerLineas;
}

export function setStopsLayer(layerGroup) {
  if (layerParadas) map.removeLayer(layerParadas);
  layerParadas = layerGroup || null;
}
export function getStopsLayer() {
  return layerParadas;
}

export function setAccessLayer(layer) {
  if (layerAcceso) map.removeLayer(layerAcceso);
  layerAcceso = layer || null;
}
export function getAccessLayer() {
  return layerAcceso;
}

export function setCurrentLinea(linea) {
  currentLinea = linea || null;
}
export function getCurrentLinea() {
  return currentLinea;
}

export function setCurrentParadas(paradas) {
  currentParadas = Array.isArray(paradas) ? paradas : [];
}
export function getCurrentParadas() {
  return currentParadas;
}

export function setCurrentStopMarkers(markers) {
  currentStopMarkers = Array.isArray(markers) ? markers : [];
}
export function getCurrentStopMarkers() {
  return currentStopMarkers;
}

export function setCurrentStopOffsets(offsets) {
  currentStopOffsets = offsets instanceof Map ? offsets : new Map();
}
export function getCurrentStopOffsets() {
  return currentStopOffsets;
}

/* ================= RESALTADO ================= */
export function resetNearestHighlight() {
  if (nearestStopMarker && nearestStopMarkerOriginalStyle) {
    nearestStopMarker.setStyle(nearestStopMarkerOriginalStyle);
  }
  nearestStopMarker = null;
  nearestStopMarkerOriginalStyle = null;
}

export function setNearestHighlight(marker) {
  resetNearestHighlight();
  if (!marker) return;

  nearestStopMarker = marker;
  nearestStopMarkerOriginalStyle = {
    radius: marker.options.radius,
    color: marker.options.color,
    fillColor: marker.options.fillColor,
    fillOpacity: marker.options.fillOpacity,
    weight: marker.options.weight,
  };

  marker.setStyle({
    radius: 10,
    color: "#FFD700",
    fillColor: "#FFD700",
    fillOpacity: 1,
    weight: 3,
  });
}

/* ================= LIMPIEZA TOTAL ================= */
export function clearTransportState() {
  if (layerLineas) map.removeLayer(layerLineas);
  if (layerParadas) map.removeLayer(layerParadas);
  if (layerAcceso) map.removeLayer(layerAcceso);

  layerLineas = null;
  layerParadas = null;
  layerAcceso = null;

  resetNearestHighlight();

  currentLinea = null;
  currentParadas = [];
  currentStopMarkers = [];
  currentStopOffsets = new Map();
}
