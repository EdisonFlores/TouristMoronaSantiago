import { provinciasEC } from "./dataGeo.js";
import { db } from "./firebase.js";
import {
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
const parroquiaSelect = document.getElementById("parroquia");
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

function resetParroquia() {
  parroquiaSelect.value = "";
  parroquiaSelect.innerHTML =
    `<option value="">🏘️ Seleccione parroquia</option>`;
  parroquiaSelect.classList.add("d-none");
  parroquiaSelect.disabled = true;
}

function clearRouteInfo() {
  infoBox.innerHTML = "";
  activePlace = null;
}

function resetMap() {
  clearMarkers();
  clearRouteInfo();
}

function resetAllUI() {
  resetCanton();
  resetParroquia();
  resetCategory();
  hidePlacesUI();
  resetMap();
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

  const provinciaData = provinciasEC[provinciaSelect.value];

  if (Array.isArray(provinciaData)) {
    provinciaData.forEach(c =>
      cantonSelect.innerHTML += `<option value="${c}">${c}</option>`
    );
  } else {
    Object.keys(provinciaData).forEach(c =>
      cantonSelect.innerHTML += `<option value="${c}">${c}</option>`
    );
  }

  cantonSelect.disabled = false;
};

// ================= CANTÓN CHANGE =================
cantonSelect.onchange = async () => {
  resetCategory();
  resetParroquia();
  hidePlacesUI();
  resetMap();
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

  const provinciaData = provinciasEC[provinciaSelect.value];

  // 🌿 SOLO PROVINCIAS AMAZÓNICAS (objeto con parroquias)
  if (!Array.isArray(provinciaData)) {
    const parroquias = provinciaData[cantonSelect.value];

    if (parroquias && parroquias.length) {
      parroquias.forEach(p =>
        parroquiaSelect.innerHTML +=
          `<option value="${p}">${p}</option>`
      );

      parroquiaSelect.classList.remove("d-none");
      parroquiaSelect.disabled = false;
      return;
    }
  }

  categorySelect.classList.remove("d-none");
};

// ================= PARROQUIA CHANGE =================
parroquiaSelect.onchange = async () => {
  resetCategory();
  hidePlacesUI();
  resetMap();
  infoBox.innerHTML = "";

  if (!parroquiaSelect.value) return;

  const q = query(
    collection(db, "lugar"),
    where("activo", "==", true),
    where("provincia", "==", provinciaSelect.value),
    where("ciudad", "==", cantonSelect.value),
    where("parroquia", "==", parroquiaSelect.value)
  );

  const snap = await getDocs(q);

  if (snap.empty) {
    infoBox.innerHTML =
      "⚠️ No hay datos disponibles de momento para esta parroquia.";
    return;
  }

  categorySelect.classList.remove("d-none");
};

// ================= CATEGORÍA CHANGE =================
categorySelect.onchange = async () => {
  dataList = [];
  resetMap();
  hidePlacesUI();
  infoBox.innerHTML = "";

  if (!categorySelect.value) return;

  const subcategoria =
    categorySelect.value.charAt(0).toUpperCase() +
    categorySelect.value.slice(1);

  let q = query(
    collection(db, "lugar"),
    where("activo", "==", true),
    where("provincia", "==", provinciaSelect.value),
    where("ciudad", "==", cantonSelect.value),
    where("subcategoria", "==", subcategoria)
  );

  if (!parroquiaSelect.classList.contains("d-none") && parroquiaSelect.value) {
    q = query(
      collection(db, "lugar"),
      where("activo", "==", true),
      where("provincia", "==", provinciaSelect.value),
      where("ciudad", "==", cantonSelect.value),
      where("parroquia", "==", parroquiaSelect.value),
      where("subcategoria", "==", subcategoria)
    );
  }

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
