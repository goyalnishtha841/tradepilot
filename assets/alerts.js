(function () {
  const ALERTS_URL = '/api/alerts';
  let lastAlerts = [];
  let lastHistory = [];
  let lastInsights = null;

  document.addEventListener('DOMContentLoaded', function () {
    const listEl = document.getElementById('your-alerts-list');
    const emptyState = document.getElementById('alerts-empty-state');
    const formError = document.getElementById('alert-form-error');
    const formSuccess = document.getElementById('alert-form-success');
    const saveBtn = document.getElementById('save-alert-btn');
    const modal = document.getElementById('new-alert-modal');
    const exportBtn = document.getElementById('export-alerts-btn');

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

    // Matches server MONITORED_TYPES — every type here has a real live data feed
    // behind it, including Filing (SEC EDGAR).
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
      if (priority === 'Critical') return 'border-l-error bg-error-container/10';
      if (priority === 'High') return 'border-l-secondary bg-secondary-container/10';
      return 'border-l-outline-variant bg-white';
    }

    function renderAlerts(alerts) {
      listEl.querySelectorAll('.alert-card').forEach((el) => el.remove());

      if (!alerts || alerts.length === 0) {
        emptyState.classList.remove('hidden');
        return;
      }
      emptyState.classList.add('hidden');

      alerts.forEach((alert) => {
        const card = document.createElement('div');
        card.id = `alert-card-${alert.id}`;
        card.className = `alert-card bg-white border border-outline-variant/30 rounded-xl p-md shadow-sm border-l-4 ${priorityClasses(alert.priority)} flex flex-col md:flex-row md:items-center justify-between gap-sm`;

        const statusBadge = !alert.monitored
          ? '<span class="px-2 py-0.5 bg-outline-variant/30 text-on-surface-variant rounded text-label-sm font-label-sm">NOT MONITORED YET</span>'
          : alert.status === 'triggered'
          ? '<span class="px-2 py-0.5 bg-error-container text-on-error-container rounded text-label-sm font-label-sm">TRIGGERED</span>'
          : '<span class="px-2 py-0.5 bg-secondary-container text-on-secondary-container rounded text-label-sm font-label-sm">ACTIVE</span>';

        const dataLabel = alert.simulated ? 'Simulated' : 'Live';
        const dataBadgeClass = alert.simulated ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700';
        const description = alert.monitored
          ? (alert.displayValue || '—')
          : `Saved for $${alert.symbol} — no live ${alert.alertType.toLowerCase()} data feed connected yet, so this isn't being actively checked.`;

        card.innerHTML = `
          <div class="flex-1">
            <div class="flex items-center gap-sm mb-1 flex-wrap">
              ${statusBadge}
              <h4 class="text-title-md font-title-md">$${alert.symbol}</h4>
              <span class="text-label-sm text-on-surface-variant">${alert.alertType} · ${alert.priority}</span>
            </div>
            <p class="text-label-md text-on-surface-variant">${description}</p>
          </div>
          <div class="flex md:flex-col items-end gap-xs shrink-0">
            ${alert.monitored ? `
            <div class="flex items-center gap-xs text-label-sm text-on-surface-variant">
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${dataBadgeClass}">${dataLabel}</span>
              <span>$${Number(alert.currentPrice).toFixed(2)}</span>
            </div>` : ''}
            <button class="delete-alert-btn px-3 py-2 text-error border border-error/30 rounded-lg text-label-sm font-bold hover:bg-error hover:text-white transition-all" data-id="${alert.id}">
              Delete
            </button>
          </div>
        `;
        listEl.appendChild(card);
      });

      listEl.querySelectorAll('.delete-alert-btn').forEach((btn) => {
        btn.addEventListener('click', () => deleteAlert(btn.getAttribute('data-id')));
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
          renderUrgentActionCenter(lastAlerts);
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

    function renderUrgentActionCenter(alerts) {
      const el = document.getElementById('urgent-action-center');
      if (!el) return;

      // Urgent = already triggered, or active + Critical/High priority close to firing.
      // "Close to firing" only makes sense as a $ distance for Price Threshold —
      // other types (Volume, Sector, Portfolio, Sentiment) use targetPrice for a
      // different unit entirely, so proximity isn't computed for those; they only
      // qualify once actually triggered.
      const urgent = alerts.filter((a) => {
        if (!a.monitored) return false;
        if (a.status === 'triggered') return true;
        if (a.priority !== 'Critical' && a.priority !== 'High') return false;
        if (a.alertType !== 'Price Threshold') return false;
        const target = Number(a.targetPrice);
        const distancePercent = Math.abs((a.currentPrice - target) / target) * 100;
        return distancePercent <= 3;
      }).sort((a, b) => {
        // Triggered alerts first, most recently triggered first; then approaching-target ones.
        if (a.status === 'triggered' && b.status !== 'triggered') return -1;
        if (b.status === 'triggered' && a.status !== 'triggered') return 1;
        if (a.status === 'triggered' && b.status === 'triggered') {
          return new Date(b.triggeredAt) - new Date(a.triggeredAt);
        }
        return 0;
      }).slice(0, 5);

      if (!urgent.length) {
        el.innerHTML = '<p class="text-label-sm text-on-surface-variant">Nothing urgent right now.</p>';
        return;
      }

      el.innerHTML = urgent.map((a) => {
        const isTriggered = a.status === 'triggered';
        const bg = isTriggered ? 'bg-error-container/20 border-error/20' : 'bg-secondary-container/20 border-secondary/20';
        const iconBg = isTriggered ? 'bg-error-container' : 'bg-secondary-container';
        const iconColor = isTriggered ? 'text-error' : 'text-secondary';
        const icon = isTriggered ? 'priority_high' : 'trending_up';
        const label = isTriggered
          ? `Triggered — price went ${a.condition} $${Number(a.targetPrice).toFixed(2)}`
          : `Within 3% of $${Number(a.targetPrice).toFixed(2)} target`;
        return `<div class="${bg} border rounded-20px p-md flex items-center gap-md">
          <div class="w-12 h-12 ${iconBg} rounded-full flex items-center justify-center flex-shrink-0">
            <span class="material-symbols-outlined ${iconColor}">${icon}</span>
          </div>
          <div class="flex-1">
            <h4 class="text-label-md font-bold text-on-surface">$${a.symbol} ${isTriggered ? 'Triggered' : 'Approaching Target'}</h4>
            <p class="text-[12px] text-on-surface-variant">${label}</p>
          </div>
          <button class="view-alert-btn px-4 py-2 bg-primary text-white text-label-sm font-bold rounded-lg shadow-sm hover:opacity-90" data-id="${a.id}">View</button>
        </div>`;
      }).join('');

      el.querySelectorAll('.view-alert-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const card = document.getElementById(`alert-card-${btn.getAttribute('data-id')}`);
          if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.style.outline = '2px solid var(--md-sys-color-primary, #4f46e5)';
            setTimeout(() => { card.style.outline = ''; }, 2000);
          }
        });
      });
    }

    function renderCategoriesGrid(alerts) {
      const el = document.getElementById('alert-categories-grid');
      if (!el) return;

      const categories = [
        { type: 'Price Threshold', label: 'Price Targets', icon: 'monetization_on', desc: 'Specific price thresholds and breakouts.' },
        { type: 'Volume Movement', label: 'Volume Spikes', icon: 'bar_chart', desc: 'Unusual trading volume vs. average.' },
        { type: 'News', label: 'News Impact', icon: 'newspaper', desc: 'Real-time alerts for new articles.' },
        { type: 'Filing', label: 'SEC Filings', icon: 'gavel', desc: 'New 10-K, 10-Q, 8-K filings.' },
        { type: 'Sentiment Shift', label: 'Keyword Sentiment', icon: 'psychology', desc: 'Heuristic score from real headlines.' },
        { type: 'Sector Impact', label: 'Sector Impact', icon: 'category', desc: "Moves in this stock's sector ETF." },
        { type: 'Portfolio Relevance', label: 'Portfolio Relevance', icon: 'account_balance_wallet', desc: 'Moves on symbols you actually hold.' }
      ];

      el.innerHTML = categories.map((c) => {
        const count = alerts.filter((a) => a.alertType === c.type).length;
        return `<div class="p-md bg-white border border-outline-variant/30 rounded-20px shadow-sm">
          <div class="flex justify-between items-start mb-xs">
            <span class="material-symbols-outlined text-primary p-2 bg-surface-container rounded-lg">${c.icon}</span>
            <span class="text-label-sm font-label-sm text-on-surface-variant">${count} of your alerts</span>
          </div>
          <h3 class="text-label-md font-bold text-on-surface">${c.label}</h3>
          <p class="text-label-sm text-on-surface-variant mt-1">${c.desc}</p>
        </div>`;
      }).join('');
    }

    async function loadRecentTriggers() {
      const el = document.getElementById('recent-triggers-list');
      if (!el) return;
      try {
        const res = await fetch('/api/alerts/history', { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        lastHistory = data.history;

        if (!data.history.length) {
          el.innerHTML = '<p class="text-label-sm text-on-surface-variant p-md bg-surface-container-low rounded-xl border border-outline-variant/20">No alerts have triggered yet.</p>';
          return;
        }

        el.innerHTML = data.history.map((h) => {
          const priorityClass = h.priority === 'Critical' ? 'border-l-error' : h.priority === 'High' ? 'border-l-secondary' : 'border-l-outline-variant';
          const badgeClass = h.priority === 'Critical' ? 'bg-error-container text-on-error-container' : h.priority === 'High' ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container text-on-surface-variant';
          const when = new Date(h.triggeredAt);
          const minsAgo = Math.max(1, Math.round((Date.now() - when.getTime()) / 60000));
          const timeLabel = minsAgo < 60 ? `${minsAgo} mins ago` : minsAgo < 1440 ? `${Math.round(minsAgo / 60)} hr ago` : when.toLocaleDateString();
          return `<div class="bg-white border border-outline-variant/30 rounded-20px p-md shadow-sm border-l-4 ${priorityClass}">
            <div class="flex items-center gap-sm mb-xs flex-wrap">
              <span class="px-2 py-0.5 ${badgeClass} rounded text-label-sm font-label-sm">${h.priority.toUpperCase()}</span>
              <span class="text-label-sm text-on-surface-variant">${timeLabel}</span>
              <h4 class="text-title-md font-title-md">$${h.symbol}</h4>
            </div>
            <p class="text-body-md text-on-surface-variant">Price went <b>${h.condition}</b> the $${Number(h.targetPrice).toFixed(2)} target — actual price at trigger was <b>$${Number(h.priceAtTrigger).toFixed(2)}</b>.</p>
          </div>`;
        }).join('');
      } catch (err) {
        el.innerHTML = '<p class="text-label-sm text-error">Could not load trigger history.</p>';
      }
    }

    async function loadInsights() {
      const accuracyEl = document.getElementById('signal-accuracy-display');
      const insightsEl = document.getElementById('alert-insights-list');
      if (!accuracyEl && !insightsEl) return;
      try {
        const res = await fetch('/api/alerts/insights', { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        lastInsights = data;
        if (accuracyEl) {
          if (data.signalAccuracy === null) {
            accuracyEl.innerHTML = `<p class="text-label-sm text-on-surface-variant text-center px-md">Not enough trigger history yet to measure signal accuracy.<br>This fills in once your alerts have triggered and had at least an hour to play out.</p>`;
          } else {
            accuracyEl.innerHTML = `<div class="text-center">
              <p class="text-display-lg font-bold text-primary">${data.signalAccuracy}%</p>
              <p class="text-label-sm text-on-surface-variant mt-xs">of ${data.signalSampleSize} triggered alert${data.signalSampleSize === 1 ? '' : 's'} still held direction 1+ hour later</p>
            </div>`;
          }
        }

        if (insightsEl) {
          insightsEl.innerHTML = `
            <div class="flex items-center justify-between p-sm bg-surface-container-low rounded-xl">
              <span class="text-label-md">Most Active Asset</span>
              <span class="font-bold">${data.mostActiveSymbol ? '$' + data.mostActiveSymbol : '—'}</span>
            </div>
            <div class="flex items-center justify-between p-sm bg-surface-container-low rounded-xl">
              <span class="text-label-md">Avg Time to Trigger</span>
              <span class="font-bold">${data.avgTimeToTriggerHours != null ? data.avgTimeToTriggerHours + ' hrs' : '—'}</span>
            </div>
            <div class="flex items-center justify-between p-sm bg-surface-container-low rounded-xl">
              <span class="text-label-md">Total Triggers</span>
              <span class="font-bold">${data.totalTriggers}</span>
            </div>`;
        }
      } catch (err) {
        if (accuracyEl) accuracyEl.innerHTML = '<p class="text-label-sm text-error">Could not load insights.</p>';
        if (insightsEl) insightsEl.innerHTML = '<p class="text-label-sm text-error">Could not load insights.</p>';
      }
    }

    function exportPdf() {
      if (!window.jspdf) {
        formError.textContent = 'PDF export library did not load. Check your internet connection and try again.';
        formError.classList.remove('hidden');
        return;
      }
      if (!lastAlerts.length) {
        formError.textContent = 'No alerts to export yet.';
        formError.classList.remove('hidden');
        return;
      }

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const margin = 48;
      const maxWidth = doc.internal.pageSize.getWidth() - margin * 2;
      let y = margin;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.text('TradePilot — Smart Alerts', margin, y);
      y += 20;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text(`Exported ${new Date().toLocaleString()}`, margin, y);
      doc.setTextColor(0);
      y += 26;

      lastAlerts.forEach((alert, i) => {
        if (y > 740) {
          doc.addPage();
          y = margin;
        }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.text(`${i + 1}. $${alert.symbol} — ${alert.alertType} (${alert.priority})`, margin, y);
        y += 15;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        const status = alert.status === 'triggered' ? 'TRIGGERED' : alert.monitored ? 'ACTIVE' : 'NOT MONITORED';
        const dataLabel = alert.simulated ? 'simulated' : 'live';
        const line = alert.monitored
          ? `Status: ${status} · ${alert.displayValue || ''} (${dataLabel} data, stock price: $${Number(alert.currentPrice).toFixed(2)})`
          : `Status: ${status} · No live data feed connected for this alert type yet`;
        const lines = doc.splitTextToSize(line, maxWidth);
        doc.text(lines, margin, y);
        y += lines.length * 13 + 12;
      });

      if (lastHistory.length) {
        if (y > 700) { doc.addPage(); y = margin; }
        y += 10;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text('Recent Trigger History', margin, y);
        y += 18;
        lastHistory.forEach((h) => {
          if (y > 740) { doc.addPage(); y = margin; }
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          const line = `$${h.symbol} — went ${h.condition} $${Number(h.targetPrice).toFixed(2)} (actual: $${Number(h.priceAtTrigger).toFixed(2)}) at ${new Date(h.triggeredAt).toLocaleString()}`;
          const lines = doc.splitTextToSize(line, maxWidth);
          doc.text(lines, margin, y);
          y += lines.length * 13 + 8;
        });
      }

      if (lastInsights) {
        if (y > 700) { doc.addPage(); y = margin; }
        y += 10;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text('Alert Insights', margin, y);
        y += 18;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        const insightsLine = `Most active: ${lastInsights.mostActiveSymbol ? '$' + lastInsights.mostActiveSymbol : '—'} · Avg time to trigger: ${lastInsights.avgTimeToTriggerHours != null ? lastInsights.avgTimeToTriggerHours + ' hrs' : '—'} · Total triggers: ${lastInsights.totalTriggers} · Signal accuracy: ${lastInsights.signalAccuracy != null ? lastInsights.signalAccuracy + '%' : 'not enough data yet'}`;
        const insightsLines = doc.splitTextToSize(insightsLine, maxWidth);
        doc.text(insightsLines, margin, y);
        y += insightsLines.length * 13 + 12;
      }

      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text('Educational/informational content only — not financial advice. Generated by TradePilot.', margin, 800);

      doc.save(`tradepilot-alerts-${new Date().toISOString().slice(0, 10)}.pdf`);
    }

    async function deleteAlert(id) {
      try {
        await fetch(`${ALERTS_URL}/${id}`, { method: 'DELETE', headers: authHeaders() });
        loadAlerts();
      } catch (err) {
        console.error('Could not delete alert', err);
      }
    }

    async function createAlert() {
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

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      try {
        const res = await fetch(ALERTS_URL, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (!res.ok) {
          formError.textContent = data.error || 'Could not create alert.';
          formError.classList.remove('hidden');
          return;
        }

        symbolInput.value = '';
        targetPriceInput.value = '';
        modal.classList.add('hidden');
        formSuccess.textContent = `Alert created for $${data.alert.symbol}.`;
        formSuccess.classList.remove('hidden');
        loadAlerts();
      } catch (err) {
        formError.textContent = 'Could not reach the server. Make sure it is running (npm start).';
        formError.classList.remove('hidden');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Alert';
      }
    }

    saveBtn.addEventListener('click', createAlert);
    if (exportBtn) exportBtn.addEventListener('click', exportPdf);
    loadAlerts();
    loadRecentTriggers();
    loadInsights();
  });
})();