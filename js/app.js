// ================= CONFIG FIREBASE ================= 
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD0ZL-HLNOYYg34Z-tC3YZYwKN8l1aoadI",
  authDomain: "touristmoronasantiago.firebaseapp.com",
  projectId: "touristmoronasantiago",
  storageBucket: "touristmoronasantiago.appspot.com",
  messagingSenderId: "271709188866",
  appId: "1:271709188866:web:7cbed805f1d8803722081b"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ================= MAPA =================
const map = L.map("map").setView([-2.309948, -78.124482], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);

const markersLayer = L.layerGroup().addTo(map);

let userLocation = null;
let dataList = [];
let activeMarker = null;
let routeLine = null;
let currentMode = "walking";
let routeRequestId = 0;

// 📍 UBICACIÓN USUARIO
navigator.geolocation.getCurrentPosition(pos => {
  userLocation = [pos.coords.latitude, pos.coords.longitude];
  L.marker(userLocation).addTo(map).bindPopup("📍 Tu ubicación");
});

// ================= UI =================
const categorySelect = document.getElementById("category");
const extraControls = document.getElementById("extra-controls");
const infoBox = document.getElementById("info-box");

categorySelect.addEventListener("change", async () => {
  resetMap();

  let sub = categorySelect.value;
  if (!sub) return;

  sub = sub.charAt(0).toUpperCase() + sub.slice(1);
  extraControls.innerHTML = "<p>⏳ Cargando lugares...</p>";
  await loadCategory(sub);
});

// ================= LOAD CATEGORY =================
async function loadCategory(subcategoria) {
  dataList = [];

  const q = query(
    collection(db, "lugar"),
    where("activo", "==", true),
    where("ciudad", "==", "Macas"),
    where("subcategoria", "==", subcategoria)
  );

  const snap = await getDocs(q);

  snap.forEach(doc => {
    const d = doc.data();
    if (!d.ubicacion) return;

    dataList.push({
      nombre: d.nombre,
      lat: d.ubicacion.latitude,
      lng: d.ubicacion.longitude,
      horario: d.horario || "",
      telefono: d.telefono || ""
    });
  });

  if (!dataList.length) {
    extraControls.innerHTML = "<p>⚠️ No hay lugares registrados</p>";
    return;
  }

  renderUI();
  renderMarkers();
}

// ================= UI =================
function renderUI() {
  extraControls.innerHTML = `
    <select id="place-select" class="form-select mb-2">
      <option value="">📍 Seleccione un lugar</option>
      ${dataList.map((p,i)=>`<option value="${i}">${p.nombre}</option>`).join("")}
    </select>

    <button id="btn-nearest" class="btn btn-sm btn-primary mb-2">
      📌 Ver más cercano
    </button>

    <div class="d-flex gap-2">
      <button data-mode="walking">🚶</button>
      <button data-mode="cycling">🚲</button>
      <button data-mode="motorcycle">🏍️</button>
      <button data-mode="driving">🚗</button>
      <button data-mode="bus">🚌</button>
    </div>
  `;

  document.getElementById("place-select").onchange = e => {
    if (e.target.value !== "") selectPlace(dataList[e.target.value]);
  };

  document.getElementById("btn-nearest").onclick = findNearest;

  document.querySelectorAll("[data-mode]").forEach(btn => {
    btn.onclick = () => {
      currentMode = btn.dataset.mode;
      if (activeMarker) drawRoute(activeMarker);
    };
  });
}

// ================= MARKERS =================
function renderMarkers() {
  dataList.forEach(place => {
    const marker = L.marker([place.lat, place.lng])
      .bindPopup(`
        <b>${place.nombre}</b><br>
        🕒 ${place.horario}<br>
        📞 ${place.telefono}
      `)
      .on("click", () => selectPlace(place));

    markersLayer.addLayer(marker);
  });
}

function selectPlace(place) {
  markersLayer.clearLayers();

  const marker = L.marker([place.lat, place.lng])
    .bindPopup(`
      <b>${place.nombre}</b><br>
      🕒 ${place.horario}<br>
      📞 ${place.telefono}
    `)
    .addTo(markersLayer)
    .openPopup();

  activeMarker = place;
  map.setView([place.lat, place.lng], 15);
  drawRoute(place);
}

// ================= ROUTING =================
async function drawRoute(place) {
  if (!userLocation || currentMode === "bus") return;

  const id = ++routeRequestId;

  if (routeLine) map.removeLayer(routeLine);

  const url = `https://router.project-osrm.org/route/v1/driving/${userLocation[1]},${userLocation[0]};${place.lng},${place.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  const json = await res.json();

  if (id !== routeRequestId || !json.routes?.length) return;

  const route = json.routes[0];

  routeLine = L.polyline(
    route.geometry.coordinates.map(c => [c[1], c[0]]),
    { weight: 5 }
  ).addTo(map);

  updateInfo(route);
}

// ================= INFO (TIEMPOS REALES) =================
function updateInfo(route) {
  let seconds = route.duration;

  if (currentMode === "walking") seconds *= 3.6;
  if (currentMode === "cycling") seconds *= 1.6;
  if (currentMode === "motorcycle") seconds *= 0.75;

  seconds = Math.round(seconds);

  infoBox.innerHTML = `
    🚦 ${currentMode}<br>
    ⏱ ${Math.floor(seconds / 60)} min ${seconds % 60} s<br>
    📏 ${(route.distance / 1000).toFixed(2)} km
  `;
}

// ================= NEAREST =================
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

// ================= RESET =================
function resetMap() {
  markersLayer.clearLayers();
  dataList = [];
  activeMarker = null;

  if (routeLine) {
    map.removeLayer(routeLine);
    routeLine = null;
  }

  infoBox.innerHTML = "";
  extraControls.innerHTML = "";
}
