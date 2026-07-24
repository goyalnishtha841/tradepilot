const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');
const { getRealQuote, getRealQuoteWithSector } = require('./yahoo-finance');
const { getMockQuote, LEGIT_SYMBOLS } = require('./mock-market');
const { getOrGenerateNews } = require('./news-service');

const fxService = require('./fx-service');

const router = express.Router();

function isValidSymbol(symbol) {
  return typeof symbol === 'string' && /^[A-Za-z0-9.\-]{1,15}$/.test(symbol.trim());
}

function resolveHoldingCurrency(h, quote) {
  if (h.currency && typeof h.currency === 'string' && h.currency.trim().length === 3) {
    return h.currency.trim().toUpperCase();
  }
  if (quote && quote.currency && quote.currency !== '—') {
    return String(quote.currency).trim().toUpperCase();
  }
  const sym = String(h.symbol || '').toUpperCase();
  if (sym.endsWith('.NS') || sym.endsWith('.BO')) return 'INR';
  if (sym.endsWith('.L')) return 'GBP';
  if (sym.endsWith('.PA') || sym.endsWith('.DE') || sym.endsWith('.F') || sym.endsWith('.AS') || sym.endsWith('.MI')) return 'EUR';
  if (sym.endsWith('.TO') || sym.endsWith('.V')) return 'CAD';
  if (sym.endsWith('.AX')) return 'AUD';
  if (sym.endsWith('.T')) return 'JPY';
  if (sym.endsWith('.HK')) return 'HKD';
  const indianTickers = ['GODREJPROP', 'RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'TATAMOTORS', 'SBIN', 'ITC', 'BHARTIARTL', 'WIPRO', 'LT'];
  if (indianTickers.includes(sym)) return 'INR';
  return 'USD';
}

// Real-time quote with graceful fallback to a simulated one if the live feed fails.
async function getQuoteWithFallback(symbol) {
  try {
    const quote = await getRealQuoteWithSector(symbol);
    return quote;
  } catch (err) {
    console.warn(`Live quote failed for ${symbol} (${err.message}), using simulated quote.`);
    return getMockQuote(symbol);
  }
}

// GET /api/portfolio/base-currency — get user's base currency preference
router.get('/base-currency', requireAuth, async (req, res) => {
  try {
    const baseCurrency = await db.getUserBaseCurrency(req.user.id);
    res.json({ baseCurrency });
  } catch (err) {
    res.json({ baseCurrency: 'INR' });
  }
});

// PUT /api/portfolio/base-currency — update user's base currency preference
router.put('/base-currency', requireAuth, async (req, res) => {
  try {
    const { baseCurrency } = req.body;
    const updated = await db.setUserBaseCurrency(req.user.id, baseCurrency);
    res.json({ baseCurrency: updated });
  } catch (err) {
    res.status(500).json({ error: 'Could not update base currency.' });
  }
});

// GET /api/portfolio — list holdings with live valuation and multi-currency FX conversion
router.get('/', requireAuth, async (req, res) => {
  try {
    const holdings = await db.listHoldings(req.user.id);
    const storedBaseCurrency = await db.getUserBaseCurrency(req.user.id);
    const baseCurrency = String(req.query.baseCurrency || storedBaseCurrency || 'INR').toUpperCase();

    // 1. Fetch live quotes for all holdings
    const holdingsWithQuotes = await Promise.all(holdings.map(async (h) => {
      const quote = await getQuoteWithFallback(h.symbol);
      const quantity = Number(h.quantity);
      const avgCost = Number(h.avgCost);
      const currency = resolveHoldingCurrency(h, quote);

      const marketValue = quote.price * quantity;
      const costBasis = avgCost * quantity;
      const gain = marketValue - costBasis;
      const gainPercent = costBasis > 0 ? (gain / costBasis) * 100 : 0;

      return {
        ...h,
        companyName: quote.companyName || h.symbol,
        currentPrice: quote.price,
        currency,
        sector: quote.sector || 'Other',
        marketValue: Math.round(marketValue * 100) / 100,
        costBasis: Math.round(costBasis * 100) / 100,
        gain: Math.round(gain * 100) / 100,
        gainPercent: Math.round(gainPercent * 100) / 100
      };
    }));

    // 2. Resolve FX rates for all distinct native currencies relative to portfolio base currency
    const distinctCurrencies = holdingsWithQuotes.map(item => item.currency);
    const { rates: fxRates, fxMeta, fxWarning: fxFetchWarning, hasFallback } = await fxService.getFxRatesForPortfolio(distinctCurrencies, baseCurrency);

    let totalValueConverted = 0;
    let totalCostConverted = 0;
    let hasFxWarning = fxFetchWarning;
    const sectorMap = {};

    // 3. Convert holdings into Base Currency for portfolio aggregation
    const enriched = holdingsWithQuotes.map((item) => {
      const isSameCurrency = (item.currency === baseCurrency);
      const fxRate = isSameCurrency ? 1.0 : fxRates[item.currency];
      let convertedMarketValue = item.marketValue;
      let convertedCostBasis = item.costBasis;

      if (typeof fxRate === 'number' && fxRate > 0) {
        convertedMarketValue = item.marketValue * fxRate;
        convertedCostBasis = item.costBasis * fxRate;
      } else {
        hasFxWarning = true;
        convertedMarketValue = 0;
        convertedCostBasis = 0;
        console.warn(`FX rate missing for ${item.currency} -> ${baseCurrency}`);
      }

      totalValueConverted += convertedMarketValue;
      totalCostConverted += convertedCostBasis;

      const sector = item.sector;
      if (convertedMarketValue > 0) {
        sectorMap[sector] = (sectorMap[sector] || 0) + convertedMarketValue;
      }

      return {
        ...item,
        fxRate: (typeof fxRate === 'number' && fxRate > 0) ? fxRate : (isSameCurrency ? 1.0 : null),
        convertedMarketValue: Math.round(convertedMarketValue * 100) / 100,
        convertedCostBasis: Math.round(convertedCostBasis * 100) / 100
      };
    });

    const totalGainConverted = totalValueConverted - totalCostConverted;
    const totalGainPercentConverted = totalCostConverted > 0 ? (totalGainConverted / totalCostConverted) * 100 : 0;

    const sectorExposure = [];
    if (totalValueConverted > 0) {
      for (const [sector, value] of Object.entries(sectorMap)) {
        sectorExposure.push({
          sector,
          value: Math.round(value * 100) / 100,
          percentage: Math.round((value / totalValueConverted) * 10000) / 100
        });
      }
    }

    res.json({
      holdings: enriched,
      summary: {
        totalValue: Math.round(totalValueConverted * 100) / 100,
        totalCost: Math.round(totalCostConverted * 100) / 100,
        totalGain: Math.round(totalGainConverted * 100) / 100,
        totalGainPercent: Math.round(totalGainPercentConverted * 100) / 100,
        baseCurrency,
        fxRates,
        fxMeta,
        fxWarning: hasFxWarning,
        hasFallback
      },
      sectorExposure
    });
  } catch (err) {
    console.error('List holdings error:', err);
    res.status(500).json({ error: 'Could not load portfolio.' });
  }
});

// POST /api/portfolio — add a holding
router.post('/', requireAuth, async (req, res) => {
  try {
    const { symbol, quantity, avgCost } = req.body;

    if (!isValidSymbol(symbol)) {
      return res.status(400).json({ error: 'Please enter a valid stock symbol (e.g. AAPL, TSLA, NVDA).' });
    }

    const sym = symbol.trim().toUpperCase();
    let quote = null;
    try {
      quote = await getRealQuote(sym);
    } catch (err) {
      if (err.message === 'SYMBOL_NOT_FOUND') {
        return res.status(400).json({ error: `Stock symbol '${sym}' does not exist in the real world.` });
      }
      console.warn(`Verification of ${sym} during add skipped due to: ${err.message}`);
      quote = getMockQuote(sym);
    }

    const qty = Number(quantity);

    if (!quantity || isNaN(qty) || qty <= 0) {
      return res.status(400).json({
        error: 'Please enter a valid quantity greater than 0.'
      });
    }

    const cost = Number(avgCost);

    if (!avgCost || isNaN(cost) || cost <= 0) {
      return res.status(400).json({
        error: 'Please enter a valid average cost per share.'
      });
    }

    const currency = resolveHoldingCurrency({ symbol: sym }, quote);

    const holding = await db.createHolding(req.user.id, {
      symbol: sym,
      quantity: qty,
      avgCost: cost,
      currency
    });

    res.json({ holding });
  } catch (err) {
    console.error('Create holding error:', err);
    res.status(500).json({ error: 'Could not add holding.' });
  }
});

// DELETE /api/portfolio/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const deleted = await db.deleteHolding(req.user.id, req.params.id);

    if (!deleted) {
      return res.status(404).json({
        error: 'Holding not found.'
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Delete holding error:', err);
    res.status(500).json({
      error: 'Could not delete holding.'
    });
  }
});

// PATCH /api/portfolio/:id
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const { quantity, avgCost } = req.body;
    const holdingId = req.params.id;

    const qty = Number(quantity);
    if (quantity === undefined || isNaN(qty) || qty <= 0) {
      return res.status(400).json({
        error: 'Quantity must be greater than 0.'
      });
    }

    const cost = Number(avgCost);
    if (avgCost === undefined || isNaN(cost) || cost < 0) {
      return res.status(400).json({
        error: 'Average buy price must be a valid positive number.'
      });
    }

    const updated = await db.updateHolding(req.user.id, holdingId, {
      quantity: qty,
      avgCost: cost
    });

    if (!updated) {
      return res.status(404).json({
        error: 'Holding not found or unauthorized.'
      });
    }

    res.json({ holding: updated });
  } catch (err) {
    console.error('Update holding error:', err);
    res.status(500).json({
      error: 'Could not update holding.'
    });
  }
});

// GET /api/portfolio/news — list news linked to holdings
router.get('/news', requireAuth, async (req, res) => {
  try {
    const holdings = await db.listHoldings(req.user.id);

    const symbols = [
      ...new Set(
        holdings.map((h) => h.symbol.trim().toUpperCase())
      )
    ];

    if (symbols.length === 0) {
      return res.json({ news: [] });
    }

    const news = await getOrGenerateNews('portfolio', symbols);

    const sanitized = news.map((item) => ({
      ...item,
      url: item.url || `https://finance.yahoo.com/quote/${item.symbol.trim().toUpperCase()}/news`
    }));

    res.json({ news: sanitized });
  } catch (err) {
    console.error('Portfolio news error:', err);
    res.status(500).json({
      error: 'Could not load portfolio news.'
    });
  }
});

module.exports = router;
