# Phyllobytes · Lluvia fuerte en Costa Rica

Atlas web con mapa de calor, gráficas por punto, sección para aprender y asistente virtual.
Funciona de dos maneras:

1. **Solo la página (modo demostración):** abra `web/index.html` desde un servidor cualquiera. Verá una muestra con datos **inventados** (marcada con un aviso) para las 7 provincias.
2. **Con el servidor de Python (datos reales de NASA):** el mismo `backend.py` del visor anterior descarga la lluvia diaria de **NASA POWER** (GPM IMERG o MERRA-2) para cualquier coordenada de Costa Rica, calcula las tendencias y guarda los TXT/CSV.

## Cómo abrirlo (hay tres maneras; la primera no necesita Python)

1. **Doble clic en `web/index.html`** (modo demostración, datos inventados). Funciona sin servidor y sin internet: todos los scripts son clásicos y los datos van incluidos.
2. **Spyder / terminal (datos reales de NASA):** descomprima el zip COMPLETO, abra `INICIAR_PHYLLOBYTES.py` y pulse **F5** (o `python INICIAR_PHYLLOBYTES.py`). En Windows también sirve `INICIAR_WINDOWS.bat`; en Mac/Linux `INICIAR_MAC_LINUX.command`.
   Solo requiere Python 3.8+; si el puerto 8768 está ocupado usa el siguiente libre y el navegador se abre solo.
3. Cualquier servidor estático apuntando a la carpeta `web/`.

**Si le sale un error o se ve sin diseño:** (a) no abra los archivos desde dentro del zip, descomprima todo; (b) ejecute el `.py` estando en la carpeta `PHYLLOBYTES_CR`; (c) si el servidor no arranca, el lanzador abre igualmente la página en modo demostración e imprime el motivo.

En el modo con servidor, toque cualquier lugar de Costa Rica (hasta 8 puntos) o busque por nombre y pulse **Analizar con datos NASA**. Los archivos se guardan en `Descargas/Phyllobytes_resultados`.

## Novedades de esta versión

- **Provincias** recalcadas del mapa de referencia (límites y posición de cada nombre).
- **Barra lateral** plegable: completa → mini (solo íconos) → oculta (botón ☰ del encabezado o botones de la barra); recuerda la elección. La página usa todo el ancho.
- **Encabezado** ordenado en tres zonas y mismo formato en español e inglés.
- **Asistente** solo con opciones y respuestas prescritas, alimentado por `web/data/asistente.json` (ver `web/data/ASISTENTE_LEEME.md`).
- **Marca de agua** en cada gráfica y mapa, y en el pie de página (`web/assets/marca-agua.png`).
- **Estilo «OpenStreetMap»** en el mapa (teselas de OpenStreetMap; requiere internet y, para que no las bloqueen, abrir la página por el servidor y no con doble clic).

## Qué hay en la página

- **Inicio**: introducción y mapa de Costa Rica con las 7 provincias y sus puntos.
- **Mapa**: mapa de calor (curvas de nivel o suave) con el indicador y el año que elija, puntos por provincia, clic para elegir cualquier coordenada, búsqueda de lugares y coordenadas escritas.
- **Resultados**: lectura en palabras sencillas, números clave, gráficas (días de lluvia fuerte con tendencia, lluvia anual, lluvia por mes y días con 50,8 / 76,2 / 101,6 / 127 mm), ficha para copiar y CSV.
- **Comparar**: gráfico de cambio por punto con su rango probable y tabla.
- **Aprende**: explicación desde cero de cómo se recolectan los datos y cómo leerlos.
- **Método**: pasos, límites y fuente.
- **Asistente**: botón «Asistente» (preguntas y respuestas preparadas, en español e inglés).
- **ES / EN**: cambia todo el idioma.
- **Accesibilidad**: contraste alto, letra grande o muy grande, colores para daltonismo (azul y amarillo con símbolos ▲ ▼ ●) y menos movimiento.

## Notas honestas

- Los **límites de las provincias** son aproximados (calcados de un mapa de referencia y recortados con el contorno del país). No son los límites oficiales del IGN.
- El **mapa de calor** es una interpolación entre los puntos que usted elige: es una ilustración, no una medición en todo el territorio.
- Cada punto es una **celda satelital de ~10 km**. No es un pronóstico ni una alerta de inundaciones.
- La tipografía **Batangas** no está incluida (ver `web/fonts/LEEME.txt`).

## Archivos

| Archivo | Función |
| --- | --- |
| `backend.py` | Servidor local y cálculo estadístico (NASA POWER, percentiles, Theil–Sen, Mann–Kendall, exportación TXT/CSV). |
| `INICIAR_PHYLLOBYTES.py` | Arranque para Spyder (F5). |
| `web/index.html`, `web/css/`, `web/js/` | La página (scripts clásicos sin dependencias; abre con doble clic). |
| `web/data/asistente.json` | Preguntas y respuestas del asistente (editable). `asistente.json.js` es su copia automática. |
| `SINCRONIZAR_DATOS.py` | Regenera las copias `.js` tras editar `asistente.json` o `places.json`. |
| `web/js/i18n.js` | Todos los textos en español e inglés. |
| `web/js/geo.js` | Contorno de Costa Rica y provincias. |
| `web/assets/` | Logo de la rana, nombre y catálogo de lugares (`places.json`). |
