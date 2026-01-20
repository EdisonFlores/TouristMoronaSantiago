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
  let bellezaData = [];

  let markers = [];
  let activeMarker = null;

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
        .bindPopup('📍 Tu ubicación')
        .openPopup();
    });
  }

  /* ======================
     CSV BELLEZA
  ====================== */
  const BELLEZA_URL =
    'https://raw.githubusercontent.com/EdisonFlores/TouristMoronaSantiago/main/csv/belleza.csv';

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
  extraControls.id = 'extra-controls';
  panel.appendChild(extraControls);

  const infoBox = document.createElement('div');
  infoBox.id = 'route-info';
  infoBox.className = 'mt-3 p-2 border rounded d-none';
  panel.appendChild(infoBox);

  /* ======================
     CARGAR BELLEZA
  ====================== */
  async function loadBelleza() {

    markersLayer.clearLayers();
    markers = [];
    if (routeLine) map.removeLayer(routeLine);
    infoBox.classList.add('d-none');

    extraControls.innerHTML = `
      <select id="place-select" class="form-select mt-2 mb-2">
        <option value="">Seleccione establecimiento</option>
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

    const csvText = await fetch(BELLEZA_URL).then(r => r.text());
    bellezaData = parseCSV(csvText);

    const select = document.getElementById('place-select');

    bellezaData.forEach((item, index) => {

      const option = document.createElement('option');
      option.value = index;
      option.textContent = item.nombre;
      select.appendChild(option);

      const basePopup = `
        <b>${item.nombre}</b><br>
        🕒 ${item.horario}<br>
        📞 ${item.telefono}
      `;

      const marker = L.marker([item.lat, item.lng])
        .addTo(markersLayer)
        .bindPopup(basePopup);

      marker.basePopupContent = basePopup;
      markers.push(marker);
    });

    /* ======================
       BOTONES DE MODO
    ====================== */
    extraControls.querySelectorAll('[data-mode]').forEach(btn => {
      btn.onclick = () => {
        extraControls.querySelectorAll('[data-mode]')
          .forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentMode = btn.dataset.mode;

        if (select.value !== '') {
          select.dispatchEvent(new Event('change'));
        }
      };
    });

    /* ======================
       MÁS CERCANO
    ====================== */
    document.getElementById('btn-nearest').onclick = () => {
      if (!userLocation) return;

      let nearestIndex = 0;
      let min = Infinity;

      bellezaData.forEach((item, i) => {
        const d = Math.hypot(
          userLocation[0] - item.lat,
          userLocation[1] - item.lng
        );
        if (d < min) {
          min = d;
          nearestIndex = i;
        }
      });

      select.value = nearestIndex;
      select.dispatchEvent(new Event('change'));
    };

    /* ======================
       SELECCIÓN MANUAL
    ====================== */
    select.onchange = e => {
      if (!e.target.value) return;

      if (activeMarker) {
        activeMarker.setIcon(new L.Icon.Default());
        activeMarker.getElement()?.classList.remove('marker-bounce');
      }

      const index = e.target.value;
      const item = bellezaData[index];
      const marker = markers[index];

      marker.setIcon(highlightIcon);
      marker.getElement()?.classList.add('marker-bounce');
      activeMarker = marker;

      drawRouteOSRM(item.lat, item.lng, marker, currentMode);
      map.setView([item.lat, item.lng], 16);
    };
  }

  /* ======================
     RUTA REAL (OSRM)
  ====================== */
  async function drawRouteOSRM(lat, lng, marker, mode) {
    if (!userLocation) return;
    if (routeLine) map.removeLayer(routeLine);

    const url =
      `https://router.project-osrm.org/route/v1/${mode}/` +
      `${userLocation[1]},${userLocation[0]};${lng},${lat}` +
      `?overview=full&geometries=geojson`;

    const res = await fetch(url);
    const data = await res.json();
    if (!data.routes || !data.routes.length) return;

    const route = data.routes[0];

    routeLine = L.geoJSON(route.geometry, {
      style: {
        color: mode === 'foot' ? '#28a745' :
               mode === 'bike' ? '#ffc107' :
               '#0d6efd',
        weight: 5
      }
    }).addTo(map);

    const km = (route.distance / 1000).toFixed(2);
    const min = Math.round(route.duration / 60);

    marker.setPopupContent(marker.basePopupContent).openPopup();

    infoBox.innerHTML = `
      <strong>${marker.basePopupContent.match(/<b>(.*?)<\/b>/)[1]}</strong><br>
      📏 Distancia: ${km} km<br>
      ⏱️ Tiempo estimado: ${min} min
    `;
    infoBox.classList.remove('d-none');

    if (window.innerWidth < 768) {
      document.getElementById('map')
        .scrollIntoView({ behavior: 'smooth' });
    }
  }

  /* ======================
     CATEGORÍAS
  ====================== */
  document.getElementById('category').addEventListener('change', e => {
    markersLayer.clearLayers();
    extraControls.innerHTML = '';
    infoBox.classList.add('d-none');
    if (routeLine) map.removeLayer(routeLine);
    activeMarker = null;

    if (e.target.value === 'belleza') {
      loadBelleza();
    }
  });

});
