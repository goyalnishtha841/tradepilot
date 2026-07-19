const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');
const { getMockQuote } = require('./mock-market');
const { getOrGenerateNews } = require('./news-service');

const router = express.Router();

function isValidSymbol(symbol) {
  return typeof symbol === 'string' && /^[A-Za-z]{1,6}$/.test(symbol.trim());
}

// GET /api/watchlist — list saved symbols with live (mock) quotes
router.get('/', requireAuth, async (req, res) => {
  try {
    const items = await db.listWatchlist(req.user.id);
    const enriched = items.map((item) => ({ ...item, quote: getMockQuote(item.symbol) }));
    res.json({ watchlist: enriched });
  } catch (err) {
    console.error('List watchlist error:', err);
    res.status(500).json({ error: 'Could not load watchlist.' });
  }
});

// POST /api/watchlist — add a symbol { symbol }
router.post('/', requireAuth, async (req, res) => {
  try {
    const { symbol } = req.body;
    if (!isValidSymbol(symbol)) {
      return res.status(400).json({ error: 'Please enter a valid stock symbol (letters only, e.g. AAPL).' });
    }
    const item = await db.addToWatchlist(req.user.id, symbol.trim().toUpperCase());
    res.json({ item: { ...item, quote: getMockQuote(item.symbol) } });
  } catch (err) {
    console.error('Add watchlist error:', err);
    res.status(500).json({ error: 'Could not add to watchlist.' });
  }
});

// DELETE /api/watchlist/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const removed = await db.removeFromWatchlist(req.user.id, req.params.id);
    if (!removed) {
      return res.status(404).json({ error: 'Watchlist item not found.' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Remove watchlist error:', err);
    res.status(500).json({ error: 'Could not remove from watchlist.' });
  }
});

// GET /api/watchlist/news — list news linked to watchlist
router.get('/news', requireAuth, async (req, res) => {
  try {
    const items = await db.listWatchlist(req.user.id);
    const symbols = [...new Set(items.map(item => item.symbol.trim().toUpperCase()))];
    if (symbols.length === 0) {
      return res.json({ news: [] });
    }
    const news = await getOrGenerateNews('watchlist', symbols);
    const sanitized = news.map(item => ({
      ...item,
      url: `https://finance.yahoo.com/quote/${item.symbol.trim().toUpperCase()}/news`
    }));
    res.json({ news: sanitized });
  } catch (err) {
    console.error('Watchlist news error:', err);
    res.status(500).json({ error: 'Could not load watchlist news.' });
  }
});

module.exports = router;
