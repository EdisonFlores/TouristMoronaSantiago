// js/app/translate.js

export function translatePage() {

  const lang = (navigator.language || navigator.userLanguage || "en")
    .toLowerCase()
    .split("-")[0];

  const url = window.location.href;

  const translateURL =
    "https://translate.google.com/translate?sl=auto&tl=" +
    lang +
    "&u=" +
    encodeURIComponent(url);

  window.location.href = translateURL;
}