/* Phyllobytes · módulo «a11y» (script clásico: funciona al abrir index.html con doble clic, sin servidor). */
(function () {
"use strict";
// Accesibilidad: contraste alto, tamaño de letra, paleta para daltonismo y menos movimiento.
// Se guarda en el navegador (localStorage) y se aplica con atributos data-* en <html> (ver css/phyllobytes.css).
const CLAVE = "phy-a11y";
const base = () => ({
  contraste: window.matchMedia?.("(prefers-contrast: more)").matches ?? false,
  letra: 0, // 0 normal, 1 grande, 2 muy grande
  daltonismo: false,
  movimiento: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
});
let estado = base();
try { Object.assign(estado, JSON.parse(localStorage.getItem(CLAVE) ?? "{}")); } catch { /* sin almacenamiento */ }
const oyentes = [];

const leer = () => ({ ...estado });
function aplicar() {
  const d = document.documentElement.dataset;
  d.contraste = estado.contraste ? "alto" : "";
  d.letra = ["", "grande", "xl"][estado.letra] ?? "";
  d.paleta = estado.daltonismo ? "daltonismo" : "";
  d.movimiento = estado.movimiento ? "reducido" : "";
}
function poner(clave, valor) {
  estado[clave] = valor;
  try { localStorage.setItem(CLAVE, JSON.stringify(estado)); } catch { /* sin almacenamiento */ }
  aplicar();
  oyentes.forEach((f) => f(clave));
}
const alCambiar = (f) => oyentes.push(f);
aplicar();
PHY.a11y = { aplicar, poner, leer, alCambiar };
})();
