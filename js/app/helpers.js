export function hidePlacesUI(extraControls) {
  extraControls.innerHTML = "";
  extraControls.classList.add("d-none");
}

export function resetCategory(categorySelect) {
  categorySelect.value = "";
  categorySelect.classList.add("d-none");
}

export function resetCanton(cantonSelect) {
  cantonSelect.value = "";
  cantonSelect.innerHTML = `<option value="">🏙️ Seleccione cantón</option>`;
  cantonSelect.disabled = true;
}

export function resetParroquia(parroquiaSelect) {
  parroquiaSelect.value = "";
  parroquiaSelect.innerHTML = `<option value="">🏘️ Seleccione parroquia</option>`;
  parroquiaSelect.classList.add("d-none");
  parroquiaSelect.disabled = true;
}

export function clearRouteInfo(infoBox) {
  infoBox.innerHTML = "";
}

export function resetAllUI({ cantonSelect, parroquiaSelect, categorySelect, extraControls, infoBox, clearMarkers }) {
  resetCanton(cantonSelect);
  resetParroquia(parroquiaSelect);
  resetCategory(categorySelect);
  hidePlacesUI(extraControls);
  clearMarkers();
  clearRouteInfo(infoBox);
}

export function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h*60+m;
}

export function minutesToTime(m) {
  const h = Math.floor(m/60)%24;
  const min = m%60;
  return `${h.toString().padStart(2,"0")}:${min.toString().padStart(2,"0")}`;
}
