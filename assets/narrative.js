(function () {
  const NARRATIVE_URL = '/api/narrative';
  let lastNarrative = null;
  let lastSnapshot = null;

  document.addEventListener('DOMContentLoaded', function () {
    const btn = document.getElementById('regenerate-narrative-btn');
    const exportBtn = document.getElementById('export-narrative-btn');
    const errorBox = document.getElementById('narrative-error');
    const dateBadge = document.getElementById('narrative-date-badge');
    const sourceBadge = document.getElementById('narrative-source-badge');
    const subtitle = document.getElementById('narrative-subtitle');

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
          if (subtitle) subtitle.textContent = 'Could not load market overview — click Regenerate to try again.';
          return;
        }

        Object.keys(fields).forEach((key) => {
          if (fields[key] && data[key]) fields[key].textContent = data[key];
        });
        if (subtitle && data.marketOverview) subtitle.textContent = data.marketOverview;

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

      if (lastSnapshot) {
        if (lastSnapshot.directFinancialImpact) {
          const impact = lastSnapshot.directFinancialImpact;
          const sign = impact.totalDollarChange >= 0 ? '+' : '';
          const moversText = impact.movers
            .map((m) => `${m.symbol}: ${m.dollarChange >= 0 ? '+' : ''}$${Math.abs(m.dollarChange)} (${m.severity}, ${m.changePercent > 0 ? '+' : ''}${m.changePercent}%)`)
            .join('; ');
          addSection('Direct Financial Impact', `${sign}$${Math.abs(impact.totalDollarChange)} today from your holdings. ${moversText}`);
        }

        if (lastSnapshot.sectorPerformance && lastSnapshot.sectorPerformance.length) {
          const sectorText = lastSnapshot.sectorPerformance
            .map((s) => `${s.sector} (${s.symbol}): ${s.changePercent > 0 ? '+' : ''}${s.changePercent}%`)
            .join('; ');
          addSection('Sector Performance', sectorText);
        }

        if (lastSnapshot.gainers && lastSnapshot.gainers.length) {
          const gainersText = lastSnapshot.gainers.map((g) => `${g.symbol}: +${g.changePercent}% ($${g.price})`).join('; ');
          addSection('Top Gainers', gainersText);
        }

        if (lastSnapshot.losers && lastSnapshot.losers.length) {
          const losersText = lastSnapshot.losers.map((l) => `${l.symbol}: ${l.changePercent}% ($${l.price})`).join('; ');
          addSection('Top Losers', losersText);
        }

        if (lastSnapshot.narrativeFeed && lastSnapshot.narrativeFeed.length) {
          const feedText = lastSnapshot.narrativeFeed.map((n) => `"${n.title}" — ${n.publisher}`).join('; ');
          addSection('Narrative Feed', feedText);
        }
      }

      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text('Educational/informational content only — not financial advice. Generated by TradePilot AI.', margin, 800);

      doc.save(`tradepilot-narrative-${generated.toISOString().slice(0, 10)}.pdf`);
    }

    btn.addEventListener('click', generateNarrative);
    if (exportBtn) exportBtn.addEventListener('click', exportPdf);

    // ---------- Full Summary modal ----------
    const fullSummaryBtn = document.getElementById('full-summary-btn');
    const fullSummaryModal = document.getElementById('full-summary-modal');
    const fullSummaryClose = document.getElementById('full-summary-close-btn');
    const fullSummaryBody = document.getElementById('full-summary-body');
    const fullSummaryDate = document.getElementById('full-summary-date');

    if (fullSummaryBtn) {
      fullSummaryBtn.addEventListener('click', function () {
        if (!lastNarrative) {
          errorBox.textContent = 'Generate a narrative first — click Regenerate above.';
          errorBox.classList.remove('hidden');
          return;
        }
        const sections = [
          ['Market Overview', lastNarrative.marketOverview],
          ['Sector Movement', lastNarrative.sectorMovement],
          ['Company News', lastNarrative.companyNews],
          ['Watchlist Events', lastNarrative.watchlistEvents],
          ['Portfolio Relevance', lastNarrative.portfolioRelevance],
          ['Beginner Explainer', lastNarrative.plainLanguageExplanation]
        ];
        if (lastSnapshot) {
          if (lastSnapshot.directFinancialImpact) {
            const impact = lastSnapshot.directFinancialImpact;
            const sign = impact.totalDollarChange >= 0 ? '+' : '';
            const moversText = impact.movers
              .map((m) => `${m.symbol}: ${m.dollarChange >= 0 ? '+' : ''}$${Math.abs(m.dollarChange)} (${m.severity}, ${m.changePercent > 0 ? '+' : ''}${m.changePercent}%)`)
              .join('; ');
            sections.push(['Direct Financial Impact', `${sign}$${Math.abs(impact.totalDollarChange)} today from your holdings. ${moversText}`]);
          }
          if (lastSnapshot.sectorPerformance && lastSnapshot.sectorPerformance.length) {
            sections.push(['Sector Performance', lastSnapshot.sectorPerformance.map((s) => `${s.sector} (${s.symbol}): ${s.changePercent > 0 ? '+' : ''}${s.changePercent}%`).join('; ')]);
          }
          if (lastSnapshot.gainers && lastSnapshot.gainers.length) {
            sections.push(['Top Gainers', lastSnapshot.gainers.map((g) => `${g.symbol}: +${g.changePercent}% ($${g.price})`).join('; ')]);
          }
          if (lastSnapshot.losers && lastSnapshot.losers.length) {
            sections.push(['Top Losers', lastSnapshot.losers.map((l) => `${l.symbol}: ${l.changePercent}% ($${l.price})`).join('; ')]);
          }
          if (lastSnapshot.narrativeFeed && lastSnapshot.narrativeFeed.length) {
            sections.push(['Narrative Feed', lastSnapshot.narrativeFeed.map((n) => `"${n.title}" — ${n.publisher}`).join('; ')]);
          }
        }
        fullSummaryBody.innerHTML = sections.map(([heading, text]) =>
          `<div><h3 class="text-label-sm font-label-sm text-secondary uppercase tracking-widest mb-xs">${heading}</h3><p>${text || '—'}</p></div>`
        ).join('');
        const generated = lastNarrative.generatedAt ? new Date(lastNarrative.generatedAt) : new Date();
        fullSummaryDate.textContent = `Generated ${generated.toLocaleString()} · ${lastNarrative.dataSource === 'live' ? 'Live market data' : 'Simulated (live feed unavailable)'}`;
        fullSummaryModal.classList.remove('hidden');
      });
    }
    if (fullSummaryClose) {
      fullSummaryClose.addEventListener('click', () => fullSummaryModal.classList.add('hidden'));
    }
    if (fullSummaryModal) {
      fullSummaryModal.addEventListener('click', (e) => {
        if (e.target === fullSummaryModal) fullSummaryModal.classList.add('hidden');
      });
    }

    // ---------- Ask AI Follow-up ----------
    const followupInput = document.getElementById('followup-input');
    const followupBtn = document.getElementById('followup-ask-btn');
    const followupAnswer = document.getElementById('followup-answer');
    const followupChips = document.querySelectorAll('.followup-chip');

    async function askFollowup(question) {
      if (!question || !question.trim()) return;
      followupAnswer.classList.remove('hidden');
      followupAnswer.textContent = 'Thinking…';
      const originalBtnText = followupBtn.textContent;
      followupBtn.disabled = true;
      followupBtn.textContent = '...';

      const context = lastNarrative
        ? `Today's narrative — Market Overview: ${lastNarrative.marketOverview} Sector Movement: ${lastNarrative.sectorMovement} Portfolio Relevance: ${lastNarrative.portfolioRelevance}`
        : "Today's narrative hasn't loaded yet for this user.";

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ message: question, context })
        });
        const data = await res.json();
        followupAnswer.textContent = res.ok ? data.reply : (data.error || 'Something went wrong.');
      } catch (err) {
        followupAnswer.textContent = 'Could not reach the AI server.';
      } finally {
        followupBtn.disabled = false;
        followupBtn.textContent = originalBtnText;
      }
    }

    if (followupBtn) {
      followupBtn.addEventListener('click', () => askFollowup(followupInput.value));
    }
    if (followupInput) {
      followupInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') askFollowup(followupInput.value);
      });
    }
    followupChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        followupInput.value = chip.textContent;
        askFollowup(chip.textContent);
      });
    });

    // ---------- Live snapshot: sector momentum, sector performance, gainers/losers, financial impact, news ----------
    async function loadSnapshot() {
      const sectorMomentumGrid = document.getElementById('sector-momentum-grid');
      const sectorPerfGrid = document.getElementById('sector-performance-grid');
      const gainersList = document.getElementById('top-gainers-list');
      const losersList = document.getElementById('top-losers-list');
      const dfiContent = document.getElementById('dfi-content');
      const dfiBadge = document.getElementById('dfi-live-badge');
      const feedList = document.getElementById('narrative-feed-list');
      const feedBadge = document.getElementById('narrative-feed-badge');

      try {
        const res = await fetch('/api/narrative/snapshot', { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load live data');
        lastSnapshot = data;

        // Sector momentum grid
        if (sectorMomentumGrid) {
          sectorMomentumGrid.innerHTML = data.sectorPerformance.map((s) => {
            const magnitude = Math.min(Math.abs(s.changePercent) / 2, 1); // scale for color intensity
            const isUp = s.changePercent >= 0;
            const bg = isUp
              ? `rgba(34,197,94,${0.25 + magnitude * 0.6})`
              : `rgba(239,68,68,${0.25 + magnitude * 0.6})`;
            return `<div data-hover-tile class="rounded-lg flex flex-col items-center justify-center text-white font-bold text-xs p-xs" style="background:${bg}">
              <span>${s.sector}</span>
              <span class="text-[11px] font-semibold">${isUp ? '+' : ''}${s.changePercent}%</span>
            </div>`;
          }).join('');
        }

        // Sector performance grid (detailed cards)
        if (sectorPerfGrid) {
          sectorPerfGrid.innerHTML = data.sectorPerformance.map((s) => {
            const color = s.changePercent > 0 ? 'text-green-600' : s.changePercent < 0 ? 'text-red-600' : 'text-on-surface-variant';
            return `<div class="p-md rounded-xl bg-surface-container-low border border-outline-variant/20 hover:border-primary transition-all">
              <div class="text-label-sm font-label-sm text-on-surface-variant mb-xs">${s.sector}</div>
              <div class="text-headline-sm font-headline-sm ${color}">${s.changePercent > 0 ? '+' : ''}${s.changePercent}%</div>
              <div class="mt-sm text-label-sm font-label-sm text-on-surface-variant">${s.symbol}${s.simulated ? ' · simulated' : ''}</div>
            </div>`;
          }).join('');
        }

        // Gainers / Losers
        function renderMoversList(el, items, colorClass) {
          if (!el) return;
          if (!items.length) {
            el.innerHTML = '<p class="text-label-sm text-on-surface-variant">No movers found right now.</p>';
            return;
          }
          el.innerHTML = items.map((s) => `
            <div class="flex items-start justify-between">
              <div class="flex gap-md">
                <div class="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center font-bold">${s.symbol.slice(0, 2)}</div>
                <div>
                  <h4 class="font-semibold text-body-md">${s.symbol}</h4>
                  <p class="text-label-sm font-label-sm text-on-surface-variant">${s.name}${s.simulated ? ' · simulated' : ''}</p>
                </div>
              </div>
              <div class="text-right">
                <div class="${colorClass} font-bold">${s.changePercent > 0 ? '+' : ''}${s.changePercent}%</div>
                <div class="text-label-sm text-on-surface-variant">$${s.price}</div>
              </div>
            </div>`).join('');
        }
        renderMoversList(gainersList, data.gainers, 'text-green-600');
        renderMoversList(losersList, data.losers, 'text-red-600');
        const scopeLabel = data.moversScope === 'market-wide' ? 'Market-wide' : 'Limited universe';
        const gainersScopeBadge = document.getElementById('gainers-scope-badge');
        const losersScopeBadge = document.getElementById('losers-scope-badge');
        if (gainersScopeBadge) gainersScopeBadge.textContent = scopeLabel;
        if (losersScopeBadge) losersScopeBadge.textContent = scopeLabel;

        // Direct Financial Impact
        if (dfiContent) {
          if (!data.directFinancialImpact) {
            dfiContent.innerHTML = '<p class="text-body-md text-on-surface-variant">Add holdings to your Portfolio to see today\'s real financial impact here.</p>';
            if (dfiBadge) dfiBadge.textContent = 'No holdings';
          } else {
            const impact = data.directFinancialImpact;
            const isUp = impact.totalDollarChange >= 0;
            const color = isUp ? 'text-green-600' : 'text-red-600';
            if (dfiBadge) dfiBadge.textContent = impact.anySimulated ? 'Partially simulated' : 'Live';
            dfiContent.innerHTML = `
              <div class="flex items-baseline gap-sm mb-lg">
                <span class="text-display-lg font-bold ${color}">${isUp ? '+' : ''}$${Math.abs(impact.totalDollarChange).toLocaleString()}</span>
                <span class="text-title-md font-semibold ${color} ${isUp ? 'bg-green-50' : 'bg-red-50'} px-2 py-0.5 rounded">today, from your holdings</span>
              </div>
              <div class="space-y-sm">
                ${impact.movers.map((m) => {
                  const mUp = m.dollarChange >= 0;
                  const severityColor = m.severity === 'Critical' ? 'text-red-600' : m.severity === 'Medium' ? 'text-orange-500' : 'text-on-surface-variant';
                  return `<div class="p-sm bg-surface-container-low rounded-xl border border-outline-variant/20 flex items-center justify-between">
                    <div class="flex items-center gap-md">
                      <div class="w-10 h-10 rounded-full bg-white flex items-center justify-center font-bold text-xs border border-outline-variant/10">${m.symbol.slice(0, 3)}</div>
                      <div class="text-label-md font-bold">${m.symbol}</div>
                    </div>
                    <div class="text-right">
                      <div class="text-label-md font-bold ${mUp ? 'text-green-600' : 'text-red-600'}">${mUp ? '+' : ''}$${Math.abs(m.dollarChange).toLocaleString()}</div>
                      <div class="text-label-sm ${severityColor}">${m.severity} · ${m.changePercent > 0 ? '+' : ''}${m.changePercent}%</div>
                    </div>
                  </div>`;
                }).join('')}
              </div>`;
          }
        }

        // Narrative feed (real news)
        if (feedList) {
          if (feedBadge) feedBadge.textContent = data.narrativeFeed.length ? 'Live' : 'No recent news';
          if (!data.narrativeFeed.length) {
            feedList.innerHTML = '<p class="text-label-sm text-on-surface-variant">No recent news found for your tracked symbols right now.</p>';
          } else {
            feedList.innerHTML = data.narrativeFeed.map((n) => {
              const minsAgo = Math.max(1, Math.round((Date.now() - n.publishedAt) / 60000));
              const timeLabel = minsAgo < 60 ? `${minsAgo} mins ago` : `${Math.round(minsAgo / 60)} hr ago`;
              return `<a href="${n.link || '#'}" target="_blank" rel="noopener" class="flex gap-md group cursor-pointer border-b border-outline-variant/10 pb-md block">
                <div class="w-12 h-12 rounded-lg bg-blue-100 flex-shrink-0 flex items-center justify-center text-blue-700 font-bold text-[10px]">NEWS</div>
                <div>
                  <div class="flex items-center gap-sm">
                    <span class="text-label-sm font-label-sm text-blue-600 font-bold">${n.publisher}</span>
                    <span class="text-label-sm font-label-sm text-on-surface-variant">${timeLabel}</span>
                  </div>
                  <h4 class="text-body-md font-body-md font-semibold group-hover:text-primary transition-colors">${n.title}</h4>
                </div>
              </a>`;
            }).join('');
          }
        }
      } catch (err) {
        console.error('Snapshot load failed:', err);
        [sectorMomentumGrid, sectorPerfGrid, gainersList, losersList, dfiContent, feedList].forEach((el) => {
          if (el) el.innerHTML = '<p class="text-label-sm text-error">Could not load live market data. Try refreshing.</p>';
        });
      }
    }

    loadSnapshot();

    // Auto-generate a fresh, personalized narrative once when the page first loads
    generateNarrative();
  });
})();
