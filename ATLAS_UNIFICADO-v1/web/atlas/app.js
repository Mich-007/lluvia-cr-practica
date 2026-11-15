'use strict';
/* =============================================================================
   LLUVIA CA · v6.3 · lógica de la página
   =============================================================================
   Cómo está organizado (para leerlo por partes):

     1. Utilidades y estado
     2. Puntos y CELDAS: clic → ficha de la celda → añadir
     3. Mapa (Leaflet + mapa SVG local de respaldo)
     4. Análisis (petición al backend y espera del resultado)
     5. Estilo común de gráficos: layout, círculo de %, abanico de IC, procedencia
     6. Gráficos por pestaña
     7. Paneles de umbrales fijos, idoneidad, tarjetas y tabla
     8. Mapa temático y gráfico flotante (v5, sin cambios de fondo)
     9. Exportaciones e inicio

   Regla de oro: la página NO calcula estadística. Todo número viene del
   backend (backend.py). La página solo dibuja y explica. Así el gráfico, el
   TXT y la tabla nunca pueden mostrar cifras distintas.
   ========================================================================== */

// ---------------------------------------------------------------------------
// 1. UTILIDADES Y ESTADO
// ---------------------------------------------------------------------------
const $=id=>document.getElementById(id);
// Atlas unificado: mismos tonos que la v6.3, más claros para leerse sobre el fondo oscuro de Phyllobytes.
const PAL=['#6fa8ff','#ff9d4d','#b39dff','#ff7f9d','#4fd1c5','#c5d15a'];
const FIXED=[50.8,76.2,101.6,127];
const MONTHS=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

// Colores del círculo de % (mismos que la v5) y de los estados de tendencia.
// Atlas unificado: los colores de estado salen de las variables de Phyllobytes (--c-up naranja ▲,
// --c-down cian ▼, --c-nc gris ●), así cambian solos con los modos daltonismo y contraste alto.
const cssVar=(v,d)=>(getComputedStyle(document.documentElement).getPropertyValue(v).trim()||d);
const COL={get pos(){return cssVar('--c-up','#ff8a24')},get neg(){return cssVar('--c-down','#5fd0ee')},get none(){return cssVar('--c-nc','#b2bcc0')},
           get blue(){return cssVar('--c-barra-a','#98e6f8')},black:'#161616',
           grid:'#e6e6e6',axis:'#9a9a9a',fan:'rgba(40,40,40,0.12)',lime:'#c4df35'};
const STATE={
  creciente:{get color(){return cssVar('--c-up','#ff8a24')},sym:'▲',label:'Aumento con evidencia',short:'sig. ↑'},
  decreciente:{get color(){return cssVar('--c-down','#5fd0ee')},sym:'▼',label:'Disminución con evidencia',short:'sig. ↓'},
  no_concluyente:{get color(){return cssVar('--c-nc','#b2bcc0')},sym:'●',label:'No concluyente',short:'n. s.'},
  datos_insuficientes:{color:'#a9a9a9',sym:'○',label:'Datos insuficientes',short:'< 10 años'}
};
const VERDICT={apta:{label:'Celda apta',cls:'ok'},reservas:{label:'Apta con reservas',cls:'warn'},
  no_recomendada:{label:'No recomendada',cls:'bad'},fuera:{label:'Fuera de Centroamérica',cls:'bad'}};
const LEVEL={apto:{label:'Apto',cls:'ok',icon:'✔'},apto_con_reservas:{label:'Apto con reservas',cls:'warn',icon:'⚠'},
  no_apto:{label:'No apto',cls:'bad',icon:'✖'}};
const CHECK_ICON={ok:'✔',aviso:'⚠',no:'✖',info:'ℹ'};
const GRID_TEXT={gpm:{badge:'IMERG 0,1°',hint:'Malla: IMERG 0,1° × 0,1° · cada celda ≈ 11 × 11 km'},
  merra2:{badge:'MERRA-2 ½°×⅝°',hint:'Malla: MERRA-2 ½° × ⅝° · cada celda ≈ 55 × 69 km (regional)'},
  csv:{badge:'Malla del CSV',hint:'Malla: la define el producto del CSV (resolución no verificable aquí)'}};

const state={places:[],points:[],result:null,activeTab:'annual',map:null,mapMarkers:[],countries:null,job:null,
  mapThematic:[],mapOverlayPoint:0,cellLayers:[],previewLayer:null,preview:null};
let lastPoll=null;

function norm(s){return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim()}
function escapeHTML(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
const fmt=(v,n=1)=>v===null||v===undefined||!Number.isFinite(Number(v))?'—':new Intl.NumberFormat('es-CR',{minimumFractionDigits:n,maximumFractionDigits:n}).format(Number(v));
const fmtS=(v,n=1)=>v===null||v===undefined||!Number.isFinite(Number(v))?'—':(v>0?'+':'')+fmt(v,n);
// Un p de 0,0000 no existe: se escribe «< 0,001».
const fmtP=p=>p===null||p===undefined?'—':p<0.001?'< 0,001':fmt(p,3);
// «p = 0,012» o «p < 0,001»: nunca «p = < 0,001».
const pEq=p=>p!==null&&p!==undefined&&p<0.001?'< 0,001':'= '+fmtP(p);
function message(title,description,cls=''){
 $('statusArea').className='status-card '+cls;
 $('statusArea').innerHTML=`<span class="status-icon">${cls==='error'?'⚠':cls==='progress'?'◌':'◎'}</span><div><strong>${escapeHTML(title)}</strong><p>${escapeHTML(description)}</p></div>`;
 $('statusArea').hidden=false;
}
function setBusy(b){$('analyzeBtn').disabled=b;$('analyzeBtn').firstElementChild.textContent=b?'Procesando observaciones…':'Analizar precipitación'}
function showError(e){message('Error de consulta',String(e.message||e),'error');setBusy(false);console.error(e)}
function pointColor(i){return PAL[i%PAL.length]}
function coord(p){return `${(+p.lat).toFixed(3)}°, ${(+p.lon).toFixed(3)}°`}
function coordLong(lat,lon){return `${Math.abs(lat).toFixed(5)}° ${lat>=0?'N':'S'} · ${Math.abs(lon).toFixed(5)}° ${lon<0?'O':'E'}`}
function stateOf(tr){return tr?.estado||(tr?.slope_per_decade==null?'datos_insuficientes':'no_concluyente')}
function pBest(tr){return tr?.kendall_p_holm??tr?.kendall_p_hr??tr?.kendall_p??null}
function stateChip(tr){const s=STATE[stateOf(tr)];return `<span class="state-chip" style="background:${s.color}">${s.sym} ${s.label}</span>`}
function sourceNow(){return $('source').value}
function areaNow(){return $('areaMode').value}

// ---------------------------------------------------------------------------
// 2. PUNTOS Y CELDAS
// ---------------------------------------------------------------------------
// Flujo v6:  clic / coordenadas / búsqueda  →  previewLocation()
//            → el backend devuelve la ficha de la celda (/api/cell)
//            → se dibuja la celda y se muestra la ficha
//            → el usuario pulsa «Añadir al análisis»  →  commitPreview()
// Así nadie añade, sin saberlo, un punto cuya celda es casi toda mar.

async function fetchCell(lat,lon){
 const qs=new URLSearchParams({lat,lon,source:sourceNow(),area:areaNow()});
 const r=await fetch('/api/cell?'+qs);const d=await r.json();
 if(!r.ok)throw Error(d.error||'No se pudo evaluar la celda');
 return d;
}

// Nombre de la v5 conservado: ahora abre la vista previa en vez de añadir directo.
function addPoint(p){return previewLocation(p)}

async function previewLocation(p){
 const lat=+p.lat,lon=+p.lon;
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<5||lat>19.5||lon< -94||lon> -76){
  message('Coordenada fuera del mapa','Selecciona un punto entre Guatemala y Panamá, dentro de alguno de los siete países.','error');return
 }
 let rep;
 try{rep=await fetchCell(lat,lon)}catch(e){showError(e);return}
 state.preview={name:p.name||`Punto ${state.points.length+1}`,lat,lon,report:rep,
   source:p.reference?'Catálogo aproximado':p.osm_label?'OpenStreetMap':p.typed?'Coordenada escrita':'Clic en mapa'};
 renderCellCard();
 drawPreviewCell();
}

function cellDims(c){
 if(!c?.available)return 'Resolución definida por el CSV';
 return `≈ ${fmt(c.width_km,1)} × ${fmt(c.height_km,1)} km (${fmt(c.width_m,0)} × ${fmt(c.height_m,0)} m) · ${fmt(c.area_km2,0)} km²`;
}

function landBar(fr){
 if(!fr)return '';
 const a=(fr.pais??fr.costa_rica)*100,b=fr.otro_pais*100,c=fr.mar*100;
 return `<div class="landbar" title="Composición de la celda"><span style="width:${a}%" class="lb-cr"></span><span style="width:${b}%" class="lb-oth"></span><span style="width:${c}%" class="lb-sea"></span></div>
 <div class="landlegend"><span><i class="lb-cr"></i>${escapeHTML(fr.country||'País')} ${fmt(a,0)} %</span><span><i class="lb-sea"></i>Mar ${fmt(c,0)} %</span>${b>0?`<span><i class="lb-oth"></i>Otro país ${fmt(b,0)} %</span>`:''}</div>`;
}

function sameCellIndex(rep){
 const id=rep?.cell?.cell_id;if(!id)return -1;
 return state.points.findIndex(q=>q.report?.cell?.cell_id===id);
}

function renderCellCard(){
 const pv=state.preview,box=$('cellCard');
 if(!pv){box.hidden=true;return}
 const rep=pv.report,c=rep.cell,v=VERDICT[rep.verdict]||VERDICT.fuera;
 const dup=sameCellIndex(rep);
 const full=state.points.length>=6;
 const blockLimit=areaNow()==='block3'&&state.points.length>=3;
 let btn='';
 if(rep.accepted&&!full&&!blockLimit){
  const risky=rep.verdict==='no_recomendada'||dup>=0;
  btn=`<button id="ccAdd" class="cc-add ${risky?'risky':''}">${risky?'Añadir de todos modos':'Añadir al análisis'}</button>`;
 }
 box.innerHTML=`<div class="cc-head"><strong>${escapeHTML(pv.name)}</strong><button id="ccClose" title="Cerrar">×</button></div>
  <div class="cc-coords">${coordLong(pv.lat,pv.lon)}</div>
  <span class="verdict-chip ${v.cls}">${v.label}</span>
  ${c?`<dl class="cc-dl"><dt>Celda del producto</dt><dd>${escapeHTML(c.available?c.grid_label:'Sin malla conocida')}${c.available?` · centro ${c.center_lat.toFixed(2)}°, ${c.center_lon.toFixed(2)}°`:''}</dd>
  <dt>Área que representa</dt><dd>${cellDims(c)}${c.block>1?' · 3 × 3 celdas':''}</dd></dl>`:''}
  ${landBar(rep.land_fraction)}
  <ul class="cc-msgs">${rep.messages.map(m=>`<li>${escapeHTML(m)}</li>`).join('')}
  ${dup>=0?`<li class="warn">Cae en la misma celda que «${escapeHTML(state.points[dup].name)}»: recibiría exactamente la misma serie.</li>`:''}
  ${full?'<li class="warn">Ya hay 6 puntos: quita uno para añadir este.</li>':''}
  ${blockLimit?'<li class="warn">El modo 3 × 3 admite 3 puntos como máximo.</li>':''}</ul>
  ${btn}`;
 box.hidden=false;
 $('ccClose').onclick=()=>{state.preview=null;box.hidden=true;clearPreviewCell()};
 if($('ccAdd'))$('ccAdd').onclick=commitPreview;
}

function commitPreview(){
 const pv=state.preview;if(!pv)return;
 if(state.points.some(x=>Math.abs(x.lat-pv.lat)<0.00001&&Math.abs(x.lon-pv.lon)<0.00001))return;
 state.points.push({name:pv.name,lat:pv.lat,lon:pv.lon,source:pv.source,report:pv.report});
 state.preview=null;$('cellCard').hidden=true;clearPreviewCell();
 renderPoints();refreshMarkers();
 const p=state.points[state.points.length-1];
 message('Punto añadido',`${p.name}: ${coord(p)} · ${cellDims(p.report.cell)}. Puedes añadir otro punto o iniciar el análisis.`);
}

function addFreeCoordinates(){
 const lat=+$('freeLat').value,lon=+$('freeLon').value;
 if(!$('freeLat').value||!$('freeLon').value||!Number.isFinite(lat)||!Number.isFinite(lon)){
  message('Coordenadas incompletas','Escribe latitud y longitud numéricas.','error');return
 }
 previewLocation({name:$('freePointName').value.trim()||`Punto libre ${state.points.length+1}`,lat,lon,typed:true});
 $('freeLat').value='';$('freeLon').value='';$('freePointName').value='';
 if(state.map)state.map.setView([lat,lon],11);
}

// Si cambia la fuente o el modo de área, cambia la celda: se vuelve a pedir.
let cellRefreshToken=0;
async function refreshAllCells(){
 const token=++cellRefreshToken;
 const loaded=await Promise.all(state.points.map(async p=>{try{return await fetchCell(p.lat,p.lon)}catch(e){console.warn(e);return null}}));
 if(token!==cellRefreshToken)return;
 state.points.forEach((p,i)=>{if(loaded[i])p.report=loaded[i]});
 if(state.preview){try{state.preview.report=await fetchCell(state.preview.lat,state.preview.lon);if(token===cellRefreshToken){renderCellCard();drawPreviewCell()}}catch(e){console.warn(e)}}
 if(token!==cellRefreshToken)return;
 renderPoints();refreshMarkers();
}

function renderPoints(){
 $('pointCount').textContent=state.points.length+'/6';
 $('selectedPoints').innerHTML=state.points.length?state.points.map((p,i)=>{
  const rep=p.report||{},v=VERDICT[rep.verdict];
  const land=rep.land_fraction?` · ${fmt((rep.land_fraction.pais??rep.land_fraction.costa_rica)*100,0)} % tierra`:'';
  return `<div class="pointitem"><span class="pointbadge" style="background:${pointColor(i)}">${i+1}</span><div class="pointinfo"><strong>${escapeHTML(p.name)}</strong><small>${coord(p)} · ${escapeHTML(p.source)}</small>
  <small class="cellline">${rep.cell?.available?`Celda ≈ ${fmt(rep.cell.width_km,0)} × ${fmt(rep.cell.height_km,0)} km${land}`:'Resolución del CSV'}${v?` · <b class="v-${v.cls}">${v.label}</b>`:''}</small></div><button class="remove" data-index="${i}" title="Quitar punto">✕</button></div>`}).join(''):'<div class="empty-points">Selecciona un lugar en el mapa o búscalo aquí.</div>';
 document.querySelectorAll('button.remove').forEach(b=>b.onclick=()=>{state.points.splice(+b.dataset.index,1);renderPoints();refreshMarkers()});
 renderInputCards();
}
function findPlace(q){
 const n=norm(q);
 return state.places.find(p=>norm(p.name)===n)||state.places.find(p=>norm(p.name).startsWith(n)&&n.length>3)||null
}
async function addByName(){
 const q=$('placeSearch').value.trim();if(!q)return;
 const local=findPlace(q);
 if(local){previewLocation(local);$('placeSearch').value='';if(state.map)state.map.setView([local.lat,local.lon],10);return}
 message('Buscando lugar en Centroamérica…','Consultando geocodificación de OpenStreetMap, no datos de lluvia.','progress');
 try{
  const r=await fetch('/api/geocode?name='+encodeURIComponent(q));const d=await r.json();if(!r.ok)throw Error(d.error||'Lugar no encontrado');
  previewLocation(d);$('placeSearch').value='';
  if(state.map)state.map.setView([d.lat,d.lon],11);$('statusArea').hidden=true;
 }catch(e){showError(e)}
}

