(function () {
  const NARRATIVE_URL = '/api/narrative';

  document.addEventListener('DOMContentLoaded', function () {
    const btn = document.getElementById('regenerate-narrative-btn');
    const errorBox = document.getElementById('narrative-error');
    const fields = {
      marketOverview: document.getElementById('narrative-market-overview'),
      sectorMovement: document.getElementById('narrative-sector-movement'),
      companyNews: document.getElementById('narrative-company-news'),
      watchlistEvents: document.getElementById('narrative-watchlist-events'),
      portfolioRelevance: document.getElementById('narrative-portfolio-relevance'),
      plainLanguageExplanation: document.getElementById('narrative-explainer')
    };

    if (!btn) return;

    function authHeaders(extra) {
      const h = window.TradePilotAuth ? window.TradePilotAuth.authHeader() : {};
      return { ...h, ...(extra || {}) };
    }

    async function generateNarrative() {
      errorBox.classList.add('hidden');
      const originalText = btn.innerHTML;
      btn.innerHTML = '<span class="material-symbols-outlined text-[16px] animate-spin">progress_activity</span> Generating...';
      btn.disabled = true;

      try {
        const res = await fetch(NARRATIVE_URL, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' })
        });
        const data = await res.json();

        if (!res.ok) {
          errorBox.textContent = data.error || 'Could not generate a new narrative.';
          errorBox.classList.remove('hidden');
          return;
        }

        Object.keys(fields).forEach((key) => {
          if (fields[key] && data[key]) fields[key].textContent = data[key];
        });
      } catch (err) {
        errorBox.textContent = 'Could not reach the AI server. Make sure it is running (npm start).';
        errorBox.classList.remove('hidden');
      } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
      }
    }

    btn.addEventListener('click', generateNarrative);

    // Auto-generate a fresh, personalized narrative once when the page first loads
    generateNarrative();
  });
})();