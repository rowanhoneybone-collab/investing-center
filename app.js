let edition = {config:{markets:[],holdings:[],companies:[]},markets:[],quotes:{},marketNews:[],companyIntelligence:{},catalysts:[],dividends:[],rates:{}};
let catalystFilter = "all";

const $ = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"})[ch]);
const num = v => Number.isFinite(Number(v)) ? Number(v) : null;
const fmtPct = v => num(v)==null ? "—" : `${num(v)>=0?"+":""}${num(v).toFixed(2)}%`;
const fmtPrice = v => num(v)==null ? "—" : num(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtYield = v => num(v)==null ? "—" : `${num(v).toFixed(2)}%`;
const fmtCompact = v => num(v)==null ? "—" : Intl.NumberFormat(undefined,{notation:"compact",maximumFractionDigits:1}).format(num(v));
const fmtDate = value => { if(!value) return "—"; const d=new Date(`${String(value).slice(0,10)}T12:00:00`); return Number.isNaN(d.getTime())?"—":d.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}); };
const dayLabel = value => { const d=new Date(`${String(value).slice(0,10)}T12:00:00`); return d.toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"}); };
const daysUntil = value => { const d=new Date(`${String(value).slice(0,10)}T12:00:00`); const now=new Date(); now.setHours(12,0,0,0); return Number.isNaN(d.getTime())?null:Math.ceil((d-now)/86400000); };
const quote = symbol => edition.quotes?.[symbol] || {};
const holdings = () => edition.config?.holdings || [];
const companies = () => edition.config?.companies || [];
const ownedSymbols = () => new Set(holdings().map(x=>x.symbol));
const company = symbol => edition.companyIntelligence?.[symbol] || null;

function setStatus(kind,title,text){ const box=$("dataStatus"); box.className=`data-status ${kind}`; box.querySelector("b").textContent=title; box.querySelector("span").textContent=text; }
function metric(ci,...keys){ for(const k of keys){ const v=ci?.metrics?.[k]; if(v!=null && Number.isFinite(Number(v))) return Number(v); } return null; }
function capLabel(ci){ const m=num(ci?.profile?.marketCapitalization); if(m==null) return "—"; return `$${fmtCompact(m*1000000)}`; }
function basisPointText(v){ if(num(v)==null) return "—"; const n=num(v); return `${n>0?"+":""}${n.toFixed(1)} bps`; }
function eventDaysText(date){ const d=daysUntil(date); if(d==null) return ""; if(d===0) return "Today"; if(d===1) return "Tomorrow"; return d>1?`In ${d} days`:`${Math.abs(d)} days ago`; }

async function load(){
  setStatus("loading","Loading Investing Center…","Reading the newest edition from GitHub Pages.");
  try{
    const r=await fetch(`./data/edition.json?ts=${Date.now()}`,{cache:"no-store"});
    if(!r.ok) throw new Error(`edition.json ${r.status}`);
    edition=await r.json();
    renderAll();
    const stamp=edition.generatedAt?new Date(edition.generatedAt):null;
    setStatus("good","Latest edition loaded.",stamp?`Published ${stamp.toLocaleString()}`:"Published by GitHub Actions.");
    $("publishedAt").textContent=stamp?`Published ${stamp.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}`:"Published recently";
  }catch(err){
    console.error(err); renderAll();
    setStatus("error","Investing Center is ready, but live market data is not published yet.","Add the FINNHUB_API_KEY repository secret and run the Refresh Investing Center workflow once.");
  }
}

function renderAll(){
  $("todayDate").textContent=new Date().toLocaleDateString(undefined,{weekday:"long",year:"numeric",month:"long",day:"numeric"});
  renderTicker(); renderMood(); renderToday(); renderPortfolio(); renderCompanies(); renderCatalysts(); renderMarkets(); renderSectors(); renderRates(); renderDividends();
}

function renderTicker(){
  const items=[...(edition.config?.markets||[]),...holdings()];
  $("ticker").innerHTML=items.map(item=>{const q=quote(item.symbol); const cls=num(q.changePct)>=0?"pos":"neg"; return `<div class="tick"><span>${esc(item.symbol)}</span><b class="${cls}">${fmtPrice(q.price)} ${fmtPct(q.changePct)}</b></div>`}).join("") || `<div class="tick"><span>Waiting for live data</span></div>`;
}
function renderMood(){
  const vals=(edition.markets||[]).map(x=>num(x.changePct)).filter(x=>x!=null); const avg=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
  $("marketMood").textContent=avg==null?"⚪ Waiting for data":avg>.6?"🟢 Risk-On":avg>.05?"🟡 Positive":avg<-.6?"🔴 Risk-Off":avg<-.05?"🟠 Cautious":"🟡 Mixed";
}

function renderToday(){
  const news=edition.marketNews||[]; const lead=news[0];
  $("leadHeadline").textContent=lead?.headline || "The next Investing Center edition is ready to be brewed.";
  $("leadSummary").textContent=lead?.summary || "Once the market-data secret is connected, this page will update with live quotes, headlines, company research and catalysts.";
  $("leadWhy").textContent="Ask four questions: Did rates change? Did earnings expectations change? Did commodity prices change? Did the long-term thesis for one of your companies change?";

  const marketVals=(edition.markets||[]).map(x=>num(x.changePct)).filter(x=>x!=null); const avg=marketVals.length?marketVals.reduce((a,b)=>a+b,0)/marketVals.length:null;
  const ten=edition.rates?.treasury?.yields?.["10Y"]; const tenCh=edition.rates?.treasury?.changesBps?.["10Y"];
  const future=(edition.catalysts||[]).filter(x=>(daysUntil(x.date)??-99)>=0); const nextHigh=future.find(x=>x.impact==="High")||future[0];
  const mover=holdings().map(h=>({h,q:quote(h.symbol)})).filter(x=>num(x.q.changePct)!=null).sort((a,b)=>Math.abs(num(b.q.changePct))-Math.abs(num(a.q.changePct)))[0];
  const nextPortEarn=future.find(x=>x.type==="Earnings"&&x.owned);
  const things=[
    [avg==null?"Markets are waiting for data.":avg>=0?"Broad stocks are leaning higher.":"Broad stocks are under pressure.",avg==null?"Live index quotes publish after the first successful refresh.":`Average move across tracked broad-market proxies: ${fmtPct(avg)}.`],
    [`10-year Treasury: ${fmtYield(ten)}.`,num(tenCh)==null?"Official Treasury curve data refreshes with each edition.":`Daily move: ${basisPointText(tenCh)}.`],
    [nextHigh?`${nextHigh.title} is the next high-impact catalyst.`:"No high-impact catalyst is loaded yet.",nextHigh?`${dayLabel(nextHigh.date)} • ${eventDaysText(nextHigh.date)}`:"Catalyst data will populate after refresh."],
    [mover?`${mover.h.symbol} is your biggest portfolio move.`:"Portfolio quotes are waiting.",mover?`${fmtPct(mover.q.changePct)} in the latest edition.`:"Your seven configured holdings are already loaded."],
    [nextPortEarn?`${nextPortEarn.symbol} earnings are on deck.`:"No portfolio earnings are currently inside the 45-day window.",nextPortEarn?`${dayLabel(nextPortEarn.date)} • ${nextPortEarn.time}`:"The calendar updates automatically from the earnings feed."]
  ];
  $("fiveThings").innerHTML=things.map(x=>`<div class="thing"><div><b>${esc(x[0])}</b><small>${esc(x[1])}</small></div></div>`).join("");

  const spy=quote("SPY"), qqq=quote("QQQ");
  $("todaySnapshot").innerHTML=`
    ${snap("S&P 500",fmtPct(spy.changePct),fmtPrice(spy.price))}
    ${snap("Nasdaq 100",fmtPct(qqq.changePct),fmtPrice(qqq.price))}
    ${snap("10Y TREASURY",fmtYield(ten),num(tenCh)==null?"Official daily yield":`${basisPointText(tenCh)} today`)}
    ${snap("NEXT CATALYST",nextHigh?dayLabel(nextHigh.date):"—",nextHigh?.type||"Waiting")}`;
  $("todayCatalysts").innerHTML=future.slice(0,5).map(miniCatalyst).join("")||`<div class="empty">No future catalysts loaded yet.</div>`;
  const movers=holdings().map(h=>({h,q:quote(h.symbol)})).sort((a,b)=>Math.abs(num(b.q.changePct)||0)-Math.abs(num(a.q.changePct)||0)).slice(0,5);
  $("todayPortfolio").innerHTML=movers.map(x=>`<div class="mini-row"><div><b>${esc(x.h.symbol)} • ${esc(x.h.name)}</b><small>${esc(x.h.thesis)}</small></div><div class="mini-right ${num(x.q.changePct)>=0?"pos":"neg"}"><b>${fmtPct(x.q.changePct)}</b><small>${fmtPrice(x.q.price)}</small></div></div>`).join("");
}
function snap(label,value,caption){return `<article class="snapshot-card"><label>${label}</label><strong>${value}</strong><span>${esc(caption)}</span></article>`}
function miniCatalyst(x){return `<div class="mini-row"><div><b>${esc(x.title)}</b><small>${esc(x.type)} • ${esc(x.time||"")}</small></div><div class="mini-right"><b>${dayLabel(x.date)}</b><small>${eventDaysText(x.date)}</small></div></div>`}

function renderPortfolio(){
  $("portfolioCards").innerHTML=holdings().map(h=>{const q=quote(h.symbol);return `<article class="card"><label>${esc(h.symbol)}</label><h3>${esc(h.name)}</h3><div class="big-number">${fmtPrice(q.price)}</div><b class="${num(q.changePct)>=0?"pos":"neg"}">${fmtPct(q.changePct)}</b><p>${esc(h.thesis)}</p><button data-company="${esc(h.symbol)}">Open intelligence →</button></article>`}).join("");
}

function renderCompanies(filter=""){
  const owned=ownedSymbols(); const term=filter.trim().toLowerCase();
  const list=Object.values(edition.companyIntelligence||{}).length?Object.values(edition.companyIntelligence):companies().map(c=>({...c,owned:owned.has(c.symbol),quote:quote(c.symbol),profile:{},metrics:{},latestNews:[]}));
  const filtered=list.filter(c=>!term||`${c.symbol} ${c.name} ${c.sector} ${c.group}`.toLowerCase().includes(term)).sort((a,b)=>(b.owned-a.owned)||a.sector.localeCompare(b.sector)||a.name.localeCompare(b.name));
  $("companyCount").textContent=`${filtered.length} of ${list.length} tracked companies`;
  $("companyGrid").innerHTML=filtered.map(ci=>{const q=ci.quote||quote(ci.symbol);return `<article class="company-card" data-company="${esc(ci.symbol)}"><div>${ci.owned?'<span class="owned-badge">IN YOUR PORTFOLIO</span>':`<span class="group-badge">${esc(ci.group||ci.sector)}</span>`}</div><h3>${esc(ci.name)}</h3><label>${esc(ci.symbol)} • ${esc(ci.sector||"")}</label><div class="quote-line"><span class="big-number">${fmtPrice(q.price)}</span><b class="${num(q.changePct)>=0?"pos":"neg"}">${fmtPct(q.changePct)}</b></div><p>${esc(ci.role||"Tracked company intelligence.")}</p><button data-company="${esc(ci.symbol)}">Open research →</button></article>`}).join("")||`<div class="empty">No companies match that search.</div>`;
}

function openCompany(symbol){
  const ci=company(symbol) || (()=>{const c=companies().find(x=>x.symbol===symbol),h=holdings().find(x=>x.symbol===symbol);return c?{...c,owned:!!h,thesis:h?.thesis,quote:quote(symbol),profile:{},metrics:{},latestNews:[],peers:[]}:null})();
  if(!ci) return;
  activateTab("companies");
  const q=ci.quote||quote(symbol), p=ci.profile||{};
  const pe=metric(ci,"peTTM","peBasicExclExtraTTM","peAnnual");
  const fpe=metric(ci,"forwardPE","forwardPEAnnual");
  const margin=metric(ci,"netProfitMarginTTM","netMarginTTM");
  const roa=metric(ci,"roaTTM","returnOnAssetsTTM");
  const revGrowth=metric(ci,"revenueGrowthTTMYoy","revenueGrowth3Y");
  const divYield=metric(ci,"currentDividendYieldTTM","dividendYieldIndicatedAnnual");
  const beta=metric(ci,"beta"); const high=metric(ci,"52WeekHigh"); const low=metric(ci,"52WeekLow");
  const recent=ci.recentEarnings, upcoming=ci.upcomingEarnings;
  $("companyDetail").classList.remove("hidden");
  $("companyDetail").innerHTML=`
    <div class="company-detail-top"><div class="company-title">${p.logo?`<img class="company-logo" src="${esc(p.logo)}" alt=""/>`:""}<div><label>${esc(symbol)} • ${esc(ci.sector||p.finnhubIndustry||"")}</label><h3>${esc(ci.name||p.name||symbol)}</h3><span class="muted">${esc(ci.group||p.exchange||"")}${ci.owned?' • In your portfolio':''}</span></div></div><button class="close-detail" id="closeCompany">Close ×</button></div>
    <div class="metric-grid">
      ${metricBox("PRICE",fmtPrice(q.price),fmtPct(q.changePct))}
      ${metricBox("MARKET CAP",capLabel(ci),p.currency||"")}
      ${metricBox("P/E",pe==null?"—":pe.toFixed(1),fpe==null?"Trailing valuation":`Forward ${fpe.toFixed(1)}`)}
      ${metricBox("NET MARGIN",margin==null?"—":`${margin.toFixed(1)}%`,"TTM")}
      ${metricBox("REVENUE GROWTH",revGrowth==null?"—":`${revGrowth.toFixed(1)}%`,"Year over year")}
      ${metricBox("ROA",roa==null?"—":`${roa.toFixed(1)}%`,"Asset efficiency")}
      ${metricBox("DIVIDEND YIELD",divYield==null?"—":`${divYield.toFixed(2)}%`,"Current / indicated")}
      ${metricBox("BETA",beta==null?"—":beta.toFixed(2),"Market sensitivity")}
      ${metricBox("52-WEEK HIGH",high==null?"—":fmtPrice(high),low==null?"":"Low "+fmtPrice(low))}
      ${metricBox("NEXT EARNINGS",upcoming?.date?fmtDate(upcoming.date):"—",upcoming?.hour?String(upcoming.hour).toUpperCase():"No date in current window")}
    </div>
    <div class="research-grid">
      <div class="research-box"><label>WHAT IT DOES</label><p>${esc(ci.role||"Research context is being built for this company.")}</p></div>
      <div class="research-box"><label>WHAT TO WATCH</label><p>${esc(ci.watch||"Watch earnings revisions, valuation, balance-sheet quality and company-specific catalysts.")}</p></div>
      ${ci.thesis?`<div class="research-box"><label>YOUR THESIS</label><p>${esc(ci.thesis)}</p></div>`:""}
      <div class="research-box"><label>EARNINGS CHECK</label><p>${earningsText(recent,upcoming)}</p></div>
      <div class="research-box"><label>PEER SET</label><div class="peer-row">${(ci.peers||[]).map(s=>`<button data-company="${esc(s)}">${esc(s)}</button>`).join("")||'<span class="muted">No configured same-group peers.</span>'}</div></div>
      <div class="research-box"><label>COMPANY LINKS</label><p>${p.weburl?`<a href="${esc(p.weburl)}" target="_blank" rel="noopener">Company website ↗</a>`:"Website not loaded yet."}</p></div>
    </div>
    <div class="panel news-panel"><div class="panel-head"><div><label>LATEST HEADLINES</label><h3>${esc(symbol)} news.</h3></div></div>${(ci.latestNews||[]).map(headlineHtml).join("")||'<div class="empty">No company-specific headlines loaded in this edition.</div>'}</div>`;
  $("closeCompany").onclick=()=>$("companyDetail").classList.add("hidden");
  $("companyDetail").scrollIntoView({behavior:"smooth",block:"start"});
  history.replaceState(null,"",`#company=${encodeURIComponent(symbol)}`);
}
function metricBox(label,value,caption){return `<div class="metric"><label>${label}</label><strong>${esc(value)}</strong><small>${esc(caption||"")}</small></div>`}
function earningsText(recent,upcoming){
  const parts=[];
  if(recent?.date){ const epsA=num(recent.epsActual),epsE=num(recent.epsEstimate); parts.push(`Most recent tracked report: ${fmtDate(recent.date)}${epsA!=null?`, EPS ${epsA.toFixed(2)}`:""}${epsE!=null?` vs. ${epsE.toFixed(2)} estimate`:""}.`); }
  if(upcoming?.date) parts.push(`Next scheduled report: ${fmtDate(upcoming.date)}${upcoming.hour?` (${String(upcoming.hour).toUpperCase()})`:""}.`);
  return esc(parts.join(" ")||"No earnings event is currently inside the tracked window.");
}

function filteredCatalysts(){
  const rows=(edition.catalysts||[]).filter(x=>(daysUntil(x.date)??-999)>=0);
  if(catalystFilter==="portfolio") return rows.filter(x=>x.owned||x.category==="Portfolio");
  if(catalystFilter==="earnings") return rows.filter(x=>x.type==="Earnings");
  if(catalystFilter==="macro") return rows.filter(x=>["Macro","Fed"].includes(x.category));
  if(catalystFilter==="energy") return rows.filter(x=>x.category==="Energy");
  return rows;
}
function renderCatalysts(){
  const all=(edition.catalysts||[]).filter(x=>(daysUntil(x.date)??-999)>=0); const high=all.filter(x=>x.impact==="High"); const port=all.filter(x=>x.owned||x.category==="Portfolio"); const next=all[0];
  $("catalystSummary").innerHTML=`${summary("NEXT EVENT",next?dayLabel(next.date):"—",next?.type||"Waiting")}${summary("NEXT 7 DAYS",all.filter(x=>(daysUntil(x.date)??99)<=7).length,"Tracked events")}${summary("HIGH IMPACT",high.length,"Inside 45 days")}${summary("PORTFOLIO EVENTS",port.length,"Earnings + dividends")}`;
  const rows=filteredCatalysts(); const groups={}; rows.forEach(x=>(groups[x.date]??=[]).push(x));
  $("catalystCalendar").innerHTML=Object.entries(groups).map(([date,events])=>`<div class="calendar-day"><div class="calendar-date"><b>${dayLabel(date)}</b><small>${eventDaysText(date)}</small></div><div class="event-list">${events.map(eventHtml).join("")}</div></div>`).join("")||`<div class="empty">No events match this filter in the current 45-day window.</div>`;
}
function summary(label,value,caption){return `<article class="summary-card"><label>${label}</label><strong>${esc(value)}</strong><span>${esc(caption)}</span></article>`}
function eventHtml(e){return `<article class="event"><div><div><span class="impact-badge impact-${String(e.impact||"").toLowerCase()}">${esc(e.impact||"Info")}</span> <span class="group-badge">${esc(e.type||e.category)}</span>${e.owned?' <span class="owned-badge">PORTFOLIO</span>':''}</div><h4>${esc(e.title)}</h4><p>${esc(e.why||"")}</p>${e.url?`<p><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.source||"Source")} ↗</a></p>`:""}</div><div class="event-meta"><b>${esc(e.time||"")}</b><br>${e.symbol?esc(e.symbol):esc(e.category||"")}</div></article>`}