// ---------------------------------------------------------------------------
// 3. MAPA
// ---------------------------------------------------------------------------
function mercator(lat){return Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))*180/Math.PI}
function project(lon,lat){return [(lon+94)*1000/18,(mercator(19.5)-mercator(lat))*1000/18]}
function invProject(x,y){let m=mercator(19.5)-y*18/1000;return {lon:x*18/1000-94,lat:(2*Math.atan(Math.exp(m*Math.PI/180))-Math.PI/2)*180/Math.PI}}
function svgElement(tag,attrs,par){const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(let k in attrs)node.setAttribute(k,attrs[k]);par.appendChild(node);return node}
function drawFallback(){
 const group=$('fallbackCountries');group.innerHTML='';
 for(let feature of state.countries?.features||[]){
  const coords=feature.geometry?.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry?.coordinates||[];
  for(let poly of coords){
   for(let ring of poly){
    const path=ring.map((c,i)=>{const [x,y]=project(c[0],c[1]);return `${i?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`}).join(' ')+'Z';
    svgElement('path',{d:path,fill:!['Mexico','Colombia'].includes(feature.properties.name)?'#b8c791':'#d8d8d8',stroke:'#ffffff','stroke-width':'1.5',opacity:'.97'},group);
   }
  }
 }
 svgElement('text',{x:560,y:300,fill:'#303030','font-size':25,'font-weight':'700','letter-spacing':3,'text-anchor':'middle'},group).textContent='CENTROAMÉRICA';
 svgElement('text',{x:560,y:332,fill:'#404040','font-size':13,'text-anchor':'middle'},group).textContent='Haz clic para ver la celda de cualquier punto';
 const names=['Ciudad de Guatemala','Belmopán','San Salvador','Tegucigalpa','Managua','San José','Ciudad de Panamá'];
 const g=$('fallbackSites');g.innerHTML='';
 for(const name of names){const p=findPlace(name);if(!p)continue;const [x,y]=project(p.lon,p.lat);
  const grp=svgElement('g',{style:'cursor:pointer'},g);
  svgElement('circle',{cx:x,cy:y,r:5,fill:'#c06a24',stroke:'#fff','stroke-width':2},grp);
  svgElement('text',{x:x+7,y:y-8,'font-size':'11',fill:'#303030','font-weight':600},grp).textContent=name.replace('Parque Nacional ','PN ');
  grp.addEventListener('click',e=>{e.stopPropagation();previewLocation(p)});
 }
 $('fallbackMap').onclick=e=>{
  const pt=$('fallbackMap').createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;
  const xy=pt.matrixTransform($('fallbackMap').getScreenCTM().inverse());const p=invProject(xy.x,xy.y);
  previewLocation({name:`Punto ${state.points.length+1}`,lat:p.lat,lon:p.lon});
 };
 refreshMarkers();
}

// Rectángulos de las celdas: cada punto dibuja la celda real que usará.
function cellBounds(rep){const c=rep?.cell;return c?.available?[[c.lat_min,c.lon_min],[c.lat_max,c.lon_max]]:null}
function drawCells(){
 const show=$('showCells')?.checked!==false;
 if(state.map&&window.L){
  state.cellLayers.forEach(l=>state.map.removeLayer(l));state.cellLayers=[];
  if(show)state.points.forEach((p,i)=>{const b=cellBounds(p.report);if(!b)return;
   const l=L.rectangle(b,{color:pointColor(i),weight:2,fillColor:pointColor(i),fillOpacity:.10,interactive:false}).addTo(state.map);
   state.cellLayers.push(l)});
 }
 const g=$('fallbackCells');if(!g)return;g.innerHTML='';
 if(show)state.points.forEach((p,i)=>{const c=p.report?.cell;if(!c?.available)return;
  const [x0,y0]=project(c.lon_min,c.lat_max),[x1,y1]=project(c.lon_max,c.lat_min);
  svgElement('rect',{x:x0,y:y0,width:Math.max(2,x1-x0),height:Math.max(2,y1-y0),fill:pointColor(i),'fill-opacity':.15,stroke:pointColor(i),'stroke-width':1.5},g)});
}
function drawPreviewCell(){
 clearPreviewCell();const rep=state.preview?.report;
 if(state.map&&window.L){
  const pv=state.preview;const b=cellBounds(rep);
  const color=rep?.verdict==='apta'?'#3a7d0a':rep?.verdict==='reservas'?'#b07d00':'#b0281e';
  const layers=[];
  if(b)layers.push(L.rectangle(b,{color,weight:2.5,dashArray:'6 4',fillColor:color,fillOpacity:.12,interactive:false}));
  layers.push(L.circleMarker([pv.lat,pv.lon],{radius:5,color:'#fff',weight:2,fillColor:color,fillOpacity:1,interactive:false}));
  state.previewLayer=L.layerGroup(layers).addTo(state.map);
 }
 const g=$('fallbackCells');const c=rep?.cell;
 if(g&&state.preview){
  if(c?.available){const [x0,y0]=project(c.lon_min,c.lat_max),[x1,y1]=project(c.lon_max,c.lat_min);
   svgElement('rect',{id:'previewRect',x:x0,y:y0,width:Math.max(3,x1-x0),height:Math.max(3,y1-y0),fill:'none',stroke:'#b0281e','stroke-width':2,'stroke-dasharray':'4 3'},g)}
  const [x,y]=project(state.preview.lon,state.preview.lat);
  svgElement('circle',{id:'previewDot',cx:x,cy:y,r:4,fill:'#b0281e',stroke:'#fff','stroke-width':1.5},g);
 }
}
function clearPreviewCell(){
 if(state.previewLayer&&state.map){state.map.removeLayer(state.previewLayer);state.previewLayer=null}
 $('previewRect')?.remove();$('previewDot')?.remove();
}
function refreshMarkers(){
 drawCells();
 const g=$('fallbackMarkers');if(g){g.innerHTML='';state.points.forEach((p,i)=>{
  let [x,y]=project(p.lon,p.lat);const group=svgElement('g',{},g);
  svgElement('circle',{cx:x,cy:y,r:11,fill:pointColor(i),stroke:'#fff','stroke-width':2},group);
  svgElement('text',{x,y:y+4,'font-size':11,'font-weight':700,fill:'#fff','text-anchor':'middle'},group).textContent=i+1;
 })}
 if(state.map&&window.L){state.mapMarkers.forEach(m=>state.map.removeLayer(m));state.mapMarkers=[];
  state.points.forEach((p,i)=>{let m=L.circleMarker([p.lat,p.lon],{radius:9,color:'#fff',weight:2,fillColor:pointColor(i),fillOpacity:1}).bindTooltip(`${i+1}. ${p.name}`,{permanent:false}).addTo(state.map);state.mapMarkers.push(m)});
 }
 if(state.result)renderThematicMap();
}
function tryLeaflet(){
 if(!window.L){$('mapmode').textContent='Mapa local sin librerías externas';return}
 try{
  $('leafletMap').hidden=false;
  // La rueda del ratón solo hace zoom después de hacer clic en el mapa; así
  // desplazar la página por encima del mapa no lo acerca ni aleja sin querer.
  const map=L.map('leafletMap',{zoomControl:true,scrollWheelZoom:false}).fitBounds([[7,-92.5],[18.5,-77]],{padding:[15,15]});
  map.on('click focus',()=>map.scrollWheelZoom.enable());
  map.on('mouseout blur',()=>map.scrollWheelZoom.disable());
  // Teselas de OpenStreetMap. Su política exige Referer: se envía solo el origen
  // (http://127.0.0.1:puerto). Sin él, OSM devuelve teselas «Access blocked».
  // (CARTO se descartó: desde localhost devuelve teselas «API KEY REQUIRED».)
  // Si las teselas fallan, se vuelve al mapa vectorial local, que no depende de internet.
  const osm=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,referrerPolicy:'strict-origin-when-cross-origin',attribution:'© OpenStreetMap contributors'}).addTo(map);
  let tileErrors=0;osm.on('tileerror',()=>{if(++tileErrors===12){$('mapmode').textContent='Teselas de OpenStreetMap no disponibles · se muestran solo las fronteras'}});
  // Límites de los siete países centroamericanos; resolución según la geometría de origen.
  // Atlas unificado: los 7 países elegibles se marcan (relleno suave, borde cian, resaltado al pasar)
  // y llevan su nombre; México y Colombia quedan en gris como contexto no elegible. Los clics
  // siguen llegando al mapa (bubblingMouseEvents), así que la ficha de celda funciona igual.
  if(state.countries){
   const CA=['Guatemala','Belize','El Salvador','Honduras','Nicaragua','Costa Rica','Panama'];
   const sel={color:'#5fd0ee',weight:1.6,opacity:.95,fillColor:'#5fd0ee',fillOpacity:.07,dashArray:null};
   const ctx={color:'#8a979b',weight:1,opacity:.8,fillColor:'#2b3a3e',fillOpacity:.32,dashArray:'3 3'};
   L.geoJSON(state.countries,{style:f=>CA.includes(f.properties.name)?sel:ctx,bubblingMouseEvents:true,
    onEachFeature:(f,layer)=>{if(!CA.includes(f.properties.name))return;
     layer.on('mouseover',()=>layer.setStyle({fillOpacity:.2,weight:2.4}));
     layer.on('mouseout',()=>layer.setStyle({fillOpacity:sel.fillOpacity,weight:sel.weight}))}}).addTo(map);
   const LABELS={'Guatemala':[15.55,-90.35],'Belize':[17.15,-88.75],'El Salvador':[13.72,-88.95],'Honduras':[14.85,-86.75],
    'Nicaragua':[12.85,-85.1],'Costa Rica':[10.45,-84.75],'Panama':[8.55,-80.35]};
   window.atlasPaisEtiquetas=Object.entries(LABELS).map(([name,ll])=>{
    const icon=L.divIcon({className:'pais-etiqueta',html:`<span>${window.atlasNombrePais?window.atlasNombrePais(name):name}</span>`,iconSize:null});
    return {name,marker:L.marker(ll,{icon,interactive:false,keyboard:false}).addTo(map)}});
  }
  map.on('click',e=>{const {lat,lng}=e.latlng;previewLocation({name:`Punto ${state.points.length+1}`,lat,lon:lng})});
  const important=['Ciudad de Guatemala','Belmopán','San Salvador','Tegucigalpa','Managua','San José','Ciudad de Panamá'];
  important.forEach(name=>{let p=findPlace(name);if(!p)return;L.circleMarker([p.lat,p.lon],{radius:5,color:'#fff',weight:1,fillColor:'#db9356',fillOpacity:1}).bindTooltip(p.name).on('click',e=>{L.DomEvent.stopPropagation(e);previewLocation(p)}).addTo(map)});
  state.map=map;$('fallbackMap').style.display='none';$('mapmode').textContent='OpenStreetMap · clic para ver la celda · rueda de zoom tras hacer clic';refreshMarkers();
 }catch(e){console.warn('Mapa Leaflet no disponible, se conserva mapa local',e);$('leafletMap').hidden=true}
}
function loadLeaflet(){
  // El visor básico, mapa vectorial y gráficos no dependen de la conexión CDN.
  let tag=document.createElement('script');
  tag.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  tag.async=true;
  tag.onload=tryLeaflet;
  tag.onerror=()=>{$('mapmode').textContent='Mapa local (sin teselas web)'};
  document.head.appendChild(tag);
}

