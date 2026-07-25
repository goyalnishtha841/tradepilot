const fetch = require('node-fetch');
const db = require('./db');

const { getNews: getYahooNews, getRawNews: getYahooRawNews } = require('./yahoo-finance');

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

if (!FINNHUB_API_KEY) {
  console.warn('Market news provider disabled: FINNHUB_API_KEY is not configured');
}

// Symbols that don't work with Finnhub's /company-news endpoint
// (crypto, ETFs, indices). We fall back to general market news for these.
const NON_STOCK_SYMBOLS = new Set(['BTC', 'SPY', 'ETH', 'QQQ', 'DIA', 'IWM']);

/**
 * Fetch real company news from Finnhub for a specific stock symbol.
 * Endpoint: GET /api/v1/company-news?symbol=AAPL&from=...&to=...&token=...
 * Free tier: 60 calls/minute — plenty for a dashboard with < 20 symbols.
 */
async function fetchCompanyNews(symbol) {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 7); // Last 7 days of news

  const fromStr = from.toISOString().split('T')[0];
  const toStr = to.toISOString().split('T')[0];

  const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${fromStr}&to=${toStr}&token=${FINNHUB_API_KEY}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Finnhub company-news returned ${response.status} for ${symbol}`);
  }

  const articles = await response.json();

  if (!Array.isArray(articles) || articles.length === 0) {
    return [];
  }

  // Take up to 3 most recent articles and map to our schema
  return articles.slice(0, 3).map(article => ({
    symbol,
    title: article.headline || `${symbol} news`,
    description: article.summary || 'No summary available.',
    url: article.url || `https://finnhub.io/news`
  }));
}

/**
 * Fetch general market news from Finnhub.
 * Used as a fallback for crypto/ETF symbols that aren't covered by /company-news.
 * Endpoint: GET /api/v1/news?category=general&token=...
 */
async function fetchGeneralNews(symbol) {
  const url = `https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_API_KEY}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Finnhub general news returned ${response.status}`);
  }

  const articles = await response.json();

  if (!Array.isArray(articles) || articles.length === 0) {
    return [];
  }

  // Take up to 2 general market news items, tagged with the symbol
  return articles.slice(0, 2).map(article => ({
    symbol,
    title: article.headline || 'Market news',
    description: article.summary || 'No summary available.',
    url: article.url || `https://finnhub.io/news`
  }));
}

/**
 * Fetch real news for a symbol — uses company-news for stocks,
 * general market news for crypto/ETFs.
 */
async function fetchRealNews(symbol) {
  if (!FINNHUB_API_KEY) {
    console.warn('⚠️  FINNHUB_API_KEY not set in server/.env — falling back to Yahoo Finance news.');
    try {
      const yNews = await getYahooNews(symbol, 3);
      return yNews.map(item => ({
        symbol,
        title: item.title || 'Untitled',
        description: `Source: ${item.publisher || 'Yahoo Finance'}`,
        url: item.link || `https://finance.yahoo.com/quote/${symbol.toUpperCase()}`
      }));
    } catch (err) {
      console.warn(`Yahoo fallback news fetch failed for ${symbol}:`, err.message);
      return [];
    }
  }

  if (NON_STOCK_SYMBOLS.has(symbol.toUpperCase())) {
    return fetchGeneralNews(symbol);
  }

  return fetchCompanyNews(symbol);
}

/**
 * Main entry point — checks the DB cache first (30-min TTL),
 * fetches fresh real news for any symbols that aren't cached,
 * saves new items to the DB, and returns the merged result.
 */
async function getOrGenerateNews(table, symbols) {
  if (!symbols || symbols.length === 0) return [];

  // 1. Fetch current cached news from DB
  let cached = await db.getNewsForSymbols(table, symbols);

  // Filter cached to only keep those less than 30 minutes old
  const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
  const activeCached = cached.filter(item => new Date(item.createdAt) > thirtyMinsAgo);

  // Check which symbols don't have news cached
  const cachedSymbols = new Set(activeCached.map(c => c.symbol));
  const missingSymbols = symbols.filter(s => !cachedSymbols.has(s));

  let generatedItems = [];
  if (missingSymbols.length > 0) {
    for (const symbol of missingSymbols) {
      let newsList = [];
      try {
        newsList = await fetchRealNews(symbol);
      } catch (err) {
        console.warn(`Finnhub news fetch failed for ${symbol}:`, err.message);
        // No fake fallback — just skip this symbol
        newsList = [];
      }

      for (const item of newsList) {
        try {
          const saved = await db.saveNewsItem(table, item);
          generatedItems.push(saved);
        } catch (dbErr) {
          console.error(`Failed to save news item for ${symbol}:`, dbErr);
        }
      }
    }
  }

  // Merge active cached and new fetched items, then sort by createdAt DESC
  const allNews = [...activeCached, ...generatedItems].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return allNews;
}

// Broad-market symbols used to stand in for "general market news" — Yahoo's
// search endpoint is per-symbol, it has no general/category news feed, so we
// aggregate headlines across a handful of broad-market tickers instead.
const MARKET_PROXY_SYMBOLS = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'TSLA'];

/**
 * Fetches general market headlines directly from Yahoo Finance, aggregated
 * across a few broad-market symbols and deduplicated.
 */
async function fetchYahooMarketHeadlines() {
  const results = await Promise.allSettled(
    MARKET_PROXY_SYMBOLS.map(symbol => getYahooRawNews(symbol, 6))
  );

  const seenTitles = new Set();
  const seenUrls = new Set();
  const uniqueArticles = [];

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const item of result.value) {
      const title = (item.title || '').trim();
      const url = (item.link || '').trim();
      if (!title || !url) continue;
      if (seenTitles.has(title) || seenUrls.has(url)) continue;
      seenTitles.add(title);
      seenUrls.add(url);
      uniqueArticles.push({
        title,
        url,
        source: item.publisher || 'Yahoo Finance',
        publishedAt: item.publishedAt ? new Date(item.publishedAt).toISOString() : new Date().toISOString()
      });
    }
  }

  if (uniqueArticles.length === 0) {
    const failedReasons = results
      .filter(r => r.status === 'rejected')
      .map(r => r.reason && r.reason.message)
      .filter(Boolean);
    throw new Error(
      failedReasons.length
        ? `Yahoo Finance returned no market headlines (${failedReasons.join('; ')})`
        : 'Yahoo Finance returned no market headlines for any tracked symbol'
    );
  }

  uniqueArticles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return uniqueArticles.slice(0, 12);
}

let cachedHeadlines = null;
let cachedAt = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getMarketHeadlines() {
  const now = Date.now();

  if (cachedHeadlines && cachedAt && (now - cachedAt < CACHE_TTL_MS)) {
    return {
      news: cachedHeadlines,
      updatedAt: new Date(cachedAt).toISOString()
    };
  }

  try {
    const headlines = await fetchYahooMarketHeadlines();
    cachedHeadlines = headlines;
    cachedAt = now;

    return {
      news: headlines,
      source: 'yahoo',
      updatedAt: new Date(now).toISOString()
    };
  } catch (err) {
    console.error('Market headlines fetch error:', err.message);
    if (cachedHeadlines && cachedAt) {
      console.warn('Returning stale cached headlines due to fetch failure.');
      return {
        news: cachedHeadlines,
        stale: true,
        updatedAt: new Date(cachedAt).toISOString()
      };
    }
    throw err;
  }
}

module.exports = { getOrGenerateNews, getMarketHeadlines };
