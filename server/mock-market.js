// Simulated market data — used ONLY as a fallback when the real Yahoo Finance
// feed (see yahoo-finance.js) is unavailable or rate-limited, so the app never
// hard-fails just because a network call failed. Real-time data always comes
// from yahoo-finance.js first; this file is the safety net.

const LEGIT_SYMBOLS = [
  { symbol: 'AAPL', name: 'Apple Inc.' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.' },
  { symbol: 'BTC-USD', name: 'Bitcoin' },
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
  'BTC-USD': 67500,
  SPY: 528.4,
  MSFT: 441.2,
  GOOGL: 178.9,
  AMZN: 187.4,
  XOM: 115.80
};

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

const STOCK_SECTORS = {
  NVDA: 'Technology',
  AAPL: 'Technology',
  MSFT: 'Technology',
  GOOGL: 'Technology',
  TSLA: 'Consumer Discretionary',
  AMZN: 'Consumer Discretionary',
  'BTC-USD': 'Finance',
  SPY: 'Other',
  XOM: 'Energy'
};

const SECTORS_LIST = [
  'Technology',
  'Healthcare',
  'Finance',
  'Energy',
  'Consumer Discretionary',
  'Industrials'
];

function getSectorForSymbol(symbolRaw) {
  const symbol = symbolRaw.trim().toUpperCase();

  if (STOCK_SECTORS[symbol]) {
    return STOCK_SECTORS[symbol];
  }

  const seed = hashSymbol(symbol);
  return SECTORS_LIST[seed % SECTORS_LIST.length];
}

// Simulated price fallback (synchronous, deterministic — safe to call when a
// real quote lookup has failed or before one has resolved).
function getMockPrice(symbolRaw) {
  const symbol = symbolRaw.trim().toUpperCase();
  return getSimulatedPrice(symbol);
}

// Simulated fuller quote fallback: current simulated price plus a plausible
// day-change percent, both deterministic based on the symbol and current time.
function getMockQuote(symbolRaw) {
  const symbol = symbolRaw.trim().toUpperCase();
  const price = getSimulatedPrice(symbol);
  const seed = hashSymbol(symbol);
  const minutesSinceEpoch = Math.floor(Date.now() / 60000);
  const changeWave = Math.sin((minutesSinceEpoch + seed * 2) / 30);
  const changePercent = Math.round(changeWave * 3 * 100) / 100; // +/- 3%
  const changeAbs = Math.round(price * (changePercent / 100) * 100) / 100;

  const isIndian = symbol.endsWith('.NS') || symbol.endsWith('.BO') || ['GODREJPROP', 'RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'TATAMOTORS', 'SBIN', 'ITC', 'BHARTIARTL', 'WIPRO', 'LT'].includes(symbol);
  return {
    symbol,
    price,
    changePercent,
    changeAbs,
    currency: isIndian ? 'INR' : (symbol.endsWith('.L') ? 'GBP' : (symbol.endsWith('.PA') || symbol.endsWith('.DE') ? 'EUR' : 'USD')),
    sector: getSectorForSymbol(symbol),
    simulated: true
  };
}

module.exports = {
  getMockPrice,
  getMockQuote,
  getSectorForSymbol,
  LEGIT_SYMBOLS
};
