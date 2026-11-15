'use strict';
const IMPORT_SOURCES=['csv','giovanni','hydrology','chirps'];
const inputCache=new Map();
const SOURCE_HINTS={era5:'Descarga automática de ERA5, el reanálisis de Copernicus/ECMWF (modelo + observaciones), independiente de la NASA. Celda de 0,25° (≈ 28 km), día UTC, desde 1940. Servicio Open-Meteo sin clave para uso no comercial; datos CC-BY 4.0. Una consulta tarda unos segundos.',chirps_auto:'Descarga automática de CHIRPS v2.0 diario desde ClimateSERV (NASA/SERVIR), sin cuenta: celda terrestre de 0,05° (≈ 5,5 km) desde 1981. CHIRPS combina satélite infrarrojo y estaciones, así que no es independiente de las estaciones que incorpora. La PRIMERA descarga es lenta: el servicio procesa un año cada ~20 s (unos 3–4 min para 24 años por punto); después queda en caché y es inmediata. Vea el avance en la barra de progreso.',gpm:'Descarga automática de IMERG en NASA POWER: precipitación diaria UTC en mm para Centroamérica. Los datos recientes pueden combinar Late y Final.',merra2:'Descarga automática de PRECTOTCORR: precipitación diaria de reanálisis MERRA-2, en mm. No es una estación ni una observación satelital pura.',giovanni:'No se descarga automáticamente: Giovanni exige iniciar sesión en NASA Earthdata. Genera allí la serie, expórtala en CSV y cárgala aquí (una por punto), escribiendo el nombre y versión del producto. Importa un CSV de precipitación IMERG, TRMM o GLDAS exportado desde Giovanni. Puede ser una celda o un promedio de área; decláralo en el producto.',hydrology:'No se descarga automáticamente: el servicio de GES DISC exige iniciar sesión en NASA Earthdata. Exporta la serie en CSV y cárgala aquí, escribiendo el nombre y versión del producto. Importa precipitación de GLDAS con cobertura en Centroamérica. Para tasas de 3 h usa kg/m²/s y frecuencia subdiaria. Declara si la marca es inicio o fin; consulta los metadatos.',chirps:'Importa una serie diaria de CHIRPS. Especifica v2 o v3 y, para v3, la variante sat o rnl. Revisa la ventana diaria y la posible dependencia de IMERG/estaciones.',noaa:'Descarga PRCP de estaciones GHCN-Daily de los siete países de Centroamérica. El período disponible depende de la estación; no se interpolan ubicaciones sin estación.',csv:'Importa precipitación de una estación local o de un producto con cobertura centroamericana. Declara la variable, unidades y origen.'};
function cacheKey(i,role){const p=state.points[i];return role+':'+p.lat.toFixed(6)+','+p.lon.toFixed(6)}
function inputId(i,role){return role+i}
function cacheItem(i,role){const key=cacheKey(i,role);if(!inputCache.has(key))inputCache.set(key,{options:{},columns:[],groups:{}});return inputCache.get(key)}
function opts(values,selected){return values.map(v=>{const [value,label]=Array.isArray(v)?v:[v,v];return `<option value="${escapeHTML(value)}" ${String(value)===String(selected)?'selected':''}>${escapeHTML(label)}</option>`}).join('')}
function selectField(id,name,label,values,selected){return `<label>${label}<select id="${id}_${name}">${opts(values,selected)}</select></label>`}
function readImportOptions(id){
 const value=n=>$(id+'_'+n)?.value??'';
 return {product:value('product'),date_column:value('date'),value_column:value('value'),unit:value('unit'),temporal:value('temporal'),interval_hours:+value('interval')||3,
 date_format:value('dateformat'),stamp_position:value('position'),utc_offset:+value('offset')||0,day_start:+value('daystart')||0,day_definition:value('daydef'),
 group_column:value('group'),group_value:value('groupvalue'),quality_column:value('quality'),quality_accepted:value('accepted'),confirm_precipitation:!!$(id+'_confirm')?.checked};
}
function preserveInputCards(){
 document.querySelectorAll('[data-cachekey]').forEach(node=>{
  const item=inputCache.get(node.dataset.cachekey),id=node.dataset.input;if(!item)return;
  if($(id+'_product'))item.options=readImportOptions(id);
  if($(id+'_station'))item.station=$(id+'_station').value;
 });
}
function fileCard(i,role){
 const id=inputId(i,role),c=cacheItem(i,role),o=c.options,cols=[['','Seleccionar…'],...c.columns];
 return `<details class="import-card" data-input="${id}" data-cachekey="${cacheKey(i,role)}" open><summary>${escapeHTML(state.points[i].name)}</summary><input type="file" id="${id}_file" accept=".csv,.txt,text/csv,text/plain"><p class="hint" id="${id}_filename">${escapeHTML(c.filename||'Selecciona el CSV de precipitación.')}</p>
 <div class="import-fields"><label>Producto, versión y punto/área<input id="${id}_product" value="${escapeHTML(o.product||'')}" placeholder="Ej.: GLDAS Noah 2.1, punto"></label>
 ${selectField(id,'date','Columna de fecha',cols,o.date_column)}${selectField(id,'value','Columna de precipitación',cols,o.value_column)}
 ${selectField(id,'unit','Unidad del archivo',[['mm','mm acumulados por registro'],['mm_day','mm/día · tasa media'],['mm_hour','mm/h · tasa media'],['kg_m2_s','kg/m²/s · tasa media'],['tenths_mm','Décimas de mm'],['inch','Pulgadas acumuladas']],o.unit||'mm')}
 ${selectField(id,'temporal','Frecuencia',[['daily','Diaria'],['subdaily','Subdiaria regular']],o.temporal||'daily')}
 ${selectField(id,'dateformat','Formato de fecha',[['iso','ISO: AAAA-MM-DD (hora opcional)'],['dmy','DD/MM/AAAA'],['mdy','MM/DD/AAAA'],['mdy_dash','MM-DD-AAAA']],o.date_format||'iso')}
 <label>Definición del día / cierre<input id="${id}_daydef" value="${escapeHTML(o.day_definition||'')}" placeholder="Ej.: 00–24 UTC; 07–07 local"></label>
 <details><summary>Intervalos subdiarios y calidad</summary>
 ${selectField(id,'interval','Duración de cada intervalo (horas)',[0.5,1,3,6,12],o.interval_hours||3)}
 ${selectField(id,'position','La hora indica',[['start','Inicio del intervalo'],['end','Fin del intervalo']],o.stamp_position||'start')}
 <label>Desfase UTC de salida (h)<input id="${id}_offset" type="number" min="-12" max="14" step="0.5" value="${o.utc_offset||0}"></label><label>Hora de inicio del día (salida)<input id="${id}_daystart" type="number" min="0" max="23" value="${o.day_start||0}"></label><p class="hint">Se aplica solo a datos subdiarios. Horas sin zona explícita se interpretan como UTC. No se acepta un intervalo que cruce el cierre diario.</p>
 ${selectField(id,'group','Columna de identificador (varios puntos)',[['','Un solo punto'],...Object.keys(c.groups)],o.group_column)}<label>Valor de identificador a conservar<input id="${id}_groupvalue" value="${escapeHTML(o.group_value||'')}" placeholder="ID exacto del punto"></label>
 ${selectField(id,'quality','Columna de bandera de calidad',[['','Sin bandera adicional'],...c.columns],o.quality_column)}<label>Valores de calidad aceptados (separar por coma)<input id="${id}_accepted" value="${escapeHTML(o.quality_accepted??'0')}"></label></details>
 <label class="alignment"><input id="${id}_confirm" type="checkbox" ${o.confirm_precipitation?'checked':''}> Confirmo que la columna es precipitación y que seleccioné su unidad correcta.</label></div></details>`;
}
function stationCard(i,role){const id=inputId(i,role),c=cacheItem(i,role);return `<div class="station-card" data-input="${id}" data-cachekey="${cacheKey(i,role)}"><strong>${escapeHTML(state.points[i].name)}</strong><label>ID GHCN (11 caracteres)<input id="${id}_station" maxlength="11" value="${escapeHTML(c.station||'')}" placeholder="Selecciona una estación cercana"></label><button class="line-btn" type="button" id="${id}_search">Buscar estaciones cercanas</button><div id="${id}_stations"></div></div>`}
function renderInputCards(){
 preserveInputCards();
 const src=$('source').value,ref=$('referenceSource').value;
 $('csvFiles').innerHTML=IMPORT_SOURCES.includes(src)?state.points.map((p,i)=>fileCard(i,'target')).join(''):'';
 $('stationInputs').innerHTML=src==='noaa'?state.points.map((p,i)=>stationCard(i,'target')).join(''):'';
 $('referenceInputs').innerHTML=ref==='csv'?state.points.map((p,i)=>fileCard(i,'ref')).join(''):ref==='noaa'?state.points.map((p,i)=>stationCard(i,'ref')).join(''):'';
 state.points.forEach((p,i)=>['target','ref'].forEach(role=>{
  const id=inputId(i,role),item=cacheItem(i,role);
  if($(id+'_file'))$(id+'_file').onchange=()=>{
   const file=$(id+'_file').files[0];if(!file)return;
   item.options=readImportOptions(id);
   item.loading=(async()=>{
    item.content=await file.text();item.filename=file.name;
    const resp=await fetch('/api/inspect_csv',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:item.content})});
    const d=await resp.json();if(!resp.ok)throw Error(d.error||'No se pudo leer el CSV.');
    item.columns=d.columns;item.groups=d.groups;
    item.options.date_column=d.date_column;item.options.value_column=d.value_column;
    item.options.confirm_precipitation=false;
    for(const [name,selected] of [['date',d.date_column],['value',d.value_column],['quality','']])$(id+'_'+name).innerHTML=opts([['','Seleccionar…'],...d.columns],selected);
    $(id+'_group').innerHTML=opts([['','Un solo punto'],...Object.keys(d.groups)],'');
    $(id+'_filename').textContent=`${file.name} · ${d.rows} filas · ${d.skipped_header_lines} líneas de cabecera omitidas`;
    $(id+'_confirm').checked=false;
   })();
   item.loading.catch(e=>{item.content=null;$(id+'_filename').textContent=e.message;message('Error de importación',e.message,'error')});
  };
  if($(id+'_search'))$(id+'_search').onclick=async()=>{
   const button=$(id+'_search');button.disabled=true;$(id+'_stations').textContent='Consultando catálogo oficial NOAA…';
   try{
    const y0=+$('startYear').value,y1=+$('endYear').value;
    const resp=await fetch(`/api/nearby-stations?lat=${p.lat}&lon=${p.lon}&y0=${y0}&y1=${y1}`),d=await resp.json();if(!resp.ok)throw Error(d.error);
    const label=s=>{const yrs=s.prcp_first_year?` · lluvia ${s.prcp_first_year}–${s.prcp_last_year}`:'';const ov=s.overlap_years===undefined?'':s.overlap_years>0?` · ${s.overlap_years} años en ${y0}–${y1}`:' · ⚠ sin datos en el período';return `${s.name} · ${s.id} · ${s.distance_km} km${yrs}${ov}`};
    $(id+'_stations').innerHTML=d.stations.length?`<select id="${id}_stationselect">${opts([['','Elige estación (ordenadas por años con lluvia en el período)'],...d.stations.map(s=>[s.id,label(s)])],'')}</select><p class="hint">Se listan solo estaciones con registros de lluvia (PRCP) según el inventario GHCN; los años del inventario no garantizan que cada año esté completo. La cercanía no garantiza representatividad de relieve.</p>`:'No se encontraron estaciones con lluvia a menos de 300 km.';
    if($(id+'_stationselect'))$(id+'_stationselect').onchange=()=>{$(id+'_station').value=$(id+'_stationselect').value;item.station=$(id+'_station').value};
   }catch(e){$(id+'_stations').textContent=e.message}finally{button.disabled=false}
  };
 }));
}
function updateSourceControls(){
 preserveInputCards();const src=$('source').value;
 $('sourceHint').textContent=SOURCE_HINTS[src];$('csvBlock').hidden=!IMPORT_SOURCES.includes(src);$('stationBlock').hidden=src!=='noaa';
 $('referenceConfig').hidden=$('referenceSource').value==='none';renderInputCards();
}
async function collectDataInputs(data){
 preserveInputCards();data.reference_source=$('referenceSource').value;data.reference_type=$('referenceType').value;data.aligned_days=$('alignedDays').checked;data.reference_lag_days=$('referenceLag').value;data.robustness=$('robustness')?$('robustness').value:'fast';data.suspect_mm=+$('suspectMm').value;
 for(const role of ['target','ref']){
  const source=role==='target'?data.source:data.reference_source,prefix=role==='target'?'':'reference_';
  data[prefix+'csv_by_point']={};data[prefix+'import_options']={};data[prefix+'stations']={};
  for(let i=0;i<state.points.length;i++){
   const id=inputId(i,role),c=cacheItem(i,role);if(c.loading)await c.loading;
   if(IMPORT_SOURCES.includes(source)){
    if(!c.content){if(role==='target')throw Error('Carga el CSV de '+state.points[i].name);else continue}
    const opt=readImportOptions(id);
    if(!opt.confirm_precipitation)throw Error('Confirma columna y unidades del CSV de '+state.points[i].name+(role==='ref'?' (referencia)':''));
    data[prefix+'csv_by_point'][i]=c.content;data[prefix+'import_options'][i]=opt;
   }else if(source==='noaa'){
    const station=$(id+'_station').value.trim();if(!station&&role==='target')throw Error('Selecciona la estación NOAA de '+state.points[i].name);
    data[prefix+'stations'][i]=station;
   }
  }
 }
}
function htmlTable(headers,rows){return '<div class="table-scroll"><table><thead><tr>'+headers.map(h=>'<th>'+escapeHTML(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+escapeHTML(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'}
function renderDataReview(){
 if(!state.result)return;
 const p=state.result.points[+$('reviewPoint').value||0],q=p.quality,v=p.verification;if(!q)return;
 $('qualitySummary').innerHTML=[['Cobertura',fmt(q.coverage_pct,1)+'%'],['Años completos',q.complete_years],['Mayor vacío',q.longest_gap_days+' días'],['Días para revisar',q.suspicious_count]].map(([label,value])=>`<div class="metric"><small>${label}</small><strong>${value}</strong></div>`).join('');
 $('qualityNotes').innerHTML=(q.warnings.length?'<ul>'+q.warnings.map(w=>'<li>'+escapeHTML(w)+'</li>').join('')+'</ul>':'<p>Sin incidencias en los controles formales aplicados.</p>')+'<p class="method-note">'+escapeHTML(q.note)+'</p>';
 const im=q.import||{};
 $('qualityDetails').innerHTML=htmlTable(['Año','Días válidos','Días esperados','Cobertura (%)'],q.yearly.map(r=>[r.year,r.valid_days,r.expected_days,fmt(r.coverage_pct,1)]))+`<p class="method-note">Producto: ${escapeHTML(im.product||p.source_label)} · Entrada: ${escapeHTML(im.input_unit||'mm')} · Ventana diaria: ${escapeHTML(im.day_definition||'No declarada')}<br>Huella SHA-256 de la serie: <code>${escapeHTML(q.normalized_sha256)}</code></p>`+htmlTable(['Control de entrada','Número'],Object.entries(im.counts||{}));
 $('verificationSummary').innerHTML='<p>'+escapeHTML(v.note||'')+'</p>';$('verificationTables').innerHTML='';$('verificationChart').hidden=true;
 if(v.reference_name){$('verificationSummary').innerHTML+=`<p><strong>Referencia:</strong> ${escapeHTML(v.reference_name)} · ${v.n??0} pares coincidentes${v.distance_km!==null&&v.distance_km!==undefined?' · '+fmt(v.distance_km,1)+' km de distancia':''}. Cobertura de referencia: ${fmt(v.reference_quality?.coverage_pct,1)}%.</p>`}
 if(v.lag&&v.lag.diagnostic){const L=v.lag;$('verificationSummary').innerHTML+=`<p><strong>Desfase aplicado:</strong> ${L.applied_lag_days>0?'+':''}${L.applied_lag_days} d (${L.mode==='auto'?'automático, exploratorio':'declarado'}) · mayor correlación con ${L.best_lag_days===null?'—':(L.best_lag_days>0?'+':'')+L.best_lag_days+' d'}.</p>`+htmlTable(['Desfase (días)','Pares','Pearson r'],L.diagnostic.map(x=>[(x.lag_days>0?'+':'')+x.lag_days+(x.lag_days===L.applied_lag_days?' ◀':''),x.n,fmt(x.pearson_r,3)]))}
 if(v.status!=='compared')return;
 const m=v.metrics;
 $('verificationSummary').innerHTML+=htmlTable(['Pares','Sesgo (mm)','MAE (mm)','RMSE (mm)','PBIAS (%)','Pearson r'],[[v.n,fmt(m.bias_mm,2),fmt(m.mae_mm,2),fmt(m.rmse_mm,2),fmt(m.pbias_pct,1),fmt(m.pearson_r,3)]]);
 $('verificationChart').hidden=false;
 const pairs=v.pairs,max=Math.max(1,...pairs.map(x=>Math.max(x.product_mm,x.reference_mm)));
 Plotly.react($('verificationChart'),[{x:pairs.map(x=>x.reference_mm),y:pairs.map(x=>x.product_mm),text:pairs.map(x=>x.date),type:'scattergl',mode:'markers',name:'Pares diarios',marker:{color:'#205ca6',size:4,opacity:.45},hovertemplate:'%{text}<br>Referencia %{x:.2f} mm<br>Producto %{y:.2f} mm<extra></extra>'},{x:[0,max],y:[0,max],type:'scatter',mode:'lines',name:'Igualdad 1:1',line:{color:'#222',dash:'dash'}}],{margin:{t:20,l:58,r:20,b:65},paper_bgcolor:'#fff',plot_bgcolor:'#fff',xaxis:{title:'Referencia (mm/día)'},yaxis:{title:'Producto (mm/día)'},legend:{orientation:'h',y:-.22}},PLOT);
 $('verificationTables').innerHTML='<h4>Detección de eventos sobre las mismas fechas</h4>'+htmlTable(['Umbral','Aciertos','Omisiones','Falsas alarmas','POD','FAR','CSI'],v.events.map(e=>[e.threshold,e.hits,e.misses,e.false_alarms,fmt(e.pod,3),fmt(e.far,3),fmt(e.csi,3)]))+'<p class="method-note">POD = aciertos / eventos observados; FAR = falsas alarmas / eventos estimados; CSI = aciertos / (aciertos + omisiones + falsas alarmas). Los P95/P99 de esta tabla proceden de la referencia. Un denominador cero se muestra como —.</p><h4>Tendencias de frecuencia: años completos coincidentes</h4>'+htmlTable(['Umbral (mm)','Años','Producto días/década','Referencia días/década','Cambio producto','Cambio referencia'],v.annual_trends.map(e=>[e.threshold_mm,e.n_years,fmt(e.product.slope_per_decade,2),fmt(e.reference.slope_per_decade,2),fixedChange(e.product),fixedChange(e.reference)]))+'<p class="method-note">La comparación de pendientes no es una prueba de diferencia significativa. Verifica relieve, distancia, cambios de instrumento y posible uso de estaciones comunes en ambos productos.</p>';
}
async function initializeDataTools(){
 $('referenceSource').onchange=()=>{if($('referenceLag'))$('referenceLag').value=$('referenceSource').value==='noaa'?'-1':'0';updateSourceControls()};
 $('reviewPoint').onchange=renderDataReview;
 updateSourceControls();
 try{const r=await fetch('/api/resources'),d=await r.json();$('resourceCards').innerHTML=d.resources.map(x=>`<article><small>${escapeHTML(x.kind)}</small><h3><a href="${escapeHTML(x.url)}" target="_blank" rel="noreferrer">${escapeHTML(x.name)} ↗</a></h3><p>${escapeHTML(x.text)}</p></article>`).join('')}catch(e){$('resourceCards').textContent='No se pudo cargar el catálogo de recursos.'}
}
