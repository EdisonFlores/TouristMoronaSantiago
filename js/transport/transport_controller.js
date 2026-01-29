import { getUserLocation } from "../app/state.js";
import { map, clearMarkers } from "../map/map.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "../services/firebase.js";


let layerLineas = null;
let layerParadas = null;

/* =====================================================
   CARGAR LÍNEAS POR TIPO (urbano / rural)
===================================================== */
export async function cargarLineasTransporte(tipo, container) {
  container.innerHTML = "";

  if (!tipo) return;

  const snap = await getDocs(collection(db, "lineas_transporte"));
  const lineas = [];

  snap.forEach(d => {
    const l = d.data();
    if (l.activo && l.tipo === tipo) {
      lineas.push({ id: d.id, ...l });
    }
  });

  if (!lineas.length) {
    container.innerHTML = "<p>No hay líneas disponibles</p>";
    return;
  }

  container.innerHTML = `
    <select id="select-linea" class="form-select mb-2">
      <option value="">Seleccione línea</option>
    </select>
  `;

  const select = document.getElementById("select-linea");
  lineas
    .sort((a, b) => a.orden - b.orden)
    .forEach(l => {
      select.innerHTML += `
        <option value="${l.codigo}">
          ${l.nombre}
        </option>
      `;
    });

  select.onchange = e => {
    const codigo = e.target.value;
    const linea = lineas.find(l => l.codigo === codigo);
    if (linea) mostrarRutaLinea(linea);
  };
}

/* =====================================================
   MOSTRAR RUTA DE UNA LÍNEA
===================================================== */
export async function mostrarRutaLinea(linea) {
  clearLayers();

  const snap = await getDocs(collection(db, "paradas_transporte"));
  const paradas = [];

  snap.forEach(d => {
    const p = d.data();
    if (
      p.activo &&
      p.codigo_linea === linea.codigo
    ) {
      paradas.push(p);
    }
  });

  if (!paradas.length) return;

  // Ordenar paradas
  paradas.sort((a, b) => a.orden - b.orden);

  layerParadas = L.layerGroup().addTo(map);

  const coords = [];
  paradas.forEach(p => {
    const { latitude, longitude } = p.ubicacion;
    const latlng = [latitude, longitude];
    coords.push(latlng);

    L.circleMarker(latlng, {
      radius: 6,
      color: linea.color || "#000",
      fillOpacity: 0.9
    })
      .addTo(layerParadas)
      .bindTooltip(
        `<strong>${p.nombre_linea}</strong><br>
         Parada #${p.orden}`,
        { sticky: true }
      );
  });

  // Cerrar el recorrido
  coords.push(coords[0]);

  layerLineas = L.polyline(coords, {
    color: linea.color || "#000",
    weight: 4
  }).addTo(map);

  map.fitBounds(layerLineas.getBounds());

  // Ruta desde usuario a parada más cercana
  resaltarParadaMasCercana(paradas, linea);
}

/* =====================================================
   PARADA MÁS CERCANA
===================================================== */
function resaltarParadaMasCercana(paradas, linea) {
  const user = getUserLocation();
  if (!user) return;

  let nearest = null;
  let minDist = Infinity;

  paradas.forEach(p => {
    const { latitude, longitude } = p.ubicacion;
    const d = map.distance(user, [latitude, longitude]);
    if (d < minDist) {
      minDist = d;
      nearest = p;
    }
  });

  if (!nearest) return;

  L.circleMarker(
    [nearest.ubicacion.latitude, nearest.ubicacion.longitude],
    {
      radius: 10,
      color: "#FFD700",
      fillColor: "#FFD700",
      fillOpacity: 1
    }
  )
    .addTo(map)
    .bindPopup("🚏 Parada más cercana")
    .openPopup();
}

/* =====================================================
   LIMPIEZA
===================================================== */
function clearLayers() {
  if (layerLineas) {
    map.removeLayer(layerLineas);
    layerLineas = null;
  }
  if (layerParadas) {
    map.removeLayer(layerParadas);
    layerParadas = null;
  }
}
