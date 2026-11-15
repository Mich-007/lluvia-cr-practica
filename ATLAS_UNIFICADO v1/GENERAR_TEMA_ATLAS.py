# -*- coding: utf-8 -*-
"""Genera web/css/atlas-tema.css a partir de web/atlas/styles.css (el CSS del atlas v6.3).

Por qué existe: el atlas tiene ~230 reglas con colores claros fijos (#fff, grises, verdes oscuros).
En lugar de sobrescribirlas a mano, este script recorre cada regla y traduce cada color a la
paleta oscura de Phyllobytes (variables CSS de css/phyllobytes.css), según la propiedad:
  · fondos claros  → paneles translúcidos (var(--panel-2)) o un tinte suave del mismo tono;
  · textos oscuros → var(--texto) / var(--suave); textos de color oscuros → el mismo tono más claro;
  · bordes claros  → var(--borde).
También descarta las reglas de la ESTRUCTURA vieja (barra superior, columna lateral, pie), que
ahora pone la interfaz de Phyllobytes. Los colores de estado (verde/ámbar/rojo) conservan su tono.
Se vuelve a ejecutar sin riesgo: siempre parte del original.
"""
import colorsys
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
ORIGEN = RAIZ / 'web' / 'atlas' / 'styles.css'
DESTINO = RAIZ / 'web' / 'css' / 'atlas-tema.css'

# Reglas de estructura que reemplaza Phyllobytes (se descartan si TODOS sus selectores coinciden).
DESCARTAR = re.compile(r'^(\*|html|body(\.[\w-]+)?( .*)?|a|button|input|select|button,input,select|'
                       r'\.top( .*)?|\.identity( .*)?|\.brandmark|\.signal( .*)?|\.top-right( .*)?|'
                       r'\.site-nav( .*)?|\.layout|\.workspace|\.heading( .*)?|\.subhead|\.foot|'
                       r'\.nav-toggle(:hover)?|\.controls|\.side-title|\.date-capsule( .*)?)$')

NOMBRES = {'white': (255, 255, 255), 'black': (0, 0, 0)}
COLOR_RE = re.compile(r'#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)|\bwhite\b|\bblack\b')


def leer(c):
    c = c.strip()
    if c in NOMBRES:
        return (*NOMBRES[c], 1.0)
    if c.startswith('#'):
        h = c[1:]
        if len(h) == 3:
            h = ''.join(x * 2 for x in h)
        a = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
        return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a
    nums = [float(x) for x in re.findall(r'[\d.]+', c)]
    return int(nums[0]), int(nums[1]), int(nums[2]), (nums[3] if len(nums) > 3 else 1.0)


def lum(r, g, b):
    def f(v):
        v /= 255
        return v / 12.92 if v <= .03928 else ((v + .055) / 1.055) ** 2.4
    return .2126 * f(r) + .7152 * f(g) + .0722 * f(b)


def hsl(r, g, b):
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    return h * 360, s, l


def mapear(color, tipo):
    r, g, b, a = leer(color)
    if a < .5:              # sombras y velos semitransparentes: se conservan
        return color
    L = lum(r, g, b)
    h, s, l = hsl(r, g, b)
    gris = s < .22 or (l > .93) or (l < .07)
    if tipo == 'fondo':
        if L > .72:
            return 'var(--panel-2)' if gris else f'hsla({h:.0f},70%,58%,.16)'
        if L < .02 and gris:
            return 'var(--tinta)'
        return color
    if tipo == 'texto':
        if gris:
            if L < .30:
                return 'var(--texto)'
            if L < .75:
                return 'var(--suave)'
            return color
        if l < .55:                          # color saturado oscuro: el mismo tono, legible en fondo oscuro
            return f'hsl({h:.0f},{max(s, .55) * 100:.0f}%,70%)'
        return color
    if tipo == 'borde':
        if L > .55:
            return 'var(--borde)' if gris else f'hsla({h:.0f},65%,60%,.45)'
        if gris:
            return 'var(--borde-fuerte)'
        return f'hsl({h:.0f},{max(s, .5) * 100:.0f}%,62%)'
    return color


def tipo_de(prop):
    p = prop.strip().lower()
    if p.startswith('background') or p == 'fill':
        return 'fondo'
    if p in ('color', 'caret-color', 'accent-color') or p.startswith('text-decoration'):
        return 'texto'
    if p.startswith('border') or p.startswith('outline') or p == 'stroke' or p == 'column-rule':
        return 'borde'
    return None


def tematizar_cuerpo(cuerpo):
    partes = []
    for decl in cuerpo.split(';'):
        if ':' not in decl:
            partes.append(decl)
            continue
        prop, val = decl.split(':', 1)
        if prop.strip().lower() in ('font-size', 'font'):
            # px → rem: así la opción «letra grande» de accesibilidad (tamaño de <html>) también agranda el atlas.
            val = re.sub(r'(\d+(?:\.\d+)?)px', lambda m: f'{float(m.group(1)) / 16:.4g}rem', val)
        t = tipo_de(prop)
        if t:
            val = COLOR_RE.sub(lambda m: mapear(m.group(0), t), val)
        partes.append(prop + ':' + val)
    return ';'.join(partes)


def bloques(css):
    """Divide CSS en (prelude, cuerpo) de nivel superior, respetando llaves anidadas (@media)."""
    i, n, out = 0, len(css), []
    while i < n:
        j = css.find('{', i)
        if j < 0:
            break
        prelude = css[i:j]
        depth, k = 1, j + 1
        while k < n and depth:
            if css[k] == '{':
                depth += 1
            elif css[k] == '}':
                depth -= 1
            k += 1
        out.append((prelude.strip(), css[j + 1:k - 1]))
        i = k
    return out


def procesar(css, stats):
    out = []
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    for prelude, cuerpo in bloques(css):
        if prelude.startswith('@'):
            if prelude.startswith('@import') or prelude.startswith('@font-face'):
                continue
            interior = procesar(cuerpo, stats)
            if interior.strip():
                out.append(f'{prelude}{{{interior}}}')
            continue
        sels = [s.strip() for s in prelude.split(',') if s.strip()]
        quedan = [s for s in sels if not DESCARTAR.match(s)]
        if not quedan:
            stats['descartadas'] += 1
            continue
        if prelude.startswith(':root'):
            stats['descartadas'] += 1
            continue
        nuevo = tematizar_cuerpo(cuerpo)
        stats['cambiadas'] += nuevo != cuerpo
        out.append(f'{",".join(quedan)}{{{nuevo}}}')
    return '\n'.join(out)


def main():
    stats = {'descartadas': 0, 'cambiadas': 0}
    css = procesar(ORIGEN.read_text('utf-8'), stats)
    cabecera = ('/* GENERADO por GENERAR_TEMA_ATLAS.py desde web/atlas/styles.css: no editar a mano.\n'
                '   Componentes del atlas (formularios, figuras, tablas, semáforo…) con la paleta de Phyllobytes. */\n')
    DESTINO.write_text(cabecera + css + '\n', encoding='utf-8')
    print(f'{DESTINO.name}: {stats["cambiadas"]} reglas recoloreadas, {stats["descartadas"]} reglas de estructura descartadas.')


if __name__ == '__main__':
    main()
