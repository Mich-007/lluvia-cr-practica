# -*- coding: utf-8 -*-
"""Abrir este archivo en Spyder y pulsar F5 (o ejecutar: python INICIAR_ATLAS.py).

Levanta el atlas unificado (interfaz Phyllobytes + análisis del atlas de Centroamérica) en el navegador.
Solo requiere Python 3.8+; no instala Flask, Node ni otros paquetes.
Para detener el servidor, reinicie el núcleo de Spyder (o Ctrl+C en una terminal).
"""
from pathlib import Path
import importlib.util
import sys

RUTA = Path(__file__).resolve().parent
PUERTO = 8780   # distinto del visor v6.3 (8768) para que ambos puedan abrirse a la vez
if str(RUTA) in sys.path:
    sys.path.remove(str(RUTA))
sys.path.insert(0, str(RUTA))
# Spyder puede conservar en memoria otra versión de «backend»: se carga con un nombre propio.
spec = importlib.util.spec_from_file_location('atlas_unificado_backend', RUTA / 'backend.py')
visor = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = visor
spec.loader.exec_module(visor)
if __name__ == '__main__':
    visor.start_spyder(port=PUERTO)
