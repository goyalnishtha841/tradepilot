const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');
const { getRealQuote, getNews, getFundamentals } = require('./yahoo-finance');
const { getMockPrice, getMockQuote, getSectorForSymbol } = require('./mock-market');
const { getSectorEtfFor } = require('./sector-etfs');
const { getRecentFilings } = require('./sec-edgar');

const router = express.Router();

const VALID_CONDITIONS = ['above', 'below'];
const VALID_ALERT_TYPES = [
  'Price Threshold',
  'Volume Movement',
  'News',
  'Filing',
  'Sentiment Shift',
  'Sector Impact',
  'Portfolio Relevance'
];
// Every type below has a real, live data feed backing it — including Filing now,
// via SEC EDGAR's free public API.
const MONITORED_TYPES = [
  'Price Threshold',
  'Volume Movement',
  'News',
  'Filing',
  'Sentiment Shift',
  'Sector Impact',
  'Portfolio Relevance'
];
// News and Filing don't need a condition/target price — they fire on the next
// real article/filing. Every other monitored type needs a numeric threshold.
const TYPES_REQUIRING_TARGET = [
  'Price Threshold',
  'Volume Movement',
  'Sentiment Shift',
  'Sector Impact',
  'Portfolio Relevance'
];

function isValidSymbol(symbol) {
  return typeof symbol === 'string' && /^[A-Za-z0-9.\-]{1,15}$/.test(symbol.trim());
}

// Real-time price with graceful fallback to a simulated one if the live feed fails.
async function getPriceWithFallback(symbol) {
  try {
    const quote = await getRealQuote(symbol);
    return { price: quote.price, simulated: false };
  } catch (err) {
    console.warn(`Live price failed for ${symbol} (${err.message}), using simulated price.`);
    return { price: getMockPrice(symbol), simulated: true };
  }
}

// ---------- Per-type evaluators ----------
// Each returns { currentPrice, simulated, shouldTrigger, displayValue, unavailable? }
// currentPrice is always the underlying stock price (for consistent display),
// displayValue is the specific real metric that type actually monitors.

async function evaluatePriceThreshold(alert) {
  const { price, simulated } = await getPriceWithFallback(alert.symbol);
  const target = Number(alert.targetPrice);
  const shouldTrigger = alert.condition === 'above' ? price >= target : price <= target;
  return { currentPrice: price, simulated, shouldTrigger, displayValue: `$${price}` };
}

async function evaluateVolumeMovement(alert) {
  try {
    const [quote, fundamentals] = await Promise.all([
      getRealQuote(alert.symbol),
      getFundamentals(alert.symbol)
    ]);
    const volume = quote.volume;
    const avgVolume = fundamentals.avgVolume;
    if (volume == null || !avgVolume) {
      return { currentPrice: quote.price, simulated: false, shouldTrigger: false, displayValue: 'volume data unavailable for this symbol', unavailable: true };
    }
    const volumeRatio = Math.round((volume / avgVolume) * 100) / 100;
    const target = Number(alert.targetPrice);
    const shouldTrigger = alert.condition === 'above' ? volumeRatio >= target : volumeRatio <= target;
    return { currentPrice: quote.price, simulated: false, shouldTrigger, displayValue: `${volumeRatio}x average volume` };
  } catch (err) {
    const { price } = await getPriceWithFallback(alert.symbol);
    return { currentPrice: price, simulated: true, shouldTrigger: false, displayValue: 'volume data temporarily unavailable', unavailable: true };
  }
}

async function evaluateSectorImpact(alert) {
  const { price } = await getPriceWithFallback(alert.symbol);
  const sector = getSectorForSymbol(alert.symbol);
  const etf = getSectorEtfFor(sector);
  if (!etf) {
    return { currentPrice: price, simulated: true, shouldTrigger: false, displayValue: 'sector data unavailable for this symbol', unavailable: true };
  }
  try {
    const etfQuote = await getRealQuote(etf.symbol);
    const target = Number(alert.targetPrice);
    const shouldTrigger = alert.condition === 'above' ? etfQuote.changePercent >= target : etfQuote.changePercent <= -target;
    return {
      currentPrice: price,
      simulated: false,
      shouldTrigger,
      displayValue: `${sector} sector ${etfQuote.changePercent > 0 ? '+' : ''}${etfQuote.changePercent}% today`
    };
  } catch (err) {
    return { currentPrice: price, simulated: true, shouldTrigger: false, displayValue: 'sector data temporarily unavailable', unavailable: true };
  }
}

