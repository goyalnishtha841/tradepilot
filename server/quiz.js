const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');

const router = express.Router();

// Fallback static question bank for backward compatibility
const FALLBACK_QUESTIONS = [
  {
    question: "What does a 'Death Cross' indicate in technical analysis?",
    options: ['Bullish Momentum', 'Bearish Long-term Trend', 'Volume Spike Only'],
    correctIndex: 1,
    explanation: 'A Death Cross occurs when a short-term moving average falls below a long-term moving average, indicating bearish momentum.'
  },
  {
    question: "What does 'P/E Ratio' stand for?",
    options: ['Price-to-Equity Ratio', 'Price-to-Earnings Ratio', 'Profit-to-Expense Ratio'],
    correctIndex: 1,
    explanation: 'P/E stands for Price-to-Earnings ratio, comparing share price to earnings per share.'
  },
  {
    question: 'What is "diversification" in investing?',
    options: [
      'Putting all your money into one high-growth stock',
      'Spreading investments across different assets to reduce risk',
      'Selling all your assets during a downturn'
    ],
    correctIndex: 1,
    explanation: 'Diversification spreads portfolio risk across different sectors and asset classes.'
  },
  {
    question: "What does 'RSI' (Relative Strength Index) measure?",
    options: [
      'Whether a stock is overbought or oversold',
      'A company\'s total revenue',
      'The number of shares traded'
    ],
    correctIndex: 0,
    explanation: 'RSI measures momentum on a 0-100 scale to spot overbought (>70) or oversold (<30) levels.'
  },
  {
    question: 'What is a "bull market"?',
    options: [
      'A period of falling prices',
      'A period of rising prices and investor optimism',
      'A market with no trading activity'
    ],
    correctIndex: 1,
    explanation: 'A bull market is characterized by sustained upward price movement and investor confidence.'
  }
];

// GET /api/quiz/list — returns all published quizzes
router.get('/list', requireAuth, async (req, res) => {
  try {
    const quizzes = await db.getPublishedQuizzes();
    const sanitized = quizzes.map(q => ({
      id: q.id,
      title: q.title,
      description: q.description,
      category: q.category,
      difficulty: q.difficulty,
      passingScore: q.passingScore,
      questionCount: Array.isArray(q.questions) ? q.questions.length : 0
    }));
    res.json({ quizzes: sanitized });
  } catch (err) {
    console.error('Quiz list error:', err);
    res.status(500).json({ error: 'Could not load quiz catalog.' });
  }
});

// GET /api/quiz/:id — returns questions for a specific quiz (without answers)
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid quiz ID.' });
    }

    const quiz = await db.getQuizById(id);
    if (!quiz || quiz.status !== 'published') {
      return res.status(404).json({ error: 'Quiz not found.' });
    }

    const publicQuestions = (quiz.questions || []).map((q, idx) => ({
      id: idx,
      question: q.question,
      type: q.type || 'single',
      options: q.options || []
    }));

    res.json({
      quiz: {
        id: quiz.id,
        title: quiz.title,
        description: quiz.description,
        category: quiz.category,
        difficulty: quiz.difficulty,
        passingScore: quiz.passingScore,
        questions: publicQuestions
      }
    });
  } catch (err) {
    console.error('Fetch quiz detail error:', err);
    res.status(500).json({ error: 'Could not load quiz.' });
  }
});

// POST /api/quiz/:id/submit — submit answers for a specific quiz
router.post('/:id/submit', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { answers } = req.body;

    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ error: 'Missing answers.' });
    }

    const quiz = await db.getQuizById(id);
    if (!quiz || quiz.status !== 'published') {
      return res.status(404).json({ error: 'Quiz not found.' });
    }

    const questions = quiz.questions || [];
    let score = 0;
    const total = questions.length;

    const results = questions.map((q, idx) => {
      const chosen = answers[idx];
      const correct = chosen === q.correctIndex;
      if (correct) score += 1;
      return {
        id: idx,
        question: q.question,
        correct,
        correctIndex: q.correctIndex,
        chosen,
        explanation: q.explanation || ''
      };
    });

    const percentage = total > 0 ? Math.round((score / total) * 100) : 0;
    const passed = percentage >= (quiz.passingScore || 70);

    const attempt = await db.saveQuizAttempt(req.user.id, score, total);

    res.json({ score, total, percentage, passed, passingScore: quiz.passingScore, results, attempt });
  } catch (err) {
    console.error('Quiz submit error:', err);
    res.status(500).json({ error: 'Could not submit quiz answers.' });
  }
});

// --- Legacy Endpoints for backward compatibility ---
router.get('/questions', requireAuth, async (req, res) => {
  try {
    const quizzes = await db.getPublishedQuizzes();
    const firstQuiz = quizzes[0];
    const rawQuestions = (firstQuiz && firstQuiz.questions.length > 0) ? firstQuiz.questions : FALLBACK_QUESTIONS;

    const publicQuestions = rawQuestions.map(({ question, options }, index) => ({
      id: index,
      question,
      options
    }));
    res.json({ questions: publicQuestions });
  } catch (err) {
    const publicQuestions = FALLBACK_QUESTIONS.map(({ question, options }, index) => ({
      id: index,
      question,
      options
    }));
    res.json({ questions: publicQuestions });
  }
});

router.post('/submit', requireAuth, async (req, res) => {
  try {
    const { answers } = req.body;
    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ error: 'Missing answers.' });
    }

    const quizzes = await db.getPublishedQuizzes();
    const firstQuiz = quizzes[0];
    const rawQuestions = (firstQuiz && firstQuiz.questions.length > 0) ? firstQuiz.questions : FALLBACK_QUESTIONS;

    let score = 0;
    const total = rawQuestions.length;
    const results = rawQuestions.map((q, id) => {
      const chosen = answers[id];
      const correct = chosen === q.correctIndex;
      if (correct) score += 1;
      return { id, correct, correctIndex: q.correctIndex, chosen, explanation: q.explanation || '' };
    });

    const attempt = await db.saveQuizAttempt(req.user.id, score, total);

    res.json({ score, total, results, attempt });
  } catch (err) {
    console.error('Quiz submit error:', err);
    res.status(500).json({ error: 'Could not save your quiz results.' });
  }
});

router.get('/best', requireAuth, async (req, res) => {
  try {
    const best = await db.getBestQuizAttempt(req.user.id);
    res.json({ best });
  } catch (err) {
    console.error('Get best quiz error:', err);
    res.status(500).json({ error: 'Could not load past results.' });
  }
});

module.exports = router;
