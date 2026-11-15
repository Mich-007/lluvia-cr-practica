# -*- coding: utf-8 -*-
"""Ajusta los textos de Phyllobytes (web/js/i18n.js y web/data/asistente.json) al atlas unificado.

Solo cambia lo geográfico (Costa Rica → los 7 países de Centroamérica), quita lo de la muestra de
demostración y del mapa de calor (ya no existen) y usa los nombres reales de botones y archivos.
No toca el mecanismo de idiomas: añade únicamente PHY.i18n.agregar() para registrar textos nuevos.
Se ejecutó una vez al crear la carpeta; se deja como registro reproducible de los cambios.
"""
import json
import re
from pathlib import Path

WEB = Path(__file__).resolve().parent / 'web'

NUEVOS = {
 'doc.title': ('Phyllobytes · Lluvia fuerte en Centroamérica', 'Phyllobytes · Heavy rain in Central America'),
 'doc.desc': ('Phyllobytes: atlas de lluvia fuerte en los 7 países de Centroamérica con datos de NASA, Copernicus y CHIRPS. Elige un punto del mapa y descubre cómo cambió la lluvia.',
              'Phyllobytes: an atlas of heavy rainfall in the 7 countries of Central America using NASA, Copernicus and CHIRPS data. Pick a spot on the map and see how rainfall has changed.'),
 'side.foot': ('Hecho para entender la lluvia de Centroamérica.', "Made to understand Central America's rain."),
 'srv.off': ('Sin servidor', 'No server'),
 'hero.kicker': ('Centroamérica · lluvia y datos de satélite', 'Central America · rain and satellite data'),
 'hero.h1': ('¿Cómo está cambiando la lluvia fuerte en Centroamérica?', 'How is heavy rain changing in Central America?'),
 'hero.lead': ('Phyllobytes convierte datos de satélites y modelos de NASA y Copernicus en mapas y gráficas fáciles de leer. Toca cualquier punto de Guatemala, Belice, El Salvador, Honduras, Nicaragua, Costa Rica o Panamá y descubre cuántos días de lluvia fuerte tuvo cada año, si esa cifra sube, baja o se mantiene, y si el cambio es significativo.',
               'Phyllobytes turns NASA and Copernicus satellite and model data into maps and charts that are easy to read. Tap anywhere in Guatemala, Belize, El Salvador, Honduras, Nicaragua, Costa Rica or Panama and find out how many heavy-rain days each year had, whether that number is rising, falling or steady, and whether the change is significant.'),
 'hero.k.prov': ('Países', 'Countries'),
 'hero.k.resv': ('Celdas de 5 a 55 km', '5–55 km cells'),
 'hero.visual_aria': ('Mapa de Centroamérica con sus 7 países', 'Map of Central America with its 7 countries'),
 'hero.note': ('Toca un país para ir al mapa.', 'Tap a country to go to the map.'),
 'sec.map.h': ('Mapa de Centroamérica', 'Map of Central America'),
 'aria.mapa': ('Mapa de Centroamérica. Toca un lugar para elegir un punto', 'Map of Central America. Tap a place to choose a point'),
 'pts.search': ('Buscar un lugar de Centroamérica', 'Search a place in Central America'),
 'pts.outside': ('Ese lugar está fuera de los 7 países de Centroamérica.', 'That spot is outside the 7 countries of Central America.'),
 'an.run': ('Analizar precipitación', 'Analyse rainfall'),
 'an.note.off': ('Sin servidor no se pueden descargar datos. Abre INICIAR_ATLAS.py en Spyder (F5) y recarga la página.',
                 'Without the server no data can be downloaded. Open INICIAR_ATLAS.py in Spyder (F5) and reload the page.'),
 'an.noserver': ('No encuentro el servidor. Abre INICIAR_ATLAS.py en Spyder, pulsa F5 y recarga esta página.',
                 "I can't find the server. Open INICIAR_ATLAS.py in Spyder, press F5 and reload this page."),
 'cmp.prov': ('País', 'Country'),
 'apr.intro.p': ('Es un atlas que muestra cómo ha llovido en los 7 países de Centroamérica. Usa datos de satélites de NASA y de modelos de NASA y Copernicus, y los convierte en mapas y gráficas. Su pregunta es sencilla: ¿hay más, menos o los mismos días de lluvia fuerte que antes, y alcanza la evidencia para afirmarlo?',
                 'It is an atlas that shows how it has rained in the 7 countries of Central America. It uses NASA satellite data and NASA and Copernicus model data, and turns them into maps and charts. Its question is simple: are there more, fewer or the same number of heavy-rain days as before, and is there enough evidence to say so?'),
 'apr.flow.1.d': ('La misión GPM de NASA y otros satélites estiman desde el espacio cuánta lluvia cae (producto IMERG). Los modelos MERRA-2 (NASA) y ERA5 (Copernicus) la reconstruyen, y CHIRPS combina satélite y estaciones.',
                  "NASA's GPM mission and other satellites estimate from space how much rain falls (the IMERG product). The MERRA-2 (NASA) and ERA5 (Copernicus) models reconstruct it, and CHIRPS combines satellite and stations."),
 'apr.flow.2.t': ('Se descarga por coordenada', 'It is downloaded by coordinate'),
 'apr.flow.2.d': ('NASA POWER, Open-Meteo (ERA5) y ClimateSERV (CHIRPS) dan la lluvia de cada día para cualquier punto. Cada punto representa la celda del producto, de unos 5 a 55 km.',
                  'NASA POWER, Open-Meteo (ERA5) and ClimateSERV (CHIRPS) give the rain of each day for any point. Each point represents the product cell, about 5 to 55 km wide.'),
 'apr.flow.3.t': ('El atlas la descarga y la revisa', 'The atlas downloads and checks it'),
 'apr.use.1': ('Toca cualquier lugar de los 7 países en el mapa: verás la celda del producto y si es apta. Pulsa «Añadir al análisis». Puedes tener hasta 6 puntos.',
               'Tap anywhere in the 7 countries on the map: you will see the product cell and whether it is suitable. Press “Add to analysis”. You can have up to 6 points.'),
 'apr.use.2': ('Elige la fuente y el período, y pulsa «Analizar precipitación» para traer la lluvia real de tus puntos.',
               'Choose the source and period, and press “Analyse rainfall” to bring in the real rainfall of your points.'),
 'apr.use.3': ('Mira primero el semáforo de confianza: resume si los datos de ese punto alcanzan para concluir.',
               'Look at the confidence traffic light first: it sums up whether that point\'s data is enough to draw conclusions.'),
 'apr.use.4': ('Explora las figuras, el panel y la verificación. Puedes descargar CSV, JSON o todos los TXT.',
               'Explore the figures, the dashboard and the verification. You can download CSV, JSON or all the TXT files.'),
 'apr.heat.h': ('Cómo leer el semáforo', 'How to read the traffic light'),
 'apr.heat.p1': ('Verde: los datos alcanzan y los productos coinciden. Amarillo: interpretar con reservas. Rojo: no sacar conclusiones de ese punto.',
                 'Green: the data is enough and the products agree. Yellow: interpret with caution. Red: do not draw conclusions from that point.'),
 'apr.heat.p2': ('El color mide la confianza en los datos, no si llueve más o menos. El mapa nunca rellena con colores las zonas sin puntos.',
                 'The colour measures confidence in the data, not whether it rains more or less. The map never fills areas without points with colour.'),
 'apr.g.extremo.d': ('Un día en que llovió más que el 95 % de los días lluviosos de ese lugar. Es «fuerte» para ese sitio, no para toda la región.',
                     "A day with more rain than 95% of that place's rainy days. It is “heavy” for that spot, not for the whole region."),
 'apr.g.celda.t': ('Celda del producto', 'Product cell'),
 'apr.g.celda.d': ('El dato de satélite o de modelo promedia un cuadro: ≈ 5,5 km en CHIRPS, 11 km en IMERG, 28 km en ERA5 y 55 km en MERRA-2. No mide una calle ni una finca.',
                   'Satellite or model data averages a square: ≈ 5.5 km in CHIRPS, 11 km in IMERG, 28 km in ERA5 and 55 km in MERRA-2. It does not measure a street or a farm.'),
 'apr.g.calor.t': ('Semáforo de confianza', 'Confidence traffic light'),
 'apr.g.calor.d': ('Un resumen en colores que indica si los datos de un punto alcanzan para sacar conclusiones.',
                   "A colour summary that tells whether a point's data is enough to draw conclusions."),
 'apr.g.demo.t': ('Robustez entre productos', 'Robustness across products'),
 'apr.g.demo.d': ('Repetir la tendencia con varios productos. Si todos coinciden en la dirección, la conclusión no depende de la fuente.',
                  'Repeating the trend with several products. If they all agree on the direction, the conclusion does not depend on the source.'),
 'no2': ('No describe un barrio o una finca: cada punto es la celda de un producto (de 5 a 55 km).',
         'It does not describe a neighbourhood or a farm: each point is a product cell (5 to 55 km).'),
 'foot.data': ('Datos: {f}.', 'Data: {f}.'),
 'res.foot': ('No hay una sola tendencia para toda la región: cada punto se lee por separado.',
              'There is no single trend for the whole region: each point is read on its own.'),
 'lect.pend': ('Este punto todavía no tiene datos. Pulsa «Analizar precipitación» para traer su lluvia.',
               'This point has no data yet. Press “Analyse rainfall” to bring in its rainfall.'),
 'fi.limits': ('Límites: celda del producto (5 a 55 km); no es pronóstico ni alerta.', 'Limits: product cell (5 to 55 km); not a forecast or an alert.'),
 'q.calor': ('¿Qué es el semáforo de confianza?', 'What is the confidence traffic light?'),
 'b.nosel': ('Aún no hay un punto seleccionado. Toca un lugar del mapa o busca un nombre, por ejemplo «Tegucigalpa».',
             'No point is selected yet. Tap a place on the map or search a name, for example “Tegucigalpa”.'),
 'b.sindatos': ('Todavía no hay puntos con datos. Elige puntos en el mapa y pulsa «Analizar precipitación».',
                'There are no points with data yet. Choose points on the map and press “Analyse rainfall”.'),
 'b.analizar.si': ('El servidor está conectado. Pulsa «Analizar precipitación»: descargará la lluvia diaria de cada punto desde la fuente elegida, calculará las tendencias y actualizará todo. Puede tardar unos minutos; verás el progreso y podrás descargar los archivos TXT.',
                   "The server is connected. Press “Analyse rainfall”: it will download each point's daily rainfall from the chosen source, calculate the trends and update everything. It can take a few minutes; you'll see the progress and can download the TXT files."),
 'b.analizar.no': ('Para analizar lluvia real necesitas el servidor de Python: abre INICIAR_ATLAS.py en Spyder, pulsa F5 y recarga esta página. Cuando la barra lateral diga «Servidor conectado», ya puedes pulsar «Analizar precipitación».',
                   'To analyse real rainfall you need the Python server: open INICIAR_ATLAS.py in Spyder, press F5 and reload this page. When the sidebar says “Server connected”, you can press “Analyse rainfall”.'),
 'b.demo.si': ('Aquí no hay datos inventados: todo resultado se descarga de las fuentes reales (o del CSV que usted importe) cuando pulsa «Analizar precipitación».',
               'There is no made-up data here: every result is downloaded from the real sources (or from the CSV you import) when you press “Analyse rainfall”.'),
 'b.demo.no': ('Sí: estos resultados se descargaron de la fuente elegida (NASA POWER, Copernicus vía Open-Meteo, ClimateSERV o su CSV) y se calcularon con métodos reproducibles. Cada punto es la celda del producto, así que describe la zona, no un lugar exacto. Revise también el semáforo de confianza.',
               'Yes: these results were downloaded from the chosen source (NASA POWER, Copernicus via Open-Meteo, ClimateSERV or your CSV) and calculated with reproducible methods. Each point is the product cell, so it describes the area, not an exact spot. Check the confidence traffic light too.'),
}
# Sustituciones de frases dentro de otros textos (ambos idiomas).
FRASES = [
 ('una celda de ~10 km', 'la celda del producto'), ('a ~10 km cell', 'the product cell'),
 ('«Analizar con datos NASA»', '«Analizar precipitación»'), ('“Analyse with NASA data”', '“Analyse rainfall”'),
 ('“Analyze with NASA data”', '“Analyse rainfall”'), ('INICIAR_PHYLLOBYTES.py', 'INICIAR_ATLAS.py'),
]


