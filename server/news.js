const express = require('express');
const { requireAuth } = require('./auth');
const newsService = require('./news-service');

const router = express.Router();

router.get('/market-headlines', requireAuth, async (req, res) => {
  try {
    const data = await newsService.getMarketHeadlines();
    res.json(data);
  } catch (err) {
    console.error('Market headlines error:', err.message);
    res.status(503).json({ error: 'Market headlines temporarily unavailable' });
  }
});

module.exports = router;
