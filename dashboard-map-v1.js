const $ = selector => document.querySelector(selector);
const login = $('#login'), app = $('#app'), loginForm = $('#loginForm'), loginError = $('#loginError');
const summary = $('#summary'), locations = $('#locations'), mapPanel = $('#mapPanel'), mapNote = $('#mapNote');
const statusBox = $('#status'), search = $('#search'), area = $('#area'), severity = $('#severity'), category = $('#category');
const resultCount = $('#resultCount'), updated = $('#updated'), listViewButton = $('#listView'), mapViewButton = $('#mapView');

const infoModal = $('#infoModal'), infoTitle = $('#infoTitle'), infoContent = $('#infoContent'), closeInfoButton = $('#closeInfo');
let dataset = null, timer = null, selectedView = 'list', problemMap = null, markerLayer = null;
const areaNames = {vienna:'Wien', graz:'Graz', linz:'Linz', rest:'Rest'};
const severityNames = ['Nicht klassifiziert','Information','Warnung','Durchschnitt','Hoch','Katastrophe'];
const categoryNames = {toner:'Toner niedrig',paper_jam:'Papierstau',paper_empty:'Papier leer',paper_low:'Papier niedrig',printer_error:'Druckerfehler',scanner:'Scannerfehler',unfinished_print:'Offene Druckjobs',offline:'Gerät offline',hidden:'Verstecktes Problem',other:'Sonstiges'};
const categoryRank = {printer_error:80,offline:70,scanner:60,paper_jam:50,paper_empty:40,unfinished_print:30,hidden:25,toner:20,paper_low:10,other:0};

function age(timestamp) {
  if (!timestamp) return 'Zeitpunkt unbekannt';
  const seconds = Math.max(0, Date.now()/1000-timestamp), minutes = Math.floor(seconds/60);
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return 'seit ' + minutes + ' Min.';
  const hours = Math.floor(minutes/60);
  if (hours < 24) return 'seit ' + hours + ' Std. ' + (minutes%60) + ' Min.';
  const days = Math.floor(hours/24);
  return 'seit ' + days + ' Tag' + (days===1?'':'en') + ' ' + (hours%24) + ' Std.';
}
function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>'"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character]));
}
function compareProblems(left,right) {
  if (left.priority!==right.priority) return right.priority-left.priority;
  if (categoryRank[left.category]!==categoryRank[right.category]) return categoryRank[right.category]-categoryRank[left.category];
  return left.since-right.since;
}
function mainProblem(problems) { return [...problems].sort(compareProblems)[0]; }
function visibleProblems() {
  const query = search.value.trim().toLowerCase();
  return dataset.problems.filter(problem =>
    (area.value==='all'||problem.area===area.value) &&
    (severity.value==='all'||String(problem.priority)===severity.value) &&
    (category.value==='all'||problem.category===category.value) &&
    (!query||(problem.host+' '+problem.description+' '+(problem.address||'')).toLowerCase().includes(query))
  );
}
function groupByHost(problems) {
  const grouped = new Map();
  for (const problem of problems) {
    if (!grouped.has(problem.host)) grouped.set(problem.host,[]);
    grouped.get(problem.host).push(problem);
  }
  return [...grouped.entries()].map(entry => ({host:entry[0],problems:entry[1],main:mainProblem(entry[1])}))
    .sort((left,right) => compareProblems(left.main,right.main)||left.host.localeCompare(right.host,'de'));
}
function hiddenActivity(problem) {
  if (!problem.hidden) return '';
  const lastPrint = problem.lastPrint?new Date(problem.lastPrint).toLocaleString('de-AT'):'nicht gefunden';
  const lastFillup = problem.lastFillup?new Date(problem.lastFillup).toLocaleString('de-AT'):'nicht gefunden';
  return '<small class="hidden-activity">Letzter Druck: '+escapeHtml(lastPrint)+'<br>Letzte Einzahlung: '+escapeHtml(lastFillup)+'</small>';
}
function dotClass(problem) { return problem.hidden?'hidden-dot':'sev-'+problem.priority; }