def poner(bloque, clave, valor):
    lit = json.dumps(valor, ensure_ascii=False)
    patron = re.compile(r'("' + re.escape(clave) + r'":\s*)"(?:[^"\\]|\\.)*"')
    if not patron.search(bloque):
        raise SystemExit(f'Clave no encontrada: {clave}')
    return patron.sub(lambda m: m.group(1) + lit, bloque, count=1)


def i18n():
    ruta = WEB / 'js' / 'i18n.js'
    s = ruta.read_text('utf-8')
    a, b = s.index('es: {'), s.index('en: {')
    fin = s.index('\nconst oyentes')
    es, en, resto = s[a:b], s[b:fin], s[fin:]
    for k, (ves, ven) in NUEVOS.items():
        es = poner(es, k, ves)
        en = poner(en, k, ven)
    for viejo, nuevo in FRASES:
        es, en = es.replace(viejo, nuevo), en.replace(viejo, nuevo)
    if 'agregar' not in resto:
        resto = resto.replace('PHY.i18n = { t, aplicar, setLang, getLang, locale, onLang, CLAVES };',
                              '// Registrar textos nuevos (atlas unificado) sin tocar el mecanismo: misma clave en es y en.\n'
                              'function agregar(es, en) { Object.assign(D.es, es); Object.assign(D.en, en); }\n'
                              'PHY.i18n = { t, aplicar, setLang, getLang, locale, onLang, CLAVES, agregar };')
    ruta.write_text(s[:a] + es + en + resto, 'utf-8')