async function evaluatePortfolioRelevance(alert, userId) {
  const { price, simulated } = await getPriceWithFallback(alert.symbol);
  const holdings = await db.listHoldings(userId);
  const inPortfolio = holdings.some((h) => h.symbol.trim().toUpperCase() === alert.symbol);

  if (!inPortfolio) {
    return { currentPrice: price, simulated, shouldTrigger: false, displayValue: `not currently in your portfolio — add a $${alert.symbol} holding for this alert to activate`, unavailable: true };
  }

  try {
    const quote = await getRealQuote(alert.symbol);
    const target = Number(alert.targetPrice);
    const shouldTrigger = alert.condition === 'above' ? quote.changePercent >= target : quote.changePercent <= -target;
    return {
      currentPrice: quote.price,
      simulated: false,
      shouldTrigger,
      displayValue: `${quote.changePercent > 0 ? '+' : ''}${quote.changePercent}% today, held in your portfolio`
    };
  } catch (err) {
    return { currentPrice: price, simulated: true, shouldTrigger: false, displayValue: 'price data temporarily unavailable', unavailable: true };
  }
}

async function evaluateNews(alert) {
  const { price } = await getPriceWithFallback(alert.symbol);
  try {
    const news = await getNews(alert.symbol, 3);
    const createdAt = new Date(alert.createdAt).getTime();
    const freshItem = news.find((n) => n.publishedAt && n.publishedAt > createdAt);
    return {
      currentPrice: price,
      simulated: false,
      shouldTrigger: !!freshItem,
      displayValue: freshItem ? `New: "${freshItem.title}" — ${freshItem.publisher}` : 'no new articles since you created this alert'
    };
  } catch (err) {
    return { currentPrice: price, simulated: true, shouldTrigger: false, displayValue: 'news data temporarily unavailable', unavailable: true };
  }
}

// Simple keyword heuristic over REAL headlines — this is NOT true AI sentiment
// analysis (that needs an NLP model/paid API this app doesn't have). It's an
// honest, clearly-labeled approximation: count finance-relevant positive vs.
// negative words across real recent headlines for the symbol.
const POSITIVE_WORDS = ['surge', 'soar', 'beat', 'upgrade', 'bullish', 'rally', 'gain', 'record high', 'strong', 'jumps', 'outperform', 'breakthrough', 'buy rating', 'rises'];
const NEGATIVE_WORDS = ['plunge', 'miss', 'downgrade', 'bearish', 'crash', 'falls', 'weak', 'cut', 'lawsuit', 'probe', 'sell-off', 'slump', 'underperform', 'warns', 'drops'];

function scoreHeadline(title) {
  const t = title.toLowerCase();
  let score = 0;
  POSITIVE_WORDS.forEach((w) => { if (t.includes(w)) score += 1; });
  NEGATIVE_WORDS.forEach((w) => { if (t.includes(w)) score -= 1; });
  return score;
}

async function evaluateSentimentShift(alert) {
  const { price } = await getPriceWithFallback(alert.symbol);
  try {
    const news = await getNews(alert.symbol, 5);
    if (!news.length) {
      return { currentPrice: price, simulated: true, shouldTrigger: false, displayValue: 'no recent news to score', unavailable: true };
    }
    const netScore = news.reduce((sum, n) => sum + scoreHeadline(n.title), 0);
    const target = Number(alert.targetPrice);
    const shouldTrigger = alert.condition === 'above' ? netScore >= target : netScore <= -target;
    return {
      currentPrice: price,
      simulated: false,
      shouldTrigger,
      displayValue: `keyword sentiment score ${netScore} (heuristic, from ${news.length} real headlines — not AI sentiment)`
    };
  } catch (err) {
    return { currentPrice: price, simulated: true, shouldTrigger: false, displayValue: 'sentiment data temporarily unavailable', unavailable: true };
  }
}