function renderMarkets(){
  const rows=edition.markets||[]; $("marketCards").innerHTML=rows.map(x=>`<article class="market-card"><label>${esc(x.symbol)}</label><h3>${esc(x.name)}</h3><strong>${fmtPrice(x.price)}</strong><b class="${num(x.changePct)>=0?"pos":"neg"}">${fmtPct(x.changePct)}</b><p class="muted">Open ${fmtPrice(x.open)} • High ${fmtPrice(x.high)} • Low ${fmtPrice(x.low)}</p></article>`).join("")||`<div class="empty">Market quotes publish after the first API refresh.</div>`;
  $("marketHeadlines").innerHTML=(edition.marketNews||[]).slice(0,12).map(headlineHtml).join("")||`<div class="empty">No market headlines loaded yet.</div>`;
}
function headlineHtml(h){return `<div class="headline"><a href="${esc(h.url||"#")}" target="_blank" rel="noopener">${esc(h.headline)}</a><small>${esc(h.source||h.label||"News")}</small></div>`}

function renderSectors(){
  const sectors={}; Object.values(edition.companyIntelligence||{}).forEach(ci=>(sectors[ci.sector||"Other"]??=[]).push(ci));
  if(!Object.keys(sectors).length) companies().forEach(c=>(sectors[c.sector||"Other"]??=[]).push({...c,quote:quote(c.symbol)}));
  $("sectorGroups").innerHTML=Object.entries(sectors).sort().map(([sector,list])=>`<section class="sector-block"><div class="sector-title"><h3>${esc(sector)}</h3><span class="muted">${list.length} companies</span></div><div class="sector-company-grid">${list.map(ci=>{const q=ci.quote||quote(ci.symbol);return `<article class="sector-company"><label>${esc(ci.group||"")}</label><button data-company="${esc(ci.symbol)}">${esc(ci.name)} (${esc(ci.symbol)})</button><div class="${num(q.changePct)>=0?"pos":"neg"}">${fmtPct(q.changePct)}</div><p>${esc(ci.watch||ci.role||"")}</p></article>`}).join("")}</div></section>`).join("");
}

