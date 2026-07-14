const express = require('express');
const { requireAuth } = require('./auth');
const { getMockQuote, LEGIT_SYMBOLS } = require('./mock-market');

const router = express.Router();

function isValidSymbol(symbol) {
  return typeof symbol === 'string' && LEGIT_SYMBOLS.some(s => s.symbol === symbol.trim().toUpperCase());
}

// GET /api/market/symbols
router.get('/symbols', requireAuth, (req, res) => {
  res.json({ symbols: LEGIT_SYMBOLS });
});

// GET /api/market/quote?symbol=AAPL
router.get('/quote', requireAuth, async (req, res) => {
  const { symbol } = req.query;
  if (!isValidSymbol(symbol)) {
    return res.status(400).json({ error: 'Please enter a supported stock symbol (e.g. AAPL, TSLA, NVDA).' });
  }
  res.json({ quote: await getMockQuote(symbol.trim().toUpperCase()) });
});

module.exports = router;
