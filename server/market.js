const express = require('express');
const fetch = require('node-fetch');
const { requireAuth } = require('./auth');
const { getRealQuote, getHistoricalData, getFundamentals, getNews, searchSymbols, getRealQuoteWithSector } = require('./yahoo-finance');
const { getMockQuote, LEGIT_SYMBOLS } = require('./mock-market');
const { getAIAnalysis } = require('./ai-analysis');

const router = express.Router();
const VALID_RANGES = ['1D', '1W', '1M', '3M', '1Y'];

function isValidSymbol(symbol) {
  return typeof symbol === 'string' && /^[A-Za-z0-9.\-]{1,15}$/.test(symbol.trim());
}

// GET /api/market/symbols
// Used by the dashboard/watchlist autocomplete dropdown for suggestions as you type.
router.get('/symbols', requireAuth, (req, res) => {
  res.json({ symbols: LEGIT_SYMBOLS });
});

// GET /api/market/search?q=QUERY — search Yahoo Finance for symbols/names dynamically
router.get('/search', requireAuth, async (req, res) => {
  const { q } = req.query;
  if (!q || typeof q !== 'string' || q.trim().length === 0) {
    return res.json({ symbols: [] });
  }

  try {
    const results = await searchSymbols(q.trim());
    res.json({ symbols: results });
  } catch (err) {
    console.error('Yahoo Finance search error:', err.message);
    res.status(500).json({ error: 'Failed to search stock symbols.' });
  }
});

// GET /api/market/quote?symbol=AAPL — real-time quote, falls back to simulated if the feed fails
router.get('/quote', requireAuth, async (req, res) => {
  const { symbol } = req.query;
  if (!isValidSymbol(symbol)) {
    return res.status(400).json({ error: 'Please enter a valid stock symbol (e.g. AAPL, TSLA, NVDA).' });
  }

  const cleanSymbol = symbol.trim().toUpperCase();

  try {
    const quote = await getRealQuoteWithSector(cleanSymbol);
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

// Duplicate routes removed. Using the versions declared above.

// GET /api/market/news/breaking
router.get('/news/breaking', requireAuth, async (req, res) => {
  const MOCK_GENERAL_NEWS = [
    { title: "Fed Hints at Rates Decision in Next FOMC Meeting", url: "https://finance.yahoo.com" },
    { title: "Tech Stocks Rally Amid Strong AI Semiconductor Demand", url: "https://finance.yahoo.com" },
    { title: "Global Energy Markets Stabilize as Production Adjusts", url: "https://finance.yahoo.com" },
    { title: "Retail Sales Exceed Expectations, Showing Economic Resilience", url: "https://finance.yahoo.com" },
    { title: "Treasury Yields Rise Following Inflation Data Release", url: "https://finance.yahoo.com" }
  ];

  try {
    const key = process.env.FINNHUB_API_KEY;
    if (!key) {
      try {
        const yNews = await getNews('SPY', 10);
        if (yNews && yNews.length > 0) {
          return res.json({
            news: yNews.map(art => ({
              title: art.title || 'Market Update',
              url: art.link || 'https://finance.yahoo.com'
            }))
          });
        }
      } catch (err) {
        console.warn('Yahoo Finance fallback news failed:', err.message);
      }
      return res.json({ news: MOCK_GENERAL_NEWS });
    }
    const response = await fetch(`https://finnhub.io/api/v1/news?category=general&token=${key}`);
    if (!response.ok) {
      try {
        const yNews = await getNews('SPY', 10);
        if (yNews && yNews.length > 0) {
          return res.json({
            news: yNews.map(art => ({
              title: art.title || 'Market Update',
              url: art.link || 'https://finance.yahoo.com'
            }))
          });
        }
      } catch (err) {
        console.warn('Yahoo Finance fallback news failed:', err.message);
      }
      return res.json({ news: MOCK_GENERAL_NEWS });
    }
    const articles = await response.json();
    if (!Array.isArray(articles) || articles.length === 0) {
      return res.json({ news: MOCK_GENERAL_NEWS });
    }
    // Map to news ticker items
    const news = articles.slice(0, 10).map(art => ({
      title: art.headline || 'Market Update',
      url: art.url || 'https://finnhub.io/news'
    }));
    res.json({ news });
  } catch (err) {
    console.error('Failed to fetch breaking news:', err.message);
    res.json({ news: MOCK_GENERAL_NEWS });
  }
});

module.exports = router;