# -*- coding: utf-8 -*-
"""Abrir este archivo en Spyder y pulsar F5 (o ejecutar: python INICIAR_PHYLLOBYTES.py).

Levanta Phyllobytes en el navegador, sin instalar Flask, Node ni otros paquetes (solo Python 3.8 o superior).
Funciona desde cualquier carpeta y aunque el archivo se ejecute por «Ejecutar selección» o desde IPython.
Para detener el servidor, reinicie el núcleo de Spyder (o pulse Ctrl+C si lo ejecutó en una terminal).

Si algo falla, el programa explica qué falta en lugar de cerrarse con un error críptico.
"""
import importlib.util
import os
import sys
import webbrowser
from pathlib import Path

PUERTO = 8768  # si está ocupado se usa el siguiente libre


def carpeta_proyecto():
    """Carpeta que contiene backend.py y web/. Se prueba: este archivo, la carpeta actual y sus vecinas."""
    candidatos = []
    try:
        candidatos.append(Path(__file__).resolve().parent)
    except NameError:  # ejecutado por «Ejecutar selección» / %run sin __file__
        pass
    candidatos += [Path.cwd(), Path.cwd() / 'PHYLLOBYTES_CR', Path.cwd().parent]
    for c in candidatos:
        if (c / 'backend.py').is_file() and (c / 'web' / 'index.html').is_file():
            return c
    return None


def cargar(nombre, ruta):
    """Importa un .py por su ruta con un nombre propio: así no choca con otro módulo llamado «backend» ya instalado."""
    spec = importlib.util.spec_from_file_location(nombre, str(ruta))
    modulo = importlib.util.module_from_spec(spec)
    sys.modules[nombre] = modulo
    spec.loader.exec_module(modulo)
    return modulo


def principal():
    raiz = carpeta_proyecto()
    if raiz is None:
        print('No encuentro los archivos de Phyllobytes (backend.py y la carpeta web).\n'
              '- Descomprima el .zip COMPLETO (no abra los archivos desde dentro del zip).\n'
              '- Ejecute INICIAR_PHYLLOBYTES.py estando dentro de la carpeta PHYLLOBYTES_CR.')
        return
    os.chdir(raiz)
    if sys.version_info < (3, 8):
        print('Se necesita Python 3.8 o superior. Versión actual:', sys.version.split()[0])
        return
    # Regenera las copias .js de web/data/asistente.json y places.json (para abrir index.html con doble clic)
    try:
        sync = cargar('phyllobytes_sync', raiz / 'SINCRONIZAR_DATOS.py')
        for aviso in sync.sincronizar(raiz):
            print('AVISO:', aviso)
    except Exception as e:  # nunca debe impedir abrir la página
        print('AVISO: no se pudieron sincronizar los datos:', e)
    try:
        backend = cargar('phyllobytes_backend', raiz / 'backend.py')
    except Exception as e:
        # Sin el servidor de Python la página igual funciona en modo demostración.
        print('No se pudo cargar el servidor de Python (', e, ').\nSe abre la página en modo demostración (sin datos de NASA).')
        webbrowser.open((raiz / 'web' / 'index.html').as_uri())
        return
    if 'spyder_kernels' in sys.modules or 'IPython' in sys.modules:
        backend.start_spyder(port=PUERTO)   # en Spyder el servidor corre en segundo plano y la consola sigue libre
    else:
        backend.serve(port=PUERTO)          # en una terminal normal se mantiene abierto


if __name__ == '__main__':
    principal()
