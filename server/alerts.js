const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');
const { getMockPrice } = require('./mock-market');

const router = express.Router();

const VALID_CONDITIONS = ['above', 'below'];

function isValidSymbol(symbol) {
  return typeof symbol === 'string' && /^[A-Za-z]{1,6}$/.test(symbol.trim());
}

// GET /api/alerts — list this user's alerts, auto-checking each against the mock price
router.get('/', requireAuth, async (req, res) => {
  try {
    const alerts = await db.listAlerts(req.user.id);

    const updated = await Promise.all(alerts.map(async (alert) => {
      if (alert.status !== 'active') {
        return { ...alert, currentPrice: await getMockPrice(alert.symbol) };
      }

      const currentPrice = await getMockPrice(alert.symbol);
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
        return { ...alert, status: 'triggered', currentPrice, triggeredAt };
      }

      await db.updateAlertStatus(alert.id, {
        status: 'active',
        lastCheckedPrice: currentPrice,
        triggeredAt: alert.triggeredAt || null
      });
      return { ...alert, currentPrice };
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
      return res.status(400).json({ error: 'Please enter a valid stock symbol (letters only, e.g. AAPL).' });
    }
    if (!VALID_CONDITIONS.includes(condition)) {
      return res.status(400).json({ error: 'Condition must be "above" or "below".' });
    }
    const price = Number(targetPrice);
    if (!targetPrice || isNaN(price) || price <= 0) {
      return res.status(400).json({ error: 'Please enter a valid target price.' });
    }

    const alert = await db.createAlert(req.user.id, {
      symbol: symbol.trim().toUpperCase(),
      alertType: alertType || 'Price Target',
      priority: priority || 'Medium',
      condition,
      targetPrice: price
    });

    res.json({ alert: { ...alert, currentPrice: await getMockPrice(alert.symbol) } });
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