// ---------------------------------------------------------------------------
// 4. ANÁLISIS
// ---------------------------------------------------------------------------
function getForm(){
 const start_year=+$('startYear').value,end_year=+$('endYear').value,ref_start=+$('refStart').value,ref_end=+$('refEnd').value;
 const wet_min=+$('wetMin').value,source=$('source').value,population=$('population').value,area_mode=areaNow();
 if(state.points.length===0)throw Error('Selecciona al menos un lugar en el mapa.');
 if(!Number.isFinite(start_year)||!Number.isFinite(end_year)||start_year>end_year)throw Error('Período de años inválido.');
 if(ref_start<start_year||ref_end>end_year||ref_start>ref_end)throw Error('La referencia debe estar dentro del período analizado.');
 if(area_mode==='block3'&&source!=='gpm')throw Error('El promedio 3 × 3 solo está disponible para GPM IMERG.');
 if(area_mode==='block3'&&state.points.length>3)throw Error('El promedio 3 × 3 admite 3 puntos como máximo.');
 return {source,start_year,end_year,ref_start,ref_end,wet_min,population,area_mode,points:state.points.map(p=>({name:p.name,lat:p.lat,lon:p.lon}))};
}
async function runAnalysis(){
 try{
  const data=getForm();
  await collectDataInputs(data);
  $('results').hidden=true;setBusy(true);message('Preparando descarga…','Consultando los archivos reales, sin generar datos sintéticos.','progress');
  const res=await fetch('/api/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const p=await res.json();if(!res.ok)throw Error(p.error||'No se pudo iniciar el análisis');state.job=p.job_id;
  await watchJob(p.job_id);
 }catch(e){showError(e)}
}
async function watchJob(jid){
 let done=false;
 while(!done){
  await new Promise(r=>setTimeout(r,1100));
  let response=await fetch('/api/status?id='+encodeURIComponent(jid));
  let job=await response.json();if(!response.ok)throw Error(job.error||'Estado no disponible');
  let log=(job.progress||[]).slice(-3).join('  •  ');
  message('Procesando precipitación…',log,'progress');
  if(job.state==='error')throw Error(job.error||'Error desconocido del proceso');
  if(job.state==='done'){
   done=true;state.result=job.result;
   setBusy(false);$('statusArea').hidden=true;$('results').hidden=false;
   renderResult();
  }
 }
}
function selectedPercentiles(){let x=[...document.querySelectorAll('#pctchecks input:checked')].map(x=>x.value);return x.length?x:['90','95','99']}

// ---------------------------------------------------------------------------
// 5. ESTILO COMÚN DE GRÁFICOS  (mismo sistema visual que mesoamerica-analisis v2)
// ---------------------------------------------------------------------------
// QUÉ HACE QUE UNA FIGURA SE VEA PROFESIONAL (y por qué cada decisión):
//
//  1. Título = la PREGUNTA que responde la figura, en negrita. Debajo, un
//     subtítulo que dice CÓMO LEERLA. Ambos van dentro de la figura, así que
//     viajan con el PNG descargado.
//  2. Marco fino gris claro y rejilla tenue DETRÁS de los datos: la rejilla
//     ayuda a leer valores pero nunca compite con ellos.
//  3. El color CARGA SIGNIFICADO, no decora: la serie observada va en gris
//     oscuro y la tendencia en el color de su estado (azul = aumento con
//     evidencia, rojizo = disminución, gris = no concluyente). Así el ojo
//     encuentra la conclusión antes de leer un número.
//  4. Forma además de color (▲ ▼ ●): legible impresa en gris o con daltonismo.
//  5. Leyenda sin marco dentro del área de datos; barra de herramientas discreta.
//  6. Procedencia en el pie (fuente, celda, período): una figura suelta en una
//     presentación debe poder decir de dónde salió.

//  v6.2 · POR QUÉ ANTES SE VEÍAN «SIMPLES» EN LA PÁGINA (y qué se corrigió):
//   a) El servidor pedía al navegador guardar app.js 1 hora: tras actualizar,
//      se seguían viendo los gráficos viejos. Ahora se revalida siempre.
//   b) Solo se veía UNA figura (la más sencilla, «Acumulados») y el resto
//      quedaba escondido en 19 pestañas. Ahora hay un PANEL con las figuras
//      clave a la vez, y cada figura se puede ampliar a pantalla completa.
//   c) Con la barra lateral de 335 px, en un portátil el gráfico medía ~600 px
//      con letra de 11 px y líneas de 1,6 px, y la leyenda tapaba los datos.
//      Ahora: tipografía Inter más grande, líneas y marcadores más gruesos,
//      leyenda con marco FUERA del área de datos y barra lateral ocultable.
//   d) Faltaban figuras de las referencias: mapa de calor de índices ETCCDI,
//      banda bootstrap en «¿Dónde cambia?» y salto de régimen sobre la serie.
const INK='#111111',SERIES_INK='#3d3d3d',FRAME='#bdbdbd',GRID='#ebebeb';
const FONT='Inter, "Segoe UI", "Helvetica Neue", Arial, sans-serif';
function isObj(v){return v&&typeof v==='object'&&!Array.isArray(v)}
function deepMerge(a,b){const o={...a};for(const k in b){o[k]=isObj(a[k])&&isObj(b[k])?deepMerge(a[k],b[k]):b[k]}return o}

// Estilo de UN eje. Se aplica a todos los ejes de la figura (también xaxis2,
// yaxis3… de los paneles múltiples) mediante polish().
const AXIS={showline:true,mirror:true,linecolor:FRAME,linewidth:1,ticks:'outside',ticklen:5,tickcolor:FRAME,
 tickfont:{size:12.5,color:'#222'},gridcolor:GRID,gridwidth:0.8,zeroline:false,automargin:true,
 title:{font:{size:13.5,color:INK},standoff:10}};

// Parte el subtítulo en líneas: Plotly no lo ajusta solo.
function wrapText(s,n=118){const out=[];let line='';for(const w of String(s||'').split(' ')){if((line+' '+w).trim().length>n){out.push(line.trim());line=w}else line+=' '+w}if(line.trim())out.push(line.trim());return out}

// title2 (opcional): segunda línea del título con la CONCLUSIÓN, en el color
// de su estado (p. ej. «+3,6 días/década · Aumento con evidencia»).
function layout(title,ylab='',opts={},title2=null,title2color=INK){
 // La conclusión (title2) va como PRIMERA línea del subtítulo y no con <br>
 // dentro del título: Plotly ancla mal los títulos de varias líneas y los
 // recorta por arriba en figuras estrechas.
 const base={paper_bgcolor:'#fff',plot_bgcolor:'#fff',font:{family:FONT,size:13,color:INK},
  margin:{t:100,r:28,b:70,l:76},hovermode:'closest',_verdict:title2?[title2,title2color]:null,
  title:{text:`<b>${title}</b>`,font:{size:17.5,color:INK},x:0.008,xanchor:'left',xref:'container',y:0.985,yanchor:'top',yref:'container'},
  xaxis:{title:{text:''}},yaxis:{title:{text:ylab}},
  // Leyenda con marco. polish() la saca a la derecha del área de datos
  // cuando hay espacio, para que nunca tape una serie.
  legend:{x:1.012,xanchor:'left',y:1,yanchor:'top',bgcolor:'rgba(255,255,255,0.96)',bordercolor:'#cfcfcf',borderwidth:1,
          font:{size:12,color:INK},orientation:'v',tracegroupgap:3,itemwidth:34},
  hoverlabel:{bgcolor:'#fff',bordercolor:'#8a8a8a',font:{family:FONT,size:12.5,color:INK}},
  modebar:{bgcolor:'rgba(255,255,255,0)',color:'#b8b8b8',activecolor:'#444'},
  bargap:0.18,shapes:[],annotations:[],_legendOutside:true};
 return deepMerge(base,opts);
}
// Aplica el estilo de eje a todos los ejes y coloca el subtítulo de lectura.
function polish(lo,subtitle){
 for(const k of Object.keys(lo))if(/^[xy]axis\d*$/.test(k))lo[k]=deepMerge(AXIS,lo[k]||{});
 if(!lo.xaxis)lo.xaxis={...AXIS};if(!lo.yaxis)lo.yaxis={...AXIS};
 const prov=(lo.annotations||[]).find(a=>a.name==='procedencia');
 if(prov){const lx=(lo.xaxis2&&lo.xaxis2.anchor==='y2')?'xaxis2':'xaxis';
  // Bajo el eje inferior: espacio para las etiquetas y, si lo hay, su título.
  const t=String(lo[lx]?.title?.text||'');const hasTitle=!!t;const two=t.includes('<br>');
  const extra=lo._provExtra||0;prov.yshift=-(two?70:hasTitle?50:30)-extra;lo.margin.b=Math.max(lo.margin.b,(two?92:hasTitle?70:52)+extra)}
 delete lo._provExtra;
 lo._sub=subtitle||'';
 setSubtitle(lo,1100);
 return lo;
}
// Subtítulo = conclusión (en el color del estado) + cómo leer la figura,
// partido según el ancho REAL del gráfico (Plotly no ajusta el texto solo).
function setSubtitle(lo,width){
 // Si hay círculo de % arriba a la derecha, se le deja espacio.
 const badges=(lo.shapes||[]).filter(sh=>sh.type==='circle'&&sh.xsizemode==='pixel'&&sh.y0>0);
 const minX=badges.length?Math.min(...badges.map(b=>b.xanchor??1)):1;
 const reserve=badges.length?120+(1-minX)*(width-(lo.margin?.l||76)-(lo.margin?.r||28)):0;
 const per=Math.max(40,Math.floor((width-40-reserve)/7.2));
 const lines=wrapText(lo._sub,per);const v=lo._verdict;
 const parts=[];if(v)parts.push(`<span style="font-size:14.5px;color:${v[1]}"><b>${v[0]}</b></span>`);
 parts.push(...lines);
 if(parts.length){lo.title.subtitle={text:parts.join('<br>'),font:{size:13,color:'#4d4d4d'}};
  lo.margin.t=Math.max(lo._baseTop??(lo._baseTop=lo.margin.t),52+(v?22:0)+lines.length*17+16)}
}
// v6.2 · Ajuste final según el ancho real del gráfico:
//  · subtítulo re-partido al ancho;
//  · leyenda FUERA del área de datos: a la derecha si hay ≥ 760 px; debajo
//    del gráfico, en horizontal, si es más estrecho. Nunca tapa una serie.
function fitLegend(lo,width,traces=[]){
 if(width<600){  // celular: título más compacto y sin la segunda línea de los ejes
  lo.title.font={...lo.title.font,size:14.5};
  for(const k of Object.keys(lo))if(/^xaxis\d*$/.test(k)&&typeof lo[k]?.title?.text==='string')lo[k].title.text=lo[k].title.text.split('<br>')[0];
  const prov=(lo.annotations||[]).find(a=>a.name==='procedencia');if(prov&&prov.yshift<-50)prov.yshift=-50;
 }
 placeLegend(lo,width,traces);
 if(lo._sub!==undefined)setSubtitle(lo,width);   // después: el margen derecho ya es el definitivo
 for(const k of ['_legendOutside','_verdict','_sub','_baseTop'])delete lo[k];
 return lo;
}
function placeLegend(lo,width,traces){
 const outside=lo._legendOutside;
 if(lo.showlegend===false)return;
 const horizontal=lo.legend?.orientation==='h';
 if(!outside&&!horizontal)return;
 const names=traces.filter(t=>t.showlegend!==false&&t.name&&t.type!=='heatmap').map(t=>String(t.name).replace(/<[^>]+>/g,''));
 if(outside&&!horizontal&&width>=760){
  lo.legend={...lo.legend,x:1.012,xanchor:'left',y:1,yanchor:'top'};
  const longest=Math.max(10,...names.map(n=>n.length));lo.margin.r=Math.max(lo.margin.r,Math.min(300,60+longest*6.9));return}
 // Debajo del gráfico, en horizontal: se estima cuántas filas ocupará.
 const usable=Math.max(200,width-40);let rows=1,x=0;
 for(const n of names){const w=44+n.length*6.6;if(x+w>usable){rows++;x=w}else x+=w}
 lo.legend={...lo.legend,orientation:'h',x:0,xanchor:'left',y:0,yanchor:'bottom',yref:'container',bgcolor:'rgba(255,255,255,0)',borderwidth:0,font:{size:11.5,color:INK}};
 lo.margin.b=(lo.margin.b||70)+rows*21+8;
}
const PLOT={responsive:true,displaylogo:false,displayModeBar:'hover',modeBarButtonsToRemove:['select2d','lasso2d','autoScale2d'],toImageButtonOptions:{format:'png',filename:'NASA_precipitacion_grafico',height:760,width:1280,scale:2}};

function provenanceText(point){
 const r=state.result;if(!r)return '';
 const c=point?.cell_report?.cell;
 const cell=c?.available?` · ${c.grid_label}${c.block>1?' (3×3)':''} ≈ ${fmt(c.width_km,0)}×${fmt(c.height_km,0)} km, centro ${c.center_lat.toFixed(2)}°, ${c.center_lon.toFixed(2)}°`:'';
 return `Fuente: ${r.source_label}${cell} · ${r.start_year}–${r.end_year}, referencia ${r.ref_start}–${r.ref_end} · Theil–Sen, Mann-Kendall (Hamed-Rao) y Holm · Lluvia CA v6.3`;
}
// La procedencia se ancla al borde inferior del área de datos (xref/yref
// 'paper') y se baja con yshift hasta el pie. OJO: en Plotly las anotaciones
// NO aceptan 'container'; si se usa, Plotly las ubica en el eje de datos
// (en el año 0) y estira todo el eje. Ese error ya ocurrió aquí.
function withProvenance(lo,point){
 lo.annotations=[...(lo.annotations||[]),{name:'procedencia',xref:'paper',yref:'paper',x:0,y:0,xanchor:'left',yanchor:'top',
  showarrow:false,align:'left',text:escapeHTML(provenanceText(point)),font:{size:9,color:'#7a7a7a'}}];
 return lo;
}

// Color de una tendencia según su estado (la conclusión, no la decoración).
function stateColor(tr){return STATE[stateOf(tr)].color}
function hexA(hex,a){const n=parseInt(hex.slice(1),16);return `rgba(${n>>16},${(n>>8)&255},${n&255},${a})`}

// EL CÍRCULO DE PORCENTAJE (el de la esquina de la v5), dibujado DENTRO de
// Plotly para que también salga en el PNG exportado.
// Muestra relative_change_pct = 100·(ajuste final − ajuste inicial)/ajuste inicial,
// y debajo el estado (▲ sig. / ● n. s.). El % describe cuánto cambió la recta
// en el período; NO es una probabilidad ni prueba significancia.
function fixedId(t){return Number(t).toFixed(1).replace('.','_')}
function fixedChange(tr){return tr?.relative_change_pct===null||tr?.relative_change_pct===undefined?'—':`${tr.relative_change_pct>0?'+':''}${fmt(tr.relative_change_pct,0)}%`}
// side:'right' coloca el círculo FUERA del panel, a su derecha (paneles múltiples).
function badgeOverlay(tr,{x=1,y=1,size=64,inside=false,side=null}={}){
 const v=tr?.relative_change_pct,st=STATE[stateOf(tr)];
 const color=v===null||v===undefined?COL.none:v<0?COL.neg:COL.pos;
 let x0=-size,x1=0,y0=inside?-size-4:6,y1=inside?-4:size+6;
 if(side==='right'){x0=8;x1=size+8;y0=-size;y1=0}
 return {shapes:[{type:'circle',xref:'paper',yref:'paper',xsizemode:'pixel',ysizemode:'pixel',xanchor:x,yanchor:y,
   x0,x1,y0,y1,fillcolor:color,line:{color:'#fff',width:2},layer:'above'}],
  annotations:[{xref:'paper',yref:'paper',x,y,xanchor:'center',yanchor:'middle',xshift:(x0+x1)/2,yshift:(y0+y1)/2,
   showarrow:false,align:'center',font:{color:'#fff',size:(size>=60?16:13)-(fixedChange(tr).length>6?3:fixedChange(tr).length>5?1.5:0),family:FONT},
   text:`<b>${fixedChange(tr)}</b><br><span style="font-size:${size>=60?9.5:8.5}px">${st.sym} ${st.short}</span>`,
   hovertext:`Cambio de la recta ${tr?.first_year??''}–${tr?.last_year??''}: ${fixedChange(tr)} · ${st.label} (p Holm ${fmtP(pBest(tr))})`}]};
}
function addBadge(lo,tr,opt){const b=badgeOverlay(tr,opt);lo.shapes=[...(lo.shapes||[]),...b.shapes];lo.annotations=[...(lo.annotations||[]),...b.annotations];
 if(!opt||!opt.inside)lo.margin.r=Math.max(lo.margin.r,24);return lo}

// Serie observada: gris oscuro con marcadores pequeños. Las demás series de
// contexto van más claras para no competir con la del punto enfocado.
function obsTrace(x,y,name,{focus=true,color=SERIES_INK,xaxis,yaxis}={}){
 return {x,y,name,type:'scatter',mode:'lines+markers',xaxis,yaxis,connectgaps:false,
  line:{color:focus?color:hexA(color,0.5),width:focus?2.2:1.2},
  marker:{size:focus?7.5:4,color:focus?color:hexA(color,0.5),line:{color:'#fff',width:focus?1.1:0}},
  hovertemplate:`%{x}: %{y:,.1f}<extra>${escapeHTML(name)}</extra>`};
}
// Recta de Theil-Sen (en el color del estado) y su «abanico» del IC 95 %:
// dos rectas con las pendientes extremas del intervalo, girando sobre el
// punto central de la serie.
function trendLine(tr,name,color,width=3.2,xaxis,yaxis){
 if(tr?.slope_per_decade==null)return [];
 color=color||stateColor(tr);
 return [{x:[tr.first_year,tr.last_year],y:[tr.fitted_start,tr.fitted_end],type:'scatter',mode:'lines',
  name:name||`Theil–Sen ${fmtS(tr.slope_per_decade,tr.slope_per_decade>=10||tr.slope_per_decade<=-10?0:2)}/década`,
  line:{color,width},xaxis,yaxis,hovertemplate:`Tendencia ${fmtS(tr.slope_per_decade,2)} por década<extra></extra>`}];
}
function senFan(tr,xaxis,yaxis,color){
 if(tr?.ci_low_per_decade==null||tr?.pivot_year==null)return [];
 const fill=color||hexA(stateColor(tr),0.17);
 const xs=[tr.first_year,tr.pivot_year,tr.last_year],f=(x,s)=>tr.pivot_value+s/10*(x-tr.pivot_year);
 const up=xs.map(x=>Math.max(f(x,tr.ci_low_per_decade),f(x,tr.ci_high_per_decade)));
 const dn=xs.map(x=>Math.min(f(x,tr.ci_low_per_decade),f(x,tr.ci_high_per_decade)));
 return [{x:xs,y:up,type:'scatter',mode:'lines',line:{width:0},hoverinfo:'skip',showlegend:false,xaxis,yaxis},
  {x:xs,y:dn,type:'scatter',mode:'lines',line:{width:0},fill:'tonexty',fillcolor:fill,name:'IC 95 % de la pendiente',hoverinfo:'skip',xaxis,yaxis}];
}
// Línea de referencia horizontal con su etiqueta a la derecha.
function refLine(lo,y,label,{yref='y',xref='paper'}={}){
 lo.shapes.push({type:'line',xref,yref,x0:0,x1:1,y0:y,y1:y,line:{color:'#8a8a8a',width:1.1,dash:'dash'},layer:'below'});
 lo.annotations.push({xref,yref,x:1,y,xanchor:'right',yanchor:'bottom',showarrow:false,text:label,font:{size:10,color:'#6a6a6a'}});
}
function trendReading(name,tr,unit,what){
 if(tr?.slope_per_decade==null)return `${name}: hay menos de 10 años completos; no se calcula tendencia para ${what}.`;
 return `<b>${escapeHTML(name)}</b> · ${what}: ${fmtS(tr.slope_per_decade,unit==='mm'?0:2)} ${unit}/década (IC 95 %: ${fmtS(tr.ci_low_per_decade,unit==='mm'?0:2)} a ${fmtS(tr.ci_high_per_decade,unit==='mm'?0:2)}). `+
  `${stateChip(tr)} p Holm ${pEq(pBest(tr))}. El círculo (${fixedChange(tr)}) es el cambio de la recta entre ${tr.first_year} y ${tr.last_year}; no es una probabilidad.`;
}

// v6.2 · Segunda línea del título: la conclusión, en el color de su estado.
function verdictLine(tr,unit,dec=1){
 if(tr?.slope_per_decade==null)return [null,INK];
 const st=STATE[stateOf(tr)];
 return [`Theil–Sen ${fmtS(tr.slope_per_decade,dec)} ${unit}/década · ${st.sym} ${st.label}`,st.color];
}
// v6.2 · Salto de régimen dibujado SOBRE la serie (línea vertical discontinua),
// solo si Pettitt p < 0,05 y la comparación BIC prefiere «salto» o «ambos».
function regimeOverlay(lo,traces,cp){
 const m=cp?.models||{},pt=cp?.pettitt||{},cut=m.anio_corte;
 if(!cut||!['salto','ambos'].includes(m.modelo_preferido)||!(pt.p<0.05))return null;
 const col=cp.instrumental_flag?'#b0281e':'#7a6237';
 lo.shapes.push({type:'line',xref:'x',yref:'paper',x0:cut-0.5,x1:cut-0.5,y0:0,y1:1,line:{color:col,width:2.2,dash:'dash'},layer:'above'});
 traces.push({x:[null],y:[null],type:'scatter',mode:'lines',line:{color:col,width:2.2,dash:'dash'},hoverinfo:'skip',
  name:`Salto de régimen (${cut})${cp.instrumental_flag?' · ⚠ ¿instrumento?':''}`});
 return cut;
}

// ---------------------------------------------------------------------------
// 6. GRÁFICOS POR PESTAÑA
// ---------------------------------------------------------------------------
function selectedPoint(){let i=+$('focusedPoint').value;return state.result?.points[i]||state.result?.points[0]}

// Series disponibles para las pestañas avanzadas. Cada entrada sabe cómo leer
// su tendencia (del backend) y su serie anual.
const SERIES={
 annual:{label:'Lluvia total anual',unit:'mm',tr:p=>p.summary.annual_trend,ys:p=>p.annual.map(r=>r.total)},
 'fixed_50.8':{label:'Días ≥ 50,8 mm',unit:'días',tr:p=>p.summary.fixed_threshold_trends['50.8'],ys:p=>p.annual.map(r=>r.fixed_days['50.8'])},
 'fixed_76.2':{label:'Días ≥ 76,2 mm',unit:'días',tr:p=>p.summary.fixed_threshold_trends['76.2'],ys:p=>p.annual.map(r=>r.fixed_days['76.2'])},
 'fixed_101.6':{label:'Días ≥ 101,6 mm',unit:'días',tr:p=>p.summary.fixed_threshold_trends['101.6'],ys:p=>p.annual.map(r=>r.fixed_days['101.6'])},
 fixed_127:{label:'Días ≥ 127 mm',unit:'días',tr:p=>p.summary.fixed_threshold_trends['127'],ys:p=>p.annual.map(r=>r.fixed_days['127'])},
 P95:{label:'Días > P95',unit:'días',tr:p=>p.summary.extreme_count_trends['95'],ys:p=>p.annual.map(r=>r.exceedances['95'])},
 P99:{label:'Días > P99',unit:'días',tr:p=>p.summary.extreme_count_trends['99'],ys:p=>p.annual.map(r=>r.exceedances['99'])},
 wet_days:{label:'Días lluviosos',unit:'días',tr:p=>p.advanced?.concentration?.trends?.wet_days,ys:p=>p.annual.map(r=>r.wet_days)},
 sdii:{label:'Intensidad media (SDII)',unit:'mm/día',tr:p=>p.advanced?.concentration?.trends?.sdii,ys:p=>p.annual.map(r=>r.rainy_mean)},
 r95share:{label:'% del total en días > P95',unit:'pp',tr:p=>p.advanced?.concentration?.trends?.r95_share_pct,ys:p=>p.advanced?.concentration?.r95_share_pct||[]},
 dry:{label:'Temporada seca (dic-abr)',unit:'mm',tr:p=>p.advanced?.seasonal?.trend_dry,ys:p=>p.advanced?.seasonal?.dry||[]},
 rainy:{label:'Temporada lluviosa (may-nov)',unit:'mm',tr:p=>p.advanced?.seasonal?.trend_rainy,ys:p=>p.advanced?.seasonal?.rainy||[]}
};
const ADV_OPTIONS={
 forest:['annual','fixed_50.8','fixed_76.2','fixed_101.6','fixed_127','P95','P99','wet_days','sdii','r95share','dry','rainy'],
 regime:[['annual_total','Lluvia total anual'],['fixed_50.8','Días ≥ 50,8 mm'],['P95','Días > P95']]
};
function configureAdvSelect(){
 const tab=state.activeTab,sel=$('advMetric'),opts=ADV_OPTIONS[tab];
 $('advMetricWrap').hidden=!opts;
 if(!opts)return;
 const prev=sel.dataset.tab===tab?sel.value:null;
 sel.innerHTML=opts.map(o=>Array.isArray(o)?`<option value="${o[0]}">${o[1]}</option>`:`<option value="${o}">${SERIES[o].label}</option>`).join('');
 sel.dataset.tab=tab;if(prev&&[...sel.options].some(o=>o.value===prev))sel.value=prev;
}

// v6.2: recibe la pestaña y la serie como parámetros para poder dibujar la
// misma figura en la pestaña, en el panel de figuras y a pantalla completa.
function chartData(tab=state.activeTab,metric=null){
 const points=state.result.points;const focus=selectedPoint();const focusPct=$('focusedPct').value;
 const fi=points.indexOf(focus);const R=state.result;
 let traces=[],lo,caption='',reading='',heightOverride=null;
 // Series de los demás puntos como contexto (tenues), la enfocada en gris oscuro.
 const context=(getY,label)=>points.forEach((p,i)=>{if(p===focus)return;const rows=p.annual;
  traces.push(obsTrace(rows.map(r=>r.year),rows.map(getY),p.name,{focus:false,color:pointColor(i)}))});

 if(tab==='annual'){
  const tr=focus.summary.annual_trend;
  caption=`Serie anual (solo años con 100 % de días válidos), recta de Theil–Sen en el color de su estado y banda del IC 95 %. Línea discontinua: media ${R.ref_start}–${R.ref_end}.`;
  context(r=>r.total);
  traces.push(...senFan(tr),obsTrace(focus.annual.map(r=>r.year),focus.annual.map(r=>r.total),focus.name),...trendLine(tr));
  const [v2,c2]=verdictLine(tr,'mm',0);
  lo=layout(`¿Cambió la lluvia total anual? · ${focus.name}`,'Precipitación anual (mm)',{xaxis:{tickformat:'d',title:{text:'Año'}}},v2,c2);
  const ref=focus.summary.reference_mean_annual_mm;
  if(ref!=null)refLine(lo,ref,`media ${R.ref_start}–${R.ref_end}: ${fmt(ref,0)} mm`);
  regimeOverlay(lo,traces,focus.advanced?.change_points?.annual_total);
  addBadge(lo,tr);reading=trendReading(focus.name,tr,'mm','lluvia anual');
 }else if(tab==='forest'){
  // FOREST PLOT (el gráfico estrella del v2): pendiente ± IC 95 % de cada
  // punto en la misma escala. Barra que cruza el cero → no concluyente.
  const key=metric||(state.activeTab==='forest'?$('advMetric').value:'')||'annual',S=SERIES[key]||SERIES.annual;
  caption=`Cada fila es un punto: el marcador es la pendiente y la barra su intervalo de confianza del 95 %. Si la barra cruza la línea del cero, no hay evidencia suficiente. Ordenado de menor a mayor.`;
  const rows=points.map((p,i)=>({p,i,tr:S.tr(p)||{}})).filter(r=>r.tr.slope_per_decade!=null).sort((a,b)=>a.tr.slope_per_decade-b.tr.slope_per_decade);
  const SHAPE={creciente:'triangle-up',decreciente:'triangle-down',no_concluyente:'circle',datos_insuficientes:'circle-open'};
  // v6.2: banda ancha y tenue = IC 95 % bootstrap (bloques móviles); línea
  // fina con topes = IC 95 % analítico de Sen. Si coinciden, la conclusión no
  // depende del método.
  rows.forEach(r=>{if(r.tr.boot_ci_low_per_decade==null)return;const st=STATE[stateOf(r.tr)];
   traces.push({x:[r.tr.boot_ci_low_per_decade,r.tr.boot_ci_high_per_decade],y:[r.p.name,r.p.name],type:'scatter',mode:'lines',showlegend:false,
    line:{color:hexA(st.color,0.22),width:16},hovertemplate:`IC 95 % bootstrap: ${fmtS(r.tr.boot_ci_low_per_decade,2)} a ${fmtS(r.tr.boot_ci_high_per_decade,2)}<extra>${escapeHTML(r.p.name)}</extra>`})});
  traces.push(...rows.map(r=>{const k=stateOf(r.tr),st=STATE[k];return {x:[r.tr.slope_per_decade],y:[r.p.name],type:'scatter',mode:'markers',showlegend:false,
   marker:{size:15,color:st.color,symbol:SHAPE[k],line:{color:'#fff',width:1.6}},
   error_x:{type:'data',symmetric:false,array:[r.tr.ci_high_per_decade-r.tr.slope_per_decade],arrayminus:[r.tr.slope_per_decade-r.tr.ci_low_per_decade],color:st.color,thickness:2.6,width:9},
   hovertemplate:`${escapeHTML(r.p.name)}<br>${fmtS(r.tr.slope_per_decade,2)} ${S.unit}/década<br>IC 95 % Sen: ${fmtS(r.tr.ci_low_per_decade,2)} a ${fmtS(r.tr.ci_high_per_decade,2)}<br>p Holm ${fmtP(pBest(r.tr))} · ${st.label}<extra></extra>`}}));
  // Leyenda: forma + color + texto (no depende solo del color).
  for(const k of ['creciente','decreciente','no_concluyente'])traces.push({x:[null],y:[null],type:'scatter',mode:'markers',name:STATE[k].label,marker:{size:11,color:STATE[k].color,symbol:SHAPE[k]}});
  const hasBoot=rows.some(r=>r.tr.boot_ci_low_per_decade!=null);
  lo=layout(`¿Dónde cambia? · ${S.label}`,'',{margin:{l:40,r:104,b:86,t:118},
   xaxis:{title:{text:`Cambio en ${S.unit} por década<br><span style="font-size:11.5px;color:var(--suave)">línea = IC 95 % analítico (Sen)${hasBoot?' · banda = IC 95 % bootstrap por bloques':''}</span>`},zeroline:true,zerolinecolor:SERIES_INK,zerolinewidth:1.6},
   yaxis:{type:'category',showgrid:true,gridcolor:'#f2f2f2',tickfont:{size:13}},
   legend:{orientation:'h'},_legendOutside:false});
  rows.forEach(r=>lo.annotations.push({xref:'paper',x:1.012,y:r.p.name,xanchor:'left',showarrow:false,text:`p ${pEq(pBest(r.tr))}`,font:{size:10.5,color:'#4a4a4a',family:'Consolas, Menlo, monospace'}}));
  lo.annotations.push({xref:'paper',yref:'paper',x:1.012,y:1,xanchor:'left',yanchor:'bottom',showarrow:false,text:'<i>p Holm</i>',font:{size:10,color:'#6a6a6a'}});
  heightOverride=Math.max(420,230+rows.length*58);
  reading=rows.length?`Corrección de Holm para ${rows[0].tr.holm_family_size||rows.length} puntos: cuantos más puntos se comparan, más exigente es cada prueba. ${rows.filter(r=>['creciente','decreciente'].includes(stateOf(r.tr))).length} de ${rows.length} puntos muestran un cambio con evidencia.`:'No hay puntos con 10 o más años completos.';
 }else if(tab==='indices'){
  // v6.2 · ¿CUENTAN LOS ÍNDICES LA MISMA HISTORIA? Filas = puntos, columnas =
  // índices ETCCDI. Color = dirección y magnitud RELATIVA (cada columna se
  // divide por su máximo absoluto, porque mm y días no son comparables);
  // número = pendiente REAL por década; ▲▼ en negrita = cambio con evidencia.
  const IDX=['R95p_dias','Rx1day','Rx5day','R95pTOT','R99pTOT','SDII','PRCPTOT','R10mm','R20mm','CDD','CWD'];
  const pts=points.filter(p=>p.advanced?.etccdi);
  caption='Color: dirección y magnitud relativa del cambio (cada columna normalizada por su máximo absoluto). Número: pendiente Theil–Sen real por década, en la unidad del índice. ▲ ▼ en negrita: cambio con evidencia (p Holm < 0,05). Firma de concentración: PRCPTOT plano mientras R95pTOT, SDII y Rx1day suben.';
  const cols=IDX.filter(k=>pts.some(p=>p.advanced.etccdi.indices[k]));
  const slope=(p,k)=>p.advanced.etccdi.indices[k]?.trend?.slope_per_decade??null;
  const colMax=cols.map(k=>Math.max(1e-9,...pts.map(p=>Math.abs(slope(p,k)??0))));
  const z=pts.map(p=>cols.map((k,j)=>{const v=slope(p,k);return v==null?null:v/colMax[j]}));
  const xs=cols.map(k=>{const ix=pts[0]?.advanced.etccdi.indices[k];return `${ix?.label||k}<br><span style="font-size:10.5px;color:var(--suave)">${ix?.unit||''}</span>`});
  const ys=pts.map(p=>p.name);
  traces=[{type:'heatmap',x:xs,y:ys,z,zmin:-1,zmax:1,zmid:0,xgap:3,ygap:3,hoverongaps:false,
   colorscale:[[0,'#5b2a13'],[0.18,'#9a4b31'],[0.38,'#e2b49a'],[0.5,'#f7f6f2'],[0.62,'#9fc1e3'],[0.82,'#205ca6'],[1,'#0b2f5e']],
   customdata:pts.map(p=>cols.map(k=>{const t=p.advanced.etccdi.indices[k]?.trend||{};return [fmtS(t.slope_per_decade,2),fmtS(t.ci_low_per_decade,2),fmtS(t.ci_high_per_decade,2),fmtP(pBest(t)),STATE[stateOf(t)].label]})),
   hovertemplate:'%{y} · %{x}<br>Pendiente %{customdata[0]} por década<br>IC 95 %: %{customdata[1]} a %{customdata[2]}<br>p Holm %{customdata[3]} · %{customdata[4]}<extra></extra>',
   colorbar:{title:{text:'Dirección<br>del cambio',side:'top',font:{size:11.5}},thickness:16,len:0.9,outlinewidth:0,
    tickvals:[-1,0,1],ticktext:['baja','sin cambio','sube'],tickfont:{size:12}}}];
  lo=layout('¿Cuentan los índices la misma historia?','',{margin:{l:150,r:40,t:110,b:96},
   xaxis:{showgrid:false,side:'bottom',tickangle:0,tickfont:{size:12}},yaxis:{showgrid:false,autorange:'reversed',tickfont:{size:13}}},
   'Índices ETCCDI de extremos de precipitación · pendiente por década','#3a3a3a');
  lo.showlegend=false;lo._provExtra=22;
  pts.forEach((p,i)=>cols.forEach((k,j)=>{const t=p.advanced.etccdi.indices[k]?.trend||{};const v=t.slope_per_decade;if(v==null)return;
   const s=stateOf(t),sig=s==='creciente'||s==='decreciente',dark=Math.abs(z[i][j])>0.55;
   lo.annotations.push({x:xs[j],y:ys[i],xref:'x',yref:'y',showarrow:false,
    text:`${sig?'<b>':''}${fmtS(v,Math.abs(v)>=100?0:1)}${sig?' '+STATE[s].sym+'</b>':''}`,font:{size:12.5,color:dark?'#fff':'#1a1a1a'}})}));
  const nsig=pts.reduce((a,p)=>a+cols.filter(k=>['creciente','decreciente'].includes(stateOf(p.advanced.etccdi.indices[k]?.trend))).length,0);
  reading=pts.length?`${nsig} de ${pts.length*cols.length} combinaciones punto × índice muestran un cambio con evidencia tras Holm. Lea por filas: si en un punto PRCPTOT casi no cambia pero R95pTOT, SDII y Rx1day son azules, la lluvia se está concentrando en menos días más intensos. Definiciones ETCCDI (Zhang et al., 2011); el día lluvioso usa su umbral (${fmt(R.wet_min,1)} mm).`:'Sin índices disponibles.';
  heightOverride=Math.max(380,200+pts.length*64);
 }else if(tab==='concentration'){
  caption='La hipótesis «llueve más en menos tiempo» predice: total estable, menos días lluviosos, más intensidad y más % del total en días extremos. Cada panel: serie, tendencia en el color de su estado y su % de cambio.';
  const c=focus.advanced?.concentration;const years=focus.annual.map(r=>r.year);
  const panels=[['annual','Lluvia total','mm'],['wet_days','Días lluviosos','días'],['sdii','Intensidad (SDII)','mm/día lluvioso'],['r95share','% del total en días > P95','%']];
  const dom=[[0,0.42,0.6,1],[0.53,0.95,0.6,1],[0,0.42,0,0.4],[0.53,0.95,0,0.4]];
  lo=layout(`¿Llueve más en menos tiempo? · ${focus.name}`,'',{showlegend:false,margin:{b:70,r:40}});
  panels.forEach(([k,label,unit],j)=>{
   const ax=j?String(j+1):'';const xa='x'+ax,ya='y'+ax;const S=SERIES[k];const tr=S.tr(focus)||{};
   traces.push(...senFan(tr,xa,ya),obsTrace(years,S.ys(focus),label,{xaxis:xa,yaxis:ya}),...trendLine(tr,'Tendencia',undefined,2.3,xa,ya));
   lo['xaxis'+ax]={domain:[dom[j][0],dom[j][1]],anchor:ya,tickformat:'d',showgrid:false,tickfont:{size:10}};
   // Se deja ~35 % libre arriba para que el círculo y la etiqueta no tapen datos.
   const vals=[...S.ys(focus),tr.fitted_start,tr.fitted_end].filter(v=>v!=null&&Number.isFinite(v));
   const lo_=Math.min(...vals),hi_=Math.max(...vals),pad=(hi_-lo_)||1;
   lo['yaxis'+ax]={domain:[dom[j][2],dom[j][3]],anchor:xa,tickfont:{size:10},title:{text:unit,font:{size:10.5}},
     range:vals.length?[lo_-pad*0.08,hi_+pad*0.18]:undefined};
   lo.annotations.push({xref:xa+' domain',yref:ya+' domain',x:0.01,y:0.99,xanchor:'left',yanchor:'top',showarrow:false,text:`<b>${label}</b>`,font:{size:11.5,color:INK},bgcolor:'rgba(255,255,255,.8)'});
   const b=badgeOverlay(tr,{x:dom[j][1],y:dom[j][3],size:52,side:'right'});lo.shapes.push(...b.shapes);lo.annotations.push(...b.annotations);
  });
  if(c){const v={compatible:['#205ca6','Compatible con concentración'],parcial:['#9a6c00','Evidencia parcial'],no_compatible:['#6b6b6b','No compatible'],sin_datos:['#a9a9a9','Sin datos suficientes']}[c.veredicto];
   lo.annotations.push({xref:'paper',yref:'paper',x:1,y:1,yshift:12,xanchor:'right',yanchor:'bottom',showarrow:false,text:`<b>${v[1]}</b> · ${c.criterios_a_favor}/4 criterios`,font:{size:11.5,color:'#fff'},bgcolor:v[0],borderpad:5});
   reading=`${escapeHTML(c.texto)} ${escapeHTML(c.advertencia)}`}
  heightOverride=600;
 }else if(tab==='regime'){
  const key=metric||(state.activeTab==='regime'?$('advMetric').value:'')||'annual_total';const cp=focus.advanced?.change_points?.[key];
  const lbl={annual_total:'Lluvia anual (mm)','fixed_50.8':'Días ≥ 50,8 mm',P95:'Días > P95'}[key];
  caption='Arriba: la serie anual y, si los datos prefieren un salto, el nivel medio antes y después. Abajo: CUSUM; un tramo que sube son años sobre el promedio, uno que baja, bajo el promedio, y un codo marca el cambio.';
  lo=layout(`¿Hubo un cambio de régimen? · ${focus.name}`,'',{showlegend:false,
   yaxis:{domain:[0.44,1],title:{text:lbl}},xaxis:{anchor:'y',tickformat:'d',showticklabels:false},
   xaxis2:{anchor:'y2',matches:'x',tickformat:'d'},yaxis2:{domain:[0,0.33],title:{text:'CUSUM (σ)'},zeroline:true,zerolinecolor:'#9a9a9a'}});
  if(cp&&cp.years.length){
   const m=cp.models||{},pt=cp.pettitt||{};const cut=m.anio_corte;const jump=cut&&['salto','ambos'].includes(m.modelo_preferido);
   const lineCol=cp.instrumental_flag?'#b0281e':'#8a6d3b';
   traces.push({x:cp.years,y:cp.values,type:'bar',name:lbl,marker:{color:cp.years.map(y=>jump&&y>=cut?'#8fa9c9':'#c5cfdb'),line:{color:'#fff',width:0.6}},hovertemplate:'%{x}: %{y:,.1f}<extra></extra>'});
   traces.push({x:cp.years,y:cp.cusum,type:'scatter',mode:'lines+markers',xaxis:'x2',yaxis:'y2',line:{color:SERIES_INK,width:1.8},marker:{size:4,color:SERIES_INK},fill:'tozeroy',fillcolor:'rgba(74,74,74,.10)',name:'CUSUM'});
   if(jump){
    const ya=cp.values.filter((v,k)=>cp.years[k]<cut),yb=cp.values.filter((v,k)=>cp.years[k]>=cut);const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
    traces.push({x:[cp.years[0]-.45,cut-.55],y:[mean(ya),mean(ya)],type:'scatter',mode:'lines',line:{color:INK,width:2.6},name:'Media antes'});
    traces.push({x:[cut-.45,cp.years[cp.years.length-1]+.45],y:[mean(yb),mean(yb)],type:'scatter',mode:'lines',line:{color:INK,width:2.6},name:'Media después'});
    for(const yr of ['y','y2'])lo.shapes.push({type:'line',xref:'x',yref:yr+' domain',x0:cut-.5,x1:cut-.5,y0:0,y1:1,line:{color:lineCol,width:1.8,dash:'dash'}});
    lo.annotations.push({xref:'x',yref:'y domain',x:cut-.5,y:1,xanchor:'left',yanchor:'top',xshift:4,showarrow:false,text:`<b>cambio ${cut}</b>${cp.instrumental_flag?'<br>⚠ posible efecto del instrumento':''}`,font:{size:10.5,color:lineCol},align:'left',bgcolor:'rgba(255,255,255,.85)'});
   }
   lo.annotations.push({xref:'paper',yref:'paper',x:1,y:1,yshift:8,xanchor:'right',yanchor:'bottom',showarrow:false,
    text:`Modelo preferido (BIC): <b>${escapeHTML(m.modelo_preferido||'—')}</b>${m.fuerza_preferencia?` · ${escapeHTML(m.fuerza_preferencia.replace(/_/g,' '))}`:''} · Pettitt p ${pEq(pt.p)}`,font:{size:11,color:'#333'}});
   reading=escapeHTML(cp.texto)+(cp.instrumental_flag?'':' Pendiente y salto son preguntas distintas: una serie puede subir gradualmente sin saltos, o saltar de nivel sin tendencia.');
  }else reading='Serie demasiado corta para buscar un cambio de régimen.';
  heightOverride=540;
 }else if(tab==='quantiles'){
  const q=focus.advanced?.quantile_shift;
  caption='Arriba: cuantiles de los días lluviosos en cada mitad del período (escala logarítmica). Abajo: cambio %. Si solo suben los cuantiles altos, la cola se estira: la lluvia fuerte se intensifica más que la normal.';
  const lab=(q?.rows||[]).map(r=>'Q'+String(r.q).replace('.',','));
  lo=layout(`¿Cambia la lluvia normal o la extrema? · ${focus.name}`,'',{
   yaxis:{domain:[0.46,1],title:{text:'mm/día (escala log)'},type:'log',tickvals:[1,2,5,10,20,50,100,200,500],ticktext:['1','2','5','10','20','50','100','200','500']},
   xaxis:{anchor:'y',showticklabels:false,type:'category'},xaxis2:{anchor:'y2',matches:'x',type:'category'},
   yaxis2:{domain:[0,0.34],title:{text:'Cambio (%)'},zeroline:true,zerolinecolor:SERIES_INK},
   legend:{x:0.008,y:0.995}});
  if(q?.rows?.length){
   traces.push({x:lab,y:q.rows.map(r=>r.first_mm),type:'scatter',mode:'lines+markers',name:`${q.periods[0][0]}–${q.periods[0][1]}`,line:{color:'#a7b0ba',width:2},marker:{size:6,color:'#a7b0ba'}});
   traces.push({x:lab,y:q.rows.map(r=>r.second_mm),type:'scatter',mode:'lines+markers',name:`${q.periods[1][0]}–${q.periods[1][1]}`,line:{color:SERIES_INK,width:2.2},marker:{size:6,color:SERIES_INK}});
   traces.push({x:lab,y:q.rows.map(r=>r.ratio_pct),type:'bar',xaxis:'x2',yaxis:'y2',name:'Cambio %',showlegend:false,marker:{color:q.rows.map(r=>r.ratio_pct>=0?COL.pos:COL.neg),line:{color:'#fff',width:0.6}},
    text:q.rows.map(r=>fmtS(r.ratio_pct,0)+'%'),textposition:'auto',insidetextanchor:'middle',textfont:{size:10}});
   const r50=q.rows.find(r=>r.q===50),r99=q.rows.find(r=>r.q===99);
   reading=`Día lluvioso típico (Q50): ${fmtS(r50?.ratio_pct,0)} %. Uno de cada cien días lluviosos (Q99): ${fmtS(r99?.ratio_pct,0)} %. ${escapeHTML(q.note)} n = ${q.n_first} y ${q.n_second} días.`;
  }else reading='Se necesitan al menos 100 días lluviosos en cada mitad.';
  heightOverride=540;
 }else if(tab==='seasons'){
  const s=focus.advanced?.seasonal;
  caption='Totales por temporada (solo meses completos) con su tendencia. Abajo, índice de veranillo: lluvia de julio-agosto frente a mayo, junio, septiembre y octubre; bajo 1 indica la pausa de mitad de año.';
  lo=layout(`¿Cambian las temporadas? · ${focus.name}`,'',{
   yaxis:{domain:[0.44,1],title:{text:'Lluvia de la temporada (mm)'}},xaxis:{anchor:'y',tickformat:'d',showticklabels:false},
   xaxis2:{anchor:'y2',matches:'x',tickformat:'d'},yaxis2:{domain:[0,0.32],title:{text:'Razón veranillo'}}});
  if(s){
   const CR='#205ca6',CD='#c06a24';
   traces.push(obsTrace(s.years,s.rainy,'Lluviosa (may-nov)',{color:CR}),obsTrace(s.years,s.dry,'Seca (dic-abr)',{color:CD}));
   traces.push(...trendLine(s.trend_rainy,'Tendencia lluviosa',CR,2.2),...trendLine(s.trend_dry,'Tendencia seca',CD,2.2));
   traces.forEach(t=>{if(t.name?.startsWith('Tendencia'))t.line.dash='dash'});
   traces.push(obsTrace(s.years,s.veranillo_ratio,'Razón de veranillo',{color:'#8a6d3b',xaxis:'x2',yaxis:'y2'}));
   refLine(lo,1,'sin pausa (= 1)',{yref:'y2',xref:'x2 domain'});
   addBadge(lo,s.trend_rainy);addBadge(lo,s.trend_dry,{x:0.9});
   lo.annotations.push({xref:'paper',yref:'paper',x:0.9,y:1,yshift:2,xshift:-32,xanchor:'center',yanchor:'top',showarrow:false,text:'seca',font:{size:9.5,color:CD}});
   lo.annotations.push({xref:'paper',yref:'paper',x:1,y:1,yshift:2,xshift:-32,xanchor:'center',yanchor:'top',showarrow:false,text:'lluviosa',font:{size:9.5,color:CR}});
   reading=`Lluviosa: ${fmtS(s.trend_rainy.slope_per_decade,0)} mm/década ${stateChip(s.trend_rainy)} · Seca: ${fmtS(s.trend_dry.slope_per_decade,0)} mm/década ${stateChip(s.trend_dry)}. Veranillo: si la razón baja con los años, la pausa se profundiza (${STATE[stateOf(s.trend_veranillo)].label.toLowerCase()}). Es un rasgo de la vertiente del Pacífico; en el Caribe el ciclo anual es distinto.`;
  }
  heightOverride=560;
 }else if(tab==='cycle'){
  const h=focus.advanced?.climatology_halves;
  caption='Lluvia media de cada mes en la primera y la segunda mitad del período. Permite ver si la temporada se desplazó o si el veranillo (sombreado) se hizo más profundo.';
  lo=layout(`¿Cambió la forma del año? · ${focus.name}`,'Lluvia media mensual (mm)',{xaxis:{tickmode:'array',tickvals:[1,2,3,4,5,6,7,8,9,10,11,12],ticktext:MONTHS,range:[0.5,12.5],showgrid:false}});
  if(h){
   lo.shapes.push({type:'rect',xref:'x',yref:'paper',x0:6.5,x1:8.5,y0:0,y1:1,fillcolor:'rgba(232,179,58,.15)',line:{width:0},layer:'below'});
   lo.annotations.push({xref:'x',yref:'paper',x:7.5,y:0.99,yanchor:'top',showarrow:false,text:'<i>veranillo</i>',font:{size:10.5,color:'#8a6d3b'}});
   const xs=[...Array(12).keys()].map(k=>k+1);
   traces.push({x:xs,y:h.first,type:'scatter',mode:'lines+markers',name:`${h.periods[0][0]}–${h.periods[0][1]}`,line:{color:'#a7b0ba',width:2.2},marker:{size:6,color:'#a7b0ba'}});
   traces.push({x:xs,y:h.second,type:'scatter',mode:'lines+markers',name:`${h.periods[1][0]}–${h.periods[1][1]}`,line:{color:SERIES_INK,width:2.6},marker:{size:6,color:SERIES_INK}});
   const tot=a=>a.reduce((s,v)=>s+(v||0),0);
   reading=`Total medio: ${fmt(tot(h.first),0)} mm en ${h.periods[0].join('–')} y ${fmt(tot(h.second),0)} mm en ${h.periods[1].join('–')}. Es una comparación descriptiva: la significancia está en las pestañas de tendencia.`;
  }
 }else if(tab==='return'){
  const rl=focus.advanced?.return_levels;
  caption='Puntos: lluvia máxima en un día de cada año completo, en su período de retorno empírico (Gringorten). Línea: ajuste de Gumbel. Rombos: lluvia de 1 en 2, 5, 10, 25 y 50 años.';
  lo=layout(`¿Qué tan intensa es una lluvia de 1 en N años? · ${focus.name}`,'Lluvia máxima en un día (mm)',{
   xaxis:{type:'log',title:{text:'Período de retorno (años, escala log)'},tickvals:[1,2,5,10,25,50,100],ticktext:['1','2','5','10','25','50','100'],range:[0,2]}});
  if(rl?.levels?.length){
   const Ts=[];for(let t=1.05;t<=100;t*=1.07)Ts.push(t);
   traces.push({x:Ts,y:Ts.map(T=>rl.mu-rl.alpha*Math.log(-Math.log(1-1/T))),type:'scatter',mode:'lines',name:'Ajuste de Gumbel',line:{color:INK,width:2.2}});
   traces.push({x:rl.empirical.map(e=>e.T),y:rl.empirical.map(e=>e.mm),type:'scatter',mode:'markers',name:'Máximos anuales',marker:{color:SERIES_INK,size:7,line:{color:'#fff',width:1}}});
   traces.push({x:rl.levels.map(l=>l.T),y:rl.levels.map(l=>l.mm),type:'scatter',mode:'markers+text',name:'Niveles de retorno',marker:{symbol:'diamond',size:11,color:COL.lime,line:{color:INK,width:1}},
    text:rl.levels.map(l=>`${fmt(l.mm,0)} mm`),textposition:'middle left',textfont:{size:10.5,color:INK}});
   const l10=rl.levels.find(l=>l.T===10);
   reading=`Lluvia de 1 en 10 años ≈ <b>${fmt(l10?.mm,0)} mm en un día</b> (n = ${rl.n} años). ${escapeHTML(rl.note)} Para obras o seguros se recomienda contrastar con estaciones del IMN: los satélites tienden a subestimar los picos.`;
  }else reading=escapeHTML(rl?.note||'Sin datos.');
 }else if(tab==='eventdays'){
  caption=`Solo los días con lluvia mayor que el P${focusPct} de cada punto, en toda la serie; se omiten los días ordinarios.`;
  points.forEach((p,i)=>{const days=p.extreme_days?.[focusPct]||[];
    traces.push({x:days.map(d=>d.fecha),y:days.map(d=>d.lluvia_mm),name:p.name,type:'scatter',mode:'markers',marker:{color:pointColor(i),size:6,opacity:0.75,line:{color:'#fff',width:0.5}},
      customdata:days.map(d=>d.id_evento),hovertemplate:'%{x}<br>Lluvia: %{y:.1f} mm<br>Episodio: %{customdata}<extra>'+escapeHTML(p.name)+'</extra>'})});
  lo=layout(`¿Cuándo ocurrieron los días extremos? (> P${focusPct})`,'Lluvia diaria (mm)');
 }else if(tab==='eventamount'){
  caption=`Lluvia anual aportada únicamente por los días mayores que el P${focusPct}. Los años incompletos se omiten.`;
  points.forEach((p,i)=>traces.push({x:p.annual.map(r=>r.year),y:p.annual.map(r=>r.extreme_mm?.[focusPct]??null),type:'bar',name:p.name,marker:{color:pointColor(i),line:{color:'#fff',width:0.6}}}));
  lo=layout(`¿Cuánta lluvia aportan los días extremos? (> P${focusPct})`,'Lluvia de días extremos (mm)',{barmode:'group',xaxis:{tickformat:'d'}});
 }else if(tab==='eventepisodes'){
  caption=`Episodios = días consecutivos sobre el P${focusPct}. Conteos anuales solo para años completos.`;
  points.forEach((p,i)=>traces.push(obsTrace(p.annual.map(r=>r.year),p.annual.map(r=>r.event_counts?.[focusPct]??null),p.name,{focus:p===focus||points.length===1,color:p===focus?SERIES_INK:pointColor(i)})));
  lo=layout(`¿Cuántos episodios extremos hay por año? (> P${focusPct})`,'Episodios por año',{xaxis:{tickformat:'d'}});
 }else if(tab==='eventrank'){
  caption=`Pico de cada episodio sobre el P${focusPct}. El tamaño del marcador indica cuántos días duró el episodio.`;
  points.forEach((p,i)=>{const e=p.extreme_events?.[focusPct]||[];
    traces.push({x:e.map(q=>q.fecha_pico),y:e.map(q=>q.maximo_mm),name:p.name,type:'scatter',mode:'markers',marker:{size:e.map(q=>Math.min(20,6+q.duracion_dias*2)),color:pointColor(i),opacity:.7,line:{color:'#fff',width:0.6}},
      customdata:e.map(q=>[q.duracion_dias,q.acumulado_mm]),hovertemplate:'%{x}<br>Pico %{y:.1f} mm<br>Duración %{customdata[0]} días<br>Acumulado %{customdata[1]:.1f} mm<extra>'+escapeHTML(p.name)+'</extra>'})});
  lo=layout(`¿Qué tan intensos fueron los episodios extremos? (> P${focusPct})`,'Máximo del episodio (mm/día)');
 }else if(tab==='percentiles'){
  caption=`Umbral diario de cada percentil, calculado en ${R.ref_start}–${R.ref_end} con ${focus.summary.population.toLowerCase()}. Cada punto tiene sus propios umbrales.`;
  const ramp=['#d4dbe4','#a9bad0','#7593b8','#43699c','#1f3f6b'];
  selectedPercentiles().forEach((pct,j)=>traces.push({x:points.map(p=>p.name),y:points.map(p=>p.thresholds[pct]),name:'P'+pct,type:'bar',marker:{color:ramp[j%5],line:{color:'#fff',width:0.6}},text:points.map(p=>p.thresholds[pct]===null?'s/d':fmt(p.thresholds[pct],1)),textposition:'outside',cliponaxis:false,textfont:{size:10}}));
  lo=layout('¿Qué lluvia diaria cuenta como extrema en cada punto?','Umbral (mm/día)',{barmode:'group',xaxis:{showgrid:false}});
 }else if(tab==='exceedance'){
  const tr=focus.summary.extreme_count_trends[focusPct];
  caption=`Días por año con lluvia mayor que el P${focusPct} del propio punto, con la tendencia y su IC 95 %. Las series tenues son los otros puntos.`;
  context(r=>r.exceedances[focusPct]);
  const fan=senFan(tr);if(fan[1])fan[1].name='Intervalo de confianza del 95 %';
  traces.push(...fan,obsTrace(focus.annual.map(r=>r.year),focus.annual.map(r=>r.exceedances[focusPct]),'Días extremos por año'),
   ...trendLine(tr,tr?.slope_per_decade==null?'':`Tendencia Theil–Sen (${fmtS(tr.slope_per_decade,1)} días/década)`));
  const thr=focus.thresholds[focusPct];const [v2,c2]=verdictLine(tr,'días',1);
  lo=layout(`Días que superan ${fmt(thr,1)} mm (P${focusPct}) · ${focus.name}`,'Días con lluvia extrema',{xaxis:{tickformat:'d',title:{text:'Año'}},yaxis:{rangemode:'tozero'}},v2,c2);addBadge(lo,tr);
  regimeOverlay(lo,traces,focus.advanced?.change_points?.['P'+focusPct]);
  reading=trendReading(focus.name,tr,'días',`días > P${focusPct}`);
 }else if(tab==='climatology'){
  caption='Promedio de los acumulados mensuales completos (no se anualizan meses incompletos).';
  points.forEach((p,i)=>traces.push({x:MONTHS,y:p.climatology.map(r=>r.mean),type:'bar',name:p.name,marker:{color:pointColor(i),line:{color:'#fff',width:0.6}}}));
  lo=layout('¿Cómo se reparte la lluvia en el año?','Precipitación media mensual (mm)',{barmode:'group',xaxis:{showgrid:false}});
 }else if(tab==='anomaly'){
  caption=`Diferencia de cada año frente a la media ${R.ref_start}–${R.ref_end}. Barras azules: año más lluvioso de lo normal; rojizas: más seco. Línea: media móvil de 5 años.`;
  const an=focus.annual;
  traces.push({x:an.map(r=>r.year),y:an.map(r=>r.anomaly),type:'bar',name:`Anomalía ${focus.name}`,marker:{color:an.map(r=>r.anomaly==null?'#ccc':r.anomaly>=0?COL.pos:COL.neg),line:{color:'#fff',width:0.6}}});
  const mm=an.map((r,k)=>{const w=an.slice(Math.max(0,k-2),k+3).map(x=>x.anomaly);return w.length===5&&w.every(v=>v!=null)?w.reduce((s,v)=>s+v,0)/5:null});
  traces.push({x:an.map(r=>r.year),y:mm,type:'scatter',mode:'lines',name:'Media móvil 5 años',line:{color:INK,width:2.4}});
  lo=layout(`¿Fue un año más lluvioso o más seco que lo normal? · ${focus.name}`,'Anomalía (mm)',{xaxis:{tickformat:'d'},yaxis:{zeroline:true,zerolinecolor:SERIES_INK,zerolinewidth:1.2}});
 }else if(tab==='heatmap'){
  caption=`Lluvia de cada mes de cada año en ${focus.name}. Celdas vacías = mes incompleto, sin datos imputados.`;
  const years=[...new Set(focus.monthly.map(r=>r.year))];
  traces=[{type:'heatmap',x:MONTHS,y:years,z:years.map(y=>MONTHS.map((m,i)=>focus.monthly.find(r=>r.year===y&&r.month===i+1)?.total??null)),colorscale:[[0,'#f7f7f2'],[.25,'#cfe0c3'],[.55,'#6fa58a'],[.8,'#2f6f62'],[1,'#173d4a']],xgap:1,ygap:1,colorbar:{title:{text:'mm'},thickness:12,outlinewidth:0},hovertemplate:'%{y} · %{x}<br>%{z:.1f} mm<extra></extra>'}];
  lo=layout(`¿Qué meses y años fueron más lluviosos? · ${focus.name}`,'',{xaxis:{showgrid:false},yaxis:{autorange:'reversed',showgrid:false,dtick:2}});
 }else if(tab==='correlations'){
  caption='Correlación de Pearson entre los acumulados mensuales completos de cada par de puntos (mínimo 12 meses en común). Cerca de 1: llueve igual en ambos.';
  const z=R.correlations.map(row=>row.map(c=>c.r));
  traces=[{type:'heatmap',x:points.map(p=>p.name),y:points.map(p=>p.name),z,zmin:-1,zmax:1,xgap:2,ygap:2,
    colorscale:[[0,'#9a4b31'],[.5,'#f7f7f4'],[1,'#205ca6']],colorbar:{title:{text:'r'},thickness:12,outlinewidth:0},
    text:z.map(row=>row.map(v=>v===null?'—':v.toFixed(2))),texttemplate:'%{text}',hovertemplate:'%{y} y %{x}<br>r = %{z}<extra></extra>'}];
  lo=layout('¿Llueve parecido en los distintos puntos?','',{xaxis:{showgrid:false},yaxis:{showgrid:false}});
 }else if(tab==='daily'){
  caption=`Serie diaria de ${focus.name}. Un hueco es una observación ausente, no un cero. Rombos rojos: días mayores que el P99.`;
  traces=[{x:focus.daily.map(r=>r.date),y:focus.daily.map(r=>r.mm),type:'scattergl',mode:'lines',name:'Lluvia diaria',line:{color:SERIES_INK,width:0.8}}];
  const dash=['dot','dash','longdash','dashdot','solid'];
  selectedPercentiles().forEach((pct,j)=>{if(focus.thresholds[pct]!==null)traces.push({x:[focus.daily[0].date,focus.daily[focus.daily.length-1].date],y:[focus.thresholds[pct],focus.thresholds[pct]],type:'scatter',mode:'lines',name:'P'+pct,line:{dash:dash[j%5],width:1.3,color:['#a9bad0','#7593b8','#43699c','#2f5584','#1f3f6b'][j%5]}})});
  const ex=focus.extreme_days?.['99']||[];
  traces.push({x:ex.map(d=>d.fecha),y:ex.map(d=>d.lluvia_mm),type:'scattergl',mode:'markers',name:'Días > P99',marker:{symbol:'diamond',size:7,color:'#b0281e',line:{color:'#fff',width:0.6}}});
  lo=layout(`¿Cómo es la lluvia día a día? · ${focus.name}`,'Lluvia diaria (mm)');
 }
 withProvenance(lo,['forest','indices','percentiles','correlations','eventdays','eventamount','eventepisodes','eventrank','climatology'].includes(tab)&&points.length>1?null:focus);
 polish(lo,caption);
 return {traces,lo,caption,reading,heightOverride};
}
function renderChart(){
 try{
  if(!window.Plotly){$('chart').innerHTML='<div class="status-card error">Plotly.js no se cargó. Revise los archivos del paquete.</div>';return}
  configureAdvSelect();
  const {traces,lo,caption,reading,heightOverride}=chartData();
  // El subtítulo ya va DENTRO de la figura; el texto HTML queda oculto para no repetirlo.
  $('chartSubtitle').textContent=caption;$('chartSubtitle').hidden=true;
  $('chartReading').innerHTML=reading||'';$('chartReading').hidden=!reading;
  $('chart').style.height=(heightOverride||540)+'px';
  fitLegend(lo,$('chart').clientWidth||900,traces);
  Plotly.react($('chart'),traces,lo,{...PLOT,toImageButtonOptions:{...PLOT.toImageButtonOptions,height:heightOverride?Math.round(heightOverride*1.5):800,filename:'lluvia_cr_'+state.activeTab}});
 }catch(e){console.error(e);$('chart').textContent='No se pudo graficar: '+e.message}
}

// ---------------------------------------------------------------------------
// 6b. v6.2 · PANEL DE FIGURAS (todas las figuras clave a la vez) y PANTALLA COMPLETA
// ---------------------------------------------------------------------------
// Antes solo se veía una figura y las demás quedaban ocultas en pestañas.
// El panel dibuja a la vez las figuras que un climatólogo revisa primero.
// Todas siguen siendo interactivas (zoom, hover, PNG) y se pueden ampliar.
const DASH=[
 {tab:'annual',title:'Tendencia del total anual'},
 {tab:'forest',metric:'annual',title:'¿Dónde cambia el total?'},
 {tab:'exceedance',title:'Frecuencia de días extremos'},
 {tab:'forest',metric:'P95',title:'¿Dónde cambian los extremos?'},
 {tab:'concentration',title:'Firma de concentración',wide:true},
 {tab:'indices',title:'Índices ETCCDI',wide:true},
 {tab:'regime',metric:'annual_total',title:'Cambio de régimen'},
 {tab:'return',title:'Períodos de retorno'},
 {tab:'quantiles',title:'Cuantiles'},
 {tab:'seasons',title:'Temporadas y veranillo'}
];
function renderDashboard(){
 const box=$('dashGrid');if(!box||!state.result||!window.Plotly)return;
 if(!box.dataset.built){
  box.innerHTML=DASH.map((d,i)=>`<figure class="dash-card ${d.wide?'wide':''}"><div class="dash-tools"><span>${escapeHTML(d.title)}</span><button class="dash-zoom" data-idx="${i}" title="Ver a pantalla completa">⤢ Ampliar</button></div><div class="dash-plot" id="dash${i}"></div><figcaption class="dash-reading" id="dashR${i}"></figcaption></figure>`).join('');
  box.dataset.built='1';
  box.querySelectorAll('.dash-zoom').forEach(b=>b.onclick=()=>{const d=DASH[+b.dataset.idx];openFigure(()=>chartData(d.tab,d.metric||null),'lluvia_cr_'+d.tab)});
 }
 DASH.forEach((d,i)=>{const el=$('dash'+i);
  try{const {traces,lo,reading,heightOverride}=chartData(d.tab,d.metric||null);
   const h=Math.max(heightOverride||540,480);el.style.height=h+'px';
   fitLegend(lo,el.clientWidth||700,traces);
   Plotly.react(el,traces,lo,{...PLOT,toImageButtonOptions:{...PLOT.toImageButtonOptions,height:Math.round(h*1.5),filename:'lluvia_cr_panel_'+d.tab}});
   $('dashR'+i).innerHTML=reading||'';$('dashR'+i).hidden=!reading;
  }catch(e){console.error(e);el.textContent='No se pudo graficar: '+e.message}});
}
// Pantalla completa: recibe una función que devuelve {traces, lo}.
let figBuilder=null;
function openFigure(builder,filename='lluvia_cr_figura'){
 figBuilder=builder;const m=$('figModal');m.hidden=false;document.body.classList.add('modal-open');
 const el=$('figModalPlot');const {traces,lo}=builder();
 el.style.height=Math.round(window.innerHeight*0.86-40)+'px';
 fitLegend(lo,el.clientWidth||1200,traces);
 Plotly.newPlot(el,traces,lo,{...PLOT,displayModeBar:true,toImageButtonOptions:{format:'png',width:1800,height:1050,scale:2,filename}});
}
function closeFigure(){const el=$('figModalPlot');if(window.Plotly)Plotly.purge(el);$('figModal').hidden=true;document.body.classList.remove('modal-open');figBuilder=null}
function initFigureTools(){
 $('figModalClose').onclick=closeFigure;
 $('figModal').addEventListener('click',e=>{if(e.target===$('figModal'))closeFigure()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('figModal').hidden)closeFigure()});
 $('chartZoom').onclick=()=>{if(!state.result)return;const tab=state.activeTab,metric=$('advMetricWrap').hidden?null:$('advMetric').value;openFigure(()=>chartData(tab,metric),'lluvia_cr_'+tab)};
 $('toggleSidebar').onclick=()=>{const wide=document.body.classList.toggle('wide');
  $('toggleSidebar').textContent=wide?'⟩ Mostrar configuración':'⟨ Ampliar gráficos';
  setTimeout(rerenderAll,260)};
 let t=null;window.addEventListener('resize',()=>{clearTimeout(t);t=setTimeout(rerenderAll,450)});
}
async function rerenderAll(){
 if(state.map)try{state.map.invalidateSize()}catch(e){}
 // Plotly conserva el ancho anterior al cambiar el diseño de la página (sin
 // evento «resize»): primero se ajusta cada figura a su contenedor nuevo.
 if(window.Plotly)await Promise.all([...document.querySelectorAll('.js-plotly-plot')].filter(el=>el.offsetParent).map(el=>Plotly.Plots.resize(el).catch(()=>null)));
 if(state.result){renderChart();renderDashboard();renderFixedPanels()}
 if(typeof valRerender==='function')valRerender();
}

