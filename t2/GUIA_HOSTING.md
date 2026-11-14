# Guía de hosting seguro: Mesoamérica Resiliente

Sitio **estático** (HTML + JS + `resultados.json`). No hay servidor, base de datos ni claves secretas. Eso lo hace rápido, barato y difícil de romper.

> **Antes de empezar:** confirmen con su sede de Space Apps qué se permite preparar antes del evento. Este kit sirve para **practicar el despliegue con datos sintéticos**. La app final con resultados reales debe hacerse durante el hackatón.

---

## 0. Qué hosting usar (y una corrección)

En la respuesta anterior sugerí Vercel o Netlify como principal. Al revisar los límites actuales, **ajusto la recomendación** para un equipo de 6 personas:

| Opción | Equipo de 6 | Repo privado | Cabeceras de seguridad | Veredicto |
| --- | --- | --- | --- | --- |
| **Cloudflare Pages** | Sin límite de personas en el plan gratis | Sí | `_headers` | **Principal** |
| **Netlify** | Sí | Sí | `_headers` | **Alternativa** |
| **Vercel (Hobby)** | La documentación indica que las funciones de colaboración en equipo son del plan Pro | Con colaboradores puede bloquear despliegues | `vercel.json` | Solo si **una persona** sube y despliega todo |
| **GitHub Pages** | Sí | Requiere plan de pago para repos privados | No permite cabeceras propias | Solo **espejo de respaldo** |

