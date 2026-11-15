# -*- coding: utf-8 -*-
"""Genera Phyllobytes.html: la página completa en UN solo archivo (JS, CSS e imágenes dentro), que se abre con doble clic.
Solo lo necesita quien edite web/ y quiera regenerar el archivo. Requiere esbuild (npx esbuild) o ajustar ESBUILD.
Uso:  python herramientas/construir_html_unico.py
"""
import base64, re, subprocess, sys, shutil
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
WEB = RAIZ / 'web'
ESBUILD = shutil.which('esbuild') or '/opt/npm-tools/node_modules/.bin/esbuild'

def datauri(ruta):
    return 'data:image/png;base64,' + base64.b64encode((WEB / ruta).read_bytes()).decode()

js = subprocess.run([ESBUILD, str(WEB / 'js' / 'app.js'), '--bundle', '--format=iife', '--minify', '--target=es2020', '--legal-comments=none'],
                    check=True, capture_output=True, text=True).stdout
css = (WEB / 'css' / 'phyllobytes.css').read_text(encoding='utf-8')
css = re.sub(r'src: local\("Batangas"\)[^;]*;', 'src: local("Batangas");', css)   # sin archivos de fuente externos
html = (WEB / 'index.html').read_text(encoding='utf-8')
imagenes = {'assets/rana.png': datauri('assets/rana.png'), 'assets/wordmark-claro.png': datauri('assets/wordmark-claro.png')}
for ruta, uri in imagenes.items():
    html = html.replace(ruta, uri); js = js.replace(ruta, uri)
html = html.replace('<link rel="stylesheet" href="css/phyllobytes.css" />', '<style>\n' + css + '\n</style>')
html = re.sub(r'<script type="module"[^>]*></script>\s*<script nomodule>.*?</script>', lambda m: '<script>\n' + js.replace('</script', '<\\/script') + '\n</script>', html, flags=re.S)
assert 'type="module"' not in html and 'href="css/' not in html, 'quedaron referencias a archivos externos'
(RAIZ / 'Phyllobytes.html').write_text(html, encoding='utf-8')
print('Phyllobytes.html', round(len(html) / 1024), 'KB')
