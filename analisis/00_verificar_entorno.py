"""Paso 0: comprueba que tengan todo instalado."""
import importlib
import sys

PAQUETES = ["numpy", "pandas", "scipy", "xarray", "netCDF4", "matplotlib", "pymannkendall", "pytest"]

print(f"Python {sys.version.split()[0]}")
if sys.version_info < (3, 10):
    print("✘ Se necesita Python 3.10 o más nuevo")
    sys.exit(1)

faltan = []
for nombre in PAQUETES:
    try:
        importlib.import_module(nombre)
        print(f"✔ {nombre}")
    except ImportError:
        print(f"✘ {nombre}  (falta)")
        faltan.append(nombre)

if faltan:
    print("\nInstalen con:  pip install -r requirements.txt")
    sys.exit(1)
print("\n✔ Todo listo")