// ---------------------------------------------------------------------------
// 7. PANELES, IDONEIDAD, TARJETAS Y TABLA
// ---------------------------------------------------------------------------
function renderMetricCards(){
 const pts=state.result?.points||[];
 if(!pts.length)return;
 const p=selectedPoint(),sm=p.summary,tr=sm.annual_trend,rl=p.advanced?.return_levels,val=p.validity,lv=LEVEL[val?.nivel];
 const l10=rl?.levels?.find(l=>l.T===10);const c=p.cell_report?.cell;
 const cards=[['Lugares analizados',pts.length,state.result.area_mode==='block3'?'Promedio 3 × 3 celdas':'Una celda por punto'],
 ['Lluvia media anual',fmt(sm.mean_annual_mm,0)+' mm',p.name],
 ['Tendencia anual',tr.slope_per_decade===null?'Insuficiente':fmtS(tr.slope_per_decade,0)+' mm/10 años',`${STATE[stateOf(tr)].sym} ${STATE[stateOf(tr)].label} · ${fixedChange(tr)} en el período`],
 ['Lluvia de 1 en 10 años',l10?fmt(l10.mm,0)+' mm/día':'—',rl?.n?`Gumbel sobre ${rl.n} máximos anuales`:'Se requieren 10 años'],
 ['Cobertura diaria',fmt(sm.coverage_pct,1)+'%',`${fmt(sm.valid_days,0)} días de ${fmt(sm.expected_days,0)}`],
 ['Área representada',c?.available?`${fmt(c.width_km,0)} × ${fmt(c.height_km,0)} km`:'CSV',c?.available?c.grid_label:'Resolución del CSV'],
 ['Idoneidad',lv?`${lv.icon} ${lv.label}`:'—',val?.checks?`${val.checks.filter(x=>x.status==='aviso'||x.status==='no').length} observaciones`:'']];
 $('metricCards').innerHTML=cards.map((x,k)=>`<div class="metric ${k===6&&lv?'lv-'+lv.cls:''}"><small>${escapeHTML(x[0])}</small><strong>${escapeHTML(x[1])}</strong><em>${escapeHTML(x[2])}</em></div>`).join('');
}

