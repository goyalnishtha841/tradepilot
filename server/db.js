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

  console.log('✅ Connected to database, all tables ready.');
}

async function findByEmail(email) {
  const { rows } = await pool.query(
    `SELECT id, name, email, password_hash AS "passwordHash", created_at AS "createdAt"
     FROM users WHERE LOWER(email) = LOWER($1)`,
    [email]
  );
  return rows[0] || null;
}

async function createUser({ name, email, passwordHash }) {
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, name, email, password_hash AS "passwordHash", created_at AS "createdAt"`,
    [name, email, passwordHash]
  );
  return rows[0];
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

  async getUserById(userId) {
    const { rows } = await pool.query(
      `SELECT id, name, email, password_hash AS "passwordHash" FROM users WHERE id = $1`,
      [userId]
    );
    return rows[0] || null;
  },

  async updatePasswordHash(userId, passwordHash) {
    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, userId]);
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
    `
    INSERT INTO user_preferences (
      user_id,
      experience_level,
      user_type,
      risk_preference,
      learning_preference,
      goals,
      favorite_sectors,
      onboarding_completed
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,true)
    ON CONFLICT(user_id)
    DO UPDATE SET
      experience_level = EXCLUDED.experience_level,
      user_type = EXCLUDED.user_type,
      risk_preference = EXCLUDED.risk_preference,
      learning_preference = EXCLUDED.learning_preference,
      goals = EXCLUDED.goals,
      favorite_sectors = EXCLUDED.favorite_sectors,
      onboarding_completed = true,
      updated_at = NOW()
    RETURNING *;
    `,
    [
      userId,
      experienceLevel,
      userType,
      riskPreference,
      learningPreference,
      goals,
      favoriteSectors
    ]
  );

  return rows[0];
  },
  async getUserPreferences(userId) {
    const { rows } = await pool.query(

        `SELECT * FROM user_preferences WHERE user_id=$1`,

        [userId]

    );

    return rows[0] || null;

  },



  async getPortfolioSummary(userId) {
    const { rows } = await pool.query(
        `SELECT
            COUNT(*) holdings,
            COALESCE(SUM(quantity*avg_cost),0) invested
         FROM holdings
         WHERE user_id=$1`,
        [userId]
    );
    return rows[0];
  },

  async getWatchlistCount(userId){
    const { rows } = await pool.query(
        `SELECT COUNT(*) total
         FROM watchlist
         WHERE user_id=$1`,
        [userId]
    );
    return rows[0];
  },

  async getNewsForSymbols(table, symbols) {
    if (!symbols || symbols.length === 0) return [];
    const tableName = table === 'portfolio' ? 'portfolio_news' : 'watchlist_news';
    const { rows } = await pool.query(
      `SELECT id, symbol, title, description, url, created_at AS "createdAt"
       FROM ${tableName}
       WHERE symbol = ANY($1)
       ORDER BY created_at DESC LIMIT 20`,
      [symbols]
    );
    return rows;
  },

  async saveNewsItem(table, { symbol, title, description, url }) {
    const tableName = table === 'portfolio' ? 'portfolio_news' : 'watchlist_news';
    const { rows } = await pool.query(
      `INSERT INTO ${tableName} (symbol, title, description, url)
       VALUES ($1, $2, $3, $4)
       RETURNING id, symbol, title, description, url, created_at AS "createdAt"`,
      [symbol, title, description, url]
    );
    return rows[0];
  }
};
