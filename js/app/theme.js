//js/app/theme.js
const LS_THEME = "tm_theme";

export function getTheme() {
  return (localStorage.getItem(LS_THEME) || "light").toLowerCase();
}
export function setTheme(theme) {
  localStorage.setItem(LS_THEME, theme);
}

export function applyThemeUI() {
  const theme = getTheme();
  document.documentElement.setAttribute("data-theme", theme);

  const themeIcon = document.getElementById("themeIcon");
  if (themeIcon) {
    themeIcon.className = theme === "dark"
      ? "bi bi-sun-fill"
      : "bi bi-moon-stars-fill";
  }
}

export function toggleTheme() {
  const theme = getTheme();
  setTheme(theme === "dark" ? "light" : "dark");
  applyThemeUI();
}