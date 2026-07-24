const fetch = require('node-fetch');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const fxCache = {};
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes TTL

// Static fallback rates (used ONLY if live Yahoo and Open FX API network fetches fail)
const FALLBACK_USD_RATES = {
  USD: 1.0,
  INR: 86.50,
  EUR: 0.925,
  GBP: 0.781,
  JPY: 155.00,
  CAD: 1.370,
  AUD: 1.538,
  CNY: 7.25,
  HKD: 7.80,
  SGD: 1.35
};

async function fetchRateFromYahoo(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data && data.chart && data.chart.result && data.chart.result[0];
    if (result && result.meta && typeof result.meta.regularMarketPrice === 'number' && result.meta.regularMarketPrice > 0) {
      return result.meta.regularMarketPrice;
    }
  } catch (err) {
    console.warn(`Yahoo FX fetch warning for ${symbol}:`, err.message);
  }
  return null;
}

async function fetchRatesFromOpenApi(baseCurrency) {
  const url = `https://open.er-api.com/v6/latest/${encodeURIComponent(baseCurrency.toUpperCase())}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.rates && typeof data.rates === 'object') {
      return data.rates;
    }
  } catch (err) {
    console.warn(`Open FX API fetch warning for ${baseCurrency}:`, err.message);
  }
  return null;
}

/**
 * Gets the rate for 1 USD in target currency (USD -> Currency) with metadata.
 * Returns { rate, source, isLive }.
 */
async function getUsdRateMeta(currencyRaw) {
  const currency = (currencyRaw || 'USD').toUpperCase();
  if (currency === 'USD') {
    return { rate: 1.0, source: 'same-currency', isLive: true };
  }

  const cacheKey = `USD_${currency}`;
  const now = Date.now();

  // 1. Check in-memory cache for live rate
  if (fxCache[cacheKey] && (now - fxCache[cacheKey].timestamp < CACHE_TTL_MS)) {
    return {
      rate: fxCache[cacheKey].rate,
      source: 'cached-live',
      isLive: true
    };
  }

  // 2. Direct USD -> Currency Yahoo lookup (e.g. USDINR=X, USDJPY=X, USDCAD=X)
  const directYahoo = await fetchRateFromYahoo(`USD${currency}=X`);
  if (typeof directYahoo === 'number' && directYahoo > 0) {
    fxCache[cacheKey] = { rate: directYahoo, timestamp: now, source: 'yahoo' };
    return { rate: directYahoo, source: 'yahoo', isLive: true };
  }

  // 3. Direct Currency -> USD Yahoo lookup (e.g. EURUSD=X, GBPUSD=X, AUDUSD=X)
  const reverseYahoo = await fetchRateFromYahoo(`${currency}USD=X`);
  if (typeof reverseYahoo === 'number' && reverseYahoo > 0) {
    const rate = 1 / reverseYahoo;
    fxCache[cacheKey] = { rate, timestamp: now, source: 'yahoo' };
    return { rate, source: 'yahoo', isLive: true };
  }

  // 4. Try Open Exchange Rates API
  const openRates = await fetchRatesFromOpenApi('USD');
  if (openRates && typeof openRates[currency] === 'number' && openRates[currency] > 0) {
    const rate = openRates[currency];
    fxCache[cacheKey] = { rate, timestamp: now, source: 'open-api' };
    return { rate, source: 'open-api', isLive: true };
  }

  // 5. Emergency Fallback table
  if (FALLBACK_USD_RATES[currency]) {
    const rate = FALLBACK_USD_RATES[currency];
    return { rate, source: 'fallback', isLive: false };
  }

  return { rate: null, source: 'none', isLive: false };
}

/**
 * Calculates exchange conversion rate from fromCurrency to toCurrency with metadata.
 * Returns { rate, source, isLive, from, to }.
 */
async function getFxRateMeta(fromRaw, toRaw) {
  const from = (fromRaw || 'USD').toUpperCase();
  const to = (toRaw || 'INR').toUpperCase();

  if (from === to) {
    return { rate: 1.0, source: 'same-currency', isLive: true, from, to };
  }

  const fromMeta = await getUsdRateMeta(from);
  const toMeta = await getUsdRateMeta(to);

  if (typeof fromMeta.rate === 'number' && fromMeta.rate > 0 && typeof toMeta.rate === 'number' && toMeta.rate > 0) {
    // Rate: 1 unit of `from` = (1 / fromMeta.rate) * toMeta.rate units of `to`
    const rate = (1 / fromMeta.rate) * toMeta.rate;
    const isLive = fromMeta.isLive && toMeta.isLive;
    let source = 'yahoo';
    if (!isLive) source = 'fallback';
    else if (fromMeta.source === 'cached-live' || toMeta.source === 'cached-live') source = 'cached-live';
    else if (fromMeta.source === 'open-api' || toMeta.source === 'open-api') source = 'open-api';

    console.log(`[FX] ${from} -> ${to}: ${rate} (source=${source}, isLive=${isLive})`);
    return { rate, source, isLive, from, to };
  }

  // Static fallback if live fetch unavailable
  const fallbackFrom = FALLBACK_USD_RATES[from] || 1.0;
  const fallbackTo = FALLBACK_USD_RATES[to] || 1.0;
  const rate = (1 / fallbackFrom) * fallbackTo;
  console.log(`[FX] ${from} -> ${to}: ${rate} (source=fallback, isLive=false)`);

  return { rate, source: 'fallback', isLive: false, from, to };
}

async function getFxRate(fromRaw, toRaw) {
  const res = await getFxRateMeta(fromRaw, toRaw);
  return res.rate;
}

/**
 * Resolves FX rates for all distinct holding currencies relative to portfolio base currency.
 * Reuses rates across holdings with same currency to minimize API calls.
 */
async function getFxRatesForPortfolio(currencies, baseCurrency = 'INR') {
  const base = (baseCurrency || 'INR').toUpperCase();
  const distinctCurrencies = [...new Set(currencies.map(c => (c || 'USD').toUpperCase()))];

  const ratesMap = { [base]: 1.0 };
  const fxMetaMap = {
    [base]: { rate: 1.0, source: 'same-currency', isLive: true, from: base, to: base }
  };
  let fxWarning = false;
  let hasFallback = false;

  await Promise.all(distinctCurrencies.map(async (curr) => {
    if (curr === base) {
      ratesMap[curr] = 1.0;
      fxMetaMap[curr] = { rate: 1.0, source: 'same-currency', isLive: true, from: curr, to: base };
      return;
    }
    const meta = await getFxRateMeta(curr, base);
    if (typeof meta.rate === 'number' && meta.rate > 0) {
      ratesMap[curr] = meta.rate;
      fxMetaMap[curr] = meta;
      if (!meta.isLive) {
        hasFallback = true;
      }
    } else {
      console.warn(`Could not resolve FX rate for ${curr} -> ${base}`);
      ratesMap[curr] = null;
      fxMetaMap[curr] = { rate: null, source: 'none', isLive: false, from: curr, to: base };
      fxWarning = true;
    }
  }));

  return { rates: ratesMap, fxMeta: fxMetaMap, fxWarning, hasFallback };
}

module.exports = {
  getFxRate,
  getFxRateMeta,
  getFxRatesForPortfolio
};
