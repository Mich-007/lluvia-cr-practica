# -*- coding: utf-8 -*-
"""Abrir este archivo en Spyder 6 y pulsar F5 (o ejecutar: python INICIAR_PHYLLOBYTES.py).

Levanta Phyllobytes en el navegador, sin instalar Flask, Node ni otros paquetes.
Para detener el servidor, reinicie el núcleo de Spyder (o pulse Ctrl+C si lo ejecutó en una terminal).
"""
from pathlib import Path
import sys

RUTA = Path(__file__).resolve().parent
if str(RUTA) not in sys.path:
    sys.path.insert(0, str(RUTA))
from backend import start_spyder, serve

PUERTO = 8768  # distinto de los visores anteriores (8766 y 8767)

if __name__ == '__main__':
    # En Spyder el servidor corre en segundo plano y la consola sigue libre.
    # Desde una terminal normal se mantiene abierto con serve().
    if 'spyder_kernels' in sys.modules or 'IPython' in sys.modules:
        start_spyder(port=PUERTO)
    else:
        serve(port=PUERTO)