const infoGroups = [
  ['Standort', ['ff','Betreiber','Label','Name','PLZ','Ort','besucht am']],
  ['Druck & Verbrauch', ['Papier vorr.','Gerät','Tinte','K','M','C','Y','CODE']],
  ['Geräte & Funktionen', ['PL1','PL2','PL3','PL4','Scanner','PC','ZAHLUNG','Ventilatoren','Bill Acc.']],
  ['Netzwerk', ['Internet','Provider','YessNr','Master']],
  ['Kontakt & Zugang', ['Telefon','Ansprechpartner','Standort der Printbox','Schlüssel']]
];
const infoLabels = {'ff':'Printbox','besucht am':'Zuletzt besucht','Papier vorr.':'Papiervorrat','Bill Acc.':'Scheinakzeptor','YessNr':'Yess-Nummer','Standort der Printbox':'Position der Printbox','Schlüssel':'Schlüsselhinweis'};

function infoButton(host,label) {
  return '<button class="info-trigger" type="button" data-host="'+escapeHtml(host)+'">'+escapeHtml(label||'Info')+'</button>';
}
function renderInfoGroup(title,keys,info) {
  const fields=keys.filter(key=>info[key]).map(key=>
    '<div class="info-field"><dt>'+escapeHtml(infoLabels[key]||key)+'</dt><dd>'+escapeHtml(info[key]).replaceAll(String.fromCharCode(10),'<br>')+'</dd></div>'
  ).join('');
  return fields?'<section class="info-group"><h3>'+escapeHtml(title)+'</h3><dl>'+fields+'</dl></section>':'';
}
function openInfo(host) {
  if (!dataset) return;
  const problem=dataset.problems.find(item=>item.host===host&&item.terminalInfo);
  if (!problem) return;
  const info=problem.terminalInfo;
  const knownKeys=new Set(infoGroups.flatMap(group=>group[1]));
  const extraKeys=Object.keys(info).filter(key=>!knownKeys.has(key)&&info[key]);
  infoTitle.textContent=host;
  infoContent.innerHTML=infoGroups.map(group=>renderInfoGroup(group[0],group[1],info)).join('')+
    renderInfoGroup('Weitere Angaben',extraKeys,info);
  infoModal.hidden=false;
  infoModal.setAttribute('aria-hidden','false');
  document.body.classList.add('modal-open');
  closeInfoButton.focus();
}
function closeInfo() {
  infoModal.hidden=true;
  infoModal.setAttribute('aria-hidden','true');
  document.body.classList.remove('modal-open');
}
function detailProblem(problem) {
  return '<div class="detail-problem"><i class="severity-dot '+dotClass(problem)+'"></i><div><strong>'+
    escapeHtml(problem.description)+'</strong><small>'+escapeHtml(categoryNames[problem.category]||categoryNames.other)+' · '+
    escapeHtml(severityNames[problem.priority])+'</small>'+hiddenActivity(problem)+'</div><span>'+age(problem.since)+'</span></div>';
}
function hostRow(host,index) {
  const main=host.main, count=host.problems.length;
  const infoCell=main.terminalInfo?'<span class="info-cell">'+infoButton(host.host,'Standortinfo')+'</span>':'<span class="info-cell no-info">–</span>';
  return '<div class="location-row-wrap"><div class="location-row" role="button" tabindex="0" aria-expanded="false" aria-controls="details-'+index+'" data-details="details-'+index+'">'+
    '<span class="cell host-cell"><i class="severity-dot '+dotClass(main)+'"></i><strong>'+escapeHtml(host.host)+'</strong><small>'+(count>1?count+' Probleme':'1 Problem')+'</small></span>'+
    '<span class="cell main-problem"><strong>'+escapeHtml(main.description)+'</strong><small>'+escapeHtml(categoryNames[main.category]||categoryNames.other)+' · '+escapeHtml(severityNames[main.priority])+'</small></span>'+
    infoCell+'<span class="cell region-cell">'+escapeHtml(areaNames[main.area]||areaNames.rest)+'</span><span class="cell since-cell">'+age(main.since)+'</span><span class="expand-icon">⌄</span></div>'+
    '<div class="location-details" id="details-'+index+'" hidden><div class="details-title">Alle Probleme dieses Standorts</div>'+
    [...host.problems].sort(compareProblems).map(detailProblem).join('')+'</div></div>';
}function renderList(hosts) {
  locations.innerHTML = hosts.length?'<div class="problem-table"><div class="problem-table-head"><span>Standortname</span><span>Problem</span><span>Info</span><span>Region</span><span>Seit wann</span><span></span></div>'+
    hosts.map(hostRow).join('')+'</div>':'<div class="status">Keine passenden Probleme gefunden.</div>';
}
function mapPopup(host) {
  const main=host.main;
  return '<div class="map-popup"><div class="map-popup-title"><i class="severity-dot '+dotClass(main)+'"></i><strong>'+escapeHtml(host.host)+'</strong></div>'+
    '<div class="map-popup-meta">'+escapeHtml(areaNames[main.area]||areaNames.rest)+(main.address?' · '+escapeHtml(main.address):'')+'</div>'+
    (main.terminalInfo?infoButton(host.host,'Standortinfo'):'')+
    [...host.problems].sort(compareProblems).map(problem =>
      '<div class="map-popup-problem"><strong>'+escapeHtml(problem.description)+'</strong><span>'+escapeHtml(severityNames[problem.priority])+' · '+age(problem.since)+'</span>'+hiddenActivity(problem)+'</div>'
    ).join('')+'</div>';
}
function initializeMap() {
  if (problemMap||typeof L==='undefined') return;
  problemMap=L.map('problemMap',{zoomControl:true}).setView([47.7,13.35],7);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(problemMap);
  markerLayer=typeof L.markerClusterGroup==='function'?L.markerClusterGroup({showCoverageOnHover:false,maxClusterRadius:45}):L.layerGroup();
  markerLayer.addTo(problemMap);
}
function renderMap(hosts) {
  if (selectedView!=='map') return;
  initializeMap();
  if (!problemMap) { mapNote.textContent='Die Kartenbibliothek konnte nicht geladen werden.'; return; }
  markerLayer.clearLayers();
  const bounds=[]; let missingCoordinates=0;
  for (const host of hosts) {
    const main=host.main;
    if (main.lat==null||main.lon==null) { missingCoordinates++; continue; }
    const lat=Number(main.lat), lon=Number(main.lon);
    if (!Number.isFinite(lat)||!Number.isFinite(lon)) { missingCoordinates++; continue; }
    const colorClass=main.hidden?'marker-hidden':'sev-'+main.priority;
    const icon=L.divIcon({className:'problem-marker-anchor',html:'<span class="problem-marker '+colorClass+'"></span>',iconSize:[28,34],iconAnchor:[14,30],popupAnchor:[0,-28]});
    L.marker([lat,lon],{icon:icon,title:host.host}).bindPopup(mapPopup(host),{maxWidth:370}).addTo(markerLayer);
    bounds.push([lat,lon]);
  }
  requestAnimationFrame(() => {
    problemMap.invalidateSize();
    if (bounds.length===1) problemMap.setView(bounds[0],14);
    else if (bounds.length>1) problemMap.fitBounds(bounds,{padding:[32,32],maxZoom:14});
    else problemMap.setView([47.7,13.35],7);
  });
  mapNote.textContent=missingCoordinates?missingCoordinates+' Standort'+(missingCoordinates===1?'':'e')+' ohne hinterlegte Koordinaten nicht dargestellt.':'';
}
function render() {
  if (!dataset) return;
  const filtered=visibleProblems(), hosts=groupByHost(filtered);
  renderList(hosts); renderMap(hosts);
  resultCount.textContent=filtered.length+' Probleme an '+hosts.length+' Standorten';
  const critical=filtered.filter(problem=>problem.priority>=4).length;
  const old=filtered.filter(problem=>Date.now()/1000-problem.since>86400).length;
  const hidden=filtered.filter(problem=>problem.hidden).length;
  summary.innerHTML=[['Aktive Probleme',filtered.length,'critical'],['Betroffene Standorte',hosts.length,''],['Kritisch / Hoch',critical,'critical'],['Älter als 24 h',old,''],['Versteckte Probleme',hidden,'hidden-summary']]
    .map(item=>'<div class="summary-card '+item[2]+'"><small>'+item[0]+'</small><strong>'+item[1]+'</strong></div>').join('');
  updated.textContent='Aktualisiert: '+new Date(dataset.updatedAt*1000).toLocaleTimeString('de-AT',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
function selectView(view) {
  selectedView=view; const showMap=view==='map';
  locations.hidden=showMap; mapPanel.hidden=!showMap;
  listViewButton.classList.toggle('active',!showMap); mapViewButton.classList.toggle('active',showMap);
  listViewButton.setAttribute('aria-pressed',String(!showMap)); mapViewButton.setAttribute('aria-pressed',String(showMap));
  render();
}
locations.addEventListener('click',event=>{
  if(event.target.closest('.info-trigger'))return;
  const row=event.target.closest('.location-row'); if(!row)return;
  const details=document.getElementById(row.dataset.details),open=row.getAttribute('aria-expanded')==='true';
  row.setAttribute('aria-expanded',String(!open)); details.hidden=open;
});
locations.addEventListener('keydown',event=>{
  const row=event.target.closest('.location-row');
  if(!row||event.target.closest('.info-trigger')||(event.key!=='Enter'&&event.key!==' '))return;
  event.preventDefault();row.click();
});
document.addEventListener('click',event=>{
  const trigger=event.target.closest('.info-trigger');
  if(trigger){event.preventDefault();event.stopPropagation();openInfo(trigger.dataset.host);return}
  if(event.target.closest('[data-close-info]'))closeInfo();
});
closeInfoButton.addEventListener('click',closeInfo);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!infoModal.hidden)closeInfo()});
async function load(force=false) {
  statusBox.textContent='Probleme werden aus Zabbix und Printbox geladen …'; statusBox.className='status';
  try {
    const response=await fetch('/api/problems'+(force?'?refresh=1':'')),data=await response.json();
    if(response.status===401){showLogin();return}
    if(!response.ok)throw new Error(data.error||'Abfrage fehlgeschlagen.');
    dataset=data; const previousCategory=category.value;
    const categories=[...new Set(data.problems.map(problem=>problem.category))].sort();
    category.innerHTML='<option value="all">Alle Typen</option>'+categories.map(value=>'<option value="'+value+'">'+escapeHtml(categoryNames[value]||categoryNames.other)+'</option>').join('');
    if(categories.includes(previousCategory))category.value=previousCategory;
    statusBox.textContent=''; render();
  } catch(error) { statusBox.textContent=error.message; statusBox.className='status error'; }
}
function showLogin(){login.hidden=false;app.hidden=true;clearInterval(timer)}
function showApp(){login.hidden=true;app.hidden=false;load();clearInterval(timer);timer=setInterval(()=>load(),60000)}
[search,area,severity,category].forEach(element=>element.addEventListener(element===search?'input':'change',render));
listViewButton.addEventListener('click',()=>selectView('list'));
mapViewButton.addEventListener('click',()=>selectView('map'));
$('#refresh').addEventListener('click',()=>load(true));
$('#logout').addEventListener('click',async()=>{await fetch('/api/logout',{method:'POST'});showLogin()});
loginForm.addEventListener('submit',async event=>{
  event.preventDefault();loginError.textContent='';
  try{
    const response=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('#username').value,password:$('#password').value})});
    const data=await response.json();if(!response.ok)throw new Error(data.error);$('#password').value='';showApp();
  }catch(error){loginError.textContent=error.message||'Anmeldung fehlgeschlagen.'}
});
fetch('/api/session').then(response=>response.json()).then(session=>session.authenticated?showApp():showLogin()).catch(showLogin);
