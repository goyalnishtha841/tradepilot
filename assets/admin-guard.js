// Guard for Admin Panel pages (admin.html)
window.TradePilotAdminAuth = {
  getToken: function () {
    return localStorage.getItem('tradepilot_admin_token') || localStorage.getItem('tradepilot_token');
  },

  getUser: function () {
    try {
      return JSON.parse(localStorage.getItem('tradepilot_user'));
    } catch (err) {
      return null;
    }
  },

  authHeader: function () {
    const token = this.getToken();
    return token ? { Authorization: 'Bearer ' + token } : {};
  },

  logout: function () {
    localStorage.removeItem('tradepilot_admin_token');
    localStorage.removeItem('tradepilot_token');
    localStorage.removeItem('tradepilot_user');
    window.location.href = '/admin-login';
  }
};

(function checkAdminAccess() {
  const token = window.TradePilotAdminAuth.getToken();
  const user = window.TradePilotAdminAuth.getUser();

  if (!token || !user || user.role !== 'admin') {
    window.location.href = '/admin-login';
    return;
  }

  // Double-verify session with backend
  fetch('/api/auth/me', {
    headers: { Authorization: 'Bearer ' + token }
  })
    .then(res => res.json())
    .then(data => {
      if (!data.user || data.user.role !== 'admin') {
        window.TradePilotAdminAuth.logout();
      }
    })
    .catch(err => {
      console.error('Failed to verify admin status:', err);
    });
})();
