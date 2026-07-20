const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');

const router = express.Router();

// GET /api/onboarding - fetch existing preferences
router.get('/', requireAuth, async (req, res) => {
  try {
    const prefs = await db.getUserPreferences(req.user.id);
    res.json({ preferences: prefs || {} });
  } catch (err) {
    console.error('Get onboarding preferences error:', err);
    res.status(500).json({ error: 'Could not load preferences.' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const {
      experienceLevel,
      goals,
      watchlist,
      portfolio,
      sectors,
      riskPreference,
      learningPreference,
      userType
    } = req.body;

    // 1. Save preferences
    const formattedLearningPref = Array.isArray(learningPreference)
      ? learningPreference.join(', ')
      : (learningPreference || '');

    await db.saveUserPreferences(req.user.id, {
      experienceLevel,
      userType,
      riskPreference,
      learningPreference: formattedLearningPref,
      goals: goals || [],
      favoriteSectors: sectors || []
    });

    // 2. Save watchlist
    if (Array.isArray(watchlist)) {
      for (const symbol of watchlist) {
        if (typeof symbol === 'string' && symbol.trim()) {
          await db.addToWatchlist(req.user.id, symbol.trim().toUpperCase());
        }
      }
    }

    // 3. Save portfolio
    if (Array.isArray(portfolio)) {
      for (const holding of portfolio) {
        if (holding.symbol && Number(holding.quantity) > 0 && Number(holding.avgCost) > 0) {
          await db.createHolding(req.user.id, {
            symbol: holding.symbol.trim().toUpperCase(),
            quantity: Number(holding.quantity),
            avgCost: Number(holding.avgCost)
          });
        }
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Onboarding submission error:', err);
    res.status(500).json({ error: 'Could not save onboarding profile.' });
  }
});

module.exports = router;
