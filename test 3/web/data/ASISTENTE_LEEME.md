# Cómo llenar el asistente (`asistente.json`)

El asistente **no tiene cuadro de texto**: muestra una pregunta/respuesta y debajo botones con opciones.
Todo el contenido está en `asistente.json`; no hay que tocar código.

## Estructura

```json
{
  "inicio": "inicio",
  "textos": { "titulo": {"es": "…", "en": "…"}, "subtitulo": {…}, "menu": {…} },
  "nodos": {
    "inicio": {
      "mensaje": { "es": ["Línea 1", "Línea 2"], "en": ["Line 1", "Line 2"] },
      "opciones": [
        { "texto": {"es": "¿Qué es Phyllobytes?", "en": "What is Phyllobytes?"}, "ir": "que_es" },
        { "texto": {"es": "Ir al mapa", "en": "Go to the map"}, "accion": "ir_seccion", "valor": "mapa-seccion" }
      ]
    },
    "que_es": { "mensaje": "…", "opciones": [ … ] }
  }
}
```

- **nodo** = una respuesta. Su nombre (`"que_es"`) es libre, sin espacios.
- **mensaje**: texto de la respuesta. Puede ser una cadena, una lista de líneas, o `{"es": …, "en": …}` (cada idioma como cadena o lista).
- **opciones**: los botones que aparecen después de esa respuesta. `ir` = nombre del nodo al que lleva.
  Siempre aparece además un botón «Menú principal» que vuelve a `inicio`.
- **accion** (opcional): `ir_seccion` (con `valor`: `inicio`, `mapa-seccion`, `resultados`, `comparacion`, `aprende`, `metodo`),
  `abrir_accesibilidad`, `enlace` (con `valor` = URL `https://…`).

## Marcadores que se rellenan solos con lo que hay en pantalla

`{{lectura_punto}}` (interpretación del punto seleccionado), `{{resumen_regional}}`, `{{lista_puntos}}`, `{{mayor_aumento}}`,
`{{mayor_disminucion}}`, `{{estado_demo}}`, `{{estado_analisis}}`, `{{n_puntos}}`. Úselos dentro de un `mensaje`.

## Cómo se carga

- Con el servidor de Python (`INICIAR_PHYLLOBYTES.py`) o cualquier servidor web: la página lee `asistente.json` directamente; basta recargar.
- Abriendo `web/index.html` con doble clic: el navegador no deja leer JSON, así que usa la copia `asistente.json.js`.
  Después de editar el JSON ejecute `SINCRONIZAR_DATOS.py` (o `INICIAR_PHYLLOBYTES.py`, que lo hace solo). **No edite `asistente.json.js`.**
- Si una opción apunta a un nodo que no existe, o el JSON tiene un error, la página no se rompe: avisa en la consola del navegador (F12)
  y/o al ejecutar `SINCRONIZAR_DATOS.py`.
