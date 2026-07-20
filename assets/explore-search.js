(function () {
  const MARKET_URL = '/api/market/quote';
  const WATCHLIST_URL = '/api/watchlist';
  const CHART_URL = '/api/market/chart';

  document.addEventListener('DOMContentLoaded', function () {
    const searchInput = document.getElementById('market-search-input');
    const stockName = document.getElementById('stock-name');
    const stockPrice = document.getElementById('stock-price');
    const stockChange = document.getElementById('stock-change');
    const stockChangeText = document.getElementById('stock-change-text');
    const watchlistBtn = document.getElementById('watchlist-btn');
    const watchlistBtnText = document.getElementById('watchlist-btn-text');

    if (!searchInput) return; // not on this page

    let currentSymbol = 'NVDA';
    let currentRange = '1D';
    let lastChartPoints = null;
let lastChartPositive = null;
    const RANGE_KEYS = ['1D', '1W', '1M', '3M', '1Y'];

    function authHeaders(extra) {
      const h = window.TradePilotAuth ? window.TradePilotAuth.authHeader() : {};
      return { ...h, ...(extra || {}) };
    }

    // ---------- Shared helpers ----------

    function timeAgo(ms) {
      if (!ms) return '';
      const diffMin = Math.round((Date.now() - ms) / 60000);
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHr = Math.round(diffMin / 60);
      if (diffHr < 24) return `${diffHr}h ago`;
      const diffDay = Math.round(diffHr / 24);
      return `${diffDay}d ago`;
    }

    function drawPlaceholderThumb(letter) {
      const canvas = document.createElement('canvas');
      canvas.width = 96;
      canvas.height = 96;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#131b2e';
      ctx.fillRect(0, 0, 96, 96);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 40px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(letter, 48, 52);
      return canvas.toDataURL('image/png');
    }

    function showSearchError(message) {
      let errorEl = document.getElementById('search-error-msg');
      if (!errorEl) {
        errorEl = document.createElement('div');
        errorEl.id = 'search-error-msg';
        errorEl.style.position = 'absolute';
        errorEl.style.top = '100%';
        errorEl.style.left = '0';
        errorEl.style.marginTop = '6px';
        errorEl.style.background = '#fff1f1';
        errorEl.style.color = '#ba1a1a';
        errorEl.style.border = '1px solid #ffdad6';
        errorEl.style.borderRadius = '10px';
        errorEl.style.padding = '8px 12px';
        errorEl.style.fontSize = '13px';
        errorEl.style.width = '256px';
        errorEl.style.zIndex = '50';
        searchInput.parentElement.appendChild(errorEl);
      }
      errorEl.textContent = message;
      errorEl.style.display = 'block';
    }

    function clearSearchError() {
      const errorEl = document.getElementById('search-error-msg');
      if (errorEl) errorEl.style.display = 'none';
    }

    // ---------- Component 2: Chart + RSI ----------

    function formatChartLabel(ts, range) {
      const d = new Date(ts);
      if (range === '1D') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (range === '1W') return d.toLocaleDateString([], { weekday: 'short' });
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    function drawChart(width, height, points, positive) {
      const dpr = window.devicePixelRatio || 1;
      const canvas = document.createElement('canvas');
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);

      const padding = { top: 34, right: 12, bottom: 24, left: 44 };
      const plotW = width - padding.left - padding.right;
      const plotH = height - padding.top - padding.bottom;

      const closes = points.map(p => p.close);
      const min = Math.min(...closes);
      const max = Math.max(...closes);
      const range = (max - min) || 1;

      const lineColor = positive ? '#16a34a' : '#dc2626';
      const fillTop = positive ? 'rgba(22,163,74,0.22)' : 'rgba(220,38,38,0.18)';

      const xFor = (i) => padding.left + (i / (points.length - 1)) * plotW;
      const yFor = (c) => padding.top + (1 - (c - min) / range) * plotH;

      const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + plotH);
      gradient.addColorStop(0, fillTop);
      gradient.addColorStop(1, 'rgba(255,255,255,0)');

      ctx.beginPath();
      ctx.moveTo(xFor(0), yFor(closes[0]));
      for (let i = 1; i < points.length; i++) ctx.lineTo(xFor(i), yFor(closes[i]));
      ctx.lineTo(xFor(points.length - 1), padding.top + plotH);
      ctx.lineTo(xFor(0), padding.top + plotH);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(xFor(0), yFor(closes[0]));
      for (let i = 1; i < points.length; i++) ctx.lineTo(xFor(i), yFor(closes[i]));
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = lineColor;
      ctx.lineJoin = 'round';
      ctx.stroke();

      const lastX = xFor(points.length - 1);
      const lastY = yFor(closes[closes.length - 1]);
      ctx.beginPath();
      ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
      ctx.fillStyle = lineColor;
      ctx.fill();

      ctx.font = '700 10px Inter, sans-serif';
      ctx.fillStyle = '#45464d';

      // Max label sits in the empty margin ABOVE the plot area, clear of the line entirely
      ctx.textAlign = 'right';
      ctx.fillText(`$${max.toFixed(2)}`, width - padding.right, padding.top - 12);

      // Mid/min stay on the left, below the tooltip box — no collision there
      ctx.font = '500 10px Inter, sans-serif';
      ctx.fillStyle = '#76777d';
      ctx.textAlign = 'left';
      ctx.fillText(`$${((max + min) / 2).toFixed(2)}`, 6, padding.top + plotH / 2);
      ctx.fillText(`$${min.toFixed(2)}`, 6, padding.top + plotH - 2);

      const tickCount = Math.min(5, points.length);
      ctx.textAlign = 'center';
      for (let t = 0; t < tickCount; t++) {
        const idx = Math.round((t / (tickCount - 1)) * (points.length - 1));
        ctx.fillText(formatChartLabel(points[idx].time, currentRange), xFor(idx), height - 6);
      }

      return canvas;
    }

    async function loadChart(symbol) {
      const chartImg = document.getElementById('stock-chart-img');
      const rsiValueEl = document.getElementById('rsi-value');
      const rsiDescEl = document.getElementById('rsi-description');
      if (!chartImg) return;

      try {
        const res = await fetch(`${CHART_URL}?symbol=${encodeURIComponent(symbol)}&range=${currentRange}`, {
          headers: authHeaders()
        });
        const data = await res.json();
        if (!res.ok) {
          showSearchError(data.error || 'Could not load chart.');
          return;
        }

const points = data.points;
const positive = points[points.length - 1].close >= points[0].close;
lastChartPoints = points;
lastChartPositive = positive;
const rect = chartImg.getBoundingClientRect();
const width = rect.width || 700;
const height = rect.height || 320;
const canvas = drawChart(width, height, points, positive);
chartImg.src = canvas.toDataURL('image/png');
        if (rsiValueEl) rsiValueEl.textContent = data.rsi !== null ? data.rsi : '—';
        if (rsiDescEl) {
          if (data.rsi === null) {
            rsiDescEl.textContent = 'Not enough data to compute RSI for this range.';
          } else if (data.rsi >= 70) {
            rsiDescEl.textContent = `RSI is ${data.rsi} — the stock may be "overbought" (potentially due for a pullback).`;
          } else if (data.rsi <= 30) {
            rsiDescEl.textContent = `RSI is ${data.rsi} — the stock may be "oversold" (potentially undervalued short-term).`;
          } else {
            rsiDescEl.textContent = `RSI is ${data.rsi} — a neutral reading, neither overbought nor oversold.`;
          }
        }
      } catch (err) {
        showSearchError('Could not load chart data.');
      }
    }

    RANGE_KEYS.forEach((r) => {
      const btn = document.getElementById(`range-btn-${r}`);
      if (!btn) return;
      btn.addEventListener('click', () => {
        currentRange = r;
        RANGE_KEYS.forEach((rr) => {
          const b = document.getElementById(`range-btn-${rr}`);
          if (!b) return;
          b.className = rr === r
            ? 'px-3 py-1 bg-primary text-white text-label-sm rounded-full'
            : 'px-3 py-1 hover:bg-surface-container text-label-sm rounded-full transition-colors';
        });
        loadChart(currentSymbol);
      });
    });

    function closeChartModal() {
  const existing = document.getElementById('chart-modal-overlay');
  if (existing) existing.remove();
}

function openChartModal() {
  if (!lastChartPoints || lastChartPoints.length === 0) return;

  closeChartModal();

  const overlay = document.createElement('div');
  overlay.id = 'chart-modal-overlay';
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.background = 'rgba(27,27,29,0.6)';
  overlay.style.zIndex = '100';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.padding = '24px';
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeChartModal();
  });

  const panel = document.createElement('div');
  panel.style.background = '#fcf8fa';
  panel.style.borderRadius = '20px';
  panel.style.width = '100%';
  panel.style.maxWidth = '1100px';
  panel.style.padding = '24px';
  panel.style.boxShadow = '0 20px 60px rgba(0,0,0,0.35)';

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';
  header.style.marginBottom = '16px';

  const title = document.createElement('h3');
  title.textContent = `${currentSymbol} — ${currentRange}`;
  title.style.fontWeight = '700';
  title.style.fontSize = '18px';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.fontSize = '18px';
  closeBtn.style.padding = '4px 10px';
  closeBtn.style.cursor = 'pointer';
  closeBtn.addEventListener('click', closeChartModal);

  header.appendChild(title);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  const bigImg = document.createElement('img');
  bigImg.style.width = '100%';
  bigImg.style.height = '480px';
  bigImg.style.display = 'block';
  panel.appendChild(bigImg);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  // Draw at the modal's actual rendered size, not the small card's size
  const bigWidth = Math.min(window.innerWidth - 96, 1052);
  const bigCanvas = drawChart(bigWidth, 480, lastChartPoints, lastChartPositive);
  bigImg.src = bigCanvas.toDataURL('image/png');
}

const fullscreenBtn = document.getElementById('chart-fullscreen-btn');
if (fullscreenBtn) {
  fullscreenBtn.addEventListener('click', openChartModal);
}

    // ---------- Component 3: Valuation + Financial Health ----------

    function formatMarketCap(num) {
      if (num === null) return 'N/A';
      if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
      if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
      if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
      return `$${num.toLocaleString()}`;
    }

    async function loadFundamentals(symbol) {
      const exchangeBadgeEl = document.getElementById('exchange-badge');
      const sectorTextEl = document.getElementById('sector-text');
      const peValueEl = document.getElementById('pe-ratio-value');
      const marketCapEl = document.getElementById('market-cap-value');
      const valuationDescEl = document.getElementById('valuation-description');
      const revenueGrowthEl = document.getElementById('revenue-growth-value');
      const grossMarginEl = document.getElementById('gross-margin-value');
      const financialDescEl = document.getElementById('financial-health-description');

      try {
        const res = await fetch(`/api/market/fundamentals?symbol=${encodeURIComponent(symbol)}`, {
          headers: authHeaders()
        });
        const data = await res.json();
        if (!res.ok) {
          if (peValueEl) peValueEl.textContent = 'N/A';
          if (marketCapEl) marketCapEl.textContent = 'N/A';
          if (revenueGrowthEl) { revenueGrowthEl.textContent = 'N/A'; revenueGrowthEl.className = 'text-label-md font-bold'; }
          if (grossMarginEl) grossMarginEl.textContent = 'N/A';
          if (financialDescEl) financialDescEl.textContent = 'Fundamental data unavailable right now.';
          if (valuationDescEl) valuationDescEl.textContent = 'Fundamental data unavailable right now.';
          return;
        }

        if (exchangeBadgeEl && data.exchange) exchangeBadgeEl.textContent = data.exchange;
        if (sectorTextEl) sectorTextEl.textContent = data.sector || data.industry || 'Sector data unavailable';

        if (peValueEl) {
          peValueEl.textContent = data.peRatio !== null ? `${data.peRatio.toFixed(1)}x` : 'N/A';
        }
        if (marketCapEl) {
          marketCapEl.textContent = formatMarketCap(data.marketCap);
        }
        if (valuationDescEl) {
          if (data.peRatio === null) {
            valuationDescEl.textContent = 'P/E ratio is not available for this stock (common for newer listings or certain sectors).';
          } else if (data.peRatio > 40) {
            valuationDescEl.textContent = `P/E Ratio helps you understand if you're paying a premium for growth. At ${data.peRatio.toFixed(1)}x, the market has high growth expectations for this stock.`;
          } else if (data.peRatio < 15) {
            valuationDescEl.textContent = `P/E Ratio helps you understand if you're paying a premium for growth. At ${data.peRatio.toFixed(1)}x, this stock is valued conservatively relative to earnings.`;
          } else {
            valuationDescEl.textContent = `P/E Ratio helps you understand if you're paying a premium for growth. ${data.peRatio.toFixed(1)}x is a moderate valuation.`;
          }
        }

        if (revenueGrowthEl) {
          if (data.revenueGrowth === null) {
            revenueGrowthEl.textContent = 'N/A';
            revenueGrowthEl.className = 'text-label-md font-bold';
          } else {
            const pct = data.revenueGrowth * 100;
            const positive = pct >= 0;
            revenueGrowthEl.textContent = `${positive ? '+' : ''}${pct.toFixed(1)}%`;
            revenueGrowthEl.className = 'text-label-md font-bold ' + (positive ? 'text-green-600' : 'text-red-500');
          }
        }

        const hasGrossMargin = data.grossMargin !== null && data.grossMargin > 0;
        if (grossMarginEl) {
          grossMarginEl.textContent = hasGrossMargin ? `${(data.grossMargin * 100).toFixed(1)}%` : 'N/A';
        }
        if (financialDescEl) {
          if (!hasGrossMargin) {
            financialDescEl.textContent = 'Gross margin is not meaningfully reported for this type of business (common for banks, insurers, and REITs).';
          } else {
            const gm = data.grossMargin * 100;
            financialDescEl.textContent = gm >= 50
              ? `Gross Margin shows how much profit is left after production costs. ${gm.toFixed(1)}% is strong.`
              : `Gross Margin shows how much profit is left after production costs. ${gm.toFixed(1)}% is typical for this type of business.`;
          }
        }
      } catch (err) {
        if (financialDescEl) financialDescEl.textContent = 'Could not load fundamental data.';
        if (valuationDescEl) valuationDescEl.textContent = 'Could not load fundamental data.';
      }
    }

    // ---------- Component 4: News ----------

    async function loadNews(symbol) {
      try {
        const res = await fetch(`/api/market/news?symbol=${encodeURIComponent(symbol)}`, {
          headers: authHeaders()
        });
        const data = await res.json();
        const items = res.ok && Array.isArray(data.news) ? data.news : [];

        for (let i = 0; i < 2; i++) {
          const card = document.getElementById(`news-card-${i}`);
          const img = document.getElementById(`news-img-${i}`);
          const badge = document.getElementById(`news-badge-${i}`);
          const timeEl = document.getElementById(`news-time-${i}`);
          const titleEl = document.getElementById(`news-title-${i}`);
          const descEl = document.getElementById(`news-desc-${i}`);
          if (!card) continue;

          const item = items[i];
          if (!item) {
            if (i === 0) {
              card.style.display = 'flex';
              if (img) img.src = drawPlaceholderThumb(symbol.charAt(0));
              if (badge) badge.textContent = 'NO RECENT NEWS';
              if (timeEl) timeEl.textContent = '';
              if (titleEl) titleEl.textContent = `No dedicated recent coverage found for ${symbol}`;
              if (descEl) descEl.textContent = 'Try checking back later, or search the symbol directly on a financial news site.';
              card.onclick = null;
            } else {
              card.style.display = 'none';
            }
            continue;
          }

          card.style.display = 'flex';
          if (img) img.src = item.thumbnail || drawPlaceholderThumb(symbol.charAt(0));
          if (badge) badge.textContent = item.publisher.toUpperCase();
          if (timeEl) timeEl.textContent = item.publishedAt ? timeAgo(item.publishedAt) : '';
          if (titleEl) titleEl.textContent = item.title;
          if (descEl) descEl.textContent = `Source: ${item.publisher}. Click to read the full article.`;
          card.onclick = item.link ? () => window.open(item.link, '_blank', 'noopener') : null;
        }
      } catch (err) {
        // silently leave whatever was last shown; news is supplementary, not critical
      }
    }
    async function loadAIAnalysis(symbol) {
  const narrativeEl = document.getElementById('ai-narrative-text');
  const confidenceBadgeEl = document.getElementById('ai-confidence-badge');
  const signal1IconEl = document.getElementById('ai-signal-1-icon');
  const signal1TextEl = document.getElementById('ai-signal-1-text');
  const signal2TextEl = document.getElementById('ai-signal-2-text');
  const moodBearishEl = document.getElementById('mood-bar-bearish');
  const moodBullishEl = document.getElementById('mood-bar-bullish');
  const moodDescEl = document.getElementById('market-mood-desc');
  const verdictRingEl = document.getElementById('ai-verdict-ring');
  const verdictScoreEl = document.getElementById('ai-verdict-score');
  const verdictLabelEl = document.getElementById('ai-verdict-label');
  const verdictDescEl = document.getElementById('ai-verdict-desc');

  if (narrativeEl) narrativeEl.textContent = 'Generating AI analysis...';
  if (confidenceBadgeEl) confidenceBadgeEl.textContent = '...';

  try {
    const res = await fetch(`/api/market/ai-analysis?symbol=${encodeURIComponent(symbol)}`, {
      headers: authHeaders()
    });
    const data = await res.json();

    if (!res.ok) {
      if (narrativeEl) narrativeEl.textContent = 'AI analysis is unavailable right now.';
      if (confidenceBadgeEl) confidenceBadgeEl.textContent = '—';
      return;
    }

    if (narrativeEl) narrativeEl.textContent = data.narrative;
    if (confidenceBadgeEl) confidenceBadgeEl.textContent = `${data.confidence}% CONFIDENCE`;
    if (signal1IconEl) signal1IconEl.textContent = 'verified';
    if (signal1TextEl) signal1TextEl.textContent = data.bullPoint;
    if (signal2TextEl) signal2TextEl.textContent = data.riskPoint;

    if (moodBullishEl && moodBearishEl) {
      moodBullishEl.style.width = `${data.moodPercent}%`;
      moodBearishEl.style.width = `${100 - data.moodPercent}%`;
    }
    if (moodDescEl) moodDescEl.textContent = data.moodDescription;

    if (verdictScoreEl) verdictScoreEl.textContent = data.verdictScore.toFixed(1);
    if (verdictLabelEl) verdictLabelEl.textContent = data.verdictLabel;
    if (verdictDescEl) verdictDescEl.textContent = data.verdictDescription;

    if (verdictRingEl) {
      const colorClass = data.verdictLabel === 'Overweight' ? 'border-green-500'
        : data.verdictLabel === 'Underweight' ? 'border-error'
        : 'border-secondary';
      verdictRingEl.className = `w-12 h-12 rounded-full border-4 ${colorClass} border-r-transparent animate-spin duration-[3s] flex items-center justify-center`;
    }
  } catch (err) {
    if (narrativeEl) narrativeEl.textContent = 'Could not reach the AI analysis service.';
    if (confidenceBadgeEl) confidenceBadgeEl.textContent = '—';
  }
}

    // ---------- "View All" news modal ----------

    function closeNewsModal() {
      const existing = document.getElementById('news-modal-overlay');
      if (existing) existing.remove();
    }

    async function openNewsModal(symbol) {
      closeNewsModal();

      const overlay = document.createElement('div');
      overlay.id = 'news-modal-overlay';
      overlay.style.position = 'fixed';
      overlay.style.inset = '0';
      overlay.style.background = 'rgba(27,27,29,0.5)';
      overlay.style.zIndex = '100';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.padding = '24px';
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeNewsModal();
      });

      const panel = document.createElement('div');
      panel.style.background = '#fcf8fa';
      panel.style.borderRadius = '20px';
      panel.style.maxWidth = '640px';
      panel.style.width = '100%';
      panel.style.maxHeight = '80vh';
      panel.style.overflowY = 'auto';
      panel.style.padding = '24px';
      panel.style.boxShadow = '0 20px 60px rgba(0,0,0,0.3)';

      const header = document.createElement('div');
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.alignItems = 'center';
      header.style.marginBottom = '16px';

      const title = document.createElement('h3');
      title.textContent = `All Recent News — ${symbol}`;
      title.style.fontWeight = '700';
      title.style.fontSize = '18px';

      const closeBtn = document.createElement('button');
      closeBtn.textContent = '✕';
      closeBtn.style.fontSize = '18px';
      closeBtn.style.padding = '4px 10px';
      closeBtn.style.cursor = 'pointer';
      closeBtn.addEventListener('click', closeNewsModal);

      header.appendChild(title);
      header.appendChild(closeBtn);
      panel.appendChild(header);

      const listEl = document.createElement('div');
      listEl.style.display = 'flex';
      listEl.style.flexDirection = 'column';
      listEl.style.gap = '12px';
      listEl.textContent = 'Loading...';
      panel.appendChild(listEl);

      overlay.appendChild(panel);
      document.body.appendChild(overlay);

      try {
        const res = await fetch(`/api/market/news?symbol=${encodeURIComponent(symbol)}&count=10`, {
          headers: authHeaders()
        });
        const data = await res.json();
        const items = res.ok && Array.isArray(data.news) ? data.news : [];

        listEl.textContent = '';
        if (items.length === 0) {
          listEl.textContent = `No dedicated recent coverage found for ${symbol}.`;
          return;
        }

        items.forEach((item) => {
          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.gap = '12px';
          row.style.padding = '10px';
          row.style.borderRadius = '12px';
          row.style.cursor = item.link ? 'pointer' : 'default';
          row.style.border = '1px solid rgba(226,232,240,0.8)';
          row.addEventListener('mouseenter', () => { row.style.background = '#f0edef'; });
          row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
          if (item.link) row.addEventListener('click', () => window.open(item.link, '_blank', 'noopener'));

          const thumb = document.createElement('img');
          thumb.src = item.thumbnail || drawPlaceholderThumb(symbol.charAt(0));
          thumb.style.width = '64px';
          thumb.style.height = '64px';
          thumb.style.objectFit = 'cover';
          thumb.style.borderRadius = '10px';
          thumb.style.flexShrink = '0';

          const textWrap = document.createElement('div');
          const badge = document.createElement('span');
          badge.textContent = item.publisher.toUpperCase();
          badge.style.fontSize = '10px';
          badge.style.fontWeight = '700';
          badge.style.color = '#545f73';

          const timeSpan = document.createElement('span');
          timeSpan.textContent = item.publishedAt ? ` · ${timeAgo(item.publishedAt)}` : '';
          timeSpan.style.fontSize = '11px';
          timeSpan.style.color = '#76777d';

          const titleEl = document.createElement('p');
          titleEl.textContent = item.title;
          titleEl.style.fontWeight = '600';
          titleEl.style.fontSize = '14px';
          titleEl.style.margin = '2px 0 0 0';

          textWrap.appendChild(badge);
          textWrap.appendChild(timeSpan);
          textWrap.appendChild(titleEl);

          row.appendChild(thumb);
          row.appendChild(textWrap);
          listEl.appendChild(row);
        });
      } catch (err) {
        listEl.textContent = 'Could not load news right now.';
      }
    }

    const viewAllBtn = document.getElementById('view-all-news-btn');
    if (viewAllBtn) {
      viewAllBtn.addEventListener('click', () => openNewsModal(currentSymbol));
    }

    // ---------- Quote application (ties every component together per symbol) ----------

    function applyQuote(symbol, quote) {
      currentSymbol = symbol;
      stockName.textContent = symbol;
      stockPrice.textContent = `$${quote.price.toFixed(2)}`;
      const positive = quote.changePercent >= 0;
      stockChange.className = (positive ? 'text-green-600' : 'text-red-500') + ' font-semibold flex items-center gap-1';
      stockChangeText.textContent = `${positive ? '+' : ''}${quote.changePercent}% (${positive ? '+' : ''}$${Math.abs(quote.changeAbs).toFixed(2)})`;
      watchlistBtnText.textContent = 'Watchlist';
      watchlistBtn.disabled = false;

      loadChart(symbol);
      loadFundamentals(symbol);
      loadNews(symbol);
      loadAIAnalysis(symbol);

      const afterHoursEl = document.getElementById('after-hours-text');
      if (afterHoursEl) {
        if (quote.postMarketPrice !== null) {
          const ph = quote.postMarketChangePercent >= 0;
          afterHoursEl.textContent = `After Hours: $${quote.postMarketPrice.toFixed(2)} (${ph ? '+' : ''}${quote.postMarketChangePercent}%)`;
        } else {
          afterHoursEl.textContent = 'After hours data unavailable for this symbol.';
        }
      }

      // Let the AI Mentor chat script know which symbol is currently active,
      // and refresh the "Deep Dive" title/prompts so they're not hardcoded to NVDA.
      window.TradePilotCurrentSymbol = symbol;

      const deepDiveTitleEl = document.getElementById('deep-dive-title');
      if (deepDiveTitleEl) {
        deepDiveTitleEl.innerHTML = '<span class="material-symbols-outlined text-base">chat_bubble</span> Deep Dive ' + symbol;
      }

      const prompt0 = document.getElementById('prompt-0');
      const prompt1 = document.getElementById('prompt-1');
      const prompt2 = document.getElementById('prompt-2');
      if (prompt0) prompt0.textContent = `"Will supply chain issues hurt ${symbol}'s next quarter?"`;
      if (prompt1) prompt1.textContent = `"Explain ${symbol}'s business model to a 5-year old."`;
      if (prompt2) prompt2.textContent = `"How does ${symbol} compare to its biggest competitor?"`;
    }
    

    // ---------- Search ----------

    async function searchSymbol(symbol) {
      if (!symbol || !symbol.trim()) return;
      try {
        const res = await fetch(`${MARKET_URL}?symbol=${encodeURIComponent(symbol.trim())}`, {
          headers: authHeaders()
        });
        const data = await res.json();
        if (!res.ok) {
          showSearchError(data.error || 'Could not find that symbol.');
          return;
        }
        clearSearchError();
        applyQuote(data.quote.symbol, data.quote);
      } catch (err) {
        showSearchError('Could not reach the server. Make sure it is running.');
      }
    }

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') searchSymbol(searchInput.value);
    });

    if (watchlistBtn) {
      watchlistBtn.addEventListener('click', async () => {
        watchlistBtnText.textContent = 'Adding...';
        try {
          const res = await fetch(WATCHLIST_URL, {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ symbol: currentSymbol })
          });
          const data = await res.json();
          watchlistBtnText.textContent = res.ok ? 'Added ✓' : 'Try again';
          if (!res.ok) console.error(data.error);
        } catch (err) {
          watchlistBtnText.textContent = 'Try again';
        }
      });
    }

    // Initial page load: fetch a REAL quote for the default symbol (not just the chart),
    // so the header price and every other panel never disagree with each other.
    (async function initialLoad() {
      try {
        const res = await fetch(`${MARKET_URL}?symbol=${encodeURIComponent(currentSymbol)}`, {
          headers: authHeaders()
        });
        const data = await res.json();
        if (res.ok) {
          applyQuote(data.quote.symbol, data.quote); // this also triggers loadChart/loadFundamentals/loadNews internally
        } else {
          loadChart(currentSymbol); // fallback: at least load the chart if quote fails
        }
      } catch (err) {
        loadChart(currentSymbol);
      }
    })();
  });
})();