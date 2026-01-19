document.addEventListener('DOMContentLoaded', () => {

  /* MAPA */
  const map = L.map('map').setView([-2.3087, -77.9995], 14);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(map);

  /* UBICACIÓN */
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      L.marker([pos.coords.latitude, pos.coords.longitude])
        .addTo(map)
        .bindPopup('Tu ubicación')
        .openPopup();
    });
  }

  /* MODO OSCURO */
  const btnDark = document.getElementById('btn-dark');
  const iconTheme = document.getElementById('icon-theme');

  btnDark.onclick = () => {
    const html = document.documentElement;
    const dark = html.dataset.theme === 'dark';

    html.dataset.theme = dark ? 'light' : 'dark';
    iconTheme.className = dark ? 'bi bi-moon-fill' : 'bi bi-sun-fill';
  };

  /* TRADUCCIÓN */
  const lang = {
    es: {
      panel: 'Panel de búsqueda',
      select: '🔎 Seleccione categoría'
    },
    en: {
      panel: 'Search panel',
      select: '🔎 Select category'
    }
  };

  let currentLang = 'es';

  document.getElementById('btn-lang').onclick = () => {
    currentLang = currentLang === 'es' ? 'en' : 'es';

    document.getElementById('txt-panel').innerHTML =
      `<i class="bi bi-search me-2"></i>${lang[currentLang].panel}`;

    document.querySelector('#category option[value=""]').innerText =
      lang[currentLang].select;
  };

});