function renderRates(){
  const t=edition.rates?.treasury||{}, f=edition.rates?.fed||{}; const y=t.yields||{}, ch=t.changesBps||{};
  const range=num(f.targetLow)!=null&&num(f.targetHigh)!=null?`${num(f.targetLow).toFixed(2)}–${num(f.targetHigh).toFixed(2)}%`:"—";
  $("rateSummary").innerHTML=`${rateCard("FED TARGET",range,"Official policy range")}${rateCard("2-YEAR",fmtYield(y["2Y"]),basisPointText(ch["2Y"]))}${rateCard("10-YEAR",fmtYield(y["10Y"]),basisPointText(ch["10Y"]))}${rateCard("30-YEAR",fmtYield(y["30Y"]),basisPointText(ch["30Y"]))}`;
  const curve=["3M","6M","1Y","2Y","3Y","5Y","10Y","30Y"]; $("yieldCurve").innerHTML=curve.map(k=>`<div class="curve-point"><label>${k}</label><b>${fmtYield(y[k])}</b><small>${basisPointText(ch[k])}</small></div>`).join("");
  const spread=num(t.twoTenSpreadBps); const curveRead=spread==null?"Curve data is waiting for the Treasury feed.":spread<0?`The 2Y–10Y curve is inverted by ${Math.abs(spread).toFixed(1)} bps. Markets are pricing shorter-term rates above longer-term rates.`:spread<25?`The 2Y–10Y curve is fairly flat at +${spread.toFixed(1)} bps.`:`The 2Y–10Y curve is positively sloped at +${spread.toFixed(1)} bps.`;
  const tenRead=num(ch["10Y"])==null?"Waiting for the daily change.":num(ch["10Y"])>4?"Long-term yields jumped. That can tighten financial conditions and pressure expensive growth stocks.":num(ch["10Y"])<-4?"Long-term yields fell meaningfully. That can ease valuation pressure on growth assets.":"The 10-year move is relatively contained today.";
  $("rateRead").innerHTML=`<div class="rate-read-item"><b>Curve shape</b><p>${esc(curveRead)}</p></div><div class="rate-read-item"><b>Today's long-rate move</b><p>${esc(tenRead)}</p></div><div class="rate-read-item"><b>Simple rule</b><p>Higher yields raise the return investors can earn safely, so stocks have to offer a stronger growth or cash-flow case to compete.</p></div>`;
  const rateNews=[...(f.headlines||[]),...(edition.rates?.marketHeadlines||[])]; $("ratesHeadlines").innerHTML=rateNews.slice(0,12).map(headlineHtml).join("")||`<div class="empty">Official Fed and rates headlines will appear after refresh.</div>`;
}
function rateCard(label,value,caption){return `<article class="rate-card"><label>${label}</label><strong>${value}</strong><span>${esc(caption)}</span></article>`}

