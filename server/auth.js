const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');
const db = require('./db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const TOKEN_EXPIRY = '7d';

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function passwordError(password) {
  if (!password || password.length < 8) {
    return 'Password must be at least 8 characters.';
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must include at least one letter and one number.';
  }
  return null;
}

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role || 'user',
      status: user.status || 'approved'
    },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Please enter your name.' });
    }
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    const pwError = passwordError(password);
    if (pwError) {
      return res.status(400).json({ error: pwError });
    }

    const existing = await db.findByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await db.createUser({ name: name.trim(), email: email.trim(), passwordHash, role: 'user', status: 'approved' });
    const token = signToken(user);

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role || 'user',
        status: user.status || 'approved',
        onboardingCompleted: false
      }
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Something went wrong creating your account.' });
  }
});

// POST /api/auth/signin
router.post('/signin', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Please enter your email and password.' });
    }

    const user = await db.findByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'Your account has been suspended. Please contact an administrator.' });
    }
    if (user.status === 'deactivated') {
      return res.status(403).json({ error: 'Your account is deactivated.' });
    }
    if (user.status === 'rejected') {
      return res.status(403).json({ error: 'Your registration application was rejected.' });
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    await db.updateLastLogin(user.id);

    const token = signToken(user);
    const prefs = await db.getUserPreferences(user.id);
    const onboardingCompleted = prefs ? prefs.onboarding_completed : false;

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role || 'user',
        status: user.status || 'approved',
        onboardingCompleted
      }
    });
  } catch (err) {
    console.error('Signin error:', err);
    res.status(500).json({ error: 'Something went wrong signing you in.' });
  }
});

// Middleware to protect routes / verify identity
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
  }
}

// Middleware to require admin rights
function requireAdmin(req, res, next) {
  requireAuth(req, res, async () => {
    // Also check current database state for role
    const fullUser = await db.getUserById(req.user.id);
    const role = fullUser ? fullUser.role : req.user.role;
    const status = fullUser ? fullUser.status : req.user.status;

    if (role === 'admin' && (status === 'approved' || status === 'active')) {
      req.user.role = 'admin';
      next();
    } else {
      return res.status(403).json({ error: 'Access denied. Administrator privileges required.' });
    }
  });
}

// GET /api/auth/me — used by pages to check "am I logged in?"
// GET /api/auth/me — used by pages to check "am I logged in?"
router.get('/me', requireAuth, async (req, res) => {
  try {
    const prefs = await db.getUserPreferences(req.user.id);
    const fullUser = await db.getUserById(req.user.id);

    res.json({
      user: {
        id: req.user.id,
        name: fullUser ? fullUser.name : req.user.name,
        email: req.user.email,
        phone: fullUser ? fullUser.phone : null,
        avatarId: fullUser ? fullUser.avatarId : 'slate',
        createdAt: fullUser ? fullUser.createdAt : null,
        onboardingCompleted: prefs ? prefs.onboarding_completed : false
      }
    });
  } catch (err) {
    console.error('Error in /me preference check:', err);
    res.json({ user: req.user });
  }
});

// PATCH /api/auth/profile — update display name, phone, and/or avatar choice
router.patch('/profile', requireAuth, async (req, res) => {
  try {
    const { name, phone, avatarId } = req.body;
    if (name !== undefined && !name.trim()) {
      return res.status(400).json({ error: 'Please enter your name.' });
    }

    const updated = await db.updateProfileDetails(req.user.id, {
      name: name !== undefined ? name.trim() : null,
      phone: phone !== undefined ? phone.trim() : null,
      avatarId: avatarId !== undefined ? avatarId : null
    });

    const token = signToken(updated);
    res.json({
      token,
      user: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        phone: updated.phone,
        avatarId: updated.avatarId,
        createdAt: updated.createdAt
      }
    });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Could not update your profile.' });
  }
});

// POST /api/auth/change-password — body: { currentPassword, newPassword }
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword) {
      return res.status(400).json({ error: 'Please enter your current password.' });
    }
    const pwError = passwordError(newPassword);
    if (pwError) {
      return res.status(400).json({ error: pwError });
    }

    const user = await db.getUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const matches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!matches) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await db.updatePasswordHash(user.id, newHash);

    res.json({ success: true });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Could not change your password.' });
  }
});

// GET /api/auth/google/client-id
router.get('/google/client-id', (req, res) => {
  res.json({ clientId: process.env.GOOGLE_CLIENT_ID || null });
});

// POST /api/auth/google
router.post('/google', async (req, res) => {
  try {
    const { credential, isMock, email: mockEmail } = req.body;
    let payload;

    if (isMock || !process.env.GOOGLE_CLIENT_ID) {
      console.log('Using simulated Google Auth.');
      payload = {
        email: mockEmail || 'google-mock-user@example.com',
        name: 'Google Mock User',
        sub: 'mock-google-id-' + Date.now()
      };
    } else {
      if (!credential) {
        return res.status(400).json({ error: 'Missing Google credential.' });
      }

      const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
      if (!verifyRes.ok) {
        const errorText = await verifyRes.text();
        console.error('Google verification failed:', errorText);
        return res.status(401).json({ error: 'Invalid Google credential.' });
      }

      payload = await verifyRes.json();

      if (payload.aud !== process.env.GOOGLE_CLIENT_ID) {
        console.error('Google Client ID aud mismatch:', payload.aud, 'expected:', process.env.GOOGLE_CLIENT_ID);
        return res.status(401).json({ error: 'Client ID mismatch.' });
      }
    }

    const email = payload.email;
    const name = payload.name || email.split('@')[0];

    let user = await db.findByEmail(email);
    if (!user) {
      const dummyPassword = Math.random().toString(36).substring(2) + Date.now().toString(36);
      const passwordHash = await bcrypt.hash(dummyPassword, 10);
      user = await db.createUser({ name, email, passwordHash });
    }

    const token = signToken(user);
    const prefs = await db.getUserPreferences(user.id);
    const onboardingCompleted = prefs ? prefs.onboarding_completed : false;

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        onboardingCompleted
      }
    });
  } catch (err) {
    console.error('Google signin error:', err);
    res.status(500).json({ error: 'Something went wrong signing you in with Google.' });
  }
});

module.exports = { router, requireAuth, requireAdmin, signToken };
