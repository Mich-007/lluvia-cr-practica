# -*- coding: utf-8 -*-
"""Abre Phyllobytes con el servidor de Python (opcional; añade los archivos TXT).

Formas de usarlo (cualquiera sirve, no hay que instalar nada):
  • Spyder: abra este archivo y pulse F5.
  • Windows: doble clic en INICIAR_WINDOWS.bat
  • Mac / Linux: doble clic en INICIAR_MAC_LINUX.command (o: python3 INICIAR_PHYLLOBYTES.py)

Si solo quiere ver la página, no necesita nada de esto: abra Phyllobytes.html con doble clic.
"""
import sys
from pathlib import Path

try:
    RUTA = Path(__file__).resolve().parent
except NameError:            # algunos entornos ejecutan el texto sin __file__
    RUTA = Path.cwd()
if str(RUTA) not in sys.path:
    sys.path.insert(0, str(RUTA))

PUERTO = 8768  # si está ocupado, se usa el siguiente libre


def main():
    try:
        import backend
    except ModuleNotFoundError:
        print('No encuentro backend.py en:', RUTA)
        print('Descomprima TODA la carpeta del zip y abra este archivo desde dentro de ella.')
        return
    if 'spyder_kernels' in sys.modules or 'IPython' in sys.modules:
        backend.start_spyder(port=PUERTO)   # segundo plano: la consola sigue libre
    else:
        backend.serve(port=PUERTO)          # se queda abierto hasta Ctrl+C


if __name__ == '__main__':
    main()
