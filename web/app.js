import {CONFIG} from './config.js';
import {ASSETS,EXCHANGES,fetchQuotes,fetchHistory,MAX_AGE_MS} from './market.js';
import {createGrid,replayDca,triggerMatches,paperFill} from './strategies.js';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const mode=CONFIG.mode;
let asset='ETH',snapshot=null,busy=false,generation=0,events=[],nextScan=0,historyData=null,historyBusy=false,historyGeneration=0,dcaResult=null,gridResult=null,armed=null,fill=null,lastFreshKey='';
const historyCache=new Map();
const n=(v,d=2)=>Number(v).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const sign=(v,d=2)=>(v>0?'+':'')+n(v,d);
const clock=ms=>new Date(ms).toLocaleTimeString('en-GB',{hour12:false});
const date=ms=>new Date(ms).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'});
const fresh=()=>snapshot?.quotes.filter(q=>q.status==='ok'&&Date.now()-q.receivedAt<=MAX_AGE_MS)||[];
const reference=()=>{const q=fresh().map(q=>q.mid).sort((a,b)=>a-b);return q.length?q.length%2?q[Math.floor(q.length/2)]:(q[q.length/2-1]+q[q.length/2])/2:null;};
function log(type,data={}){events.unshift({type,time:Date.now(),asset,...data});if(events.length>100)events.pop();$('#export').disabled=false;renderJournal();}
function renderJournal(){
 $('#journal-count').textContent=events.length+' '+'EVENTS';
 $('#journal-content').innerHTML=events.length?events.slice(0,12).map(e=>{
  const labels={scan:'SCAN',history:'HISTORY',arm:'ARMED',cancel:'PAUSED',fill:'PAPER'};
  const label=labels[e.type]||labels.scan;
  const detail=e.type==='scan'?`${e.asset} / USDT · ${e.sources}/3 ${'sources responding'}`:e.type==='history'?`${e.asset} · ${e.count} ${'closed daily candles loaded'}`:e.type==='arm'?`${e.exchange} · ask ${e.direction==='below'?'≤':'≥'} ${n(e.target)} USDT`:e.type==='fill'?`${'Simulated entry'}: ${n(e.units,6)} ${e.asset} @ ${n(e.price)} USDT`:'Monitoring disarmed';
  return `<div class="journal-entry"><time>${clock(e.time)}</time><span class="event-tag">${label}</span><span class="event-detail">${detail}</span><span class="event-meta">${e.asset} / USDT</span></div>`;
 }).join(''):`<p class="empty">${'Your next perspective starts with a scan.'}</p>`;
}
function renderQuotes(){
 $('#quotes').innerHTML=EXCHANGES.map(ex=>{const q=snapshot?.quotes.find(q=>q.id===ex.id),ok=q?.status==='ok',stale=ok&&Date.now()-q.receivedAt>MAX_AGE_MS;
 return `<article class="quote"><div class="quote-head"><span class="venue-icon">${{binance:'✦',okx:'▦',gate:'◉'}[ex.id]}</span>${ex.name}<span class="quote-state ${stale||!ok?'stale':''}">${q?(ok?stale?'STALE':'LIVE':'OFFLINE'):'—'}</span></div><div class="quote-label">${'MID-PRICE / USDT'}</div><div class="quote-price">${ok?n(q.mid):'—'}<small>USDT</small></div><div class="quote-book"><div>${'SELL / BID'}<b>${ok?n(q.bid):'—'}</b></div><div>${'BUY / ASK'}<b>${ok?n(q.ask):'—'}</b></div></div></article>`;
 }).join('');
}
function renderStatus(){
 $('#compare-label').textContent=busy?'Scanning exchanges…':'Compare prices';
 const count=fresh().length;
 $('#feed-status').textContent=busy?'Requesting public spot quotes…':snapshot?count?`${count} / 3 ${'sources responding'} · ${'USDT spot market'}`:'No fresh quotes. Run a new scan.':'Ready to scan';
 $('#scan-time').textContent=snapshot?`${clock(snapshot.fetchedAt)} · ${Math.max(0,Math.floor((Date.now()-snapshot.fetchedAt)/1000))}s ${'ago'}`:'—';
 $('#compare').disabled=busy;document.body.classList.toggle('loading',busy);
}
function numeric(ids){let valid=true;const out={};for(const id of ids){const el=$('#'+id);const ok=el.value.trim()!==''&&el.checkValidity();el.setAttribute('aria-invalid',String(!ok));if(!ok)valid=false;out[id]=Number(el.value);}$('#input-error').textContent=valid?'':'Check the input values and their allowed ranges.';return valid?out:null;}
function stat(label,value,sub=''){return `<div>${label}<strong>${value}</strong>${sub?`<small>${sub}</small>`:''}</div>`;}
function blankModel(text){$('#model').innerHTML=`<p class="empty">${text}</p>`;$('#model-stats').innerHTML='';$('#model-note').textContent='';}
function renderGrid(){
 const ref=reference(),v=numeric(['capital','range','levels','fee']);$('#range-value').textContent=$('#range').value+'%';$('#levels-value').textContent=$('#levels').value;
 gridResult=ref&&v?createGrid({reference:ref,capital:v.capital,range:v.range,intervals:v.levels,fee:v.fee,geometric:$('#geometric').checked}):null;
 if(!gridResult){blankModel('Compare fresh prices to build a grid around the live market.');$('#scenario-price').textContent='—';$('#crossings').textContent='—';return;}
 const g=gridResult,scenario=ref*(1+Number($('#scenario').value)/100),low=Math.min(g.low,scenario)*.997,high=Math.max(g.high,scenario)*1.003;
 const y=p=>230-(p-low)/(high-low)*195;
 const path=g.levels.map((p,i)=>{const yy=y(p),isBuy=p<ref;return `<line x1="80" y1="${yy}" x2="560" y2="${yy}" stroke="${isBuy?'var(--accent)':'#ceaa7b'}" stroke-opacity=".35"/><circle cx="${110+(i%4)*115}" cy="${yy}" r="3" fill="${isBuy?'var(--accent)':'#ceaa7b'}"/><text x="565" y="${yy+3}" text-anchor="start">${n(p)}</text>`;}).join('');
 $('#model').innerHTML=`<div class="grid-bounds"><span>${'THEORETICAL LEVELS'} · ${asset}</span><span>${$('#geometric').checked?'GEOMETRIC':'ARITHMETIC'}</span></div><svg viewBox="0 0 655 270" role="img" aria-label="Theoretical grid price levels">${path}<line x1="80" y1="${y(ref)}" x2="560" y2="${y(ref)}" stroke="var(--text)" stroke-width="1.5" stroke-dasharray="5 5"/><text x="0" y="${y(ref)+3}">REF ${n(ref)}</text><line x1="80" y1="${y(scenario)}" x2="560" y2="${y(scenario)}" stroke="var(--accent)" stroke-width="2"/><circle cx="330" cy="${y(scenario)}" r="5" fill="var(--accent)"/><text x="80" y="260">${'LOWER BOUND'} ${n(g.low)}</text><text x="560" y="260" text-anchor="end">${'UPPER BOUND'} ${n(g.high)}</text></svg>`;
 const avgCycle=g.cycles.reduce((s,c)=>s+c.net,0)/g.cycles.length;
 $('#model-stats').innerHTML=stat('Grid levels',g.levels.length)+stat('Budget per level',n(g.allocation)+' USDT')+stat('Ideal cycle, average',sign(avgCycle)+' USDT','hypothetical, after two fees');
 $('#model-note').textContent='Reference: median fresh mid-price. Levels and cycle estimates are hypothetical. No fills, spread, slippage or transfer costs are modeled.';
 $('#scenario-price').textContent=n(scenario)+' USDT';
 $('#crossings').textContent=g.levels.filter(p=>scenario>=ref?p>ref&&p<=scenario:p<ref&&p>=scenario).length+' / '+g.levels.length;
}
function renderDca(reset=false){
 const v=numeric(['budget','fee']);
 if(!historyData||!v){blankModel(historyBusy?'Loading real daily market history…':'Historical data unavailable. Click Refresh history to retry. Live quote comparison still works.');$('#replay-date').textContent='—';$('#replay-value').textContent='—';return;}
 dcaResult=replayDca(historyData.candles,{budget:v.budget,interval:Number($('#interval').value),days:Number($('#window').value),fee:v.fee});
 if(!dcaResult){blankModel('Not enough historical data for this replay.');return;}
 const r=dcaResult,points=r.points,slider=$('#replay');slider.max=points.length-1;if(reset||Number(slider.value)>points.length-1)slider.value=points.length-1;
 const index=Number(slider.value),p=points[index],shown=points.slice(0,index+1);
 const values=points.flatMap(p=>[p.price,p.avg]),min=Math.min(...values)*.98,max=Math.max(...values)*1.02;
 const x=i=>55+i/(points.length-1)*560,y=v=>235-(v-min)/(max-min)*195;
 const make=key=>shown.map((p,i)=>(i?'L':'M')+x(i).toFixed(2)+','+y(p[key]).toFixed(2)).join(' ');
 const guides=Array.from({length:4},(_,i)=>{const value=min+(max-min)*i/3,yy=y(value);return `<line class="gridline" x1="55" y1="${yy}" x2="615" y2="${yy}"/><text x="45" y="${yy+3}" text-anchor="end">${n(value,0)}</text>`;}).join('');
 $('#model').innerHTML=`<div class="chart-legend"><span><i></i>${'Daily close'}</span><span><i></i>${'Average cost, fee included'}</span></div><svg viewBox="0 0 650 275" role="img" aria-label="Historical daily close and simulated DCA average cost">${guides}<path class="price-line" d="${make('price')}"/><path class="average-line" d="${make('avg')}"/><line x1="${x(index)}" y1="25" x2="${x(index)}" y2="240" stroke="var(--accent)" stroke-dasharray="3 4" opacity=".5"/><circle cx="${x(index)}" cy="${y(p.price)}" r="4" fill="var(--accent)"/><text x="55" y="265">${date(points[0].time)}</text><text x="615" y="265" text-anchor="end">${date(points.at(-1).time)}</text></svg>`;
 const pnl=p.value-p.invested;
 $('#model-stats').innerHTML=stat('Contributed by checkpoint',n(p.invested)+' USDT',p.count+' '+'contributions')+stat('Portfolio at checkpoint',n(p.value)+' USDT',`${sign(pnl)} USDT / ${sign(pnl/p.invested*100)}%`)+stat('Average purchase cost',n(p.avg)+' USDT',n(p.units,5)+' '+asset);
 $('#model-note').textContent='Full-window lump-sum comparison'+`: ${n(r.lumpValue)} USDT · DCA ${n(r.final.value)} USDT. `+'Same total contributions. Historical close prices, not executable quotes. Exit costs excluded.';
 $('#replay-date').textContent=date(p.time);$('#replay-value').textContent=n(p.value)+' USDT';
}
function selectedQuote(){return fresh().find(q=>q.id===$('#venue')?.value);}
function renderSniping(){
 const qs=fresh(),q=selectedQuote(),max=Math.max(...qs.map(q=>q.latencyMs),1);
 $('#model').innerHTML=`<div class="radar-live"><span class="target-coin">${asset}</span>${EXCHANGES.map((e,i)=>`<span class="radar-node n${i}"><span class="dot" style="opacity:${qs.some(q=>q.id===e.id)?1:.15}"></span>${e.name}</span>`).join('')}</div><div class="radar-status">${armed?'◎ ARMED / AWAITING A FRESH MATCH':'○ OBSERVING / TRIGGER DISARMED'}</div><div class="latency-chart">${EXCHANGES.map(e=>{const q=qs.find(q=>q.id===e.id);return `<div class="latency-row"><span>${e.name}</span><div class="latency-track"><div class="latency-bar" style="width:${q?q.latencyMs/max*100:0}%;opacity:${q?1:0}"></div></div><span>${q?q.latencyMs+' ms':'—'}</span></div>`;}).join('')}</div>`;
 $('#model-stats').innerHTML=stat('Watching ask',q?n(q.ask)+' USDT':'—',q?.name||'No fresh quote')+stat('Your target',Number($('#target').value)>0?n($('#target').value)+' USDT':'—',$('#direction').value==='below'?'ASK ≤ TARGET':'ASK ≥ TARGET')+stat('Polling interval','15s','visible tab only');
 $('#model-note').textContent='Bars show measured API response time, not trade execution latency. Quotes must be fresh. Binance and Gate freshness is measured from receipt.';
 $('#arm').textContent=armed?'◉ Disarm trigger':'◎ Arm paper trigger';$('#arm').classList.toggle('armed',!!armed);document.body.classList.toggle('armed',!!armed);
 if(fill)$('#paper-entry').innerHTML=`<div class="fill-head">◎ ${'SIMULATED ENTRY RECORDED'} · ${fill.exchange} · ${clock(fill.filledAt)}</div><div class="fill-grid">${stat('Model entry price',n(fill.price)+' USDT')}${stat('Model quantity',n(fill.units,6)+' '+fill.asset)}${stat('Paper budget',n(fill.budget)+' USDT')}${stat('Fee / slippage',n(fill.fee)+'% / '+n(fill.slippage)+'%')}</div><p class="fill-note">${'This is a mathematical paper entry, not an executed order.'} ${fill.depthExceeded?'Position exceeds displayed ask size; deeper fills are not modeled.':''}</p>`;
 else $('#paper-entry').innerHTML=`<p class="empty">${'No paper entry yet. Arm a trigger and compare fresh prices.'}</p>`;
}
function renderStrategy(reset=false){if(mode==='grid')renderGrid();else if(mode==='dca')renderDca(reset);else renderSniping();}
function renderAll(){renderQuotes();renderStatus();renderStrategy();}
async function loadHistory(force=false){
 const selected=asset,id=++historyGeneration;historyData=null;
 if(!force&&historyCache.has(asset)){historyData=historyCache.get(asset);historyBusy=false;renderDca(true);return;}
 historyBusy=true;renderDca();
 try{let data;data=await fetchHistory(selected);
 if(id!==historyGeneration||selected!==asset)return;
 if(data.asset!==asset||!Array.isArray(data.candles))throw Error('Invalid historical data');
 historyData=data;historyCache.set(asset,data);log('history',{count:data.candles.length});
 }catch{if(id===historyGeneration)historyData=null;}
 if(id===historyGeneration){historyBusy=false;renderDca(true);}
}
function selectAsset(next){
 if(!ASSETS.includes(next)||next===asset)return;
 if(armed){armed=null;log('cancel');}
 asset=next;generation++;historyGeneration++;snapshot=null;historyData=null;historyBusy=false;busy=false;gridResult=null;fill=null;
 $$('.asset').forEach(b=>{b.classList.toggle('selected',b.dataset.asset===asset);b.setAttribute('aria-pressed',String(b.dataset.asset===asset));});
 $('#pair').textContent=asset+' / USDT';if(mode==='sniping')$('#target').value='';renderAll();if(mode==='dca')loadHistory();if($('#auto').checked)scan();
}
async function scan(){
 if(busy)return;const id=++generation,selected=asset;busy=true;renderStatus();let data;
 try{data=await fetchQuotes(selected);
 if(data.asset!==selected||!Array.isArray(data.quotes))throw Error('Invalid quotes');
 }catch{data={asset:selected,quoteCurrency:'USDT',fetchedAt:Date.now(),quotes:EXCHANGES.map(e=>({id:e.id,name:e.name,status:'error'}))};}
 if(id!==generation)return;snapshot=data;busy=false;nextScan=Date.now()+15000;log('scan',{sources:fresh().length,quotes:structuredClone(data.quotes)});
 if(mode==='sniping'){
  const q=selectedQuote();if(q&&!$('#target').value)$('#target').value=(q.ask*.995).toFixed(2);
  if(armed){const q=fresh().find(q=>q.id===armed.venue);if(triggerMatches(q,armed)){const result=paperFill(q,armed);if(result){fill={...result,asset};log('fill',{...fill});armed=null;}}}
 }
 renderAll();
}
$('#compare').addEventListener('click',scan);$$('[data-asset]').forEach(b=>b.addEventListener('click',()=>selectAsset(b.dataset.asset)));
$('#auto').addEventListener('change',()=>{nextScan=Date.now()+15000;if($('#auto').checked)scan();});
if(mode==='grid'){
 for(const id of ['capital','range','levels','fee','geometric','scenario'])$('#'+id).addEventListener('input',renderGrid);
 $('#reset-model').addEventListener('click',()=>{for(const[id,value]of Object.entries({capital:1000,range:4,levels:8,fee:.1,scenario:0}))$('#'+id).value=value;$('#geometric').checked=false;renderGrid();});
}else if(mode==='dca'){
 for(const id of ['budget','interval','window','fee'])$('#'+id).addEventListener('input',()=>renderDca(true));$('#replay').addEventListener('input',()=>renderDca());$('#reload-history').addEventListener('click',()=>{if(!historyBusy)loadHistory(true);});
}else{
 function disarm(){if(armed){armed=null;log('cancel');}renderSniping();}
 for(const id of ['venue','direction','target','capital','fee','slippage'])$('#'+id).addEventListener('input',disarm);
 $$('[data-offset]').forEach(b=>b.addEventListener('click',()=>{disarm();const q=selectedQuote();if(q){$('#target').value=(q.ask*(1+Number(b.dataset.offset)/100)).toFixed(2);$('#input-error').textContent='';}else $('#input-error').textContent='Compare fresh prices first.';renderSniping();}));
 $('#arm').addEventListener('click',()=>{
  if(armed){disarm();return;}
  const v=numeric(['capital','target','fee','slippage']),q=selectedQuote();if(!v||!q){$('#input-error').textContent='Use valid inputs and a fresh quote from the selected exchange.';return;}
  armed={target:v.target,direction:$('#direction').value,venue:$('#venue').value,budget:v.capital,fee:v.fee,slippage:v.slippage};log('arm',{exchange:q.name,...armed});$('#auto').checked=true;renderSniping();scan();
 });
}
$('#guide-open').addEventListener('click',()=>$('#guide').showModal());$('#guide-close').addEventListener('click',()=>$('#guide').close());
$$('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
$$('[data-command]').forEach(b=>b.addEventListener('click',()=>{selectAsset(b.dataset.command);$('#command').close();}));
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#command').open?$('#command').close():$('#command').showModal();}if($('#command').open&&['1','2','3'].includes(e.key)){selectAsset(ASSETS[Number(e.key)-1]);$('#command').close();}});
$('#export').addEventListener('click',()=>{const inputs=Object.fromEntries($$('.controls input,.controls select').map(e=>[e.id,e.type==='checkbox'?e.checked:e.value]));const data={project:CONFIG.brand,mode,exportedAt:new Date().toISOString(),asset,inputs,snapshot,events,historicalSource:mode==='dca'?historyData:null,paperEntry:fill};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=CONFIG.brand.toLowerCase()+'-session.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
setInterval(()=>{renderStatus();renderQuotes();const key=fresh().map(q=>q.id).join(',');if(key!==lastFreshKey){lastFreshKey=key;renderStrategy();}if($('#auto').checked&&!document.hidden&&!busy&&Date.now()>=nextScan)scan();},1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){renderAll();if($('#auto').checked&&Date.now()>=nextScan)scan();}});
renderAll();renderJournal();scan();if(mode==='dca')loadHistory();