// ¿Son confiables los datos de este punto? La ficha viene del backend.
const TL={verde:{cls:'tl-green',label:'Verde'},amarillo:{cls:'tl-yellow',label:'Amarillo'},rojo:{cls:'tl-red',label:'Rojo'}};
const ROB_STATE={creciente:'↑ significativa',decreciente:'↓ significativa',no_concluyente:'no concluyente',datos_insuficientes:'datos insuficientes',error:'error'};
function trafficHTML(p){
 const t=p.traffic_light;if(!t)return '';const c=TL[t.color]||TL.amarillo,rb=p.robustness||{};
 const lamp=k=>`<span class="tl-lamp ${k===t.color?TL[k].cls+' on':''}" aria-hidden="true"></span>`;
 const reasons=[...t.red.map(x=>['tl-red',x]),...t.yellow.map(x=>['tl-yellow',x]),...t.green.map(x=>['tl-green',x])].slice(0,6);
 const rows=(rb.products||[]).map(r=>[r.label+(r.is_main?' (principal)':''),r.error?'—':fmtS(r.slope_per_decade,0),r.error?'—':(r.p_hr!=null&&r.p_hr<0.01?'< 0,01':fmt(r.p_hr,2)),r.error?escapeHTML(r.error):(ROB_STATE[r.estado]||r.estado),r.mean_annual_mm==null?'—':fmt(r.mean_annual_mm,0)]);
 const table=rows.length?`<h4>Robustez entre productos · ${rb.period?rb.period.join('–'):''}</h4>`+htmlTable(['Producto','Tendencia (mm/década)','p (Hamed-Rao)','Estado','Media anual (mm)'],rows)+`<p class="method-note">${escapeHTML(rb.note||'')} Mismo período y misma celda para todos; Theil–Sen y Mann-Kendall con corrección por autocorrelación.</p>`:(rb.status==='off'?'<p class="method-note">Robustez entre productos desactivada.</p>':'');
 return `<div class="traffic" role="group" aria-label="Semáforo de confianza">
  <div class="tl-head"><div class="tl-light" aria-hidden="true">${lamp('rojo')}${lamp('amarillo')}${lamp('verde')}</div>
  <div class="tl-text"><p class="eyebrow">SEMÁFORO DE CONFIANZA · ${escapeHTML(p.name)}</p><h3 class="${c.cls}-text">${c.label}: ${escapeHTML(t.title)}</h3><p class="tl-trend">${escapeHTML(t.trend)}</p></div></div>
  <ul class="tl-reasons">${reasons.map(([k,x])=>`<li><span class="tl-dot ${k}"></span>${escapeHTML(x)}</li>`).join('')}</ul>
  <details class="tl-legend"><summary>¿Qué significan los colores?</summary><ul>
   <li><span class="tl-dot tl-green"></span><b>Verde · confianza alta:</b> hay años y cobertura suficientes, la celda es mayormente tierra y los productos satelitales/modelo coinciden en la lluvia media y en la dirección de la tendencia. La conclusión —sea una tendencia significativa o «no concluyente»— es fiable.</li>
   <li><span class="tl-dot tl-yellow"></span><b>Amarillo · con reservas:</b> algún aviso: 10–19 años completos, celda costera o fronteriza, productos que difieren más de 30 % en la lluvia media o que no coinciden en la dirección de la tendencia (sin significancia). Interprete con cuidado y compare con una estación.</li>
   <li><span class="tl-dot tl-red"></span><b>Rojo · no concluir:</b> algún criterio falla: menos de 10 años completos, celda mayormente mar u otro país, productos que difieren más del doble o tendencias significativas en direcciones opuestas según el producto.</li>
   <li><b>Importante:</b> el color mide la confianza en los datos, no si llueve más o menos ni si la tendencia es significativa; eso lo indica la línea de tendencia.</li></ul></details>
  ${table}</div>`;
}
function renderValidity(){
 const pts=state.result?.points||[];if(!pts.length){$('validityPanel').innerHTML='';return}
 const i=+$('fixedPoint').value||0,p=pts[i]||pts[0],val=p.validity||{},lv=LEVEL[val.nivel]||LEVEL.apto_con_reservas;
 const chips=pts.map((q,k)=>{const l=LEVEL[q.validity?.nivel]||lv;return `<button class="vchip ${l.cls} ${k===i?'active':''}" data-idx="${k}"><span class="pdot" style="background:${pointColor(k)}"></span>${escapeHTML(q.name)} · ${l.icon} ${l.label}</button>`}).join('');
 $('validityPanel').innerHTML=`<div class="validity-head"><div><p class="eyebrow">CONTROL DE CALIDAD</p><h3 id="validityTitle">¿Alcanzan los datos para concluir?</h3></div><div class="vchips">${chips}</div></div>
  ${trafficHTML(p)}
  <div class="validity-body"><div class="vsummary ${lv.cls}"><b>${lv.icon} ${escapeHTML(p.name)}: ${lv.label}</b><span>${escapeHTML(val.resumen||'')}</span></div>
  <ul class="checks">${(val.checks||[]).map(c=>`<li class="ck-${c.status}"><span class="ck-icon">${CHECK_ICON[c.status]||'·'}</span><div><b>${escapeHTML(c.label)}</b><small>${escapeHTML(c.detail)}</small></div></li>`).join('')}</ul></div>`;
 document.querySelectorAll('.vchip').forEach(b=>b.onclick=()=>{$('fixedPoint').value=b.dataset.idx;$('fixedPoint').onchange()});
}

