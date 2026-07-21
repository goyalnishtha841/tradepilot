const express = require('express');
const fetch = require('node-fetch');
const { requireAuth } = require('./auth');
const db = require('./db');
const { getRealQuote, getNews, getMarketMovers } = require('./yahoo-finance');
const { getMockQuote, getSectorForSymbol, LEGIT_SYMBOLS } = require('./mock-market');
const { COMPLIANCE_INSTRUCTION } = require('./compliance');
const { SECTOR_ETFS } = require('./sector-etfs');

const router = express.Router();
const GROQ_API_KEY = process.env.GROQ_API_KEY;

async function getQuoteWithFallback(symbol) {
  try {
    const quote = await getRealQuote(symbol);
    return { ...quote, sector: getSectorForSymbol(symbol), simulated: false };
  } catch (err) {
    console.warn(`Live quote failed for ${symbol} (${err.message}), using simulated quote.`);
    return getMockQuote(symbol);
  }
}

// GET /api/narrative/snapshot — real-time data for every widget on Today's Narrative
// EXCEPT the AI text (that's POST /). Sector performance, gainers/losers, and the
// financial-impact panel are computed live from Yahoo Finance quotes; nothing here is invented.
router.get('/snapshot', requireAuth, async (req, res) => {
  try {
    const [sectorResults, universeResults, holdings] = await Promise.all([
      Promise.all(SECTOR_ETFS.map(async (s) => {
        try {
          const q = await getRealQuote(s.symbol);
          return { ...s, changePercent: q.changePercent, simulated: false };
        } catch (err) {
          return { ...s, changePercent: getMockQuote(s.symbol).changePercent, simulated: true };
        }
      })),
      Promise.all(LEGIT_SYMBOLS.map(async ({ symbol, name }) => {
        try {
          const q = await getRealQuote(symbol);
          return { symbol, name, changePercent: q.changePercent, price: q.price, simulated: false };
        } catch (err) {
          const mq = getMockQuote(symbol);
          return { symbol, name, changePercent: mq.changePercent, price: mq.price, simulated: true };
        }
      })),
      db.listHoldings(req.user.id)
    ]);

    // Sector performance (real, from sector ETFs)
    const sectorPerformance = sectorResults.sort((a, b) => b.changePercent - a.changePercent);

    // Gainers / losers — try Yahoo's real market-wide screener first (genuinely
    // ranks the whole market, not a fixed list). Falls back to the small fixed
    // watchlist universe only if the screener endpoint is unavailable.
    let gainers, losers, moversScope;
    try {
      const [marketGainers, marketLosers] = await Promise.all([
        getMarketMovers('gainers', 5),
        getMarketMovers('losers', 5)
      ]);
      gainers = marketGainers.slice(0, 3).map((m) => ({ ...m, simulated: false }));
      losers = marketLosers.slice(0, 3).map((m) => ({ ...m, simulated: false }));
      moversScope = 'market-wide';
    } catch (err) {
      console.warn(`Market-wide movers unavailable (${err.message}), falling back to fixed universe.`);
      const sorted = [...universeResults].sort((a, b) => b.changePercent - a.changePercent);
      gainers = sorted.filter((s) => s.changePercent > 0).slice(0, 3);
      losers = sorted.filter((s) => s.changePercent < 0).slice(-3).reverse();
      moversScope = 'limited-universe';
    }

    // Direct financial impact (real, from the user's actual holdings)
    let directFinancialImpact = null;
    if (holdings.length > 0) {
      const enrichedHoldings = await Promise.all(holdings.map(async (h) => {
        const q = await getQuoteWithFallback(h.symbol);
        const dollarChange = Math.round(q.changeAbs * Number(h.quantity) * 100) / 100;
        return { symbol: h.symbol, dollarChange, changePercent: q.changePercent, simulated: q.simulated };
      }));
      const totalDollarChange = Math.round(enrichedHoldings.reduce((sum, h) => sum + h.dollarChange, 0) * 100) / 100;
      const movers = enrichedHoldings
        .sort((a, b) => Math.abs(b.dollarChange) - Math.abs(a.dollarChange))
        .slice(0, 3)
        .map((h) => ({
          symbol: h.symbol,
          dollarChange: h.dollarChange,
          changePercent: h.changePercent,
          severity: Math.abs(h.changePercent) >= 3 ? 'Critical' : Math.abs(h.changePercent) >= 1 ? 'Medium' : 'Low'
        }));
      directFinancialImpact = {
        totalDollarChange,
        movers,
        anySimulated: enrichedHoldings.some((h) => h.simulated)
      };
    }

    // Narrative feed (real recent news, from the user's own symbols where possible, else broad market)
    const newsSymbols = holdings.length > 0
      ? [...new Set(holdings.map((h) => h.symbol.trim().toUpperCase()))].slice(0, 3)
      : ['SPY', 'QQQ'];
    const newsResults = await Promise.all(
      newsSymbols.map(async (s) => {
        try {
          return await getNews(s, 2);
        } catch (err) {
          return [];
        }
      })
    );
    const narrativeFeed = newsResults
      .flat()
      .filter((n) => n.publishedAt)
      .sort((a, b) => b.publishedAt - a.publishedAt)
      .slice(0, 6);

    res.json({
      sectorPerformance,
      gainers,
      losers,
      moversScope,
      directFinancialImpact,
      narrativeFeed,
      generatedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('Narrative snapshot error:', err);
    res.status(500).json({ error: 'Could not load live market data for this page.' });
  }
});

// POST /api/narrative — generates today's personalized AI market narrative,
// grounded in the logged-in user's REAL watchlist + holdings quotes and
// REAL recent news (both pulled live from Yahoo Finance), not invented text.
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
    const allSymbols = [...new Set([...watchlistSymbols, ...holdingSymbols])];

    // Pull real quotes for every symbol the user actually tracks.
    const quoteEntries = await Promise.all(
      allSymbols.map(async (s) => [s, await getQuoteWithFallback(s)])
    );
    const quotesBySymbol = Object.fromEntries(quoteEntries);

    // Pull real recent news for up to 4 symbols (watchlist first, then holdings)
    // to keep the Groq prompt small and fast.
    const newsSymbols = [...new Set([...watchlistSymbols, ...holdingSymbols])].slice(0, 4);
    const newsEntries = await Promise.all(
      newsSymbols.map(async (s) => {
        try {
          const news = await getNews(s, 2);
          return [s, news];
        } catch (err) {
          console.warn(`News fetch failed for ${s}: ${err.message}`);
          return [s, []];
        }
      })
    );

    const anyLiveData = quoteEntries.some(([, q]) => !q.simulated);

    const formatQuote = (s) => {
      const q = quotesBySymbol[s];
      const sign = q.changePercent >= 0 ? '+' : '';
      return `${s}: $${q.price} (${sign}${q.changePercent}% today, sector: ${q.sector}${q.simulated ? ', SIMULATED — live feed unavailable' : ''})`;
    };

    const watchlistContext = watchlistSymbols.length
      ? watchlistSymbols.map(formatQuote).join('; ')
      : 'none — user has not added anything to their watchlist yet';

    const portfolioContext = holdingSymbols.length
      ? holdingSymbols.map(formatQuote).join('; ')
      : 'none — user has no tracked holdings yet';

    const newsContext = newsEntries
      .filter(([, news]) => news.length > 0)
      .map(([s, news]) => `${s}: ${news.map((n) => `"${n.title}" (${n.publisher})`).join('; ')}`)
      .join(' | ') || 'no recent symbol-specific news retrieved';

    const systemPrompt = `You are a financial news summarizer for a trading education app called TradePilot.
You will be given REAL, live data: current quotes and real recent news headlines for the user's tracked
symbols. Generate today's personalized market story using ONLY the facts provided below — do not invent
prices, percentages, or headlines that are not in the data given to you. If a data point is marked
SIMULATED, you may mention the price as an estimate but do not present it as a live market fact.
${COMPLIANCE_INSTRUCTION}

Respond ONLY with valid JSON (no markdown fences, no preamble), matching exactly this shape:
{
  "marketOverview": "2-3 sentences: summarize the overall tone across the user's tracked symbols today, based on the real quote data given",
  "sectorMovement": "1-2 sentences: which sector(s) among the user's holdings/watchlist moved and by how much, using the real change percentages given",
  "companyNews": "1-2 sentences: summarize one real, specific news headline from the news data given, naming the source",
  "watchlistEvents": "1-3 sentences: something notable today specifically about the user's watchlist symbols, grounded in the real quote/news data. If they have none, gently note that and suggest adding some.",
  "portfolioRelevance": "1-3 sentences: how today's real price movement connects to the user's actual holdings and gain/loss. If they have none, gently note that and suggest tracking a position on the Dashboard.",
  "plainLanguageExplanation": "1 short sentence defining one relevant finance term simply, format: \\"'Term' means ...\\""
}`;

    const userPrompt = `Live quotes — user's watchlist: ${watchlistContext}
Live quotes — user's portfolio holdings: ${portfolioContext}
Real recent news by symbol: ${newsContext}
Generate today's personalized market narrative for this user using only the facts above.`;

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
        temperature: 0.4,
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
      plainLanguageExplanation: parsed.plainLanguageExplanation || '',
      generatedAt: new Date().toISOString(),
      dataSource: anyLiveData ? 'live' : 'simulated-fallback'
    });
  } catch (err) {
    console.error('Narrative error:', err);
    res.status(500).json({ error: 'Something went wrong generating the narrative.' });
  }
});

module.exports = router;
