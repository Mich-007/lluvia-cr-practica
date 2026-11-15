# -*- coding: utf-8 -*-
"""Verificación local de CSV desde Spyder, con el mismo cálculo del visor.
Editar las variables siguientes y pulsar F5. No descarga datos.
"""
from pathlib import Path
import json
from datetime import datetime
from precip_tools import import_precip, quality_audit, compare_series

ARCHIVO_CSV = r''             # Ruta del producto/estación que se desea revisar
REFERENCIA_CSV = r''          # Opcional: estación u otra fuente independiente
ANIO_INICIAL = 2001
ANIO_FINAL = 2024
REFERENCIA_INICIAL = 2001
REFERENCIA_FINAL = 2020
MISMA_VENTANA_DIARIA = False  # True solo después de comprobar horarios de acumulación
UMBRAL_REVISION_MM = 500      # Se señala; no se elimina automáticamente
OPCIONES = {'unit':'mm','temporal':'daily','date_format':'iso',
            'product':'Especificar producto y versión','day_definition':'Especificar horario'}
OPCIONES_REFERENCIA = {'unit':'mm','temporal':'daily','date_format':'iso',
                       'product':'Estación de referencia','day_definition':'Especificar horario'}
SALIDA = Path.home()/'Downloads'/'Precipitacion_NASA_Comparador_CA'/'verificacion_local'


def verificar():
    if not ARCHIVO_CSV:
        print('Escribe ARCHIVO_CSV en este script, o utiliza la sección Calidad y verificación del visor.')
        return
    content=Path(ARCHIVO_CSV).read_text(encoding='utf-8-sig')
    data,meta=import_precip(content,OPCIONES)
    report={'quality':quality_audit(data,ANIO_INICIAL,ANIO_FINAL,REFERENCIA_INICIAL,REFERENCIA_FINAL,meta,UMBRAL_REVISION_MM)}
    if REFERENCIA_CSV:
        ref,refmeta=import_precip(Path(REFERENCIA_CSV).read_text(encoding='utf-8-sig'),OPCIONES_REFERENCIA)
        report['reference_quality']=quality_audit(ref,ANIO_INICIAL,ANIO_FINAL,REFERENCIA_INICIAL,REFERENCIA_FINAL,refmeta,UMBRAL_REVISION_MM)
        first=f'{ANIO_INICIAL}-01-01';last=f'{ANIO_FINAL}-12-31'
        report['verification']=compare_series({d:v for d,v in data.items() if first<=d<=last},
            {d:v for d,v in ref.items() if first<=d<=last},[(f'>= {t} mm',t,False) for t in (1,50.8,76.2,101.6,127)],MISMA_VENTANA_DIARIA)
    SALIDA.mkdir(parents=True,exist_ok=True)
    path=SALIDA/('verificacion_'+datetime.now().strftime('%Y%m%d_%H%M%S')+'.json')
    path.write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')
    print('Informe:',path)
    print('Cobertura:',report['quality']['coverage_pct'],'%; años completos:',report['quality']['complete_years'])
    for note in report['quality']['warnings']:print('-',note)
    if report.get('verification',{}).get('metrics'):print(report['verification']['metrics'])

if __name__=='__main__':verificar()
