// ================= PROVINCIAS Y CANTONES ECUADOR =================
const provinciasEC = {
  "Azuay": ["Cuenca","Gualaceo","Paute","Chordeleg","Sígsig","Santa Isabel","Girón","Oña","Pucará","San Fernando","Sevilla de Oro","Guachapala","El Pan"],
  "Bolívar": ["Guaranda","Chillanes","Chimbo","Echeandía","San Miguel","Caluma","Las Naves"],
  "Cañar": ["Azogues","Biblián","Cañar","La Troncal","El Tambo","Suscal"],
  "Carchi": ["Tulcán","Bolívar","Espejo","Mira","Montúfar","San Pedro de Huaca"],
  "Chimborazo": ["Riobamba","Alausí","Colta","Cumandá","Guamote","Guano","Penipe","Pallatanga","Chambo","Chunchi"],
  "Cotopaxi": ["Latacunga","La Maná","Pangua","Pujilí","Salcedo","Saquisilí","Sigchos"],
  "El Oro": ["Machala","Arenillas","Atahualpa","Balsas","Chilla","El Guabo","Huaquillas","Las Lajas","Marcabelí","Pasaje","Piñas","Portovelo","Santa Rosa","Zaruma"],
  "Esmeraldas": ["Esmeraldas","Atacames","Eloy Alfaro","Muisne","Quinindé","Rioverde","San Lorenzo"],
  "Galápagos": ["San Cristóbal","Santa Cruz","Isabela"],
  "Guayas": ["Guayaquil","Daule","Durán","Milagro","Samborondón","Salitre","El Empalme","Naranjal","Naranjito","Balzar","Colimes","Balao","Jujan","Bucay"],
  "Imbabura": ["Ibarra","Otavalo","Cotacachi","Pimampiro","Urcuquí"],
  "Loja": ["Loja","Catamayo","Calvas","Celica","Chaguarpamba","Espíndola","Gonzanamá","Macará","Olmedo","Paltas","Pindal","Puyango","Quilanga","Saraguro","Sozoranga","Zapotillo"],
  "Los Ríos": ["Babahoyo","Baba","Buena Fe","Montalvo","Palenque","Puebloviejo","Quevedo","Quinsaloma","Urdaneta","Valencia","Ventanas","Vinces"],
  "Manabí": ["Portoviejo","Manta","Montecristi","Jipijapa","Chone","El Carmen","Pedernales","Bahía de Caráquez","Rocafuerte","Santa Ana","Paján","Sucre","Tosagua"],
  "Morona Santiago": ["Morona","Gualaquiza","Limón Indanza","Logroño","Palora","Pablo Sexto","San Juan Bosco","Santiago","Sucúa","Taisha","Tiwintza","Huamboya"],
  "Napo": ["Tena","Archidona","El Chaco","Quijos","Carlos Julio Arosemena Tola"],
  "Orellana": ["Francisco de Orellana","Aguarico","La Joya de los Sachas","Loreto"],
  "Pastaza": ["Puyo","Arajuno","Mera","Santa Clara"],
  "Pichincha": ["Quito","Cayambe","Mejía","Pedro Moncayo","Rumiñahui","San Miguel de los Bancos","Pedro Vicente Maldonado","Puerto Quito"],
  "Santa Elena": ["Santa Elena","Salinas","La Libertad"],
  "Santo Domingo de los Tsáchilas": ["Santo Domingo","La Concordia"],
  "Sucumbíos": ["Nueva Loja","Cascales","Cuyabeno","Gonzalo Pizarro","Putumayo","Shushufindi","Sucumbíos"],
  "Tungurahua": ["Ambato","Baños","Cevallos","Mocha","Patate","Pelileo","Píllaro","Quero","Tisaleo"],
  "Zamora Chinchipe": ["Zamora","Centinela del Cóndor","Chinchipe","El Pangui","Nangaritza","Palanda","Paquisha","Yacuambi","Yantzaza"]
};

// ================= FIREBASE =================
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
let routeLine = null;
let userLocation = null;
let dataList = [];
let activePlace = null;
let currentMode = "walking";
let routeRequestId = 0;

// ================= GEO =================
navigator.geolocation.getCurrentPosition(pos => {
  userLocation = [pos.coords.latitude, pos.coords.longitude];
  L.marker(userLocation).addTo(map).bindPopup("📍 Tu ubicación");
});

