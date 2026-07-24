(function () {
  const PORTFOLIO_URL = '/api/portfolio';
  const WATCHLIST_URL = '/api/watchlist';
  const MARKET_HEADLINES_URL = '/api/news/market-headlines';
  const NEWS_REFRESH_MS = 5 * 60 * 1000;

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

    const portfolioNewsList = document.getElementById('portfolio-news-list');
    const watchlistNewsList = document.getElementById('watchlist-news-list');

    if (!holdingsList) return; // not on this page

    // Lock flags to prevent overlapping duplicate requests
    let isFetchingPortfolio = false;
    let isFetchingWatchlist = false;
    let isFetchingNews = false;

    // Cache latest fetched data to avoid duplicate API calls
    let lastPortfolioData = null;
    let lastUpdatedTime = '';
    let editingHoldingId = null;

    function authHeaders(extra) {
      const h = window.TradePilotAuth ? window.TradePilotAuth.authHeader() : {};
      return { ...h, ...(extra || {}) };
    }

    function formatMoneyWithIntl(amount, currencyCode = 'INR') {
      if (amount === null || amount === undefined || isNaN(amount)) return 'N/A';
      const code = String(currencyCode || 'INR').toUpperCase();
      let locale = 'en-US';
      if (code === 'INR') locale = 'en-IN';
      else if (code === 'GBP') locale = 'en-GB';
      else if (code === 'EUR') locale = 'de-DE';
      else if (code === 'JPY') locale = 'ja-JP';

      try {
        return new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: code,
          minimumFractionDigits: (code === 'JPY') ? 0 : 2,
          maximumFractionDigits: (code === 'JPY') ? 0 : 2
        }).format(amount);
      } catch (e) {
        const sym = getCurrencySymbol(code);
        const numStr = Number(Math.abs(amount)).toLocaleString(undefined, {
          minimumFractionDigits: (code === 'JPY') ? 0 : 2,
          maximumFractionDigits: (code === 'JPY') ? 0 : 2
        });
        return `${amount < 0 ? '-' : ''}${sym}${numStr}`;
      }
    }

    function formatPortfolioReturn(gain, gainPercent, baseCurrency = 'INR') {
      if (gain === null || gain === undefined || isNaN(gain)) return 'N/A';
      const isPositive = gain > 0;
      const isNegative = gain < 0;
      const absGain = Math.abs(gain);
      const formattedVal = formatMoneyWithIntl(absGain, baseCurrency);
      const absPercent = Math.abs(Number(gainPercent || 0)).toFixed(2);

      if (isPositive) {
        return `+${formattedVal} (+${absPercent}%)`;
      } else if (isNegative) {
        return `-${formattedVal} (-${absPercent}%)`;
      } else {
        return `${formatMoneyWithIntl(0, baseCurrency)} (0.00%)`;
      }
    }

    function fmtMoney(n, currencyCode = 'USD') {
      return formatMoneyWithIntl(n, currencyCode);
    }

    function getCurrencySymbol(code) {
      if (!code) return '$';
      const c = String(code).toUpperCase();
      const map = {
        INR: '₹',
        USD: '$',
        EUR: '€',
        GBP: '£',
        JPY: '¥',
        CNY: '¥',
        CAD: 'CA$',
        AUD: 'A$',
        HKD: 'HK$',
        SGD: 'S$'
      };
      return map[c] || (c + ' ');
    }

    function detectSymbolCurrency(symbol) {
      const sym = String(symbol || '').trim().toUpperCase();
      if (sym.endsWith('.NS') || sym.endsWith('.BO')) return 'INR';
      if (sym.endsWith('.L')) return 'GBP';
      if (sym.endsWith('.PA') || sym.endsWith('.DE') || sym.endsWith('.F') || sym.endsWith('.AS') || sym.endsWith('.MI')) return 'EUR';
      if (sym.endsWith('.TO') || sym.endsWith('.V')) return 'CAD';
      if (sym.endsWith('.AX')) return 'AUD';
      if (sym.endsWith('.T')) return 'JPY';
      if (sym.endsWith('.HK')) return 'HKD';
      const indianTickers = ['GODREJPROP', 'RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'TATAMOTORS', 'SBIN', 'ITC', 'BHARTIARTL', 'WIPRO', 'LT'];
      if (indianTickers.includes(sym)) return 'INR';
      return 'USD';
    }

    function updateAddHoldingCostLabel() {
      const labelEl = document.getElementById('holding-avg-cost-label');
      if (!labelEl) return;
      const sym = symbolInput ? symbolInput.value : '';
      if (!sym) {
        labelEl.textContent = 'Avg. Cost / Share';
        return;
      }
      const curr = detectSymbolCurrency(sym);
      const symIcon = getCurrencySymbol(curr);
      labelEl.textContent = `Avg. Cost / Share (${curr} ${symIcon})`;
    }

    if (symbolInput) {
      symbolInput.addEventListener('input', updateAddHoldingCostLabel);
    }

    function formatHoldingPrice(price, currency) {
      if (price === null || price === undefined || isNaN(price)) return 'N/A';
      return formatMoneyWithIntl(price, currency);
    }

    function formatHoldingReturn(gain, gainPercent, currency) {
      if (gain === null || gain === undefined || isNaN(gain)) return 'N/A';
      const isPositive = gain > 0;
      const isNegative = gain < 0;
      const absGain = Math.abs(gain);
      const formattedVal = formatMoneyWithIntl(absGain, currency);
      const absPercent = Math.abs(Number(gainPercent || 0)).toFixed(2);

      if (isPositive) {
        return `+${formattedVal} (+${absPercent}%)`;
      } else if (isNegative) {
        return `-${formattedVal} (-${absPercent}%)`;
      } else {
        return `${formatMoneyWithIntl(0, currency)} (0.00%)`;
      }
    }

    // --- Skeletons ---
    function showHoldingsSkeleton() {
      holdingsList.querySelectorAll('.holding-row').forEach((el) => el.remove());
      holdingsEmpty.classList.add('hidden');
      for (let i = 0; i < 3; i++) {
        const row = document.createElement('div');
        row.className = 'holding-row holding-skeleton animate-pulse p-md border border-outline-variant/10 rounded-2xl bg-white dark:bg-surface-container-high/40 mb-sm flex flex-col justify-between';
        row.innerHTML = `
          <div class="grid grid-cols-12 gap-xs sm:gap-sm items-start w-full">
            <div class="col-span-5 space-y-2">
              <div class="h-3 bg-slate-200 dark:bg-slate-700 rounded w-16"></div>
              <div class="h-4 bg-slate-200 dark:bg-slate-700 rounded w-28"></div>
            </div>
            <div class="col-span-3 space-y-2">
              <div class="h-3 bg-slate-200 dark:bg-slate-700 rounded w-16"></div>
              <div class="h-4 bg-slate-200 dark:bg-slate-700 rounded w-16"></div>
            </div>
            <div class="col-span-4 space-y-2">
              <div class="h-3 bg-slate-200 dark:bg-slate-700 rounded w-16"></div>
              <div class="h-4 bg-slate-200 dark:bg-slate-700 rounded w-24"></div>
            </div>
          </div>
          <div class="flex items-center justify-end gap-sm mt-md pt-sm border-t border-outline-variant/10">
            <div class="h-7 bg-slate-200 dark:bg-slate-700 rounded-lg w-16"></div>
            <div class="h-7 bg-slate-200 dark:bg-slate-700 rounded-lg w-20"></div>
          </div>
        `;
        holdingsList.appendChild(row);
      }
    }

    function showWatchlistSkeleton() {
      watchlistContainer.querySelectorAll('.watchlist-row').forEach((el) => el.remove());
      watchlistEmpty.classList.add('hidden');
      for (let i = 0; i < 3; i++) {
        const row = document.createElement('div');
        row.className = 'watchlist-row watchlist-skeleton animate-pulse flex justify-between items-center p-sm border border-outline-variant/10 rounded-xl gap-sm';
        row.innerHTML = `
          <div class="flex items-center gap-sm w-2/3">
            <div class="w-10 h-10 bg-slate-200 dark:bg-slate-700 rounded-lg"></div>
            <div class="flex-grow space-y-2">
              <div class="h-4 bg-slate-200 dark:bg-slate-700 rounded w-12"></div>
              <div class="h-3 bg-slate-200 dark:bg-slate-700 rounded w-16"></div>
            </div>
          </div>
          <div class="text-right w-1/6 flex flex-col items-end">
            <div class="h-4 bg-slate-200 dark:bg-slate-700 rounded w-12"></div>
          </div>
        `;
        watchlistContainer.appendChild(row);
      }
    }

    function showNewsSkeleton(listElement) {
      if (!listElement) return;
      listElement.innerHTML = '';
      const emptyTextEl = listElement.id === 'portfolio-news-list'
        ? document.getElementById('portfolio-news-empty')
        : document.getElementById('watchlist-news-empty');
      if (emptyTextEl) emptyTextEl.classList.add('hidden');

      for (let i = 0; i < 2; i++) {
        const card = document.createElement('div');
        card.className = 'news-skeleton animate-pulse p-sm flex gap-md items-center border border-outline-variant/10 rounded-xl bg-white dark:bg-surface-container';
        card.innerHTML = `
          <div class="w-12 h-12 rounded-xl bg-slate-200 dark:bg-slate-700 shrink-0"></div>
          <div class="flex-grow space-y-2">
            <div class="flex gap-2">
              <div class="h-3 bg-slate-200 dark:bg-slate-700 rounded w-10"></div>
              <div class="h-3 bg-slate-200 dark:bg-slate-700 rounded w-12"></div>
            </div>
            <div class="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4"></div>
            <div class="h-3 bg-slate-200 dark:bg-slate-700 rounded w-5/6"></div>
          </div>
        `;
        listElement.appendChild(card);
      }
    }

    function showPortfolioError(msg) {
      holdingsList.innerHTML = `<p class="text-label-sm text-error p-md bg-error-container/20 rounded-xl text-center">${msg}</p>`;
      const container = document.getElementById('sector-exposure-chart-container');
      if (container) {
        container.innerHTML = `<p class="text-label-sm text-error p-md text-center">Failed to load sector breakdown.</p>`;
      }
    }

    function showWatchlistError(msg) {
      watchlistContainer.innerHTML = `<p class="text-label-sm text-error p-md bg-error-container/20 rounded-xl text-center">${msg}</p>`;
    }

    // --- Time-based Greetings ---
    function updateGreeting() {
      const greetingEl = document.getElementById('dashboard-greeting');
      if (!greetingEl) return;
      const hours = new Date().getHours();
      let greeting = 'Good morning';
      if (hours >= 12 && hours < 18) {
        greeting = 'Good afternoon';
      } else if (hours >= 18) {
        greeting = 'Good evening';
      }
      greetingEl.textContent = greeting;
    }
    updateGreeting();

    function updateLastUpdatedStatus() {
      const statusEl = document.getElementById('last-updated-status');
      if (!statusEl) return;
      statusEl.textContent = `Last updated: ${lastUpdatedTime}`;
    }

    // --- Holdings ---
    function renderHoldings(holdings, summary) {
      holdingsList.querySelectorAll('.holding-row').forEach((el) => el.remove());
      holdingsList.querySelectorAll('.holding-skeleton').forEach((el) => el.remove());

      if (!holdings || holdings.length === 0) {
        holdingsEmpty.classList.remove('hidden');
        summaryBox.classList.add('hidden');
        return;
      }
      holdingsEmpty.classList.add('hidden');
      summaryBox.classList.remove('hidden');

      const baseCurrency = (summary && summary.baseCurrency) ? summary.baseCurrency : 'INR';

      // Update Base Currency selector value if present
      const baseSelect = document.getElementById('base-currency-select');
      if (baseSelect && baseSelect.value !== baseCurrency) {
        baseSelect.value = baseCurrency;
      }

      totalValueEl.textContent = formatMoneyWithIntl(summary.totalValue, baseCurrency);
      const gainPositive = summary.totalGain >= 0;
      totalGainEl.textContent = formatPortfolioReturn(summary.totalGain, summary.totalGainPercent, baseCurrency);
      totalGainEl.className = 'text-label-sm font-bold ' + (gainPositive ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400');

      const subtextEl = document.getElementById('holdings-fx-subtext');
      if (subtextEl) {
        if (summary && summary.fxWarning) {
          subtextEl.textContent = 'Currency conversion temporarily unavailable';
        } else if (summary && summary.hasFallback) {
          subtextEl.textContent = `Portfolio valuation uses an estimated fallback exchange rate for ${baseCurrency}`;
        } else {
          subtextEl.textContent = `Portfolio values converted to ${baseCurrency} using latest exchange rates`;
        }
      }

      const warningEl = document.getElementById('holdings-fx-warning');
      if (warningEl) {
        if (summary && summary.fxWarning) {
          warningEl.classList.remove('hidden');
        } else {
          warningEl.classList.add('hidden');
        }
      }

      holdings.forEach((h) => {
        const currency = h.currency || (h.symbol && (h.symbol.endsWith('.NS') || h.symbol.endsWith('.BO')) ? 'INR' : 'USD');
        const currentPriceStr = formatHoldingPrice(h.currentPrice, currency);
        const returnStr = formatHoldingReturn(h.gain, h.gainPercent, currency);

        let returnColorClass = 'text-on-surface-variant dark:text-outline-variant';
        if (h.gain > 0) {
          returnColorClass = 'text-green-600 dark:text-green-400';
        } else if (h.gain < 0) {
          returnColorClass = 'text-red-500 dark:text-red-400';
        }

        const companyDisplayName = h.companyName || h.symbol;
        const showTickerSubtle = companyDisplayName !== h.symbol;

        const row = document.createElement('div');
        row.className = 'holding-row p-md border border-outline-variant/20 dark:border-outline-variant/10 rounded-2xl bg-white dark:bg-surface-container-high/60 shadow-xs hover:shadow-md transition-all duration-200 flex flex-col justify-between mb-sm';

        row.innerHTML = `
          <!-- Main Row: 3 Clearly Aligned Columns with Optimal Widths -->
          <div class="grid grid-cols-12 gap-xs sm:gap-sm items-start w-full min-w-0">
            <!-- Column 1: Stock Name (5 cols out of 12 for full visibility) -->
            <div class="col-span-5 min-w-0 flex flex-col justify-center pr-1">
              <span class="text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-on-surface-variant/70 dark:text-outline-variant/70 mb-1 block">Stock Name</span>
              <div class="font-bold text-label-md sm:text-body-md text-on-surface dark:text-inverse-on-surface leading-snug break-words" title="${companyDisplayName}">
                ${companyDisplayName}
              </div>
              ${showTickerSubtle ? `<span class="text-[11px] font-normal text-on-surface-variant/60 dark:text-outline-variant/60 block mt-0.5">${h.symbol}</span>` : ''}
            </div>

            <!-- Column 2: Current Price (3 cols out of 12) -->
            <div class="col-span-3 min-w-0 flex flex-col justify-center">
              <span class="text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-on-surface-variant/70 dark:text-outline-variant/70 mb-1 block">Current Price</span>
              <div class="font-bold text-label-md sm:text-body-md text-on-surface dark:text-inverse-on-surface whitespace-nowrap">
                ${currentPriceStr}
              </div>
            </div>

            <!-- Column 3: Return (4 cols out of 12) -->
            <div class="col-span-4 min-w-0 flex flex-col justify-center">
              <span class="text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-on-surface-variant/70 dark:text-outline-variant/70 mb-1 block">Return</span>
              <div class="font-bold text-label-md sm:text-body-md ${returnColorClass} break-words">
                ${returnStr}
              </div>
            </div>
          </div>

          <!-- Bottom Row: Action Buttons (Bottom-Right / End) -->
          <div class="flex items-center justify-end gap-sm mt-md pt-sm border-t border-outline-variant/10">
            <button class="edit-holding-btn px-3 py-1.5 bg-surface-container-low hover:bg-surface-container-high dark:bg-surface-container dark:hover:bg-surface-container-highest text-on-surface dark:text-inverse-on-surface border border-outline-variant/30 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-2xs" data-id="${h.id}" aria-label="Edit holding ${h.symbol}">
              <span class="material-symbols-outlined text-[15px]">edit</span> Edit
            </button>
            <button class="delete-holding-btn px-3 py-1.5 bg-error-container/20 hover:bg-error-container/40 text-error rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-2xs" data-id="${h.id}" aria-label="Remove holding ${h.symbol}">
              <span class="material-symbols-outlined text-[15px]">delete</span> Remove
            </button>
          </div>
        `;
        holdingsList.appendChild(row);
      });
      
      applyCardHoverEffects();
    }

    // Base Currency selector event listener
    const baseCurrencySelect = document.getElementById('base-currency-select');
    if (baseCurrencySelect) {
      baseCurrencySelect.addEventListener('change', async (e) => {
        const newBase = e.target.value;
        localStorage.setItem('tradepilot_base_currency', newBase);

        // Immediate visual loading indicator to prevent showing old amounts with new symbol
        const valEl = document.getElementById('holdings-total-value');
        const gainEl = document.getElementById('holdings-total-gain');
        const subtextEl = document.getElementById('holdings-fx-subtext');

        if (valEl) valEl.textContent = 'Calculating...';
        if (gainEl) gainEl.textContent = '';
        if (subtextEl) subtextEl.textContent = `Converting portfolio to ${newBase}...`;

        // Trigger immediate portfolio recalculation
        loadHoldings(newBase);

        // Async sync to backend preferences
        try {
          await fetch('/api/portfolio/base-currency', {
            method: 'PUT',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ baseCurrency: newBase })
          });
        } catch (err) {
          console.warn('Backend sync for base currency preference warning:', err);
        }
      });
    }

    // Single unified Event Delegation listener on holdingsList (Registered once)
    holdingsList.addEventListener('click', (event) => {
      const editBtn = event.target.closest('.edit-holding-btn');
      const deleteBtn = event.target.closest('.delete-holding-btn');

      if (editBtn) {
        event.stopPropagation();
        openEditHolding(editBtn.getAttribute('data-id'));
        return;
      }

      if (deleteBtn) {
        event.stopPropagation();
        const id = deleteBtn.getAttribute('data-id');
        let symbolText = 'this stock';
        if (lastPortfolioData && lastPortfolioData.holdings) {
          const found = lastPortfolioData.holdings.find(h => h.id == id);
          if (found) symbolText = found.symbol;
        }
        if (confirm(`Remove ${symbolText} from your holdings?`)) {
          deleteHolding(id);
        }
      }
    });

    async function loadHoldings(overrideBaseCurrency) {
      try {
        const baseSelect = document.getElementById('base-currency-select');
        const savedBase = localStorage.getItem('tradepilot_base_currency');
        const selectedBase = overrideBaseCurrency || (baseSelect ? baseSelect.value : null) || savedBase || 'INR';
        const url = `${PORTFOLIO_URL}?baseCurrency=${encodeURIComponent(selectedBase)}`;

        const res = await fetch(url, { headers: authHeaders() });
        if (res.status === 401) {
          window.TradePilotAuth.logout();
          return;
        }
        const data = await res.json();
        if (res.ok) {
          lastPortfolioData = data;
          lastUpdatedTime = new Date().toLocaleTimeString();

          const baseCurr = data.summary.baseCurrency || selectedBase || 'INR';
          localStorage.setItem('tradepilot_base_currency', baseCurr);

          // Update Sector count badge on card header
          const sectorBadge = document.getElementById('portfolio-sector-badge');
          if (sectorBadge) {
            const count = data.sectorExposure ? data.sectorExposure.length : 0;
            sectorBadge.textContent = `${count} Sector${count === 1 ? '' : 's'}`;
          }

          renderHoldings(data.holdings, data.summary);
          renderSectorExposure(data.sectorExposure);
          
          // Update stats with base currency
          const totalHoldingsEl = document.getElementById('total-holdings-count');
          const totalSectorsEl = document.getElementById('total-sectors-count');
          const totalInvestedEl = document.getElementById('total-invested-capital');
          
          if (totalHoldingsEl) totalHoldingsEl.textContent = `${data.holdings.length} Position${data.holdings.length === 1 ? '' : 's'}`;
          if (totalSectorsEl) totalSectorsEl.textContent = `${data.sectorExposure.length} Sector${data.sectorExposure.length === 1 ? '' : 's'}`;
          if (totalInvestedEl) totalInvestedEl.textContent = formatMoneyWithIntl(data.summary.totalCost, baseCurr);

          // Update summary header
          const mainTotalValueEl = document.getElementById('total-value');
          const mainTotalReturnEl = document.getElementById('total-return');
          
          if (mainTotalValueEl) mainTotalValueEl.textContent = formatMoneyWithIntl(data.summary.totalValue, baseCurr);
          if (mainTotalReturnEl) {
            const gainPositive = data.summary.totalGain >= 0;
            mainTotalReturnEl.textContent = formatPortfolioReturn(data.summary.totalGain, data.summary.totalGainPercent, baseCurr);
            mainTotalReturnEl.className = 'text-md font-semibold ' + (gainPositive ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400');
          }

          // Auto-sync open details modal if visible
          const detailsModal = document.getElementById('portfolio-details-modal');
          if (detailsModal && !detailsModal.classList.contains('hidden')) {
            renderDetailsContent(data);
          }
          
          updateLastUpdatedStatus();
        } else {
          showPortfolioError(data.error || 'Failed to load portfolio.');
        }
      } catch (err) {
        console.error('Could not load holdings', err);
        showPortfolioError('Network error. Failed to load portfolio.');
      }
    }

    async function deleteHolding(id) {
      try {
        await fetch(`${PORTFOLIO_URL}/${id}`, { method: 'DELETE', headers: authHeaders() });
        lastPortfolioData = null; // Invalidate cached modal details
        safeLoadHoldings();
        safeLoadNews(); // refresh news
      } catch (err) {
        console.error('Could not delete holding', err);
      }
    }

    async function saveHolding() {
      formError.classList.add('hidden');
      const symbol = symbolInput.value.trim().toUpperCase();
      if (!symbol || !/^[A-Z0-9.\-]{1,15}$/.test(symbol)) {
        formError.textContent = 'Please select or enter a valid stock symbol.';
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
        lastPortfolioData = null; // Invalidate cached modal details
        safeLoadHoldings();
        safeLoadNews(); // refresh news
      } catch (err) {
        formError.textContent = 'Could not reach the server. Make sure it is running.';
        formError.classList.remove('hidden');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
      }
    }

    addBtn.addEventListener('click', () => form.classList.toggle('hidden'));
    saveBtn.addEventListener('click', saveHolding);

    // --- Watchlist ---
    async function loadWatchlist() {
      try {
        const res = await fetch(WATCHLIST_URL, { headers: authHeaders() });
        if (res.status === 401) {
          window.TradePilotAuth.logout();
          return;
        }
        const data = await res.json();
        if (!res.ok) {
          showWatchlistError(data.error || 'Failed to load watchlist.');
          return;
        }

        watchlistContainer.querySelectorAll('.watchlist-row').forEach((el) => el.remove());
        watchlistContainer.querySelectorAll('.watchlist-skeleton').forEach((el) => el.remove());

        if (!data.watchlist || data.watchlist.length === 0) {
          watchlistEmpty.classList.remove('hidden');
          return;
        }
        watchlistEmpty.classList.add('hidden');

        data.watchlist.forEach((item) => {
          const price = item.quote ? item.quote.price : null;
          const changePercent = item.quote ? item.quote.changePercent : null;
          const changePositive = changePercent >= 0;
          
          const row = document.createElement('div');
          row.className = 'watchlist-row flex justify-between items-center p-sm border border-outline-variant/20 rounded-xl hover:bg-surface-container/30 transition-colors group';
          
          const priceStr = price !== null ? fmtMoney(price) : 'N/A';
          const changeStr = changePercent !== null ? `${changePositive ? '+' : ''}${changePercent.toFixed(2)}%` : 'N/A';
          const changeClass = changePercent !== null ? (changePositive ? 'text-green-600' : 'text-red-500') : 'text-on-surface-variant';

          row.innerHTML = `
            <div class="flex items-center gap-sm">
              <div class="w-10 h-10 bg-primary-container/20 rounded-lg flex items-center justify-center font-bold text-primary">${item.symbol.slice(0, 2)}</div>
              <div>
                <p class="text-label-md font-bold dark:text-inverse-on-surface">${item.symbol}</p>
                <p class="text-[10px] text-on-surface-variant">${priceStr}</p>
              </div>
            </div>
            <div class="flex items-center gap-xs">
              <span class="text-label-sm font-bold ${changeClass}">${changeStr}</span>
              <button class="remove-watchlist-btn material-symbols-outlined text-[16px] text-on-surface-variant hover:text-error opacity-0 group-hover:opacity-100 transition-opacity" data-id="${item.id}">close</button>
            </div>
          `;
          watchlistContainer.appendChild(row);
        });

        watchlistContainer.querySelectorAll('.remove-watchlist-btn').forEach((btn) => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
              await fetch(`${WATCHLIST_URL}/${btn.getAttribute('data-id')}`, { method: 'DELETE', headers: authHeaders() });
              safeLoadWatchlist();
              safeLoadNews(); // refresh news
            } catch (err) {
              console.error('Failed to remove watchlist item', err);
            }
          });
        });

        applyCardHoverEffects();
      } catch (err) {
        console.error('Could not load watchlist', err);
        showWatchlistError('Network error. Failed to load watchlist.');
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
        if (!symbol || !/^[A-Z0-9.\-]{1,15}$/.test(symbol)) {
          watchlistError.textContent = 'Please select or enter a valid stock symbol.';
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
          safeLoadWatchlist();
          safeLoadNews(); // refresh news
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
        
        const saveBtnModal = document.getElementById('save-profile-btn-modal');
        saveBtnModal.disabled = true;
        saveBtnModal.textContent = 'Saving...';
        
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
            const nameEl = document.getElementById('dashboard-user-name');
            if (nameEl) nameEl.textContent = localUser.name || localUser.email.split('@')[0];
          }
          
          setTimeout(() => {
            hideModal();
          }, 1000);
        } catch (err) {
          profileEditError.textContent = err.message || 'Could not save profile changes.';
          profileEditError.classList.remove('hidden');
        } finally {
          saveBtnModal.disabled = false;
          saveBtnModal.textContent = 'Save Changes';
        }
      });
    }

    // --- Sector Exposure Render ---
    function renderSectorExposure(exposure, baseCurrency = 'INR') {
      const container = document.getElementById('sector-exposure-chart-container');
      if (!container) return;
      container.innerHTML = '';
      
      if (!exposure || exposure.length === 0) {
        container.className = "h-64 w-full flex items-center justify-center border border-dashed border-outline-variant/30 rounded-xl bg-surface-container-lowest/50 dark:bg-surface-container/50";
        container.innerHTML = `<p id="sector-empty-state" class="text-label-md text-on-surface-variant dark:text-outline-variant text-center">Add holdings below to see your sector exposure breakdown.</p>`;
        return;
      }
      
      container.className = "w-full space-y-4 py-4 px-2 flex flex-col justify-start min-h-[16rem] custom-scrollbar overflow-y-auto";
      
      const sorted = [...exposure].sort((a, b) => b.percentage - a.percentage);
      sorted.forEach((item) => {
        const sectorRow = document.createElement('div');
        sectorRow.className = 'w-full space-y-1.5';
        const marketValueStr = formatMoneyWithIntl(item.value, baseCurrency);
        sectorRow.innerHTML = `
          <div class="flex justify-between items-center text-label-sm font-medium">
            <span class="text-on-surface dark:text-inverse-on-surface truncate pr-2">${item.sector}</span>
            <span class="text-on-surface-variant dark:text-outline-variant shrink-0">${marketValueStr} (${item.percentage.toFixed(1)}%)</span>
          </div>
          <div class="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
            <div class="bg-primary dark:bg-primary-fixed-dim h-full rounded-full transition-all duration-500 ease-out" style="width: ${item.percentage}%"></div>
          </div>
        `;
        container.appendChild(sectorRow);
      });
      applyCardHoverEffects();
    }

    // --- News lists rendering ---
    function renderNews(listElement, newsItems, emptyText, emptyTextEl) {
      if (!listElement) return;
      listElement.innerHTML = '';
      if (emptyTextEl) emptyTextEl.classList.add('hidden');

      if (!newsItems || newsItems.length === 0) {
        if (emptyTextEl) {
          emptyTextEl.classList.remove('hidden');
        } else {
          listElement.innerHTML = `<p class="text-label-sm text-on-surface-variant dark:text-outline-variant">${emptyText}</p>`;
        }
        return;
      }
      
      newsItems.forEach(item => {
        const card = document.createElement('a');
        card.href = item.url || `https://finance.yahoo.com/quote/${item.symbol.trim().toUpperCase()}/news`;
        card.target = '_blank';
        card.rel = 'noopener noreferrer';
        card.className = 'glass-card p-sm flex gap-md items-center group cursor-pointer hover:shadow-md transition-all bg-white dark:bg-surface-container border border-outline-variant/30 rounded-xl hover-lift';
        
        card.innerHTML = `
          <div class="w-12 h-12 rounded-xl bg-primary-container/20 flex items-center justify-center font-bold text-primary dark:text-primary-fixed-dim shrink-0">
            ${item.symbol}
          </div>
          <div class="flex-grow min-w-0">
            <div class="flex gap-2 mb-1 items-center">
               <span class="bg-primary/10 text-primary dark:text-primary-fixed-dim text-[10px] px-2 py-0.5 rounded-full font-bold uppercase">${item.symbol}</span>
               <span class="text-[10px] text-on-surface-variant dark:text-outline-variant">${item.createdAt ? new Date(item.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Today'}</span>
            </div>
            <h4 class="text-label-sm font-bold group-hover:text-primary dark:group-hover:text-primary-fixed-dim transition-colors truncate dark:text-inverse-on-surface">${item.title}</h4>
            <p class="text-[11px] text-on-surface-variant dark:text-outline-variant line-clamp-2 mt-0.5">${item.description || ''}</p>
          </div>
        `;
        listElement.appendChild(card);
      });
      applyCardHoverEffects();
    }

    async function loadPortfolioNews() {
      if (!portfolioNewsList) return;
      const emptyTextEl = document.getElementById('portfolio-news-empty');
      try {
        const res = await fetch('/api/portfolio/news', { headers: authHeaders() });
        const data = await res.json();
        if (res.ok) {
          renderNews(portfolioNewsList, data.news, 'Add holdings below to see news linked to your portfolio.', emptyTextEl);
        } else {
          portfolioNewsList.innerHTML = '<p class="text-label-sm text-error">Failed to load portfolio news.</p>';
        }
      } catch (err) {
        console.error('Could not load portfolio news', err);
        portfolioNewsList.innerHTML = '<p class="text-label-sm text-error">Network error. Failed to load news.</p>';
      }
    }

    async function loadWatchlistNews() {
      if (!watchlistNewsList) return;
      const emptyTextEl = document.getElementById('watchlist-news-empty');
      try {
        const res = await fetch('/api/watchlist/news', { headers: authHeaders() });
        const data = await res.json();
        if (res.ok) {
          renderNews(watchlistNewsList, data.news, 'Add symbols to your watchlist to see watchlist news.', emptyTextEl);
        } else {
          watchlistNewsList.innerHTML = '<p class="text-label-sm text-error">Failed to load watchlist news.</p>';
        }
      } catch (err) {
        console.error('Could not load watchlist news', err);
        watchlistNewsList.innerHTML = '<p class="text-label-sm text-error">Network error. Failed to load news.</p>';
      }
    }

    // --- Autocomplete ---
    function setupAutocomplete(input, suggestionsContainer) {
      if (!input || !suggestionsContainer) return;
      
      const DEFAULT_SUGGESTIONS = [
        { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' },
        { symbol: 'MSFT', name: 'Microsoft Corporation', exchange: 'NASDAQ' },
        { symbol: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ' },
        { symbol: 'TSLA', name: 'Tesla, Inc.', exchange: 'NASDAQ' },
        { symbol: 'AMZN', name: 'Amazon.com, Inc.', exchange: 'NASDAQ' },
        { symbol: 'META', name: 'Meta Platforms, Inc.', exchange: 'NASDAQ' },
        { symbol: 'GOOGL', name: 'Alphabet Inc.', exchange: 'NASDAQ' },
        { symbol: 'NFLX', name: 'Netflix, Inc.', exchange: 'NASDAQ' }
      ];

      let activeIndex = -1;
      let filtered = [];
      let debounceTimeout = null;

      async function showSuggestions() {
        const query = input.value.trim();
        suggestionsContainer.innerHTML = '';
        activeIndex = -1;
        
        let symbols = [];
        if (!query) {
          symbols = DEFAULT_SUGGESTIONS;
        } else {
          try {
            const url = `/api/market/search?q=${encodeURIComponent(query)}`;
            const res = await fetch(url, { headers: authHeaders() });
            const data = await res.json();
            if (res.ok && data.symbols && data.symbols.length > 0) {
              symbols = data.symbols;
            }
          } catch (err) {
            console.error('[Autocomplete] Fetch error:', err);
          }
        }

        if (symbols.length === 0) {
          suggestionsContainer.classList.add('hidden');
          return;
        }

        filtered = symbols;
        suggestionsContainer.classList.remove('hidden');
        filtered.forEach((item, idx) => {
          const itemEl = document.createElement('div');
          itemEl.className = 'w-full px-3 py-2.5 cursor-pointer text-label-sm border-b border-outline-variant/10 last:border-b-0 flex justify-between items-center transition-colors dark:text-inverse-on-surface hover:bg-primary/10 dark:hover:bg-primary-container/45';
          itemEl.innerHTML = `
            <span class="font-bold shrink-0">${item.symbol}</span>
            <span class="text-[11px] text-on-surface-variant dark:text-outline-variant truncate ml-4 text-right">${item.name} (${item.exchange || ''})</span>
          `;
          
          itemEl.addEventListener('mousedown', (e) => {
            e.preventDefault();
            selectItem(item.symbol);
          });
          
          suggestionsContainer.appendChild(itemEl);
        });
      }

      async function selectItem(symbol) {
        input.value = symbol;
        suggestionsContainer.classList.add('hidden');
        input.focus();

        if (input === symbolInput) {
          try {
            const res = await fetch(`/api/market/quote?symbol=${encodeURIComponent(symbol)}`, { headers: authHeaders() });
            const data = await res.json();
            if (res.ok && data.quote && typeof data.quote.price === 'number') {
              avgCostInput.value = data.quote.price.toFixed(2);
            }
          } catch (err) {
            console.error('Failed to fetch quote for autofill:', err);
          }
        }
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
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => {
          showSuggestions();
        }, 300);
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

    // --- Market Headlines Ticker ---
    async function loadMarketHeadlines() {
      const ticker = document.getElementById('market-headlines-ticker');
      if (!ticker) return;
      
      try {
        const response = await fetch(MARKET_HEADLINES_URL, { headers: authHeaders() });
        if (!response.ok) {
          throw new Error(`Market headlines request failed: ${response.status}`);
        }
        const data = await response.json();
        renderMarketHeadlines(data.news || []);
      } catch (error) {
        console.error('Failed to load market headlines:', error);
        renderMarketHeadlinesError();
      }
    }

    function renderMarketHeadlines(news) {
      const ticker = document.getElementById('market-headlines-ticker');
      if (!ticker) return;
      ticker.innerHTML = '';

      if (news.length === 0) {
        ticker.innerHTML = '<span class="text-on-surface-variant dark:text-outline-variant font-medium select-none">No recent market headlines available.</span>';
        return;
      }

      const uniqueNews = [];
      const titles = new Set();
      news.forEach(item => {
        const cleanTitle = (item.title || '').trim();
        if (cleanTitle && !titles.has(cleanTitle)) {
          titles.add(cleanTitle);
          uniqueNews.push(item);
        }
      });

      uniqueNews.sort((a, b) => {
        if (a.publishedAt && b.publishedAt) {
          return new Date(b.publishedAt) - new Date(a.publishedAt);
        }
        return 0;
      });

      const itemsToDisplay = uniqueNews.slice(0, 12);
      const linksContainer = document.createElement('div');
      linksContainer.className = 'flex items-center gap-12';

      itemsToDisplay.forEach((item, index) => {
        const link = document.createElement('a');
        link.href = item.url || '#';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.className = 'hover:underline text-on-surface dark:text-inverse-on-surface font-semibold flex items-center gap-2 shrink-0';
        
        if (index > 0) {
          const dot = document.createElement('span');
          dot.textContent = '•';
          dot.className = 'text-on-surface-variant dark:text-outline-variant select-none mx-1';
          linksContainer.appendChild(dot);
        }

        const dotIndicator = document.createElement('span');
        dotIndicator.className = 'w-1.5 h-1.5 rounded-full bg-primary dark:bg-primary-fixed-dim shrink-0';
        link.appendChild(dotIndicator);

        const textNode = document.createElement('span');
        textNode.textContent = item.title;
        link.appendChild(textNode);

        linksContainer.appendChild(link);
      });

      const cloneContainer = linksContainer.cloneNode(true);
      const gapDot = document.createElement('span');
      gapDot.textContent = '•';
      gapDot.className = 'text-on-surface-variant dark:text-outline-variant select-none mx-2 shrink-0';

      ticker.appendChild(linksContainer);
      ticker.appendChild(gapDot);
      ticker.appendChild(cloneContainer);
    }

    function renderMarketHeadlinesError() {
      const ticker = document.getElementById('market-headlines-ticker');
      if (!ticker) return;
      ticker.innerHTML = '';

      const container = document.createElement('div');
      container.className = 'flex items-center gap-3 w-full justify-between';

      const errorText = document.createElement('span');
      errorText.textContent = 'Market headlines temporarily unavailable';
      errorText.className = 'text-error font-medium';

      const retryBtn = document.createElement('button');
      retryBtn.textContent = 'Retry';
      retryBtn.className = 'px-3 py-1 bg-error text-white font-bold rounded-lg text-xs hover:opacity-90 transition-all';
      retryBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        refreshMarketHeadlines();
      });

      container.appendChild(errorText);
      container.appendChild(retryBtn);
      ticker.appendChild(container);
    }

    let marketNewsRequestInFlight = false;

    async function refreshMarketHeadlines() {
      if (marketNewsRequestInFlight) return;
      marketNewsRequestInFlight = true;

      const ticker = document.getElementById('market-headlines-ticker');
      if (ticker && !ticker.querySelector('.hover\\:underline')) {
        ticker.innerHTML = '<span id="market-headlines-loading">Loading latest market headlines...</span>';
      }

      try {
        await loadMarketHeadlines();
      } finally {
        marketNewsRequestInFlight = false;
      }
    }

    // --- Safe fetching entrypoints ---
    async function safeLoadHoldings() {
      if (isFetchingPortfolio) return;
      isFetchingPortfolio = true;
      try {
        await loadHoldings();
      } finally {
        isFetchingPortfolio = false;
      }
    }

    async function safeLoadWatchlist() {
      if (isFetchingWatchlist) return;
      isFetchingWatchlist = true;
      try {
        await loadWatchlist();
      } finally {
        isFetchingWatchlist = false;
      }
    }

    async function safeLoadNews() {
      if (isFetchingNews) return;
      isFetchingNews = true;
      try {
        showNewsSkeleton(portfolioNewsList);
        showNewsSkeleton(watchlistNewsList);
        await Promise.all([loadPortfolioNews(), loadWatchlistNews()]);
      } finally {
        isFetchingNews = false;
      }
    }

    // --- Polling Timers ---
    let refreshTimer = null;
    let marketNewsRefreshTimer = null;

    function startPolling() {
      stopPolling();
      refreshTimer = setInterval(() => {
        if (document.visibilityState === 'visible') {
          safeLoadHoldings();
          safeLoadWatchlist();
        }
      }, 30000);

      marketNewsRefreshTimer = setInterval(() => {
        if (document.visibilityState === 'visible') {
          safeLoadNews();
          refreshMarketHeadlines();
        }
      }, NEWS_REFRESH_MS);
    }

    function stopPolling() {
      if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
      if (marketNewsRefreshTimer) {
        clearInterval(marketNewsRefreshTimer);
        marketNewsRefreshTimer = null;
      }
    }

    // Visibility Listener
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        updateGreeting();
        safeLoadHoldings();
        safeLoadWatchlist();
        safeLoadNews();
        refreshMarketHeadlines();
        startPolling();
      } else {
        stopPolling();
      }
    });

    // --- Layout Actions ---
    const header = document.querySelector('header');
    if (header) {
      window.addEventListener('scroll', () => {
        if (window.scrollY > 20) {
          header.classList.add('shadow-md');
        } else {
          header.classList.remove('shadow-md');
        }
      });
    }

    const applyCardHoverEffects = () => {
      const cards = document.querySelectorAll('.bg-white, .bg-primary, .hover-lift');
      cards.forEach(card => {
        if (!card.hasHoverListener) {
          card.hasHoverListener = true;
          card.addEventListener('mouseenter', () => {
            if (!card.classList.contains('hover-lift')) {
              card.style.transform = 'translateY(-2px)';
              card.style.transition = 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)';
            }
          });
          card.addEventListener('mouseleave', () => {
            if (!card.classList.contains('hover-lift')) {
              card.style.transform = 'translateY(0)';
            }
          });
        }
      });
    };

    // --- Holdings/Watchlist Tab Switching ---
    const tabHoldings = document.getElementById('tab-holdings');
    const tabWatchlist = document.getElementById('tab-watchlist');
    const paneHoldings = document.getElementById('pane-holdings');
    const paneWatchlist = document.getElementById('pane-watchlist');

    if (tabHoldings && tabWatchlist) {
      tabHoldings.addEventListener('click', () => {
        tabHoldings.className = 'flex-1 py-4 text-center font-bold text-label-md border-b-2 border-primary dark:border-primary-fixed-dim text-primary dark:text-inverse-primary transition-all';
        tabWatchlist.className = 'flex-1 py-4 text-center font-bold text-label-md border-b-2 border-transparent text-on-surface-variant dark:text-outline-variant hover:text-primary dark:hover:text-inverse-primary transition-all';
        paneHoldings.classList.remove('hidden');
        paneWatchlist.classList.add('hidden');
      });

      tabWatchlist.addEventListener('click', () => {
        tabWatchlist.className = 'flex-1 py-4 text-center font-bold text-label-md border-b-2 border-primary dark:border-primary-fixed-dim text-primary dark:text-inverse-primary transition-all';
        tabHoldings.className = 'flex-1 py-4 text-center font-bold text-label-md border-b-2 border-transparent text-on-surface-variant dark:text-outline-variant hover:text-primary dark:hover:text-inverse-primary transition-all';
        paneWatchlist.classList.remove('hidden');
        paneHoldings.classList.add('hidden');
      });
    }

    // --- Theme Toggle ---
    const themeToggle = document.getElementById('theme-toggle');
    const html = document.documentElement;
    if (themeToggle) {
      const isDark = localStorage.getItem('theme') === 'dark' || html.classList.contains('dark');
      if (isDark) {
        html.classList.add('dark');
        themeToggle.innerText = 'light_mode';
      } else {
        html.classList.remove('dark');
        themeToggle.innerText = 'dark_mode';
      }
      themeToggle.addEventListener('click', () => {
        html.classList.toggle('dark');
        const nowDark = html.classList.contains('dark');
        localStorage.setItem('theme', nowDark ? 'dark' : 'light');
        themeToggle.innerText = nowDark ? 'light_mode' : 'dark_mode';
        window.dispatchEvent(new Event('theme-changed'));
      });
    }

    // --- Portfolio Details Modal Elements ---
    const viewDetailsBtn = document.getElementById('view-portfolio-details-btn');
    const detailsModal = document.getElementById('portfolio-details-modal');
    const closeDetailsBtn = document.getElementById('close-portfolio-details-btn');
    const retryDetailsBtn = document.getElementById('retry-portfolio-details-btn');
    
    const detailsLoading = document.getElementById('portfolio-details-loading');
    const detailsError = document.getElementById('portfolio-details-error');
    const detailsEmpty = document.getElementById('portfolio-details-empty');
    const detailsContent = document.getElementById('portfolio-details-content');

    function openDetailsModal() {
      if (!detailsModal) return;
      document.body.classList.add('overflow-hidden');
      detailsModal.classList.remove('hidden');
      closeDetailsBtn.focus();
      
      setTimeout(() => {
        const inner = detailsModal.querySelector('div');
        if (inner) {
          inner.classList.remove('opacity-0', 'scale-95');
          inner.classList.add('opacity-100', 'scale-100');
        }
      }, 10);

      loadAndRenderDetails();
    }

    function closeDetailsModal() {
      if (!detailsModal) return;
      const inner = detailsModal.querySelector('div');
      if (inner) {
        inner.classList.remove('opacity-100', 'scale-100');
        inner.classList.add('opacity-0', 'scale-95');
      }
      setTimeout(() => {
        detailsModal.classList.add('hidden');
        document.body.classList.remove('overflow-hidden');
      }, 300);
    }

    if (viewDetailsBtn) {
      viewDetailsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        openDetailsModal();
      });
    }

    if (closeDetailsBtn) {
      closeDetailsBtn.addEventListener('click', closeDetailsModal);
    }

    if (detailsModal) {
      detailsModal.addEventListener('click', (e) => {
        const inner = detailsModal.querySelector('div');
        if (inner && !inner.contains(e.target)) {
          closeDetailsModal();
        }
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (detailsModal && !detailsModal.classList.contains('hidden')) {
          closeDetailsModal();
        }
        if (editHoldingModal && !editHoldingModal.classList.contains('hidden')) {
          closeEditHoldingModal();
        }
      }
    });

    async function loadAndRenderDetails() {
      detailsLoading.classList.add('hidden');
      detailsError.classList.add('hidden');
      detailsEmpty.classList.add('hidden');
      detailsContent.classList.add('hidden');

      if (lastPortfolioData) {
        renderDetailsContent(lastPortfolioData);
      } else {
        detailsLoading.classList.remove('hidden');
        try {
          const res = await fetch(PORTFOLIO_URL, { headers: authHeaders() });
          const data = await res.json();
          detailsLoading.classList.add('hidden');
          if (res.ok) {
            lastPortfolioData = data;
            lastUpdatedTime = new Date().toLocaleTimeString();
            renderDetailsContent(data);
          } else {
            detailsError.classList.remove('hidden');
            document.getElementById('portfolio-details-error-msg').textContent = data.error || 'Failed to load portfolio details.';
          }
        } catch (err) {
          console.error(err);
          detailsLoading.classList.add('hidden');
          detailsError.classList.remove('hidden');
          document.getElementById('portfolio-details-error-msg').textContent = 'Network error. Failed to load portfolio details.';
        }
      }
    }

    if (retryDetailsBtn) {
      retryDetailsBtn.addEventListener('click', () => {
        lastPortfolioData = null; // force reload
        loadAndRenderDetails();
      });
    }

    function renderDetailsContent(data) {
      if (!data.holdings || data.holdings.length === 0) {
        detailsEmpty.classList.remove('hidden');
        return;
      }
      detailsContent.classList.remove('hidden');

      const baseCurr = (data.summary && data.summary.baseCurrency) ? data.summary.baseCurrency : 'INR';

      // 1. Summary
      document.getElementById('details-total-value').textContent = formatMoneyWithIntl(data.summary.totalValue, baseCurr);
      document.getElementById('details-invested-capital').textContent = formatMoneyWithIntl(data.summary.totalCost, baseCurr);

      const gainEl = document.getElementById('details-total-gain');
      const gainPctEl = document.getElementById('details-total-return-pct');
      const gainPositive = data.summary.totalGain >= 0;

      gainEl.textContent = formatPortfolioReturn(data.summary.totalGain, data.summary.totalGainPercent, baseCurr);
      gainEl.className = 'text-title-md font-bold ' + (gainPositive ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400');

      gainPctEl.textContent = `${gainPositive ? '+' : ''}${data.summary.totalGainPercent.toFixed(2)}%`;
      gainPctEl.className = 'text-title-md font-bold ' + (gainPositive ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400');

      document.getElementById('details-holdings-count').textContent = `${data.holdings.length} Position${data.holdings.length === 1 ? '' : 's'}`;
      document.getElementById('details-sectors-count').textContent = `${data.sectorExposure.length} Sector${data.sectorExposure.length === 1 ? '' : 's'}`;

      // 2. Sector Allocation
      const sectorContainer = document.getElementById('details-sector-exposure');
      sectorContainer.innerHTML = '';

      const sortedSectors = [...data.sectorExposure].sort((a, b) => b.percentage - a.percentage);
      sortedSectors.forEach((item, idx) => {
        const sectorDiv = document.createElement('div');
        sectorDiv.className = 'border border-outline-variant/20 rounded-xl p-xs space-y-1 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/35 transition-colors group';

        sectorDiv.innerHTML = `
          <div class="flex justify-between items-center text-label-sm font-medium px-1">
            <div class="flex items-center gap-1">
              <span class="material-symbols-outlined text-[16px] text-on-surface-variant group-hover:text-primary transition-transform duration-200" id="chevron-sec-${idx}">chevron_right</span>
              <span class="text-on-surface dark:text-inverse-on-surface">${item.sector}</span>
            </div>
            <span class="text-on-surface-variant dark:text-outline-variant">${formatMoneyWithIntl(item.value, baseCurr)} (${item.percentage.toFixed(1)}%)</span>
          </div>
          <div class="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden mx-1">
            <div class="bg-primary dark:bg-primary-fixed-dim h-full rounded-full transition-all duration-500 ease-out" style="width: ${item.percentage}%"></div>
          </div>
        `;
        
        const constituentsDiv = document.createElement('div');
        constituentsDiv.className = 'hidden pl-6 pr-2 py-2 space-y-1.5 bg-surface-container-low/30 dark:bg-surface-container-high/10 rounded-lg mt-2 text-xs border-t border-outline-variant/10';
        
        const sectorHoldings = data.holdings.filter(h => h.sector === item.sector);
        sectorHoldings.forEach(sh => {
          const shGainPositive = sh.gain >= 0;
          const shConvertedVal = sh.convertedMarketValue !== undefined ? sh.convertedMarketValue : sh.marketValue;
          const shWeight = data.summary.totalValue > 0 ? (shConvertedVal / data.summary.totalValue) * 100 : 0;
          
          const itemRow = document.createElement('div');
          itemRow.className = 'flex justify-between items-center text-[11px] text-on-surface-variant dark:text-outline-variant';
          itemRow.innerHTML = `
            <span>
              <span class="font-bold text-on-surface dark:text-inverse-on-surface">${sh.symbol}</span> 
              <span class="opacity-85">(${sh.companyName || sh.symbol})</span>
            </span>
            <div class="text-right">
              <span class="font-semibold text-on-surface dark:text-inverse-on-surface">${formatMoneyWithIntl(sh.marketValue, sh.currency)}</span>
              <span class="ml-2 font-bold ${shGainPositive ? 'text-green-600' : 'text-red-500'}">
                (${shGainPositive ? '+' : ''}${sh.gainPercent !== null ? sh.gainPercent.toFixed(2) : '0.00'}%)
              </span>
              <span class="ml-2 opacity-70">(${shWeight.toFixed(1)}% weight)</span>
            </div>
          `;
          constituentsDiv.appendChild(itemRow);
        });
        
        sectorDiv.appendChild(constituentsDiv);
        
        sectorDiv.addEventListener('click', (e) => {
          if (constituentsDiv.contains(e.target)) return;
          const isHidden = constituentsDiv.classList.contains('hidden');
          const chevron = sectorDiv.querySelector(`#chevron-sec-${idx}`);
          if (isHidden) {
            constituentsDiv.classList.remove('hidden');
            if (chevron) chevron.style.transform = 'rotate(90deg)';
          } else {
            constituentsDiv.classList.add('hidden');
            if (chevron) chevron.style.transform = 'rotate(0deg)';
          }
        });

        sectorContainer.appendChild(sectorDiv);
      });

      // 3. Insights
      let largestSector = 'None';
      if (sortedSectors.length > 0) {
        largestSector = `${sortedSectors[0].sector} (${sortedSectors[0].percentage.toFixed(1)}%)`;
      }
      document.getElementById('insight-largest-sector').textContent = largestSector;

      const sortedHoldingsByValue = [...data.holdings].sort((a, b) => {
        const valA = a.convertedMarketValue !== undefined ? a.convertedMarketValue : a.marketValue;
        const valB = b.convertedMarketValue !== undefined ? b.convertedMarketValue : b.marketValue;
        return valB - valA;
      });

      let largestPosition = 'None';
      if (sortedHoldingsByValue.length > 0) {
        const topH = sortedHoldingsByValue[0];
        const topVal = topH.convertedMarketValue !== undefined ? topH.convertedMarketValue : topH.marketValue;
        largestPosition = `${topH.symbol} (${formatMoneyWithIntl(topVal, baseCurr)})`;
      }
      document.getElementById('insight-largest-position').textContent = largestPosition;

      const sortedHoldingsByPerf = [...data.holdings].sort((a, b) => (b.gainPercent || 0) - (a.gainPercent || 0));
      let bestPerformer = 'None';
      let worstPerformer = 'None';
      if (sortedHoldingsByPerf.length > 0) {
        const best = sortedHoldingsByPerf[0];
        bestPerformer = `${best.symbol} (${best.gainPercent >= 0 ? '+' : ''}${best.gainPercent ? best.gainPercent.toFixed(2) : '0.00'}%)`;
        
        const worst = sortedHoldingsByPerf[sortedHoldingsByPerf.length - 1];
        worstPerformer = `${worst.symbol} (${worst.gainPercent >= 0 ? '+' : ''}${worst.gainPercent ? worst.gainPercent.toFixed(2) : '0.00'}%)`;
      }
      
      const bestEl = document.getElementById('insight-best-performer');
      bestEl.textContent = bestPerformer;
      if (sortedHoldingsByPerf.length > 0) {
        bestEl.className = 'font-bold ' + (sortedHoldingsByPerf[0].gainPercent >= 0 ? 'text-green-600' : 'text-red-500');
      }

      const worstEl = document.getElementById('insight-worst-performer');
      worstEl.textContent = worstPerformer;
      if (sortedHoldingsByPerf.length > 0) {
        worstEl.className = 'font-bold ' + (sortedHoldingsByPerf[sortedHoldingsByPerf.length - 1].gainPercent >= 0 ? 'text-green-600' : 'text-red-500');
      }

      const sectorCount = data.sectorExposure.length;
      let divStatus = 'None';
      if (sectorCount === 1) {
        divStatus = 'Highly Concentrated (1 Sector)';
      } else if (sectorCount === 2 || sectorCount === 3) {
        divStatus = `Moderately Diversified (${sectorCount} Sectors)`;
      } else if (sectorCount >= 4) {
        divStatus = `Well Diversified (${sectorCount} Sectors)`;
      }
      document.getElementById('insight-diversification').textContent = divStatus;

      // 4. Holdings Table (Desktop)
      const tableBody = document.getElementById('details-holdings-table-body');
      tableBody.innerHTML = '';
      
      data.holdings.forEach(h => {
        const shGainPositive = h.gain >= 0;
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50 dark:hover:bg-slate-800/10 transition-colors';
        
        const currentPriceStr = h.currentPrice !== null ? formatMoneyWithIntl(h.currentPrice, h.currency) : 'N/A';
        const gainPercentStr = h.gainPercent !== null ? `${shGainPositive ? '+' : ''}${h.gainPercent.toFixed(2)}%` : 'N/A';
        const gainClass = h.gainPercent !== null ? (shGainPositive ? 'text-green-600' : 'text-red-500') : '';

        tr.innerHTML = `
          <td class="p-sm font-bold text-on-surface dark:text-inverse-on-surface">${h.symbol}</td>
          <td class="p-sm text-on-surface-variant dark:text-outline-variant truncate max-w-[150px]" title="${h.companyName || h.symbol}">${h.companyName || h.symbol}</td>
          <td class="p-sm text-xs text-on-surface-variant dark:text-outline-variant">${h.sector}</td>
          <td class="p-sm text-right text-on-surface dark:text-inverse-on-surface">${h.quantity}</td>
          <td class="p-sm text-right text-on-surface-variant dark:text-outline-variant">${formatMoneyWithIntl(h.avgCost, h.currency)}</td>
          <td class="p-sm text-right text-on-surface-variant dark:text-outline-variant">${currentPriceStr}</td>
          <td class="p-sm text-right font-semibold text-on-surface dark:text-inverse-on-surface">${formatMoneyWithIntl(h.marketValue, h.currency)}</td>
          <td class="p-sm text-right font-bold ${gainClass}">${shGainPositive ? '+' : ''}${formatMoneyWithIntl(Math.abs(h.gain), h.currency)}</td>
          <td class="p-sm text-right font-bold ${gainClass}">${gainPercentStr}</td>
        `;
        tableBody.appendChild(tr);
      });

      // 5. Holdings Mobile Cards
      const cardsContainer = document.getElementById('details-holdings-mobile-cards');
      cardsContainer.innerHTML = '';
      
      data.holdings.forEach(h => {
        const shGainPositive = h.gain >= 0;
        const card = document.createElement('div');
        card.className = 'p-sm border border-outline-variant/20 rounded-xl bg-white dark:bg-surface-container-low space-y-2';
        
        const currentPriceStr = h.currentPrice !== null ? formatMoneyWithIntl(h.currentPrice, h.currency) : 'N/A';
        const gainPercentStr = h.gainPercent !== null ? `${shGainPositive ? '+' : ''}${h.gainPercent.toFixed(2)}%` : 'N/A';
        const gainClass = h.gainPercent !== null ? (shGainPositive ? 'text-green-600' : 'text-red-500') : 'text-on-surface-variant';

        card.innerHTML = `
          <div class="flex justify-between items-center border-b border-outline-variant/10 pb-1.5">
            <div>
              <span class="font-bold text-label-md text-on-surface dark:text-inverse-on-surface">${h.symbol}</span>
              <span class="text-[10px] text-on-surface-variant dark:text-outline-variant ml-2">${h.companyName || h.symbol}</span>
            </div>
            <span class="text-xs bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-on-surface-variant dark:text-outline-variant">${h.sector}</span>
          </div>
          <div class="grid grid-cols-2 gap-y-1 text-xs">
            <div class="text-on-surface-variant dark:text-outline-variant">Qty: <span class="text-on-surface dark:text-inverse-on-surface font-semibold">${h.quantity}</span></div>
            <div class="text-on-surface-variant dark:text-outline-variant text-right">Avg Cost: <span class="text-on-surface dark:text-inverse-on-surface font-semibold">${formatMoneyWithIntl(h.avgCost, h.currency)}</span></div>
            <div class="text-on-surface-variant dark:text-outline-variant">Current: <span class="text-on-surface dark:text-inverse-on-surface font-semibold">${currentPriceStr}</span></div>
            <div class="text-on-surface-variant dark:text-outline-variant text-right">Value: <span class="text-on-surface dark:text-inverse-on-surface font-bold">${formatMoneyWithIntl(h.marketValue, h.currency)}</span></div>
          </div>
          <div class="flex justify-between items-center text-xs pt-1 border-t border-outline-variant/10">
            <span class="text-on-surface-variant dark:text-outline-variant">Total Gain/Loss:</span>
            <span class="font-bold ${gainClass}">${shGainPositive ? '+' : ''}${formatMoneyWithIntl(Math.abs(h.gain), h.currency)} (${gainPercentStr})</span>
          </div>
        `;
        cardsContainer.appendChild(card);
      });

      // 6. Data freshness
      document.getElementById('details-data-freshness').textContent = `Market data updated: ${lastUpdatedTime}`;
    }

    // --- Edit Holding Modal Logic ---
    const editHoldingModal = document.getElementById('edit-holding-modal');
    const closeEditHoldingBtn = document.getElementById('close-edit-holding-btn');
    const cancelEditHoldingBtn = document.getElementById('cancel-edit-holding-btn');
    const editHoldingForm = document.getElementById('edit-holding-form');
    const editHoldingError = document.getElementById('edit-holding-error');

    function openEditHolding(holdingId) {
      if (!editHoldingModal) return;
      editingHoldingId = holdingId;

      // Find the holding details in lastPortfolioData
      if (!lastPortfolioData || !lastPortfolioData.holdings) return;
      const holding = lastPortfolioData.holdings.find(h => h.id == holdingId);
      if (!holding) return;

      // Prefill fields
      const curr = holding.currency || detectSymbolCurrency(holding.symbol);
      const editCostLabel = document.getElementById('edit-holding-avg-cost-label');
      if (editCostLabel) {
        const symIcon = getCurrencySymbol(curr);
        editCostLabel.textContent = `Average Buy Price (${curr} ${symIcon})`;
      }
      document.getElementById('edit-holding-symbol').value = holding.symbol;
      document.getElementById('edit-holding-quantity').value = holding.quantity;
      document.getElementById('edit-holding-avg-cost').value = holding.avgCost;
      document.getElementById('edit-holding-current-price').textContent = holding.currentPrice !== null ? formatMoneyWithIntl(holding.currentPrice, curr) : 'N/A';

      // Reset error view
      editHoldingError.classList.add('hidden');

      // Lock body scroll and open modal
      document.body.classList.add('overflow-hidden');
      editHoldingModal.classList.remove('hidden');
      closeEditHoldingBtn.focus();

      setTimeout(() => {
        const inner = editHoldingModal.querySelector('div');
        if (inner) {
          inner.classList.remove('opacity-0', 'scale-95');
          inner.classList.add('opacity-100', 'scale-100');
        }
      }, 10);
    }

    function closeEditHoldingModal() {
      if (!editHoldingModal) return;
      const inner = editHoldingModal.querySelector('div');
      if (inner) {
        inner.classList.remove('opacity-100', 'scale-100');
        inner.classList.add('opacity-0', 'scale-95');
      }
      setTimeout(() => {
        editHoldingModal.classList.add('hidden');
        document.body.classList.remove('overflow-hidden');
        editHoldingError.classList.add('hidden');
      }, 300);
    }

    if (closeEditHoldingBtn) {
      closeEditHoldingBtn.addEventListener('click', closeEditHoldingModal);
    }
    if (cancelEditHoldingBtn) {
      cancelEditHoldingBtn.addEventListener('click', closeEditHoldingModal);
    }
    if (editHoldingModal) {
      editHoldingModal.addEventListener('click', (e) => {
        const inner = editHoldingModal.querySelector('div');
        if (inner && !inner.contains(e.target)) {
          closeEditHoldingModal();
        }
      });
    }

    if (editHoldingForm) {
      editHoldingForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        editHoldingError.classList.add('hidden');

        const qtyInput = document.getElementById('edit-holding-quantity');
        const avgCostInput = document.getElementById('edit-holding-avg-cost');
        const saveBtn = document.getElementById('save-edit-holding-btn');

        const quantity = Number(qtyInput.value);
        const avgCost = Number(avgCostInput.value);

        if (isNaN(quantity) || quantity <= 0) {
          editHoldingError.textContent = 'Quantity must be greater than 0.';
          editHoldingError.classList.remove('hidden');
          return;
        }

        if (isNaN(avgCost) || avgCost < 0) {
          editHoldingError.textContent = 'Average buy price must be a valid positive number.';
          editHoldingError.classList.remove('hidden');
          return;
        }

        if (!editingHoldingId || editingHoldingId === 'undefined') {
          editHoldingError.textContent = 'Invalid holding ID. Please try closing and reopening the modal.';
          editHoldingError.classList.remove('hidden');
          return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        try {
          const res = await fetch(`${PORTFOLIO_URL}/${editingHoldingId}`, {
            method: 'PATCH',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ quantity, avgCost })
          });

          const data = await res.json();
          if (!res.ok) {
            editHoldingError.textContent = data.error || `Failed to update holding (${res.status})`;
            editHoldingError.classList.remove('hidden');
            return;
          }

          // Close modal and refresh UI values using currently selected base currency
          closeEditHoldingModal();
          lastPortfolioData = null; // Invalidate cached details
          const baseSelect = document.getElementById('base-currency-select');
          const savedBase = localStorage.getItem('tradepilot_base_currency');
          const currentBase = (baseSelect && baseSelect.value) ? baseSelect.value : (savedBase || 'INR');
          loadHoldings(currentBase);
          safeLoadNews(); // refresh news
        } catch (err) {
          editHoldingError.textContent = err.message || 'Could not reach the server. Make sure it is running.';
          editHoldingError.classList.remove('hidden');
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save Changes';
        }
      });
    }

    // --- Setup and initial fetch ---
    setupAutocomplete(watchlistSymbolInput, document.getElementById('watchlist-suggestions'));
    setupAutocomplete(symbolInput, document.getElementById('holding-suggestions'));
    
    // Initial fetches
    safeLoadHoldings();
    safeLoadWatchlist();
    safeLoadNews();
    refreshMarketHeadlines();
    startPolling();

    window.addEventListener('unload', () => {
      stopPolling();
    });
  });
})();
