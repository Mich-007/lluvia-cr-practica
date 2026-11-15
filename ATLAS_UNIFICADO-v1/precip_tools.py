"""Importación, control de calidad y verificación de precipitación; biblioteca estándar."""
from __future__ import annotations
import calendar
import csv
import hashlib
import io
import json
import math
import re
import statistics
import unicodedata
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone

MISSING = {'', 'na', 'nan', 'null', 'none', '-999', '-9999', '-999.0', '-9999.0', '-9999.000000'}
DATE_NAMES = {'date', 'fecha', 'time', 'datetime', 'timestamp', 'fecha_hora', 'yyyy-mm-dd'}
PRECIP_NAMES = {'mm', 'precipitacion_mm', 'precipitacion', 'precipitation', 'rainfall', 'rain', 'prcp', 'prectotcorr', 'imerg_prectot'}

def noaa_measurement_issue(flag):
    """GHCN MFLAG: rechazar lluvia parcial o ceros sin observación."""
    if flag in ('A','C','E'):return 'acumulacion_menor_24h'
    if flag=='P':return 'faltante_presunto_cero'
    if flag=='I':return 'sin_observacion_precipitacion'
    return ''

def norm(s):
    return ''.join(c for c in unicodedata.normalize('NFKD', str(s).lower().strip()) if not unicodedata.combining(c))

def digest(s):
    return hashlib.sha256(s.encode('utf-8')).hexdigest()

def read_table(content):
    if not isinstance(content, str) or len(content)>15_000_000:
        raise ValueError('CSV ausente o mayor de 15 MB.')
    lines=content.lstrip('\ufeff').splitlines()
    for index,line in enumerate(lines[:120]):
        for delim in [',',';','\t']:
            cols=next(csv.reader([line],delimiter=delim))
            if len(cols)>1 and any(norm(c) in DATE_NAMES for c in cols):
                reader=csv.DictReader(io.StringIO('\n'.join(lines[index:])),delimiter=delim)
                if len(set(cols))!=len(cols):raise ValueError('Cabeceras repetidas: renombra las columnas antes de importar.')
                return cols, list(reader), index, delim
    raise ValueError('No se encontró una cabecera con fecha/date/time. Exporta una serie CSV con fecha y precipitación, no una tabla mensual ni un archivo NetCDF.')

def inspect_csv(content):
    cols,rows,skip,delimiter=read_table(content)
    dates=[c for c in cols if norm(c) in DATE_NAMES]
    precip=[c for c in cols if norm(c) in PRECIP_NAMES or any(t in norm(c) for t in ('precip','prcp','rainf','prectot'))]
    precip=[c for c in precip if not any(t in norm(c) for t in ('flag','quality','attributes','error','prob','retrieval'))]
    groups={c:sorted({str(r.get(c,'')) for r in rows})[:40] for c in cols if norm(c) in ('id','station','station_id','id_estacion','latitude','longitude','lat','lon')}
    return {'columns':cols,'date_column':dates[0] if dates else '', 'value_column':precip[0] if len(precip)==1 else '',
            'candidate_values':precip,'rows':len(rows),'skipped_header_lines':skip,'delimiter':delimiter,
            'groups':groups,'sample':rows[:3]}

def parse_stamp(s,fmt='iso'):
    s=str(s).strip()
    if fmt=='iso':
        if re.fullmatch(r'\d{8}',s):return datetime.strptime(s,'%Y%m%d')
        d=datetime.fromisoformat(s.replace('Z','+00:00'))
    else:
        formats={'dmy':'%d/%m/%Y','mdy':'%m/%d/%Y','mdy_dash':'%m-%d-%Y'}
        if fmt not in formats:raise ValueError('Formato de fecha desconocido.')
        d=datetime.strptime(s,formats[fmt])
    return d