function renderFixedPanels(){
 if(!state.result||!window.Plotly)return;
 const i=+$('fixedPoint').value||0,p=state.result.points[i]||state.result.points[0];
 for(const t of FIXED){
  const key=String(t),id=fixedId(t),tr=p.summary.fixed_threshold_trends[key];
  const good=p.annual.filter(a=>a.fixed_days?.[key]!==null&&a.fixed_days?.[key]!==undefined);
  const years=good.map(a=>a.year),values=good.map(a=>a.fixed_days[key]);
  // El círculo de la esquina (v5) se conserva: muestra relative_change_pct.
  const badge=$('badge'+id);
  badge.innerHTML=`${fixedChange(tr)}<small>${STATE[stateOf(tr)].sym} ${STATE[stateOf(tr)].short}</small>`;
  badge.title=tr.relative_change_pct===null?'Porcentaje no calculable con esta serie':`Cambio entre ${tr.first_year} y ${tr.last_year}: ${fixedChange(tr)} · ${STATE[stateOf(tr)].label} (p Holm ${fmtP(pBest(tr))})`;
  badge.classList.toggle('negative',tr.relative_change_pct<0);
  badge.classList.toggle('unavailable',tr.relative_change_pct===null);
  const mean=p.summary.fixed_threshold_mean_days[key];
  // Esquema de la imagen de referencia v5 (serie azul, tendencia negra) con el
  // marco, la tipografía y la rejilla del sistema v2.
  const traces=[...senFan(tr,undefined,undefined,'rgba(40,40,40,0.11)'),
    {x:years,y:values,mode:'lines+markers',type:'scatter',name:'Días observados',line:{color:COL.blue,width:1.8},marker:{size:4.5,color:COL.blue,line:{color:'#fff',width:0.7}},
    hovertemplate:'Año %{x}<br>%{y} días<extra></extra>'},...trendLine(tr,'Tendencia Theil–Sen',COL.black,2.6)];
  const shapes=[],ann=[];
  if(mean!=null&&years.length)shapes.push({type:'line',xref:'paper',x0:0,x1:1,y0:mean,y1:mean,line:{color:'#8a8a8a',width:1,dash:'dash'},layer:'below'});
  if(values.length){const mx=Math.max(...values),k=values.indexOf(mx);if(mx>0){const edge=k>=values.length*0.8?'right':k<=values.length*0.2?'left':'center';
   ann.push({x:years[k],y:mx,text:`máx. ${mx} d (${years[k]})`,showarrow:true,arrowhead:0,arrowcolor:'#9a9a9a',ax:0,ay:-15,xanchor:edge,font:{size:9.5,color:INK},bgcolor:'rgba(255,255,255,.9)'})}}
  Plotly.react($('fixedPlot'+id),traces,{margin:{t:12,r:12,b:38,l:48},paper_bgcolor:'#fff',plot_bgcolor:'#fff',
    font:{family:FONT,size:11,color:INK},showlegend:false,shapes,annotations:ann,
    hoverlabel:{bgcolor:'#fff',bordercolor:'#9a9a9a',font:{family:FONT,size:11}},modebar:{bgcolor:'rgba(255,255,255,0)',color:'#c4c4c4'},
    xaxis:{...AXIS,title:{text:''},tickformat:'d',showgrid:false,tickfont:{size:10.5,color:INK}},
    yaxis:{...AXIS,title:{text:'Días por año',font:{size:10.5,color:INK},standoff:6},rangemode:'tozero',tickfont:{size:10.5,color:INK}},
    hovermode:'closest'}, {...PLOT,toImageButtonOptions:{format:'png',filename:'dias_desde_'+id+'_mm',height:650,width:850,scale:2}});
  $('fixedInfo'+id).innerHTML=tr.slope_per_decade===null?
    `${tr.n} años completos; se requieren al menos 10 para calcular la tendencia.`:
    `${stateChip(tr)} <span class="pinfo">${tr.n} años · ${fmtS(tr.slope_per_decade,2)} días/década (IC ${fmtS(tr.ci_low_per_decade,2)} a ${fmtS(tr.ci_high_per_decade,2)}) · p Holm ${fmtP(pBest(tr))} · media ${fmt(mean,1)} d/año · ${tr.first_year}–${tr.last_year}</span>`;
 }
 document.querySelectorAll('.fixed-card').forEach(card=>card.classList.toggle('selected',card.dataset.fixed===$('mapFixed').value));
 renderValidity();
}
function renderResult(){
 let r=state.result,pts=r.points;
 $('focusedPoint').innerHTML=pts.map((p,i)=>`<option value="${i}">${escapeHTML(p.name)}</option>`).join('');
 $('fixedPoint').innerHTML=$('focusedPoint').innerHTML;
 $('reviewPoint').innerHTML=$('focusedPoint').innerHTML;
 renderMetricCards();
 const tr=$('statsTable').querySelector('tbody');tr.innerHTML=pts.map((p,i)=>{
   const s=p.summary,at=s.annual_trend,st=STATE[stateOf(at)],l10=p.advanced?.return_levels?.levels?.find(l=>l.T===10),lv=LEVEL[p.validity?.nivel];
   const cells=[`<span style="color:${pointColor(i)}">●</span> ${escapeHTML(p.name)}`,s.complete_years,fmt(s.mean_annual_mm,0)+' mm',fmt(s.daily_max_mm,1)+' mm',fmt(s.max_rx5day_mm,1)+' mm',fmt(s.max_cdd_days,0),at.slope_per_decade===null?'—':fmt(at.slope_per_decade,1)+' mm/dec',fixedChange(at),fmt(at.kendall_p,3),
     at.ci_low_per_decade==null?'—':`${fmt(at.ci_low_per_decade,0)} a ${fmt(at.ci_high_per_decade,0)}`,fmtP(pBest(at)),`<span style="color:${st.color}">${st.sym}</span> ${st.label}`,
     ...[80,90,95,98,99].map(q=>fmt(p.thresholds[String(q)],1)+' mm'),s.extreme_days_full_series?.['99']??'—',s.extreme_episodes_full_series?.['99']??'—',l10?fmt(l10.mm,0)+' mm':'—',lv?`<span class="v-${lv.cls}">${lv.icon} ${lv.label}</span>`:'—'];
   return '<tr>'+cells.map(c=>'<td>'+c+'</td>').join('')+'</tr>'}).join('');
 $('sourceDetails').innerHTML=`<strong>Fuente:</strong> ${escapeHTML(r.source_label)} · <strong>Período:</strong> ${r.start_year}–${r.end_year} · <strong>Umbrales:</strong> ${escapeHTML(r.points[0].summary.population)} · <strong>Área:</strong> ${r.area_mode==='block3'?'promedio 3 × 3 celdas':'1 celda por punto'} · <strong>Archivos:</strong> ${escapeHTML(r.saved_to||'')}<details><summary>Documentar procedencia de solicitudes</summary>${pts.map(p=>`<p><strong>${escapeHTML(p.name)}</strong>: ${p.provenance.slice(0,12).map(u=>u.startsWith('https://')?`<a href="${escapeHTML(u)}" target="_blank" rel="noreferrer">Enlace de descarga</a>`:escapeHTML(u)).join(' · ')}${p.provenance.length>12?` · (+${p.provenance.length-12} consultas)`:''}</p>`).join('')}</details>`;
 ['exportDaily','exportAnnual','exportSummary','exportTxt','toggleFloat'].forEach(id=>$(id).disabled=false);
 renderChart();
 renderDashboard();
 renderFixedPanels();
 refreshMapYears();
 if(typeof valOnAnalysis==='function')valOnAnalysis();
 renderThematicMap();
 renderTxtCatalog();
 renderDataReview();
}