// Real SEC EDGAR filing data — no API key, fires on the next actual 10-K/10-Q/8-K/etc.
// filed for this symbol after the alert was created.
async function evaluateFiling(alert) {
  const { price } = await getPriceWithFallback(alert.symbol);
  try {
    const filings = await getRecentFilings(alert.symbol, 5);
    const createdAt = new Date(alert.createdAt).getTime();
    const freshFiling = filings.find((f) => new Date(f.filingDate).getTime() > createdAt);
    return {
      currentPrice: price,
      simulated: false,
      shouldTrigger: !!freshFiling,
      displayValue: freshFiling
        ? `New SEC filing: ${freshFiling.form} filed ${freshFiling.filingDate}`
        : 'no new SEC filings since you created this alert'
    };
  } catch (err) {
    if (err.message === 'CIK_NOT_FOUND') {
      return { currentPrice: price, simulated: true, shouldTrigger: false, displayValue: 'SEC filing data not available for this symbol (may not be a US-listed company)', unavailable: true };
    }
    return { currentPrice: price, simulated: true, shouldTrigger: false, displayValue: 'SEC filing data temporarily unavailable', unavailable: true };
  }
}

async function evaluateAlert(alert, userId) {
  switch (alert.alertType) {
    case 'Price Threshold': return evaluatePriceThreshold(alert);
    case 'Volume Movement': return evaluateVolumeMovement(alert);
    case 'Sector Impact': return evaluateSectorImpact(alert);
    case 'Portfolio Relevance': return evaluatePortfolioRelevance(alert, userId);
    case 'News': return evaluateNews(alert);
    case 'Filing': return evaluateFiling(alert);
    case 'Sentiment Shift': return evaluateSentimentShift(alert);
    default: return null;
  }
}

// GET /api/alerts — list this user's alerts, auto-checking every monitored type against real data
router.get('/', requireAuth, async (req, res) => {
  try {
    const alerts = await db.listAlerts(req.user.id);

    const updated = await Promise.all(alerts.map(async (alert) => {
      const monitored = MONITORED_TYPES.includes(alert.alertType);

      if (!monitored) {
        const { price, simulated } = await getPriceWithFallback(alert.symbol);
        return { ...alert, currentPrice: price, simulated, monitored: false };
      }

      const evalResult = await evaluateAlert(alert, req.user.id);

      if (alert.status !== 'active') {
        return { ...alert, currentPrice: evalResult.currentPrice, simulated: evalResult.simulated, displayValue: evalResult.displayValue, monitored: true };
      }

      if (evalResult.shouldTrigger) {
        const triggeredAt = new Date().toISOString();
        await db.updateAlertStatus(alert.id, {
          status: 'triggered',
          lastCheckedPrice: evalResult.currentPrice,
          triggeredAt
        });
        try {
          await db.logAlertTrigger(req.user.id, {
            alertId: alert.id,
            symbol: alert.symbol,
            alertType: alert.alertType,
            priority: alert.priority,
            condition: alert.condition,
            targetPrice: alert.targetPrice,
            priceAtTrigger: evalResult.currentPrice,
            alertCreatedAt: alert.createdAt
          });
        } catch (e) {
          console.error('Failed to log alert trigger history (will self-heal via backfill):', e);
        }
        return { ...alert, status: 'triggered', currentPrice: evalResult.currentPrice, simulated: evalResult.simulated, displayValue: evalResult.displayValue, triggeredAt, monitored: true };
      }

      await db.updateAlertStatus(alert.id, {
        status: 'active',
        lastCheckedPrice: evalResult.currentPrice,
        triggeredAt: alert.triggeredAt || null
      });
      return { ...alert, currentPrice: evalResult.currentPrice, simulated: evalResult.simulated, displayValue: evalResult.displayValue, monitored: true };
    }));

    res.json({ alerts: updated });
  } catch (err) {
    console.error('List alerts error:', err);
    res.status(500).json({ error: 'Could not load alerts.' });
  }
});

