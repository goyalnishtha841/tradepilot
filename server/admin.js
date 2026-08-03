const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { requireAdmin, signToken } = require('./auth');

const router = express.Router();

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@tradepilot.com').toLowerCase().trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'AdminPassword123!';

// POST /api/admin/signin — Dedicated Administrator Sign-in
router.post('/signin', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Please enter admin email and password.' });
    }

    const inputEmail = email.toLowerCase().trim();

    // 1. Check fixed environment variable credentials
    if (inputEmail === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      let adminUser = await db.findByEmail(ADMIN_EMAIL);
      if (!adminUser) {
        const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
        adminUser = await db.createUser({
          name: 'TradePilot Administrator',
          email: ADMIN_EMAIL,
          passwordHash,
          role: 'admin',
          status: 'approved'
        });
      } else if (adminUser.role !== 'admin') {
        await db.updateUserRole(adminUser.id, 'admin');
        adminUser.role = 'admin';
      }

      await db.updateLastLogin(adminUser.id);
      const token = signToken(adminUser);

      return res.json({
        token,
        user: {
          id: adminUser.id,
          name: adminUser.name,
          email: adminUser.email,
          role: 'admin',
          status: 'approved'
        }
      });
    }

    // 2. Fallback check DB users with role === 'admin'
    const user = await db.findByEmail(inputEmail);
    if (!user || user.role !== 'admin') {
      return res.status(401).json({ error: 'Invalid admin credentials or insufficient privileges.' });
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      return res.status(401).json({ error: 'Invalid admin credentials.' });
    }

    if (user.status !== 'approved' && user.status !== 'active') {
      return res.status(403).json({ error: `Admin account is ${user.status}.` });
    }

    await db.updateLastLogin(user.id);
    const token = signToken(user);

    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: 'admin',
        status: user.status
      }
    });
  } catch (err) {
    console.error('Admin signin error:', err);
    res.status(500).json({ error: 'Failed to authenticate administrator.' });
  }
});

// GET /api/admin/dashboard/stats — Dashboard Analytics & Summaries
router.get('/dashboard/stats', requireAdmin, async (req, res) => {
  try {
    const stats = await db.getAdminStats();
    res.json(stats);
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ error: 'Could not load dashboard analytics.' });
  }
});

// GET /api/admin/users — List & Filter Users
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const { search, status, role } = req.query;
    const users = await db.getAllUsers({ search, status, role });
    res.json({ users });
  } catch (err) {
    console.error('Admin list users error:', err);
    res.status(500).json({ error: 'Could not fetch user directory.' });
  }
});

// PATCH /api/admin/users/:id/status — Activate, Deactivate, Suspend, Approve, Reject
router.patch('/users/:id/status', requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { status } = req.body;
    const validStatuses = ['approved', 'active', 'suspended', 'deactivated', 'rejected', 'pending'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid account status value.' });
    }

    const updated = await db.updateUserStatus(userId, status);
    if (!updated) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({ success: true, user: updated });
  } catch (err) {
    console.error('Admin update user status error:', err);
    res.status(500).json({ error: 'Could not update user status.' });
  }
});

// PATCH /api/admin/users/:id/role — Change User Role (user <-> admin)
router.patch('/users/:id/role', requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { role } = req.body;
    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be user or admin.' });
    }

    const updated = await db.updateUserRole(userId, role);
    if (!updated) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({ success: true, user: updated });
  } catch (err) {
    console.error('Admin update user role error:', err);
    res.status(500).json({ error: 'Could not update user role.' });
  }
});

// POST /api/admin/users/:id/reset-password — Administrative Password Reset
router.post('/users/:id/reset-password', requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await db.updatePasswordHash(userId, passwordHash);

    res.json({ success: true, message: 'User password reset successfully.' });
  } catch (err) {
    console.error('Admin reset password error:', err);
    res.status(500).json({ error: 'Could not reset user password.' });
  }
});

