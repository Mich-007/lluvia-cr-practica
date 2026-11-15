'use strict';
/* =============================================================================
   LLUVIA CR · v6.2 · VALIDACIÓN: satélite / reanálisis vs estaciones de Costa Rica
   =============================================================================
   Igual que app.js, esta página NO calcula estadística: todas las métricas
   vienen de estaciones.py (backend). Aquí solo se piden, se dibujan y se
   explican. Usa el sistema visual de app.js (layout, polish, fitLegend, PLOT).

   Figuras (pensadas para un climatólogo):
     1. Tarjeta de puntuación  · todas las estaciones × todas las métricas
     2. Diagrama de Taylor     · r, razón de σ y error centrado en una figura
     3. Dispersión diaria      · satélite vs estación, recta 1:1 y MCO
     4. Mensual pareado        · mismas fechas sumadas por mes + diferencia
     5. Cuantil-cuantil        · ¿se parecen las distribuciones?
     6. Ciclo anual del sesgo  · ¿en qué meses se equivoca más?
     7. Detección por umbral   · POD, FAR, CSI, HSS y FBI de 1 a 50 mm
     8. Desfase de días        · ¿define el día igual la estación y el satélite?
     9. Días extremos          · ¿capta el satélite los picos?
   ========================================================================== */
const val={stations:[],result:null,job:null,focus:0};
const VC={sat:'#205ca6',est:'#2f2f2f',raw:'#a0a0a0',ext:'#b0481e'};

function valMsg(title,desc,cls){
 const b=$('valStatus');b.className='status-card '+cls;
 b.innerHTML=`<span class="status-icon">${cls==='error'?'⚠':'◌'}</span><div><strong>${escapeHTML(title)}</strong><p>${escapeHTML(desc)}</p></div>`;b.hidden=false;
}
async function valLoadStations(){
 try{
  const pts=(state.points||[]).map(p=>`${(+p.lat).toFixed(4)},${(+p.lon).toFixed(4)}`).join(';');
  const r=await fetch('/api/stations'+(pts?'?pts='+encodeURIComponent(pts):''));const d=await r.json();
  if(!r.ok)throw Error(d.error||'No se pudo leer el catálogo de estaciones');
  const prev=new Set([...document.querySelectorAll('#valStations input:checked')].map(x=>x.value));
  val.stations=d.stations;valRenderStations(prev);
 }catch(e){$('valStations').innerHTML=`<div class="status-card error">${escapeHTML(e.message)}</div>`}
}
function valRenderStations(prev){
 const names=state.points.map(p=>p.name);
 $('valStations').innerHTML=val.stations.map(s=>{
  const near=s.dist_km?.length?s.dist_km.map((d,i)=>({d,i})).sort((a,b)=>a.d-b.d)[0]:null;
  const recent=s.last>=2010;const on=prev&&prev.size?prev.has(s.id):recent;
  return `<label class="val-st ${recent?'':'old'}"><input type="checkbox" value="${escapeHTML(s.id)}" ${on?'checked':''}><span><b>${escapeHTML(s.name)}</b>
   <small>${escapeHTML(s.id)}${s.wmo?' · OMM '+escapeHTML(s.wmo):''} · ${fmt(s.elev_m,0)} m s. n. m. · datos ${s.first}–${s.last}</small>
   ${near?`<small>a ${fmt(near.d,1)} km de «${escapeHTML(names[near.i]||'')}»</small>`:''}</span></label>`}).join('');
}
// Cuando termina un análisis, se proponen las fechas y se recalculan distancias.
function valOnAnalysis(){
 if(state.result){$('valStart').value=Math.max(state.result.start_year,state.result.source==='merra2'?1981:2001);$('valEnd').value=state.result.end_year;
  if(['gpm','merra2'].includes(state.result.source))$('valSource').value=state.result.source}
 valLoadStations();
}