// POST /api/alerts — create a new alert
// Shared validation for create + edit — returns { error } or { resolvedType, condToSave, priceToSave, isMonitoredType }
function validateAlertInput({ symbol, alertType, condition, targetPrice }) {
  if (!isValidSymbol(symbol)) {
    return { error: 'Please enter a valid stock symbol (e.g. AAPL, TSLA, NVDA).' };
  }
  if (alertType && !VALID_ALERT_TYPES.includes(alertType)) {
    return { error: 'Invalid alert type.' };
  }
  const resolvedType = alertType || 'Price Threshold';
  const isMonitoredType = MONITORED_TYPES.includes(resolvedType);
  const requiresTarget = TYPES_REQUIRING_TARGET.includes(resolvedType);

  let condToSave = 'above';
  let priceToSave = 0.01;

  if (requiresTarget) {
    if (!VALID_CONDITIONS.includes(condition)) {
      return { error: 'Condition must be "above" or "below".' };
    }
    const price = Number(targetPrice);
    if (!targetPrice || isNaN(price) || price <= 0) {
      return { error: 'Please enter a valid target value.' };
    }
    condToSave = condition;
    priceToSave = price;
  }

  return { resolvedType, condToSave, priceToSave, isMonitoredType };
}

router.post('/', requireAuth, async (req, res) => {
  try {
    const { symbol, alertType, priority, condition, targetPrice } = req.body;
    const validated = validateAlertInput({ symbol, alertType, condition, targetPrice });
    if (validated.error) return res.status(400).json({ error: validated.error });
    const { resolvedType, condToSave, priceToSave, isMonitoredType } = validated;

    const alert = await db.createAlert(req.user.id, {
      symbol: symbol.trim().toUpperCase(),
      alertType: resolvedType,
      priority: priority || 'Medium',
      condition: condToSave,
      targetPrice: priceToSave
    });

    const { price: currentPrice, simulated } = await getPriceWithFallback(alert.symbol);
    res.json({ alert: { ...alert, currentPrice, simulated, monitored: isMonitoredType } });
  } catch (err) {
    console.error('Create alert error:', err);
    res.status(500).json({ error: 'Could not create alert.' });
  }
});

// PUT /api/alerts/:id — edit an existing alert (only your own)
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { symbol, alertType, priority, condition, targetPrice } = req.body;
    const validated = validateAlertInput({ symbol, alertType, condition, targetPrice });
    if (validated.error) return res.status(400).json({ error: validated.error });
    const { resolvedType, condToSave, priceToSave, isMonitoredType } = validated;

    const alert = await db.updateAlert(req.user.id, req.params.id, {
      symbol: symbol.trim().toUpperCase(),
      alertType: resolvedType,
      priority: priority || 'Medium',
      condition: condToSave,
      targetPrice: priceToSave
    });

    if (!alert) {
      return res.status(404).json({ error: 'Alert not found.' });
    }

    const { price: currentPrice, simulated } = await getPriceWithFallback(alert.symbol);
    res.json({ alert: { ...alert, currentPrice, simulated, monitored: isMonitoredType } });
  } catch (err) {
    console.error('Edit alert error:', err);
    res.status(500).json({ error: 'Could not update alert.' });
  }
});

// DELETE /api/alerts/:id — remove an alert (only your own)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const deleted = await db.deleteAlert(req.user.id, req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Alert not found.' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Delete alert error:', err);
    res.status(500).json({ error: 'Could not delete alert.' });
  }
});


// GET /api/alerts/history — recent real trigger events, factual descriptions only (no invented reasoning)
router.get('/history', requireAuth, async (req, res) => {
  try {
    await db.backfillMissingTriggerHistory(req.user.id);
    const history = await db.listTriggerHistory(req.user.id, 10);
    res.json({ history });
  } catch (err) {
    console.error('Alert history error:', err);
    res.status(500).json({ error: 'Could not load alert history.' });
  }
});