function renderDividends(){
  const rows=(edition.dividends||[]).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  $("dividendCards").innerHTML=rows.length?rows.map(x=>`<article class="card"><label>${esc(x.symbol)}</label><h3>${fmtDate(x.date)}</h3><div class="big-number">${num(x.amount)==null?"Amount TBD":`${num(x.amount).toFixed(4)} ${esc(x.currency||"")}`}</div><p>Ex-dividend date${x.payDate?` • Payment ${fmtDate(x.payDate)}`:""}</p></article>`).join(""):`<div class="empty">No upcoming dividend events were returned inside the current 45-day window.</div>`;
}

function activateTab(id){
  document.querySelectorAll("nav button").forEach(b=>b.classList.toggle("active",b.dataset.tab===id));
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.id===id));
  window.scrollTo({top:0,behavior:"smooth"});
}

document.querySelectorAll("nav button").forEach(b=>b.onclick=()=>{activateTab(b.dataset.tab); history.replaceState(null,"",`#${b.dataset.tab}`)});
document.addEventListener("click",e=>{ const el=e.target.closest("[data-company]"); if(el){e.preventDefault(); openCompany(el.dataset.company);} const jump=e.target.closest("[data-jump]"); if(jump){e.preventDefault(); activateTab(jump.dataset.jump);} });
$("companySearch").addEventListener("input",e=>renderCompanies(e.target.value));
$("catalystFilters").addEventListener("click",e=>{const b=e.target.closest("button[data-filter]"); if(!b)return; catalystFilter=b.dataset.filter; document.querySelectorAll("#catalystFilters button").forEach(x=>x.classList.toggle("active",x===b)); renderCatalysts();});
$("refreshButton").onclick=()=>location.reload();

load().then(()=>{
  const hash=location.hash.replace(/^#/,"");
  if(hash.startsWith("company=")) openCompany(decodeURIComponent(hash.split("=")[1]||""));
  else if(["today","portfolio","companies","catalysts","markets","sectors","rates","dividends"].includes(hash)) activateTab(hash);
});
