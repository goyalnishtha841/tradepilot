(function () {
  const PORTFOLIO_URL = '/api/portfolio';
  const WATCHLIST_URL = '/api/watchlist';

  document.addEventListener('DOMContentLoaded', function () {
    const holdingsList = document.getElementById('holdings-list');
    const holdingsEmpty = document.getElementById('holdings-empty-state');
    const addBtn = document.getElementById('add-holding-btn');
    const form = document.getElementById('add-holding-form');
    const saveBtn = document.getElementById('save-holding-btn');
    const formError = document.getElementById('holding-form-error');
    const summaryBox = document.getElementById('holdings-summary');
    const totalValueEl = document.getElementById('holdings-total-value');
    const totalGainEl = document.getElementById('holdings-total-gain');

    const symbolInput = document.getElementById('holding-symbol');
    const quantityInput = document.getElementById('holding-quantity');
    const avgCostInput = document.getElementById('holding-avg-cost');

    const watchlistContainer = document.getElementById('dashboard-watchlist');
    const watchlistEmpty = document.getElementById('watchlist-empty-state');

    if (!holdingsList) return; // not on this page

    function authHeaders(extra) {
      const h = window.TradePilotAuth ? window.TradePilotAuth.authHeader() : {};
      return { ...h, ...(extra || {}) };
    }

    function fmtMoney(n) {
      return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // --- Holdings ---
    function renderHoldings(holdings, summary) {
      holdingsList.querySelectorAll('.holding-row').forEach((el) => el.remove());

      if (!holdings || holdings.length === 0) {
        holdingsEmpty.classList.remove('hidden');
        summaryBox.classList.add('hidden');
        return;
      }
      holdingsEmpty.classList.add('hidden');
      summaryBox.classList.remove('hidden');

      totalValueEl.textContent = fmtMoney(summary.totalValue);
      const gainPositive = summary.totalGain >= 0;
      totalGainEl.textContent = `${gainPositive ? '+' : ''}${fmtMoney(summary.totalGain)} (${gainPositive ? '+' : ''}${summary.totalGainPercent}%)`;
      totalGainEl.className = 'text-label-sm ' + (gainPositive ? 'text-green-600' : 'text-red-500');

      holdings.forEach((h) => {
        const gainPositive = h.gain >= 0;
        const row = document.createElement('div');
        row.className = 'holding-row flex flex-wrap justify-between items-center p-sm border border-outline-variant/20 rounded-xl gap-sm';
        row.innerHTML = `
          <div class="flex items-center gap-sm">
            <div class="w-10 h-10 bg-primary-container/20 rounded-lg flex items-center justify-center font-bold text-primary">${h.symbol.slice(0, 2)}</div>
            <div>
              <p class="font-bold text-label-md dark:text-inverse-on-surface">${h.symbol}</p>
              <p class="text-label-sm text-on-surface-variant">${h.quantity} shares @ ${fmtMoney(h.avgCost)}</p>
            </div>
          </div>
          <div class="text-right">
            <p class="font-bold text-label-md dark:text-inverse-on-surface">${fmtMoney(h.marketValue)}</p>
            <p class="text-label-sm ${gainPositive ? 'text-green-600' : 'text-red-500'}">${gainPositive ? '+' : ''}${fmtMoney(h.gain)} (${gainPositive ? '+' : ''}${h.gainPercent}%)</p>
          </div>
          <button class="delete-holding-btn text-error text-label-sm font-bold hover:underline" data-id="${h.id}">Remove</button>
        `;
        holdingsList.appendChild(row);
      });

      holdingsList.querySelectorAll('.delete-holding-btn').forEach((btn) => {
        btn.addEventListener('click', () => deleteHolding(btn.getAttribute('data-id')));
      });
    }

    async function loadHoldings() {
      try {
        const res = await fetch(PORTFOLIO_URL, { headers: authHeaders() });
        const data = await res.json();

        if (res.ok) {
          renderHoldings(data.holdings, data.summary);
          renderSectorExposure(data.sectorExposure);
          
          // Update stats
          const totalHoldingsEl = document.getElementById('total-holdings-count');
          const totalSectorsEl = document.getElementById('total-sectors-count');
          const totalInvestedEl = document.getElementById('total-invested-capital');
          
          if (totalHoldingsEl) totalHoldingsEl.textContent = `${data.holdings.length} Position${data.holdings.length === 1 ? '' : 's'}`;
          if (totalSectorsEl) totalSectorsEl.textContent = `${data.sectorExposure.length} Sector${data.sectorExposure.length === 1 ? '' : 's'}`;
          if (totalInvestedEl) totalInvestedEl.textContent = fmtMoney(data.summary.totalCost);
          
          // Trigger news reload for portfolio
          loadPortfolioNews();
        }

      } catch (err) {
        console.error('Could not load holdings', err);
      }
    }

    async function deleteHolding(id) {
      try {
        await fetch(`${PORTFOLIO_URL}/${id}`, { method: 'DELETE', headers: authHeaders() });
        loadHoldings();
      } catch (err) {
        console.error('Could not delete holding', err);
      }
    }

    async function saveHolding() {
      formError.classList.add('hidden');
      const symbol = symbolInput.value.trim().toUpperCase();
      if (!symbol || !legitSymbols.some(s => s.symbol === symbol)) {
        formError.textContent = 'Please select a supported stock symbol (e.g. AAPL, TSLA, NVDA).';
        formError.classList.remove('hidden');
        return;
      }
      const payload = {
        symbol: symbol,
        quantity: quantityInput.value,
        avgCost: avgCostInput.value
      };

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      try {
        const res = await fetch(PORTFOLIO_URL, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (!res.ok) {
          formError.textContent = data.error || 'Could not add holding.';
          formError.classList.remove('hidden');
          return;
        }

        symbolInput.value = '';
        quantityInput.value = '';
        avgCostInput.value = '';
        form.classList.add('hidden');
        loadHoldings();
      } catch (err) {
        formError.textContent = 'Could not reach the server. Make sure it is running (npm start).';
        formError.classList.remove('hidden');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
      }
    }

    addBtn.addEventListener('click', () => form.classList.toggle('hidden'));
    saveBtn.addEventListener('click', saveHolding);

    // --- Watchlist (read-only display here; adding happens from Explore) ---
    async function loadWatchlist() {
      try {
        const res = await fetch(WATCHLIST_URL, { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) return;

        watchlistContainer.querySelectorAll('.watchlist-row').forEach((el) => el.remove());

        if (!data.watchlist || data.watchlist.length === 0) {
          watchlistEmpty.classList.remove('hidden');
          return;
        }
        watchlistEmpty.classList.add('hidden');

        data.watchlist.forEach((item) => {
          const changePositive = item.quote.changePercent >= 0;
          const row = document.createElement('div');
          row.className = 'watchlist-row flex justify-between items-center p-sm border border-outline-variant/20 rounded-xl hover:bg-surface-container transition-colors group';
          row.innerHTML = `
            <div class="flex items-center gap-sm">
              <div class="w-10 h-10 bg-primary-container/20 rounded-lg flex items-center justify-center font-bold text-primary">${item.symbol.slice(0, 2)}</div>
              <div>
                <p class="text-label-md font-bold dark:text-inverse-on-surface">${item.symbol}</p>
                <p class="text-[10px] text-on-surface-variant">${fmtMoney(item.quote.price)}</p>
              </div>
            </div>
            <div class="flex items-center gap-xs">
              <span class="text-label-sm font-bold ${changePositive ? 'text-green-600' : 'text-red-500'}">${changePositive ? '+' : ''}${item.quote.changePercent}%</span>
              <button class="remove-watchlist-btn material-symbols-outlined text-[16px] text-on-surface-variant hover:text-error opacity-0 group-hover:opacity-100 transition-opacity" data-id="${item.id}">close</button>
            </div>
          `;
          watchlistContainer.appendChild(row);
        });

        watchlistContainer.querySelectorAll('.remove-watchlist-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            await fetch(`${WATCHLIST_URL}/${btn.getAttribute('data-id')}`, { method: 'DELETE', headers: authHeaders() });
            loadWatchlist();
          });
        });


        loadWatchlistNews();

      } catch (err) {
        console.error('Could not load watchlist', err);
      }
    }


    // Set dynamic username
    const user = window.TradePilotAuth.getUser();
    if (user) {
      const nameEl = document.getElementById('dashboard-user-name');
      if (nameEl) nameEl.textContent = user.name || user.email.split('@')[0];
    }

    // --- Watchlist Manual Add ---
    const addWatchlistBtn = document.getElementById('add-watchlist-btn');
    const addWatchlistForm = document.getElementById('add-watchlist-form');
    const watchlistSymbolInput = document.getElementById('watchlist-symbol');
    const saveWatchlistBtn = document.getElementById('save-watchlist-btn');
    const watchlistError = document.getElementById('watchlist-form-error');

    if (addWatchlistBtn && addWatchlistForm) {
      addWatchlistBtn.addEventListener('click', () => {
        addWatchlistForm.classList.toggle('hidden');
        watchlistSymbolInput.focus();
      });
      
      saveWatchlistBtn.addEventListener('click', async () => {
        watchlistError.classList.add('hidden');
        const symbol = watchlistSymbolInput.value.trim().toUpperCase();
        if (!symbol || !legitSymbols.some(s => s.symbol === symbol)) {
          watchlistError.textContent = 'Please select a supported stock symbol (e.g. AAPL, TSLA, NVDA).';
          watchlistError.classList.remove('hidden');
          return;
        }
        
        saveWatchlistBtn.disabled = true;
        saveWatchlistBtn.textContent = 'Adding...';
        
        try {
          const res = await fetch(WATCHLIST_URL, {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ symbol })
          });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || 'Failed to add to watchlist.');
          }
          watchlistSymbolInput.value = '';
          addWatchlistForm.classList.add('hidden');
          loadWatchlist();
        } catch (err) {
          watchlistError.textContent = err.message || 'Could not add to watchlist.';
          watchlistError.classList.remove('hidden');
        } finally {
          saveWatchlistBtn.disabled = false;
          saveWatchlistBtn.textContent = 'Add';
        }
      });
    }

    // --- Profile Editing Modal ---
    const openProfileBtn = document.getElementById('open-profile-edit-btn');
    const profileModal = document.getElementById('edit-profile-modal');
    const closeProfileBtn = document.getElementById('close-profile-modal-btn');
    const cancelProfileBtn = document.getElementById('cancel-profile-btn');
    const profileForm = document.getElementById('profile-edit-form');
    const profileEditError = document.getElementById('profile-edit-error');
    const profileEditSuccess = document.getElementById('profile-edit-success');

    if (openProfileBtn && profileModal) {
      openProfileBtn.addEventListener('click', async () => {
        profileEditError.classList.add('hidden');
        profileEditSuccess.classList.add('hidden');
        profileModal.classList.remove('hidden');
        
        try {
          const res = await fetch('/api/onboarding', { headers: authHeaders() });
          const data = await res.json();
          if (res.ok && data.preferences) {
            const prefs = data.preferences;
            document.getElementById('edit-user-type').value = prefs.user_type || 'learner';
            document.getElementById('edit-experience-level').value = prefs.experience_level || 'Beginner';
            document.getElementById('edit-risk-preference').value = prefs.risk_preference || 'Medium';
            document.getElementById('edit-learning-preference').value = prefs.learning_preference || 'Text articles';
            
            const goals = prefs.goals || [];
            document.querySelectorAll('input[name="edit-goal"]').forEach(cb => {
              cb.checked = goals.includes(cb.value);
            });
            
            const sectors = prefs.favorite_sectors || [];
            document.querySelectorAll('input[name="edit-sector"]').forEach(cb => {
              cb.checked = sectors.includes(cb.value);
            });
          }
        } catch (err) {
          console.error('Could not prefill user preferences:', err);
        }
      });

      const hideModal = () => {
        profileModal.classList.add('hidden');
      };
      
      closeProfileBtn.addEventListener('click', hideModal);
      cancelProfileBtn.addEventListener('click', hideModal);
      
      profileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        profileEditError.classList.add('hidden');
        profileEditSuccess.classList.add('hidden');
        
        const userType = document.getElementById('edit-user-type').value;
        const experienceLevel = document.getElementById('edit-experience-level').value;
        const riskPreference = document.getElementById('edit-risk-preference').value;
        const learningPreference = document.getElementById('edit-learning-preference').value;
        
        const goals = [];
        document.querySelectorAll('input[name="edit-goal"]:checked').forEach(cb => {
          goals.push(cb.value);
        });
        
        const sectors = [];
        document.querySelectorAll('input[name="edit-sector"]:checked').forEach(cb => {
          sectors.push(cb.value);
        });
        
        const saveBtn = document.getElementById('save-profile-btn-modal');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        
        try {
          const res = await fetch('/api/onboarding', {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              experienceLevel,
              userType,
              riskPreference,
              learningPreference,
              goals,
              sectors
            })
          });
          
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || 'Failed to save changes.');
          }
          
          profileEditSuccess.textContent = 'Profile preferences updated successfully!';
          profileEditSuccess.classList.remove('hidden');
          
          const localUser = window.TradePilotAuth.getUser();
          if (localUser) {
            localUser.onboardingCompleted = true;
            localStorage.setItem('tradepilot_user', JSON.stringify(localUser));
          }
          
          setTimeout(() => {
            hideModal();
          }, 1000);
        } catch (err) {
          profileEditError.textContent = err.message || 'Could not save profile changes.';
          profileEditError.classList.remove('hidden');
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save Changes';
        }
      });
    }

    // --- Sector Exposure Render ---
    function renderSectorExposure(exposure) {
      const container = document.getElementById('sector-exposure-chart-container');
      if (!container) return;
      container.innerHTML = '';
      
      if (!exposure || exposure.length === 0) {
        container.innerHTML = `<p id="sector-empty-state" class="text-label-md text-on-surface-variant dark:text-outline-variant self-center text-center">Add holdings below to see your sector exposure breakdown.</p>`;
        return;
      }
      
      // Sort exposure descending by percentage
      exposure.sort((a, b) => b.percentage - a.percentage);
      
      exposure.forEach((item, idx) => {
        const bar = document.createElement('div');
        const bgClass = idx === 0 ? 'bg-primary dark:bg-primary-fixed-dim' : 'bg-surface-container-high dark:bg-outline-variant';
        const hoverClass = idx === 0 ? 'hover:opacity-85' : 'hover:bg-primary-container/20';
        
        bar.className = `flex-1 max-w-[64px] w-full ${bgClass} ${hoverClass} rounded-t-xl transition-all cursor-pointer group relative`;
        const hPercent = Math.max(12, Math.round(item.percentage)); // ensure at least 12% for visual bar appearance
        bar.style.height = `${hPercent}%`;
        
        bar.innerHTML = `
          <div class="absolute -top-8 left-1/2 -translate-x-1/2 bg-on-surface text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">${item.sector}: ${item.percentage}%</div>
          <div class="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] font-bold text-on-surface-variant dark:text-outline-variant truncate w-full text-center">${item.sector.slice(0, 10)}</div>
        `;
        container.appendChild(bar);
      });
    }

    // --- Narrative Intelligence News ---
    const portfolioNewsList = document.getElementById('portfolio-news-list');
    const watchlistNewsList = document.getElementById('watchlist-news-list');
    
    function renderNews(listElement, newsItems, emptyText) {
      if (!listElement) return;
      listElement.innerHTML = '';
      if (!newsItems || newsItems.length === 0) {
        listElement.innerHTML = `<p class="col-span-12 text-label-sm text-on-surface-variant dark:text-outline-variant">${emptyText}</p>`;
        return;
      }
      
      newsItems.forEach(item => {
        const card = document.createElement('a');
        card.href = `https://finance.yahoo.com/quote/${item.symbol.trim().toUpperCase()}/news`;
        card.target = '_blank';
        card.className = 'glass-card p-sm flex gap-md items-center group cursor-pointer hover:shadow-md transition-all bg-white dark:bg-surface-container border border-outline-variant/30 rounded-xl';
        
        card.innerHTML = `
          <div class="w-12 h-12 rounded-xl bg-primary-container/20 flex items-center justify-center font-bold text-primary dark:text-primary-fixed-dim shrink-0">
            ${item.symbol}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex gap-2 mb-1 items-center">
               <span class="bg-primary/10 text-primary dark:text-primary-fixed-dim text-[10px] px-2 py-0.5 rounded-full font-bold uppercase">${item.symbol}</span>
               <span class="text-[10px] text-on-surface-variant dark:text-outline-variant">${new Date(item.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
            </div>
            <h4 class="text-label-sm font-bold group-hover:text-primary dark:group-hover:text-primary-fixed-dim transition-colors truncate dark:text-inverse-on-surface">${item.title}</h4>
            <p class="text-[11px] text-on-surface-variant dark:text-outline-variant line-clamp-2 mt-0.5">${item.description}</p>
          </div>
        `;
        listElement.appendChild(card);
      });
    }

    async function loadPortfolioNews() {
      if (!portfolioNewsList) return;
      try {
        const res = await fetch('/api/portfolio/news', { headers: authHeaders() });
        const data = await res.json();
        if (res.ok) {
          renderNews(portfolioNewsList, data.news, 'Add holdings below to see news linked to your portfolio.');
        }
      } catch (err) {
        console.error('Could not load portfolio news', err);
      }
    }

    async function loadWatchlistNews() {
      if (!watchlistNewsList) return;
      try {
        const res = await fetch('/api/watchlist/news', { headers: authHeaders() });
        const data = await res.json();
        if (res.ok) {
          renderNews(watchlistNewsList, data.news, 'Add symbols to your watchlist to see watchlist news.');
        }
      } catch (err) {
        console.error('Could not load watchlist news', err);
      }
    }

    // Tab interaction
    const tabPortfolioBtn = document.getElementById('tab-portfolio-news');
    const tabWatchlistBtn = document.getElementById('tab-watchlist-news');

    if (tabPortfolioBtn && tabWatchlistBtn) {
      tabPortfolioBtn.addEventListener('click', () => {
        // Toggle tab styles
        tabPortfolioBtn.className = 'px-4 py-1.5 bg-primary dark:bg-primary-fixed-dim text-white dark:text-primary rounded-lg font-bold text-label-sm transition-all shadow-sm';
        tabWatchlistBtn.className = 'px-4 py-1.5 text-on-surface-variant hover:text-primary dark:text-outline-variant dark:hover:text-inverse-primary rounded-lg font-bold text-label-sm transition-all';
        
        // Show/hide lists
        portfolioNewsList.classList.remove('hidden');
        watchlistNewsList.classList.add('hidden');
      });

      tabWatchlistBtn.addEventListener('click', () => {
        // Toggle tab styles
        tabWatchlistBtn.className = 'px-4 py-1.5 bg-primary dark:bg-primary-fixed-dim text-white dark:text-primary rounded-lg font-bold text-label-sm transition-all shadow-sm';
        tabPortfolioBtn.className = 'px-4 py-1.5 text-on-surface-variant hover:text-primary dark:text-outline-variant dark:hover:text-inverse-primary rounded-lg font-bold text-label-sm transition-all';
        
        // Show/hide lists
        watchlistNewsList.classList.remove('hidden');
        portfolioNewsList.classList.add('hidden');
      });
    }


    // --- Autocomplete logic ---
    let legitSymbols = [];
    async function fetchLegitSymbols() {
      try {
        const res = await fetch('/api/market/symbols', { headers: authHeaders() });
        const data = await res.json();
        if (res.ok && data.symbols) {
          legitSymbols = data.symbols;
          setupAutocomplete(watchlistSymbolInput, document.getElementById('watchlist-suggestions'), legitSymbols);
          setupAutocomplete(symbolInput, document.getElementById('holding-suggestions'), legitSymbols);
        }
      } catch (err) {
        console.error('Failed to load legit symbols', err);
      }
    }

    function setupAutocomplete(input, suggestionsContainer, symbols) {
      if (!input || !suggestionsContainer) return;
      
      let activeIndex = -1;
      let filtered = [];

      function showSuggestions() {
        const query = input.value.trim().toUpperCase();
        suggestionsContainer.innerHTML = '';
        activeIndex = -1;
        
        if (!query) {
          suggestionsContainer.classList.add('hidden');
          return;
        }

        filtered = symbols.filter(s => 
          s.symbol.startsWith(query) || 
          s.name.toUpperCase().includes(query)
        );

        if (filtered.length === 0) {
          suggestionsContainer.classList.add('hidden');
          return;
        }

        suggestionsContainer.classList.remove('hidden');
        filtered.forEach((item, idx) => {
          const itemEl = document.createElement('div');
          itemEl.className = 'w-full px-3 py-2.5 cursor-pointer text-label-sm border-b border-outline-variant/10 last:border-b-0 flex justify-between items-center transition-colors dark:text-inverse-on-surface hover:bg-primary/10 dark:hover:bg-primary-container/45';
          itemEl.innerHTML = `
            <span class="font-bold shrink-0">${item.symbol}</span>
            <span class="text-[11px] text-on-surface-variant dark:text-outline-variant truncate ml-4 text-right">${item.name}</span>
          `;
          
          itemEl.addEventListener('mousedown', (e) => {
            e.preventDefault();
            selectItem(item.symbol);
          });
          
          suggestionsContainer.appendChild(itemEl);
        });
      }

      function selectItem(symbol) {
        input.value = symbol;
        suggestionsContainer.classList.add('hidden');
        input.focus();
      }

      function highlightItem() {
        Array.from(suggestionsContainer.children).forEach((child, idx) => {
          if (idx === activeIndex) {
            child.classList.add('bg-primary/20', 'dark:bg-primary-container/60');
            child.scrollIntoView({ block: 'nearest' });
          } else {
            child.classList.remove('bg-primary/20', 'dark:bg-primary-container/60');
          }
        });
      }

      function clearError() {
        if (input === watchlistSymbolInput) {
          watchlistError.classList.add('hidden');
        } else if (input === symbolInput) {
          formError.classList.add('hidden');
        }
      }

      input.addEventListener('input', () => {
        clearError();
        showSuggestions();
      });
      input.addEventListener('focus', () => {
        clearError();
        showSuggestions();
      });
      input.addEventListener('blur', () => {
        setTimeout(() => {
          suggestionsContainer.classList.add('hidden');
        }, 150);
      });

      input.addEventListener('keydown', (e) => {
        const items = suggestionsContainer.children;
        if (suggestionsContainer.classList.contains('hidden')) return;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          activeIndex = (activeIndex + 1) % items.length;
          highlightItem();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          activeIndex = (activeIndex - 1 + items.length) % items.length;
          highlightItem();
        } else if (e.key === 'Enter') {
          if (activeIndex >= 0 && activeIndex < filtered.length) {
            e.preventDefault();
            selectItem(filtered[activeIndex].symbol);
          }
        } else if (e.key === 'Escape') {
          suggestionsContainer.classList.add('hidden');
        }
      });
    }

    loadHoldings();
    loadWatchlist();
    fetchLegitSymbols();
  });
})();
