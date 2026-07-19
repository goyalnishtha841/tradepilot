const express = require('express');
const fetch = require('node-fetch');
const { requireAuth } = require('./auth');
const db = require('./db');
const { getMockQuote } = require('./mock-market');
const { COMPLIANCE_INSTRUCTION } = require('./compliance');

const router = express.Router();
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// POST /api/narrative — generates today's personalized AI market narrative.
// Personalization comes from the logged-in user's real watchlist + holdings
// (pulled from the database), not just generic market content.
router.post('/', requireAuth, async (req, res) => {
  try {
    if (!GROQ_API_KEY) {
      return res.status(500).json({ error: 'Server is missing GROQ_API_KEY. Check server/.env' });
    }

    const [watchlist, holdings] = await Promise.all([
      db.listWatchlist(req.user.id),
      db.listHoldings(req.user.id)
    ]);

    const watchlistSymbols = watchlist.map((w) => w.symbol);
    const holdingSymbols = holdings.map((h) => h.symbol);

    const watchlistContext = watchlistSymbols.length
      ? watchlistSymbols.map((s) => `${s} (simulated price $${getMockQuote(s).price})`).join(', ')
      : 'none — user has not added anything to their watchlist yet';

    const portfolioContext = holdingSymbols.length
      ? holdingSymbols.map((s) => `${s} (simulated price $${getMockQuote(s).price})`).join(', ')
      : 'none — user has no tracked holdings yet';

    const systemPrompt = `You are a financial news summarizer for a trading education app called TradePilot.
Generate a plausible, realistic-sounding "today's personalized market story" for this specific user.
${COMPLIANCE_INSTRUCTION}

Respond ONLY with valid JSON (no markdown fences, no preamble), matching exactly this shape:
{
  "marketOverview": "2-3 sentences: broad market conditions today (indices, overall mood)",
  "sectorMovement": "1-2 sentences: which sector(s) moved and roughly how much",
  "companyNews": "1-2 sentences: a plausible specific company headline relevant to the sectors above",
  "watchlistEvents": "1-3 sentences: something notable today specifically about the user's watchlist symbols. If they have none, gently note that and suggest adding some.",
  "portfolioRelevance": "1-3 sentences: how today's narrative connects to the user's actual holdings. If they have none, gently note that and suggest tracking a position on the Dashboard.",
  "plainLanguageExplanation": "1 short sentence defining one relevant finance term simply, format: \\"'Term' means ...\\""
}
Keep it realistic in tone but you may invent plausible specifics (this is a demo app with simulated
prices, not real financial advice).`;

    const userPrompt = `User's watchlist symbols: ${watchlistContext}
User's portfolio holdings: ${portfolioContext}
Generate today's personalized market narrative for this user.`;

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.8,
        max_tokens: 600,
        response_format: { type: 'json_object' }
      })
    });

    if (!groqResponse.ok) {
      const errText = await groqResponse.text();
      console.error('Groq narrative error:', errText);
      return res.status(502).json({ error: 'Failed to generate narrative.' });
    }

    const data = await groqResponse.json();
    const raw = data.choices?.[0]?.message?.content || '{}';

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error('Could not parse narrative JSON:', raw);
      return res.status(502).json({ error: 'AI returned an unexpected format. Try again.' });
    }

    res.json({
      marketOverview: parsed.marketOverview || 'Markets were relatively quiet today.',
      sectorMovement: parsed.sectorMovement || 'No major sector rotation observed.',
      companyNews: parsed.companyNews || 'No standout company headlines today.',
      watchlistEvents: parsed.watchlistEvents || 'Add stocks to your watchlist to see personalized events here.',
      portfolioRelevance: parsed.portfolioRelevance || 'Track a position on your Dashboard to see personalized relevance here.',
      plainLanguageExplanation: parsed.plainLanguageExplanation || ''
    });
  } catch (err) {
    console.error('Narrative error:', err);
    res.status(500).json({ error: 'Something went wrong generating the narrative.' });
  }
});

module.exports = router;