ASIS = {
 'que_es': {'es': ['Phyllobytes es un atlas de lluvia de los 7 países de Centroamérica: Guatemala, Belice, El Salvador, Honduras, Nicaragua, Costa Rica y Panamá.',
                   'Usa datos de satélites (IMERG) y modelos (MERRA-2, ERA5) de NASA y Copernicus, y CHIRPS, para contar cuántos días de lluvia fuerte hubo cada año en los puntos que elijas, si esa cifra sube, baja o se mantiene, y si el cambio es significativo.'],
            'en': ['Phyllobytes is a rainfall atlas of the 7 countries of Central America: Guatemala, Belize, El Salvador, Honduras, Nicaragua, Costa Rica and Panama.',
                   'It uses satellite (IMERG) and model (MERRA-2, ERA5) data from NASA and Copernicus, plus CHIRPS, to count how many heavy-rain days there were each year at the points you choose, whether that number rises, falls or stays the same, and whether the change is significant.']},
 'resolucion': {'es': ['Cada producto entrega un valor por celda: ≈ 5,5 km en CHIRPS, 11 km en IMERG, 28 km en ERA5 y 55 km en MERRA-2. Cada punto representa la celda que lo contiene, es decir, el entorno de la zona. No describe un barrio, una finca ni una calle.',
                        'Al tocar el mapa verás la celda real, su tamaño y qué parte es tierra del país antes de añadirla.'],
                'en': ['Each product gives one value per cell: ≈ 5.5 km in CHIRPS, 11 km in IMERG, 28 km in ERA5 and 55 km in MERRA-2. Each point represents the cell that contains it, i.e. the surrounding area. It does not describe a neighbourhood, a farm or a street.',
                       'When you tap the map you will see the real cell, its size and how much of it is land of the country before adding it.']},
 'calor': {'es': ['El semáforo de confianza aparece al inicio de los resultados de cada punto.',
                  'Verde: hay años y cobertura suficientes, la celda es mayormente tierra y los productos coinciden. Amarillo: interpretar con reservas. Rojo: no sacar conclusiones de ese punto.',
                  'El color mide la confianza en los datos, no si llueve más o menos; eso lo dice la línea de tendencia que aparece debajo.'],
           'en': ['The confidence traffic light appears at the top of each point\'s results.',
                  'Green: there are enough years and coverage, the cell is mostly land and the products agree. Yellow: interpret with caution. Red: do not draw conclusions from that point.',
                  'The colour measures confidence in the data, not whether it rains more or less; the trend line below it says that.']},
}


