(function () {
  const ALERTS_URL = '/api/alerts';
  let lastAlerts = [];
  let activeCategoryFilter = null;
  let editingAlertId = null;

  // Shared per-type styling — used consistently across Alert Categories,
  // Your Alerts cards, and Recent Triggers so the whole page reads as one design.
  const TYPE_META = {
    'Price Threshold': { icon: 'monetization_on', color: 'text-blue-600 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-300' },
    'Volume Movement': { icon: 'bar_chart', color: 'text-purple-600 bg-purple-50 dark:bg-purple-900/30 dark:text-purple-300' },
    'News': { icon: 'newspaper', color: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 dark:text-indigo-300' },
    'Filing': { icon: 'gavel', color: 'text-slate-600 bg-slate-100 dark:bg-slate-700/40 dark:text-slate-300' },
    'Sentiment Shift': { icon: 'psychology', color: 'text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300' },
    'Sector Impact': { icon: 'category', color: 'text-teal-600 bg-teal-50 dark:bg-teal-900/30 dark:text-teal-300' },
    'Portfolio Relevance': { icon: 'account_balance_wallet', color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-300' }
  };
  const PRIORITY_ORDER = { Critical: 0, High: 1, Medium: 2 };

  document.addEventListener('DOMContentLoaded', function () {
    const listEl = document.getElementById('your-alerts-list');
    const emptyState = document.getElementById('alerts-empty-state');
    const formError = document.getElementById('alert-form-error');
    const formSuccess = document.getElementById('alert-form-success');
    const saveBtn = document.getElementById('save-alert-btn');
    const modal = document.getElementById('new-alert-modal');
    const modalTitle = document.getElementById('alert-modal-title');
    const openCreateBtn = document.getElementById('open-create-alert-btn');
    const refreshAllBtn = document.getElementById('refresh-all-btn');

    const symbolInput = document.getElementById('alert-symbol');
    const typeSelect = document.getElementById('alert-type');
    const prioritySelect = document.getElementById('alert-priority');
    const conditionSelect = document.getElementById('alert-condition');
    const targetPriceInput = document.getElementById('alert-target-price');
    const conditionWrapper = document.getElementById('alert-price-condition-wrap');
    const conditionVerb = document.getElementById('alert-condition-verb');
    const conditionHint = document.getElementById('alert-condition-hint');
    const targetUnit = document.getElementById('alert-target-unit');
    const typeNote = document.getElementById('alert-type-note');
    const typeNoteText = document.getElementById('alert-type-note-text');
    const typeNoteLabel = document.getElementById('alert-type-note-label');

    if (!listEl || !saveBtn) return; // not on this page

    const MONITORED_TYPES = ['Price Threshold', 'Volume Movement', 'News', 'Filing', 'Sentiment Shift', 'Sector Impact', 'Portfolio Relevance'];
    const TYPES_REQUIRING_TARGET = ['Price Threshold', 'Volume Movement', 'Sentiment Shift', 'Sector Impact', 'Portfolio Relevance'];

    const TYPE_UI = {
      'Price Threshold': { verb: 'Price goes', unit: '', placeholder: '0.00', hint: 'Enter a dollar price, e.g. 220.00.' },
      'Volume Movement': { verb: 'Volume goes', unit: 'x average', placeholder: '1.5', hint: 'Enter a multiple of average volume, e.g. 1.5 = 150% of normal volume.' },
      'Sentiment Shift': { verb: 'Keyword sentiment score goes', unit: '', placeholder: '2', hint: 'Enter a score threshold, e.g. 2 or -2.' },
      'Sector Impact': { verb: "Symbol's sector moves", unit: '%', placeholder: '2', hint: "Enter a percent move in the stock's sector ETF, e.g. 2 for \u00b12%." },
      'Portfolio Relevance': { verb: 'Symbol moves', unit: '%', placeholder: '3', hint: 'Only triggers if this symbol is also in your Portfolio holdings.' }
    };

    const TYPE_EXPLANATIONS = {
      'Price Threshold': `Checks the real current stock price against your target — a straightforward "tell me when it crosses this line."`,
      'Volume Movement': `Compares today's real trading volume to that stock's normal average. A high ratio (e.g. 1.5x) often means something unusual is happening even before the news catches up.`,
      'Sector Impact': `Watches the real ETF that tracks this stock's whole sector (e.g. Technology → XLK), not just the stock itself — useful for spotting industry-wide moves.`,
      'Portfolio Relevance': `Only activates if this symbol is in your Portfolio holdings — checks real day-over-day % moves on money you actually have invested.`,
      'Sentiment Shift': `A simple, honest heuristic: counts positive vs. negative finance words across real recent headlines. This is NOT true AI sentiment analysis (that needs a paid model this app doesn't have) — just a real, transparent word-count signal.`,
      'News': `Triggers on the next real news article published for this symbol after you create the alert.`,
      'Filing': `Triggers on the next real SEC filing (10-K, 10-Q, 8-K, etc.) for this symbol after you create the alert. Only works for US-listed companies with SEC filings.`
    };

    function updateTypeUI() {
      const type = typeSelect.value;
      const isMonitored = MONITORED_TYPES.includes(type);
      const requiresTarget = TYPES_REQUIRING_TARGET.includes(type);

      if (conditionWrapper) conditionWrapper.classList.toggle('hidden', !requiresTarget);

      if (requiresTarget) {
        const ui = TYPE_UI[type];
        if (conditionVerb) conditionVerb.textContent = ui.verb;
        if (targetUnit) targetUnit.textContent = ui.unit;
        if (targetPriceInput) targetPriceInput.placeholder = ui.placeholder;
        if (conditionHint) conditionHint.textContent = ui.hint;
      }

      if (typeNote && typeNoteText) {
        if (!isMonitored) {
          if (typeNoteLabel) typeNoteLabel.textContent = 'Not monitored yet';
          typeNoteText.textContent = `"${type}" alerts are saved to your account but not yet auto-monitored — this app doesn't have a live ${type.toLowerCase()} data feed connected yet.`;
        } else {
          if (typeNoteLabel) typeNoteLabel.textContent = 'How this alert type works';
          typeNoteText.textContent = TYPE_EXPLANATIONS[type] || '';
        }
        typeNote.classList.remove('hidden');
      }
    }
    typeSelect.addEventListener('change', updateTypeUI);
    updateTypeUI();

    function authHeaders(extra) {
      const h = window.TradePilotAuth ? window.TradePilotAuth.authHeader() : {};
      return { ...h, ...(extra || {}) };
    }

    function priorityClasses(priority) {
      if (priority === 'Critical') return 'border-l-error bg-error-container/10 dark:bg-dark-error-container/20';
      if (priority === 'High') return 'border-l-secondary bg-secondary-container/10 dark:bg-dark-secondary-container/20';
      return 'border-l-outline-variant bg-white dark:bg-dark-surface-container';
    }

    function priorityBadge(priority) {
      const cls = priority === 'Critical' ? 'bg-error-container dark:bg-dark-error-container/40 text-on-error-container dark:text-red-200'
        : priority === 'High' ? 'bg-secondary-container dark:bg-dark-secondary-container/40 text-on-secondary-container dark:text-dark-on-surface'
        : 'bg-surface-container dark:bg-dark-surface-container text-on-surface-variant dark:text-dark-on-surface-variant';
      return `<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${cls}">${priority}</span>`;
    }

    function openCreateModal() {
      editingAlertId = null;
      symbolInput.value = '';
      targetPriceInput.value = '';
      typeSelect.value = 'Price Threshold';
      prioritySelect.value = 'Medium';
      conditionSelect.value = 'above';
      updateTypeUI();
      if (modalTitle) modalTitle.textContent = 'Create Smart Alert';
      if (saveBtn) saveBtn.textContent = 'Save Alert';
      formError.classList.add('hidden');
      modal.classList.remove('hidden');
    }

    function openEditModal(alert) {
      editingAlertId = alert.id;
      symbolInput.value = alert.symbol;
      typeSelect.value = alert.alertType;
      prioritySelect.value = alert.priority;
      conditionSelect.value = alert.condition;
      targetPriceInput.value = alert.targetPrice;
      updateTypeUI();
      if (modalTitle) modalTitle.textContent = `Edit Alert — $${alert.symbol}`;
      if (saveBtn) saveBtn.textContent = 'Update Alert';
      formError.classList.add('hidden');
      modal.classList.remove('hidden');
    }

    if (openCreateBtn) openCreateBtn.addEventListener('click', openCreateModal);

    function renderAlerts(alerts) {
      listEl.querySelectorAll('.alert-card').forEach((el) => el.remove());

      const filtered = activeCategoryFilter ? alerts.filter((a) => a.alertType === activeCategoryFilter) : alerts;
      // Triggered first, then by priority (Critical > High > Medium), then most recent.
      const sorted = [...filtered].sort((a, b) => {
        if (a.status === 'triggered' && b.status !== 'triggered') return -1;
        if (b.status === 'triggered' && a.status !== 'triggered') return 1;
        const pa = PRIORITY_ORDER[a.priority] ?? 3;
        const pb = PRIORITY_ORDER[b.priority] ?? 3;
        if (pa !== pb) return pa - pb;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });

      const filterBadge = document.getElementById('alerts-filter-badge');
      if (filterBadge) {
        if (activeCategoryFilter) {
          filterBadge.textContent = `Filtered: ${activeCategoryFilter} (clear)`;
          filterBadge.classList.remove('hidden');
          filterBadge.onclick = () => { activeCategoryFilter = null; renderAlerts(lastAlerts); renderCategoriesGrid(lastAlerts); };
          filterBadge.classList.add('cursor-pointer', 'hover:underline');
        } else {
          filterBadge.classList.add('hidden');
        }
      }

      if (!sorted.length) {
        emptyState.classList.remove('hidden');
        emptyState.textContent = activeCategoryFilter
          ? `No ${activeCategoryFilter} alerts yet.`
          : `You don't have any alerts yet — click "Create New Alert" above to set one up.`;
        return;
      }
      emptyState.classList.add('hidden');

      sorted.forEach((alert) => {
        const card = document.createElement('div');
        card.id = `alert-card-${alert.id}`;
        card.className = `alert-card bg-white dark:bg-dark-surface-container border border-outline-variant/30 rounded-xl p-md shadow-sm border-l-4 ${priorityClasses(alert.priority)} flex flex-col md:flex-row md:items-center justify-between gap-sm`;

        const meta = TYPE_META[alert.alertType] || { icon: 'notifications', color: 'text-on-surface-variant dark:text-dark-on-surface-variant bg-surface-container dark:bg-dark-surface-container' };
        const statusBadge = !alert.monitored
          ? '<span class="px-2 py-0.5 bg-outline-variant/30 text-on-surface-variant dark:text-dark-on-surface-variant rounded text-label-sm font-label-sm">NOT MONITORED YET</span>'
          : alert.status === 'triggered'
          ? '<span class="px-2 py-0.5 bg-error-container dark:bg-dark-error-container/40 text-on-error-container dark:text-red-200 rounded text-label-sm font-label-sm">TRIGGERED</span>'
          : '<span class="px-2 py-0.5 bg-secondary-container dark:bg-dark-secondary-container/40 text-on-secondary-container dark:text-dark-on-surface rounded text-label-sm font-label-sm">ACTIVE</span>';

        const dataLabel = alert.simulated ? 'Simulated' : 'Live';
        const dataBadgeClass = alert.simulated ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300';
        const description = alert.monitored
          ? (alert.displayValue || '—')
          : `Saved for $${alert.symbol} — no live ${alert.alertType.toLowerCase()} data feed connected yet, so this isn't being actively checked.`;

        card.innerHTML = `
          <div class="flex items-start gap-sm flex-1">
            <span class="material-symbols-outlined p-2 rounded-lg shrink-0 ${meta.color}">${meta.icon}</span>
            <div class="flex-1">
              <div class="flex items-center gap-sm mb-1 flex-wrap">
                ${statusBadge}
                ${priorityBadge(alert.priority)}
                <h4 class="text-title-md font-title-md text-on-surface dark:text-dark-on-surface">$${alert.symbol}</h4>
                <span class="text-label-sm text-on-surface-variant dark:text-dark-on-surface-variant">${alert.alertType}</span>
              </div>
              <p class="text-label-md text-on-surface-variant dark:text-dark-on-surface-variant">${description}</p>
            </div>
          </div>
          <div class="flex md:flex-col items-end gap-xs shrink-0">
            ${alert.monitored ? `
            <div class="flex items-center gap-xs text-label-sm text-on-surface-variant dark:text-dark-on-surface-variant">
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${dataBadgeClass}">${dataLabel}</span>
              <span>$${Number(alert.currentPrice).toFixed(2)}</span>
            </div>` : ''}
            <div class="flex gap-xs">
              <button class="edit-alert-btn px-3 py-2 text-primary dark:text-dark-primary border border-primary/30 rounded-lg text-label-sm font-bold hover:bg-primary hover:text-white transition-all" data-id="${alert.id}">
                Edit
              </button>
              <button class="delete-alert-btn px-3 py-2 text-error border border-error/30 rounded-lg text-label-sm font-bold hover:bg-error hover:text-white transition-all" data-id="${alert.id}">
                Delete
              </button>
            </div>
          </div>
        `;
        listEl.appendChild(card);
      });

      listEl.querySelectorAll('.delete-alert-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          const a = lastAlerts.find((x) => String(x.id) === String(id));
          const label = a ? `$${a.symbol} (${a.alertType})` : 'this alert';
          if (confirm(`Delete ${label}? This can't be undone.`)) {
            deleteAlert(id);
          }
        });
      });
      listEl.querySelectorAll('.edit-alert-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          const a = lastAlerts.find((x) => String(x.id) === String(id));
          if (a) openEditModal(a);
        });
      });
    }

    async function loadAlerts() {
      try {
        const res = await fetch(ALERTS_URL, { headers: authHeaders() });
        const data = await res.json();
        if (res.ok) {
          lastAlerts = data.alerts || [];
          renderAlerts(lastAlerts);
          renderDataBadge(lastAlerts);
          renderCategoriesGrid(lastAlerts);
        }
      } catch (err) {
        console.error('Could not load alerts', err);
      }
    }

    function renderDataBadge(alerts) {
      const badge = document.getElementById('alerts-data-badge');
      if (!badge) return;
      if (!alerts.length) { badge.textContent = ''; return; }
      const anySimulated = alerts.some((a) => a.simulated);
      badge.textContent = anySimulated ? 'Some prices simulated (live feed unavailable)' : 'Live prices';
    }

    // ---------- Urgent Action Center: automatic, real, from actual holdings ----------
    async function loadPortfolioSignals() {
      const el = document.getElementById('urgent-action-center');
      if (!el) return;
      try {
        const res = await fetch('/api/alerts/portfolio-signals', { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        if (!data.hasHoldings) {
          el.innerHTML = '<p class="text-label-sm text-on-surface-variant dark:text-dark-on-surface-variant col-span-full">Add holdings on your Portfolio page to see automatic signals here.</p>';
          return;
        }
        if (!data.signals.length) {
          el.innerHTML = '<p class="text-label-sm text-on-surface-variant dark:text-dark-on-surface-variant col-span-full">Nothing notable in your holdings right now.</p>';
          return;
        }

        el.innerHTML = data.signals.map((s) => {
          const isNotable = s.severity !== 'Mild';
          const isCritical = s.severity === 'Critical';
          const bg = isCritical ? 'bg-error-container/20 dark:bg-dark-error-container/30 border-error/20' : isNotable ? 'bg-secondary-container/20 dark:bg-dark-secondary-container/30 border-secondary/20' : 'bg-surface-container-low dark:bg-dark-surface-container border-outline-variant/20';
          const iconBg = isCritical ? 'bg-error-container dark:bg-dark-error-container/60' : isNotable ? 'bg-secondary-container dark:bg-dark-secondary-container/60' : 'bg-surface-container dark:bg-dark-surface-container';
          const iconColor = isCritical ? 'text-error dark:text-red-300' : isNotable ? 'text-secondary dark:text-dark-on-surface' : 'text-on-surface-variant dark:text-dark-on-surface-variant';
          const icon = s.changePercent >= 0 ? 'trending_up' : 'trending_down';
          return `<div class="${bg} border rounded-20px p-md flex items-center gap-md">
            <div class="w-12 h-12 ${iconBg} rounded-full flex items-center justify-center flex-shrink-0">
              <span class="material-symbols-outlined ${iconColor}">${icon}</span>
            </div>
            <div class="flex-1">
              <h4 class="text-label-md font-bold text-on-surface dark:text-dark-on-surface">$${s.symbol} · ${s.severity}${s.simulated ? ' · simulated' : ''}</h4>
              <p class="text-[12px] text-on-surface-variant dark:text-dark-on-surface-variant">${s.note}</p>
            </div>
          </div>`;
        }).join('');
      } catch (err) {
        el.innerHTML = '<p class="text-label-sm text-error col-span-full">Could not load portfolio signals.</p>';
      }
    }

    function renderCategoriesGrid(alerts) {
      const el = document.getElementById('alert-categories-grid');
      if (!el) return;

      const categories = [
        { type: 'Price Threshold', label: 'Price Targets', desc: 'Specific price thresholds and breakouts.' },
        { type: 'Volume Movement', label: 'Volume Spikes', desc: 'Unusual trading volume vs. average.' },
        { type: 'News', label: 'News Impact', desc: 'Real-time alerts for new articles.' },
        { type: 'Filing', label: 'SEC Filings', desc: 'New 10-K, 10-Q, 8-K filings.' },
        { type: 'Sentiment Shift', label: 'Keyword Sentiment', desc: 'Heuristic score from real headlines.' },
        { type: 'Sector Impact', label: 'Sector Impact', desc: "Moves in this stock's sector ETF." },
        { type: 'Portfolio Relevance', label: 'Portfolio Relevance', desc: 'Moves on symbols you actually hold.' }
      ];

      el.innerHTML = categories.map((c) => {
        const meta = TYPE_META[c.type];
        const count = alerts.filter((a) => a.alertType === c.type).length;
        const isActive = activeCategoryFilter === c.type;
        return `<button data-type="${c.type}" class="category-filter-btn text-left p-md rounded-20px shadow-sm transition-all cursor-pointer relative overflow-hidden ${isActive ? 'bg-primary text-white shadow-lg scale-[1.02]' : 'bg-white dark:bg-dark-surface-container border border-outline-variant/30 hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5'}">
          ${isActive ? '<span class="material-symbols-outlined absolute top-2 right-2 text-[18px]">check_circle</span>' : ''}
          <div class="flex justify-between items-start mb-xs">
            <span class="material-symbols-outlined p-2 rounded-lg ${isActive ? 'bg-white/20 text-white' : meta.color}">${meta.icon}</span>
            ${!isActive ? `<span class="text-label-sm font-label-sm text-on-surface-variant dark:text-dark-on-surface-variant">${count} of your alerts</span>` : ''}
          </div>
          <h3 class="text-label-md font-bold ${isActive ? 'text-white' : 'text-on-surface dark:text-dark-on-surface'}">${c.label}</h3>
          <p class="text-label-sm mt-1 ${isActive ? 'text-white/80' : 'text-on-surface-variant dark:text-dark-on-surface-variant'}">${isActive ? `${count} of your alerts — click to clear` : c.desc}</p>
        </button>`;
      }).join('');

      el.querySelectorAll('.category-filter-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const type = btn.getAttribute('data-type');
          activeCategoryFilter = activeCategoryFilter === type ? null : type;
          renderAlerts(lastAlerts);
          renderCategoriesGrid(lastAlerts);
          if (activeCategoryFilter) {
            document.getElementById('your-alerts-list').scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
      });
    }

    async function loadRecentTriggers() {
      const el = document.getElementById('recent-triggers-list');
      if (!el) return;
      try {
        const res = await fetch('/api/alerts/history', { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        if (!data.history.length) {
          el.innerHTML = '<p class="text-label-sm text-on-surface-variant dark:text-dark-on-surface-variant p-md bg-surface-container-low dark:bg-dark-surface-container rounded-xl border border-outline-variant/20">No alerts have triggered yet.</p>';
          return;
        }

        el.innerHTML = data.history.map((h) => {
          const meta = TYPE_META[h.alertType] || { icon: 'notifications', color: 'text-on-surface-variant dark:text-dark-on-surface-variant bg-surface-container dark:bg-dark-surface-container' };
          const priorityClass = h.priority === 'Critical' ? 'border-l-error' : h.priority === 'High' ? 'border-l-secondary' : 'border-l-outline-variant';
          const when = new Date(h.triggeredAt);
          const minsAgo = Math.max(1, Math.round((Date.now() - when.getTime()) / 60000));
          const timeLabel = minsAgo < 60 ? `${minsAgo} mins ago` : minsAgo < 1440 ? `${Math.round(minsAgo / 60)} hr ago` : when.toLocaleDateString();
          return `<div class="bg-white dark:bg-dark-surface-container border border-outline-variant/30 rounded-20px p-md shadow-sm border-l-4 ${priorityClass} flex items-start gap-md">
            <span class="material-symbols-outlined p-2 rounded-lg shrink-0 ${meta.color}">${meta.icon}</span>
            <div class="flex-1">
              <div class="flex items-center gap-sm mb-xs flex-wrap">
                ${priorityBadge(h.priority)}
                <span class="text-label-sm text-on-surface-variant dark:text-dark-on-surface-variant">${timeLabel}</span>
                <h4 class="text-title-md font-title-md text-on-surface dark:text-dark-on-surface">$${h.symbol}</h4>
              </div>
              <p class="text-body-md text-on-surface-variant dark:text-dark-on-surface-variant">Price went <b>${h.condition}</b> the $${Number(h.targetPrice).toFixed(2)} target — actual price at trigger was <b>$${Number(h.priceAtTrigger).toFixed(2)}</b>.</p>
            </div>
          </div>`;
        }).join('');
      } catch (err) {
        el.innerHTML = '<p class="text-label-sm text-error">Could not load trigger history.</p>';
      }
    }

    // ---------- Unified Insights row (was: separate Signal Accuracy + Alert Insights) ----------
    async function loadInsights() {
      const gridEl = document.getElementById('alert-insights-grid');
      if (!gridEl) return;
      try {
        const res = await fetch('/api/alerts/insights', { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        const reliabilityValue = data.signalAccuracy === null ? '—' : `${data.signalAccuracy}%`;
        const reliabilitySub = data.signalAccuracy === null
          ? 'Not enough data yet'
          : `of ${data.signalSampleSize} held direction 1+ hr later`;

        const tiles = [
          {
            label: 'Alert Reliability', value: reliabilityValue, sub: reliabilitySub,
            icon: 'verified', accent: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-300',
            info: "When one of your alerts fires, does the price usually keep moving that direction afterward, or reverse? This checks each triggered alert again 1+ hour later. Higher = your alerts have been good signals so far. It fills in as you get more triggers with time to play out — it's not a prediction, just a look back at how your past alerts held up."
          },
          {
            label: 'Most Active Asset', value: data.mostActiveSymbol ? '$' + data.mostActiveSymbol : '—', sub: 'Most triggers',
            icon: 'bolt', accent: 'text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300'
          },
          {
            label: 'Avg Time to Trigger', value: data.avgTimeToTriggerHours != null ? data.avgTimeToTriggerHours + ' hrs' : '—', sub: 'Creation to firing',
            icon: 'schedule', accent: 'text-blue-600 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-300',
            info: "The average gap between when you created an alert and when it actually fired. A low number often just means you set an easy-to-hit target, not that something is 'fast' or 'slow' in a meaningful sense."
          },
          {
            label: 'Total Triggers', value: String(data.totalTriggers), sub: 'All time',
            icon: 'notifications_active', accent: 'text-primary dark:text-dark-primary bg-primary-container/30 dark:bg-dark-primary-container/20'
          }
        ];

        gridEl.innerHTML = tiles.map((t) => `
          <div class="bg-white dark:bg-dark-surface-container border border-outline-variant/30 rounded-20px p-md relative">
            <div class="flex items-start justify-between mb-sm">
              <span class="material-symbols-outlined p-2 rounded-lg ${t.accent}">${t.icon}</span>
              ${t.info ? `<button class="insight-info-btn text-on-surface-variant dark:text-dark-on-surface-variant hover:text-primary transition-colors rounded-full p-1 hover:bg-surface-container-low dark:hover:bg-surface-container-high" data-label="${t.label}" data-info="${t.info.replace(/"/g, '&quot;')}">
                <span class="material-symbols-outlined text-[18px]">info</span>
              </button>` : ''}
            </div>
            <p class="text-label-sm text-on-surface-variant dark:text-dark-on-surface-variant">${t.label}</p>
            <p class="text-title-lg font-bold text-on-surface dark:text-dark-on-surface">${t.value}</p>
            <p class="text-[11px] text-on-surface-variant dark:text-dark-on-surface-variant mt-xs">${t.sub}</p>
          </div>`).join('');

        gridEl.querySelectorAll('.insight-info-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            const modal = document.getElementById('insight-info-modal');
            const titleEl = document.getElementById('insight-info-modal-title');
            const textEl = document.getElementById('insight-info-modal-text');
            if (modal && titleEl && textEl) {
              titleEl.textContent = btn.getAttribute('data-label');
              textEl.textContent = btn.getAttribute('data-info');
              modal.classList.remove('hidden');
            }
          });
        });
        const infoModal = document.getElementById('insight-info-modal');
        if (infoModal) {
          infoModal.addEventListener('click', (e) => {
            if (e.target === infoModal) infoModal.classList.add('hidden');
          });
        }
      } catch (err) {
        gridEl.innerHTML = '<p class="text-label-sm text-error col-span-full">Could not load insights.</p>';
      }
    }

    async function deleteAlert(id) {
      try {
        await fetch(`${ALERTS_URL}/${id}`, { method: 'DELETE', headers: authHeaders() });
        loadAlerts();
      } catch (err) {
        console.error('Could not delete alert', err);
      }
    }

    async function saveAlert() {
      formError.classList.add('hidden');
      formSuccess.classList.add('hidden');

      const requiresTarget = TYPES_REQUIRING_TARGET.includes(typeSelect.value);
      const payload = {
        symbol: symbolInput.value.trim(),
        alertType: typeSelect.value,
        priority: prioritySelect.value,
        condition: requiresTarget ? conditionSelect.value : 'above',
        targetPrice: requiresTarget ? targetPriceInput.value : '0.01'
      };

      const isEditing = !!editingAlertId;
      saveBtn.disabled = true;
      saveBtn.textContent = isEditing ? 'Updating...' : 'Saving...';

      try {
        const res = await fetch(isEditing ? `${ALERTS_URL}/${editingAlertId}` : ALERTS_URL, {
          method: isEditing ? 'PUT' : 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (!res.ok) {
          formError.textContent = data.error || `Could not ${isEditing ? 'update' : 'create'} alert.`;
          formError.classList.remove('hidden');
          return;
        }

        modal.classList.add('hidden');
        formSuccess.textContent = isEditing ? `Alert updated for $${data.alert.symbol}.` : `Alert created for $${data.alert.symbol}.`;
        formSuccess.classList.remove('hidden');
        editingAlertId = null;
        loadAlerts();
      } catch (err) {
        formError.textContent = 'Could not reach the server. Make sure it is running (npm start).';
        formError.classList.remove('hidden');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = isEditing ? 'Update Alert' : 'Save Alert';
      }
    }

    function refreshEverything() {
      loadAlerts();
      loadPortfolioSignals();
      loadRecentTriggers();
      loadInsights();
      if (refreshAllBtn) {
        const icon = refreshAllBtn.querySelector('.material-symbols-outlined');
        if (icon) {
          icon.classList.add('animate-spin');
          setTimeout(() => icon.classList.remove('animate-spin'), 600);
        }
      }
    }

    saveBtn.addEventListener('click', saveAlert);
    if (refreshAllBtn) refreshAllBtn.addEventListener('click', refreshEverything);

    loadAlerts();
    loadPortfolioSignals();
    loadRecentTriggers();
    loadInsights();
  });
})();