def import_precip(content, options=None):
    opt=options or {}
    cols, rows, skipped, _=read_table(content)
    detected=inspect_csv(content)
    dc=opt.get('date_column') or detected['date_column']
    vc=opt.get('value_column') or detected['value_column']
    if dc not in cols or vc not in cols:raise ValueError('Elige la columna de fecha y una columna de precipitación del CSV.')
    if norm(vc)=='mdpr' or 'multiday' in norm(vc):raise ValueError('Un total de varios días no permite calcular extremos diarios.')
    if any(s in norm(vc) for s in ('chlor','ndvi','evi','soil','moist','water_level','height','elevation','tmax','tmin','temperature','snow','evap','swe')):
        raise ValueError('La columna seleccionada no representa precipitación. Selecciona lluvia (PRCP, precipitation o Rainf).')
    if not (norm(vc) in PRECIP_NAMES or any(t in norm(vc) for t in ('precip','prcp','rainf','prectot'))) and not opt.get('confirm_precipitation'):
        raise ValueError('Confirma que la columna elegida contiene precipitación antes de analizarla.')
    gc=opt.get('group_column',''); gv=str(opt.get('group_value',''))
    if gc:
        if gc not in cols or gv=='':raise ValueError('Selecciona el identificador de estación o punto que se importará.')
        rows=[r for r in rows if str(r.get(gc,''))==gv]
    for group in ('station','station_id','id_estacion','id','latitude','longitude','lat','lon'):
        c=next((c for c in cols if norm(c)==group),None)
        if c and len({r.get(c,'') for r in rows})>1:
            raise ValueError('El archivo contiene varios puntos o estaciones. Filtra un único identificador antes de analizarlo.')
    unit=opt.get('unit','mm'); temporal=opt.get('temporal','daily')
    if temporal not in ('daily','subdaily'):raise ValueError('Solo se admiten series diarias o subdiarias regulares.')
    hours=24.0 if temporal=='daily' else float(opt.get('interval_hours',3))
    if hours not in (0.5,1,3,6,12,24) or (temporal=='subdaily' and hours==24):raise ValueError('Intervalo inválido: use 0,5; 1; 3; 6 o 12 horas.')
    factors={'mm':1,'mm_day':hours/24,'mm_hour':hours,'kg_m2_s':hours*3600,'tenths_mm':0.1,'inch':25.4}
    if unit not in factors:raise ValueError('Unidad desconocida; no se aplicó conversión.')
    if unit in ('mm_day','mm_hour','kg_m2_s') and '_inst' in norm(vc):
        raise ValueError('Una tasa instantánea no representa el promedio del intervalo. Exporta precipitación acumulada o una tasa media (tavg).')
    offset=float(opt.get('utc_offset',0)); day_start=float(opt.get('day_start',0))
    if not(-12<=offset<=14 and 0<=day_start<24):raise ValueError('Zona horaria o inicio del día inválido.')
    position=opt.get('stamp_position','start')
    if position not in ('start','end'):raise ValueError('Indica si la marca temporal es inicio o fin del intervalo.')
    qc=Counter(); issues=[]; stamps={}; stamp_dates=defaultdict(set)
    qc_column=opt.get('quality_column','')
    if qc_column and qc_column not in cols:raise ValueError('Columna de calidad ausente.')
    allowed={x.strip() for x in str(opt.get('quality_accepted','0')).split(',')}
    for number,row in enumerate(rows, skipped+2):
        qc['rows']+=1
        try:dt=parse_stamp(row.get(dc,''),opt.get('date_format','iso'))
        except (ValueError,TypeError):
            qc['invalid_dates']+=1;issues.append({'fila':number,'fecha':row.get(dc,''),'motivo':'fecha_invalida','valor':row.get(vc,'')});continue
        if temporal=='subdaily':
            if dt.tzinfo:dt=dt.astimezone(timezone.utc).replace(tzinfo=None)
            dt=dt+timedelta(hours=offset-day_start)-(timedelta(hours=hours) if position=='end' else timedelta())
            minutes=dt.hour*60+dt.minute+dt.second/60
            if abs(minutes%(hours*60))>1e-6:raise ValueError('Los intervalos no se alinean con el inicio del día elegido; no se repartirán acumulados entre días.')
        else:
            stamp_dates[dt.date()].add(dt.time().isoformat())
            if len(stamp_dates[dt.date()])>1:raise ValueError('Hay varias horas por día: selecciona frecuencia subdiaria e indica el intervalo.')
            dt=datetime.combine(dt.date(),datetime.min.time())
        raw=str(row.get(vc,'')).strip(); val=None; reason=''
        if norm(raw) in MISSING:qc['missing_values']+=1
        elif norm(raw) in ('t','trace','traza'):
            val=0.0;qc['trace_as_zero']+=1
        else:
            try:
                val=float(raw.replace(',','.'))
                if not math.isfinite(val):raise ValueError()
                if val<0:reason='negativo';val=None
                else:val*=factors[unit]
            except (ValueError,OverflowError):reason='no_numerico';val=None
        flag=str(row.get(qc_column,'')).strip() if qc_column else ''
        # CSV CDO: MFLAG,QFLAG,SFLAG; QFLAG no vacío implica rechazo.
        ac=next((c for c in cols if norm(c)==norm(vc)+'_attributes'),None)
        if ac:
            attrs=str(row.get(ac,'')).split(',')
            if len(attrs)>1 and attrs[1].strip():reason='bandera_calidad';val=None
            measurement_issue=noaa_measurement_issue(attrs[0].strip()) if attrs else ''
            if measurement_issue:reason=measurement_issue;val=None
            if attrs and attrs[0].strip()=='T' and not reason and val is not None:
                val=0.0;qc['trace_as_zero']+=1
        if qc_column and flag not in allowed:reason='bandera_calidad';val=None
        if reason:
            qc[reason]+=1;issues.append({'fila':number,'fecha':dt.isoformat(),'motivo':reason,'valor':raw})
        if dt in stamps:
            if stamps[dt]==val:qc['duplicates_identical']+=1
            else:
                qc['duplicates_conflicting']+=1;stamps[dt]=None
                issues.append({'fila':number,'fecha':dt.isoformat(),'motivo':'duplicado_conflictivo','valor':raw})
        else:stamps[dt]=val
    if not stamps:raise ValueError('No hay fechas interpretables en el CSV.')
    days=defaultdict(list)
    for dt,val in stamps.items():days[dt.date()].append(val)
    expected=int(24/hours);data={}
    for d,values in days.items():
        complete=len(values)==expected and all(v is not None for v in values)
        data[d.isoformat()]=round(sum(values),8) if complete else None
        if temporal=='subdaily' and not complete:qc['incomplete_subdaily_days']+=1
    sorted_days=sorted(days)
    if temporal=='daily' and len(sorted_days)>=6:
        gaps=[(b-a).days for a,b in zip(sorted_days,sorted_days[1:])]
        if statistics.median(gaps)>=27:raise ValueError('La serie parece mensual o más espaciada; no se puede usar para extremos diarios.')
    meta={'input_sha256':digest(content),'date_column':dc,'value_column':vc,'input_unit':unit,'output_unit':'mm/día',
          'temporal':temporal,'interval_hours':hours,'utc_offset':offset,'day_start':day_start,'stamp_position':position,
          'conversion_factor_per_record':factors[unit],'product':str(opt.get('product','No declarado'))[:200],
          'counts':dict(qc),'issues':issues,'quality_column':qc_column or (ac if 'ac' in locals() else None),
          'day_definition':opt.get('day_definition','No declarado'),'skipped_header_lines':skipped}
    return data, meta

