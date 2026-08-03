const express = require('express');
const db = require('./db');

const router = express.Router();

// GET /api/articles — Public endpoint for published articles
router.get('/', async (req, res) => {
  try {
    const { category, search, difficulty } = req.query;
    const articles = await db.getPublishedArticles({ category, search, difficulty });
    res.json({ articles });
  } catch (err) {
    console.error('Fetch articles error:', err);
    res.status(500).json({ error: 'Could not load articles.' });
  }
});

// GET /api/articles/slug/:slug — Fetch article by slug
router.get('/slug/:slug', async (req, res) => {
  try {
    const article = await db.getArticleBySlug(req.params.slug);
    if (!article || article.status !== 'published') {
      return res.status(404).json({ error: 'Article not found.' });
    }
    res.json({ article });
  } catch (err) {
    console.error('Fetch article error:', err);
    res.status(500).json({ error: 'Could not load article.' });
  }
});

// GET /api/articles/:id — Fetch article by ID
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid article ID.' });

    const article = await db.getArticleById(id);
    if (!article || article.status !== 'published') {
      return res.status(404).json({ error: 'Article not found.' });
    }
    res.json({ article });
  } catch (err) {
    console.error('Fetch article by ID error:', err);
    res.status(500).json({ error: 'Could not load article.' });
  }
});

module.exports = router;
