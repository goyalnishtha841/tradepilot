const fetch = require('node-fetch');

const YAHOO_BASE = 'https://query1.finance.yahoo.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT }
  });
  if (res.status === 404) {
    throw new Error('SYMBOL_NOT_FOUND');
  }
  if (!res.ok) {
    throw new Error(`Yahoo Finance request failed: ${res.status}`);
  }
  return res.json();
}

// ---------- Component 1: Live Quote ----------

async function getRealQuote(symbolRaw) {
  const symbol = symbolRaw.trim().toUpperCase();
  const url = `${YAHOO_BASE}/v8/finance/chart/${encodeURIComponent(symbol)}`;
  const data = await fetchJson(url);

  const result = data && data.chart && data.chart.result && data.chart.result[0];
  if (!result || !result.meta) {
    throw new Error('SYMBOL_NOT_FOUND');
  }

  const meta = result.meta;
  const price = meta.regularMarketPrice;
  const previousClose = meta.previousClose || meta.chartPreviousClose;

  if (typeof price !== 'number' || typeof previousClose !== 'number') {
    throw new Error('SYMBOL_NOT_FOUND');
  }

  const changeAbs = price - previousClose;
  const changePercent = (changeAbs / previousClose) * 100;

  return {
    symbol: meta.symbol || symbol,
    price: Math.round(price * 100) / 100,
    changeAbs: Math.round(changeAbs * 100) / 100,
    changePercent: Math.round(changePercent * 100) / 100,
    currency: meta.currency || 'USD',
    exchange: meta.fullExchangeName || meta.exchangeName || '—',
    postMarketPrice: typeof meta.postMarketPrice === 'number' ? Math.round(meta.postMarketPrice * 100) / 100 : null,
    postMarketChangePercent: typeof meta.postMarketChangePercent === 'number' ? Math.round(meta.postMarketChangePercent * 100) / 100 : null
  };
}

// ---------- Component 2: Chart + RSI ----------

const RANGE_CONFIG = {
  '1D': { range: '1d', interval: '5m' },
  '1W': { range: '5d', interval: '15m' },
  '1M': { range: '1mo', interval: '1d' },
  '3M': { range: '3mo', interval: '1d' },
  '1Y': { range: '1y', interval: '1wk' }
};

function calculateRSI(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round((100 - 100 / (1 + rs)) * 10) / 10;
}

async function getHistoricalData(symbolRaw, rangeKey) {
  const symbol = symbolRaw.trim().toUpperCase();
  const config = RANGE_CONFIG[rangeKey] || RANGE_CONFIG['1D'];
  const url = `${YAHOO_BASE}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${config.range}&interval=${config.interval}`;
  const data = await fetchJson(url);

  const result = data && data.chart && data.chart.result && data.chart.result[0];
  if (!result || !result.timestamp || !result.indicators || !result.indicators.quote || !result.indicators.quote[0]) {
    throw new Error('SYMBOL_NOT_FOUND');
  }

  const timestamps = result.timestamp;
  const closes = result.indicators.quote[0].close;

  const points = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (typeof closes[i] === 'number') {
      points.push({ time: timestamps[i] * 1000, close: closes[i] });
    }
  }

  if (points.length < 2) {
    throw new Error('SYMBOL_NOT_FOUND');
  }

  const rsi = calculateRSI(points.map(p => p.close), 14);

  return { symbol: result.meta.symbol || symbol, range: rangeKey, points, rsi };
}

// ---------- Component 3: Valuation + Financial Health ----------
// Yahoo's quoteSummary endpoint requires a crumb + cookie pair; the chart endpoint above does not.

let cachedAuth = null;
let cachedAuthExpiry = 0;

