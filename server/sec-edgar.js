const fetch = require('node-fetch');

// SEC EDGAR is free and needs no API key, but their fair-access policy requires
// a descriptive User-Agent identifying the application and a contact — update
// the email below to your own before deploying, per SEC's request.
const SEC_USER_AGENT = 'TradePilot admin@tradepilot.app';

let tickerCikMap = null;
let tickerCikMapExpiry = 0;

// SEC publishes a single JSON file mapping every ticker to its CIK (company ID).
// It's a few hundred KB and rarely changes, so it's cached in memory for a day.
async function getTickerCikMap() {
  const now = Date.now();
  if (tickerCikMap && now < tickerCikMapExpiry) return tickerCikMap;

  const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
    headers: { 'User-Agent': SEC_USER_AGENT }
  });
  if (!res.ok) throw new Error(`SEC ticker map request failed: ${res.status}`);

  const data = await res.json();
  const map = {};
  Object.values(data).forEach((entry) => {
    if (entry && entry.ticker && entry.cik_str != null) {
      map[String(entry.ticker).toUpperCase()] = String(entry.cik_str).padStart(10, '0');
    }
  });

  tickerCikMap = map;
  tickerCikMapExpiry = now + 1000 * 60 * 60 * 24; // 24h cache
  return map;
}

// Real recent SEC filings (10-K, 10-Q, 8-K, etc.) for a symbol, most recent first.
async function getRecentFilings(symbolRaw, count = 5) {
  const symbol = symbolRaw.trim().toUpperCase();
  const map = await getTickerCikMap();
  const cik = map[symbol];
  if (!cik) throw new Error('CIK_NOT_FOUND');

  const res = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
    headers: { 'User-Agent': SEC_USER_AGENT }
  });
  if (res.status === 404) throw new Error('CIK_NOT_FOUND');
  if (!res.ok) throw new Error(`SEC filings request failed: ${res.status}`);

  const data = await res.json();
  const recent = data.filings && data.filings.recent;
  if (!recent || !Array.isArray(recent.form) || recent.form.length === 0) {
    throw new Error('NO_FILINGS');
  }

  return recent.form.slice(0, count).map((form, i) => ({
    form,
    filingDate: recent.filingDate[i],
    url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${recent.accessionNumber[i].replace(/-/g, '')}/${recent.primaryDocument[i]}`
  }));
}

module.exports = { getRecentFilings };
