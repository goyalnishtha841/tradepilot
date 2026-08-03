(function () {
  'use strict';

  function authHeader() {
    return window.TradePilotAdminAuth ? window.TradePilotAdminAuth.authHeader() : {};
  }

  function showToast(message, type = 'success') {
    const toast = document.getElementById('admin-toast');
    const toastIcon = document.getElementById('admin-toast-icon');
    const toastText = document.getElementById('admin-toast-text');
    if (!toast) return;

    toastText.textContent = message;
    if (type === 'success') {
      toast.className = 'fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl border shadow-xl flex items-center gap-3 max-w-sm bg-emerald-950 border-emerald-800 text-emerald-300';
      toastIcon.textContent = 'check_circle';
    } else {
      toast.className = 'fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl border shadow-xl flex items-center gap-3 max-w-sm bg-red-950 border-red-800 text-red-300';
      toastIcon.textContent = 'error';
    }

    toast.classList.remove('hidden');
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 3500);
  }

  let currentTab = 'dashboard';
  let usersList = [];
  let articlesList = [];
  let quizzesList = [];

  // Modals & State
  let resetUserId = null;
  let confirmCallback = null;

  document.addEventListener('DOMContentLoaded', () => {
    initNav();
    initTheme();
    initUserBadge();
    loadDashboardStats();

    // Event Listeners for Filters & Modals
    document.getElementById('user-search-input')?.addEventListener('input', renderUsersTable);
    document.getElementById('user-status-filter')?.addEventListener('change', renderUsersTable);
    document.getElementById('user-role-filter')?.addEventListener('change', renderUsersTable);

    document.getElementById('btn-admin-logout')?.addEventListener('click', () => {
      window.TradePilotAdminAuth.logout();
    });

    // Article Modal Triggers
    document.getElementById('btn-create-article')?.addEventListener('click', () => openArticleModal());
    document.getElementById('btn-close-article-modal')?.addEventListener('click', closeArticleModal);
    document.getElementById('btn-cancel-article')?.addEventListener('click', closeArticleModal);
    document.getElementById('form-article')?.addEventListener('submit', (e) => saveArticle(e, 'published'));
    document.getElementById('btn-save-draft-article')?.addEventListener('click', (e) => saveArticle(e, 'draft'));

    // Quiz Modal Triggers
    document.getElementById('btn-create-quiz')?.addEventListener('click', () => openQuizModal());
    document.getElementById('btn-close-quiz-modal')?.addEventListener('click', closeQuizModal);
    document.getElementById('btn-cancel-quiz')?.addEventListener('click', closeQuizModal);
    document.getElementById('form-quiz')?.addEventListener('submit', (e) => saveQuiz(e, 'published'));
    document.getElementById('btn-save-draft-quiz')?.addEventListener('click', (e) => saveQuiz(e, 'draft'));
    document.getElementById('btn-add-question')?.addEventListener('click', () => addQuestionField());

    // Password Reset Modal
    document.getElementById('btn-close-reset-pw')?.addEventListener('click', closeResetPwModal);
    document.getElementById('btn-confirm-reset-pw')?.addEventListener('click', executePasswordReset);

    // Confirmation Modal
    document.getElementById('btn-cancel-confirm')?.addEventListener('click', closeConfirmModal);
    document.getElementById('btn-execute-confirm')?.addEventListener('click', () => {
      if (confirmCallback) confirmCallback();
      closeConfirmModal();
    });
  });

  function initNav() {
    const desktopBtns = document.querySelectorAll('.nav-tab-btn');
    const mobileBtns = document.querySelectorAll('.mobile-tab-btn');

    desktopBtns.forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
    });

    mobileBtns.forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
    });
  }

  function switchTab(tabId) {
    currentTab = tabId;

    // Update panels
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.add('hidden');
    });
    const targetPanel = document.getElementById(`panel-${tabId}`);
    if (targetPanel) targetPanel.classList.remove('hidden');

    // Update active nav styling
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      const active = btn.getAttribute('data-tab') === tabId;
      btn.className = active
        ? 'nav-tab-btn w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold transition-all bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
        : 'nav-tab-btn w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold text-slate-400 hover:bg-slate-800 hover:text-white transition-all';
    });

    // Load tab-specific data
    if (tabId === 'dashboard') loadDashboardStats();
    if (tabId === 'users') fetchUsers();
    if (tabId === 'authorizations') fetchAuthUsers('pending');
    if (tabId === 'articles') fetchArticles();
    if (tabId === 'quizzes') fetchQuizzes();
  }

  function initTheme() {
    const darkToggle = document.getElementById('dark-mode-icon-toggle');
    if (!darkToggle) return;

    darkToggle.addEventListener('click', () => {
      const isDark = document.documentElement.classList.contains('dark');
      document.documentElement.classList.toggle('dark', !isDark);
      localStorage.setItem('tradepilot_dark_mode', String(!isDark));
    });
  }

  function initUserBadge() {
    const u = window.TradePilotAdminAuth.getUser();
    if (u) {
      const badge = document.getElementById('admin-user-badge');
      const name = document.getElementById('admin-user-name');
      if (badge) badge.textContent = u.name ? u.name[0].toUpperCase() : 'A';
      if (name) name.textContent = u.name || 'Admin';
    }
  }

  // ==========================================
  // DASHBOARD
  // ==========================================
  async function loadDashboardStats() {
    try {
      const res = await fetch('/api/admin/dashboard/stats', { headers: authHeader() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load stats');

      document.getElementById('stat-total-users').textContent = data.users.total;
      document.getElementById('stat-active-users').textContent = data.users.active;
      document.getElementById('stat-pending-users').textContent = data.users.pending;
      document.getElementById('stat-suspended-users').textContent = data.users.suspended;

      document.getElementById('stat-total-articles').textContent = data.articles.total;
      document.getElementById('stat-pub-articles').textContent = data.articles.published;
      document.getElementById('stat-draft-articles').textContent = data.articles.draft;

      document.getElementById('stat-total-quizzes').textContent = data.quizzes.total;
      document.getElementById('stat-pub-quizzes').textContent = data.quizzes.published;

      // Render recent user activity feed
      const usersFeed = document.getElementById('feed-recent-users');
      if (usersFeed) {
        if (!data.recentActivity.users || data.recentActivity.users.length === 0) {
          usersFeed.innerHTML = '<p class="text-xs text-slate-500 italic">No recent registrations.</p>';
        } else {
          usersFeed.innerHTML = data.recentActivity.users.map(u => `
            <div class="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 text-xs">
              <div class="flex items-center gap-2.5">
                <div class="w-7 h-7 rounded-full bg-slate-800 text-indigo-400 font-bold flex items-center justify-center text-xs">
                  ${u.name ? u.name[0].toUpperCase() : 'U'}
                </div>
                <div>
                  <p class="font-semibold text-slate-200">${u.name}</p>
                  <p class="text-[10px] text-slate-500">${u.email}</p>
                </div>
              </div>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${u.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-300'}">
                ${u.status}
              </span>
            </div>
          `).join('');
        }
      }

      // Render recent content feed
      const contentFeed = document.getElementById('feed-recent-content');
      if (contentFeed) {
        if (!data.recentActivity.articles || data.recentActivity.articles.length === 0) {
          contentFeed.innerHTML = '<p class="text-xs text-slate-500 italic">No recent content created.</p>';
        } else {
          contentFeed.innerHTML = data.recentActivity.articles.map(a => `
            <div class="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 text-xs">
              <div>
                <p class="font-semibold text-slate-200 line-clamp-1">${a.title}</p>
                <p class="text-[10px] text-slate-500">${a.category}</p>
              </div>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${a.status === 'published' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'}">
                ${a.status}
              </span>
            </div>
          `).join('');
        }
      }

    } catch (err) {
      console.error('Failed to load dashboard:', err);
    }
  }

  // ==========================================
  // USER DIRECTORY MANAGEMENT
  // ==========================================
  async function fetchUsers() {
    try {
      const res = await fetch('/api/admin/users', { headers: authHeader() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      usersList = data.users || [];
      renderUsersTable();
    } catch (err) {
      showToast('Could not load user directory.', 'error');
    }
  }

  function renderUsersTable() {
    const tbody = document.getElementById('users-table-body');
    if (!tbody) return;

    const query = (document.getElementById('user-search-input')?.value || '').toLowerCase();
    const statusVal = document.getElementById('user-status-filter')?.value || 'all';
    const roleVal = document.getElementById('user-role-filter')?.value || 'all';

    const filtered = usersList.filter(u => {
      const matchesQuery = !query || u.name.toLowerCase().includes(query) || u.email.toLowerCase().includes(query);
      const matchesStatus = statusVal === 'all' || u.status === statusVal;
      const matchesRole = roleVal === 'all' || u.role === roleVal;
      return matchesQuery && matchesStatus && matchesRole;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-500 italic">No users found.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(u => {
      const joinDate = u.createdAt ? new Date(u.createdAt).toLocaleDateString() : 'N/A';
      const lastLogin = u.lastLogin ? new Date(u.lastLogin).toLocaleString() : 'Never';
      const isSelf = u.email === (window.TradePilotAdminAuth.getUser()?.email);

      let statusBadgeClass = 'bg-slate-800 text-slate-400';
      if (u.status === 'approved' || u.status === 'active') statusBadgeClass = 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
      if (u.status === 'pending') statusBadgeClass = 'bg-amber-500/20 text-amber-300 border border-amber-500/30';
      if (u.status === 'suspended') statusBadgeClass = 'bg-red-500/20 text-red-400 border border-red-500/30';

      return `
        <tr class="hover:bg-slate-950/40 transition-colors">
          <td class="py-3 px-4">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-full bg-slate-800 text-indigo-400 font-bold flex items-center justify-center text-xs">
                ${u.name ? u.name[0].toUpperCase() : 'U'}
              </div>
              <div>
                <p class="font-bold text-slate-200">${u.name}</p>
                <p class="text-[11px] text-slate-500">${u.email}</p>
              </div>
            </div>
          </td>
          <td class="py-3 px-4">
            <span class="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${u.role === 'admin' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 'bg-slate-800 text-slate-400'}">
              ${u.role}
            </span>
          </td>
          <td class="py-3 px-4">
            <span class="px-2.5 py-1 rounded-full text-[10px] font-bold ${statusBadgeClass}">
              ${u.status}
            </span>
          </td>
          <td class="py-3 px-4 text-slate-400 text-[11px]">${joinDate}</td>
          <td class="py-3 px-4 text-slate-400 text-[11px]">${lastLogin}</td>
          <td class="py-3 px-4 text-right space-x-1">
            ${u.status === 'suspended' ? `
              <button onclick="window.AdminActions.updateStatus(${u.id}, 'approved')" class="px-2.5 py-1 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/40 rounded-lg text-[10px] font-bold transition-all" title="Reactivate Account">
                Activate
              </button>
            ` : `
              <button onclick="window.AdminActions.updateStatus(${u.id}, 'suspended')" class="px-2.5 py-1 bg-amber-600/20 text-amber-400 hover:bg-amber-600/40 rounded-lg text-[10px] font-bold transition-all" title="Suspend User">
                Suspend
              </button>
            `}
            <button onclick="window.AdminActions.openResetPw(${u.id}, '${u.email}')" class="p-1.5 text-slate-400 hover:text-indigo-400 transition-colors" title="Reset Password">
              <span class="material-symbols-outlined text-base">key</span>
            </button>
            <button onclick="window.AdminActions.toggleRole(${u.id}, '${u.role}')" class="p-1.5 text-slate-400 hover:text-purple-400 transition-colors" title="Change Role">
              <span class="material-symbols-outlined text-base">badge</span>
            </button>
            ${!isSelf ? `
              <button onclick="window.AdminActions.confirmDeleteUser(${u.id}, '${u.name}')" class="p-1.5 text-slate-400 hover:text-red-400 transition-colors" title="Delete User">
                <span class="material-symbols-outlined text-base">delete</span>
              </button>
            ` : ''}
          </td>
        </tr>
      `;
    }).join('');
  }

  // ==========================================
  // ACCOUNT AUTHORIZATIONS TAB
  // ==========================================
  let currentAuthFilter = 'pending';

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.auth-subtab-btn');
    if (btn) {
      currentAuthFilter = btn.getAttribute('data-auth-status');
      document.querySelectorAll('.auth-subtab-btn').forEach(b => {
        const isSel = b.getAttribute('data-auth-status') === currentAuthFilter;
        b.className = isSel
          ? 'auth-subtab-btn pb-3 border-b-2 border-indigo-500 text-indigo-400 flex items-center gap-2 font-bold'
          : 'auth-subtab-btn pb-3 border-b-2 border-transparent text-slate-400 hover:text-white flex items-center gap-2 font-bold';
      });
      fetchAuthUsers(currentAuthFilter);
    }
  });

  async function fetchAuthUsers(status) {
    try {
      const res = await fetch(`/api/admin/users?status=${status}`, { headers: authHeader() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const tbody = document.getElementById('auth-table-body');
      const pendingBadge = document.getElementById('badge-auth-pending');
      if (status === 'pending' && pendingBadge) {
        pendingBadge.textContent = data.users.length;
      }

      if (!tbody) return;

      if (data.users.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-slate-500 italic">No ${status} account applications.</td></tr>`;
        return;
      }

      tbody.innerHTML = data.users.map(u => `
        <tr class="hover:bg-slate-950/40 transition-colors">
          <td class="py-3.5 px-4 font-bold text-slate-200">${u.name}</td>
          <td class="py-3.5 px-4 text-slate-400">${u.email}</td>
          <td class="py-3.5 px-4">
            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${u.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400' : u.status === 'pending' ? 'bg-amber-500/20 text-amber-300' : 'bg-red-500/20 text-red-400'}">
              ${u.status}
            </span>
          </td>
          <td class="py-3.5 px-4 text-slate-400 text-[11px]">${u.createdAt ? new Date(u.createdAt).toLocaleDateString() : 'N/A'}</td>
          <td class="py-3.5 px-4 text-right space-x-2">
            ${u.status !== 'approved' ? `
              <button onclick="window.AdminActions.updateStatus(${u.id}, 'approved')" class="px-3 py-1 bg-emerald-600 text-white hover:bg-emerald-500 rounded-lg text-xs font-bold transition-all shadow-sm">
                Approve
              </button>
            ` : ''}
            ${u.status !== 'rejected' ? `
              <button onclick="window.AdminActions.updateStatus(${u.id}, 'rejected')" class="px-3 py-1 bg-red-600/20 text-red-400 hover:bg-red-600/40 rounded-lg text-xs font-bold transition-all">
                Reject
              </button>
            ` : ''}
            ${u.status === 'approved' ? `
              <button onclick="window.AdminActions.updateStatus(${u.id}, 'suspended')" class="px-3 py-1 bg-amber-600/20 text-amber-300 hover:bg-amber-600/40 rounded-lg text-xs font-bold transition-all">
                Suspend
              </button>
            ` : ''}
          </td>
        </tr>
      `).join('');
    } catch (err) {
      showToast('Could not load authorization records.', 'error');
    }
  }

  // ==========================================
  // ARTICLE CMS
  // ==========================================
  async function fetchArticles() {
    try {
      const res = await fetch('/api/admin/articles', { headers: authHeader() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      articlesList = data.articles || [];
      renderArticlesTable();
    } catch (err) {
      showToast('Could not load articles.', 'error');
    }
  }

  function renderArticlesTable() {
    const tbody = document.getElementById('articles-table-body');
    if (!tbody) return;

    if (articlesList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-500 italic">No articles found. Click "Create Article" to write one.</td></tr>`;
      return;
    }

    tbody.innerHTML = articlesList.map(a => `
      <tr class="hover:bg-slate-950/40 transition-colors">
        <td class="py-3.5 px-4 font-bold text-slate-200 max-w-xs truncate">${a.title}</td>
        <td class="py-3.5 px-4 text-slate-400 text-xs">${a.category}</td>
        <td class="py-3.5 px-4">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300">${a.difficulty}</span>
        </td>
        <td class="py-3.5 px-4">
          <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${a.status === 'published' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'}">
            ${a.status}
          </span>
        </td>
        <td class="py-3.5 px-4 text-slate-400 text-xs">${a.author || 'TradePilot Team'}</td>
        <td class="py-3.5 px-4 text-right space-x-1">
          <button onclick="window.AdminActions.openEditArticle(${a.id})" class="p-1.5 text-slate-400 hover:text-indigo-400 transition-colors" title="Edit Article">
            <span class="material-symbols-outlined text-base">edit</span>
          </button>
          <button onclick="window.AdminActions.confirmDeleteArticle(${a.id}, '${a.title.replace(/'/g, "\\'")}')" class="p-1.5 text-slate-400 hover:text-red-400 transition-colors" title="Delete Article">
            <span class="material-symbols-outlined text-base">delete</span>
          </button>
        </td>
      </tr>
    `).join('');
  }

  function openArticleModal(article = null) {
    document.getElementById('article-id').value = article ? article.id : '';
    document.getElementById('art-title').value = article ? article.title : '';
    document.getElementById('art-slug').value = article ? article.slug : '';
    document.getElementById('art-category').value = article ? article.category : 'Stock Market Basics';
    document.getElementById('art-difficulty').value = article ? article.difficulty : 'Beginner';
    document.getElementById('art-readtime').value = article ? article.readingTimeMin : 5;
    document.getElementById('art-desc').value = article ? article.description : '';
    document.getElementById('art-image').value = article ? article.featuredImage || '' : '';
    document.getElementById('art-content').value = article ? article.content : '';
    document.getElementById('art-author').value = article ? article.author : 'TradePilot Team';
    document.getElementById('art-tags').value = article && Array.isArray(article.tags) ? article.tags.join(', ') : '';

    document.getElementById('modal-article-title').textContent = article ? 'Edit Learn Article' : 'Create Learn Article';
    document.getElementById('modal-article').classList.remove('hidden');
  }

  function closeArticleModal() {
    document.getElementById('modal-article').classList.add('hidden');
  }

  async function saveArticle(e, targetStatus) {
    if (e) e.preventDefault();
    const id = document.getElementById('article-id').value;
    const title = document.getElementById('art-title').value;
    const slug = document.getElementById('art-slug').value;
    const category = document.getElementById('art-category').value;
    const difficulty = document.getElementById('art-difficulty').value;
    const readingTimeMin = document.getElementById('art-readtime').value;
    const description = document.getElementById('art-desc').value;
    const featuredImage = document.getElementById('art-image').value;
    const content = document.getElementById('art-content').value;
    const author = document.getElementById('art-author').value;
    const tagsRaw = document.getElementById('art-tags').value;
    const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);

    const payload = {
      title, slug, category, difficulty, readingTimeMin,
      description, featuredImage, content, author, tags, status: targetStatus
    };

    try {
      const url = id ? `/api/admin/articles/${id}` : '/api/admin/articles';
      const method = id ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save article.');

      showToast(`Article ${id ? 'updated' : 'created'} successfully!`);
      closeArticleModal();
      fetchArticles();
      loadDashboardStats();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ==========================================
  // QUIZ CMS MANAGER
  // ==========================================
  async function fetchQuizzes() {
    try {
      const res = await fetch('/api/admin/quizzes', { headers: authHeader() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      quizzesList = data.quizzes || [];
      renderQuizzesGrid();
    } catch (err) {
      showToast('Could not load quizzes.', 'error');
    }
  }

  function renderQuizzesGrid() {
    const grid = document.getElementById('quizzes-grid');
    if (!grid) return;

    if (quizzesList.length === 0) {
      grid.innerHTML = `<div class="col-span-3 p-8 text-center text-slate-500 italic bg-slate-900 border border-slate-800 rounded-2xl">No quizzes available. Click "Create New Quiz" to add one.</div>`;
      return;
    }

    grid.innerHTML = quizzesList.map(q => `
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-col justify-between space-y-4">
        <div>
          <div class="flex items-center justify-between mb-2">
            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${q.status === 'published' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'}">
              ${q.status}
            </span>
            <span class="text-[10px] font-bold text-slate-400 bg-slate-800 px-2 py-0.5 rounded">${q.difficulty}</span>
          </div>
          <h3 class="font-bold text-base text-white tracking-tight">${q.title}</h3>
          <p class="text-xs text-slate-400 mt-1 line-clamp-2">${q.description || 'No description provided.'}</p>
        </div>

        <div class="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
          <span class="text-slate-400 font-semibold">${Array.isArray(q.questions) ? q.questions.length : 0} Questions</span>
          <div class="space-x-1">
            <button onclick="window.AdminActions.openEditQuiz(${q.id})" class="p-1.5 text-slate-400 hover:text-amber-400 transition-colors" title="Edit Quiz">
              <span class="material-symbols-outlined text-base">edit</span>
            </button>
            <button onclick="window.AdminActions.confirmDeleteQuiz(${q.id}, '${q.title.replace(/'/g, "\\'")}')" class="p-1.5 text-slate-400 hover:text-red-400 transition-colors" title="Delete Quiz">
              <span class="material-symbols-outlined text-base">delete</span>
            </button>
          </div>
        </div>
      </div>
    `).join('');
  }

  function openQuizModal(quiz = null) {
    document.getElementById('quiz-id').value = quiz ? quiz.id : '';
    document.getElementById('quiz-input-title').value = quiz ? quiz.title : '';
    document.getElementById('quiz-input-category').value = quiz ? quiz.category : 'Stock Market Basics';
    document.getElementById('quiz-input-difficulty').value = quiz ? quiz.difficulty : 'Beginner';
    document.getElementById('quiz-input-score').value = quiz ? quiz.passingScore : 70;
    document.getElementById('quiz-input-desc').value = quiz ? quiz.description : '';

    const qList = document.getElementById('quiz-questions-list');
    qList.innerHTML = '';

    const questions = quiz && Array.isArray(quiz.questions) ? quiz.questions : [
      { question: '', type: 'single', options: ['', '', '', ''], correctIndex: 0, explanation: '' }
    ];

    questions.forEach(q => addQuestionField(q));

    document.getElementById('modal-quiz-title').textContent = quiz ? 'Edit Quiz' : 'Create New Quiz';
    document.getElementById('modal-quiz').classList.remove('hidden');
  }

  function closeQuizModal() {
    document.getElementById('modal-quiz').classList.add('hidden');
  }

  function addQuestionField(qData = null) {
    const list = document.getElementById('quiz-questions-list');
    const idx = list.children.length;

    const qObj = qData || { question: '', type: 'single', options: ['', '', '', ''], correctIndex: 0, explanation: '' };

    const item = document.createElement('div');
    item.className = 'q-item bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3';
    item.innerHTML = `
      <div class="flex items-center justify-between">
        <span class="font-bold text-xs text-indigo-400">Question ${idx + 1}</span>
        <button type="button" class="btn-remove-q text-slate-500 hover:text-red-400"><span class="material-symbols-outlined text-base">close</span></button>
      </div>
      <div>
        <label class="block font-semibold text-slate-400 mb-1">Question Text</label>
        <input type="text" class="q-text w-full p-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white" value="${qObj.question.replace(/"/g, '&quot;')}" required placeholder="e.g. What is a Call Option?"/>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="block font-semibold text-slate-400 mb-1">Option A</label>
          <input type="text" class="q-opt-0 w-full p-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white" value="${(qObj.options[0] || '').replace(/"/g, '&quot;')}" required/>
        </div>
        <div>
          <label class="block font-semibold text-slate-400 mb-1">Option B</label>
          <input type="text" class="q-opt-1 w-full p-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white" value="${(qObj.options[1] || '').replace(/"/g, '&quot;')}" required/>
        </div>
        <div>
          <label class="block font-semibold text-slate-400 mb-1">Option C</label>
          <input type="text" class="q-opt-2 w-full p-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white" value="${(qObj.options[2] || '').replace(/"/g, '&quot;')}"/>
        </div>
        <div>
          <label class="block font-semibold text-slate-400 mb-1">Option D</label>
          <input type="text" class="q-opt-3 w-full p-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white" value="${(qObj.options[3] || '').replace(/"/g, '&quot;')}"/>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="block font-semibold text-slate-400 mb-1">Correct Option</label>
          <select class="q-correct w-full p-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white">
            <option value="0" ${qObj.correctIndex === 0 ? 'selected' : ''}>Option A (Index 0)</option>
            <option value="1" ${qObj.correctIndex === 1 ? 'selected' : ''}>Option B (Index 1)</option>
            <option value="2" ${qObj.correctIndex === 2 ? 'selected' : ''}>Option C (Index 2)</option>
            <option value="3" ${qObj.correctIndex === 3 ? 'selected' : ''}>Option D (Index 3)</option>
          </select>
        </div>
        <div>
          <label class="block font-semibold text-slate-400 mb-1">Explanation</label>
          <input type="text" class="q-exp w-full p-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white" value="${(qObj.explanation || '').replace(/"/g, '&quot;')}" placeholder="Why is this correct?"/>
        </div>
      </div>
    `;

    item.querySelector('.btn-remove-q').addEventListener('click', () => item.remove());
    list.appendChild(item);
  }

  async function saveQuiz(e, targetStatus) {
    if (e) e.preventDefault();
    const id = document.getElementById('quiz-id').value;
    const title = document.getElementById('quiz-input-title').value;
    const category = document.getElementById('quiz-input-category').value;
    const difficulty = document.getElementById('quiz-input-difficulty').value;
    const passingScore = document.getElementById('quiz-input-score').value;
    const description = document.getElementById('quiz-input-desc').value;

    const qNodes = document.querySelectorAll('.q-item');
    const questions = [];

    qNodes.forEach(node => {
      const question = node.querySelector('.q-text').value;
      const opts = [
        node.querySelector('.q-opt-0').value,
        node.querySelector('.q-opt-1').value,
        node.querySelector('.q-opt-2').value,
        node.querySelector('.q-opt-3').value
      ].filter(Boolean);

      const correctIndex = parseInt(node.querySelector('.q-correct').value, 10);
      const explanation = node.querySelector('.q-exp').value;

      if (question.trim()) {
        questions.push({ question, type: 'single', options: opts, correctIndex, explanation });
      }
    });

    const payload = { title, category, difficulty, passingScore, description, questions, status: targetStatus };

    try {
      const url = id ? `/api/admin/quizzes/${id}` : '/api/admin/quizzes';
      const method = id ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save quiz.');

      showToast(`Quiz ${id ? 'updated' : 'created'} successfully!`);
      closeQuizModal();
      fetchQuizzes();
      loadDashboardStats();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ==========================================
  // ACTION HANDLERS (EXPOSED ON WINDOW)
  // ==========================================
  window.AdminActions = {
    updateStatus: async function (userId, status) {
      try {
        const res = await fetch(`/api/admin/users/${userId}/status`, {
          method: 'PATCH',
          headers: { ...authHeader(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ status })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        showToast(`User status set to ${status}.`);
        if (currentTab === 'users') fetchUsers();
        if (currentTab === 'authorizations') fetchAuthUsers(currentAuthFilter);
        loadDashboardStats();
      } catch (err) {
        showToast(err.message, 'error');
      }
    },

    toggleRole: async function (userId, currentRole) {
      const newRole = currentRole === 'admin' ? 'user' : 'admin';
      try {
        const res = await fetch(`/api/admin/users/${userId}/role`, {
          method: 'PATCH',
          headers: { ...authHeader(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: newRole })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        showToast(`User role updated to ${newRole}.`);
        fetchUsers();
      } catch (err) {
        showToast(err.message, 'error');
      }
    },

    openResetPw: function (userId, email) {
      resetUserId = userId;
      document.getElementById('reset-target-email').textContent = email;
      document.getElementById('reset-new-pw').value = '';
      document.getElementById('modal-reset-pw').classList.remove('hidden');
    },

    confirmDeleteUser: function (userId, userName) {
      openConfirmModal(
        'Delete User Account',
        `Are you sure you want to permanently delete the user account for "${userName}"? This operation cannot be undone.`,
        async () => {
          try {
            const res = await fetch(`/api/admin/users/${userId}`, {
              method: 'DELETE',
              headers: authHeader()
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            showToast('User account deleted successfully.');
            fetchUsers();
            loadDashboardStats();
          } catch (err) {
            showToast(err.message, 'error');
          }
        }
      );
    },

    openEditArticle: function (articleId) {
      const art = articlesList.find(a => a.id === articleId);
      if (art) openArticleModal(art);
    },

    confirmDeleteArticle: function (articleId, title) {
      openConfirmModal(
        'Delete Article',
        `Are you sure you want to delete the article "${title}"?`,
        async () => {
          try {
            const res = await fetch(`/api/admin/articles/${articleId}`, {
              method: 'DELETE',
              headers: authHeader()
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            showToast('Article deleted.');
            fetchArticles();
            loadDashboardStats();
          } catch (err) {
            showToast(err.message, 'error');
          }
        }
      );
    },

    openEditQuiz: function (quizId) {
      const q = quizzesList.find(item => item.id === quizId);
      if (q) openQuizModal(q);
    },

    confirmDeleteQuiz: function (quizId, title) {
      openConfirmModal(
        'Delete Quiz',
        `Are you sure you want to delete the quiz "${title}"?`,
        async () => {
          try {
            const res = await fetch(`/api/admin/quizzes/${quizId}`, {
              method: 'DELETE',
              headers: authHeader()
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            showToast('Quiz deleted.');
            fetchQuizzes();
            loadDashboardStats();
          } catch (err) {
            showToast(err.message, 'error');
          }
        }
      );
    }
  };

  async function executePasswordReset() {
    const newPassword = document.getElementById('reset-new-pw').value;
    if (!resetUserId || !newPassword) return;

    try {
      const res = await fetch(`/api/admin/users/${resetUserId}/reset-password`, {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      showToast('User password reset successfully.');
      closeResetPwModal();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function closeResetPwModal() {
    document.getElementById('modal-reset-pw').classList.add('hidden');
    resetUserId = null;
  }

  function openConfirmModal(title, msg, onConfirm) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-msg').textContent = msg;
    confirmCallback = onConfirm;
    document.getElementById('modal-confirm').classList.remove('hidden');
  }

  function closeConfirmModal() {
    document.getElementById('modal-confirm').classList.add('hidden');
    confirmCallback = null;
  }

})();
