#!/usr/bin/env python3
import datetime as dt
import html as html_lib
import json
import os
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

TOKEN = os.environ.get("FINNHUB_API_KEY", "").strip()
ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config.json"
DATA_PATH = ROOT / "data" / "edition.json"
DATA_PATH.parent.mkdir(exist_ok=True)
config = json.loads(CONFIG_PATH.read_text())
markets_cfg = config.get("markets", [])
holdings_cfg = config.get("holdings", [])
companies_cfg = config.get("companies", [])


def dedupe(items):
    seen, out = set(), []
    for item in items:
        symbol = item.get("symbol")
        if symbol and symbol not in seen:
            seen.add(symbol); out.append(item)
    return out

holdings_by_symbol = {x["symbol"]: x for x in holdings_cfg}
companies = dedupe(companies_cfg + holdings_cfg)
company_by_symbol = {x["symbol"]: x for x in companies}
tracked_symbols = list(company_by_symbol)
market_symbols = [x["symbol"] for x in markets_cfg]
quote_symbols = list(dict.fromkeys(market_symbols + tracked_symbols))


def get_text(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "InvestingCenter/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


def get_json(url, timeout=30): return json.loads(get_text(url, timeout))

def api(path, **params):
    params["token"] = TOKEN
    return "https://finnhub.io/api/v1/" + path + "?" + urllib.parse.urlencode(params)


def finnhub(path, **params):
    if not TOKEN: return None
    url = api(path, **params)
    for attempt in range(3):
        try:
            payload = get_json(url)
            time.sleep(1.05)
            return payload
        except Exception as exc:
            if "429" in str(exc) and attempt < 2:
                time.sleep(12 * (attempt + 1)); continue
            print(f"Finnhub {path} failed: {exc}")
            time.sleep(1.05); return None


def local_name(tag): return tag.rsplit("}", 1)[-1]
def parse_float(value):
    try: return float(value)
    except (TypeError, ValueError): return None

def strip_html(value):
    text = re.sub(r"<[^>]+>", " ", value or "")
    return re.sub(r"\s+", " ", html_lib.unescape(text)).strip()

def clean_article(a, label="Markets"):
    return {"label":label,"headline":a.get("headline") or "","summary":a.get("summary") or "","source":a.get("source") or "","url":a.get("url") or "","datetime":a.get("datetime")}


def treasury_snapshot():
    year = dt.date.today().year
    url = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml" + f"?data=daily_treasury_yield_curve&field_tdr_date_value={year}"
    fields = {"1M":"BC_1MONTH","3M":"BC_3MONTH","6M":"BC_6MONTH","1Y":"BC_1YEAR","2Y":"BC_2YEAR","3Y":"BC_3YEAR","5Y":"BC_5YEAR","7Y":"BC_7YEAR","10Y":"BC_10YEAR","20Y":"BC_20YEAR","30Y":"BC_30YEAR"}
    try:
        root = ET.fromstring(get_text(url)); records=[]
        for entry in root.iter():
            if local_name(entry.tag) != "entry": continue
            vals = {local_name(c.tag):(c.text or "").strip() for c in entry.iter()}
            date_value=(vals.get("NEW_DATE") or "")[:10]
            if date_value: records.append({"date":date_value,"yields":{label:parse_float(vals.get(key)) for label,key in fields.items()}})
        records.sort(key=lambda x:x["date"])
        if not records: raise ValueError("No Treasury yield records returned")
        latest=records[-1]; prev=records[-2] if len(records)>1 else {"date":None,"yields":{}}
        changes={}
        for label,value in latest["yields"].items():
            p=prev["yields"].get(label); changes[label]=round((value-p)*100,1) if value is not None and p is not None else None
        two,ten=latest["yields"].get("2Y"),latest["yields"].get("10Y")
        return {"date":latest["date"],"previousDate":prev.get("date"),"yields":latest["yields"],"changesBps":changes,"twoTenSpreadBps":round((ten-two)*100,1) if two is not None and ten is not None else None,"source":"U.S. Department of the Treasury","sourceUrl":"https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve"}
    except Exception as exc:
        return {"error":str(exc),"source":"U.S. Department of the Treasury","sourceUrl":url}


def rss_items(xml_text):
    root=ET.fromstring(xml_text); out=[]
    for node in root.iter():
        if local_name(node.tag)!="item": continue
        vals={local_name(c.tag):(c.text or "").strip() for c in list(node)}
        if vals.get("title"):
            out.append({"headline":strip_html(vals.get("title")),"summary":strip_html(vals.get("description")),"url":vals.get("link") or "","date":vals.get("pubDate") or "","source":"Federal Reserve","label":"Fed"})
    return out


def mixed_fraction_to_float(value):
    normalized=(value or "").strip()
    for dash in ("‑","–","—","−"): normalized=normalized.replace(dash,"-")
    if "-" in normalized and "/" in normalized:
        whole,frac=normalized.split("-",1); n,d=frac.split("/",1); return float(whole)+float(n)/float(d)
    return float(normalized)


def extract_target_range(page_text):
    plain=strip_html(page_text)
    for dash in ("‑","–","—","−"): plain=plain.replace(dash,"-")
    m=re.search(r"target range for the federal funds rate at\s+([0-9]+(?:-[0-9]+/[0-9]+)?(?:\.[0-9]+)?)\s+to\s+([0-9]+(?:-[0-9]+/[0-9]+)?(?:\.[0-9]+)?)\s+percent",plain,re.I)
    return (mixed_fraction_to_float(m.group(1)),mixed_fraction_to_float(m.group(2))) if m else (None,None)


def fed_snapshot():
    feed_url="https://www.federalreserve.gov/feeds/press_monetary.xml"
    try:
        items=rss_items(get_text(feed_url)); decision=next((x for x in items if "fomc statement" in x["headline"].lower()),None); low=high=None
        if decision and decision.get("url"):
            try: low,high=extract_target_range(get_text(decision["url"]))
            except Exception as exc: print(f"Fed target parse failed: {exc}")
        return {"targetLow":low,"targetHigh":high,"lastDecision":decision,"headlines":items[:8],"source":"Board of Governors of the Federal Reserve System","sourceUrl":feed_url}
    except Exception as exc:
        return {"targetLow":None,"targetHigh":None,"lastDecision":None,"headlines":[],"error":str(exc),"sourceUrl":feed_url}


def eia_events(today,horizon):
    out=[]; d=today
    while d<=horizon:
        if d.weekday()==2:
            actual=d
            if d==dt.date(2026,10,14): actual=dt.date(2026,10,15)
            elif d==dt.date(2026,11,11): actual=dt.date(2026,11,12)
            out.append({"date":actual.isoformat(),"time":"10:30 ET","type":"EIA","category":"Energy","impact":"Medium","title":"EIA Weekly Petroleum Status Report","why":"U.S. crude, gasoline and distillate inventories can move oil prices and energy stocks.","source":"EIA","url":"https://www.eia.gov/petroleum/supply/weekly/schedule.php"})
        d+=dt.timedelta(days=1)
    return list({(x["date"],x["title"]):x for x in out}.values())


today=dt.date.today(); past_start=today-dt.timedelta(days=35); horizon=today+dt.timedelta(days=45)
treasury=treasury_snapshot(); fed=fed_snapshot()
quotes={}; market_rows=[]; market_news=[]; company_news={}; profiles={}; metrics={}; earnings_rows=[]; dividend_rows=[]

if TOKEN:
    for symbol in quote_symbols:
        q=finnhub("quote",symbol=symbol) or {}
        quotes[symbol]={"symbol":symbol,"price":q.get("c"),"change":q.get("d"),"changePct":q.get("dp"),"open":q.get("o"),"high":q.get("h"),"low":q.get("l"),"previousClose":q.get("pc"),"timestamp":q.get("t")}
    for item in markets_cfg:
        row=dict(quotes.get(item["symbol"],{})); row["name"]=item.get("name",item["symbol"]); market_rows.append(row)
    general=finnhub("news",category="general") or []
    if isinstance(general,list): market_news=[clean_article(x,"Markets") for x in general[:14] if x.get("headline")]
    calendar=finnhub("calendar/earnings",**{"from":past_start.isoformat(),"to":horizon.isoformat()}) or {}
    raw=calendar.get("earningsCalendar",[]) if isinstance(calendar,dict) else []
    earnings_rows=[x for x in raw if x.get("symbol") in company_by_symbol]
    for symbol in holdings_by_symbol:
        payload=finnhub("stock/dividend",symbol=symbol,**{"from":today.isoformat(),"to":horizon.isoformat()})
        rows=payload.get("data",[]) if isinstance(payload,dict) else payload if isinstance(payload,list) else []
        for row in rows or []:
            dividend_rows.append({"date":row.get("exDate") or row.get("date"),"payDate":row.get("payDate"),"declarationDate":row.get("declarationDate"),"amount":row.get("amount"),"currency":row.get("currency"),"symbol":symbol})
    news_symbols=list(dict.fromkeys(list(holdings_by_symbol)+[x["symbol"] for x in companies_cfg if x.get("news")]))
    from_day=today-dt.timedelta(days=4)
    for symbol in news_symbols:
        arr=finnhub("company-news",symbol=symbol,**{"from":from_day.isoformat(),"to":today.isoformat()}) or []
        company_news[symbol]=[clean_article(x,symbol) for x in arr[:5] if x.get("headline")] if isinstance(arr,list) else []
    for symbol in tracked_symbols:
        profile=finnhub("stock/profile2",symbol=symbol) or {}; metric_payload=finnhub("stock/metric",symbol=symbol,metric="all") or {}
        profiles[symbol]=profile if isinstance(profile,dict) else {}; metrics[symbol]=metric_payload.get("metric",{}) if isinstance(metric_payload,dict) else {}
else:
    print("FINNHUB_API_KEY is not configured; publishing official-rate data and configured research context only.")

catalysts=[]
for item in config.get("macroCatalysts",[]):
    try: event_date=dt.date.fromisoformat(item["date"])
    except Exception: continue
    if today<=event_date<=horizon: catalysts.append(dict(item))
catalysts.extend(eia_events(today,horizon))
for row in earnings_rows:
    if not row.get("date"): continue
    symbol=row.get("symbol"); cfg=company_by_symbol.get(symbol,{})
    catalysts.append({"date":row["date"],"time":{"bmo":"Before open","amc":"After close","dmh":"During market"}.get(row.get("hour"),"Time TBD"),"type":"Earnings","category":"Company","impact":"High" if symbol in holdings_by_symbol else "Medium","title":f"{cfg.get('name',symbol)} earnings","symbol":symbol,"why":"Earnings can reset expectations for growth, margins, guidance and valuation.","epsEstimate":row.get("epsEstimate"),"revenueEstimate":row.get("revenueEstimate"),"owned":symbol in holdings_by_symbol})
for row in dividend_rows:
    if not row.get("date"): continue
    symbol=row["symbol"]
    catalysts.append({"date":row["date"],"time":"Market date","type":"Dividend","category":"Portfolio","impact":"Low","title":f"{company_by_symbol.get(symbol,{}).get('name',symbol)} ex-dividend date","symbol":symbol,"why":"The ex-dividend date is the cutoff tied to the declared cash distribution.","amount":row.get("amount"),"currency":row.get("currency"),"payDate":row.get("payDate"),"owned":True})
catalysts.sort(key=lambda x:(x.get("date","9999-12-31"),x.get("time","")))

recent_earnings={}; upcoming_earnings={}
for row in earnings_rows:
    symbol=row.get("symbol")
    try: d=dt.date.fromisoformat(row.get("date"))
    except Exception: continue
    if d<today:
        if symbol not in recent_earnings or row["date"]>recent_earnings[symbol].get("date",""): recent_earnings[symbol]=row
    elif symbol not in upcoming_earnings or row["date"]<upcoming_earnings[symbol].get("date","9999-12-31"): upcoming_earnings[symbol]=row

company_intelligence={}
for symbol,cfg in company_by_symbol.items():
    same_group=[x["symbol"] for x in companies_cfg if x.get("group")==cfg.get("group") and x.get("symbol")!=symbol][:5]
    h=holdings_by_symbol.get(symbol)
    company_intelligence[symbol]={"symbol":symbol,"name":cfg.get("name",symbol),"sector":cfg.get("sector") or ((h.get("themes") or ["Portfolio"])[0].title() if h else "Watchlist"),"group":cfg.get("group") or "Portfolio","role":cfg.get("role") or (h.get("thesis") if h else "Tracked company."),"watch":cfg.get("watch") or "Watch business execution, earnings revisions, valuation and major company-specific developments.","owned":bool(h),"thesis":h.get("thesis") if h else None,"quote":quotes.get(symbol,{}),"profile":profiles.get(symbol,{}),"metrics":metrics.get(symbol,{}),"peers":same_group,"latestNews":company_news.get(symbol,[]),"recentEarnings":recent_earnings.get(symbol),"upcomingEarnings":upcoming_earnings.get(symbol)}

rate_keywords=("federal reserve","fomc","treasury","yield","interest rate","inflation","cpi","pce","jobs","payroll")
rates_market_news=[]
for item in market_news:
    text=f"{item.get('headline','')} {item.get('summary','')}".lower()
    if any(k in text for k in rate_keywords): rates_market_news.append(item)

edition={"generatedAt":dt.datetime.now(dt.timezone.utc).isoformat(),"config":config,"markets":market_rows,"quotes":quotes,"marketNews":market_news,"companyNews":company_news,"companyIntelligence":company_intelligence,"catalysts":catalysts,"earnings":earnings_rows,"dividends":dividend_rows,"rates":{"treasury":treasury,"fed":fed,"marketHeadlines":rates_market_news[:8]}}
DATA_PATH.write_text(json.dumps(edition,indent=2))
print(f"Investing Center edition written: {len(quotes)} quotes, {len(company_intelligence)} companies, {len(catalysts)} upcoming catalysts, {len(market_news)} market headlines.")