Fuentes: [Vercel Hobby](https://vercel.com/docs/plans/hobby), [límites de Cloudflare Pages](https://developers.cloudflare.com/pages/platform/limits). Los planes cambian: revisen el panel antes de decidir.

**Elegimos Cloudflare Pages como principal.** El kit ya trae la configuración de los tres, así que cambiar de hosting no exige tocar código.

---

## 1. Cuentas y seguridad (30 min, una vez)

1. Cada persona activa **verificación en dos pasos (2FA)** en GitHub y en el hosting.
2. Una persona (el líder técnico) crea la cuenta del hosting; otra queda como **administradora de respaldo**.
3. En GitHub: **repositorio privado** (la idea es del equipo). Añadan a las 6 personas como colaboradoras.
4. En el repo, **Settings → Branches → Add rule** para `main`:
   - Require a pull request before merging (1 aprobación).
   - Require status checks to pass → seleccionar `build` (viene del workflow `CI`).
5. Nunca pongan claves en el código. Este sitio no usa ninguna; si algún día añaden una API de IA, la clave va solo en las variables del panel del hosting.

## 2. Subir el proyecto a GitHub

```bash
cd mesoamerica-web          # la carpeta de este kit
git init -b main
git add .
git commit -m "Base del sitio estático"
git remote add origin git@github.com:SU-ORG/mesoamerica-resiliente.git
git push -u origin main
```

Si usan monorepo (`/analisis` + `/web`), copien este kit dentro de `/web`. En el paso 3 indicarán **Root directory = `web`**.

## 3. Conectar Cloudflare Pages (principal)

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Autoricen GitHub **solo para ese repositorio** (no "todos los repos").
3. Configuración del build:

   | Campo | Valor |
   | --- | --- |
   | Production branch | `main` |
   | Framework preset | None (o Vite) |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Root directory | vacío (o `web` si es monorepo) |
   | Variable de entorno | `NODE_VERSION` = `22` |

4. **Save and Deploy.** En ~1 minuto tendrán una URL `https://NOMBRE.pages.dev`.
5. Si el panel les ofrece **Workers** en lugar de Pages para sitios estáticos, el flujo es equivalente: mismo comando de build, mismo directorio `dist`, y el archivo `_headers` se sigue aplicando.

Desde ahora: cada `push` a `main` publica; cada pull request genera una **URL de vista previa**.

### Alternativa Netlify
**Add new site → Import an existing project → GitHub** → elegir el repo. Lee `netlify.toml` solo (build `npm run build`, publicar `dist`).

### Alternativa Vercel
**Add New → Project** → importar el repo. Detecta Vite y lee `vercel.json`. Recuerden la limitación del plan Hobby para equipos.

## 4. Verificar que quedó seguro (5 min, **obligatorio**)

Con su URL pública:

```bash
curl -sI https://NOMBRE.pages.dev | grep -iE "content-security|x-frame|x-content-type|strict-transport|referrer|permissions"
```

Deben aparecer las 6 cabeceras. Luego:

- Pegar la URL en [securityheaders.com](https://securityheaders.com) (meta: nota A o mejor).
- Abrir el sitio con **F12 → Consola**: no debe haber errores rojos de "Content Security Policy".
- Probar en **ventana de incógnito** y desde el **celular**.
- Comprobar que el mapa carga las teselas (si no, falta su dominio en `img-src`).

## 5. Flujo diario del equipo

```
git switch -c datos/p3-resultados      # una rama por persona/tarea
# ...cambios...
npm run build                          # corre la verificación local
git push -u origin datos/p3-resultados # abrir Pull Request
```

1. Se abre el PR → corre **CI** → Cloudflare publica una **vista previa**.
2. Otra persona **revisa mirando la URL de vista previa** y aprueba.
3. Se fusiona a `main` → se publica la URL oficial.

**Quién toca qué**
- Estadística/Datos: solo reemplazan `public/data/resultados.json` (y ponen `"sintetico": false`).
- Si el JSON real tiene otra forma: se ajusta **solo `src/adapter.js`**.
- Frontend: `src/`, `index.html`. Nadie edita `public/_headers` ni `vercel.json` a mano: se editan en `security-headers.mjs` y se corre `npm run headers`.

## 6. Cambiar a datos reales

1. Generar el JSON real con el análisis y copiarlo a `public/data/resultados.json`.
2. Rellenar `meta` (producto, versión, periodo, fecha de descarga, definición del umbral). **Poner `"sintetico": false`**; así desaparece el aviso amarillo.
3. `npm run build` debe terminar con `✔ Verificación superada`.
4. PR → revisión → fusionar.

## 7. Qué protege este kit

| Protección | Dónde | Qué evita |
| --- | --- | --- |
| Content-Security-Policy | `security-headers.mjs` | Que se ejecute código ajeno en la página (XSS) |
| `frame-ancestors`, `X-Frame-Options` | idem | Que embeban su sitio en otro (clickjacking) |
| HSTS, HTTPS forzado | idem | Conexiones sin cifrar |
| `Permissions-Policy` | idem | Acceso a cámara, micrófono, ubicación |
| Texto con `textContent` | `src/main.js` | Inyección de HTML desde el JSON |
| `scripts/verificar.mjs` | build | Publicar con scripts en línea, claves o rutas del computador |
| Rama `main` protegida + CI | GitHub | Fusionar código roto o sin revisar |
| Sin secretos en el front | `.env.example` | Que cualquiera copie una clave desde el navegador |

**Límites honestos:** `style-src 'unsafe-inline'` existe porque Leaflet escribe estilos desde JavaScript. El sitio es público por diseño (los jueces deben abrirlo). **Las URL de vista previa también son accesibles para quien tenga el enlace**: no pongan en un PR nada que no quieran que se vea. La CSP reduce riesgos; no sustituye revisar el código.

## 8. La función de IA (cuando llegue ese bloque)

Opción recomendada: **textos pregenerados** guardados en un archivo estático (p. ej. `public/data/fichas.json`), validados con la regla "toda cifra del texto existe en el JSON". Cero llamadas en vivo, cero clave expuesta, cero costo.

Si prefieren IA en vivo: función serverless intermediaria, clave en variables del hosting, límite de peticiones, y añadir el dominio de la API a `connect-src` en `security-headers.mjs`. El sitio debe funcionar completo aunque la IA falle.

## 9. Respaldos y entrega

- [ ] URL oficial abre en incógnito y en otro dispositivo.
- [ ] `curl -I` muestra las cabeceras; securityheaders.com sin alertas graves.
- [ ] `resultados.json` real, `"sintetico": false`, sin aviso amarillo.
- [ ] Sección **Método y límites** visible; leyenda con texto (no solo color).
- [ ] Espejo opcional: workflow **Espejo en GitHub Pages** (manual; requiere repo público o plan de pago).
- [ ] `dist/` comprimido guardado y un video corto de la demo.
- [ ] **Congelar** `main` en H22 (nadie fusiona más). Registrar el envío oficial y confirmar que quedó guardado.
- [ ] El enlace entregado es accesible para jueces sin iniciar sesión.

**Volver a una versión anterior:** en Cloudflare Pages → Deployments → elegir el despliegue bueno → **Rollback to this deployment**. En Netlify: Deploys → *Publish deploy*. Es instantáneo.

## 10. Si algo falla

| Síntoma | Causa probable | Solución |
| --- | --- | --- |
| Mapa gris, sin teselas | Falta dominio en `img-src` | Añadirlo en `security-headers.mjs`, `npm run headers` |
| Página en blanco, error CSP en consola | Script o estilo externo bloqueado | Traerlo desde npm (`npm i paquete`) en vez de un `<script src=https://...>` |
| "No se pudieron cargar los resultados" | JSON mal formado o distinto al contrato | Leer el mensaje: indica el campo; ajustar `src/adapter.js` |
| Build falla en el hosting | Versión de Node distinta | Variable `NODE_VERSION=22` |
| `Verificación FALLÓ` | Cabeceras desincronizadas, secreto o script en línea | Leer la lista; `npm run headers` |
| Los cambios no se ven | Caché del navegador | Recarga forzada (Ctrl+Shift+R); los datos se revalidan siempre |

## 11. Comandos

| Comando | Qué hace |
| --- | --- |
| `npm ci` | Instala exactamente lo del `package-lock.json` |
| `npm run dev` | Servidor local en http://localhost:5173 |
| `npm run build` | Sincroniza cabeceras, construye `dist/` y verifica |
| `npm run preview` | Sirve `dist/` para probar como producción |
| `npm run muestra` | Regenera datos **sintéticos** de práctica |
| `npm run headers` | Regenera `_headers` y `vercel.json` |