// DELETE /api/admin/users/:id — Permanent Delete User
router.delete('/users/:id', requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (req.user.id === userId) {
      return res.status(400).json({ error: 'You cannot delete your own admin account while logged in.' });
    }

    const deleted = await db.deleteUser(userId);
    if (!deleted) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Admin delete user error:', err);
    res.status(500).json({ error: 'Could not delete user account.' });
  }
});

// --- Article CMS Endpoints ---
router.get('/articles', requireAdmin, async (req, res) => {
  try {
    const { status, category } = req.query;
    const articles = await db.getAllArticles({ status, category });
    res.json({ articles });
  } catch (err) {
    console.error('Admin get articles error:', err);
    res.status(500).json({ error: 'Could not load articles.' });
  }
});

router.post('/articles', requireAdmin, async (req, res) => {
  try {
    const { title, slug, description, content, category, tags, author, readingTimeMin, difficulty, featuredImage, status } = req.body;

    if (!title || !content || !category) {
      return res.status(400).json({ error: 'Title, content, and category are required.' });
    }

    const finalSlug = slug && slug.trim()
      ? slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
      : title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString(36);

    const article = await db.createArticle({
      title: title.trim(),
      slug: finalSlug,
      description: description ? description.trim() : '',
      content: content.trim(),
      category: category.trim(),
      tags: Array.isArray(tags) ? tags : [],
      author: author ? author.trim() : 'TradePilot Team',
      readingTimeMin: parseInt(readingTimeMin, 10) || 5,
      difficulty: difficulty || 'Beginner',
      featuredImage: featuredImage ? featuredImage.trim() : null,
      status: status === 'published' ? 'published' : 'draft'
    });

    res.json({ article });
  } catch (err) {
    console.error('Admin create article error:', err);
    res.status(500).json({ error: err.message.includes('slug') ? 'An article with this slug already exists.' : 'Could not create article.' });
  }
});

router.put('/articles/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const updated = await db.updateArticle(id, req.body);
    if (!updated) {
      return res.status(404).json({ error: 'Article not found.' });
    }
    res.json({ article: updated });
  } catch (err) {
    console.error('Admin update article error:', err);
    res.status(500).json({ error: 'Could not update article.' });
  }
});

router.delete('/articles/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const deleted = await db.deleteArticle(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Article not found.' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Admin delete article error:', err);
    res.status(500).json({ error: 'Could not delete article.' });
  }
});

// --- Quiz CMS Endpoints ---
router.get('/quizzes', requireAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    const quizzes = await db.getAllQuizzes({ status });
    res.json({ quizzes });
  } catch (err) {
    console.error('Admin get quizzes error:', err);
    res.status(500).json({ error: 'Could not load quizzes.' });
  }
});

router.post('/quizzes', requireAdmin, async (req, res) => {
  try {
    const { title, description, category, difficulty, passingScore, status, questions } = req.body;

    if (!title || !category) {
      return res.status(400).json({ error: 'Quiz title and category are required.' });
    }

    const quiz = await db.createQuiz({
      title: title.trim(),
      description: description ? description.trim() : '',
      category: category.trim(),
      difficulty: difficulty || 'Beginner',
      passingScore: parseInt(passingScore, 10) || 70,
      status: status === 'published' ? 'published' : 'draft',
      questions: Array.isArray(questions) ? questions : []
    });

    res.json({ quiz });
  } catch (err) {
    console.error('Admin create quiz error:', err);
    res.status(500).json({ error: 'Could not create quiz.' });
  }
});

router.put('/quizzes/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const updated = await db.updateQuiz(id, req.body);
    if (!updated) {
      return res.status(404).json({ error: 'Quiz not found.' });
    }
    res.json({ quiz: updated });
  } catch (err) {
    console.error('Admin update quiz error:', err);
    res.status(500).json({ error: 'Could not update quiz.' });
  }
});

router.delete('/quizzes/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const deleted = await db.deleteQuiz(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Quiz not found.' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Admin delete quiz error:', err);
    res.status(500).json({ error: 'Could not delete quiz.' });
  }
});

module.exports = router;