async function valRun(){
 const btn=$('valRun');
 try{
  const ids=[...document.querySelectorAll('#valStations input:checked')].map(x=>x.value);
  const body={source:$('valSource').value,start_year:+$('valStart').value,end_year:+$('valEnd').value,stations:ids,wet_min:+$('wetMin').value||1};
  const f=$('valCsv').files?.[0];
  if(f){
   if(f.size>10e6)throw Error('El CSV de estación supera 10 MB.');
   const lat=parseFloat($('valLat').value),lon=parseFloat($('valLon').value);
   if(!Number.isFinite(lat)||!Number.isFinite(lon))throw Error('Escriba la latitud y la longitud de su estación.');
   body.custom_station={name:$('valName').value.trim()||'Estación propia',institution:$('valInst').value.trim(),lat,lon,csv:await f.text()};
  }
  if(!ids.length&&!f)throw Error('Elija al menos una estación o cargue un CSV.');
  if(!(body.start_year<=body.end_year))throw Error('Período inválido.');
  btn.disabled=true;$('valResults').hidden=true;
  valMsg('Preparando la validación…','Se descarga cada estación de NOAA NCEI y la serie de la celda satelital que la contiene (con caché local).','progress');
  const r=await fetch('/api/validate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d=await r.json();if(!r.ok)throw Error(d.error||'No se pudo iniciar la validación');
  val.job=d.job_id;
  for(;;){
   await new Promise(res=>setTimeout(res,1200));
   const s=await fetch('/api/status?id='+encodeURIComponent(val.job));const j=await s.json();
   if(!s.ok)throw Error(j.error||'Estado no disponible');
   valMsg('Comparando satélite y estaciones…',(j.progress||[]).slice(-3).join('  •  '),'progress');
   if(j.state==='error')throw Error(j.error||'Error en la validación');
   if(j.state==='done'){val.result=j.result;break}
  }
  $('valStatus').hidden=true;$('valResults').hidden=false;
  $('valExportTxt').disabled=false;$('valExportJson').disabled=false;
  val.focus=0;valRender();
 }catch(e){valMsg('Error de validación',String(e.message||e),'error');console.error(e)}
 finally{btn.disabled=false}
}

// ---------------------------------------------------------------------------
// Tabla y lecturas
// ---------------------------------------------------------------------------
function valOk(){return (val.result?.stations||[]).filter(s=>s.comparison?.suficiente)}
function valCat(c,t){return (c?.categoricas||[]).find(x=>x.umbral_mm===t)||{}}
function cls(v,good,bad,higher=true){if(v==null)return '';return higher?(v>=good?'good':v<=bad?'bad':''):(v<=good?'good':v>=bad?'bad':'')}
function valRender(){
 const R=val.result,ok=valOk();
 const bad=(R.stations||[]).filter(s=>!s.comparison?.suficiente);
 $('valNote').textContent=`${R.source_label} · ${R.start_year}–${R.end_year} · ${ok.length} estación(es) comparada(s)`+
  (bad.length?` · sin comparación: ${bad.map(s=>`${s.station.name} (${s.error||s.comparison?.texto||'sin datos'})`).join('; ')}`:'');
 $('valFocus').innerHTML=ok.map((s,i)=>`<option value="${i}">${escapeHTML(s.station.name)}</option>`).join('');
 val.focus=Math.min(val.focus,Math.max(0,ok.length-1));$('valFocus').value=String(val.focus);
 const head=['Estación','Distancia al centro de la celda','Días pareados','Día alineado','PBIAS','r diario','Spearman','KGE','r mensual','POD ≥1 mm','FAR ≥1 mm','CSI ≥1 mm','HSS ≥1 mm','CSI ≥20 mm','Extremos detectados','Fracción del pico'];
 $('valTable').querySelector('thead').innerHTML='<tr>'+head.map(h=>`<th>${h}</th>`).join('')+'</tr>';
 $('valTable').querySelector('tbody').innerHTML=ok.map((s,i)=>{const c=s.comparison,m=c.continuas||{},c1=valCat(c,1),c20=valCat(c,20),ex=c.extremos||{};
  const cells=[[`<span style="color:${PAL[i%PAL.length]}">●</span> ${escapeHTML(s.station.name)}`,''],
   [s.distance_to_cell_center_km==null?'—':fmt(s.distance_to_cell_center_km,1)+' km',''],
   [`${fmt(c.n_pareados,0)} <small>(${fmt(c.cobertura_estacion_pct,0)} % cobertura)</small>`,''],
   [c.desfase_aplicado?`${c.desfase_aplicado>0?'+':''}${c.desfase_aplicado} día`:'mismo día',''],
   [fmtS(m.pbias_pct,1)+' %',cls(Math.abs(m.pbias_pct),10,30,false)],[fmt(m.pearson_r,2),cls(m.pearson_r,0.5,0.25)],[fmt(m.spearman_rho,2),cls(m.spearman_rho,0.5,0.25)],
   [fmt(m.kge,2),cls(m.kge,0.5,0)],[fmt(c.mensual_r,2),cls(c.mensual_r,0.8,0.5)],[fmt(c1.pod,2),cls(c1.pod,0.8,0.5)],[fmt(c1.far,2),cls(c1.far,0.25,0.45,false)],
   [fmt(c1.csi,2),cls(c1.csi,0.6,0.35)],[fmt(c1.hss,2),cls(c1.hss,0.4,0.1)],[fmt(c20.csi,2),cls(c20.csi,0.4,0.15)],
   [ex.tasa_deteccion==null?'—':fmt(100*ex.tasa_deteccion,0)+' %',cls(ex.tasa_deteccion,0.5,0.25)],
   [ex.mediana_fraccion_pico==null?'—':fmt(100*ex.mediana_fraccion_pico,0)+' %',cls(ex.mediana_fraccion_pico,0.7,0.4)]];
  return '<tr>'+cells.map(([v,k])=>`<td class="${k}">${v}</td>`).join('')+'</tr>'}).join('');
 valRerender();
}
function valFocused(){return valOk()[val.focus]}

// ---------------------------------------------------------------------------
// Utilidades de figura
// ---------------------------------------------------------------------------
function valProv(lo,s){
 const R=val.result;const c=s?.cell||{};
 const st=s?`${s.station.name} (${s.station.id==='propia'?(s.station.institution||'CSV del usuario'):'NOAA NCEI GHCN-Daily '+s.station.id}) · `:'Estaciones: NOAA NCEI GHCN-Daily · ';
 const cell=c.available?`${c.grid_label}, centro ${(+c.center_lat).toFixed(2)}°, ${(+c.center_lon).toFixed(2)}° · `:'';
 lo.annotations.push({name:'procedencia',xref:'paper',yref:'paper',x:0,y:0,xanchor:'left',yanchor:'top',showarrow:false,align:'left',
  text:escapeHTML(`${st}Producto: ${R.source_label} · ${cell}${R.start_year}–${R.end_year} · días pareados, sin imputación · Lluvia CR v6.2`),font:{size:9,color:'#7a7a7a'}});
 return lo;
}
function oneToOne(max,xa='x',ya='y'){return {x:[0,max],y:[0,max],xaxis:xa,yaxis:ya,type:'scatter',mode:'lines',name:'Línea 1:1 (acuerdo perfecto)',line:{color:'#7a7a7a',width:1.4,dash:'dash'},hoverinfo:'skip'}}

// 1 · TARJETA DE PUNTUACIÓN ---------------------------------------------------
function figScore(){
 const ok=valOk();
 const M=[['r<br>diario',c=>c.continuas?.pearson_r,v=>v,2],['r<br>mensual',c=>c.mensual_r,v=>v,2],['KGE<br> ',c=>c.continuas?.kge,v=>(v+0.41)/1.41,2],
  ['|PBIAS|<br>%',c=>c.continuas?.pbias_pct==null?null:Math.abs(c.continuas.pbias_pct),v=>1-v/50,0],['POD<br>≥1 mm',c=>valCat(c,1).pod,v=>v,2],
  ['FAR<br>≥1 mm',c=>valCat(c,1).far,v=>1-v/0.6,2],['CSI<br>≥1 mm',c=>valCat(c,1).csi,v=>v,2],['HSS<br>≥1 mm',c=>valCat(c,1).hss,v=>v/0.6,2],
  ['CSI<br>≥20 mm',c=>valCat(c,20).csi,v=>v/0.6,2],['Extremos<br>detectados',c=>c.extremos?.tasa_deteccion,v=>v,2],['Fracción<br>del pico',c=>c.extremos?.mediana_fraccion_pico,v=>v,2]];
 const clamp=v=>Math.max(0,Math.min(1,v));
 const ys=ok.map(s=>s.station.name),xs=M.map(m=>m[0]);
 const raw=ok.map(s=>M.map(m=>m[1](s.comparison)));
 const z=raw.map(row=>row.map((v,j)=>v==null?null:clamp(M[j][2](v))));
 const traces=[{type:'heatmap',x:xs,y:ys,z,zmin:0,zmax:1,xgap:3,ygap:3,hoverongaps:false,
  colorscale:[[0,'#8a3f26'],[0.3,'#e3b9a3'],[0.5,'#f5f3ee'],[0.7,'#a9c6e6'],[1,'#1b4f8f']],
  customdata:raw.map(r=>r.map(v=>v==null?'—':fmt(v,2))),hovertemplate:'%{y} · %{x}: %{customdata}<extra></extra>',
  colorbar:{title:{text:'Desempeño',side:'top',font:{size:11.5}},tickvals:[0,0.5,1],ticktext:['peor','medio','mejor'],thickness:15,outlinewidth:0,len:0.9}}];
 const lo=layout('¿Qué tan bien reproduce el producto a cada estación?','',{margin:{l:210,r:40,t:110,b:110},showlegend:false,
  xaxis:{showgrid:false,tickangle:0,tickfont:{size:12}},yaxis:{showgrid:false,autorange:'reversed',tickfont:{size:12.5}}},
  'Tarjeta de puntuación: color = desempeño relativo; número = valor real','#3a3a3a');
 lo._provExtra=22;
 raw.forEach((row,i)=>row.forEach((v,j)=>{if(v==null)return;const dark=z[i][j]!=null&&(z[i][j]>0.8||z[i][j]<0.2);
  lo.annotations.push({x:xs[j],y:ys[i],showarrow:false,text:M[j][0].startsWith('|')?fmt(v,0)+' %':(M[j][0].startsWith('Extremos')||M[j][0].startsWith('Fracción'))?fmt(100*v,0)+' %':fmt(v,2),font:{size:12.5,color:dark?'#fff':'#1a1a1a'}})}));
 valProv(lo,null);
 polish(lo,'Escalas: r, POD, CSI y detección de extremos de 0 a 1; KGE desde −0,41 (no mejor que la media) hasta 1; |PBIAS| peor a 50 %; FAR peor a 0,6. Las métricas usan el día alineado si se aplicó desfase.');
 return {traces,lo,h:Math.max(360,210+ok.length*60)};
}

// 2 · DIAGRAMA DE TAYLOR ---------------------------------------------------------
function figTaylor(){
 const ok=valOk(),traces=[];
 const deg=r=>Math.acos(Math.max(-1,Math.min(1,r)))*180/Math.PI;
 const maxsd=Math.max(1.5,...ok.map(s=>s.comparison.continuas?.sd_ratio||0))*1.12;
 // Contornos de error centrado normalizado (círculos alrededor de la referencia)
 [0.25,0.5,0.75,1,1.25].forEach(cR=>{const rr=[],th=[];for(let t=0;t<=Math.PI;t+=Math.PI/90){const x=1+cR*Math.cos(t),y=cR*Math.sin(t);if(x<0)continue;const rho=Math.hypot(x,y);if(rho>maxsd)continue;rr.push(rho);th.push(Math.atan2(y,x)*180/Math.PI)}
  traces.push({type:'scatterpolar',r:rr,theta:th,mode:'lines',line:{color:'#c9a227',width:1,dash:'dot'},hoverinfo:'skip',showlegend:cR===0.25,name:'Error cuadrático centrado (σ)'});
  if(rr.length)traces.push({type:'scatterpolar',r:[rr[Math.floor(rr.length*0.55)]],theta:[th[Math.floor(rr.length*0.55)]],mode:'text',text:[fmt(cR,2)],textfont:{size:10,color:'#9a7b13'},hoverinfo:'skip',showlegend:false})});
 const arc=[...Array(91).keys()];
 traces.push({type:'scatterpolar',r:arc.map(()=>1),theta:arc,mode:'lines',line:{color:'#555',width:1.2,dash:'dash'},name:'σ igual a la estación',hoverinfo:'skip'});
 traces.push({type:'scatterpolar',r:[1],theta:[0],mode:'markers',marker:{symbol:'star',size:17,color:'#111',line:{color:'#fff',width:1}},name:'Estación (referencia)',hovertemplate:'Referencia: r = 1, σ = 1<extra></extra>'});
 ok.forEach((s,i)=>{const m=s.comparison.continuas,col=PAL[i%PAL.length],raw=s.comparison.sin_alinear?.continuas;
  if(raw?.pearson_r!=null)traces.push({type:'scatterpolar',r:[raw.sd_ratio,m.sd_ratio],theta:[deg(raw.pearson_r),deg(m.pearson_r)],mode:'lines+markers',
   line:{color:hexA(col,0.55),width:1.2,dash:'dot'},marker:{size:[9,0],color:'#fff',line:{color:col,width:2}},showlegend:false,
   hovertemplate:`${escapeHTML(s.station.name)} sin alinear<br>r = ${fmt(raw.pearson_r,2)} · σ = ${fmt(raw.sd_ratio,2)}<extra></extra>`});
  traces.push({type:'scatterpolar',r:[m.sd_ratio],theta:[deg(m.pearson_r)],mode:'markers',name:s.station.name,
   marker:{size:14,color:col,line:{color:'#fff',width:1.5}},hovertemplate:`${escapeHTML(s.station.name)}<br>r = ${fmt(m.pearson_r,2)} · σsat/σest = ${fmt(m.sd_ratio,2)} · ECC = ${fmt(m.crmsd_norm,2)}<extra></extra>`})});
 const cors=[0,0.2,0.4,0.6,0.7,0.8,0.9,0.95,0.99,1];
 const lo=layout('Diagrama de Taylor · todas las estaciones','',{margin:{l:60,r:30,t:118,b:70},
  polar:{sector:[0,90],bgcolor:'#fff',domain:{x:[0,1],y:[0,1]},
   angularaxis:{tickmode:'array',tickvals:cors.map(deg),ticktext:cors.map(c=>fmt(c,c>=0.95?2:1)),direction:'counterclockwise',rotation:0,gridcolor:'#e6e6e6',linecolor:FRAME,tickfont:{size:11.5}},
   radialaxis:{range:[0,maxsd],gridcolor:'#e6e6e6',linecolor:FRAME,tickfont:{size:11},title:{text:'σ satélite / σ estación',font:{size:12}},angle:0}}},
  'Más cerca de la estrella = mejor (correlación en el arco, variabilidad en el radio)','#3a3a3a');
 lo.annotations.push({xref:'paper',yref:'paper',x:0.72,y:0.98,showarrow:false,text:'<i>Correlación</i>',font:{size:12,color:'#444'}});
 valProv(lo,null);
 polish(lo,'Ángulo: correlación diaria de Pearson. Radio: desviación típica del producto relativa a la estación (1 = misma variabilidad). Curvas punteadas: error cuadrático centrado normalizado. Círculo abierto: la misma estación sin alinear el día.');
 return {traces,lo,h:600};
}

// 3 · DISPERSIÓN DIARIA ---------------------------------------------------------------
function figScatter(s){
 const c=s.comparison,m=c.continuas,P=c.pares,ex=c.extremos||{};
 const all=[...P.sat,...P.est].sort((a,b)=>a-b);const max=Math.max(10,all[Math.floor(all.length*0.999)]||10)*1.06;
 const isExt=P.est.map(v=>ex.p95_est_mm!=null&&v>ex.p95_est_mm);
 const traces=[
  {type:'scattergl',mode:'markers',x:P.est.filter((v,i)=>!isExt[i]),y:P.sat.filter((v,i)=>!isExt[i]),name:'Días pareados',
   marker:{size:5,color:hexA(VC.sat,0.28),line:{width:0}},customdata:P.fecha.filter((v,i)=>!isExt[i]),hovertemplate:'%{customdata}<br>Estación %{x:.1f} mm · Satélite %{y:.1f} mm<extra></extra>'},
  {type:'scattergl',mode:'markers',x:P.est.filter((v,i)=>isExt[i]),y:P.sat.filter((v,i)=>isExt[i]),name:`Días extremos de la estación (> ${fmt(ex.p95_est_mm,0)} mm)`,
   marker:{size:7,color:hexA(VC.ext,0.75),line:{color:'#fff',width:0.6}},customdata:P.fecha.filter((v,i)=>isExt[i]),hovertemplate:'%{customdata}<br>Estación %{x:.1f} mm · Satélite %{y:.1f} mm<extra></extra>'},
  oneToOne(max)];
 if(m.ols_b!=null)traces.push({x:[0,max],y:[m.ols_a,m.ols_a+m.ols_b*max],type:'scatter',mode:'lines',name:`Mínimos cuadrados: sat = ${fmt(m.ols_a,1)} + ${fmt(m.ols_b,2)}·est`,line:{color:VC.sat,width:2.6}});
 const lo=layout(`¿Coincide día a día? · ${s.station.name}`,'',{xaxis:{title:{text:'Lluvia de la estación (mm/día)'},range:[0,max],constrain:'domain'},yaxis:{title:{text:'Lluvia del producto (mm/día)'},range:[0,max],scaleanchor:'x',scaleratio:1,constrain:'domain'}},
  `r = ${fmt(m.pearson_r,2)} · Spearman ${fmt(m.spearman_rho,2)} · KGE ${fmt(m.kge,2)} · PBIAS ${fmtS(m.pbias_pct,1)} % · n = ${fmt(c.n_pareados,0)}`,VC.sat);
 valProv(lo,s);
 polish(lo,`Cada punto es un día con dato en ambas fuentes${c.desfase_aplicado?` (día del producto desplazado ${c.desfase_aplicado>0?'+':''}${c.desfase_aplicado})`:''}. Sobre la línea 1:1 el producto sobrestima; debajo, subestima. En rojo, los días extremos de la estación: si quedan bajo la 1:1, el promedio de celda está atenuando los picos.`);
 return {traces,lo,h:620};
}

// 4 · MENSUAL PAREADO --------------------------------------------------------------------
function figMonthly(s){
 // Serie mensual completa con huecos (null) en los meses sin ≥ 10 días pareados,
 // para no unir con una línea meses que no se compararon.
 const got=s.comparison.mensual||[];const byM=Object.fromEntries(got.map(r=>[r.mes,r]));const mm=[];
 if(got.length){let [y,m]=got[0].mes.split('-').map(Number);const [y1,m1]=got[got.length-1].mes.split('-').map(Number);
  while(y<y1||(y===y1&&m<=m1)){const k=`${y}-${String(m).padStart(2,'0')}`;mm.push(byM[k]||{mes:k,n:0,sat:null,est:null});m++;if(m>12){m=1;y++}}}
 const x=mm.map(r=>r.mes+'-15');
 const traces=[{x,y:mm.map(r=>r.est),type:'scatter',mode:'lines+markers',name:'Estación',line:{color:VC.est,width:2},marker:{size:5,color:VC.est},
   customdata:mm.map(r=>r.n),hovertemplate:'%{x|%Y-%m}: %{y:.0f} mm (%{customdata} días pareados)<extra>Estación</extra>'},
  {x,y:mm.map(r=>r.sat),type:'scatter',mode:'lines+markers',name:'Producto (mismos días)',line:{color:VC.sat,width:2},marker:{size:5,color:VC.sat},
   hovertemplate:'%{x|%Y-%m}: %{y:.0f} mm<extra>Producto</extra>'},
  {x,y:mm.map(r=>r.sat==null?null:r.sat-r.est),type:'bar',xaxis:'x2',yaxis:'y2',name:'Diferencia',showlegend:false,
   marker:{color:mm.map(r=>r.sat!=null&&r.sat-r.est>=0?COL.pos:COL.neg)},hovertemplate:'%{x|%Y-%m}: %{y:+.0f} mm<extra>Producto − estación</extra>'}];
 const lo=layout(`¿Coincide mes a mes? · ${s.station.name}`,'',{
  yaxis:{domain:[0.4,1],title:{text:'Lluvia de los días pareados (mm)'}},xaxis:{anchor:'y',type:'date',showticklabels:false},
  xaxis2:{anchor:'y2',matches:'x',type:'date'},yaxis2:{domain:[0,0.3],title:{text:'Producto − estación'},zeroline:true,zerolinecolor:SERIES_INK}},
  s.comparison.mensual_r!=null?`r mensual = ${fmt(s.comparison.mensual_r,2)} · PBIAS mensual ${fmtS(s.comparison.mensual_pbias_pct,1)} % · ${got.length} meses`:`${got.length} meses con ≥ 10 días pareados`,VC.sat);
 valProv(lo,s);
 polish(lo,'Suma, para cada mes, SOLO de los días con dato en ambas fuentes (meses con ≥ 10 días pareados). No es el total mensual oficial de la estación; sirve para comparar sin sesgo de muestreo. Abajo: barras azules, el producto da más lluvia; rojizas, menos.');
 return {traces,lo,h:560};
}

// 5 · CUANTIL-CUANTIL ------------------------------------------------------------------------
function figQQ(s){
 const q=s.comparison.qq||[];const vals=q.flatMap(r=>[r.sat,r.est]).filter(v=>v>0);const lo_=Math.max(0.5,Math.min(...vals)*0.8),hi=Math.max(...vals)*1.25;
 const traces=[{x:[lo_,hi],y:[lo_,hi],type:'scatter',mode:'lines',name:'Línea 1:1',line:{color:'#7a7a7a',dash:'dash',width:1.4},hoverinfo:'skip'},
  {x:q.map(r=>r.est),y:q.map(r=>r.sat),type:'scatter',mode:'lines+markers+text',name:'Cuantiles de días lluviosos',line:{color:VC.sat,width:2.4},
   marker:{size:9,color:VC.sat,line:{color:'#fff',width:1}},text:q.map(r=>'Q'+String(r.q).replace('.',',')),textposition:'top left',textfont:{size:10.5,color:'#333'},
   hovertemplate:'Q%{text}: estación %{x:.1f} · producto %{y:.1f} mm<extra></extra>'}];
 const lo=layout(`¿Se parecen las distribuciones? · ${s.station.name}`,'',{
  xaxis:{type:'log',dtick:'D2',title:{text:'Cuantil de la estación (mm/día, escala log)'},range:[Math.log10(lo_),Math.log10(hi)]},
  yaxis:{type:'log',dtick:'D2',title:{text:'Cuantil del producto (mm/día, escala log)'},range:[Math.log10(lo_),Math.log10(hi)]}});
 valProv(lo,s);
 polish(lo,`Cuantiles de los días lluviosos (≥ ${fmt(val.result.wet_min,1)} mm) de cada fuente. Bajo la 1:1 en la cola alta (Q95-Q99,5): el producto suaviza los extremos. Sobre la 1:1 en la cola baja: más lloviznas que la estación.`);
 return {traces,lo,h:560};
}

// 6 · CICLO ANUAL DEL SESGO -----------------------------------------------------------------------
function figCycle(s){
 const c=s.comparison.ciclo_sesgo||[];const x=c.map(r=>MONTHS[r.mes-1]);
 const traces=[{x,y:c.map(r=>r.media_est),type:'scatter',mode:'lines+markers',name:'Estación',line:{color:VC.est,width:2.4},marker:{size:7,color:VC.est}},
  {x,y:c.map(r=>r.media_sat),type:'scatter',mode:'lines+markers',name:'Producto',line:{color:VC.sat,width:2.4},marker:{size:7,color:VC.sat}},
  {x,y:c.map(r=>r.pbias_pct),type:'bar',xaxis:'x2',yaxis:'y2',showlegend:false,name:'PBIAS',marker:{color:c.map(r=>(r.pbias_pct||0)>=0?COL.pos:COL.neg)},
   text:c.map(r=>r.pbias_pct==null?'':fmtS(r.pbias_pct,0)+'%'),textposition:'outside',cliponaxis:false,textfont:{size:10},
   customdata:c.map(r=>r.n),hovertemplate:'%{x}: PBIAS %{y:+.0f} % (n = %{customdata} días)<extra></extra>'}];
 const lo=layout(`¿En qué meses se equivoca más? · ${s.station.name}`,'',{
  yaxis:{domain:[0.46,1],title:{text:'Lluvia media en días pareados (mm/día)'}},xaxis:{anchor:'y',showticklabels:false,type:'category'},
  xaxis2:{anchor:'y2',matches:'x',type:'category'},yaxis2:{domain:[0,0.34],title:{text:'PBIAS (%)'},zeroline:true,zerolinecolor:SERIES_INK}});
 valProv(lo,s);
 polish(lo,'Arriba: lluvia media diaria por mes del calendario en los días pareados. Abajo: sesgo relativo por mes. Un sesgo que cambia de signo entre la época seca y la lluviosa indica un error que depende del tipo de lluvia (orográfica, convectiva o de frentes fríos en el Caribe).');
 return {traces,lo,h:560};
}

// 7 · DETECCIÓN POR UMBRAL ----------------------------------------------------------------------------
function figCategorical(s){
 const cat=s.comparison.categoricas||[];const x=cat.map(r=>`≥ ${r.umbral_mm} mm`);
 const L=(k,name,color,dash)=>({x,y:cat.map(r=>r[k]),type:'scatter',mode:'lines+markers',name,line:{color,width:2.6,dash},marker:{size:8,color}});
 const traces=[L('pod','POD · días de lluvia detectados',VC.sat),L('csi','CSI · índice de éxito crítico','#111'),L('hss','HSS · Heidke (habilidad sobre azar)','#207b79'),
  L('far','FAR · falsas alarmas',COL.neg,'dot'),
  {x,y:cat.map(r=>r.fbi),type:'scatter',mode:'lines+markers',yaxis:'y2',name:'FBI · sesgo de frecuencia (eje derecho)',line:{color:'#8a6d3b',width:2,dash:'dash'},marker:{size:7,symbol:'diamond',color:'#8a6d3b'}}];
 const lo=layout(`¿Detecta cuándo llueve, y cuándo llueve fuerte? · ${s.station.name}`,'',{
  xaxis:{type:'category',title:{text:'Umbral diario'}},yaxis:{title:{text:'Puntuación (0 a 1)'},range:[0,1.02]},
  yaxis2:{overlaying:'y',side:'right',title:{text:'FBI (1 = misma frecuencia)'},showgrid:false,rangemode:'tozero',showline:true,linecolor:FRAME,tickfont:{size:12}}});
 lo.shapes.push({type:'line',xref:'paper',yref:'y2',x0:0,x1:1,y0:1,y1:1,line:{color:'#8a6d3b',width:1,dash:'dot'}});
 lo.margin.r=Math.max(lo.margin.r,80);
 valProv(lo,s);
 polish(lo,'Tabla de contingencia día a día para cada umbral. POD y CSI altos y FAR bajo = buena detección. HSS > 0 = mejor que el azar. FBI > 1: el producto marca el umbral más días que la estación (típico con lloviznas); FBI < 1: menos días (típico en lluvias intensas).');
 return {traces,lo,h:560};
}

// 8 · DESFASE DE DÍAS --------------------------------------------------------------------------------------
function figLag(s){
 const L=s.comparison.desfases||[],ap=s.comparison.desfase_aplicado;
 const traces=[{x:L.map(l=>(l.desfase_dias>0?'+':'')+l.desfase_dias),y:L.map(l=>l.r),type:'bar',name:'r de Pearson',
  marker:{color:L.map(l=>l.desfase_dias===ap?VC.sat:'#b9b9b9'),line:{color:'#fff',width:1}},text:L.map(l=>fmt(l.r,2)),textposition:'outside',cliponaxis:false,
  hovertemplate:'Desfase %{x} día(s): r = %{y:.3f}<extra></extra>'}];
 const lo=layout(`¿Definen el día igual? · ${s.station.name}`,'Correlación diaria (r)',{showlegend:false,xaxis:{type:'category',title:{text:'Producto desplazado (días) respecto a la estación'}},yaxis:{rangemode:'tozero'}},
  ap?`Se aplicó desfase ${ap>0?'+':''}${ap} día: r sube de ${fmt(s.comparison.sin_alinear?.continuas?.pearson_r,2)} a ${fmt(s.comparison.continuas.pearson_r,2)}`:'Sin desfase: el mismo día de calendario es el mejor',ap?VC.sat:INK);
 valProv(lo,s);
 polish(lo,'−1 = la lluvia que la estación anota en el día d se parece más a la del producto en el día d − 1. Ocurre cuando el pluviómetro se lee por la mañana y registra las 24 h previas, mientras NASA POWER usa el día UTC (00-24 h, 18 h a 18 h en Costa Rica). Es una diferencia de definición, no un error del satélite.');
 return {traces,lo,h:480};
}

// 9 · DÍAS EXTREMOS ------------------------------------------------------------------------------------------------
function figExtremes(s){
 const ex=s.comparison.extremos||{},P=s.comparison.pares;
 const idx=P.est.map((v,i)=>i).filter(i=>P.est[i]>ex.p95_est_mm);
 const xs=idx.map(i=>P.est[i]),ys=idx.map(i=>P.sat[i]),max=Math.max(10,...xs,...ys)*1.06;
 const hit=idx.map(i=>P.sat[i]>ex.p95_sat_mm);
 const traces=[{x:xs.filter((v,k)=>hit[k]),y:ys.filter((v,k)=>hit[k]),type:'scatter',mode:'markers',name:`Detectado (producto > su P95 = ${fmt(ex.p95_sat_mm,0)} mm)`,
   marker:{size:9,color:VC.sat,symbol:'triangle-up',line:{color:'#fff',width:1}},customdata:idx.filter((v,k)=>hit[k]).map(i=>P.fecha[i]),hovertemplate:'%{customdata}<br>Estación %{x:.0f} · producto %{y:.0f} mm<extra></extra>'},
  {x:xs.filter((v,k)=>!hit[k]),y:ys.filter((v,k)=>!hit[k]),type:'scatter',mode:'markers',name:'No detectado',
   marker:{size:8,color:'#fff',line:{color:VC.ext,width:1.8}},customdata:idx.filter((v,k)=>!hit[k]).map(i=>P.fecha[i]),hovertemplate:'%{customdata}<br>Estación %{x:.0f} · producto %{y:.0f} mm<extra></extra>'},
  oneToOne(max),{x:[0,max],y:[0,max*0.5],type:'scatter',mode:'lines',name:'Producto = 50 % del pico',line:{color:'#c9a227',width:1.2,dash:'dot'},hoverinfo:'skip'}];
 const lo=layout(`¿Capta el producto los días extremos? · ${s.station.name}`,'',{xaxis:{title:{text:`Lluvia de la estación en sus días > P95 (${fmt(ex.p95_est_mm,0)} mm)`},range:[0,max]},yaxis:{title:{text:'Lluvia del producto ese día (mm)'},range:[0,max]}},
  ex.tasa_deteccion!=null?`Detectó ${fmt(100*ex.tasa_deteccion,0)} % de ${ex.n_dias_extremos_est} días extremos · estimó en mediana ${fmt(100*ex.mediana_fraccion_pico,0)} % del pico`:'Sin días extremos suficientes',VC.ext);
 valProv(lo,s);
 polish(lo,'Solo los días en que la estación superó su propio P95 de días lluviosos. Triángulos: el producto también lo marcó como extremo (sobre su propio P95). Círculos vacíos: no lo detectó. Si la mayoría queda bajo la línea del 50 %, la celda está atenuando los aguaceros puntuales.');
 return {traces,lo,h:580};
}

// ---------------------------------------------------------------------------
// Dibujo del panel de validación
// ---------------------------------------------------------------------------
const VAL_FIGS=[
 {id:'score',title:'Tarjeta de puntuación',all:true,wide:true,build:figScore},
 {id:'taylor',title:'Diagrama de Taylor',all:true,build:figTaylor},
 {id:'scatter',title:'Dispersión diaria',build:figScatter},
 {id:'monthly',title:'Mensual pareado',wide:true,build:figMonthly},
 {id:'qq',title:'Cuantil-cuantil',build:figQQ},
 {id:'cycle',title:'Ciclo anual del sesgo',build:figCycle},
 {id:'cat',title:'Detección por umbral',build:figCategorical},
 {id:'lag',title:'Desfase de días',build:figLag},
 {id:'ext',title:'Días extremos',build:figExtremes}
];
function valRerender(){
 if(!val.result||$('valResults').hidden||!window.Plotly)return;
 const grid=$('valGrid'),ok=valOk();if(!ok.length){grid.innerHTML='<div class="status-card error">Ninguna estación tiene días pareados suficientes en ese período.</div>';return}
 if(!grid.dataset.built){
  grid.innerHTML=VAL_FIGS.map(f=>`<figure class="dash-card ${f.wide?'wide':''}"><div class="dash-tools"><span>${escapeHTML(f.title)}${f.all?' · todas las estaciones':''}</span><button class="dash-zoom" data-f="${f.id}">⤢ Ampliar</button></div><div class="dash-plot" id="valFig_${f.id}"></div></figure>`).join('');
  grid.dataset.built='1';
  grid.querySelectorAll('.dash-zoom').forEach(b=>b.onclick=()=>{const f=VAL_FIGS.find(x=>x.id===b.dataset.f);const s=valFocused();openFigure(()=>f.build(s),'validacion_'+f.id)});
 }
 const s=valFocused();
 $('valReading').innerHTML=`<b>${escapeHTML(s.station.name)}</b> · ${escapeHTML(s.comparison.texto||'')} <i>Recuerde: la estación mide un punto y la celda promedia ≈ ${s.cell?.available?fmt(s.cell.area_km2,0):'—'} km²; la estación está a ${fmt(s.distance_to_cell_center_km,1)} km del centro de su celda.</i>`;
 VAL_FIGS.forEach(f=>{const el=$('valFig_'+f.id);
  try{const {traces,lo,h}=f.build(s);el.style.height=h+'px';fitLegend(lo,el.clientWidth||700,traces);
   Plotly.react(el,traces,lo,{...PLOT,toImageButtonOptions:{...PLOT.toImageButtonOptions,height:Math.round(h*1.5),filename:'validacion_'+f.id}})}
  catch(e){console.error(e);el.textContent='No se pudo graficar: '+e.message}});
}

function valDownload(name){
 if(!val.job)return;
 const a=document.createElement('a');a.href='/api/download?id='+encodeURIComponent(val.job)+'&name='+encodeURIComponent(name);a.download=name;
 document.body.appendChild(a);a.click();a.remove();
}
function valInit(){
 if(!$('validacion'))return;
 $('valRun').onclick=valRun;
 $('valFocus').onchange=()=>{val.focus=+$('valFocus').value;valRerender()};
 $('valExportTxt').onclick=()=>valDownload('VALIDACION_SATELITE_VS_ESTACIONES.txt');
 $('valExportJson').onclick=()=>valDownload('validacion_estaciones.json');
 valLoadStations();
}
valInit();
