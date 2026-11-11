#!/usr/bin/env bash
# Crea el repositorio PRIVADO en GitHub, sube este proyecto e invita al equipo.
# Lo corre UNA persona (el líder técnico), una sola vez.
#
# Uso:
#   bash scripts/crear_repo.sh MI-USUARIO-U-ORG NOMBRE-DEL-REPO usuario1 usuario2 usuario3 ...
# Ejemplo:
#   bash scripts/crear_repo.sh mi-equipo lluvia-cr-practica ana-gh luis-gh
#
# En Windows: usen "Git Bash" (se instala junto con Git).
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Uso: bash scripts/crear_repo.sh DUENO NOMBRE_REPO [colaborador1 colaborador2 ...]"
  exit 1
fi

DUENO="$1"; REPO="$2"; shift 2
COLABORADORES=("$@")

command -v git >/dev/null || { echo "✘ Falta instalar git"; exit 1; }
command -v gh  >/dev/null || { echo "✘ Falta instalar GitHub CLI: https://cli.github.com"; exit 1; }

if ! gh auth status >/dev/null 2>&1; then
  echo "→ No has iniciado sesión en GitHub. Se abrirá el asistente..."
  gh auth login
fi

# Ir a la raíz del proyecto (una carpeta arriba de scripts/)
cd "$(dirname "$0")/.."

if [ ! -d .git ]; then
  git init -b main
fi
git add .
git commit -m "Base inicial: análisis de práctica, web mínima y CI" || echo "(nada nuevo que guardar)"

echo "→ Creando repositorio privado $DUENO/$REPO y subiendo..."
gh repo create "$DUENO/$REPO" --private --source=. --remote=origin --push

for u in "${COLABORADORES[@]}"; do
  echo "→ Invitando a $u (permiso de escritura)"
  gh api -X PUT "repos/$DUENO/$REPO/collaborators/$u" -f permission=push >/dev/null \
    && echo "   ✔ invitación enviada" || echo "   ✘ no se pudo invitar a $u (revisa el nombre de usuario)"
done

echo "→ Creando etiquetas del equipo"
for e in "datos:0e8a16" "estadistica:5319e7" "web:1d76db" "ia:fbca04" "documentacion:c5def5"; do
  gh label create "${e%%:*}" --color "${e##*:}" --force >/dev/null 2>&1 || true
done

echo "→ Protegiendo la rama main (PR con 1 aprobación + CI 'build')"
if gh api -X PUT "repos/$DUENO/$REPO/branches/main/protection" --input - >/dev/null 2>&1 <<'JSON'
{
  "required_status_checks": { "strict": false, "contexts": ["build"] },
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 1 },
  "restrictions": null
}
JSON
then
  echo "   ✔ main protegida"
else
  echo "   ⚠ GitHub no permitió proteger la rama (en repos privados con plan gratis no está disponible)."
  echo "     No pasa nada: acuerden la regla 'nadie hace push directo a main' (ver docs/GUIA_GIT.md)."
fi

echo
echo "✔ Listo: https://github.com/$DUENO/$REPO"
echo "  Cada colaborador debe aceptar la invitación que le llega al correo."
