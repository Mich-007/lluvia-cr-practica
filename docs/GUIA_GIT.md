# Guía de Git y GitHub para el equipo (desde la terminal)

Para quien nunca ha usado GitHub. Son ~10 comandos; con el uso se vuelven automáticos.

**Idea en una frase:** `main` es la versión buena y compartida. Nadie trabaja directo ahí: cada quien trabaja en su **rama**, y la propone con un **Pull Request (PR)** para que otra persona la revise.

---

## A. Una sola vez, cada persona

### 1. Instalar
- **Git:** https://git-scm.com (en Windows, esto instala también *Git Bash*)
- **GitHub CLI (`gh`):** https://cli.github.com
- **Python 3.10+** y **VS Code**

### 2. Presentarse a Git
```bash
git config --global user.name  "Tu Nombre"
git config --global user.email "el-correo-de-tu-cuenta-github@ejemplo.com"
```

### 3. Iniciar sesión en GitHub desde la terminal
```bash
gh auth login
```
Elijan: **GitHub.com → HTTPS → Login with a web browser**. Copian el código que muestra y lo pegan en el navegador. (No hay que manejar contraseñas ni llaves SSH.)

> Activen **verificación en dos pasos (2FA)** en su cuenta de GitHub: Settings → Password and authentication.

### 4. Aceptar la invitación al repositorio
Les llega un correo de GitHub. Acepten, o desde la terminal: `gh repo list` para comprobar que lo ven.

### 5. Descargar el proyecto
```bash
gh repo clone DUENO/NOMBRE-REPO
cd NOMBRE-REPO
```
Luego sigan el "Arranque rápido" del README.

---

## B. Solo el líder técnico, una vez: crear el repo

Desde la carpeta del proyecto (descomprimida):

```bash
bash scripts/crear_repo.sh DUENO NOMBRE-REPO usuario1 usuario2 usuario3 usuario4 usuario5
```

Esto crea el repo **privado**, sube el código, invita a las personas, crea etiquetas e intenta proteger `main`. Todo en un solo comando.

*(Si prefieren hacerlo a mano: `git init -b main`, `git add .`, `git commit -m "Base inicial"`, `gh repo create DUENO/NOMBRE-REPO --private --source=. --push`.)*

---

## C. El ciclo diario (esto es lo que más van a usar)

```bash
# 1. Ponerse al día con main
git switch main
git pull

# 2. Crear TU rama para la tarea (nombre: area/que-hago)
git switch -c datos/extraer-sitios-reales

# 3. Trabajar y probar
#    ...editan archivos en VS Code...
cd analisis && pytest -v && cd ..     # si tocaron análisis

# 4. Ver qué cambió y guardarlo
git status                             # qué archivos cambiaron
git add archivo1.py archivo2.py        # o `git add .` si todo es suyo
git commit -m "Extrae la celda más cercana para sitios reales"

# 5. Subir la rama y abrir el Pull Request
git push -u origin datos/extraer-sitios-reales
gh pr create --fill                    # abre el PR con la plantilla

# 6. Otra persona lo revisa
gh pr list                             # ver PRs abiertos
gh pr view 12 --web                    # abrir el PR #12 en el navegador
gh pr checkout 12                      # (revisor) traer ese PR a su computadora para probarlo
gh pr review 12 --approve              # (revisor) aprobar
gh pr merge 12 --squash --delete-branch   # fusionar a main y borrar la rama
```

Después de fusionar, **todos** hacen `git switch main && git pull` para traer lo nuevo.

### Mensajes de commit
Cortos y en presente: `Agrega prueba de Holm`, `Corrige nombre de la variable`. Un commit = un cambio con sentido.

---

## D. Tareas (Issues) desde la terminal
```bash
gh issue create --title "[Datos] Descargar IMERG de la zona de práctica" --label datos
gh issue list
gh issue view 5
```
En el PR escriban `Cierra #5` y la tarea se cierra sola al fusionar.

---

## E. Cuando algo sale mal

| Situación | Qué hacer |
| --- | --- |
| "Me equivoqué antes de hacer commit" | `git restore archivo.py` (descarta cambios de ese archivo) |
| "Hice commit en `main` por error" | **No hagan push.** Avisen al líder técnico; se arregla en 1 minuto |
| `git pull` dice que hay **conflicto** | Abran el archivo en VS Code: verán `<<<<<<<` y `>>>>>>>`. Elijan qué versión queda (VS Code ofrece botones), guarden, `git add archivo`, `git commit` |
| "Subí un archivo enorme o una clave" | Avisen **ya**. Una clave subida se considera robada: hay que revocarla, no basta con borrarla |
| "Estoy perdido/a" | `git status` casi siempre dice qué hacer. Pidan ayuda antes de probar comandos raros |

## F. Reglas del equipo

1. Nadie hace push directo a `main` (si GitHub no puede bloquearlo, lo acordamos nosotros).
2. Un PR lo aprueba **otra** persona.
3. Nunca se suben claves, contraseñas ni datos pesados (`.gitignore` ya excluye `.env` y `analisis/data/`).
4. `resultados.json` se genera con el script, no se edita a mano.
5. Ramas con nombre `area/tarea`: `datos/…`, `estadistica/…`, `web/…`, `ia/…`, `docs/…`.

---

## G. Dos repositorios: práctica y hackatón

| | **Este repo (práctica)** | **Repo del hackatón** |
| --- | --- | --- |
| Cuándo | Ahora → antes del evento | Se crea el día del evento |
| Datos | Sintéticos, sitios `SIM_xx` | Reales NASA, sitios reales de Costa Rica |
| Para qué | Aprender Git, ensayar el flujo y las pruebas | Entregar el proyecto |
| Visibilidad | Privado | Privado hasta la entrega; luego lo que pida el reto |

Al llegar al hackatón: **confirmar con la sede qué se permite llevar preparado**. Lo más seguro es llevar el *aprendizaje* (todos saben Git y el flujo) y crear el repo nuevo en blanco allá, trayendo solo lo que las reglas permitan.
