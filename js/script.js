document.addEventListener('DOMContentLoaded', () => {

  /* ======================
     MODO OSCURO
  ====================== */
  const btnDark = document.getElementById('btn-dark');
  const iconTheme = document.getElementById('icon-theme');

  if (btnDark) {
    btnDark.addEventListener('click', () => {
      const html = document.documentElement;
      const isDark = html.dataset.theme === 'dark';

      html.dataset.theme = isDark ? 'light' : 'dark';
      iconTheme.className = isDark
        ? 'bi bi-moon-fill'
        : 'bi bi-sun-fill';
    });
  }

  /* ======================
     IDIOMA
  ====================== */
  const lang = {
    es: {
      panel: 'Panel de búsqueda'
    },
    en: {
      panel: 'Search panel'
    }
  };

  let currentLang = 'es';

  const btnLang = document.getElementById('btn-lang');
  const txtPanel = document.getElementById('txt-panel');

  if (btnLang) {
    btnLang.addEventListener('click', () => {
      currentLang = currentLang === 'es' ? 'en' : 'es';

      if (txtPanel) {
        txtPanel.innerHTML =
          `<i class="bi bi-search me-2"></i>${lang[currentLang].panel}`;
      }
    });
  }

});
