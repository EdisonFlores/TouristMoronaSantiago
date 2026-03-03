const LS_LANG = "tm_lang";

const I18N = {
  es: {
    "app.name": "TouristMacas",
    "weather.title": "Pronóstico del tiempo",
    "btn.close": "Cerrar"
  },
  en: {
    "app.name": "TouristMacas",
    "weather.title": "Weather forecast",
    "btn.close": "Close"
  }
};

export function getLang() {
  return (localStorage.getItem(LS_LANG) || "es").toLowerCase();
}
export function setLang(lang) {
  localStorage.setItem(LS_LANG, lang);
}
export function t(key) {
  const lang = getLang();
  return (I18N[lang] && I18N[lang][key]) || I18N.es[key] || key;
}

export function applyLanguageUI() {
  const lang = getLang();

  // traducción básica de elementos con data-i18n
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    if (key) el.textContent = t(key);
  });

  // indicador ES/EN en header
  const langES = document.getElementById("langES");
  const langEN = document.getElementById("langEN");
  if (langES && langEN) {
    langES.classList.toggle("active", lang === "es");
    langEN.classList.toggle("active", lang === "en");
  }
}

export function toggleLanguage() {
  const lang = getLang();
  setLang(lang === "es" ? "en" : "es");
  applyLanguageUI();
}