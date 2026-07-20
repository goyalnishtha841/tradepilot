const express = require('express');
const { requireAuth } = require('./auth');
const { getRealQuote, getHistoricalData, getFundamentals, getNews } = require('./yahoo-finance');
const { getMockQuote, getSectorForSymbol, LEGIT_SYMBOLS } = require('./mock-market');
const { getAIAnalysis } = require('./ai-analysis');

const router = express.Router();
const VALID_RANGES = ['1D', '1W', '1M', '3M', '1Y'];

function isValidSymbol(symbol) {
  // allow letters, dots, hyphens for symbols like BRK.B, RELIANCE.NS, BTC-USD
  return typeof symbol === 'string' && /^[A-Za-z.\-]{1,15}$/.test(symbol.trim());
}

// GET /api/market/symbols — curated list shown in dropdowns/pickers
router.get('/symbols', requireAuth, (req, res) => {
  res.json({ symbols: LEGIT_SYMBOLS });
});

// GET /api/market/quote?symbol=AAPL — real-time quote, falls back to simulated if the feed fails
router.get('/quote', requireAuth, async (req, res) => {
  const { symbol } = req.query;
  if (!isValidSymbol(symbol)) {
    return res.status(400).json({ error: 'Please enter a valid stock symbol (e.g. AAPL, TSLA, NVDA).' });
  }

  const cleanSymbol = symbol.trim().toUpperCase();

  try {
    const quote = await getRealQuote(cleanSymbol);
    quote.sector = getSectorForSymbol(cleanSymbol);
    quote.simulated = false;
    res.json({ quote });
  } catch (err) {
    if (err.message === 'SYMBOL_NOT_FOUND') {
      return res.status(404).json({ error: `Could not find market data for "${cleanSymbol}". Check the symbol and try again.` });
    }
    console.warn(`Live quote failed for ${cleanSymbol} (${err.message}), falling back to simulated quote.`);
    res.json({ quote: getMockQuote(cleanSymbol) });
  }
});

// GET /api/market/chart?symbol=AAPL&range=1D
router.get('/chart', requireAuth, async (req, res) => {
  const { symbol, range } = req.query;
  if (!isValidSymbol(symbol)) {
    return res.status(400).json({ error: 'Please enter a valid stock symbol.' });
  }
  const cleanSymbol = symbol.trim().toUpperCase();
  const cleanRange = VALID_RANGES.includes(range) ? range : '1D';

  try {
    const chartData = await getHistoricalData(cleanSymbol, cleanRange);
    res.json(chartData);
  } catch (err) {
    if (err.message === 'SYMBOL_NOT_FOUND') {
      return res.status(404).json({ error: `Could not find chart data for "${cleanSymbol}".` });
    }
    console.error('Yahoo chart error:', err.message);
    res.status(502).json({ error: 'Market data provider is unavailable right now. Please try again in a moment.' });
  }
});

// GET /api/market/fundamentals?symbol=AAPL
router.get('/fundamentals', requireAuth, async (req, res) => {
  const { symbol } = req.query;
  if (!isValidSymbol(symbol)) {
    return res.status(400).json({ error: 'Please enter a valid stock symbol.' });
  }
  const cleanSymbol = symbol.trim().toUpperCase();

  try {
    const fundamentals = await getFundamentals(cleanSymbol);
    res.json(fundamentals);
  } catch (err) {
    if (err.message === 'SYMBOL_NOT_FOUND') {
      return res.status(404).json({ error: `Could not find fundamental data for "${cleanSymbol}".` });
    }
    console.error('Yahoo fundamentals error:', err.message);
    res.status(502).json({ error: 'Market data provider is unavailable right now. Please try again in a moment.' });
  }
});

// GET /api/market/news?symbol=AAPL&count=2
router.get('/news', requireAuth, async (req, res) => {
  const { symbol, count } = req.query;
  if (!isValidSymbol(symbol)) {
    return res.status(400).json({ error: 'Please enter a valid stock symbol.' });
  }
  const cleanSymbol = symbol.trim().toUpperCase();
  const cleanCount = Math.min(Math.max(parseInt(count, 10) || 2, 1), 10);

  try {
    const news = await getNews(cleanSymbol, cleanCount);
    res.json({ news });
  } catch (err) {
    console.error('Yahoo news error:', err.message);
    res.status(502).json({ error: 'News data is unavailable right now.' });
  }
});

// GET /api/market/ai-analysis?symbol=AAPL
router.get('/ai-analysis', requireAuth, async (req, res) => {
  const { symbol } = req.query;
  if (!isValidSymbol(symbol)) {
    return res.status(400).json({ error: 'Please enter a valid stock symbol.' });
  }
  const cleanSymbol = symbol.trim().toUpperCase();

  try {
    const analysis = await getAIAnalysis(cleanSymbol);
    res.json(analysis);
  } catch (err) {
    if (err.message === 'SYMBOL_NOT_FOUND') {
      return res.status(404).json({ error: `Could not find data for "${cleanSymbol}" to analyze.` });
    }
    console.error('AI analysis error:', err.message);
    res.status(502).json({ error: 'AI analysis is unavailable right now.' });
  }
});

module.exports = router;