def quality_audit(data,y0,y1,r0,r1,meta=None,suspect_mm=500):
    meta=meta or {};suspect_mm=float(suspect_mm)
    if not math.isfinite(suspect_mm) or suspect_mm<=0:raise ValueError('El umbral de revisión debe ser positivo.')
    d=date(y0,1,1);end=date(y1,12,31);valid=[];missing=0;longest=0;run=0;yearcounts=Counter();suspects=[]
    while d<=end:
        v=data.get(d.isoformat())
        if v is None or not math.isfinite(v) or v<0:missing+=1;run+=1;longest=max(longest,run)
        else:
            valid.append((d.isoformat(),v));yearcounts[d.year]+=1;run=0
            if v>suspect_mm:suspects.append({'fecha':d.isoformat(),'lluvia_mm':v,'motivo':'supera_umbral_revision_no_excluido'})
        d+=timedelta(days=1)
    annual=[{'year':y,'valid_days':yearcounts[y],'expected_days':366 if calendar.isleap(y) else 365,
             'coverage_pct':round(100*yearcounts[y]/(366 if calendar.isleap(y) else 365),2)} for y in range(y0,y1+1)]
    complete=sum(r['valid_days']==r['expected_days'] for r in annual)
    warnings=[];counts=meta.get('counts',{})
    if missing:warnings.append(f'{missing} días ausentes o rechazados; no se rellenan ni se anualizan.')
    if complete<10:warnings.append('Menos de 10 años completos: no se calculan tendencias.')
    elif complete<20:warnings.append('Serie menor de 20 años completos: tendencia exploratoria sensible al período elegido.')
    if suspects:warnings.append(f'{len(suspects)} días superan {suspect_mm:g} mm; se conservan y requieren revisión contra la fuente.')
    if counts.get('duplicates_conflicting'):warnings.append('Duplicados con valores diferentes excluidos de los cálculos.')
    if counts.get('invalid_dates'):warnings.append('Filas con fechas inválidas omitidas; consultar incidencias.')
    return {'status':'revisar' if warnings else 'controles_formales_ok','valid_days':len(valid),'missing_days':missing,
            'complete_years':complete,'coverage_pct':round(100*len(valid)/(len(valid)+missing),2),'longest_gap_days':longest,
            'reference_complete_years':sum(r['valid_days']==r['expected_days'] for r in annual if r0<=r['year']<=r1),
            'suspicious_count':len(suspects),'suspect_threshold_mm':suspect_mm,'suspicious_days':suspects,
            'yearly':annual,'warnings':warnings,'import':meta,'normalized_sha256':digest(json.dumps(valid,separators=(',',':'))),
            'note':'Control de estructura y consistencia; no certifica exactitud ni homogeneidad climática.'}

