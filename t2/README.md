# Mesoamérica Resiliente · Web

Atlas estático de tendencias de días de lluvia extrema (NASA GPM IMERG). Vite + Leaflet, sin backend.

```bash
npm ci
npm run dev        # http://localhost:5173
npm run build      # construye y verifica seguridad
```

## Qué tiene la página

- **Portada** con la pregunta del proyecto, conteo por tipo de tendencia y los 7 sitios sobre curvas de nivel (clicables).
- **Estilo de vidrio líquido**: degradado azul verdoso, gotas de agua de fondo, paneles translúcidos y pines con forma de gota. Los colores y el vidrio se ajustan en `:root` de `src/style.css`.
- **Idioma ES / EN**: interruptor en la barra superior. Recuerda la elección y usa el idioma del navegador la primera vez.
- **Barra de navegación** fija (Inicio, Mapa, Comparación, Método) que marca la sección activa.
- **Mapa regional** (OpenStreetMap con tema oscuro) con un punto por país. Al pulsar un punto o un botón de la lista se muestra el detalle: lectura en lenguaje sencillo, serie anual, recta de Theil–Sen, intervalo, valor p ajustado, umbral, cobertura, tabla año por año y botón para copiar la ficha de evidencia.
- **Datos generales** (tarjetas) y **comparación regional** (pendiente ± IC 95 % de los 7 sitios).
- **Método y límites** según el plan del proyecto.
- **Asistente virtual** (botón flotante / “Preguntar al asistente”): responde preguntas predefinidas, lee un sitio, compara dos y mueve el mapa. Funciona sin internet y sin API de IA (`src/asistente.js`).

## Archivos

| Archivo | Función |
| --- | --- |
| `public/data/resultados.json` | Resultados (contrato en `src/adapter.js`). El incluido es **sintético**. |
| `src/main.js` | Mapa, detalle por sitio, datos generales, método. |
| `src/chart.js` | Gráfico de serie anual y gráfico de comparación regional (SVG). |
| `src/hero.js` | Ilustración de la portada. |
| `src/asistente.js` | Lógica y ventana del asistente. Para añadir preguntas, agregar una entrada a `INTENCIONES`. |
| `src/i18n.js` | Todos los textos en español e inglés. Para cambiar o añadir una frase, edite la misma clave en `es` y en `en`. |
| `src/texto.js` | Frases en lenguaje sencillo generadas solo con cifras calculadas. |
| `src/style.css` | Diseño (tokens de color al inicio). |

## Pasar de datos sintéticos a reales

1. Reemplazar `public/data/resultados.json` con los resultados del análisis (mismo formato) y poner `"sintetico": false` en `meta`.
2. Verificar nombres y coordenadas de los 7 aeropuertos propuestos (un punto por país).
3. `npm run build`.

- **Despliegue paso a paso:** [GUIA_HOSTING.md](GUIA_HOSTING.md)
- **Cabeceras de seguridad:** editar `security-headers.mjs` y correr `npm run headers`.
