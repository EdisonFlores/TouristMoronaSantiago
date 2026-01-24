export function calcularTiempo(route, mode) {
  const distanciaKm = route.distance / 1000;

  const speeds = {
    walking: 5,
    bicycle: 15,
    motorcycle: 30,
    driving: 25
    // 🚌 bus NO implementado aún
  };

  const speed = speeds[mode];

  if (!speed) {
    return {
      tiempo: "No disponible",
      distancia: distanciaKm.toFixed(2)
    };
  }

  const totalSeconds = Math.round((distanciaKm / speed) * 3600);

  let tiempoTexto = "";

  if (totalSeconds < 60) {
    tiempoTexto = `${totalSeconds} segundos`;
  } else {
    const min = Math.floor(totalSeconds / 60);
    const sec = totalSeconds % 60;
    tiempoTexto =
      sec > 0
        ? `${min}:${sec.toString().padStart(2, "0")} min`
        : `${min} min`;
  }

  return {
    tiempo: tiempoTexto,
    distancia: distanciaKm.toFixed(2)
  };
}
