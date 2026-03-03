import { applyLanguageUI, toggleLanguage } from "./i18n.js";
import { applyThemeUI, toggleTheme } from "./theme.js";

export function initHeaderControls({ onLanguageChanged } = {}) {
  // aplicar estado inicial
  applyThemeUI();
  applyLanguageUI();

  const btnTheme = document.getElementById("btnTheme");
  const btnLang = document.getElementById("btnLang");

  if (btnTheme) btnTheme.addEventListener("click", () => toggleTheme());

  if (btnLang) btnLang.addEventListener("click", () => {
    toggleLanguage();
    onLanguageChanged?.();
  });
}