// GET /api/alerts/insights — real aggregates computed from actual trigger history.
// Returns nulls (not fake numbers) for anything without enough data yet.
router.get('/insights', requireAuth, async (req, res) => {
  try {
    await db.backfillMissingTriggerHistory(req.user.id);
    const [mostActive, avgTimeToTriggerHours, history] = await Promise.all([
      db.getMostActiveSymbol(req.user.id),
      db.getAvgTimeToTriggerHours(req.user.id),
      db.listTriggerHistory(req.user.id, 50)
    ]);

    let signalAccuracy = null;
    let signalSampleSize = 0;
    if (history.length > 0) {
      const eligible = history.filter((h) => {
        const hoursSinceTrigger = (Date.now() - new Date(h.triggeredAt).getTime()) / 3600000;
        return hoursSinceTrigger >= 1;
      });
      // Only these types have a clean "did the signal hold" concept — News fires
      // once on a specific new article, so "still holds" doesn't apply the same way.
      const scorable = eligible.filter((h) => ['Price Threshold', 'Volume Movement', 'Sector Impact', 'Portfolio Relevance', 'Sentiment Shift'].includes(h.alertType));
      if (scorable.length > 0) {
        const results = await Promise.all(scorable.map(async (h) => {
          try {
            // Re-run this history entry's own alert type through its real evaluator,
            // using its original condition/target — correct per-type comparison
            // (price vs $, volume vs ratio, sector/portfolio/sentiment vs %/score).
            const pseudoAlert = { symbol: h.symbol, alertType: h.alertType, condition: h.condition, targetPrice: h.targetPrice, createdAt: h.alertCreatedAt };
            const evalResult = await evaluateAlert(pseudoAlert, req.user.id);
            return evalResult ? evalResult.shouldTrigger : null;
          } catch (err) {
            return null;
          }
        }));
        const valid = results.filter((r) => r !== null);
        signalSampleSize = valid.length;
        if (valid.length > 0) {
          signalAccuracy = Math.round((valid.filter(Boolean).length / valid.length) * 100);
        }
      }
    }

    res.json({
      mostActiveSymbol: mostActive ? mostActive.symbol : null,
      totalTriggers: history.length,
      avgTimeToTriggerHours,
      signalAccuracy,
      signalSampleSize
    });
  } catch (err) {
    console.error('Alert insights error:', err);
    res.status(500).json({ error: 'Could not load alert insights.' });
  }
});

// GET /api/alerts/portfolio-signals — automatic, real observations about your
// actual holdings. No configuration needed (unlike the rest of this page, which
// is manually-created alerts) — this is what genuinely "AI/automatic" means here.
// Deliberately observational, not directive: it never says buy/sell/hold — see
// the compliance note elsewhere in this app about why.
router.get('/portfolio-signals', requireAuth, async (req, res) => {
  try {
    const holdings = await db.listHoldings(req.user.id);
    if (holdings.length === 0) {
      return res.json({ signals: [], hasHoldings: false });
    }

    const enriched = await Promise.all(holdings.map(async (h) => {
      try {
        const q = await getRealQuote(h.symbol);
        return { symbol: h.symbol, changePercent: q.changePercent, price: q.price, simulated: false };
      } catch (err) {
        const mq = getMockQuote(h.symbol);
        return { symbol: h.symbol, changePercent: mq.changePercent, price: mq.price, simulated: true };
      }
    }));

    const ranked = [...enriched].sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));

    const signals = ranked.slice(0, 4).map((h) => {
      const abs = Math.abs(h.changePercent);
      const severity = abs >= 3 ? 'Critical' : abs >= 1 ? 'Notable' : 'Mild';
      const direction = h.changePercent >= 0 ? 'up' : 'down';
      const note = abs >= 1
        ? `$${h.symbol} is ${direction} ${abs}% today — worth a look at what's driving it.`
        : `$${h.symbol} is fairly flat today (${h.changePercent > 0 ? '+' : ''}${h.changePercent}%).`;
      return { symbol: h.symbol, changePercent: h.changePercent, price: h.price, severity, note, simulated: h.simulated };
    });

    res.json({ signals, hasHoldings: true });
  } catch (err) {
    console.error('Portfolio signals error:', err);
    res.status(500).json({ error: 'Could not load portfolio signals.' });
  }
});

module.exports = router;


