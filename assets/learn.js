(function () {
  'use strict';

  let allArticles = [];
  let allQuizzes = [];
  let selectedCategory = 'ALL';
  let selectedDifficulty = 'ALL';
  let searchQuery = '';

  document.addEventListener('DOMContentLoaded', () => {
    const theorySec = document.getElementById('section-theory');
    if (!theorySec) return;

    initCategorySidebar();
    initFilters();
    loadArticles();
    loadQuizzes();

    // Article Reader Modal Close
    document.getElementById('btn-close-article-reader')?.addEventListener('click', closeArticleReader);

    // Quiz Drawer Close
    document.getElementById('btn-close-quiz-drawer')?.addEventListener('click', closeQuizDrawer);
  });

  function authHeader() {
    return window.TradePilotAuth ? window.TradePilotAuth.authHeader() : {};
  }

  function initCategorySidebar() {
    const catBtns = document.querySelectorAll('.varsity-cat-btn');
    catBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        catBtns.forEach(b => {
          b.classList.remove('bg-primary/10', 'text-primary', 'border-primary', 'dark:bg-dark-primary/20', 'dark:text-dark-primary');
          b.classList.add('text-on-surface-variant', 'hover:bg-surface-container-high', 'dark:text-dark-on-surface-variant');
        });

        btn.classList.add('bg-primary/10', 'text-primary', 'border-primary', 'dark:bg-dark-primary/20', 'dark:text-dark-primary');
        btn.classList.remove('text-on-surface-variant', 'hover:bg-surface-container-high');

        selectedCategory = btn.getAttribute('data-category') || 'ALL';
        renderArticles();
      });
    });
  }

  function initFilters() {
    const searchInput = document.getElementById('varsity-search-input');
    const diffSelect = document.getElementById('varsity-difficulty-select');

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim().toLowerCase();
        renderArticles();
      });
    }

    if (diffSelect) {
      diffSelect.addEventListener('change', (e) => {
        selectedDifficulty = e.target.value;
        renderArticles();
      });
    }
  }

  async function loadArticles() {
    const grid = document.getElementById('varsity-articles-grid');
    if (!grid) return;

    grid.innerHTML = `
      <div class="col-span-full p-8 text-center text-on-surface-variant dark:text-dark-on-surface-variant animate-pulse">
        Loading educational articles...
      </div>
    `;

    try {
      const res = await fetch('/api/articles');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      allArticles = data.articles || [];
      renderArticles();
    } catch (err) {
      grid.innerHTML = `
        <div class="col-span-full p-6 text-center text-red-500 font-bold">
          Could not load articles. Make sure the server is running.
        </div>
      `;
    }
  }

  function renderArticles() {
    const grid = document.getElementById('varsity-articles-grid');
    const countEl = document.getElementById('varsity-articles-count');
    if (!grid) return;

    const filtered = allArticles.filter(art => {
      const matchCat = selectedCategory === 'ALL' || art.category === selectedCategory;
      const matchDiff = selectedDifficulty === 'ALL' || art.difficulty === selectedDifficulty;
      const matchSearch = !searchQuery ||
        art.title.toLowerCase().includes(searchQuery) ||
        (art.description && art.description.toLowerCase().includes(searchQuery)) ||
        (art.category && art.category.toLowerCase().includes(searchQuery));
      return matchCat && matchDiff && matchSearch;
    });

    if (countEl) countEl.textContent = `${filtered.length} Articles`;

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="col-span-full p-8 text-center text-on-surface-variant dark:text-dark-on-surface-variant bg-white dark:bg-dark-surface-container rounded-20px border border-outline-variant/30">
          <span class="material-symbols-outlined text-4xl mb-2 text-primary dark:text-dark-primary">search_off</span>
          <p class="font-bold text-sm">No articles match your selected filters.</p>
          <p class="text-xs opacity-75 mt-1">Try clearing your search term or category selection.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = filtered.map(art => {
      const img = art.featuredImage || 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&auto=format&fit=crop&q=60';
      const readTime = art.readingTimeMin || 5;
      const pubDate = art.publishedAt ? new Date(art.publishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recently';

      let diffColor = 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300';
      if (art.difficulty === 'Intermediate') diffColor = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300';
      if (art.difficulty === 'Advanced') diffColor = 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300';

      return `
        <div class="group bg-white dark:bg-dark-surface-container border border-outline-variant/30 rounded-20px card-shadow overflow-hidden flex flex-col justify-between hover:border-primary transition-all duration-300 cursor-pointer" onclick="window.VarsityApp.openArticle(${art.id})">
          <div>
            <div class="relative h-44 overflow-hidden">
              <img src="${img}" alt="${art.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"/>
              <div class="absolute top-3 left-3 flex gap-2">
                <span class="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-white/90 dark:bg-dark-surface/90 text-primary dark:text-dark-primary shadow-sm backdrop-blur-sm">
                  ${art.category}
                </span>
              </div>
              <span class="absolute bottom-3 right-3 px-2.5 py-1 rounded-full text-[10px] font-bold ${diffColor} backdrop-blur-sm">
                ${art.difficulty}
              </span>
            </div>
            <div class="p-md">
              <div class="flex items-center gap-2 text-[11px] text-on-surface-variant dark:text-dark-on-surface-variant font-semibold mb-2">
                <span class="flex items-center gap-1"><span class="material-symbols-outlined text-xs">schedule</span> ${readTime} min read</span>
                <span>•</span>
                <span>${pubDate}</span>
              </div>
              <h3 class="font-title-md text-title-md font-bold tracking-tight text-on-surface dark:text-dark-on-surface mb-2 group-hover:text-primary dark:group-hover:text-dark-primary transition-colors line-clamp-2">
                ${art.title}
              </h3>
              <p class="text-body-md text-xs text-on-surface-variant dark:text-dark-on-surface-variant line-clamp-3 leading-relaxed">
                ${art.description || ''}
              </p>
            </div>
          </div>

          <div class="p-md pt-0 border-t border-outline-variant/10 flex items-center justify-between mt-auto">
            <span class="text-xs font-semibold text-on-surface-variant dark:text-dark-on-surface-variant">By ${art.author || 'TradePilot'}</span>
            <span class="text-xs font-bold text-primary dark:text-dark-primary flex items-center gap-1 group-hover:translate-x-1 transition-transform">
              Read Article <span class="material-symbols-outlined text-sm">arrow_forward</span>
            </span>
          </div>
        </div>
      `;
    }).join('');
  }

  async function loadQuizzes() {
    const container = document.getElementById('varsity-quizzes-container');
    if (!container) return;

    try {
      const res = await fetch('/api/quiz/list', { headers: authHeader() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      allQuizzes = data.quizzes || [];
      renderQuizzes();
    } catch (err) {
      console.error('Failed to load quizzes:', err);
    }
  }

  function renderQuizzes() {
    const container = document.getElementById('varsity-quizzes-container');
    if (!container) return;

    if (allQuizzes.length === 0) {
      container.innerHTML = `
        <div class="p-6 text-center text-xs text-on-surface-variant italic">No active quizzes right now.</div>
      `;
      return;
    }

    container.innerHTML = allQuizzes.map(q => `
      <div class="p-md rounded-20px border-2 border-indigo-500/30 bg-gradient-to-br from-indigo-500/10 via-white to-purple-500/10 dark:from-indigo-950/40 dark:via-dark-surface-container dark:to-purple-950/30 card-shadow flex flex-col justify-between relative overflow-hidden group">
        <div class="relative z-10">
          <div class="flex items-center justify-between mb-2">
            <span class="bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full">
              Quiz Module
            </span>
            <span class="text-[10px] font-bold text-on-surface-variant dark:text-dark-on-surface-variant">
              Pass score: ${q.passingScore || 70}%
            </span>
          </div>
          <h4 class="font-bold text-sm text-on-surface dark:text-dark-on-surface mb-1">${q.title}</h4>
          <p class="text-xs text-on-surface-variant dark:text-dark-on-surface-variant mb-4 leading-relaxed">${q.description || ''}</p>
        </div>

        <div class="relative z-10 flex items-center justify-between pt-2 border-t border-outline-variant/20">
          <span class="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
            <span class="material-symbols-outlined text-sm">help_outline</span> ${q.questionCount} Questions
          </span>
          <button onclick="window.VarsityApp.openQuiz(${q.id})" class="px-4 py-1.5 bg-primary hover:bg-primary/90 text-white dark:bg-dark-primary dark:text-dark-on-primary text-xs font-bold rounded-xl transition-all shadow-sm">
            Take Quiz
          </button>
        </div>
      </div>
    `).join('');
  }

  // --- Article Reader Modal ---
  async function openArticle(id) {
    const modal = document.getElementById('modal-article-reader');
    const titleEl = document.getElementById('reader-title');
    const metaEl = document.getElementById('reader-meta');
    const bodyEl = document.getElementById('reader-body');
    if (!modal) return;

    bodyEl.innerHTML = '<p class="text-center p-8 opacity-70">Loading article content...</p>';
    modal.classList.remove('hidden');

    try {
      const res = await fetch(`/api/articles/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const art = data.article;
      titleEl.textContent = art.title;
      metaEl.textContent = `${art.category} • By ${art.author || 'TradePilot Team'} • ${art.readingTimeMin || 5} min read`;

      // Render Markdown / HTML formatted body
      let html = art.content
        .replace(/^### (.*$)/gim, '<h3 class="text-lg font-bold mt-6 mb-2 text-primary dark:text-dark-primary">$1</h3>')
        .replace(/^## (.*$)/gim, '<h2 class="text-xl font-bold mt-6 mb-3 text-primary dark:text-dark-primary">$1</h2>')
        .replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold mt-6 mb-4 text-primary dark:text-dark-primary">$1</h1>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/^- (.*$)/gim, '<li class="ml-4 list-disc text-xs leading-relaxed my-1">$1</li>')
        .replace(/\n\n/g, '</p><p class="my-3 text-xs leading-relaxed">');

      bodyEl.innerHTML = `<p class="my-3 text-xs leading-relaxed">${html}</p>`;
    } catch (err) {
      bodyEl.innerHTML = `<p class="text-center p-8 text-red-500 font-bold">Could not load article.</p>`;
    }
  }

  function closeArticleReader() {
    document.getElementById('modal-article-reader')?.classList.add('hidden');
  }

  // --- Quiz Interactive Modal ---
  let activeQuizData = null;
  let activeQuizAnswers = {};
  let activeQuizCurrentIdx = 0;

  async function openQuiz(quizId) {
    const modal = document.getElementById('modal-quiz-drawer');
    const container = document.getElementById('quiz-drawer-content');
    if (!modal || !container) return;

    container.innerHTML = '<p class="text-center p-8 opacity-70">Loading quiz questions...</p>';
    modal.classList.remove('hidden');

    try {
      const res = await fetch(`/api/quiz/${quizId}`, { headers: authHeader() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      activeQuizData = data.quiz;
      activeQuizAnswers = {};
      activeQuizCurrentIdx = 0;

      renderQuizQuestion();
    } catch (err) {
      container.innerHTML = `<p class="text-center p-8 text-red-500 font-bold">Could not load quiz questions.</p>`;
    }
  }

  function renderQuizQuestion() {
    const container = document.getElementById('quiz-drawer-content');
    const titleEl = document.getElementById('quiz-drawer-title');
    if (!activeQuizData || !container) return;

    titleEl.textContent = activeQuizData.title;
    const questions = activeQuizData.questions || [];
    const q = questions[activeQuizCurrentIdx];

    if (!q) {
      submitQuizAnswers();
      return;
    }

    container.innerHTML = `
      <div class="space-y-4">
        <div class="flex justify-between items-center text-xs font-bold text-on-surface-variant dark:text-dark-on-surface-variant">
          <span>Question ${activeQuizCurrentIdx + 1} of ${questions.length}</span>
          <span>Pass Threshold: ${activeQuizData.passingScore}%</span>
        </div>

        <p class="font-bold text-sm text-on-surface dark:text-dark-on-surface leading-relaxed border-l-4 border-indigo-500 pl-3">
          ${q.question}
        </p>

        <div class="space-y-2 pt-2">
          ${q.options.map((opt, i) => `
            <button class="quiz-drawer-option w-full text-left p-3 rounded-xl border border-outline-variant/30 hover:border-indigo-500 hover:bg-indigo-500/10 transition-all text-xs font-semibold text-on-surface dark:text-dark-on-surface" data-index="${i}">
              ${opt}
            </button>
          `).join('')}
        </div>
      </div>
    `;

    container.querySelectorAll('.quiz-drawer-option').forEach(btn => {
      btn.addEventListener('click', () => {
        activeQuizAnswers[activeQuizCurrentIdx] = parseInt(btn.getAttribute('data-index'), 10);
        if (activeQuizCurrentIdx < questions.length - 1) {
          activeQuizCurrentIdx++;
          renderQuizQuestion();
        } else {
          submitQuizAnswers();
        }
      });
    });
  }

  async function submitQuizAnswers() {
    const container = document.getElementById('quiz-drawer-content');
    if (!container || !activeQuizData) return;

    container.innerHTML = '<p class="text-center p-8 opacity-70">Scoring your responses...</p>';

    try {
      const res = await fetch(`/api/quiz/${activeQuizData.id}/submit`, {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: activeQuizAnswers })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      container.innerHTML = `
        <div class="text-center space-y-4 p-4">
          <div class="w-16 h-16 rounded-full ${data.passed ? 'bg-emerald-500/20 text-emerald-500' : 'bg-amber-500/20 text-amber-500'} flex items-center justify-center mx-auto">
            <span class="material-symbols-outlined text-3xl">${data.passed ? 'emoji_events' : 'refresh'}</span>
          </div>

          <h3 class="font-bold text-xl text-on-surface dark:text-dark-on-surface">
            ${data.passed ? 'Quiz Passed! 🎉' : 'Keep Practicing!'}
          </h3>

          <p class="text-sm font-semibold text-on-surface-variant dark:text-dark-on-surface-variant">
            You scored <b class="text-primary dark:text-dark-primary">${data.score} / ${data.total}</b> (${data.percentage}%)
          </p>

          <div class="text-left space-y-3 border-t border-outline-variant/20 pt-4 max-h-60 overflow-y-auto pt-scrollbar text-xs">
            ${data.results.map((r, i) => `
              <div class="p-3 rounded-xl ${r.correct ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-red-500/10 border border-red-500/20'}">
                <p class="font-bold mb-1">${i + 1}. ${r.question}</p>
                <p class="text-[11px] ${r.correct ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}">
                  ${r.correct ? '✓ Correct Answer' : '✗ Incorrect choice'}
                </p>
                ${r.explanation ? `<p class="text-[10px] text-on-surface-variant dark:text-dark-on-surface-variant mt-1 italic">${r.explanation}</p>` : ''}
              </div>
            `).join('')}
          </div>

          <button onclick="window.VarsityApp.openQuiz(${activeQuizData.id})" class="w-full py-2.5 bg-primary text-white rounded-xl font-bold text-xs">
            Retake Quiz
          </button>
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<p class="text-center p-8 text-red-500 font-bold">Could not submit quiz answers.</p>`;
    }
  }

  function closeQuizDrawer() {
    document.getElementById('modal-quiz-drawer')?.classList.add('hidden');
    activeQuizData = null;
  }

  // Export App
  window.VarsityApp = {
    openArticle,
    openQuiz
  };

})();