// ---------------------------------------------------------------------------
// 8. EXPORTACIONES (v5)
// ---------------------------------------------------------------------------
function exportCSV(kind){
 let points=state.result?.points;if(!points)return;
 let rows=[];
 for(let p of points){for(let r of p[kind]){
  if(kind==='daily')rows.push([p.name,p.lat,p.lon,r.date,r.mm]);
  else rows.push([p.name,p.lat,p.lon,r.year,r.total,r.coverage,...(kind==='annual'?[r.rx1day,r.rx5day,r.r95ptot,r.r99ptot,r.cdd,r.wet_days,...[80,90,95,98,99].map(q=>r.exceedances[q]),...FIXED.map(t=>r.fixed_days[String(t)])]:[r.month,r.wet_days])]);
 }}
 let header=kind==='daily'?['lugar','latitud','longitud','fecha','precipitacion_mm']:
  kind==='annual'?['lugar','latitud','longitud','anio','acumulado_mm','cobertura_pct','rx1day_mm','rx5day_mm','r95ptot_mm','r99ptot_mm','cdd_dias','dias_lluviosos','dias_P80','dias_P90','dias_P95','dias_P98','dias_P99',...FIXED.map(t=>'dias_desde_'+fixedId(t)+'_mm')]:
  ['lugar','latitud','longitud','anio','acumulado_mm','cobertura_pct','mes','dias_lluviosos'];
 let txt='﻿'+[header,...rows].map(row=>row.map(v=>v===null||v===undefined?'':String(v).includes(';')?'"'+String(v).replace(/"/g,'""')+'"':String(v)).join(';')).join('\r\n');
 download(new Blob([txt],{type:'text/csv;charset=utf-8'}),`lluvia_cr_${kind}.csv`);
}
function download(blob,name){let a=document.createElement('a'),u=URL.createObjectURL(blob);a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1500)}
function exportSummary(){
 if(!state.result)return;
 const d=state.result;let summary={method:d.method,source:d.source_label,period:[d.start_year,d.end_year],reference:[d.ref_start,d.ref_end],population:d.population,wet_min:d.wet_min,area_mode:d.area_mode,
  points:d.points.map(p=>({name:p.name,lat:p.lat,lon:p.lon,thresholds:p.thresholds,summary:p.summary,advanced:p.advanced,cell_report:p.cell_report,validity:p.validity,provenance:p.provenance}))};
 download(new Blob([JSON.stringify(summary,null,2)],{type:'application/json'}),'estadisticos_lluvia_cr.json');
}

function downloadServerFile(filename){
 if(!state.job||!state.result)return;
 const names=new Set((state.result.exports||[]).map(e=>e.name));
 if(!names.has(filename))return showError(Error('El archivo solicitado no existe en este análisis.'));
 const href='/api/download?id='+encodeURIComponent(state.job)+'&name='+encodeURIComponent(filename);
 const a=document.createElement('a');a.href=href;a.download=filename;
 document.body.appendChild(a);a.click();a.remove();
}
function renderTxtCatalog(){
 const files=state.result?.exports||[];
 $('txtCatalog').innerHTML='<h4>Archivos TXT generados automáticamente</h4><p class="hint">Tabulados, con cabeceras y datos reales de precipitación. Incluyen la serie diaria, umbrales, días y episodios extremos P90/P95/P99, tendencias avanzadas y la ficha de celda e idoneidad de cada punto.</p>'+
 files.filter(f=>f.name==='DATOS_TXT_COMPLETOS.zip'||f.name.startsWith('TODOS_LOS_PUNTOS')||f.name.includes('SOLO_EVENTOS')).map(f=>
 `<a href="/api/download?id=${encodeURIComponent(state.job)}&name=${encodeURIComponent(f.name)}" download="${escapeHTML(f.name)}">${escapeHTML(f.name)}</a>`).join('')+
 '<details><summary>Ver y descargar cada TXT por separado</summary>'+
 files.filter(f=>f.name.endsWith('.txt')).map(f=>`<a href="/api/download?id=${encodeURIComponent(state.job)}&name=${encodeURIComponent(f.name)}" download="${escapeHTML(f.name)}">${escapeHTML(f.name)}</a>`).join('')+'</details>';
}

// ---------------------------------------------------------------------------
// 9. MAPA TEMÁTICO Y GRÁFICO FLOTANTE (v5)
// ---------------------------------------------------------------------------
function refreshMapYears(){
 const year=$('mapYear');const prev=year.value;
 year.innerHTML='<option value="all">Toda la serie</option>'+
 Array.from({length:state.result.end_year-state.result.start_year+1},(_,i)=>state.result.start_year+i).map(y=>`<option value="${y}">${y}</option>`).join('');
 year.value=Array.from(year.options).some(o=>o.value===prev)?prev:'all';
}
function currentMapPct(){return $('mapPct').value||'95'}
function currentMapYear(){return $('mapYear').value||'all'}
function fixedMetric(){return $('mapMetric').value.startsWith('fixed_')}
function updateMapControls(){
 const fixed=fixedMetric(),metric=$('mapMetric').value;
 $('mapFixedWrap').hidden=!fixed;$('mapPctWrap').hidden=fixed;
 $('mapYear').disabled=['fixed_change','fixed_slope','threshold','trend','pct_change','pct_slope','coverage'].includes(metric);
}
function mapMetricDetail(p){
 const pct=currentMapPct(),year=currentMapYear(),metric=$('mapMetric').value;
 const ann=year==='all'?null:p.annual.find(r=>String(r.year)===year);
 const th=p.thresholds[pct];let value=null,label='';
 switch(metric){
 case 'fixed_days':{
  const key=$('mapFixed').value;
  value=ann?ann.fixed_days?.[key]:year==='all'?p.summary.fixed_threshold_mean_days?.[key]:null;
  label=`Días ≥ ${fmt(+key,1)} mm (${year==='all'?'media anual':year})`;break;
 }
 case 'fixed_change':{
  const key=$('mapFixed').value;
  value=p.summary.fixed_threshold_trends?.[key]?.relative_change_pct;
  label=`Cambio de tendencia ≥ ${fmt(+key,1)} mm (%)`;break;
 }
 case 'fixed_slope':{
  const key=$('mapFixed').value;
  value=p.summary.fixed_threshold_trends?.[key]?.slope_per_decade;
  label=`Tendencia ≥ ${fmt(+key,1)} mm (días/década)`;break;
 }
 case 'threshold':value=th;label=`Umbral P${pct} (mm/día)`;break;
 case 'extreme_days':value=ann?ann.exceedances[pct]:year==='all'?p.summary.extreme_days_full_series[pct]:null;label=`Días >P${pct} (${year==='all'?'toda la serie':year})`;break;
 case 'extreme_mm':value=ann?ann.extreme_mm?.[pct]:year==='all'?p.summary.extreme_rain_total_mm[pct]:null;label=`Lluvia extrema >P${pct} (mm)`;break;
 case 'episodes':value=ann?ann.event_counts?.[pct]:year==='all'?p.summary.extreme_episodes_full_series[pct]:null;label=`Episodios >P${pct}`;break;
 case 'max_daily':value=ann?ann.rx1day:year==='all'?p.summary.daily_max_mm:null;label='Máximo diario (mm)';break;
 case 'pct_change':value=p.summary.extreme_count_trends?.[pct]?.relative_change_pct;label=`Cambio de días >P${pct} (%)`;break;
 case 'pct_slope':value=p.summary.extreme_count_trends?.[pct]?.slope_per_decade;label=`Tendencia de días >P${pct} (días/década)`;break;
 case 'coverage':value=p.quality?.coverage_pct;label='Cobertura de datos (%)';break;
 case 'trend':value=p.summary.annual_trend.slope_per_decade;label='Tendencia anual (mm/década)';break;
 }
 return {value:value??null,label};
}
function plotMiniPopup(i){
 const p=state.result?.points?.[i];if(!p||!window.Plotly)return;
 const target=document.getElementById('miniPlot'+i);if(!target)return;
 const pct=currentMapPct(),key=$('mapFixed').value;
 const years=p.annual.map(r=>r.year),vals=p.annual.map(r=>fixedMetric()?r.fixed_days?.[key]:r.exceedances[pct]);
 Plotly.newPlot(target,[{x:years,y:vals,type:'bar',marker:{color:pointColor(i)}}],{
   margin:{l:32,r:4,t:4,b:27},paper_bgcolor:'#fff',plot_bgcolor:'#fff',
   xaxis:{tickfont:{size:9}},yaxis:{tickfont:{size:9},title:{text:'días',font:{size:9}}},
   showlegend:false,font:{size:9}}, {responsive:false,displayModeBar:false,staticPlot:true});
}
function mapPopupHTML(p,i,detail){
 const v=detail.value===null?'Sin dato / año incompleto':fmt(detail.value,2);
 const tr=fixedMetric()?p.summary.fixed_threshold_trends?.[$('mapFixed').value]:null;
 const c=p.cell_report?.cell;
 return `<div class="map-point-tooltip"><strong>${escapeHTML(p.name)}</strong><br>
   <span class="pill">${escapeHTML(detail.label)}: ${v}</span><br>
   ${tr?`Cambio: ${fixedChange(tr)} · ${STATE[stateOf(tr)].sym} ${STATE[stateOf(tr)].label} · ${tr.n} años completos<br>`:''}
   Cobertura ${fmt(p.summary.coverage_pct,1)}%${tr?'':` · P${currentMapPct()} ${fmt(p.thresholds[currentMapPct()],1)} mm/día`}<br>
   ${c?.available?`Celda ≈ ${fmt(c.width_km,0)} × ${fmt(c.height_km,0)} km · ${LEVEL[p.validity?.nivel]?.label||''}<br>`:''}
   <div class="map-mini-plot" id="miniPlot${i}"></div>
   <span class="map-thematic-note">Barras: días ${tr?'≥ umbral fijo':'extremos'} por año, sin años incompletos. Haz clic para ver el gráfico flotante.</span></div>`;
}
function activateMapPoint(i){
 state.mapOverlayPoint=i;
 if($('focusedPoint')){$('focusedPoint').value=String(i);$('fixedPoint').value=String(i);renderMetricCards();renderChart();renderFixedPanels()}
 $('floatingChart').hidden=false;
 $('floatTitle').textContent=`${state.result.points[i].name} · P${currentMapPct()}`;
 renderFloatChart();
}
function renderThematicMap(){
 if(!state.result)return;
 updateMapControls();
 const points=state.result.points;
 const vals=points.map(p=>mapMetricDetail(p));
 const absmax=Math.max(1,...vals.map(v=>Number.isFinite(v.value)?Math.abs(v.value):0));
 const metric=$('mapMetric').value;
 $('mapExplainer').textContent=metric==='fixed_days'?
  `${vals[0].label}. Cada círculo muestra el valor de su punto; el tamaño refleja la magnitud y el cuadro, la celda medida. No representa un total regional ni lluvia interpolada.`:
  ['fixed_change','fixed_slope','pct_change','pct_slope'].includes(metric)?
  `${vals[0].label}. Las tendencias usan años completos (mínimo 10); los valores negativos indican disminución. «s/d» significa porcentaje o tendencia no calculable. El % no indica significancia: revisa el estado en la ficha.`:
  `${vals[0].label}. Círculos de puntos analizados, sin interpolación espacial.`;
 if(state.map&&window.L){
   for(const l of state.mapThematic||[])state.map.removeLayer(l);
   state.mapThematic=[];
   points.forEach((p,i)=>{
     const d=vals[i];const radius=d.value===null?11:12+21*Math.sqrt(Math.abs(d.value)/absmax);
     const color=['fixed_change','pct_change'].includes(metric)?(d.value<0?'#9a4b31':'#205ca6'):pointColor(i);
     const layer=L.circleMarker([p.lat,p.lon],{radius,color:'#fff',weight:2,fillColor:color,fillOpacity:.80});
     layer.bindTooltip(`${p.name}: ${d.value!==null&&d.value>0&&['fixed_change','pct_change'].includes(metric)?'+':''}${fmt(d.value,1)} · ${d.label}`,{direction:'top'});
     layer.bindPopup(mapPopupHTML(p,i,d),{maxWidth:310});
     layer.on('popupopen',()=>{plotMiniPopup(i);activateMapPoint(i)});
     layer.addTo(state.map);state.mapThematic.push(layer);
   });
 }
 const g=$('fallbackThematic');if(g){
   g.innerHTML='';points.forEach((p,i)=>{
     const [x,y]=project(p.lon,p.lat),detail=vals[i];
     const size=detail.value===null?12:13+20*Math.sqrt(Math.abs(detail.value)/absmax);
     let grp=svgElement('g',{style:'cursor:pointer'},g);
     const color=['fixed_change','pct_change'].includes(metric)?(detail.value<0?'#9a4b31':'#205ca6'):pointColor(i);
     svgElement('circle',{cx:x,cy:y,r:size,fill:color,stroke:'white','stroke-width':3,'fill-opacity':'.82'},grp);
     let txt=svgElement('text',{x,y:y+3,'font-size':10,'text-anchor':'middle','font-weight':700,fill:'white'},grp);
     txt.textContent=Number.isFinite(detail.value)?`${['fixed_change','pct_change'].includes(metric)&&detail.value>0?'+':''}${fmt(detail.value,0)}${['fixed_change','pct_change'].includes(metric)?'%':''}`:'s/d';
     const title=svgElement('title',{},grp);title.textContent=`${p.name}: ${fmt(detail.value,1)} ${detail.label}`;
     grp.addEventListener('click',e=>{e.stopPropagation();activateMapPoint(i)});
   });
 }
 if(!$('floatingChart').hidden)renderFloatChart();
}
function renderFloatChart(){
 if(!state.result||!window.Plotly||$('floatingChart').hidden)return;
 const pct=currentMapPct(),year=currentMapYear(),mode=$('mapChartMode').value;
 const p=state.result.points[state.mapOverlayPoint]||state.result.points[0];
 let traces=[],title='';
 if(mode==='events'){
  title='Días de lluvia extrema > P'+pct;
  for(const [i,point] of state.result.points.entries()){
   const days=(point.extreme_days[pct]||[]).filter(d=>year==='all'||String(d.anio)===year);
   traces.push({x:days.map(d=>d.fecha),y:days.map(d=>d.lluvia_mm),name:point.name,type:'scatter',mode:'markers',marker:{size:6,color:pointColor(i)}});
  }
 }else if(mode==='annual'){
  title='Acumulados anuales (mm)';
  state.result.points.forEach((point,i)=>{
   const annual=point.annual.filter(r=>year==='all'||String(r.year)===year);
   traces.push({x:annual.map(r=>r.year),y:annual.map(r=>r.total),name:point.name,type:'scatter',mode:'lines+markers',line:{color:pointColor(i)}});
  });
 }else if(mode==='fixed'){
  title='Días ≥ '+fmt(+$('mapFixed').value,1)+' mm por año';
  const key=$('mapFixed').value;
  state.result.points.forEach((point,i)=>{
   const annual=point.annual.filter(r=>year==='all'||String(r.year)===year);
   traces.push({x:annual.map(r=>r.year),y:annual.map(r=>r.fixed_days?.[key]??null),name:point.name,
     type:'scatter',mode:'lines+markers',line:{color:pointColor(i)}});
  });
 }else{
  title='Umbrales en mm/día';
  traces=[{x:['P90','P95','P99'],y:['90','95','99'].map(k=>p.thresholds[k]),type:'bar',name:p.name,marker:{color:pointColor(state.mapOverlayPoint)}}];
 }
 $('floatTitle').textContent=title+' · '+p.name;
 const lt={margin:{t:12,l:51,r:12,b:65},paper_bgcolor:'#fff',plot_bgcolor:'#fff',
  showlegend:state.result.points.length>1&&mode!=='thresholds',font:{family:'Arial',size:10},
  legend:{orientation:'h',x:0,y:-.24},xaxis:{gridcolor:'#e3e3e3'},yaxis:{title:{text:mode==='fixed'?'días':mode==='thresholds'||mode==='annual'||mode==='events'?'mm':''},gridcolor:'#e3e3e3'},hovermode:'closest'};
 Plotly.react($('mapFloatChart'),traces,lt,{responsive:true,displaylogo:false,toImageButtonOptions:{format:'png',filename:'lluvia_sobre_mapa',height:720,width:1000,scale:2}});
}
function initializeMapV4(){
 ['mapMetric','mapPct','mapFixed','mapYear','mapChartMode'].forEach(id=>$(id).onchange=()=>{
   renderThematicMap();renderFloatChart();
   if(id==='mapFixed'&&state.result)renderFixedPanels();
   if(id==='mapPct'){$('focusedPct').value=currentMapPct();if(state.result){renderChart();renderDashboard()}}
 });
 $('showCells').onchange=drawCells;
 updateMapControls();
 document.querySelectorAll('.fixed-card').forEach(card=>{
  card.setAttribute('role','button');card.setAttribute('tabindex','0');
  const go=()=>{$('mapFixed').value=card.dataset.fixed;$('mapMetric').value='fixed_days';renderThematicMap();renderFixedPanels();$('mapa').scrollIntoView({behavior:'smooth',block:'start'})};
  card.addEventListener('click',go);card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go()}});
 });
 $('toggleFloat').onclick=()=>{$('floatingChart').hidden=!$('floatingChart').hidden;renderFloatChart()};
 $('floatClose').onclick=()=>{$('floatingChart').hidden=true};
 const bar=$('floatHandle'),box=$('floatingChart'),container=box.parentElement;
 let pointer=null;
 bar.addEventListener('pointerdown',e=>{
   if(e.target.closest('button'))return;
   const outer=container.getBoundingClientRect(),rect=box.getBoundingClientRect();
   pointer={id:e.pointerId,dx:e.clientX-rect.left,dy:e.clientY-rect.top,outer};
   bar.setPointerCapture(e.pointerId);
 });
 bar.addEventListener('pointermove',e=>{
   if(!pointer||e.pointerId!==pointer.id)return;
   const maxx=container.clientWidth-box.offsetWidth,maxy=container.clientHeight-box.offsetHeight;
   box.style.left=Math.min(Math.max(0,e.clientX-pointer.outer.left-pointer.dx),Math.max(0,maxx))+'px';
   box.style.top=Math.min(Math.max(0,e.clientY-pointer.outer.top-pointer.dy),Math.max(0,maxy))+'px';
   box.style.right='auto';
 });
 bar.addEventListener('pointerup',()=>{pointer=null});
 bar.addEventListener('pointercancel',()=>{pointer=null});
 for(const e of ['click','dblclick','mousedown','mouseup','wheel']){
   box.addEventListener(e,ev=>ev.stopPropagation());
   $('cellCard').addEventListener(e,ev=>ev.stopPropagation());
 }
}