def asistente():
    ruta = WEB / 'data' / 'asistente.json'
    d = json.loads(ruta.read_text('utf-8'))
    for nodo, msg in ASIS.items():
        d['nodos'][nodo]['mensaje'] = msg
    texto = json.dumps(d, ensure_ascii=False, indent=2)
    for viejo, nuevo in FRASES + [
        ('dentro de Costa Rica en el mapa y se añade un punto (hasta 8)', 'de los 7 países de Centroamérica en el mapa, revisa su celda y pulsa «Añadir al análisis» (hasta 6 puntos)'),
        ('inside Costa Rica on the map and a point is added (up to 8)', 'in the 7 countries of Central America on the map, check its cell and press “Add to analysis” (up to 6 points)'),
        ('«Mis puntos»', '«Lugares elegidos»'), ('“My points”', '“Chosen places”'),
        ('(la escala es ~10 km)', '(la escala es de 5 a 55 km)'), ('(the scale is ~10 km)', '(the scale is 5 to 55 km)'),
        ('¿Qué es el mapa de calor?', '¿Qué es el semáforo de confianza?'), ('What is the heat map?', 'What is the confidence traffic light?'),
    ]:
        texto = texto.replace(viejo, nuevo)
    ruta.write_text(texto + '\n', 'utf-8')
    restos = re.findall(r'[^"]*(?:Costa Rica|provinci|~10 km|hasta 8|up to 8|mapa de calor|heat map)[^"]*', texto)
    return restos


if __name__ == '__main__':
    i18n()
    for r in asistente():
        print('REVISAR asistente:', r[:160])
    print('Textos actualizados.')
