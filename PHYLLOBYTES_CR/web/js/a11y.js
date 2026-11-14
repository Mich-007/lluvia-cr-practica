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

export const leer = () => ({ ...estado });
export function aplicar() {
  const d = document.documentElement.dataset;
  d.contraste = estado.contraste ? "alto" : "";
  d.letra = ["", "grande", "xl"][estado.letra] ?? "";
  d.paleta = estado.daltonismo ? "daltonismo" : "";
  d.movimiento = estado.movimiento ? "reducido" : "";
}
export function poner(clave, valor) {
  estado[clave] = valor;
  try { localStorage.setItem(CLAVE, JSON.stringify(estado)); } catch { /* sin almacenamiento */ }
  aplicar();
  oyentes.forEach((f) => f(clave));
}
export const alCambiar = (f) => oyentes.push(f);
aplicar();
