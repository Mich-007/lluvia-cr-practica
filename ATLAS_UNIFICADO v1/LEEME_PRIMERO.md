# Phyllobytes · Atlas de lluvia de Centroamérica (versión unificada 7.0)

Une las dos partes que se trabajaron por separado, sin perder ninguna:

- **Apariencia (de `test 3`, Phyllobytes):** barra lateral plegable, encabezado con ES/EN, accesibilidad y asistente, portada, colores, tipografía, marca de agua en cada gráfica y mapa, pie de página, Aprende y Método.
- **Lógica (del atlas v6.3):** el mismo `backend.py` y módulos, las 7 fuentes, los 7 países, todas las opciones del usuario, el mapa de OpenStreetMap, la ficha de celda, las ~40 figuras interactivas, el semáforo, la robustez entre productos, la verificación con desfase, Estaciones CR y todas las exportaciones.

No hay datos inventados: sin servidor la página avisa y no muestra resultados.

## Cómo abrirlo

1. Abra `INICIAR_ATLAS.py` en Spyder y pulse **F5** (o `python INICIAR_ATLAS.py`). Se abre `http://127.0.0.1:8780`.
   Usa un puerto distinto del visor v6.3 (8768), así ambos pueden abrirse a la vez.
2. Para detenerlo, reinicie el núcleo de Spyder.
3. Los resultados y la caché se guardan en `Descargas/Precipitacion_NASA_Comparador_CR/` (la misma carpeta del atlas, así se reutilizan las descargas).

## Qué cambió al unir (y qué no)

- **Flujo en 3 pasos** en «Analizar»: 1) datos y período, 2) lugares en el mapa (mapa grande con el panel de lugares al lado), 3) verificación opcional y botón «Analizar precipitación». Todos los controles del atlas siguen ahí, con los mismos identificadores.
- **Mapa:** el mismo mapa funcional de OpenStreetMap; ahora marca los 7 países elegibles (borde cian, resaltado al pasar, nombre) y deja México y Colombia en gris. La portada tiene un mini mapa de los 7 países: al tocar uno, el mapa grande se acerca a ese país.
- **Gráficas:** se conservan todas con su interacción; `web/js/tema-plotly.js` les aplica la paleta, la letra y la marca de agua de Phyllobytes (también en el PNG descargado) y las redibuja al cambiar contraste, daltonismo o tamaño de letra.
- **Colores de estado:** ▲ aumento y ▼ disminución usan los colores de Phyllobytes (naranja y cian; amarillo y azul en modo daltonismo).
- **Asistente:** el mismo, alimentado ahora con los resultados reales (días de lluvia fuerte > P95 y su tendencia). Sus textos y los de la portada hablan de los 7 países.
- **Idiomas:** todo está en español e inglés, también lo que genera el análisis (títulos, ejes, leyendas y textos emergentes de las figuras, notas, semáforo, verificación, Estaciones CR y mensajes del servidor). Esos textos se traducen sin tocar la lógica: `web/js/traductor-nucleo.js` y `traductor-diccionario.js` (frases con comodines para cifras y nombres) se aplican a las figuras desde `tema-plotly.js` y al HTML desde `traductor-dom.js`; al volver a español se restaura el original. En inglés los decimales usan punto. Quedan en su idioma los nombres propios (estaciones, «El Niño/La Niña») y los archivos TXT/CSV descargados, que conservan sus cabeceras originales. Para añadir una frase nueva, agréguela al diccionario como `["texto en español con {}", "English text with {}"]`.
- **Se quitaron:** la muestra de demostración (datos inventados) y el «mapa de calor» interpolado de Phyllobytes, porque el atlas nunca rellena con colores las zonas sin puntos.

## Archivos

| Archivo | Función |
| --- | --- |
| `backend.py` y módulos `.py` | Servidor y cálculo (copiados del atlas; solo se añadieron tipos MIME de imagen/fuente y la versión 7.0). |
| `web/index.html` | La página unificada. |
| `web/atlas/` | JavaScript del atlas (sin cambios de lógica; solo colores de estado ligados a la paleta y países marcados en el mapa). |
| `web/js/` | Módulos de Phyllobytes (idioma, accesibilidad, asistente) + `shell.js` (conecta todo), `i18n-atlas.js` (textos ES/EN de los controles), `traductor-*.js` (textos que genera el análisis), `tema-plotly.js`, `geo-ca.js`. |
| `web/css/atlas-tema.css` | Generado por `GENERAR_TEMA_ATLAS.py` desde `web/atlas/styles.css`: no editar a mano. |
| `web/css/unificado.css` | Distribución y ajustes de la unión. |
| `web/data/asistente.json` | Preguntas y respuestas del asistente; tras editarlo, ejecute `SINCRONIZAR_DATOS.py`. |
| `tools_textos_unificado.py` | Registro de los cambios de texto (Costa Rica → 7 países, sin demostración). |
| `tests/` | Las 75 pruebas del atlas (`python -m unittest discover -s tests`). |

La tipografía Batangas no está incluida (igual que en Phyllobytes, ver `web/fonts/LEEME.txt`); la página usa la letra de respaldo.
