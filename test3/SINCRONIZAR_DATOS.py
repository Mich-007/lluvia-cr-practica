# -*- coding: utf-8 -*-
"""Regenera las copias .js de los datos editables, para que index.html funcione también con doble clic.

Se ejecuta SOLO si usted edita web/data/asistente.json o web/assets/places.json y abre la página SIN el servidor de
Python (por ejemplo, con doble clic en web/index.html). INICIAR_PHYLLOBYTES.py ya lo hace solo cada vez que arranca.
Uso: abrir en Spyder y pulsar F5, o ejecutar `python SINCRONIZAR_DATOS.py`.
"""
import json
import sys
from pathlib import Path


def sincronizar(raiz=None):
    """Valida los JSON y escribe web/data/asistente.json.js y web/assets/places-data.js. Devuelve una lista de avisos."""
    raiz = Path(raiz) if raiz else Path(__file__).resolve().parent
    web = raiz / 'web'
    avisos = []

    ruta = web / 'data' / 'asistente.json'
    try:
        datos = json.loads(ruta.read_text('utf-8'))
        nodos = datos.get('nodos', {})
        if datos.get('inicio') not in nodos:
            avisos.append(f"asistente.json: el nodo de inicio «{datos.get('inicio')}» no existe.")
        for nid, nodo in nodos.items():
            for op in nodo.get('opciones', []):
                if op.get('ir') and op['ir'] not in nodos:
                    avisos.append(f"asistente.json: en «{nid}» una opción apunta a «{op['ir']}», que no existe.")
        (web / 'data' / 'asistente.json.js').write_text(
            '/* COPIA AUTOMÁTICA de asistente.json: no la edite a mano (se regenera con INICIAR_PHYLLOBYTES.py o SINCRONIZAR_DATOS.py). */\n'
            'window.PHY_ASISTENTE_JSON = ' + json.dumps(datos, ensure_ascii=False, indent=1) + ';\n', 'utf-8')
    except FileNotFoundError:
        avisos.append('No se encontró web/data/asistente.json (el asistente usará su texto mínimo).')
    except json.JSONDecodeError as e:
        avisos.append(f'asistente.json tiene un error de escritura (línea {e.lineno}, columna {e.colno}): {e.msg}. Se conserva la copia anterior.')

    ruta = web / 'assets' / 'places.json'
    try:
        lugares = json.loads(ruta.read_text('utf-8'))
        (web / 'assets' / 'places-data.js').write_text(
            '/* Generado desde assets/places.json. Si edita places.json, ejecute SINCRONIZAR_DATOS.py. */\n'
            'window.PHY_PLACES = ' + json.dumps(lugares, ensure_ascii=False, separators=(',', ':')) + ';\n', 'utf-8')
    except FileNotFoundError:
        avisos.append('No se encontró web/assets/places.json.')
    except json.JSONDecodeError as e:
        avisos.append(f'places.json tiene un error de escritura (línea {e.lineno}): {e.msg}.')
    return avisos


if __name__ == '__main__':
    problemas = sincronizar()
    print('Datos sincronizados.' if not problemas else 'Sincronizado con avisos:')
    for p in problemas:
        print(' -', p)
    sys.exit(0)
