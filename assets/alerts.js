(function () {
  const ALERTS_URL = '/api/alerts';
  let lastAlerts = [];

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
    const conditionWrapper = document.getElementById('alert-condition-wrapper');
    const typeNote = document.getElementById('alert-type-note');

    if (!listEl || !saveBtn) return; // not on this page

    const MONITORED_TYPES = ['Price Threshold'];

    function updateTypeUI() {
      const isMonitored = MONITORED_TYPES.includes(typeSelect.value);
      if (conditionWrapper) conditionWrapper.classList.toggle('hidden', !isMonitored);
      if (typeNote) {
        if (isMonitored) {
          typeNote.classList.add('hidden');
        } else {
          typeNote.textContent = `"${typeSelect.value}" alerts are saved to your account but not yet auto-monitored — this app doesn't have a live ${typeSelect.value.toLowerCase()} data feed connected yet. Price Threshold alerts are the only type actively checked right now.`;
          typeNote.classList.remove('hidden');
        }
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
        card.className = `alert-card bg-white border border-outline-variant/30 rounded-xl p-md shadow-sm border-l-4 ${priorityClasses(alert.priority)} flex flex-col md:flex-row md:items-center justify-between gap-sm`;

        const statusBadge = !alert.monitored
          ? '<span class="px-2 py-0.5 bg-outline-variant/30 text-on-surface-variant rounded text-label-sm font-label-sm">NOT MONITORED YET</span>'
          : alert.status === 'triggered'
          ? '<span class="px-2 py-0.5 bg-error-container text-on-error-container rounded text-label-sm font-label-sm">TRIGGERED</span>'
          : '<span class="px-2 py-0.5 bg-secondary-container text-on-secondary-container rounded text-label-sm font-label-sm">ACTIVE</span>';

        const priceLabel = alert.simulated ? 'simulated price (live feed unavailable)' : 'live price';
        const description = alert.monitored
          ? `Alert when price goes <b>${alert.condition}</b> $${Number(alert.targetPrice).toFixed(2)} — current ${priceLabel}: <b>$${Number(alert.currentPrice).toFixed(2)}</b>`
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
          <button class="delete-alert-btn px-3 py-2 text-error border border-error/30 rounded-lg text-label-sm font-bold hover:bg-error hover:text-white transition-all" data-id="${alert.id}">
            Delete
          </button>
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
        }
      } catch (err) {
        console.error('Could not load alerts', err);
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
        const priceLabel = alert.simulated ? 'simulated' : 'live';
        const line = alert.monitored
          ? `Status: ${status} · Condition: ${alert.condition} $${Number(alert.targetPrice).toFixed(2)} · Current (${priceLabel}): $${Number(alert.currentPrice).toFixed(2)}`
          : `Status: ${status} · No live data feed connected for this alert type yet`;
        const lines = doc.splitTextToSize(line, maxWidth);
        doc.text(lines, margin, y);
        y += lines.length * 13 + 12;
      });

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

      const isMonitored = MONITORED_TYPES.includes(typeSelect.value);
      const payload = {
        symbol: symbolInput.value.trim(),
        alertType: typeSelect.value,
        priority: prioritySelect.value,
        condition: isMonitored ? conditionSelect.value : 'above',
        targetPrice: isMonitored ? targetPriceInput.value : '0.01'
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
  });
})();