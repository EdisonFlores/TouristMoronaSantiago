document.addEventListener('DOMContentLoaded', async () => {

  /* ======================
     MAPA - MACAS
  ====================== */
  const map = L.map('map').setView([-2.3087, -77.9995], 14);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(map);

  const markersLayer = L.layerGroup().addTo(map);

  let routeLine = null;
  let userLocation = null;
  let dataList = [];
  let markers = [];
  let activeMarker = null;
  let routeRequestId = 0;

  /* ======================
     ICONO ACTIVO
  ====================== */
  const highlightIcon = L.icon({
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconSize: [35, 55],
    iconAnchor: [17, 55],
    popupAnchor: [1, -40],
    className: 'marker-active'
  });

  /* ======================
     UBICACIÓN USUARIO
  ====================== */
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      userLocation = [pos.coords.latitude, pos.coords.longitude];

      L.marker(userLocation)
        .addTo(map)
        .bindPopup('📍 Tu ubicación');
    });
  }

  /* ======================
     CSVs POR CATEGORÍA
  ====================== */
  const CSV_URLS = {
    belleza: 'https://raw.githubusercontent.com/EdisonFlores/TouristMoronaSantiago/main/csv/belleza.csv',
    alimentacion: 'https://github.com/EdisonFlores/TouristMoronaSantiago/raw/main/csv/alimentacion.csv',
    educacion: 'https://raw.githubusercontent.com/EdisonFlores/TouristMoronaSantiago/main/csv/educacion.csv',
    iglesias: 'https://raw.githubusercontent.com/EdisonFlores/TouristMoronaSantiago/main/csv/iglesias.csv',
    parques: 'https://raw.githubusercontent.com/EdisonFlores/TouristMoronaSantiago/main/csv/parques.csv',
    salud: 'https://raw.githubusercontent.com/EdisonFlores/TouristMoronaSantiago/main/csv/salud.csv',
    supermercados: 'https://raw.githubusercontent.com/EdisonFlores/TouristMoronaSantiago/main/csv/supermercados.csv',
    taxis: 'https://raw.githubusercontent.com/EdisonFlores/TouristMoronaSantiago/main/csv/taxis.csv',
    tiendas: 'https://raw.githubusercontent.com/EdisonFlores/TouristMoronaSantiago/main/csv/tiendas.csv',
    vestimenta: 'https://raw.githubusercontent.com/EdisonFlores/TouristMoronaSantiago/main/csv/vestimenta.csv',
    instituciones: 'https://raw.githubusercontent.com/EdisonFlores/TouristMoronaSantiago/main/csv/%E2%80%8Cinstituciones.csv',
    transporte_lineas: 'https://raw.githubusercontent.com/EdisonFlores/TouristMoronaSantiago/main/csv/Transporte_lineas.csv',
    transporte_paradas: 'https://raw.githubusercontent.com/EdisonFlores/TouristMoronaSantiago/main/csv/Transporte_paradas.csv'
  };

  /* ======================
     PARSER CSV
  ====================== */
  function parseCSV(text) {
    const lines = text.trim().split('\n');
    const headers = lines[0].split(';');

    return lines.slice(1).map(line => {
      const values = line.split(';');
      const obj = {};

      headers.forEach((h, i) => {
        let value = values[i]?.trim();
        if ((h === 'lat' || h === 'lng') && value?.split('.').length === 3) {
          const p = value.split('.');
          value = `${p[0]}.${p[1]}${p[2]}`;
        }
        obj[h] = value;
      });

      obj.lat = Number(obj.lat);
      obj.lng = Number(obj.lng);
      return obj;
    });
  }

  /* ======================
     PANEL
  ====================== */
  const panel = document.querySelector('.search-panel');

  const extraControls = document.createElement('div');
  panel.appendChild(extraControls);

  const infoBox = document.createElement('div');
  infoBox.className = 'mt-3 p-2 border rounded d-none';
  panel.appendChild(infoBox);

  /* ======================
     CARGAR CATEGORÍA (GENÉRICO)
  ====================== */
  async function loadCategory(category) {

    markersLayer.clearLayers();
    markers = [];
    activeMarker = null;
    dataList = [];

    if (routeLine) {
      map.removeLayer(routeLine);
      routeLine = null;
    }

    infoBox.classList.add('d-none');

    extraControls.innerHTML = `
      <select id="place-select" class="form-select mb-2">
        <option value="">Seleccione lugar</option>
      </select>

      <button id="btn-nearest" class="btn btn-primary w-100 mb-2">
        Ver lugar más cercano
      </button>

      <div class="btn-group w-100 mb-2">
        <button class="btn btn-outline-secondary" data-mode="foot">🚶‍♂️</button>
        <button class="btn btn-outline-secondary" data-mode="bike">🚲</button>
        <button class="btn btn-outline-secondary active" data-mode="driving">🚗</button>
      </div>
    `;

    let currentMode = 'driving';
    const select = document.getElementById('place-select');

    // Transporte: mostrar líneas
    if(category === 'transporte') {
      const csvText = await fetch(CSV_URLS.transporte_lineas).then(r=>r.text());
      dataList = parseCSV(csvText);

      dataList.forEach((linea, i)=>{
        const option = document.createElement('option');
        option.value = i;
        option.textContent = linea.nombre; // mostrar nombre de la línea
        select.appendChild(option);
      });

      document.getElementById('btn-nearest').onclick = async () => {
        if (!userLocation) return;

        // ⚠️ Aquí se buscaría la parada más cercana cuando se disponga del CSV transporte_paradas
        alert("Se detectará la parada más cercana cuando estén los puntos disponibles.");
      };

      select.onchange = e=>{
        if(!e.target.value) return;
        // Al seleccionar línea, se preparará la ruta con sus paradas (cuando estén disponibles)
        const i = Number(e.target.value);
        const linea = dataList[i];
        markersLayer.clearLayers();
        activeMarker = null;
        infoBox.classList.add('d-none');
        if(routeLine) map.removeLayer(routeLine);

        // Por ahora solo se marca la línea seleccionada
        alert(`Línea seleccionada: ${linea.nombre}\nPróximamente se mostrarán las paradas y la ruta.`);
      };

      return;
    }

    // CATEGORÍAS GENERALES (Belleza, Alimentación, etc.)
    const csvText = await fetch(CSV_URLS[category]).then(r => r.text());
    dataList = parseCSV(csvText);

    dataList.forEach((item, i) => {
      const option = document.createElement('option');
      option.value = i;
      option.textContent = item.nombre;
      select.appendChild(option);

      const popup = `<b>${item.nombre}</b>`;
      const marker = L.marker([item.lat, item.lng]).bindPopup(popup);
      marker.basePopupContent = popup;
      markers.push(marker);
    });

    extraControls.querySelectorAll('[data-mode]').forEach(btn => {
      btn.onclick = () => {
        extraControls.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentMode = btn.dataset.mode;
        if (select.value) select.dispatchEvent(new Event('change'));
      };
    });

    document.getElementById('btn-nearest').onclick = () => {
      if (!userLocation) return;

      let min = Infinity, index = 0;
      dataList.forEach((p, i) => {
        const d = Math.hypot(userLocation[0] - p.lat, userLocation[1] - p.lng);
        if (d < min) { min = d; index = i; }
      });

      select.value = index;
      select.dispatchEvent(new Event('change'));
    };

    select.onchange = e => {
      if (!e.target.value) return;

      markersLayer.clearLayers();
      if (routeLine) map.removeLayer(routeLine);

      const i = Number(e.target.value);
      const marker = markers[i];

      marker.setIcon(highlightIcon).addTo(markersLayer);
      activeMarker = marker;

      drawRouteOSRM(dataList[i].lat, dataList[i].lng, marker, currentMode);
      map.setView([dataList[i].lat, dataList[i].lng], 16);
    };
  }

  /* ======================
     RUTA OSRM
  ====================== */
  async function drawRouteOSRM(lat, lng, marker, mode) {
    if (!userLocation) return;

    const id = ++routeRequestId;
    infoBox.classList.add('d-none');

    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${userLocation[1]},${userLocation[0]};${lng},${lat}?overview=full&geometries=geojson`
    );
    const data = await res.json();
    if (id !== routeRequestId || !data.routes?.length) return;

    const route = data.routes[0];

    routeLine = L.geoJSON(route.geometry, { weight: 5 }).addTo(map);

    const km = (route.distance / 1000).toFixed(2);
    let sec = route.duration;
    if (mode === 'bike') sec *= 1.6;
    if (mode === 'foot') sec *= 3.6;

    sec = Math.round(sec);
    infoBox.innerHTML = `
      <strong>${marker.basePopupContent.replace(/<[^>]+>/g, '')}</strong><br>
      📏 ${km} km<br>
      ⏱️ ${Math.floor(sec / 60)} min ${sec % 60}s
    `;
    infoBox.classList.remove('d-none');
  }

  /* ======================
     CATEGORÍAS
  ====================== */
  document.getElementById('category').addEventListener('change', e => {
    if (e.target.value === 'transporte') {
      loadCategory('transporte');
    } else if (CSV_URLS[e.target.value]) {
      loadCategory(e.target.value);
    }
  });

});