async function getCrumbAndCookie() {
  const now = Date.now();
  if (cachedAuth && now < cachedAuthExpiry) return cachedAuth;

  const cookieRes = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': USER_AGENT } });
  const setCookie = cookieRes.headers.get('set-cookie');
  if (!setCookie) throw new Error('CRUMB_UNAVAILABLE');
  const cookie = setCookie.split(';')[0];

  const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': USER_AGENT, 'Cookie': cookie }
  });
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.length > 20) throw new Error('CRUMB_UNAVAILABLE');

  cachedAuth = { cookie, crumb };
  cachedAuthExpiry = now + 1000 * 60 * 20; // reuse for 20 minutes
  return cachedAuth;
}

async function getFundamentals(symbolRaw) {
  const symbol = symbolRaw.trim().toUpperCase();
  const modules = 'summaryDetail,financialData,assetProfile,price';

  let auth = null;
  try {
    auth = await getCrumbAndCookie();
  } catch (e) {
    auth = null; // fall through and try without a crumb
  }

  const crumbParam = auth ? `&crumb=${encodeURIComponent(auth.crumb)}` : '';
  const url = `${YAHOO_BASE}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}${crumbParam}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      ...(auth ? { 'Cookie': auth.cookie } : {})
    }
  });

  if (res.status === 404) throw new Error('SYMBOL_NOT_FOUND');
  if (!res.ok) throw new Error(`Yahoo Finance request failed: ${res.status}`);

  const data = await res.json();
  const result = data && data.quoteSummary && data.quoteSummary.result && data.quoteSummary.result[0];
  if (!result) throw new Error('SYMBOL_NOT_FOUND');

  const summaryDetail = result.summaryDetail || {};
  const financialData = result.financialData || {};
  const assetProfile = result.assetProfile || {};
  const price = result.price || {};
  const raw = (obj, key) => (obj && obj[key] && typeof obj[key].raw === 'number') ? obj[key].raw : null;

  return {
    peRatio: raw(summaryDetail, 'trailingPE'),
    marketCap: raw(price, 'marketCap') ?? raw(summaryDetail, 'marketCap'),
    revenueGrowth: raw(financialData, 'revenueGrowth'),
    grossMargin: raw(financialData, 'grossMargins'),
    sector: assetProfile.sector || null,
    industry: assetProfile.industry || null,
    exchange: price.exchangeName || null
  };
}

// ---------- Component 4: News ----------

async function getNews(symbolRaw, count = 2) {
  const symbol = symbolRaw.trim().toUpperCase();
  const url = `${YAHOO_BASE}/v1/finance/search?q=${encodeURIComponent(symbol)}&newsCount=25&quotesCount=0`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });

  if (res.status === 404) throw new Error('SYMBOL_NOT_FOUND');
  if (!res.ok) throw new Error(`Yahoo Finance request failed: ${res.status}`);

  const data = await res.json();
  const rawNews = Array.isArray(data.news) ? data.news : [];

  // The article's true subject is (almost always) listed FIRST in relatedTickers.
  // This is a much stronger signal than just "does the array include this symbol somewhere" —
  // it filters out broad market/ETF roundups that just mention the symbol in passing.
  const relevant = rawNews.filter((item) =>
    Array.isArray(item.relatedTickers) &&
    item.relatedTickers.length > 0 &&
    item.relatedTickers[0] === symbol
  );

  // Deliberately do NOT pad with broader/looser matches if fewer than `count` qualify —
  // showing fewer genuinely relevant articles beats padding with noise.
  return relevant.slice(0, count).map((item) => {
    let thumbnail = null;
    const resolutions = item.thumbnail && item.thumbnail.resolutions;
    if (Array.isArray(resolutions) && resolutions.length > 0) {
      thumbnail = resolutions[resolutions.length - 1].url;
    }
    return {
      title: item.title || 'Untitled',
      publisher: item.publisher || 'Unknown source',
      link: item.link || null,
      publishedAt: typeof item.providerPublishTime === 'number' ? item.providerPublishTime * 1000 : null,
      thumbnail
    };
  });
}

module.exports = { getRealQuote, getHistoricalData, getFundamentals, getNews };