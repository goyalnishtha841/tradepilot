const fetch = require('node-fetch');
const { getRealQuote, getHistoricalData, getFundamentals, getNews } = require('./yahoo-finance');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

function safeParseJson(text) {
  // Strip markdown code fences if the model wraps its JSON in them
  const cleaned = text.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned);
}

function clamp(num, min, max) {
  if (typeof num !== 'number' || Number.isNaN(num)) return null;
  return Math.min(Math.max(num, min), max);
}

async function callGroq(prompt) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      max_tokens: 500,
      messages: [
        {
          role: 'system',
          content: 'You are a financial analysis assistant. You respond ONLY with a single valid JSON object and nothing else — no preamble, no markdown fences, no explanation outside the JSON.'
        },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!res.ok) {
    throw new Error(`Groq request failed: ${res.status}`);
  }

  const data = await res.json();
  const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) throw new Error('Groq returned no content');
  return safeParseJson(text);
}

async function getAIAnalysis(symbolRaw) {
  const symbol = symbolRaw.trim().toUpperCase();

  // Gather whatever real data we can. Each piece is optional — if one fails,
  // we still generate an analysis from whatever we do have, rather than failing entirely.
  const [quoteResult, chartResult, fundamentalsResult, newsResult] = await Promise.allSettled([
    getRealQuote(symbol),
    getHistoricalData(symbol, '1D'),
    getFundamentals(symbol),
    getNews(symbol, 1)
  ]);

  const quote = quoteResult.status === 'fulfilled' ? quoteResult.value : null;
  const chart = chartResult.status === 'fulfilled' ? chartResult.value : null;
  const fundamentals = fundamentalsResult.status === 'fulfilled' ? fundamentalsResult.value : null;
  const news = newsResult.status === 'fulfilled' ? newsResult.value : [];

  if (!quote) {
    throw new Error('SYMBOL_NOT_FOUND');
  }

  const facts = {
    symbol,
    price: quote.price,
    changePercent: quote.changePercent,
    rsi: chart ? chart.rsi : null,
    peRatio: fundamentals ? fundamentals.peRatio : null,
    revenueGrowth: fundamentals && fundamentals.revenueGrowth !== null ? Math.round(fundamentals.revenueGrowth * 1000) / 10 : null,
    grossMargin: fundamentals && fundamentals.grossMargin !== null && fundamentals.grossMargin > 0 ? Math.round(fundamentals.grossMargin * 1000) / 10 : null,
    sector: fundamentals ? (fundamentals.sector || fundamentals.industry) : null,
    topHeadline: news.length > 0 ? news[0].title : null
  };

  // Compute these deterministically ourselves — never trust the model to apply a fixed
  // numeric rule (like "30-70 is neutral") correctly and consistently across every field.
  const rsiBand = facts.rsi === null ? 'unavailable'
    : facts.rsi > 70 ? 'overbought'
    : facts.rsi < 30 ? 'oversold'
    : 'neutral';

  const prompt = `Analyze this real stock data for ${facts.symbol} and generate a JSON object with exactly these fields:

{
  "narrative": "2-3 sentence plain-language explanation of what's happening with this stock today, grounded ONLY in the facts below. Do not invent news events, product names, or catalysts that aren't in the data provided.",
  "confidence": integer 50-95 representing how much real data was available to base this on (more data = higher confidence),
  "bullPoint": "one short positive observation (under 8 words), grounded in the data, or 'No strong bullish signal today' if nothing supports it",
  "riskPoint": "one short risk/caution observation (under 10 words), grounded in the data, or 'No major risk flagged today' if nothing supports it",
  "moodPercent": integer 0-100 where 0 = extremely bearish, 50 = neutral, 100 = extremely bullish, based on the actual price move and RSI given,
  "moodDescription": "one sentence explaining the mood score, grounded in the data",
  "verdictScore": number 0-10 representing overall attractiveness given the real valuation/growth data (5 = neutral/hold),
  "verdictLabel": "one of: Overweight, Neutral, Underweight",
  "verdictDescription": "under 6 words, e.g. 'Recommended for Growth' or 'Hold and Monitor'"
}

Real data available (use ONLY this, do not fabricate anything else):
- Current price: $${facts.price}, change today: ${facts.changePercent}%
- RSI (14-day): ${facts.rsi !== null ? `${facts.rsi} (band: ${rsiBand})` : 'not available'}
- P/E ratio: ${facts.peRatio !== null ? facts.peRatio : 'not available'}
- Revenue growth: ${facts.revenueGrowth !== null ? facts.revenueGrowth + '%' : 'not available'}
- Gross margin: ${facts.grossMargin !== null ? facts.grossMargin + '%' : 'not meaningfully reported for this business type'}
- Sector: ${facts.sector || 'not available'}
- Most recent headline: ${facts.topHeadline || 'not available'}

STRICT RULES — follow these exactly, they override any other instinct:
- The RSI band has ALREADY been classified for you as: ${rsiBand.toUpperCase()}. Use this exact word ("neutral", "overbought", or "oversold") when describing RSI — never independently judge whether a number is "low" or "high" yourself. If the band is "neutral," never use the words overbought, oversold, "low RSI," or "high RSI" anywhere in your response.
- RSI measures price MOMENTUM only — never say it indicates "undervaluation," "overvaluation," or anything about fundamental value.
- If gross margin says "not meaningfully reported," you must say that (or similar honest wording) — never say "zero gross margin" or imply the margin is 0%, since unavailable and zero are not the same thing.
- Every claim must trace directly to a fact given above. If a data point is "not available," do not guess, estimate, or imply a value for it.
- Do NOT add generic industry/sector commentary, regulatory concerns, competitive dynamics, or business practices (e.g. "under scrutiny for X," "faces regulatory risk," "known for Y practice") unless that exact topic appears in the headline provided. Naming the sector (e.g. "Financial Services") is fine — inventing a narrative about what companies in that sector are doing or facing is not. If you have no headline-grounded reason for a risk point, use "No major risk flagged today" instead of inventing one.
Respond with ONLY the JSON object, no other text.`;

  const aiRaw = await callGroq(prompt);

  // Safety net: sanitize the model's text fields in case it ignores the rules above anyway.
  // We never rely solely on instruction-following for facts that have a deterministically correct answer.
  function sanitizeRSILanguage(text) {
    if (typeof text !== 'string') return text;
    if (rsiBand !== 'neutral') return text;
    return text
      .replace(/\b(low|high)\s+RSI\b/gi, 'neutral RSI')
      .replace(/indicating (a )?potential (overselling|oversold conditions?|pullback due to oversold conditions)/gi, 'with RSI in a neutral range')
      .replace(/\boverbought\b/gi, 'neutral')
      .replace(/\boversold\b/gi, 'neutral')
      .replace(/indicating (potential )?undervaluation/gi, 'in a neutral momentum range');
  }

  function sanitizeGrossMarginLanguage(text) {
    if (typeof text !== 'string') return text;
    if (facts.grossMargin !== null) return text;
    return text
      .replace(/zero gross margin/gi, 'gross margin not meaningfully reported for this business type')
      .replace(/0% gross margin/gi, 'gross margin not meaningfully reported for this business type')
      .replace(/no gross margin/gi, 'gross margin not meaningfully reported for this business type');
  }

  function sanitize(text) {
    return sanitizeGrossMarginLanguage(sanitizeRSILanguage(text));
  }

  return {
    narrative: sanitize(typeof aiRaw.narrative === 'string' ? aiRaw.narrative : `${symbol} is trading at $${facts.price}, ${facts.changePercent >= 0 ? 'up' : 'down'} ${Math.abs(facts.changePercent)}% today.`),
    confidence: clamp(aiRaw.confidence, 50, 95) || 60,
    bullPoint: sanitize(typeof aiRaw.bullPoint === 'string' ? aiRaw.bullPoint : 'No strong bullish signal today'),
    riskPoint: sanitize(typeof aiRaw.riskPoint === 'string' ? aiRaw.riskPoint : 'No major risk flagged today'),
    moodPercent: clamp(aiRaw.moodPercent, 0, 100) ?? 50,
    moodDescription: sanitize(typeof aiRaw.moodDescription === 'string' ? aiRaw.moodDescription : 'Sentiment is mixed based on available data.'),
    verdictScore: clamp(aiRaw.verdictScore, 0, 10) ?? 5,
    verdictLabel: ['Overweight', 'Neutral', 'Underweight'].includes(aiRaw.verdictLabel) ? aiRaw.verdictLabel : 'Neutral',
    verdictDescription: sanitize(typeof aiRaw.verdictDescription === 'string' ? aiRaw.verdictDescription : 'Hold and Monitor')
  };
}

module.exports = { getAIAnalysis };