// Shared auth logic: protects app pages, wires up the account icon (sign in / profile).
window.TradePilotAuth = {
  getToken: function () {
    return localStorage.getItem('tradepilot_token');
  },

  getUser: function () {
    try {
      return JSON.parse(localStorage.getItem('tradepilot_user'));
    } catch (err) {
      return null;
    }
  },

  authHeader: function () {
    const token = localStorage.getItem('tradepilot_token');
    return token ? { Authorization: 'Bearer ' + token } : {};
  },

  logout: function () {
    localStorage.removeItem('tradepilot_token');
    localStorage.removeItem('tradepilot_user');
    window.location.href = '/signin';
  }
};

// Shared avatar palette — same keys/hex used on the Profile page's avatar picker,
// so whatever a user picks there renders identically here in the nav.
window.TradePilotAvatarColors = {
  slate: '#565e74',
  blue: '#3b82f6',
  green: '#10b981',
  purple: '#8b5cf6',
  pink: '#ec4899',
  orange: '#f97316',
  teal: '#14b8a6',
  red: '#ef4444'
};

function tradepilotInitial(name) {
  return name && name.trim() ? name.trim()[0].toUpperCase() : '?';
}

document.addEventListener('DOMContentLoaded', function () {
  const requiresAuth = document.body.getAttribute('data-auth') === 'required';
  const token = window.TradePilotAuth.getToken();
  const user = window.TradePilotAuth.getUser();

  // Protect app pages: bounce to sign-in if not logged in
  if (requiresAuth && !token) {
    window.location.href = '/signin';
    return;
  }

  // Handle onboarding redirects & session sync
  const isOnboardingPage = window.location.pathname.includes('onboarding');

  if (token && user) {
    // Fast path using local storage
    if (user.onboardingCompleted === false && !isOnboardingPage && requiresAuth) {
      window.location.href = '/onboarding';
      return;
    }

    if (user.onboardingCompleted === true && isOnboardingPage) {
      window.location.href = '/dashboard';
      return;
    }

    // Verify with server and refresh stored user info
    fetch('/api/auth/me', {
      headers: { Authorization: 'Bearer ' + token }
    })
      .then(res => res.json())
      .then(data => {
        if (data.user) {
          const updatedUser = {
            id: data.user.id,
            name: data.user.name,
            email: data.user.email,
            phone: data.user.phone,
            avatarId: data.user.avatarId,
            createdAt: data.user.createdAt,
            onboardingCompleted: data.user.onboardingCompleted
          };

          localStorage.setItem('tradepilot_user', JSON.stringify(updatedUser));
          renderNavAvatar(updatedUser);

          if (!data.user.onboardingCompleted && !isOnboardingPage && requiresAuth) {
            window.location.href = '/onboarding';
          } else if (data.user.onboardingCompleted && isOnboardingPage) {
            window.location.href = '/dashboard';
          }
        }
      })
      .catch(err => console.error('Failed to sync auth session:', err));
  }

  // Wire up the account icon in the top nav — now a real profile link, not a logout trap
  const accountBtn = document.getElementById('nav-account-btn');

  if (accountBtn) {
    if (token && user) {
      accountBtn.title = 'View profile — ' + user.name;
      accountBtn.setAttribute('href', '/profile');
      renderNavAvatar(user);
    } else {
      accountBtn.title = 'Sign in';
      accountBtn.setAttribute('href', '/signin');
    }
  }

  function renderNavAvatar(u) {
    if (!accountBtn || !u) return;
    const color = (window.TradePilotAvatarColors[u.avatarId] || window.TradePilotAvatarColors.slate);
    accountBtn.classList.remove('material-symbols-outlined');
    accountBtn.innerHTML =
      '<span style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:9999px;background:' +
      color + ';color:#fff;font-size:13px;font-weight:700;">' + tradepilotInitial(u.name) + '</span>';
  }

  // Wire up the AI sidebar toggle
  const aiToggle = document.getElementById('ai-toggle');
  const aiSidebar = document.getElementById('ai-sidebar');
  if (aiToggle && aiSidebar) {
    aiToggle.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      aiSidebar.classList.toggle('translate-x-full');
      aiSidebar.classList.toggle('translate-x-0');
    });

    // Close when clicking outside of the sidebar
    document.addEventListener('click', function (e) {
      if (!aiSidebar.contains(e.target) && !aiToggle.contains(e.target) && !aiSidebar.classList.contains('translate-x-full')) {
        aiSidebar.classList.add('translate-x-full');
        aiSidebar.classList.remove('translate-x-0');
      }
    });
  }
});