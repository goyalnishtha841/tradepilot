const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const db = require('./db');
const { requireAuth } = require('./auth');
const { getMockQuote } = require('./mock-market');

const SYMBOLS = ['AAPL', 'AMZN', 'BTC', 'GOOGL', 'MSFT', 'NVDA', 'SPY', 'TSLA', 'XOM'];

// Simple in-memory cache: refresh real prices at most once per 20 seconds
let priceCache = null;
let priceCacheTime = 0;
const PRICE_CACHE_TTL_MS = 20_000;

/**
 * Fetch real-time stock quote from Finnhub API
 */
async function fetchFinnhubQuote(symbol) {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return getMockQuote(symbol);

  try {
    const finnSymbol = symbol === 'BTC' ? 'BINANCE:BTCUSDT' : symbol;
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(finnSymbol)}&token=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Finnhub returned ${res.status}`);
    const data = await res.json();
    if (!data || typeof data.c !== 'number' || data.c === 0) {
      return getMockQuote(symbol);
    }
    return {
      symbol,
      price: data.c,
      prevClose: data.pc || data.c,
      changeAbs: data.d || 0,
      changePercent: data.dp || 0
    };
  } catch (err) {
    return getMockQuote(symbol);
  }
}

// GET /api/papertrading/prices — batch real-time quotes for all symbols from Finnhub (fallback to mock)
router.get('/prices', async (req, res) => {
  try {
    const now = Date.now();
    if (priceCache && now - priceCacheTime < PRICE_CACHE_TTL_MS) {
      return res.json({ prices: priceCache, cached: true });
    }

    const quotes = await Promise.all(SYMBOLS.map(sym => fetchFinnhubQuote(sym)));
    priceCache = {};
    quotes.forEach(q => {
      priceCache[q.symbol] = {
        price: q.price,
        prevClose: q.price - (q.changeAbs || 0),
        changeAbs: q.changeAbs || 0,
        changePercent: q.changePercent || 0
      };
    });
    priceCacheTime = now;
    res.json({ prices: priceCache, cached: false });
  } catch (err) {
    console.error('Paper trading prices fetch error:', err);
    res.status(500).json({ error: 'Could not fetch real-time prices.' });
  }
});

// GET /api/papertrading/news/:symbol — fetch live Finnhub news for active stock
router.get('/news/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey) return res.json({ news: [] });

    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 7);
    const fromStr = from.toISOString().split('T')[0];
    const toStr = to.toISOString().split('T')[0];

    const isCryptoOrEtf = ['BTC', 'SPY'].includes(symbol);
    const url = isCryptoOrEtf
      ? `https://finnhub.io/api/v1/news?category=general&token=${apiKey}`
      : `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${fromStr}&to=${toStr}&token=${apiKey}`;

    const response = await fetch(url);
    if (!response.ok) return res.json({ news: [] });

    const articles = await response.json();
    if (!Array.isArray(articles)) return res.json({ news: [] });

    const news = articles.slice(0, 4).map(a => ({
      headline: a.headline || `${symbol} Market News`,
      summary: a.summary || '',
      url: a.url || `https://finnhub.io`,
      source: a.source || 'Finnhub',
      datetime: a.datetime ? new Date(a.datetime * 1000).toLocaleString() : 'Recent'
    }));

    res.json({ news });
  } catch (err) {
    console.error('Paper trading news fetch error:', err);
    res.json({ news: [] });
  }
});

// GET /api/papertrading/fundamentals/:symbol — fetch live Finnhub profile & financial metrics
router.get('/fundamentals/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey) return res.json({ fundamentals: null });

    const finnSymbol = symbol === 'BTC' ? 'BINANCE:BTCUSDT' : symbol;
    const [profRes, metricRes] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(finnSymbol)}&token=${apiKey}`),
      fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(finnSymbol)}&metric=all&token=${apiKey}`)
    ]);

    const profile = profRes.ok ? await profRes.json() : {};
    const metrics = metricRes.ok ? await metricRes.json() : {};
    const m = metrics.metric || {};

    res.json({
      fundamentals: {
        symbol,
        name: profile.name || symbol,
        marketCap: profile.marketCapitalization ? `$${(profile.marketCapitalization / 1000).toFixed(2)}B` : 'N/A',
        peRatio: m.peBasicExclExtraTTM ? `${m.peBasicExclExtraTTM.toFixed(2)}x` : (m.peTTM ? `${m.peTTM.toFixed(2)}x` : 'N/A'),
        pbRatio: m.pbAnnual ? `${m.pbAnnual.toFixed(2)}x` : 'N/A',
        week52High: m['52WeekHigh'] ? `$${m['52WeekHigh'].toFixed(2)}` : 'N/A',
        week52Low: m['52WeekLow'] ? `$${m['52WeekLow'].toFixed(2)}` : 'N/A',
        roe: m.roeTTM ? `${m.roeTTM.toFixed(2)}%` : 'N/A',
        revenueGrowth: m.revenueGrowth3Y ? `${m.revenueGrowth3Y.toFixed(2)}%` : 'N/A',
        quickRatio: m.quickRatioAnnual ? `${m.quickRatioAnnual.toFixed(2)}` : 'N/A',
        debtToEquity: m.totalDebtToEquityAnnual ? `${m.totalDebtToEquityAnnual.toFixed(2)}x` : 'N/A',
        dividendYield: m.dividendYieldIndicatedAnnual ? `${m.dividendYieldIndicatedAnnual.toFixed(2)}%` : 'N/A'
      }
    });
  } catch (err) {
    console.error('Paper trading fundamentals fetch error:', err);
    res.json({ fundamentals: null });
  }
});

// GET /api/papertrading/state — load user's saved simulator state
router.get('/state', requireAuth, async (req, res) => {
  try {
    const state = await db.getPaperTradingState(req.user.id);
    res.json({ state: state || null });
  } catch (err) {
    console.error('Paper trading state load error:', err);
    res.status(500).json({ error: 'Could not load paper trading state.' });
  }
});

// POST /api/papertrading/state — save user's simulator state
router.post('/state', requireAuth, async (req, res) => {
  try {
    const { state } = req.body;
    if (!state || typeof state !== 'object') {
      return res.status(400).json({ error: 'Missing or invalid state object.' });
    }
    await db.savePaperTradingState(req.user.id, state);
    res.json({ ok: true });
  } catch (err) {
    console.error('Paper trading state save error:', err);
    res.status(500).json({ error: 'Could not save paper trading state.' });
  }
});

module.exports = router;