LAG_CHOICES=(-2,-1,0,1,2)

def _shift_iso(d,k):
    return (date.fromisoformat(d)+timedelta(days=k)).isoformat()

def _lag_pairs(product,reference,k):
    """Pares (fecha de la referencia, producto[d+k], referencia[d]).

    k = −1: el valor que la referencia anota el día d se compara con el del
    producto del día d − 1. Es el caso de NOAA GHCN-Daily con fuente GSOD
    (SFLAG «S»), cuya lluvia de 24 h se reporta a las 12 UTC y queda fechada
    al día en que termina la acumulación, mientras NASA POWER usa el día UTC.
    """
    out=[]
    for d in sorted(reference):
        r=reference[d]
        if r is None:continue
        p=product.get(_shift_iso(d,k))
        if p is not None:out.append((d,p,r))
    return out

def _pearson_pairs(pairs):
    if len(pairs)<3:return None
    x=[p for _,p,_ in pairs];y=[r for _,_,r in pairs];mx=statistics.mean(x);my=statistics.mean(y)
    den=math.sqrt(sum((a-mx)**2 for a in x)*sum((b-my)**2 for b in y))
    return sum((a-mx)*(b-my) for a,b in zip(x,y))/den if den else None

def lag_diagnostic(product,reference):
    """Correlación de Pearson para desfases −2…+2 días (diagnóstico, no corrige nada)."""
    rows=[]
    for k in LAG_CHOICES:
        pr=_lag_pairs(product,reference,k);r=_pearson_pairs(pr)
        rows.append({'lag_days':k,'n':len(pr),'pearson_r':round(r,4) if r is not None else None})
    valid=[x for x in rows if x['pearson_r'] is not None and x['n']>=30]
    best=max(valid,key=lambda x:x['pearson_r'])['lag_days'] if valid else None
    return rows,best

