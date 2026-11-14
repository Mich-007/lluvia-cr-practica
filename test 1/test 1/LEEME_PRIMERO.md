# Phyllobytes · Lluvia fuerte en Costa Rica

Atlas web con mapa de calor, gráficas por punto, sección para aprender y asistente virtual.
Funciona de tres maneras:

0. **En línea (Cloudflare Pages u otro hosting estático):** ver `CLOUDFLARE_LEEME.md`. No necesita Python: analiza pidiendo los datos a NASA POWER desde el navegador.
1. **Solo la página (modo demostración):** abra `web/index.html` desde un servidor cualquiera. Verá una muestra con datos **inventados** (marcada con un aviso) para las 7 provincias.
2. **Con el servidor de Python (datos reales de NASA, más los TXT):** el mismo `backend.py` del visor anterior descarga la lluvia diaria de **NASA POWER** (GPM IMERG o MERRA-2) para cualquier coordenada de Costa Rica, calcula las tendencias y guarda los TXT/CSV.

## Cómo abrirlo (Spyder 6, sin instalar nada)

1. Descomprima la carpeta completa.
2. Abra `INICIAR_PHYLLOBYTES.py` en Spyder y pulse **F5**.
3. Abra http://127.0.0.1:8768 en el navegador (si no se abre solo). El punto de la barra lateral dirá **Servidor conectado**.
4. En el mapa toque cualquier lugar de Costa Rica (hasta 8 puntos) o busque un lugar por nombre y pulse **Analizar con datos NASA**.
   Cada punto tarda un poco la primera vez; después se guarda una copia local.

Los archivos se guardan en `Descargas/Phyllobytes_resultados`.

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

- Los **límites de las provincias** son aproximados (dibujados a mano sobre el contorno del país). No son los límites oficiales del IGN.
- El **mapa de calor** es una interpolación entre los puntos que usted elige: es una ilustración, no una medición en todo el territorio.
- Cada punto es una **celda satelital de ~10 km**. No es un pronóstico ni una alerta de inundaciones.
- La tipografía **Batangas** no está incluida (ver `web/fonts/LEEME.txt`).

## Archivos

| Archivo | Función |
| --- | --- |
| `backend.py` | Servidor local y cálculo estadístico (NASA POWER, percentiles, Theil–Sen, Mann–Kendall, exportación TXT/CSV). |
| `INICIAR_PHYLLOBYTES.py` | Arranque para Spyder (F5). |
| `web/index.html`, `web/css/`, `web/js/` | La página (JavaScript sin dependencias, funciona sin internet). |
| `web/js/nasa.js` | Análisis directo en el navegador (misma lógica que `backend.py`). |
| `functions/api/power.js` | Respaldo para Cloudflare Pages. |
| `web/js/i18n.js` | Todos los textos en español e inglés. |
| `web/js/geo.js` | Contorno de Costa Rica y provincias. |
| `web/assets/` | Logo de la rana, nombre y catálogo de lugares (`places.json`). |
