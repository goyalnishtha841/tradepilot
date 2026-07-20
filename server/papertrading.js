const express = require('express');
const router = express.Router();
const db = require('./db');
const { requireAuth } = require('./auth');
const { getMockQuote } = require('./mock-market');

const SYMBOLS = ['AAPL', 'AMZN', 'BTC', 'GOOGL', 'MSFT', 'NVDA', 'SPY', 'TSLA', 'XOM'];

// Simple in-memory cache: refresh real prices at most once per 20 seconds
let priceCache = null;
let priceCacheTime = 0;
const PRICE_CACHE_TTL_MS = 20_000;

// GET /api/papertrading/prices — batch real-time quotes for all symbols (no auth required)
router.get('/prices', async (req, res) => {
  try {
    const now = Date.now();
    if (priceCache && now - priceCacheTime < PRICE_CACHE_TTL_MS) {
      return res.json({ prices: priceCache, cached: true });
    }

    // Fetch all quotes in parallel; getMockQuote falls back to deterministic simulation if Yahoo is down
    const quotes = await Promise.all(SYMBOLS.map(sym => getMockQuote(sym)));
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
