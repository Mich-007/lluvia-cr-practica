#!/bin/sh
# Abre Phyllobytes con el servidor de Python. Funciona desde cualquier carpeta.
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then python3 INICIAR_PHYLLOBYTES.py
elif command -v python >/dev/null 2>&1; then python INICIAR_PHYLLOBYTES.py
else echo "No encontre Python. No hace falta: abra Phyllobytes.html con doble clic."; fi