def compare_series(product,reference,thresholds,aligned=False,lag_days=0):
    """Compara producto y referencia por fecha, con desfase opcional y declarado.

    lag_days puede ser un entero de −2 a 2 o 'auto' (elige el desfase de
    mayor correlación; exploratorio y se informa como tal).
    """
    diag,best=lag_diagnostic(product,reference)
    auto=lag_days=='auto'
    if auto:lag=best if best is not None else 0
    else:
        lag=int(lag_days)
        if lag not in LAG_CHOICES:raise ValueError('El desfase de la referencia debe estar entre −2 y 2 días.')
    pairs=_lag_pairs(product,reference,lag)
    zero=next(x for x in diag if x['lag_days']==0)
    lag_info={'applied_lag_days':lag,'mode':'auto' if auto else 'declared','best_lag_days':best,'diagnostic':diag}
    warn=''
    if best is not None and best!=lag:
        bx=next(x for x in diag if x['lag_days']==best);ax=next(x for x in diag if x['lag_days']==lag)
        if bx['pearson_r'] is not None and ax['pearson_r'] is not None and bx['pearson_r']-ax['pearson_r']>=0.1:
            warn=(f' Aviso: con desfase {best:+d} d la correlación es {bx["pearson_r"]:.2f} frente a {ax["pearson_r"]:.2f} con el '
                  f'desfase aplicado ({lag:+d} d); revisa la definición del día de la referencia.')
    output={'status':'pending_alignment','overlapping_days':len(pairs),'n':len(pairs),'metrics':None,'events':[], 'pairs':[],
            'lag':lag_info,'n_same_date':zero['n'],
            'note':'Confirma que ambas series usan la misma ventana diaria (o declara el desfase); no se desplazan fechas sin declararlo.'+warn}
    if not aligned:return output
    if len(pairs)<30:
        output['status']='insufficient_pairs';output['note']='Se necesitan al menos 30 pares diarios válidos coincidentes.';return output
    x=[p for _,p,r in pairs];y=[r for _,p,r in pairs];n=len(x)
    dx=[a-b for a,b in zip(x,y)];mx=statistics.mean(x);my=statistics.mean(y)
    den=math.sqrt(sum((a-mx)**2 for a in x)*sum((b-my)**2 for b in y))
    metrics={'bias_mm':statistics.mean(dx),'mae_mm':statistics.mean(abs(v) for v in dx),'rmse_mm':math.sqrt(statistics.mean(v*v for v in dx)),
             'pbias_pct':100*sum(dx)/sum(y) if sum(y)>0 else None,
             'pearson_r':sum((a-mx)*(b-my) for a,b in zip(x,y))/den if den else None}
    events=[]
    for label,t,strict in thresholds:
        if t is None:continue
        hit=miss=false=correct=0
        for a,b in zip(x,y):
            pe=a>t if strict else a>=t;re=b>t if strict else b>=t
            hit+=pe and re;miss+=(not pe) and re;false+=pe and (not re);correct+=(not pe) and (not re)
        events.append({'threshold':label,'threshold_mm':t,'hits':hit,'misses':miss,'false_alarms':false,'correct_negatives':correct,
                       'pod':hit/(hit+miss) if hit+miss else None,'far':false/(hit+false) if hit+false else None,
                       'csi':hit/(hit+miss+false) if hit+miss+false else None})
    output.update(status='compared',metrics={k:round(v,5) if v is not None else None for k,v in metrics.items()},events=events,
                  pairs=[{'date':d,'product_date':_shift_iso(d,lag),'product_mm':p,'reference_mm':r,'error_mm':round(p-r,6)} for d,p,r in pairs],
                  note=('Sesgo = producto − referencia. PBIAS usa la suma de la referencia. Una coincidencia no demuestra independencia de las fuentes ni ausencia de sesgo.'
                        +(f' Desfase aplicado: referencia del día d frente a producto del día d {lag:+d}'+(' (elegido automáticamente por máxima correlación: exploratorio).' if auto else ' (declarado por el usuario).') if lag else '')
                        +warn))
    return output
