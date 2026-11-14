# Publicar Phyllobytes en Cloudflare Pages

**Por qué antes no se veía completo:** Cloudflare Pages solo sirve archivos estáticos. **No ejecuta Python**, así que `backend.py` no corre allí.
Esta versión ya no depende del Python: si no encuentra el servidor, la página pide los datos **directo a NASA POWER desde el navegador** y calcula lo mismo
(se comprobó que los resultados coinciden con `backend.py`). El servidor de Python queda como opción para quien lo use en su computadora (añade los TXT).

## Pasos (Pages conectado a GitHub o subida directa)

1. Suba la carpeta del proyecto. Lo importante es que **`web/index.html` y todo lo que hay dentro de `web/`** se publiquen completos
   (`css/`, `js/` con sus 13 archivos, `assets/`, `fonts/` y el archivo `_headers`).
2. En la configuración del proyecto de Pages:
   - **Build command:** (vacío)
   - **Build output directory:** `web`
   - **Root directory:** la carpeta que contiene `web/` y `functions/` (`PHYLLOBYTES_CR`).
3. En **Cloudflare → Speed → Optimization**: desactive **Rocket Loader** (rompe los módulos de JavaScript) y el *Auto Minify* si aparece.
4. Tras volver a subir archivos, use **Caching → Purge Everything** o recargue con Ctrl+F5 (si se mezclan archivos nuevos con viejos, la página puede quedar a medias).

## Qué cubre cada parte

| Pieza | Para qué |
| --- | --- |
| `web/` | La página completa. Con esto solo ya funciona (demostración + análisis directo a NASA). |
| `web/_headers` | Evita que Cloudflare guarde versiones viejas de los `.js` y `.css`. |
| `functions/api/power.js` | Respaldo opcional: si el navegador no puede llamar a NASA directamente, la página usa `/api/power`. Solo sirve consultas de lluvia de Costa Rica. Funciona solo si publica con la carpeta raíz (no con "arrastrar y soltar" de `web/`). |
| `backend.py` + `INICIAR_PHYLLOBYTES.py` | Uso local con Spyder (F5). Añade los archivos TXT. |

## Si aún no se ve bien
- Abra la página y pulse **F12 → Consola**. La página muestra un aviso rojo con la causa si no logra iniciar.
- Compruebe que en `https://su-sitio/js/app.js` aparece código (no una página de error 404).
- El análisis directo necesita **internet** y puede tardar unos minutos por punto la primera vez; después queda guardado en el navegador.
