(function () {
  const NARRATIVE_URL = '/api/narrative';
  let lastNarrative = null;

  document.addEventListener('DOMContentLoaded', function () {
    const btn = document.getElementById('regenerate-narrative-btn');
    const exportBtn = document.getElementById('export-narrative-btn');
    const errorBox = document.getElementById('narrative-error');
    const dateBadge = document.getElementById('narrative-date-badge');
    const sourceBadge = document.getElementById('narrative-source-badge');

    // Field ids match the actual markup on today.html
    const fields = {
      marketOverview: document.getElementById('narrative-what'),
      sectorMovement: document.getElementById('narrative-sector'),
      companyNews: document.getElementById('narrative-company-news'),
      watchlistEvents: document.getElementById('narrative-watchlist'),
      portfolioRelevance: document.getElementById('narrative-portfolio'),
      plainLanguageExplanation: document.getElementById('narrative-explainer')
    };

    if (!btn) return;

    function authHeaders(extra) {
      const h = window.TradePilotAuth ? window.TradePilotAuth.authHeader() : {};
      return { ...h, ...(extra || {}) };
    }

    function updateBadges(data) {
      if (dateBadge) {
        const d = data.generatedAt ? new Date(data.generatedAt) : new Date();
        dateBadge.textContent = d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
      }
      if (sourceBadge) {
        sourceBadge.classList.remove('hidden');
        if (data.dataSource === 'live') {
          sourceBadge.textContent = 'Live data';
          sourceBadge.className = 'text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-green-100 text-green-700';
        } else {
          sourceBadge.textContent = 'Simulated data';
          sourceBadge.className = 'text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-100 text-amber-700';
        }
      }
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

        lastNarrative = data;
        updateBadges(data);
      } catch (err) {
        errorBox.textContent = 'Could not reach the AI server. Make sure it is running (npm start).';
        errorBox.classList.remove('hidden');
      } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
      }
    }

    function exportPdf() {
      if (!lastNarrative) {
        errorBox.textContent = 'Generate a narrative first, then export.';
        errorBox.classList.remove('hidden');
        return;
      }
      if (!window.jspdf) {
        errorBox.textContent = 'PDF export library did not load. Check your internet connection and try again.';
        errorBox.classList.remove('hidden');
        return;
      }

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const margin = 48;
      const pageWidth = doc.internal.pageSize.getWidth();
      const maxWidth = pageWidth - margin * 2;
      let y = margin;

      function addTitle(text) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(18);
        doc.text(text, margin, y);
        y += 24;
      }

      function addSection(heading, body) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text(heading, margin, y);
        y += 16;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        const lines = doc.splitTextToSize(body || '—', maxWidth);
        doc.text(lines, margin, y);
        y += lines.length * 13 + 14;
        if (y > 760) {
          doc.addPage();
          y = margin;
        }
      }

      addTitle("TradePilot — Today's Narrative");
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(120);
      const generated = lastNarrative.generatedAt ? new Date(lastNarrative.generatedAt) : new Date();
      doc.text(`Generated ${generated.toLocaleString()} · Data source: ${lastNarrative.dataSource === 'live' ? 'Live market data' : 'Simulated (live feed unavailable)'}`, margin, y);
      y += 22;
      doc.setTextColor(0);

      addSection('Market Overview', lastNarrative.marketOverview);
      addSection('Sector Movement', lastNarrative.sectorMovement);
      addSection('Company News', lastNarrative.companyNews);
      addSection('Watchlist Events', lastNarrative.watchlistEvents);
      addSection('Portfolio Relevance', lastNarrative.portfolioRelevance);
      addSection('Beginner Explainer', lastNarrative.plainLanguageExplanation);

      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text('Educational/informational content only — not financial advice. Generated by TradePilot AI.', margin, 800);

      doc.save(`tradepilot-narrative-${generated.toISOString().slice(0, 10)}.pdf`);
    }

    btn.addEventListener('click', generateNarrative);
    if (exportBtn) exportBtn.addEventListener('click', exportPdf);

    // Auto-generate a fresh, personalized narrative once when the page first loads
    generateNarrative();
  });
})();
