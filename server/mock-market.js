// Mock market data — since this app has no real live market feed, alerts are
// checked against a deterministic "simulated" price that drifts over time.
// Swap this out for a real market data API later without changing anything
// else (alerts.js only calls getMockPrice()).

const LEGIT_SYMBOLS = [
  { symbol: 'AAPL', name: 'Apple Inc.' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.' },
  { symbol: 'BTC', name: 'Bitcoin' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.' },
  { symbol: 'MSFT', name: 'Microsoft Corp.' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.' },
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF' },
  { symbol: 'TSLA', name: 'Tesla Inc.' },
  { symbol: 'XOM', name: 'Exxon Mobil Corp.' }
];

const BASE_PRICES = {
  NVDA: 894.52,
  AAPL: 214.1,
  TSLA: 248.3,
  BTC: 67500,
  SPY: 528.4,
  MSFT: 441.2,
  GOOGL: 178.9,
  AMZN: 187.4,
  XOM: 115.80
};

const https = require('https');

function hashSymbol(symbol) {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) {
    hash = (hash * 31 + symbol.charCodeAt(i)) % 100000;
  }
  return hash;
}

function getSimulatedPrice(symbol) {
  const base = BASE_PRICES[symbol] || 100 + (hashSymbol(symbol) % 400);
  const seed = hashSymbol(symbol);
  const minutesSinceEpoch = Math.floor(Date.now() / 60000);
  const wave = Math.sin((minutesSinceEpoch + seed) / 45) * 0.03; // +/- 3% drift
  const price = base * (1 + wave);
  return Math.round(price * 100) / 100;
}

function fetchYahooChart(symbol) {
  return new Promise((resolve, reject) => {
    // Map BTC to BTC-USD for Yahoo Finance
    const querySymbol = symbol === 'BTC' ? 'BTC-USD' : symbol;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${querySymbol}`;
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const result = data.chart?.result?.[0];
          if (result) {
            resolve(result);
          } else {
            reject(new Error("No chart result"));
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', (e) => reject(e));
  });
}

// Returns a real-time price for a symbol, falling back to simulated price
async function getMockPrice(symbolRaw) {
  const symbol = symbolRaw.trim().toUpperCase();
  try {
    const result = await fetchYahooChart(symbol);
    return result.meta.regularMarketPrice;
  } catch (err) {
    console.warn(`Failed to fetch real-time price for ${symbol}: ${err.message}. Using simulated price.`);
    return getSimulatedPrice(symbol);
  }
}

const STOCK_SECTORS = {
  NVDA: 'Technology',
  AAPL: 'Technology',
  MSFT: 'Technology',
  GOOGL: 'Technology',
  TSLA: 'Consumer Discretionary',
  AMZN: 'Consumer Discretionary',
  BTC: 'Finance',
  SPY: 'Other',
  XOM: 'Energy'
};

const SECTORS_LIST = ['Technology', 'Healthcare', 'Finance', 'Energy', 'Consumer Discretionary', 'Industrials'];

function getSectorForSymbol(symbolRaw) {
  const symbol = symbolRaw.trim().toUpperCase();
  if (STOCK_SECTORS[symbol]) {
    return STOCK_SECTORS[symbol];
  }
  const seed = hashSymbol(symbol);
  return SECTORS_LIST[seed % SECTORS_LIST.length];
}

// Returns a real-time quote, falling back to simulated quote
async function getMockQuote(symbolRaw) {
  const symbol = symbolRaw.trim().toUpperCase();
  try {
    const result = await fetchYahooChart(symbol);
    const meta = result.meta;
    const price = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose || price;
    const changeAbs = price - prevClose;
    const changePercent = prevClose > 0 ? (changeAbs / prevClose) * 100 : 0;

    return {
      symbol,
      price: Math.round(price * 100) / 100,
      changePercent: Math.round(changePercent * 100) / 100,
      changeAbs: Math.round(changeAbs * 100) / 100,
      sector: getSectorForSymbol(symbol)
    };
  } catch (err) {
    console.warn(`Failed to fetch real-time quote for ${symbol}: ${err.message}. Using simulated quote.`);
    const price = getSimulatedPrice(symbol);
    const seed = hashSymbol(symbol);
    const minutesSinceEpoch = Math.floor(Date.now() / 60000);
    const changeWave = Math.sin((minutesSinceEpoch + seed * 2) / 30);
    const changePercent = Math.round(changeWave * 3 * 100) / 100; // +/- 3%
    const changeAbs = Math.round(price * (changePercent / 100) * 100) / 100;

    return {
      symbol,
      price,
      changePercent,
      changeAbs,
      sector: getSectorForSymbol(symbol)
    };
  }
}

module.exports = { getMockPrice, getMockQuote, getSectorForSymbol, LEGIT_SYMBOLS };