// ================= UI =================
const provinciaSelect = document.getElementById("provincia");
const cantonSelect = document.getElementById("canton");
const categorySelect = document.getElementById("category");
const extraControls = document.getElementById("extra-controls");
const infoBox = document.getElementById("info-box");

let selectedProvincia = "";
let selectedCanton = "";

// Provincias
Object.keys(provinciasEC).forEach(p => {
  provinciaSelect.innerHTML += `<option value="${p}">${p}</option>`;
});

// Cantones
provinciaSelect.addEventListener("change", () => {
  selectedProvincia = provinciaSelect.value;
  cantonSelect.innerHTML = `<option value="">🏙️ Seleccione cantón</option>`;
  cantonSelect.disabled = true;
  categorySelect.classList.add("d-none");
  resetMap();

  if (!selectedProvincia) return;

  provinciasEC[selectedProvincia].forEach(c => {
    cantonSelect.innerHTML += `<option value="${c}">${c}</option>`;
  });

  cantonSelect.disabled = false;
});

cantonSelect.addEventListener("change", () => {
  selectedCanton = cantonSelect.value;
  categorySelect.classList.toggle("d-none", !selectedCanton);
  resetMap();
});

// ================= CATEGORÍA =================
categorySelect.addEventListener("change", async () => {
  resetMap();
  if (!selectedProvincia || !selectedCanton) return;

  const sub = categorySelect.value;
  if (!sub) return;

  extraControls.innerHTML = "⏳ Cargando lugares...";
  await loadCategory(sub.charAt(0).toUpperCase() + sub.slice(1));
});

// ================= FIRESTORE =================
async function loadCategory(subcategoria) {
  dataList = [];

  const q = query(
    collection(db, "lugar"),
    where("activo", "==", true),
    where("provincia", "==", selectedProvincia),
    where("ciudad", "==", selectedCanton),
    where("subcategoria", "==", subcategoria)
  );

  const snap = await getDocs(q);

  if (snap.empty) {
    extraControls.innerHTML = "⚠️ No hay datos para esta provincia / cantón";
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

    <button id="btn-nearest" class="btn btn-sm btn-primary mb-2">📌 Más cercano</button>

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
      if (activePlace) drawRoute(activePlace);
    };
  });
}

// ================= MAPA =================
function renderMarkers() {
  markersLayer.clearLayers();

  dataList.forEach(place => {
    markersLayer.addLayer(
      L.marker([place.lat, place.lng])
        .bindPopup(`
          <b>${place.nombre}</b><br>
          🕒 ${place.horario}<br>
          📞 ${place.telefono}
        `)
        .on("click", () => selectPlace(place))
    );
  });
}

function selectPlace(place) {
  markersLayer.clearLayers();
  activePlace = place;

  L.marker([place.lat, place.lng])
    .addTo(markersLayer)
    .bindPopup(`
      <b>${place.nombre}</b><br>
      🕒 ${place.horario}<br>
      📞 ${place.telefono}
    `)
    .openPopup();

  map.setView([place.lat, place.lng], 15);
  drawRoute(place);
}

// ================= ROUTING =================
async function drawRoute(place) {
  if (!userLocation || currentMode === "bus") return;

  const id = ++routeRequestId;
  if (routeLine) map.removeLayer(routeLine);

  const res = await fetch(
    `https://router.project-osrm.org/route/v1/driving/${userLocation[1]},${userLocation[0]};${place.lng},${place.lat}?overview=full&geometries=geojson`
  );

  const json = await res.json();
  if (id !== routeRequestId || !json.routes?.length) return;

  const route = json.routes[0];

  routeLine = L.polyline(
    route.geometry.coordinates.map(c => [c[1], c[0]]),
    { weight: 5 }
  ).addTo(map);

  updateInfo(route);
}

// ================= INFO =================
function updateInfo(route) {
  let seconds = route.duration;

  if (currentMode === "walking") seconds *= 6.6;
  if (currentMode === "cycling") seconds *= 3.6;
  if (currentMode === "motorcycle") seconds *= 0.75;
  // driving = base

  seconds = Math.round(seconds);

  const min = Math.floor(seconds / 60);
  const sec = String(seconds % 60).padStart(2, "0");

  infoBox.innerHTML = `
    🚦 ${currentMode}<br>
    ⏱ ${min}:${sec} min<br>
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
  activePlace = null;
  if (routeLine) map.removeLayer(routeLine);
  routeLine = null;
  infoBox.innerHTML = "";
}
