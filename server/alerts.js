const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');
const { getRealQuote } = require('./yahoo-finance');
const { getMockPrice } = require('./mock-market');

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
// Only these types have a live data feed to check against right now.
// The rest are saved and displayed but not yet auto-evaluated — each would need
// its own real data pipeline (volume feed, filings feed, sentiment model, etc.)
// beyond real-time price, which is out of scope for this pass.
const MONITORED_TYPES = ['Price Threshold'];

function isValidSymbol(symbol) {
  return typeof symbol === 'string' && /^[A-Za-z.\-]{1,15}$/.test(symbol.trim());
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

// GET /api/alerts — list this user's alerts, auto-checking monitored types against real-time price
router.get('/', requireAuth, async (req, res) => {
  try {
    const alerts = await db.listAlerts(req.user.id);

    const updated = await Promise.all(alerts.map(async (alert) => {
      const { price: currentPrice, simulated } = await getPriceWithFallback(alert.symbol);
      const monitored = MONITORED_TYPES.includes(alert.alertType);

      if (!monitored || alert.status !== 'active') {
        return { ...alert, currentPrice, simulated, monitored };
      }

      const target = Number(alert.targetPrice);
      const shouldTrigger =
        (alert.condition === 'above' && currentPrice >= target) ||
        (alert.condition === 'below' && currentPrice <= target);

      if (shouldTrigger) {
        const triggeredAt = new Date().toISOString();
        await db.updateAlertStatus(alert.id, {
          status: 'triggered',
          lastCheckedPrice: currentPrice,
          triggeredAt
        });
        return { ...alert, status: 'triggered', currentPrice, simulated, triggeredAt, monitored: true };
      }

      await db.updateAlertStatus(alert.id, {
        status: 'active',
        lastCheckedPrice: currentPrice,
        triggeredAt: alert.triggeredAt || null
      });
      return { ...alert, currentPrice, simulated, monitored: true };
    }));

    res.json({ alerts: updated });
  } catch (err) {
    console.error('List alerts error:', err);
    res.status(500).json({ error: 'Could not load alerts.' });
  }
});

// POST /api/alerts — create a new alert
router.post('/', requireAuth, async (req, res) => {
  try {
    const { symbol, alertType, priority, condition, targetPrice } = req.body;

    if (!isValidSymbol(symbol)) {
      return res.status(400).json({ error: 'Please enter a valid stock symbol (e.g. AAPL, TSLA, NVDA).' });
    }
    if (alertType && !VALID_ALERT_TYPES.includes(alertType)) {
      return res.status(400).json({ error: 'Invalid alert type.' });
    }
    const isMonitoredType = MONITORED_TYPES.includes(alertType || 'Price Threshold');

    let condToSave = 'above';
    let priceToSave = 0.01;

    if (isMonitoredType) {
      if (!VALID_CONDITIONS.includes(condition)) {
        return res.status(400).json({ error: 'Condition must be "above" or "below".' });
      }
      const price = Number(targetPrice);
      if (!targetPrice || isNaN(price) || price <= 0) {
        return res.status(400).json({ error: 'Please enter a valid target price.' });
      }
      condToSave = condition;
      priceToSave = price;
    }

    const alert = await db.createAlert(req.user.id, {
      symbol: symbol.trim().toUpperCase(),
      alertType: alertType || 'Price Threshold',
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

module.exports = router;
