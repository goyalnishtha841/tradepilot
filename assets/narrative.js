(function () {
  const NARRATIVE_URL = '/api/narrative';
  let lastNarrative = null;
  let lastSnapshot = null;

  document.addEventListener('DOMContentLoaded', function () {
    const refreshBtn = document.getElementById('refresh-summary-btn');
    const downloadBtn = document.getElementById('download-summary-btn');
    const errorBox = document.getElementById('narrative-error');
    const dateBadge = document.getElementById('narrative-date-badge');
    const sourceBadge = document.getElementById('narrative-source-badge');
    const subtitle = document.getElementById('narrative-subtitle');

    // Only these two live permanently on the page now — the other 4 sections
    // (Market Overview, Sector Movement, Company News, Watchlist Events) only
    // appear inside the Full Summary modal.
    const fields = {
      portfolioRelevance: document.getElementById('narrative-portfolio'),
      plainLanguageExplanation: document.getElementById('narrative-explainer')
    };

    if (!downloadBtn && !refreshBtn) return; // not on this page

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
      if (errorBox) errorBox.classList.add('hidden');
      let originalHtml;
      if (refreshBtn) {
        originalHtml = refreshBtn.innerHTML;
        refreshBtn.innerHTML = '<span class="material-symbols-outlined text-[16px] animate-spin">progress_activity</span> Refreshing...';
        refreshBtn.disabled = true;
      }

      try {
        const res = await fetch(NARRATIVE_URL, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' })
        });
        const data = await res.json();

        if (!res.ok) {
          if (errorBox) {
            errorBox.textContent = data.error || 'Could not generate a new narrative.';
            errorBox.classList.remove('hidden');
          }
          if (subtitle) subtitle.textContent = 'Could not load market overview — open Full Summary and click Refresh to try again.';
          return;
        }

        Object.keys(fields).forEach((key) => {
          if (fields[key] && data[key]) fields[key].textContent = data[key];
        });
        if (subtitle && data.marketOverview) subtitle.textContent = data.marketOverview;

        lastNarrative = data;
        updateBadges(data);

        // If the modal is already open when refreshed, update its contents live.
        const modal = document.getElementById('full-summary-modal');
        if (modal && !modal.classList.contains('hidden')) {
          renderFullSummaryModal();
        }
      } catch (err) {
        if (errorBox) {
          errorBox.textContent = 'Could not reach the AI server. Make sure it is running (npm start).';
          errorBox.classList.remove('hidden');
        }
      } finally {
        if (refreshBtn) {
          refreshBtn.innerHTML = originalHtml;
          refreshBtn.disabled = false;
        }
      }
    }

    function exportPdf() {
      if (!lastNarrative) {
        if (errorBox) {
          errorBox.textContent = 'Open Full Summary first to load data, then download.';
          errorBox.classList.remove('hidden');
        }
        return;
      }
      if (!window.jspdf) {
        if (errorBox) {
          errorBox.textContent = 'PDF export library did not load. Check your internet connection and try again.';
          errorBox.classList.remove('hidden');
        }
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

      addTitle('TradePilot — Market Pulse Summary');
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
          addSection('Sector Performance', lastSnapshot.sectorPerformance.map((s) => `${s.sector} (${s.symbol}): ${s.changePercent > 0 ? '+' : ''}${s.changePercent}%`).join('; '));
        }
        if (lastSnapshot.gainers && lastSnapshot.gainers.length) {
          addSection('Top Gainers', lastSnapshot.gainers.map((g) => `${g.symbol}: +${g.changePercent}% ($${g.price})`).join('; '));
        }
        if (lastSnapshot.losers && lastSnapshot.losers.length) {
          addSection('Top Losers', lastSnapshot.losers.map((l) => `${l.symbol}: ${l.changePercent}% ($${l.price})`).join('; '));
        }
        if (lastSnapshot.narrativeFeed && lastSnapshot.narrativeFeed.length) {
          addSection('Narrative Feed', lastSnapshot.narrativeFeed.map((n) => `"${n.title}" — ${n.publisher}`).join('; '));
        }
      }

      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text('Educational/informational content only — not financial advice. Generated by TradePilot AI.', margin, 800);

      doc.save(`tradepilot-market-radar-${generated.toISOString().slice(0, 10)}.pdf`);
    }

    if (refreshBtn) refreshBtn.addEventListener('click', generateNarrative);
    if (downloadBtn) downloadBtn.addEventListener('click', exportPdf);

    // ---------- Full Summary modal ----------
    const fullSummaryBtn = document.getElementById('full-summary-btn');
    const fullSummaryModal = document.getElementById('full-summary-modal');
    const fullSummaryClose = document.getElementById('full-summary-close-btn');
    const fullSummaryBody = document.getElementById('full-summary-body');
    const fullSummaryDate = document.getElementById('full-summary-date');

    function renderFullSummaryModal() {
      if (!lastNarrative || !fullSummaryBody) return;
      const sections = [
        ['Market Overview', lastNarrative.marketOverview],
        ['Sector Movement', lastNarrative.sectorMovement],
        ['Company News', lastNarrative.companyNews],
        ['Watchlist Events', lastNarrative.watchlistEvents],
        ['Portfolio Relevance', lastNarrative.portfolioRelevance],
        ['Beginner Explainer', lastNarrative.plainLanguageExplanation]
      ];
      fullSummaryBody.innerHTML = sections.map(([heading, text]) =>
        `<div><h3 class="text-label-sm font-label-sm text-secondary uppercase tracking-widest mb-xs">${heading}</h3><p>${text || '—'}</p></div>`
      ).join('');
      if (fullSummaryDate) {
        const generated = lastNarrative.generatedAt ? new Date(lastNarrative.generatedAt) : new Date();
        fullSummaryDate.textContent = `Generated ${generated.toLocaleString()} · ${lastNarrative.dataSource === 'live' ? 'Live market data' : 'Simulated (live feed unavailable)'}`;
      }
      updateBadges(lastNarrative);
    }

    if (fullSummaryBtn) {
      fullSummaryBtn.addEventListener('click', function () {
        if (!lastNarrative) {
          if (errorBox) {
            errorBox.textContent = 'Still loading — try again in a moment.';
            errorBox.classList.remove('hidden');
          }
          return;
        }
        renderFullSummaryModal();
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
      followupAnswer.classList.remove('text-error', 'dark:text-dark-error');
      followupAnswer.textContent = 'Thinking…';
      const originalBtnText = followupBtn.textContent;
      followupBtn.disabled = true;
      followupBtn.textContent = '...';
      let cooldownStarted = false;

      const context = lastNarrative
        ? `Market Pulse summary — Market Overview: ${lastNarrative.marketOverview} Sector Movement: ${lastNarrative.sectorMovement} Portfolio Relevance: ${lastNarrative.portfolioRelevance}`
        : "Today's market summary hasn't loaded yet for this user.";

      try {
        const res = await fetch('/api/narrative/followup', {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ message: question, context })
        });
        const data = await res.json();

        if (res.status === 429) {
          followupAnswer.classList.add('text-error', 'dark:text-dark-error');
          followupAnswer.textContent = data.error || "You're asking a lot of questions — please slow down a little.";
          startFollowupCooldown(data.retryAfterSeconds || 0);
          cooldownStarted = true;
          return;
        }

        if (!res.ok) {
          followupAnswer.classList.add('text-error', 'dark:text-dark-error');
          followupAnswer.textContent = data.error || 'Something went wrong.';
          return;
        }

        followupAnswer.textContent = data.reply;
      } catch (err) {
        followupAnswer.classList.add('text-error', 'dark:text-dark-error');
        followupAnswer.textContent = 'Could not reach the AI server.';
      } finally {
        // Don't clobber the cooldown countdown that startFollowupCooldown just set.
        if (!cooldownStarted) {
          followupBtn.disabled = false;
          followupBtn.textContent = originalBtnText;
        }
      }
    }

    // While a rate-limit cooldown is active, disable the button and count down
    // so it's obvious why nothing is happening instead of it just looking broken.
    let followupCooldownInterval = null;
    function startFollowupCooldown(seconds) {
      if (!followupBtn || seconds <= 0) return;
      if (followupCooldownInterval) clearInterval(followupCooldownInterval);

      let remaining = seconds;
      followupBtn.disabled = true;
      followupBtn.textContent = `Wait ${remaining}s`;

      followupCooldownInterval = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(followupCooldownInterval);
          followupCooldownInterval = null;
          followupBtn.disabled = false;
          followupBtn.textContent = 'Analyze';
        } else {
          followupBtn.textContent = `Wait ${remaining}s`;
        }
      }, 1000);
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
      const refreshFeedBtn = document.getElementById('refresh-feed-btn');

      if (refreshFeedBtn) {
        refreshFeedBtn.querySelector('span').classList.add('animate-spin');
      }

      try {
        const res = await fetch('/api/narrative/snapshot', { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load live data');
        lastSnapshot = data;

        // Sector momentum grid — clean, stepped color scale (not a harsh continuous blend)
        if (sectorMomentumGrid) {
          sectorMomentumGrid.innerHTML = data.sectorPerformance.map((s) => {
            let bg, text;
            if (s.changePercent >= 1) { bg = 'bg-emerald-500'; text = 'text-white'; }
            else if (s.changePercent > 0) { bg = 'bg-emerald-100 dark:bg-emerald-900/40'; text = 'text-emerald-800 dark:text-emerald-300'; }
            else if (s.changePercent === 0) { bg = 'bg-surface-container dark:bg-dark-surface-container'; text = 'text-on-surface-variant dark:text-dark-on-surface-variant'; }
            else if (s.changePercent > -1) { bg = 'bg-rose-100 dark:bg-rose-900/40'; text = 'text-rose-800 dark:text-rose-300'; }
            else { bg = 'bg-rose-500'; text = 'text-white'; }
            return `<div data-hover-tile class="rounded-xl flex flex-col items-center justify-center gap-1 py-md px-xs ${bg} ${text}">
              <span class="text-label-sm font-bold">${s.sector}</span>
              <span class="text-title-sm font-bold">${s.changePercent > 0 ? '+' : ''}${s.changePercent}%</span>
            </div>`;
          }).join('');
        }

        // Sector performance grid (detailed cards)
        if (sectorPerfGrid) {
          sectorPerfGrid.innerHTML = data.sectorPerformance.map((s) => {
            const color = s.changePercent > 0 ? 'text-green-600 dark:text-green-400' : s.changePercent < 0 ? 'text-red-600 dark:text-red-400' : 'text-on-surface-variant dark:text-dark-on-surface-variant';
            return `<div class="p-md rounded-xl bg-surface-container-low dark:bg-dark-surface-container border border-outline-variant/20 hover:border-primary transition-all">
              <div class="text-label-sm font-label-sm text-on-surface-variant dark:text-dark-on-surface-variant mb-xs">${s.sector}</div>
              <div class="text-headline-sm font-headline-sm ${color}">${s.changePercent > 0 ? '+' : ''}${s.changePercent}%</div>
              <div class="mt-sm text-label-sm font-label-sm text-on-surface-variant dark:text-dark-on-surface-variant">${s.symbol}${s.simulated ? ' · simulated' : ''}</div>
            </div>`;
          }).join('');
        }

        // Gainers / Losers
        function renderMoversList(el, items, colorClass) {
          if (!el) return;
          if (!items.length) {
            el.innerHTML = '<p class="text-label-sm text-on-surface-variant dark:text-dark-on-surface-variant">No movers found right now.</p>';
            return;
          }
          el.innerHTML = items.map((s) => `
            <div class="flex items-start justify-between">
              <div class="flex gap-md">
                <div class="w-12 h-12 rounded-full bg-surface-container dark:bg-dark-surface-container flex items-center justify-center font-bold text-on-surface dark:text-dark-on-surface">${s.symbol.slice(0, 2)}</div>
                <div>
                  <h4 class="font-semibold text-body-md text-on-surface dark:text-dark-on-surface">${s.symbol}</h4>
                  <p class="text-label-sm font-label-sm text-on-surface-variant dark:text-dark-on-surface-variant">${s.name}${s.simulated ? ' · simulated' : ''}</p>
                </div>
              </div>
              <div class="text-right">
                <div class="${colorClass} font-bold">${s.changePercent > 0 ? '+' : ''}${s.changePercent}%</div>
                <div class="text-label-sm text-on-surface-variant dark:text-dark-on-surface-variant">$${s.price}</div>
              </div>
            </div>`).join('');
        }
        renderMoversList(gainersList, data.gainers, 'text-green-600 dark:text-green-400');
        renderMoversList(losersList, data.losers, 'text-red-600 dark:text-red-400');
        const scopeLabel = data.moversScope === 'market-wide' ? 'Market-wide' : 'Limited universe';
        const gainersScopeBadge = document.getElementById('gainers-scope-badge');
        const losersScopeBadge = document.getElementById('losers-scope-badge');
        if (gainersScopeBadge) gainersScopeBadge.textContent = scopeLabel;
        if (losersScopeBadge) losersScopeBadge.textContent = scopeLabel;

        // Direct Financial Impact
        if (dfiContent) {
          if (!data.directFinancialImpact) {
            dfiContent.innerHTML = '<p class="text-body-md text-on-surface-variant dark:text-dark-on-surface-variant">Add holdings to your Portfolio to see today\'s real financial impact here.</p>';
            if (dfiBadge) dfiBadge.textContent = 'No holdings';
          } else {
            const impact = data.directFinancialImpact;
            const isUp = impact.totalDollarChange >= 0;
            const color = isUp ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
            if (dfiBadge) dfiBadge.textContent = impact.anySimulated ? 'Partially simulated' : 'Live';
            dfiContent.innerHTML = `
              <div class="flex items-baseline gap-sm mb-lg">
                <span class="text-display-lg font-bold ${color}">${isUp ? '+' : ''}$${Math.abs(impact.totalDollarChange).toLocaleString()}</span>
                <span class="text-title-md font-semibold ${color} ${isUp ? 'bg-green-50 dark:bg-green-900/30' : 'bg-red-50 dark:bg-red-900/30'} px-2 py-0.5 rounded">today, from your holdings</span>
              </div>
              <div class="space-y-sm">
                ${impact.movers.map((m) => {
                  const mUp = m.dollarChange >= 0;
                  const severityColor = m.severity === 'Critical' ? 'text-red-600 dark:text-red-400' : m.severity === 'Medium' ? 'text-orange-500 dark:text-orange-400' : 'text-on-surface-variant dark:text-dark-on-surface-variant';
                  return `<div class="p-sm bg-surface-container-low dark:bg-dark-surface-container rounded-xl border border-outline-variant/20 flex items-center justify-between">
                    <div class="flex items-center gap-md">
                      <div class="w-10 h-10 rounded-full bg-white dark:bg-dark-surface-container flex items-center justify-center font-bold text-xs text-on-surface dark:text-dark-on-surface border border-outline-variant/10">${m.symbol.slice(0, 3)}</div>
                      <div class="text-label-md font-bold text-on-surface dark:text-dark-on-surface">${m.symbol}</div>
                    </div>
                    <div class="text-right">
                      <div class="text-label-md font-bold ${mUp ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}">${mUp ? '+' : ''}$${Math.abs(m.dollarChange).toLocaleString()}</div>
                      <div class="text-label-sm ${severityColor}">${m.severity} · ${m.changePercent > 0 ? '+' : ''}${m.changePercent}%</div>
                    </div>
                  </div>`;
                }).join('')}
              </div>`;
          }
        }

        // Narrative feed (real news, last 24 hours) — shows the first 3 inline,
        // a button opens a modal (same pattern as Full Summary) with everything.
        if (feedList) {
          if (feedBadge) feedBadge.textContent = data.narrativeFeed.length ? 'Live' : 'No recent news';
          const moreBtn = document.getElementById('narrative-feed-more-btn');
          const newsModal = document.getElementById('news-feed-modal');
          const newsModalBody = document.getElementById('news-feed-modal-body');
          const newsModalClose = document.getElementById('news-feed-close-btn');

          function newsItemHtml(n) {
            const minsAgo = Math.max(1, Math.round((Date.now() - n.publishedAt) / 60000));
            const timeLabel = minsAgo < 60 ? `${minsAgo} mins ago` : `${Math.round(minsAgo / 60)} hr ago`;
            return `<a href="${n.link || '#'}" target="_blank" rel="noopener" class="flex gap-md group cursor-pointer border-b border-outline-variant/10 pb-md block">
              <div class="w-12 h-12 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex-shrink-0 flex items-center justify-center text-blue-700 dark:text-blue-300 font-bold text-[10px]">NEWS</div>
              <div>
                <div class="flex items-center gap-sm">
                  <span class="text-label-sm font-label-sm text-blue-600 dark:text-blue-400 font-bold">${n.publisher}</span>
                  <span class="text-label-sm font-label-sm text-on-surface-variant dark:text-dark-on-surface-variant">${timeLabel}</span>
                </div>
                <h4 class="text-body-md font-body-md font-semibold text-on-surface dark:text-dark-on-surface group-hover:text-primary transition-colors">${n.title}</h4>
              </div>
            </a>`;
          }

          if (!data.narrativeFeed.length) {
            feedList.innerHTML = '<p class="text-label-sm text-on-surface-variant dark:text-dark-on-surface-variant">No news in the last 24 hours for your tracked symbols.</p>';
            if (moreBtn) moreBtn.classList.add('hidden');
          } else {
            feedList.innerHTML = data.narrativeFeed.slice(0, 3).map(newsItemHtml).join('');
            if (moreBtn) {
              moreBtn.classList.remove('hidden');
              moreBtn.textContent = `See Past 24 Hours' News (${data.narrativeFeed.length} article${data.narrativeFeed.length === 1 ? '' : 's'})`;
              moreBtn.onclick = () => {
                if (newsModalBody) newsModalBody.innerHTML = data.narrativeFeed.map(newsItemHtml).join('');
                if (newsModal) newsModal.classList.remove('hidden');
              };
            }
            if (newsModalClose && newsModal) {
              newsModalClose.onclick = () => newsModal.classList.add('hidden');
            }
            if (newsModal) {
              newsModal.onclick = (e) => {
                if (e.target === newsModal) newsModal.classList.add('hidden');
              };
            }
          }
        }
      } catch (err) {
        console.error('Snapshot load failed:', err);
        [sectorMomentumGrid, sectorPerfGrid, gainersList, losersList, dfiContent, feedList].forEach((el) => {
          if (el) el.innerHTML = '<p class="text-label-sm text-error">Could not load live market data. Try refreshing.</p>';
        });
      } finally {
        if (refreshFeedBtn) {
          refreshFeedBtn.querySelector('span').classList.remove('animate-spin');
        }
      }
    }

    const refreshFeedBtn = document.getElementById('refresh-feed-btn');
    if (refreshFeedBtn) refreshFeedBtn.addEventListener('click', loadSnapshot);

    // ---------- Sector Momentum info modal ----------
    const sectorInfoBtn = document.getElementById('sector-momentum-info-btn');
    if (sectorInfoBtn) {
      sectorInfoBtn.addEventListener('click', () => {
        const modal = document.getElementById('insight-info-modal');
        const titleEl = document.getElementById('insight-info-modal-title');
        const textEl = document.getElementById('insight-info-modal-text');
        if (modal && titleEl && textEl) {
          titleEl.textContent = 'Sector Momentum';
          textEl.innerHTML = 'This shows how different parts of the market — like Technology or Energy — are doing <b>today</b>, not just one stock. Each box tracks a fund that represents a whole industry, so you can spot which industries are having a good day at a glance. <span class="text-emerald-700 font-semibold">Green</span> means up, <span class="text-rose-700 font-semibold">red</span> means down — darker means a bigger move.';
          modal.classList.remove('hidden');
        }
      });
      const infoModal = document.getElementById('insight-info-modal');
      if (infoModal) {
        infoModal.addEventListener('click', (e) => {
          if (e.target === infoModal) infoModal.classList.add('hidden');
        });
      }
    }

    loadSnapshot();

    // Auto-generate a fresh, personalized narrative once when the page first loads
    generateNarrative();
  });
})();
