/* Atlas unificado · los 7 países de Centroamérica en lugar de las provincias de Costa Rica.
 * texto.js y el asistente usan PHY.geo.PROVINCIAS para nombrar la zona de un punto: ahora es su país
 * (el que devuelve el servidor en la ficha de celda). El nombre sale de i18n (ES/EN). */
(function () {
"use strict";
const { t } = PHY.i18n;
const PAISES = ["Guatemala", "Belize", "El Salvador", "Honduras", "Nicaragua", "Costa Rica", "Panama"];
const nombre = (id) => t("pais." + String(id).replace(/ /g, "_"));
const PROVINCIAS = PAISES.map((id) => ({ id, get nombre() { return nombre(id); } }));
window.atlasNombrePais = nombre;   // lo usa atlas/app.js para las etiquetas del mapa
PHY.geo = { PROVINCIAS, PAISES, nombrePais: nombre };
})();
