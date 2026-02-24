// js/app/normalize.js

/**
 * Normalización "suave" para comparar texto (sin tildes, trim, lower).
 */
export function normLite(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // quita tildes
}

/**
 * Key para búsquedas/joins (más estricta).
 */
export function normKey(s) {
  return normLite(s).replace(/\s+/g, " ");
}

/**
 * Title Case simple (palabras).
 */
export function titleCaseWords(s) {
  const t = String(s || "").trim();
  if (!t) return "";
  return t
    .toLowerCase()
    .split(/\s+/g)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}