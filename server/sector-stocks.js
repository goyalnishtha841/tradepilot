// Curated, beginner-friendly stock lists per sector — used by the Explore page's
// sector picker so a new user can browse well-known names in a sector they care
// about before they know any ticker symbols. Kept in sync with the sector names
// in mock-market.js (STOCK_SECTORS / SECTORS_LIST) so results line up with what
// getSectorForSymbol() would say about the same stock elsewhere in the app.
//
// These are static reference lists (name + symbol only) — real-time price/change
// for each one is still fetched live from yahoo-finance.js when the user picks one.

const SECTOR_STOCKS = {
  'Technology': [
    { symbol: 'AAPL', name: 'Apple Inc.' },
    { symbol: 'MSFT', name: 'Microsoft Corp.' },
    { symbol: 'GOOGL', name: 'Alphabet Inc.' },
    { symbol: 'NVDA', name: 'NVIDIA Corp.' },
    { symbol: 'META', name: 'Meta Platforms Inc.' },
    { symbol: 'ADBE', name: 'Adobe Inc.' },
    { symbol: 'CRM', name: 'Salesforce Inc.' },
    { symbol: 'ORCL', name: 'Oracle Corp.' },
    { symbol: 'INTC', name: 'Intel Corp.' },
    { symbol: 'CSCO', name: 'Cisco Systems Inc.' }
  ],
  'Healthcare': [
    { symbol: 'JNJ', name: 'Johnson & Johnson' },
    { symbol: 'PFE', name: 'Pfizer Inc.' },
    { symbol: 'UNH', name: 'UnitedHealth Group' },
    { symbol: 'ABBV', name: 'AbbVie Inc.' },
    { symbol: 'MRK', name: 'Merck & Co.' },
    { symbol: 'LLY', name: 'Eli Lilly and Co.' },
    { symbol: 'TMO', name: 'Thermo Fisher Scientific' },
    { symbol: 'ABT', name: 'Abbott Laboratories' },
    { symbol: 'BMY', name: 'Bristol-Myers Squibb' },
    { symbol: 'MDT', name: 'Medtronic plc' }
  ],
  'Finance': [
    { symbol: 'JPM', name: 'JPMorgan Chase & Co.' },
    { symbol: 'BAC', name: 'Bank of America Corp.' },
    { symbol: 'WFC', name: 'Wells Fargo & Co.' },
    { symbol: 'GS', name: 'Goldman Sachs Group' },
    { symbol: 'MS', name: 'Morgan Stanley' },
    { symbol: 'C', name: 'Citigroup Inc.' },
    { symbol: 'AXP', name: 'American Express Co.' },
    { symbol: 'BLK', name: 'BlackRock Inc.' },
    { symbol: 'SCHW', name: 'Charles Schwab Corp.' },
    { symbol: 'V', name: 'Visa Inc.' }
  ],
  'Energy': [
    { symbol: 'XOM', name: 'Exxon Mobil Corp.' },
    { symbol: 'CVX', name: 'Chevron Corp.' },
    { symbol: 'COP', name: 'ConocoPhillips' },
    { symbol: 'SLB', name: 'Schlumberger NV' },
    { symbol: 'EOG', name: 'EOG Resources' },
    { symbol: 'MPC', name: 'Marathon Petroleum' },
    { symbol: 'PSX', name: 'Phillips 66' },
    { symbol: 'OXY', name: 'Occidental Petroleum' },
    { symbol: 'VLO', name: 'Valero Energy' },
    { symbol: 'KMI', name: 'Kinder Morgan' }
  ],
  'Consumer Discretionary': [
    { symbol: 'AMZN', name: 'Amazon.com Inc.' },
    { symbol: 'TSLA', name: 'Tesla Inc.' },
    { symbol: 'HD', name: 'Home Depot Inc.' },
    { symbol: 'MCD', name: "McDonald's Corp." },
    { symbol: 'NKE', name: 'Nike Inc.' },
    { symbol: 'SBUX', name: 'Starbucks Corp.' },
    { symbol: 'LOW', name: "Lowe's Companies" },
    { symbol: 'TJX', name: 'TJX Companies' },
    { symbol: 'BKNG', name: 'Booking Holdings' },
    { symbol: 'CMG', name: 'Chipotle Mexican Grill' }
  ],
  'Industrials': [
    { symbol: 'BA', name: 'Boeing Co.' },
    { symbol: 'CAT', name: 'Caterpillar Inc.' },
    { symbol: 'GE', name: 'General Electric Co.' },
    { symbol: 'HON', name: 'Honeywell International' },
    { symbol: 'UPS', name: 'United Parcel Service' },
    { symbol: 'LMT', name: 'Lockheed Martin Corp.' },
    { symbol: 'RTX', name: 'RTX Corp.' },
    { symbol: 'DE', name: 'Deere & Co.' },
    { symbol: 'MMM', name: '3M Co.' },
    { symbol: 'UNP', name: 'Union Pacific Corp.' }
  ]
};

const SECTOR_NAMES = Object.keys(SECTOR_STOCKS);

function getStocksForSector(sectorRaw) {
  if (!sectorRaw) return [];
  const match = SECTOR_NAMES.find((s) => s.toLowerCase() === sectorRaw.trim().toLowerCase());
  return match ? SECTOR_STOCKS[match] : [];
}

module.exports = { SECTOR_STOCKS, SECTOR_NAMES, getStocksForSector };