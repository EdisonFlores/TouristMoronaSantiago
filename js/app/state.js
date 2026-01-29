// ================= ESTADO GLOBAL =================

// lista de lugares filtrados
export const dataList = [];

// ubicación del usuario
let userLocation = null;

// lugar actualmente seleccionado
let activePlace = null;

// modo de transporte actual
let currentMode = "walking";

// ================= UBICACIÓN =================
export const setUserLocation = loc => {
  userLocation = loc;
};

export const getUserLocation = () => userLocation;

// ================= LUGAR ACTIVO =================
export const setActivePlace = place => {
  activePlace = place;
};

export const getActivePlace = () => activePlace;

// ================= MODO DE TRANSPORTE =================
export const setMode = mode => {
  currentMode = mode;
};

export const getMode = () => currentMode;

// ================= VELOCIDADES Y CÁLCULO TIEMPO =================
// velocidades en km/h según modo
export const velocidades = {
  walking: 5,      // caminando
  bicycle: 15,     // bicicleta
  motorcycle: 35,  // motocicleta
  driving: 30,     // auto
  bus: 20          // bus
};

/**
 * Calcula el tiempo aproximado en minutos según distancia (km) y modo
 * @param {number} km - distancia en km
 * @param {string} modo - 'walking'|'bicycle'|'motorcycle'|'driving'|'bus'
 * @returns {number} tiempo en minutos
 */
export const calcularTiempo = (km, modo) => {
  if (!velocidades[modo]) return 0;
  return (km / velocidades[modo]) * 60;
};
