// Postgres-backed user database (works with Supabase, or any Postgres instance).
// All teammates point DATABASE_URL at the same shared database so everyone
// sees the same accounts and data.
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error(
    '\n❌ Missing DATABASE_URL in server/.env\n' +
    '   Get this from your Supabase project: Settings → Database → Connection string (URI).\n' +
    '   See README.md for full setup steps.\n'
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false }
});

// Creates all tables if they don't exist yet. Safe to run every startup.
async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  // Added for the profile page: phone number (optional) and a preset avatar choice.
  // IF NOT EXISTS makes this safe to run against the existing shared database —
  // it won't error out for teammates who already have the users table.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_id TEXT NOT NULL DEFAULT 'slate';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS articles (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      content TEXT NOT NULL,
      category TEXT NOT NULL,
      tags TEXT[] DEFAULT '{}',
      author TEXT DEFAULT 'TradePilot Team',
      reading_time_min INTEGER DEFAULT 5,
      difficulty TEXT DEFAULT 'Beginner',
      featured_image TEXT,
      status TEXT DEFAULT 'draft',
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      published_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS quizzes (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL,
      difficulty TEXT DEFAULT 'Beginner',
      passing_score INTEGER DEFAULT 70,
      status TEXT DEFAULT 'draft',
      questions JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS alerts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL,
      alert_type TEXT NOT NULL DEFAULT 'Price Target',
      priority TEXT NOT NULL DEFAULT 'Medium',
      condition TEXT NOT NULL DEFAULT 'above',
      target_price NUMERIC NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      last_checked_price NUMERIC,
      triggered_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS alert_trigger_history (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      alert_id INTEGER REFERENCES alerts(id) ON DELETE SET NULL,
      symbol TEXT NOT NULL,
      alert_type TEXT NOT NULL,
      priority TEXT NOT NULL,
      condition TEXT NOT NULL,
      target_price NUMERIC NOT NULL,
      price_at_trigger NUMERIC NOT NULL,
      alert_created_at TIMESTAMPTZ NOT NULL,
      triggered_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS quiz_attempts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      score INTEGER NOT NULL,
      total INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS holdings (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL,
      quantity NUMERIC NOT NULL,
      avg_cost NUMERIC NOT NULL,
      currency TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE holdings ADD COLUMN IF NOT EXISTS currency TEXT;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS watchlist (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(user_id, symbol)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      id SERIAL PRIMARY KEY,
      user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      experience_level TEXT,
      user_type TEXT,
      risk_preference TEXT,
      learning_preference TEXT,
      goals TEXT[],
      favorite_sectors TEXT[],
      base_currency TEXT DEFAULT 'INR',
      onboarding_completed BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS base_currency TEXT DEFAULT 'INR';`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS portfolio_news (
      id SERIAL PRIMARY KEY,
      symbol TEXT,
      title TEXT,
      description TEXT,
      url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS watchlist_news (
      id SERIAL PRIMARY KEY,
      symbol TEXT,
      title TEXT,
      description TEXT,
      url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS paper_trading_state (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      state JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await seedInitialData();

  console.log('✅ Connected to database, all tables ready.');
}

async function findByEmail(email) {
  const { rows } = await pool.query(
    `SELECT id, name, email, password_hash AS "passwordHash", phone, avatar_id AS "avatarId",
            role, status, last_login AS "lastLogin", created_at AS "createdAt"
     FROM users WHERE LOWER(email) = LOWER($1)`,
    [email]
  );
  return rows[0] || null;
}

async function createUser({ name, email, passwordHash, role = 'user', status = 'approved' }) {
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, password_hash, role, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, email, password_hash AS "passwordHash", role, status, created_at AS "createdAt"`,
    [name, email, passwordHash, role, status]
  );
  return rows[0];
}

async function seedInitialData() {
  const { rows: artCount } = await pool.query(`SELECT COUNT(*) FROM articles`);
  if (parseInt(artCount[0].count, 10) === 0) {
    const seedArticles = [
      {
        title: 'Introduction to Stock Markets & Exchanges',
        slug: 'intro-stock-markets',
        description: 'Understand how public stock exchanges work, order matching, market participants, and equity ownership.',
        content: `### What is a Stock Market?\nA stock market is an aggregation of buyers and sellers of stocks (also called shares), which represent ownership claims on businesses.\n\n### Primary vs Secondary Market\n- **Primary Market:** Companies raise capital by issuing new shares through an Initial Public Offering (IPO).\n- **Secondary Market:** Investors trade existing securities among themselves on stock exchanges such as the NYSE or NASDAQ.\n\n### How Stock Prices Change\nPrices fluctuate based on supply and demand dynamics, company financial reports, macroeconomic news, and market sentiment. Understanding order books and liquidity helps you execute trades effectively.`,
        category: 'Stock Market Basics',
        tags: ['basics', 'stocks', 'exchanges'],
        author: 'TradePilot Team',
        reading_time_min: 6,
        difficulty: 'Beginner',
        featured_image: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&auto=format&fit=crop&q=60',
        status: 'published'
      },
      {
        title: 'Reading Candlestick Patterns Like a Pro',
        slug: 'reading-candlestick-patterns',
        description: 'Master Japanese candlesticks, bullish and bearish engulfing patterns, hammers, and doji signals.',
        content: `### Understanding a Candlestick\nEach candlestick represents price movement over a specific timeframe (e.g. 1 day, 1 hour).\n- **Body:** Represents the open and close price range.\n- **Wicks (Shadows):** Show high and low prices reached during the period.\n- **Color:** Green indicates price closed higher than open; Red indicates price closed lower.\n\n### Top Reversal Patterns\n1. **Bullish Engulfing:** A large green candle completely engulfs the body of the preceding red candle, signaling buyers taking control.\n2. **Hammer:** A small body at the top with a long lower wick, indicating rejection of lower prices.\n3. **Doji:** Open and close prices are nearly identical, representing market indecision before a potential breakout.`,
        category: 'Technical Analysis',
        tags: ['candlesticks', 'charts', 'patterns'],
        author: 'Chief Market Analyst',
        reading_time_min: 8,
        difficulty: 'Intermediate',
        featured_image: 'https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?w=800&auto=format&fit=crop&q=60',
        status: 'published'
      },
      {
        title: 'Fundamental Analysis: Valuation & P/E Ratios',
        slug: 'fundamental-analysis-pe-ratios',
        description: 'Learn how to evaluate corporate earnings, balance sheet debt, and price-to-earnings ratios before buying.',
        content: `### What is Fundamental Analysis?\nFundamental analysis involves evaluating a company's financial statements, market position, management team, and industry environment to determine its intrinsic value.\n\n### Key Financial Metrics\n- **P/E Ratio (Price-to-Earnings):** Compares current share price to earnings per share. High P/E suggests high growth expectations or overvaluation.\n- **P/B Ratio (Price-to-Book):** Compares market value to net asset value.\n- **Debt-to-Equity:** Measures financial leverage and solvency risk.\n- **Free Cash Flow (FCF):** Cash generated after capital expenditures, vital for business resilience.`,
        category: 'Fundamental Analysis',
        tags: ['valuation', 'earnings', 'pe-ratio'],
        author: 'TradePilot Research',
        reading_time_min: 10,
        difficulty: 'Intermediate',
        featured_image: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=800&auto=format&fit=crop&q=60',
        status: 'published'
      },
      {
        title: 'Options Trading Fundamentals: Calls, Puts & Greeks',
        slug: 'options-trading-fundamentals',
        description: 'Discover how options work, understanding strike prices, exercise rights, and Option Greeks (Delta, Theta, Implied Volatility).',
        content: `### What is an Option?\nAn option is a financial derivative contract giving the buyer the right, but not the obligation, to buy (Call) or sell (Put) an underlying asset at a specified strike price before expiration.\n\n### The Option Greeks\n- **Delta (\u0394):** Sensitivity of option price to $1 change in underlying asset.\n- **Theta (\u0398):** Daily time decay rate of option premium.\n- **Vega:** Sensitivity to changes in implied volatility (IV).\n- **Gamma (\u0393):** Rate of change of Delta.`,
        category: 'Options & Derivatives',
        tags: ['options', 'derivatives', 'greeks'],
        author: 'Senior Options Trader',
        reading_time_min: 12,
        difficulty: 'Advanced',
        featured_image: 'https://images.unsplash.com/photo-1642543492481-44e81e3914a7?w=800&auto=format&fit=crop&q=60',
        status: 'published'
      },
      {
        title: 'Risk Management & Position Sizing Strategy',
        slug: 'risk-management-position-sizing',
        description: 'Protect your trading capital with the 1% risk rule, stop-loss placement, and risk-to-reward ratios.',
        content: `### The Core Rule of Capital Preservation\nNever risk more than 1% to 2% of total equity on any single trade.\n\n### Calculating Position Size\nPosition Size = (Account Capital \u00d7 Risk %) / (Entry Price - Stop Loss Price)\n\n### Risk-to-Reward Ratio (R:R)\nAim for trades with at least 1:2 R:R. This means even with a 40% win rate, your strategy remains profitable over time.`,
        category: 'Trading Psychology',
        tags: ['risk', 'psychology', 'position-sizing'],
        author: 'TradePilot Risk Officer',
        reading_time_min: 5,
        difficulty: 'Beginner',
        featured_image: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?w=800&auto=format&fit=crop&q=60',
        status: 'published'
      }
    ];

    for (const art of seedArticles) {
      await pool.query(
        `INSERT INTO articles (title, slug, description, content, category, tags, author, reading_time_min, difficulty, featured_image, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (slug) DO NOTHING`,
        [art.title, art.slug, art.description, art.content, art.category, art.tags, art.author, art.reading_time_min, art.difficulty, art.featured_image, art.status]
      );
    }
  }

  const { rows: quizCount } = await pool.query(`SELECT COUNT(*) FROM quizzes`);
  if (parseInt(quizCount[0].count, 10) === 0) {
    const seedQuizzes = [
      {
        title: 'Stock Market Foundations Quiz',
        description: 'Test your knowledge on market basics, exchanges, order types, and stock dividends.',
        category: 'Stock Market Basics',
        difficulty: 'Beginner',
        passing_score: 70,
        status: 'published',
        questions: [
          {
            question: "What happens in a company's Initial Public Offering (IPO)?",
            type: "single",
            options: [
              "The company buys back all shares from private investors",
              "The company sells its shares to the public for the first time",
              "The company merges with a competitor",
              "The company declares bankruptcy"
            ],
            correctIndex: 1,
            explanation: "An IPO is the first time a private corporation issues shares to the public on an exchange."
          },
          {
            question: "What does 'liquidity' refer to in financial markets?",
            type: "single",
            options: [
              "How quickly an asset can be converted to cash without significantly affecting price",
              "The amount of cash a company holds on its balance sheet",
              "The interest rate on central bank loans",
              "The total dividend paid to shareholders"
            ],
            correctIndex: 0,
            explanation: "High liquidity means plenty of buyers and sellers exist, ensuring narrow bid-ask spreads."
          },
          {
            question: "True or False: A Market Order guarantees the exact price at which your order will execute.",
            type: "single",
            options: ["True", "False"],
            correctIndex: 1,
            explanation: "False! A Market Order guarantees immediate execution, but the price can slip if liquidity is thin."
          },
          {
            question: "What is a 'Dividend'?",
            type: "single",
            options: [
              "A fee paid to stockbrokers for placing trades",
              "A portion of company profits distributed to eligible shareholders",
              "A tax levied on short-term trading gains",
              "The difference between bid and ask prices"
            ],
            correctIndex: 1,
            explanation: "Dividends are cash payments or stock distributions made by companies to reward shareholders."
          }
        ]
      },
      {
        title: 'Technical Analysis & Indicators Master Quiz',
        description: 'Evaluate your understanding of candlesticks, RSI, MACD, and trend reversal setups.',
        category: 'Technical Analysis',
        difficulty: 'Intermediate',
        passing_score: 75,
        status: 'published',
        questions: [
          {
            question: "What does a Relative Strength Index (RSI) reading above 70 typically indicate?",
            type: "single",
            options: [
              "The asset is severely undervalued",
              "The asset may be in overbought territory",
              "Volume is dropping rapidly",
              "The company is declaring a dividend"
            ],
            correctIndex: 1,
            explanation: "An RSI > 70 generally signals overbought conditions, suggesting potential pullbacks."
          },
          {
            question: "What technical event is known as a 'Death Cross'?",
            type: "single",
            options: [
              "When the 50-day moving average crosses below the 200-day moving average",
              "When stock price reaches zero",
              "When trading volume reaches a 52-week low",
              "When a company reports negative net income"
            ],
            correctIndex: 0,
            explanation: "A Death Cross occurs when a short-term moving average crosses below a major long-term moving average."
          },
          {
            question: "What does a long lower wick on a candlestick indicate?",
            type: "single",
            options: [
              "Sellers dominated the entire session",
              "Buyers rejected lower prices and drove price back up",
              "No trading occurred during that timeframe",
              "Future earnings will be negative"
            ],
            correctIndex: 1,
            explanation: "A long lower wick shows that sellers initially pushed price down, but aggressive buying demand pushed it back up."
          }
        ]
      }
    ];

    for (const q of seedQuizzes) {
      await pool.query(
        `INSERT INTO quizzes (title, description, category, difficulty, passing_score, status, questions)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [q.title, q.description, q.category, q.difficulty, q.passing_score, q.status, JSON.stringify(q.questions)]
      );
    }
  }
}

module.exports = {
  init,
  findByEmail,
  createUser,
  pool,

  // --- Paper Trading State ---
  async getPaperTradingState(userId) {
    const { rows } = await pool.query(
      `SELECT state FROM paper_trading_state WHERE user_id = $1`,
      [userId]
    );
    return rows[0]?.state || null;
  },

  async savePaperTradingState(userId, state) {
    await pool.query(
      `INSERT INTO paper_trading_state (user_id, state, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET state = $2, updated_at = now()`,
      [userId, JSON.stringify(state)]
    );
  },

  // --- Alerts ---
  async listAlerts(userId) {
    const { rows } = await pool.query(
      `SELECT id, symbol, alert_type AS "alertType", priority, condition,
              target_price AS "targetPrice", status, last_checked_price AS "lastCheckedPrice",
              triggered_at AS "triggeredAt", created_at AS "createdAt"
       FROM alerts WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return rows;
  },

  async createAlert(userId, { symbol, alertType, priority, condition, targetPrice }) {
    const { rows } = await pool.query(
      `INSERT INTO alerts (user_id, symbol, alert_type, priority, condition, target_price)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, symbol, alert_type AS "alertType", priority, condition,
                 target_price AS "targetPrice", status, created_at AS "createdAt"`,
      [userId, symbol, alertType, priority, condition, targetPrice]
    );
    return rows[0];
  },

  async updateAlertStatus(alertId, { status, lastCheckedPrice, triggeredAt }) {
    await pool.query(
      `UPDATE alerts SET status = $1, last_checked_price = $2, triggered_at = $3 WHERE id = $4`,
      [status, lastCheckedPrice, triggeredAt, alertId]
    );
  },

  // Editing an alert resets it to 'active' with no trigger history, since the
  // thing being monitored has changed — a stale "triggered" status from before
  // the edit wouldn't mean anything about the new condition.
  async updateAlert(userId, alertId, { symbol, alertType, priority, condition, targetPrice }) {
    const { rows } = await pool.query(
      `UPDATE alerts
       SET symbol = $1, alert_type = $2, priority = $3, condition = $4, target_price = $5,
           status = 'active', last_checked_price = NULL, triggered_at = NULL
       WHERE id = $6 AND user_id = $7
       RETURNING id, symbol, alert_type AS "alertType", priority, condition,
                 target_price AS "targetPrice", status, created_at AS "createdAt"`,
      [symbol, alertType, priority, condition, targetPrice, alertId, userId]
    );
    return rows[0] || null;
  },

  async deleteAlert(userId, alertId) {
    const { rowCount } = await pool.query(
      `DELETE FROM alerts WHERE id = $1 AND user_id = $2`,
      [alertId, userId]
    );
    return rowCount > 0;
  },

  // --- Alert trigger history (real, logged once per trigger event) ---
  async logAlertTrigger(userId, { alertId, symbol, alertType, priority, condition, targetPrice, priceAtTrigger, alertCreatedAt }) {
    await pool.query(
      `INSERT INTO alert_trigger_history
         (user_id, alert_id, symbol, alert_type, priority, condition, target_price, price_at_trigger, alert_created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [userId, alertId, symbol, alertType, priority, condition, targetPrice, priceAtTrigger, alertCreatedAt]
    );
  },

  async listTriggerHistory(userId, limit = 10) {
    const { rows } = await pool.query(
      `SELECT id, alert_id AS "alertId", symbol, alert_type AS "alertType", priority, condition,
              target_price AS "targetPrice", price_at_trigger AS "priceAtTrigger",
              alert_created_at AS "alertCreatedAt", triggered_at AS "triggeredAt"
       FROM alert_trigger_history WHERE user_id = $1 ORDER BY triggered_at DESC LIMIT $2`,
      [userId, limit]
    );
    return rows;
  },

  async getMostActiveSymbol(userId) {
    const { rows } = await pool.query(
      `SELECT symbol, COUNT(*) AS count FROM alert_trigger_history
       WHERE user_id = $1 GROUP BY symbol ORDER BY count DESC LIMIT 1`,
      [userId]
    );
    return rows[0] || null;
  },

  async getAvgTimeToTriggerHours(userId) {
    const { rows } = await pool.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (triggered_at - alert_created_at)) / 3600.0) AS avg_hours
       FROM alert_trigger_history WHERE user_id = $1`,
      [userId]
    );
    const avg = rows[0] && rows[0].avg_hours;
    return avg != null ? Math.round(Number(avg) * 10) / 10 : null;
  },

  // Self-healing: any alert whose status is 'triggered' but has no matching row in
  // alert_trigger_history (e.g. the original fire-and-forget insert failed) gets
  // backfilled here using the data already on the alert itself. Safe to call repeatedly.
  async backfillMissingTriggerHistory(userId) {
    const { rows: missing } = await pool.query(
      `SELECT a.id, a.symbol, a.alert_type, a.priority, a.condition, a.target_price,
              a.last_checked_price, a.created_at, a.triggered_at
       FROM alerts a
       WHERE a.user_id = $1 AND a.status = 'triggered' AND a.triggered_at IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM alert_trigger_history h WHERE h.alert_id = a.id
         )`,
      [userId]
    );

    for (const row of missing) {
      await pool.query(
        `INSERT INTO alert_trigger_history
           (user_id, alert_id, symbol, alert_type, priority, condition, target_price, price_at_trigger, alert_created_at, triggered_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          userId, row.id, row.symbol, row.alert_type, row.priority, row.condition,
          row.target_price, row.last_checked_price || row.target_price, row.created_at, row.triggered_at
        ]
      );
    }
  },

  // --- Chat history ---
  async getChatHistory(userId, limit = 30) {
    const { rows } = await pool.query(
      `SELECT role, content, created_at AS "createdAt"
       FROM chat_messages WHERE user_id = $1 ORDER BY created_at ASC LIMIT $2`,
      [userId, limit]
    );
    return rows;
  },

  async saveChatMessage(userId, role, content) {
    await pool.query(
      `INSERT INTO chat_messages (user_id, role, content) VALUES ($1, $2, $3)`,
      [userId, role, content]
    );
  },

  // --- Quiz attempts ---
  async saveQuizAttempt(userId, score, total) {
    const { rows } = await pool.query(
      `INSERT INTO quiz_attempts (user_id, score, total) VALUES ($1, $2, $3)
       RETURNING id, score, total, created_at AS "createdAt"`,
      [userId, score, total]
    );
    return rows[0];
  },

  async getBestQuizAttempt(userId) {
    const { rows } = await pool.query(
      `SELECT score, total, created_at AS "createdAt" FROM quiz_attempts
       WHERE user_id = $1 ORDER BY score DESC, created_at DESC LIMIT 1`,
      [userId]
    );
    return rows[0] || null;
  },

  // --- Holdings (portfolio) ---
  async listHoldings(userId) {
    const { rows } = await pool.query(
      `SELECT id, symbol, quantity, avg_cost AS "avgCost", currency, created_at AS "createdAt"
       FROM holdings WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return rows;
  },

  async createHolding(userId, { symbol, quantity, avgCost, currency }) {
    const { rows } = await pool.query(
      `INSERT INTO holdings (user_id, symbol, quantity, avg_cost, currency)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, symbol, quantity, avg_cost AS "avgCost", currency, created_at AS "createdAt"`,
      [userId, symbol, quantity, avgCost, currency || null]
    );
    return rows[0];
  },

  async deleteHolding(userId, holdingId) {
    const { rowCount } = await pool.query(
      `DELETE FROM holdings WHERE id = $1 AND user_id = $2`,
      [holdingId, userId]
    );
    return rowCount > 0;
  },

  async updateHolding(userId, holdingId, { quantity, avgCost, currency }) {
    const { rows } = await pool.query(
      `UPDATE holdings
       SET quantity = $1, avg_cost = $2, currency = COALESCE($5, currency)
       WHERE id = $3 AND user_id = $4
       RETURNING id, symbol, quantity, avg_cost AS "avgCost", currency, created_at AS "createdAt"`,
      [quantity, avgCost, holdingId, userId, currency || null]
    );
    return rows[0] || null;
  },

  async getUserBaseCurrency(userId) {
    try {
      const { rows } = await pool.query(
        `SELECT base_currency FROM user_preferences WHERE user_id = $1`,
        [userId]
      );
      return (rows[0] && rows[0].base_currency) || 'INR';
    } catch (err) {
      return 'INR';
    }
  },

  async setUserBaseCurrency(userId, baseCurrency) {
    const validCurrencies = ['INR', 'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CNY', 'HKD', 'SGD'];
    const currency = validCurrencies.includes(String(baseCurrency).toUpperCase())
      ? String(baseCurrency).toUpperCase()
      : 'INR';

    await pool.query(
      `INSERT INTO user_preferences (user_id, base_currency)
       VALUES ($1, $2)
       ON CONFLICT (user_id)
       DO UPDATE SET base_currency = $2, updated_at = NOW()`,
      [userId, currency]
    );
    return currency;
  },

  // --- Watchlist ---
  async listWatchlist(userId) {
    const { rows } = await pool.query(
      `SELECT id, symbol, created_at AS "createdAt"
       FROM watchlist WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return rows;
  },

  async addToWatchlist(userId, symbol) {
    const { rows } = await pool.query(
      `INSERT INTO watchlist (user_id, symbol) VALUES ($1, $2)
       ON CONFLICT (user_id, symbol) DO NOTHING
       RETURNING id, symbol, created_at AS "createdAt"`,
      [userId, symbol]
    );
    if (rows[0]) return rows[0];
    // Already existed — fetch and return it
    const existing = await pool.query(
      `SELECT id, symbol, created_at AS "createdAt" FROM watchlist WHERE user_id = $1 AND symbol = $2`,
      [userId, symbol]
    );
    return existing.rows[0];
  },

  async removeFromWatchlist(userId, watchlistId) {
    const { rowCount } = await pool.query(
      `DELETE FROM watchlist WHERE id = $1 AND user_id = $2`,
      [watchlistId, userId]
    );
    return rowCount > 0;
  },

  // --- Profile / settings ---
  async updateName(userId, name) {
    const { rows } = await pool.query(
      `UPDATE users SET name = $1 WHERE id = $2
       RETURNING id, name, email, password_hash AS "passwordHash"`,
      [name, userId]
    );
    return rows[0];
  },

// Used by the new Profile page's "Settings" edit form — updates name, phone,
  // and/or avatar choice in one call. Only fields that are actually passed
  // (non-null) get overwritten — e.g. saving just the avatar won't wipe phone.
  async updateProfileDetails(userId, { name, phone, avatarId }) {
    const { rows } = await pool.query(
      `UPDATE users
       SET name = COALESCE($1, name),
           phone = COALESCE($2, phone),
           avatar_id = COALESCE($3, avatar_id)
       WHERE id = $4
       RETURNING id, name, email, phone, avatar_id AS "avatarId", created_at AS "createdAt"`,
      [name || null, phone || null, avatarId || null, userId]
    );
    return rows[0];
  },

  async getUserById(userId) {
    const { rows } = await pool.query(
      `SELECT id, name, email, password_hash AS "passwordHash", phone, avatar_id AS "avatarId",
              role, status, last_login AS "lastLogin", created_at AS "createdAt"
       FROM users WHERE id = $1`,
      [userId]
    );
    return rows[0] || null;
  },

  async updateLastLogin(userId) {
    await pool.query(`UPDATE users SET last_login = now() WHERE id = $1`, [userId]);
  },

  async getUserPreferences(userId) {
    const { rows } = await pool.query(
      `SELECT id, user_id AS "user_id", experience_level AS "experience_level", user_type AS "user_type",
              risk_preference AS "risk_preference", learning_preference AS "learning_preference",
              goals, favorite_sectors AS "favorite_sectors", base_currency AS "base_currency",
              onboarding_completed, created_at, updated_at
       FROM user_preferences WHERE user_id = $1`,
      [userId]
    );
    return rows[0] || null;
  },

  async saveUserPreferences(userId, data) {
    const {
      experienceLevel,
      userType,
      riskPreference,
      learningPreference,
      goals,
      favoriteSectors
    } = data;

    const { rows } = await pool.query(
      `INSERT INTO user_preferences (
         user_id, experience_level, user_type, risk_preference,
         learning_preference, goals, favorite_sectors, onboarding_completed
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       ON CONFLICT (user_id)
       DO UPDATE SET
         experience_level = EXCLUDED.experience_level,
         user_type = EXCLUDED.user_type,
         risk_preference = EXCLUDED.risk_preference,
         learning_preference = EXCLUDED.learning_preference,
         goals = EXCLUDED.goals,
         favorite_sectors = EXCLUDED.favorite_sectors,
         onboarding_completed = true,
         updated_at = NOW()
       RETURNING id, user_id AS "user_id", experience_level AS "experience_level", user_type AS "user_type",
                 risk_preference AS "risk_preference", learning_preference AS "learning_preference",
                 goals, favorite_sectors AS "favorite_sectors", base_currency AS "base_currency",
                 onboarding_completed, created_at, updated_at`,
      [
        userId,
        experienceLevel || null,
        userType || null,
        riskPreference || null,
        learningPreference || null,
        goals || [],
        favoriteSectors || []
      ]
    );

    await pool.query(
      `UPDATE users SET onboarding_completed = true WHERE id = $1`,
      [userId]
    );

    return rows[0];
  },

  async updatePasswordHash(userId, passwordHash) {
    await pool.query(
      `UPDATE users SET password_hash = $1 WHERE id = $2`,
      [passwordHash, userId]
    );
  },

  async getNewsForSymbols(tableName, symbols) {
    if (!symbols || symbols.length === 0) return [];
    const safeTable = tableName === 'portfolio_news' ? 'portfolio_news' : 'watchlist_news';
    const { rows } = await pool.query(
      `SELECT id, symbol, title, description, url, created_at AS "createdAt"
       FROM ${safeTable}
       WHERE symbol = ANY($1::text[])
       ORDER BY created_at DESC`,
      [symbols]
    );
    return rows;
  },

  async saveNewsItem(tableName, { symbol, title, description, url }) {
    const safeTable = tableName === 'portfolio_news' ? 'portfolio_news' : 'watchlist_news';
    const { rows } = await pool.query(
      `INSERT INTO ${safeTable} (symbol, title, description, url)
       VALUES ($1, $2, $3, $4)
       RETURNING id, symbol, title, description, url, created_at AS "createdAt"`,
      [symbol, title, description, url]
    );
    return rows[0];
  },

  // --- Admin User Management ---
  async getAllUsers({ search, status, role } = {}) {
    let query = `
      SELECT id, name, email, phone, avatar_id AS "avatarId", role, status,
             last_login AS "lastLogin", created_at AS "createdAt"
      FROM users WHERE 1=1
    `;
    const params = [];

    if (search) {
      params.push(`%${search.trim().toLowerCase()}%`);
      query += ` AND (LOWER(name) LIKE $${params.length} OR LOWER(email) LIKE $${params.length})`;
    }
    if (status && status !== 'all') {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }
    if (role && role !== 'all') {
      params.push(role);
      query += ` AND role = $${params.length}`;
    }

    query += ` ORDER BY created_at DESC`;

    const { rows } = await pool.query(query, params);
    return rows;
  },

  async updateUserStatus(userId, status) {
    const { rows } = await pool.query(
      `UPDATE users SET status = $1 WHERE id = $2
       RETURNING id, name, email, role, status`,
      [status, userId]
    );
    return rows[0] || null;
  },

  async updateUserRole(userId, role) {
    const { rows } = await pool.query(
      `UPDATE users SET role = $1 WHERE id = $2
       RETURNING id, name, email, role, status`,
      [role, userId]
    );
    return rows[0] || null;
  },

  async deleteUser(userId) {
    const { rowCount } = await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    return rowCount > 0;
  },

  async getAdminStats() {
    const { rows: userCount } = await pool.query(`SELECT COUNT(*) FROM users`);
    const { rows: activeCount } = await pool.query(`SELECT COUNT(*) FROM users WHERE status = 'approved' OR status = 'active'`);
    const { rows: pendingCount } = await pool.query(`SELECT COUNT(*) FROM users WHERE status = 'pending'`);
    const { rows: suspendedCount } = await pool.query(`SELECT COUNT(*) FROM users WHERE status = 'suspended'`);

    const { rows: totalArt } = await pool.query(`SELECT COUNT(*) FROM articles`);
    const { rows: pubArt } = await pool.query(`SELECT COUNT(*) FROM articles WHERE status = 'published'`);
    const { rows: draftArt } = await pool.query(`SELECT COUNT(*) FROM articles WHERE status = 'draft'`);

    const { rows: totalQuiz } = await pool.query(`SELECT COUNT(*) FROM quizzes`);
    const { rows: pubQuiz } = await pool.query(`SELECT COUNT(*) FROM quizzes WHERE status = 'published'`);

    const { rows: recentUsers } = await pool.query(
      `SELECT id, name, email, role, status, created_at AS "createdAt" FROM users ORDER BY created_at DESC LIMIT 5`
    );
    const { rows: recentArticles } = await pool.query(
      `SELECT id, title, category, status, published_at AS "publishedAt", created_at AS "createdAt" FROM articles ORDER BY created_at DESC LIMIT 5`
    );
    const { rows: recentQuizzes } = await pool.query(
      `SELECT id, title, category, difficulty, status, created_at AS "createdAt" FROM quizzes ORDER BY created_at DESC LIMIT 5`
    );

    return {
      users: {
        total: parseInt(userCount[0].count, 10),
        active: parseInt(activeCount[0].count, 10),
        pending: parseInt(pendingCount[0].count, 10),
        suspended: parseInt(suspendedCount[0].count, 10)
      },
      articles: {
        total: parseInt(totalArt[0].count, 10),
        published: parseInt(pubArt[0].count, 10),
        draft: parseInt(draftArt[0].count, 10)
      },
      quizzes: {
        total: parseInt(totalQuiz[0].count, 10),
        published: parseInt(pubQuiz[0].count, 10)
      },
      recentActivity: {
        users: recentUsers,
        articles: recentArticles,
        quizzes: recentQuizzes
      }
    };
  },

  // --- Article CMS Methods ---
  async getAllArticles({ status, category } = {}) {
    let query = `
      SELECT id, title, slug, description, content, category, tags, author,
             reading_time_min AS "readingTimeMin", difficulty, featured_image AS "featuredImage",
             status, created_at AS "createdAt", updated_at AS "updatedAt", published_at AS "publishedAt"
      FROM articles WHERE 1=1
    `;
    const params = [];
    if (status) {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }
    if (category) {
      params.push(category);
      query += ` AND category = $${params.length}`;
    }
    query += ` ORDER BY created_at DESC`;

    const { rows } = await pool.query(query, params);
    return rows;
  },

  async getPublishedArticles({ category, search, difficulty } = {}) {
    let query = `
      SELECT id, title, slug, description, content, category, tags, author,
             reading_time_min AS "readingTimeMin", difficulty, featured_image AS "featuredImage",
             status, created_at AS "createdAt", updated_at AS "updatedAt", published_at AS "publishedAt"
      FROM articles WHERE status = 'published'
    `;
    const params = [];

    if (category && category !== 'ALL') {
      params.push(category);
      query += ` AND category = $${params.length}`;
    }
    if (difficulty && difficulty !== 'ALL') {
      params.push(difficulty);
      query += ` AND difficulty = $${params.length}`;
    }
    if (search) {
      params.push(`%${search.trim().toLowerCase()}%`);
      query += ` AND (LOWER(title) LIKE $${params.length} OR LOWER(description) LIKE $${params.length} OR LOWER(category) LIKE $${params.length})`;
    }

    query += ` ORDER BY published_at DESC, created_at DESC`;

    const { rows } = await pool.query(query, params);
    return rows;
  },

  async getArticleBySlug(slug) {
    const { rows } = await pool.query(
      `SELECT id, title, slug, description, content, category, tags, author,
              reading_time_min AS "readingTimeMin", difficulty, featured_image AS "featuredImage",
              status, created_at AS "createdAt", updated_at AS "updatedAt", published_at AS "publishedAt"
       FROM articles WHERE slug = $1`,
      [slug]
    );
    return rows[0] || null;
  },

  async getArticleById(id) {
    const { rows } = await pool.query(
      `SELECT id, title, slug, description, content, category, tags, author,
              reading_time_min AS "readingTimeMin", difficulty, featured_image AS "featuredImage",
              status, created_at AS "createdAt", updated_at AS "updatedAt", published_at AS "publishedAt"
       FROM articles WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  },

  async createArticle(data) {
    const {
      title,
      slug,
      description,
      content,
      category,
      tags = [],
      author = 'TradePilot Team',
      readingTimeMin = 5,
      difficulty = 'Beginner',
      featuredImage,
      status = 'draft'
    } = data;

    const publishedAt = status === 'published' ? new Date() : null;

    const { rows } = await pool.query(
      `INSERT INTO articles
        (title, slug, description, content, category, tags, author, reading_time_min, difficulty, featured_image, status, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, title, slug, description, content, category, tags, author,
                 reading_time_min AS "readingTimeMin", difficulty, featured_image AS "featuredImage",
                 status, created_at AS "createdAt", updated_at AS "updatedAt", published_at AS "publishedAt"`,
      [title, slug, description, content, category, tags, author, readingTimeMin, difficulty, featuredImage || null, status, publishedAt]
    );

    return rows[0];
  },

  async updateArticle(id, data) {
    const existing = await this.getArticleById(id);
    if (!existing) return null;

    const title = data.title !== undefined ? data.title : existing.title;
    const slug = data.slug !== undefined ? data.slug : existing.slug;
    const description = data.description !== undefined ? data.description : existing.description;
    const content = data.content !== undefined ? data.content : existing.content;
    const category = data.category !== undefined ? data.category : existing.category;
    const tags = data.tags !== undefined ? data.tags : existing.tags;
    const author = data.author !== undefined ? data.author : existing.author;
    const readingTimeMin = data.readingTimeMin !== undefined ? data.readingTimeMin : existing.readingTimeMin;
    const difficulty = data.difficulty !== undefined ? data.difficulty : existing.difficulty;
    const featuredImage = data.featuredImage !== undefined ? data.featuredImage : existing.featuredImage;
    const status = data.status !== undefined ? data.status : existing.status;
    const publishedAt = status === 'published' ? (existing.publishedAt || new Date()) : null;

    const { rows } = await pool.query(
      `UPDATE articles
       SET title = $1, slug = $2, description = $3, content = $4, category = $5,
           tags = $6, author = $7, reading_time_min = $8, difficulty = $9,
           featured_image = $10, status = $11, published_at = $12, updated_at = now()
       WHERE id = $13
       RETURNING id, title, slug, description, content, category, tags, author,
                 reading_time_min AS "readingTimeMin", difficulty, featured_image AS "featuredImage",
                 status, created_at AS "createdAt", updated_at AS "updatedAt", published_at AS "publishedAt"`,
      [title, slug, description, content, category, tags, author, readingTimeMin, difficulty, featuredImage, status, publishedAt, id]
    );

    return rows[0];
  },

  async deleteArticle(id) {
    const { rowCount } = await pool.query(`DELETE FROM articles WHERE id = $1`, [id]);
    return rowCount > 0;
  },

  // --- Quiz CMS Methods ---
  async getAllQuizzes({ status } = {}) {
    let query = `
      SELECT id, title, description, category, difficulty, passing_score AS "passingScore",
             status, questions, created_at AS "createdAt", updated_at AS "updatedAt"
      FROM quizzes WHERE 1=1
    `;
    const params = [];
    if (status) {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }
    query += ` ORDER BY created_at DESC`;

    const { rows } = await pool.query(query, params);
    return rows;
  },

  async getPublishedQuizzes() {
    const { rows } = await pool.query(
      `SELECT id, title, description, category, difficulty, passing_score AS "passingScore",
              status, questions, created_at AS "createdAt"
       FROM quizzes WHERE status = 'published' ORDER BY created_at DESC`
    );
    return rows;
  },

  async getQuizById(id) {
    const { rows } = await pool.query(
      `SELECT id, title, description, category, difficulty, passing_score AS "passingScore",
              status, questions, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM quizzes WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  },

  async createQuiz(data) {
    const {
      title,
      description,
      category,
      difficulty = 'Beginner',
      passingScore = 70,
      status = 'draft',
      questions = []
    } = data;

    const { rows } = await pool.query(
      `INSERT INTO quizzes (title, description, category, difficulty, passing_score, status, questions)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, title, description, category, difficulty, passing_score AS "passingScore",
                 status, questions, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [title, description, category, difficulty, passingScore, status, JSON.stringify(questions)]
    );

    return rows[0];
  },

  async updateQuiz(id, data) {
    const existing = await this.getQuizById(id);
    if (!existing) return null;

    const title = data.title !== undefined ? data.title : existing.title;
    const description = data.description !== undefined ? data.description : existing.description;
    const category = data.category !== undefined ? data.category : existing.category;
    const difficulty = data.difficulty !== undefined ? data.difficulty : existing.difficulty;
    const passingScore = data.passingScore !== undefined ? data.passingScore : existing.passingScore;
    const status = data.status !== undefined ? data.status : existing.status;
    const questions = data.questions !== undefined ? data.questions : existing.questions;

    const { rows } = await pool.query(
      `UPDATE quizzes
       SET title = $1, description = $2, category = $3, difficulty = $4,
           passing_score = $5, status = $6, questions = $7, updated_at = now()
       WHERE id = $8
       RETURNING id, title, description, category, difficulty, passing_score AS "passingScore",
                 status, questions, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [title, description, category, difficulty, passingScore, status, JSON.stringify(questions), id]
    );

    return rows[0];
  },

  async deleteQuiz(id) {
    const { rowCount } = await pool.query(`DELETE FROM quizzes WHERE id = $1`, [id]);
    return rowCount > 0;
  }
};

