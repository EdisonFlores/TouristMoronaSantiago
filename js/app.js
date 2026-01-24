import { provinciasEC } from "./dataGeo.js";
import { db } from "./firebase.js";
import { collection, getDocs, query, where } from
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import {
  map,
  renderMarkers,
  drawRoute,
  showSingleMarker,
  clearMarkers
} from "./map.js";

import { renderUI } from "./ui.js";

// ================= GEO =================
let userLocation = null;
navigator.geolocation.getCurrentPosition(pos => {
  userLocation = [pos.coords.latitude, pos.coords.longitude];
  L.marker(userLocation).addTo(map).bindPopup("📍 Tu ubicación");
});

// ================= STATE =================
let dataList = [];
let activePlace = null;
let currentMode = "walking";

// ================= SELECTS =================
const provinciaSelect = document.getElementById("provincia");
const cantonSelect = document.getElementById("canton");
const categorySelect = document.getElementById("category");
const infoBox = document.getElementById("info-box");
const extraControls = document.getElementById("extra-controls");

// ================= HELPERS =================
function hidePlacesUI() {
  extraControls.innerHTML = "";
  extraControls.classList.add("d-none");
}

function resetCategory() {
  categorySelect.value = "";
  categorySelect.classList.add("d-none");
}

function resetCanton() {
  cantonSelect.value = "";
  cantonSelect.innerHTML = `<option value="">🏙️ Seleccione cantón</option>`;
  cantonSelect.disabled = true;
}

function resetAllUI() {
  resetCanton();
  resetCategory();
  hidePlacesUI();
  clearRouteInfo();
  clearMarkers();
}

// ================= PROVINCIAS =================
Object.keys(provinciasEC).forEach(p => {
  provinciaSelect.innerHTML += `<option value="${p}">${p}</option>`;
});

// ================= PROVINCIA CHANGE =================
provinciaSelect.onchange = async () => {
  resetAllUI();
  infoBox.innerHTML = "";

  if (!provinciaSelect.value) return;

  const q = query(
    collection(db, "lugar"),
    where("activo", "==", true),
    where("provincia", "==", provinciaSelect.value)
  );

  const snap = await getDocs(q);

  if (snap.empty) {
    infoBox.innerHTML =
      "⚠️ No existen datos registrados para esta provincia.";
    return;
  }

  provinciasEC[provinciaSelect.value].forEach(c => {
    cantonSelect.innerHTML += `<option value="${c}">${c}</option>`;
  });

  cantonSelect.disabled = false;
};

// ================= CANTÓN CHANGE =================
cantonSelect.onchange = async () => {
  resetCategory();
  hidePlacesUI();
  clearMarkers();
  clearRouteInfo();
  infoBox.innerHTML = "";

  if (!cantonSelect.value) return;

  const q = query(
    collection(db, "lugar"),
    where("activo", "==", true),
    where("provincia", "==", provinciaSelect.value),
    where("ciudad", "==", cantonSelect.value)
  );

  const snap = await getDocs(q);

  if (snap.empty) {
    infoBox.innerHTML =
      "⚠️ No hay datos registrados para este cantón.";
    return;
  }

  categorySelect.classList.remove("d-none");
};

// ================= CATEGORÍA CHANGE =================
categorySelect.onchange = async () => {
  dataList = [];
  clearMarkers();
  hidePlacesUI();
  clearRouteInfo();
  infoBox.innerHTML = "";

  if (!categorySelect.value) return;

  const subcategoria =
    categorySelect.value.charAt(0).toUpperCase() +
    categorySelect.value.slice(1);

  const q = query(
    collection(db, "lugar"),
    where("activo", "==", true),
    where("provincia", "==", provinciaSelect.value),
    where("ciudad", "==", cantonSelect.value),
    where("subcategoria", "==", subcategoria)
  );

  const snap = await getDocs(q);

  if (snap.empty) {
    infoBox.innerHTML =
      "⚠️ No hay datos disponibles para esta categoría.";
    return;
  }

  snap.forEach(doc => {
    const d = doc.data();
    if (!d.ubicacion) return;

    dataList.push({
      nombre: d.nombre,
      lat: d.ubicacion.latitude,
      lng: d.ubicacion.longitude,
      horario: d.horario || "No especificado",
      telefono: d.telefono || "No disponible"
    });
  });

  renderMarkers(dataList, selectPlace);
  renderUI(dataList, selectPlace, findNearest, setMode);
  extraControls.classList.remove("d-none");
};

// ================= ACTIONS =================
function selectPlace(place) {
  activePlace = place;
  showSingleMarker(place);
  map.setView([place.lat, place.lng], 15);
  drawRoute(userLocation, place, currentMode, infoBox);
}

function setMode(mode) {
  currentMode = mode;
  if (activePlace) {
    drawRoute(userLocation, activePlace, currentMode, infoBox);
  }
}

function findNearest() {
  if (!userLocation) return;

  let nearest = null;
  let min = Infinity;

  dataList.forEach(p => {
    const d = map.distance(userLocation, [p.lat, p.lng]);
    if (d < min) {
      min = d;
      nearest = p;
    }
  });

  if (nearest) selectPlace(nearest);
}

function clearRouteInfo() {
  infoBox.innerHTML = "";
  activePlace = null;
}