function updateSourceUI(){
 const v=$('source').value;updateSourceControls();
 $('gridHint').textContent=(GRID_TEXT[v]||GRID_TEXT.csv).hint;$('gridBadge').textContent=(GRID_TEXT[v]||GRID_TEXT.csv).badge;
 if(v!=='gpm'&&areaNow()==='block3'){$('areaMode').value='cell';updateAreaHint()}
 $('areaMode').querySelector('option[value="block3"]').disabled=v!=='gpm';
 if(v==='merra2'&&+$('startYear').value<1981)$('startYear').value=1981;
 if(v==='gpm'&&+$('startYear').value<2001)$('startYear').value=2001;
}
function updateAreaHint(){
 $('areaHint').textContent=areaNow()==='block3'?
  'Promedio de 3 × 3 celdas IMERG (≈ 33 × 33 km): serie menos ruidosa, pero atenúa los picos. Los umbrales en mm no son comparables con el modo de 1 celda. Consulta 9 celdas por punto: tarda más.':
  'El producto entrega un valor por celda: no se puede pedir un área más pequeña que la celda. Cada clic muestra la celda real que se usará.';
}

async function initialize(){
 try{
  let r=await fetch('/api/places');const d=await r.json();state.places=d.places;
  $('names').innerHTML=state.places.map(p=>`<option value="${escapeHTML(p.name)}"></option>`).join('');
  const f=await fetch('/assets/borders.geojson');state.countries=await f.json();drawFallback();
  loadLeaflet();
 }catch(e){showError(e)}
 $('addPlace').onclick=addByName;
 $('addCoordinates').onclick=addFreeCoordinates;
 for(const id of ['freePointName','freeLat','freeLon'])$(id).addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addFreeCoordinates()}});
 $('placeSearch').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();addByName()}};
 $('clearPoints').onclick=()=>{state.points=[];renderPoints();refreshMarkers()};
 $('analyzeBtn').onclick=runAnalysis;
 $('source').onchange=()=>{updateSourceUI();refreshAllCells()};
 $('areaMode').onchange=()=>{
  if(areaNow()==='block3'&&state.points.length>3){message('Demasiados puntos para 3 × 3','El promedio 3 × 3 admite 3 puntos como máximo. Quita puntos o vuelve a 1 celda.','error');$('areaMode').value='cell'}
  updateAreaHint();refreshAllCells();
 };
 document.querySelectorAll('#pctchecks input').forEach(n=>n.onchange=()=>{if(state.result)renderChart()});
 $('focusedPoint').onchange=()=>{$('fixedPoint').value=$('focusedPoint').value;renderMetricCards();renderChart();renderDashboard();renderFixedPanels();state.mapOverlayPoint=+$('focusedPoint').value;renderFloatChart()};$('focusedPct').onchange=()=>{renderChart();renderDashboard();renderFloatChart()};
 $('fixedPoint').onchange=()=>{$('focusedPoint').value=$('fixedPoint').value;renderMetricCards();renderChart();renderDashboard();renderFixedPanels();state.mapOverlayPoint=+$('fixedPoint').value;renderFloatChart()};
 $('advMetric').onchange=renderChart;
 $('tabs').querySelectorAll('.tab').forEach(btn=>btn.onclick=()=>{
  state.activeTab=btn.dataset.tab; document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t===btn));renderChart();
 });
 $('exportDaily').onclick=()=>exportCSV('daily');$('exportAnnual').onclick=()=>exportCSV('annual');$('exportSummary').onclick=exportSummary;
 $('exportTxt').onclick=()=>downloadServerFile('DATOS_TXT_COMPLETOS.zip');
 updateSourceUI();updateAreaHint();
 initializeMapV4();
 initFigureTools();
 renderPoints();
 initializeDataTools();
}
initialize();
