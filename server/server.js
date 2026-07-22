require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const { router: authRouter, requireAuth } = require('./auth');
const onboardingRouter = require('./onboarding');
const alertsRouter = require('./alerts');
const narrativeRouter = require('./narrative');
const quizRouter = require('./quiz');
const portfolioRouter = require('./portfolio');
const watchlistRouter = require('./watchlist');
const marketRouter = require('./market');
const papertradingRouter = require('./papertrading');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/onboarding', onboardingRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/narrative', narrativeRouter);
app.use('/api/quiz', quizRouter);
app.use('/api/portfolio', portfolioRouter);
app.use('/api/watchlist', watchlistRouter);
app.use('/api/market', marketRouter);
app.use('/api/papertrading', papertradingRouter);
app.use('/api/news', require('./news'));

// Middleware to redirect direct .html requests to clean paths
app.use((req, res, next) => {
  if (req.path.endsWith('.html') && req.method === 'GET') {
    const query = req.url.slice(req.path.length);
    const cleanPath = req.path.slice(0, -5);
    return res.redirect(301, cleanPath + query);
  }
  next();
});

// Serve the static frontend files
app.use(express.static(path.join(__dirname, '..')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../home.html'));
});

// Route handlers for clean paths
const cleanPages = [
  'home',
  'dashboard',
  'explore',
  'alerts',
  'learn',
  'today',
  'settings',
  'signin',
  'signup',
  'onboarding'
];

cleanPages.forEach(page => {
  app.get(`/${page}`, (req, res) => {
    res.sendFile(path.join(__dirname, `../${page}.html`));
  });
});

// GET /api/chat/history — load this user's past AI Mentor conversation
app.get('/api/chat/history', requireAuth, async (req, res) => {
  try {
    const history = await db.getChatHistory(req.user.id);
    res.json({ history });
  } catch (err) {
    console.error('Chat history error:', err);
    res.status(500).json({ error: 'Could not load chat history.' });
  }
});

// POST /api/chat
app.post('/api/chat', requireAuth, async (req, res) => {
  try {
    const { message, context } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Missing "message" in request body' });
    }

    if (!GROQ_API_KEY) {
      return res.status(500).json({ error: 'Server is missing GROQ_API_KEY. Check server/.env' });
    }

    const systemPrompt = `You are TradePilot AI Mentor, a friendly and knowledgeable finance mentor inside a trading/investing education app.
Explain concepts clearly and simply, like a patient mentor. Keep answers concise (3-6 sentences unless the user asks for more detail).
When relevant, use plain-language analogies. You are not a licensed financial advisor, so avoid giving direct "buy/sell" instructions -
instead help the user understand the reasoning, risks, and how to think about the decision themselves.
${context ? `\n\nContext about what the user is currently looking at: ${context}` : ''}`;

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
          { role: 'user', content: message }
        ],
        temperature: 0.7,
        max_tokens: 500
      })
    });

    if (!groqResponse.ok) {
      const errText = await groqResponse.text();
      console.error('Groq API error:', errText);
      return res.status(502).json({ error: 'Groq API request failed', details: errText });
    }

    const data = await groqResponse.json();
    const reply = data.choices?.[0]?.message?.content || 'Sorry, I could not generate a response.';

    db.saveChatMessage(req.user.id, 'user', message).catch(e => console.error('Save chat (user) failed:', e));
    db.saveChatMessage(req.user.id, 'assistant', reply).catch(e => console.error('Save chat (assistant) failed:', e));

    res.json({ reply });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Something went wrong on the server', details: err.message });
  }
});

function listenOnPort(port, attempt = 1) {
  const server = app.listen(port, () => {
    console.log(`\n✅ TradePilot server running!`);
    console.log(`   Open this in your browser: http://localhost:${port}/home.html\n`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < 5) {
      const nextPort = port + 1;
      console.warn(`Port ${port} is busy. Trying ${nextPort} instead...`);
      server.close(() => listenOnPort(nextPort, attempt + 1));
    } else {
      console.error('Failed to start server:', err);
      process.exit(1);
    }
  });
}

async function start() {
  try {
    await db.init();
  } catch (err) {
    console.error('\n❌ Could not connect to the database.');
    console.error('   Check DATABASE_URL in server/.env — see README.md for setup steps.');
    console.error('   Error details:', err.message, '\n');
    process.exit(1);
  }

  listenOnPort(PORT);
}

start();