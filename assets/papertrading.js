(function () {
    const PAPERTRADING_STATE_URL = '/api/papertrading/state';
    const TICK_MS = 1500;
    const BOOK_LEVELS = 5;

    // Supported stock symbols
    const SYMBOLS = [
        { sym: "AAPL", name: "Apple Inc.", base: 214.1, liquidity: 2.0 },
        { sym: "AMZN", name: "Amazon.com Inc.", base: 187.4, liquidity: 1.8 },
        { sym: "BTC", name: "Bitcoin", base: 67500.0, liquidity: 0.5 },
        { sym: "GOOGL", name: "Alphabet Inc.", base: 178.9, liquidity: 1.5 },
        { sym: "MSFT", name: "Microsoft Corp.", base: 441.2, liquidity: 2.2 },
        { sym: "NVDA", name: "NVIDIA Corp.", base: 894.52, liquidity: 2.5 },
        { sym: "SPY", name: "SPDR S&P 500 ETF", base: 528.4, liquidity: 3.0 },
        { sym: "TSLA", name: "Tesla Inc.", base: 248.3, liquidity: 2.0 },
        { sym: "XOM", name: "Exxon Mobil Corp.", base: 115.8, liquidity: 1.2 }
    ];
    const SYMBOL_META = Object.fromEntries(SYMBOLS.map(s => [s.sym, s]));

    // Pure helpers
    const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
    const fmtUSD = (n) => (n ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
    const fmtNum = (n, d = 2) => (n ?? 0).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
    const fmtBps = (n) => `${n >= 0 ? "+" : ""}${fmtNum(n, 1)} bps`;

    // Fee model for US delivery/discount broker
    function calcFees(value) {
        // Flat fee of $1.00 + 0.05% of trade value
        const flatFee = 1.00;
        const variable = value * 0.0005;
        return { total: round2(flatFee + variable) };
    }

    // Synthetic level-2 order book
    function generateBook(ltp, liquidity) {
        const spread = Math.max(ltp * 0.00045, 0.01);
        const bestBid = ltp - spread / 2;
        const bestAsk = ltp + spread / 2;
        const bids = [];
        const asks = [];
        for (let i = 0; i < BOOK_LEVELS; i++) {
            const qtyB = Math.round((120 + Math.random() * 550) * liquidity * (1 - i * 0.08));
            const qtyA = Math.round((120 + Math.random() * 550) * liquidity * (1 - i * 0.08));
            bids.push({ price: round2(bestBid - i * spread * 0.65), qty: Math.max(10, qtyB) });
            asks.push({ price: round2(bestAsk + i * spread * 0.65), qty: Math.max(10, qtyA) });
        }
        return { bids, asks };
    }

    // Walk order book for VWAP fill
    function walkBook(book, side, qty) {
        const levels = side === "BUY" ? book.asks : book.bids;
        let remaining = qty;
        let cost = 0;
        let filled = 0;
        for (const lvl of levels) {
            if (remaining <= 0) break;
            const take = Math.min(remaining, lvl.qty);
            cost += take * lvl.price;
            filled += take;
            remaining -= take;
        }
        if (filled === 0) return null;
        return { avgPrice: round2(cost / filled), filledQty: filled, unfilled: remaining };
    }

    function checkFillCondition(order, ltp) {
        if (order.orderType === "LIMIT") {
            if (order.side === "BUY") return ltp <= order.limitPrice ? order.limitPrice : null;
            return ltp >= order.limitPrice ? order.limitPrice : null;
        }
        if (order.orderType === "STOP") {
            if (order.side === "BUY") return ltp >= order.stopPrice ? ltp : null;
            return ltp <= order.stopPrice ? ltp : null;
        }
        return null;
    }

    // Global application state
    let state = {};
    let loaded = false;
    let selectedSymbol = "AAPL";
    let activeTab = "positions";
    let centerView = "chart"; // "chart" or "depth"
    let orderSide = "BUY"; // "BUY" or "SELL"
    let orderType = "MARKET"; // "MARKET", "LIMIT", or "STOP"
    let timeInForce = "GTC"; // "GTC" or "GTD"
    let activeChartStyle = "candlestick"; // "candlestick", "hollow", "line", "area", "bar"
    let saveTimeout = null;

    // ApexCharts references
    let priceChart = null;
    let equityChart = null;

    function authHeaders(extra) {
        const h = window.TradePilotAuth ? window.TradePilotAuth.authHeader() : {};
        return { ...h, ...(extra || {}) };
    }

    function initDefaultState() {
        const prices = {};
        const book = {};
        const now = Date.now();
        SYMBOLS.forEach((s) => {
            prices[s.sym] = {
                ltp: s.base,
                open: s.base,
                prevClose: s.base,
                high: s.base,
                low: s.base,
                history: Array.from({ length: 20 }, (_, i) => ({
                    t: now - (20 - i) * 60000,
                    price: round2(s.base * (1 + (Math.random() - 0.5) * 0.01))
                }))
            };
            book[s.sym] = generateBook(s.base, s.liquidity);
        });
        return {
            prices,
            book,
            account: { balance: 100000, initialBalance: 100000 },
            positions: {},
            orders: [],
            closedTrades: [],
            equityHistory: [{ t: now, equity: 100000 }]
        };
    }

    async function loadSimulatorState() {
        try {
            const res = await fetch(PAPERTRADING_STATE_URL, { headers: authHeaders() });
            const data = await res.json();
            if (res.ok && data.state) {
                state = data.state;
                // Merge current prices and books from default in case of outdated save
                const fresh = initDefaultState();
                state.prices = state.prices || fresh.prices;
                state.book = state.book || fresh.book;
                state.equityHistory = state.equityHistory || fresh.equityHistory;
            } else {
                state = initDefaultState();
            }
        } catch (e) {
            console.error("Failed to load paper trading state:", e);
            state = initDefaultState();
        } finally {
            loaded = true;
            initUI();
            updateDOM();
        }
    }

    function queueSaveState() {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(async () => {
            try {
                // Keep only last 100 items of orders and trades to prevent payload bloat
                const cleanState = {
                    account: state.account,
                    positions: state.positions,
                    orders: state.orders.slice(0, 100),
                    closedTrades: state.closedTrades.slice(0, 100),
                    equityHistory: state.equityHistory.slice(-240)
                };
                await fetch(PAPERTRADING_STATE_URL, {
                    method: 'POST',
                    headers: authHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify({ state: cleanState })
                });
            } catch (err) {
                console.error("Failed to auto-save simulator state:", err);
            }
        }, 2000);
    }

    // Settle order execution and updates balances & positions
    function settleFill(order, fillPrice, slippageBps, now) {
        const value = fillPrice * order.quantity;
        const fees = calcFees(value).total;
        
        if (order.side === "BUY") {
            const cost = value + fees;
            if (state.account.balance < cost) {
                order.status = "REJECTED";
                order.rejectionReason = "Insufficient buying power";
                order.filledAt = now;
                showNotice("REJECTED", `Buy ${order.quantity} ${order.symbol} rejected: Insufficient funds.`);
                return;
            }
            state.account.balance = round2(state.account.balance - cost);
            const pos = state.positions[order.symbol] || { quantity: 0, averageEntryPrice: 0 };
            const newQty = pos.quantity + order.quantity;
            pos.averageEntryPrice = round2((pos.averageEntryPrice * pos.quantity + fillPrice * order.quantity) / newQty);
            pos.quantity = newQty;
            state.positions[order.symbol] = pos;
            order.fees = fees;
        } else {
            const pos = state.positions[order.symbol];
            const heldQty = pos ? pos.quantity : 0;
            const sellQty = Math.min(order.quantity, heldQty);
            if (sellQty <= 0) {
                order.status = "REJECTED";
                order.rejectionReason = "No position to sell";
                order.filledAt = now;
                showNotice("REJECTED", `Sell ${order.symbol} rejected: No position.`);
                return;
            }
            const sellValue = fillPrice * sellQty;
            state.account.balance = round2(state.account.balance + sellValue - fees);
            const pnl = round2((fillPrice - pos.averageEntryPrice) * sellQty - fees);
            
            state.closedTrades.unshift({
                id: crypto.randomUUID(),
                symbol: order.symbol,
                side: "SELL",
                quantity: sellQty,
                entryPrice: pos.averageEntryPrice,
                exitPrice: fillPrice,
                fees,
                slippageBps: round2(slippageBps),
                pnl,
                closedAt: now
            });
            
            pos.quantity = round2(pos.quantity - sellQty);
            if (pos.quantity <= 0.001) {
                delete state.positions[order.symbol];
            } else {
                state.positions[order.symbol] = pos;
            }
            order.quantity = sellQty;
            order.fees = fees;
        }
        
        order.status = "FILLED";
        order.filledQuantity = order.quantity;
        order.averageFillPrice = round2(fillPrice);
        order.slippageBps = round2(slippageBps);
        order.filledAt = now;
        
        showNotice("FILLED", `FILLED: ${order.side} ${order.quantity} ${order.symbol} @ ${fmtUSD(fillPrice)}`);
    }

    async function fetchRealTimePrices() {
        try {
            const res = await fetch('/api/papertrading/prices');
            if (res.ok) {
                const data = await res.json();
                if (data.prices) {
                    const now = Date.now();
                    SYMBOLS.forEach((s) => {
                        const pData = data.prices[s.sym];
                        if (pData && state.prices && state.prices[s.sym]) {
                            const p = state.prices[s.sym];
                            p.ltp = pData.price;
                            p.prevClose = pData.prevClose || pData.price;
                            p.high = Math.max(p.high, pData.price);
                            p.low = Math.min(p.low, pData.price);

                            // Push history update if last point is old
                            const hist = p.history;
                            const last = hist[hist.length - 1];
                            if (!last || now - last.t > 15000) {
                                hist.push({ t: now, price: pData.price });
                                if (hist.length > 60) hist.shift();
                            }
                        }
                    });
                    updateDOM();
                }
            }
        } catch (e) {
            console.error("Failed to fetch real-time prices:", e);
        }
    }

    // Tick simulation step
    function tickSimulation() {
        if (!loaded) return;
        const now = Date.now();

        // 1. Move stock prices randomly
        SYMBOLS.forEach((s) => {
            const p = state.prices[s.sym];
            const basePrice = p.prevClose || s.base;
            const volatility = s.sym === "BTC" ? 0.0035 : 0.0018; // BTC volatile
            const change = (Math.random() - 0.5) * 2 * volatility;
            const reversion = ((basePrice - p.ltp) / basePrice) * 0.012; // mean reversion
            
            let newLtp = p.ltp * (1 + change + reversion);
            newLtp = Math.max(newLtp, s.base * 0.2); // floor
            
            p.high = Math.max(p.high, newLtp);
            p.low = Math.min(p.low, newLtp);
            p.ltp = round2(newLtp);
            
            p.history.push({ t: now, price: p.ltp });
            if (p.history.length > 60) p.history.shift(); // retain last 60 ticks
            state.book[s.sym] = generateBook(p.ltp, s.liquidity);
        });

        // 2. Evaluate pending limit/stop orders
        state.orders.forEach((order) => {
            if (order.status !== "OPEN") return;
            if (order.timeInForce === "GTD" && order.expiresAt && now >= order.expiresAt) {
                order.status = "EXPIRED";
                order.cancelledAt = now;
                showNotice("EXPIRED", `Order expired: ${order.side} ${order.quantity} ${order.symbol}`);
                return;
            }
            const ltp = state.prices[order.symbol].ltp;
            const fillPrice = checkFillCondition(order, ltp);
            if (fillPrice != null) {
                settleFill(order, fillPrice, 0, now);
            }
        });

        // 3. Append portfolio equity snapshot (every ~3 seconds to save memory)
        const lastSnap = state.equityHistory[state.equityHistory.length - 1];
        if (!lastSnap || now - lastSnap.t > 3000) {
            let marketValue = 0;
            Object.entries(state.positions).forEach(([sym, pos]) => {
                marketValue += (state.prices[sym]?.ltp ?? pos.averageEntryPrice) * pos.quantity;
            });
            const equity = round2(state.account.balance + marketValue);
            state.equityHistory.push({ t: now, equity });
            if (state.equityHistory.length > 240) state.equityHistory.shift();
        }

        // 4. Update elements live
        updateDOM();
        queueSaveState();
    }


    // Notification toast helper
    function showNotice(status, text) {
        const toast = document.getElementById('notice-toast');
        const icon = document.getElementById('toast-icon');
        const txt = document.getElementById('toast-text');
        
        txt.textContent = text;
        if (status === "FILLED") {
            toast.className = "fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl border shadow-lg flex items-center gap-2 max-w-sm bg-green-50 dark:bg-green-950/80 border-green-500 text-green-700 dark:text-green-300";
            icon.textContent = "check_circle";
        } else if (status === "REJECTED" || status === "EXPIRED") {
            toast.className = "fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl border shadow-lg flex items-center gap-2 max-w-sm bg-red-50 dark:bg-red-950/80 border-red-500 text-red-700 dark:text-red-300";
            icon.textContent = "error";
        } else {
            toast.className = "fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl border shadow-lg flex items-center gap-2 max-w-sm bg-blue-50 dark:bg-blue-950/80 border-blue-500 text-blue-700 dark:text-blue-300";
            icon.textContent = "info";
        }
        
        toast.classList.remove('hidden');
        setTimeout(() => toast.classList.add('hidden'), 4000);
    }

    // Switch view tabs in order ticket (Buy/Sell, Order types)
    function initUI() {
        // Watchlist search
        const wSearch = document.getElementById('watchlist-search');
        wSearch.addEventListener('input', renderWatchlist);

        // Sidebar view toggles
        document.getElementById('btn-show-chart').addEventListener('click', () => toggleCenterView('chart'));
        document.getElementById('btn-show-depth').addEventListener('click', () => toggleCenterView('depth'));

        // Order Side switcher
        document.getElementById('ticket-side-buy').addEventListener('click', () => setOrderSide("BUY"));
        document.getElementById('ticket-side-sell').addEventListener('click', () => setOrderSide("SELL"));

        // Order Type switcher
        document.getElementById('type-market').addEventListener('click', () => setOrderType("MARKET"));
        document.getElementById('type-limit').addEventListener('click', () => setOrderType("LIMIT"));
        document.getElementById('type-stop').addEventListener('click', () => setOrderType("STOP"));

        // Time In Force
        document.getElementById('tif-gtc').addEventListener('click', () => setTIF("GTC"));
        document.getElementById('tif-gtd').addEventListener('click', () => setTIF("GTD"));

        // Quantity / estimate handlers
        const qtyIn = document.getElementById('input-qty');
        qtyIn.addEventListener('input', calculateEstimate);
        
        const limIn = document.getElementById('input-limit-price');
        limIn.addEventListener('input', calculateEstimate);

        const stopIn = document.getElementById('input-stop-price');
        stopIn.addEventListener('input', calculateEstimate);

        // Submit Button
        document.getElementById('ticket-submit-btn').addEventListener('click', submitOrder);

        // Reset Button
        document.getElementById('reset-account-btn').addEventListener('click', () => {
            if (confirm("This will clear all simulator holdings, history, and restore cash to $100,000. Proceed?")) {
                state = initDefaultState();
                updateDOM();
                queueSaveState();
                showNotice("INFO", "Account simulator engine reset successful.");
            }
        });

        // Tab switcher
        const tabs = ["positions", "orders", "history", "trades", "stats"];
        tabs.forEach(t => {
            const btn = document.getElementById(`tab-${t}`);
            btn.addEventListener('click', () => selectTab(t));
        });

        // Listen for theme change to update charts
        window.addEventListener('theme-changed', () => {
            if (priceChart) renderPriceChart(selectedSymbol, state.prices[selectedSymbol].history);
            if (equityChart) renderEquityChart(state.equityHistory);
        });
    }

    function toggleCenterView(view) {
        centerView = view;
        const chartBtn = document.getElementById('btn-show-chart');
        const depthBtn = document.getElementById('btn-show-depth');
        const chartPanel = document.getElementById('chart-panel');
        const depthPanel = document.getElementById('depth-panel');
        
        if (view === 'chart') {
            chartBtn.className = "px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all bg-white dark:bg-surface-container shadow-sm text-on-surface dark:text-white";
            depthBtn.className = "px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all text-on-surface-variant dark:text-outline-variant hover:bg-white/40 dark:hover:bg-surface-container-low/40";
            chartPanel.classList.remove('hidden');
            depthPanel.classList.add('hidden');
            
            // Re-render chart to ensure dimensions resolve correctly
            setTimeout(() => {
                if (priceChart) priceChart.windowResizeHandler();
            }, 50);
        } else {
            depthBtn.className = "px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all bg-white dark:bg-surface-container shadow-sm text-on-surface dark:text-white";
            chartBtn.className = "px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all text-on-surface-variant dark:text-outline-variant hover:bg-white/40 dark:hover:bg-surface-container-low/40";
            chartPanel.classList.add('hidden');
            depthPanel.classList.remove('hidden');
            renderDepthLadder();
        }
    }

    function setOrderSide(side) {
        orderSide = side;
        const buyBtn = document.getElementById('ticket-side-buy');
        const sellBtn = document.getElementById('ticket-side-sell');
        const submitBtn = document.getElementById('ticket-submit-btn');
        
        if (side === "BUY") {
            buyBtn.className = "py-2.5 rounded-xl text-sm font-bold tracking-wider transition-all focus:outline-none uppercase bg-green-600 text-white shadow-sm border border-green-600";
            sellBtn.className = "py-2.5 rounded-xl text-sm font-bold tracking-wider transition-all focus:outline-none uppercase bg-surface-container-low text-on-surface dark:text-white border border-outline-variant/20";
            submitBtn.className = "w-full py-3.5 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold tracking-wider transition-all focus:outline-none uppercase text-sm shadow-sm";
        } else {
            sellBtn.className = "py-2.5 rounded-xl text-sm font-bold tracking-wider transition-all focus:outline-none uppercase bg-red-600 text-white shadow-sm border border-red-600";
            buyBtn.className = "py-2.5 rounded-xl text-sm font-bold tracking-wider transition-all focus:outline-none uppercase bg-surface-container-low text-on-surface dark:text-white border border-outline-variant/20";
            submitBtn.className = "w-full py-3.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold tracking-wider transition-all focus:outline-none uppercase text-sm shadow-sm";
        }
        
        updateSubmitButtonText();
        calculateEstimate();
    }

    function setOrderType(type) {
        orderType = type;
        const types = ["market", "limit", "stop"];
        types.forEach(t => {
            const btn = document.getElementById(`type-${t}`);
            if (t === type.toLowerCase()) {
                btn.className = "flex-1 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all uppercase bg-white dark:bg-surface-container shadow-sm text-on-surface dark:text-white";
            } else {
                btn.className = "flex-1 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all uppercase text-on-surface-variant dark:text-outline-variant hover:bg-white/40 dark:hover:bg-surface-container-low/40";
            }
        });

        // Hide/show inputs
        const bestLiq = document.getElementById('wrapper-best-liquidity');
        const limitWrap = document.getElementById('wrapper-limit-price');
        const stopWrap = document.getElementById('wrapper-stop-price');
        const tifWrap = document.getElementById('wrapper-tif');

        if (type === "MARKET") {
            bestLiq.classList.remove('hidden');
            limitWrap.classList.add('hidden');
            stopWrap.classList.add('hidden');
            tifWrap.classList.add('hidden');
        } else if (type === "LIMIT") {
            bestLiq.classList.add('hidden');
            limitWrap.classList.remove('hidden');
            stopWrap.classList.add('hidden');
            tifWrap.classList.remove('hidden');
        } else if (type === "STOP") {
            bestLiq.classList.add('hidden');
            limitWrap.classList.add('hidden');
            stopWrap.classList.remove('hidden');
            tifWrap.classList.remove('hidden');
        }

        updateSubmitButtonText();
        calculateEstimate();
    }

    function setTIF(tif) {
        timeInForce = tif;
        const gtc = document.getElementById('tif-gtc');
        const gtd = document.getElementById('tif-gtd');
        const select = document.getElementById('select-gtd-min');

        if (tif === "GTC") {
            gtc.className = "flex-1 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-surface-container text-on-surface dark:text-white shadow-sm border border-outline-variant/10";
            gtd.className = "flex-1 py-2 text-xs font-semibold rounded-xl bg-surface-container-low text-on-surface-variant dark:text-outline-variant";
            select.classList.add('hidden');
        } else {
            gtd.className = "flex-1 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-surface-container text-on-surface dark:text-white shadow-sm border border-outline-variant/10";
            gtc.className = "flex-1 py-2 text-xs font-semibold rounded-xl bg-surface-container-low text-on-surface-variant dark:text-outline-variant";
            select.classList.remove('hidden');
        }
    }

    function updateSubmitButtonText() {
        const btn = document.getElementById('ticket-submit-btn');
        if (orderType === "MARKET") {
            btn.textContent = `Place MARKET ${orderSide} Order`;
        } else {
            btn.textContent = `Submit ${orderType} ${orderSide} Order`;
        }
    }

    function calculateEstimate() {
        const qty = parseFloat(document.getElementById('input-qty').value) || 0;
        const ltp = state.prices[selectedSymbol].ltp;
        let refPrice = ltp;

        if (orderType === "LIMIT") {
            const limVal = parseFloat(document.getElementById('input-limit-price').value);
            if (!isNaN(limVal) && limVal > 0) refPrice = limVal;
        } else if (orderType === "STOP") {
            const stopVal = parseFloat(document.getElementById('input-stop-price').value);
            if (!isNaN(stopVal) && stopVal > 0) refPrice = stopVal;
        }

        const est = qty * refPrice;
        document.getElementById('est-order-value').textContent = fmtUSD(est);
    }

    function selectTab(tab) {
        activeTab = tab;
        const tabs = ["positions", "orders", "history", "trades", "stats"];
        tabs.forEach(t => {
            const btn = document.getElementById(`tab-${t}`);
            const panel = document.getElementById(`panel-${t}`);
            if (t === tab) {
                btn.className = "flex-1 min-w-[64px] py-3 text-center border-b-2 border-primary dark:border-white text-primary dark:text-white font-bold";
                panel.classList.remove('hidden');
            } else {
                btn.className = "flex-1 min-w-[64px] py-3 text-center border-b-2 border-transparent text-on-surface-variant dark:text-outline-variant font-semibold hover:text-primary dark:hover:text-white transition-colors";
                panel.classList.add('hidden');
            }
        });

        if (tab === "stats") {
            setTimeout(() => renderEquityChart(state.equityHistory), 100);
        }
    }

    function submitOrder() {
        const errEl = document.getElementById('ticket-error');
        errEl.classList.add('hidden');
        errEl.textContent = "";

        const qty = parseInt(document.getElementById('input-qty').value);
        if (isNaN(qty) || qty <= 0) {
            errEl.textContent = "Please enter a valid quantity greater than 0.";
            errEl.classList.remove('hidden');
            return;
        }
        if (qty > 5000) {
            errEl.textContent = "Maximum order size is 5,000 shares per order.";
            errEl.classList.remove('hidden');
            return;
        }

        let limitPrice = null;
        let stopPrice = null;

        if (orderType === "LIMIT") {
            limitPrice = parseFloat(document.getElementById('input-limit-price').value);
            if (isNaN(limitPrice) || limitPrice <= 0) {
                errEl.textContent = "Please enter a valid limit price.";
                errEl.classList.remove('hidden');
                return;
            }
        } else if (orderType === "STOP") {
            stopPrice = parseFloat(document.getElementById('input-stop-price').value);
            if (isNaN(stopPrice) || stopPrice <= 0) {
                errEl.textContent = "Please enter a trigger stop price.";
                errEl.classList.remove('hidden');
                return;
            }
        }

        if (orderSide === "SELL") {
            const held = state.positions[selectedSymbol]?.quantity || 0;
            if (qty > held) {
                errEl.textContent = `Insufficient position. You only hold ${held} shares of ${selectedSymbol}.`;
                errEl.classList.remove('hidden');
                return;
            }
        }

        const now = Date.now();
        const gtdMin = parseInt(document.getElementById('select-gtd-min').value);
        const order = {
            id: crypto.randomUUID(),
            symbol: selectedSymbol,
            side: orderSide,
            orderType: orderType,
            quantity: qty,
            limitPrice,
            stopPrice,
            timeInForce,
            expiresAt: timeInForce === "GTD" ? now + gtdMin * 60 * 1000 : null,
            status: "OPEN",
            filledQuantity: 0,
            averageFillPrice: null,
            slippageBps: null,
            submittedAt: now,
            filledAt: null,
            cancelledAt: null,
            rejectionReason: null,
            fees: 0
        };

        state.orders.unshift(order);
        const book = state.book[selectedSymbol];
        const mid = (book.bids[0].price + book.asks[0].price) / 2;

        if (orderType === "MARKET") {
            const walk = walkBook(book, orderSide, qty);
            if (!walk) {
                order.status = "REJECTED";
                order.rejectionReason = "No market liquidity";
                order.filledAt = now;
                showNotice("REJECTED", `Market order rejected: No liquidity.`);
            } else {
                const slip = orderSide === "BUY"
                    ? ((walk.avgPrice - mid) / mid) * 10000
                    : ((mid - walk.avgPrice) / mid) * 10000;
                order.quantity = walk.filledQty;
                settleFill(order, walk.avgPrice, slip, now);
            }
        } else {
            // resting order: check if ltp fills it immediately
            const ltp = state.prices[selectedSymbol].ltp;
            const fillPrice = checkFillCondition(order, ltp);
            if (fillPrice != null) {
                settleFill(order, fillPrice, 0, now);
            } else {
                showNotice("INFO", `${orderType} ${orderSide} order submitted successfully.`);
            }
        }

        // reset input elements
        document.getElementById('input-limit-price').value = "";
        document.getElementById('input-stop-price').value = "";
        
        updateDOM();
        queueSaveState();
    }

    function cancelOrder(id) {
        const order = state.orders.find(o => o.id === id);
        if (order && order.status === "OPEN") {
            order.status = "CANCELLED";
            order.cancelledAt = Date.now();
            showNotice("INFO", `Cancelled ${order.side} ${order.symbol} order.`);
            updateDOM();
            queueSaveState();
        }
    }

    // --- DOM Update Rendering ---
    function updateDOM() {
        if (!loaded) return;

        // Calc summary values
        let marketValue = 0;
        Object.entries(state.positions).forEach(([sym, pos]) => {
            marketValue += (state.prices[sym]?.ltp ?? pos.averageEntryPrice) * pos.quantity;
        });
        const equity = round2(state.account.balance + marketValue);
        const totalPnl = round2(equity - state.account.initialBalance);

        // Header summaries
        document.getElementById('stat-cash-header').textContent = fmtUSD(state.account.balance);
        document.getElementById('stat-equity-header').textContent = fmtUSD(equity);
        
        const pnlHeader = document.getElementById('stat-pnl-header');
        pnlHeader.textContent = `${totalPnl >= 0 ? '+' : ''}${fmtUSD(totalPnl)}`;
        pnlHeader.className = totalPnl >= 0 ? 'text-green-600 dark:text-green-400 font-bold' : 'text-red-500 font-bold';

        // Right sidebar metrics
        document.getElementById('stat-cash-sidebar').textContent = fmtUSD(state.account.balance);
        document.getElementById('stat-equity-sidebar').textContent = fmtUSD(equity);
        
        let unrealized = 0;
        Object.entries(state.positions).forEach(([sym, pos]) => {
            unrealized += ((state.prices[sym]?.ltp ?? pos.averageEntryPrice) - pos.averageEntryPrice) * pos.quantity;
        });
        unrealized = round2(unrealized);
        const unrealEl = document.getElementById('stat-unreal-sidebar');
        unrealEl.textContent = `${unrealized >= 0 ? '+' : ''}${fmtUSD(unrealized)}`;
        unrealEl.className = unrealized >= 0 ? 'text-green-600 dark:text-green-400 font-bold' : 'text-red-500 font-bold';
        
        const realized = round2(state.closedTrades.reduce((sum, t) => sum + t.pnl, 0));
        document.getElementById('stat-real-sidebar').textContent = fmtUSD(realized);

        // Render sections
        renderWatchlist();
        renderActiveStock();
        renderDepthLadder();
        renderTabPanels();
        calculateEstimate();
    }

    function renderWatchlist() {
        const listContainer = document.getElementById('watchlist-items');
        const query = document.getElementById('watchlist-search').value.toLowerCase().trim();
        listContainer.innerHTML = "";

        SYMBOLS.forEach((s) => {
            if (query && !s.sym.toLowerCase().includes(query) && !s.name.toLowerCase().includes(query)) return;

            const p = state.prices[s.sym];
            const chg = p.ltp - p.prevClose;
            const chgPct = p.prevClose ? (chg / p.prevClose) * 100 : 0;
            const isHeld = !!state.positions[s.sym];
            const isSelected = selectedSymbol === s.sym;

            const item = document.createElement('button');
            item.className = `w-full text-left p-sm border-b border-outline-variant/10 flex items-center justify-between transition-colors hover:bg-surface-container-low dark:hover:bg-surface-container-high/40 ${
                isSelected ? 'bg-surface-container-low/80 dark:bg-surface-container border-l-4 border-l-[#e89a23] pl-2.5' : 'pl-3'
            }`;
            
            item.innerHTML = `
                <div class="min-w-0">
                    <div class="text-xs font-bold tp-mono flex items-center gap-1 dark:text-white">
                        ${s.sym}
                        ${isHeld ? '<span class="w-1.5 h-1.5 rounded-full bg-[#e89a23]" title="Position Open"></span>' : ''}
                    </div>
                    <div class="text-[9px] text-on-surface-variant dark:text-outline-variant truncate">${s.name}</div>
                </div>
                <div class="text-right tp-mono">
                    <div class="text-xs font-semibold dark:text-white">${fmtNum(p.ltp)}</div>
                    <div class="text-[9px] font-bold ${chg >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}">
                        ${chg >= 0 ? '+' : ''}${fmtNum(chgPct)}%
                    </div>
                </div>
            `;
            item.addEventListener('click', () => selectStock(s.sym));
            listContainer.appendChild(item);
        });
    }

    function selectStock(sym) {
        selectedSymbol = sym;
        renderWatchlist();
        renderActiveStock();
        renderDepthLadder();
        calculateEstimate();
    }

    function renderActiveStock() {
        const s = SYMBOL_META[selectedSymbol];
        const p = state.prices[selectedSymbol];
        const chg = p.ltp - p.prevClose;
        const chgPct = p.prevClose ? (chg / p.prevClose) * 100 : 0;

        document.getElementById('terminal-symbol').textContent = s.sym;
        document.getElementById('terminal-name').textContent = s.name;
        document.getElementById('terminal-price').textContent = fmtUSD(p.ltp);
        
        const chgEl = document.getElementById('terminal-change');
        const arrow = document.getElementById('terminal-arrow');
        const chgTxt = document.getElementById('terminal-change-txt');
        
        chgTxt.textContent = `${chg >= 0 ? '+' : ''}${fmtUSD(chg)} (${chg >= 0 ? '+' : ''}${fmtNum(chgPct)}%)`;
        if (chg >= 0) {
            chgEl.className = "text-label-sm font-bold flex items-center gap-0.5 text-green-600 dark:text-green-400";
            arrow.textContent = "trending_up";
        } else {
            chgEl.className = "text-label-sm font-bold flex items-center gap-0.5 text-red-500";
            arrow.textContent = "trending_down";
        }

        // Ticket best liquidity updates
        const book = state.book[selectedSymbol];
        const liqPrice = orderSide === "BUY" ? book.asks[0].price : book.bids[0].price;
        document.getElementById('label-liquidity').textContent = orderSide === "BUY" ? "Best Ask" : "Best Bid";
        document.getElementById('best-liquidity-price').textContent = fmtUSD(liqPrice);

        // Render chart update
        if (centerView === "chart") {
            renderPriceChart(selectedSymbol, p.history);
        }
        renderFundamentals(selectedSymbol);
    }

    function renderDepthLadder() {
        if (centerView !== "depth") return;
        const book = state.book[selectedSymbol];
        const bidContainer = document.getElementById('bids-ladder');
        const askContainer = document.getElementById('asks-ladder');
        
        bidContainer.innerHTML = "";
        askContainer.innerHTML = "";

        const maxQty = Math.max(
            ...book.bids.map(b => b.qty),
            ...book.asks.map(a => a.qty),
            1
        );

        // Render Bids (Buy side)
        book.bids.forEach((b) => {
            const row = document.createElement('div');
            row.className = "relative flex items-center justify-between px-2 py-1 rounded overflow-hidden";
            const percent = (b.qty / maxQty) * 100;
            row.innerHTML = `
                <div class="absolute inset-y-0 right-0 bg-green-500/10 dark:bg-green-500/20" style="width: ${percent}%"></div>
                <span class="relative z-10 text-green-600 dark:text-green-400 font-bold">${b.qty}</span>
                <span class="relative z-10 font-bold dark:text-white">${fmtNum(b.price)}</span>
            `;
            bidContainer.appendChild(row);
        });

        // Render Asks (Sell side)
        book.asks.forEach((a) => {
            const row = document.createElement('div');
            row.className = "relative flex items-center justify-between px-2 py-1 rounded overflow-hidden";
            const percent = (a.qty / maxQty) * 100;
            row.innerHTML = `
                <div class="absolute inset-y-0 left-0 bg-red-500/10 dark:bg-red-500/20" style="width: ${percent}%"></div>
                <span class="relative z-10 font-bold dark:text-white">${fmtNum(a.price)}</span>
                <span class="relative z-10 text-red-500 font-bold">${a.qty}</span>
            `;
            askContainer.appendChild(row);
        });
    }

    function renderTabPanels() {
        // POS count
        const posCount = Object.keys(state.positions).length;
        document.getElementById('badge-positions-count').textContent = `(${posCount})`;
        
        // ORD count
        const openOrders = state.orders.filter(o => o.status === "OPEN");
        document.getElementById('badge-orders-count').textContent = `(${openOrders.length})`;

        // POSITIONS panel
        const posPanel = document.getElementById('panel-positions');
        posPanel.innerHTML = "";
        if (posCount === 0) {
            posPanel.innerHTML = `<div class="py-8 text-center text-xs text-on-surface-variant dark:text-outline-variant">No active positions. Execute a buy order to open.</div>`;
        } else {
            Object.entries(state.positions).forEach(([sym, pos]) => {
                const ltp = state.prices[sym]?.ltp ?? pos.averageEntryPrice;
                const pnl = round2((ltp - pos.averageEntryPrice) * pos.quantity);
                const pnlPct = (pnl / (pos.averageEntryPrice * pos.quantity)) * 100;
                
                const card = document.createElement('div');
                card.className = "p-md border border-outline-variant/20 rounded-xl flex justify-between items-center bg-surface-container-lowest dark:bg-surface-container-low shadow-sm";
                card.innerHTML = `
                    <div>
                        <p class="font-bold text-xs tp-mono dark:text-white">${sym}</p>
                        <p class="text-[10px] text-on-surface-variant dark:text-outline-variant mt-0.5">${pos.quantity} shares @ avg ${fmtNum(pos.averageEntryPrice)}</p>
                    </div>
                    <div class="text-right tp-mono">
                        <p class="text-xs font-bold dark:text-white">${fmtUSD(pos.quantity * ltp)}</p>
                        <p class="text-[10px] font-bold ${pnl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}">
                            ${pnl >= 0 ? '+' : ''}${fmtUSD(pnl)} (${pnl >= 0 ? '+' : ''}${fmtNum(pnlPct)}%)
                        </p>
                    </div>
                `;
                posPanel.appendChild(card);
            });
        }

        // ORDERS panel
        const ordPanel = document.getElementById('panel-orders');
        ordPanel.innerHTML = "";
        if (openOrders.length === 0) {
            ordPanel.innerHTML = `<div class="py-8 text-center text-xs text-on-surface-variant dark:text-outline-variant">No active resting orders.</div>`;
        } else {
            openOrders.forEach((o) => {
                const card = document.createElement('div');
                card.className = "p-md border border-outline-variant/20 rounded-xl flex justify-between items-center bg-surface-container-lowest dark:bg-surface-container-low shadow-sm";
                card.innerHTML = `
                    <div class="flex-1">
                        <div class="flex items-center gap-sm">
                            <span class="text-xs font-bold tp-mono dark:text-white">${o.symbol}</span>
                            <span class="px-1.5 py-0.2 bg-surface-container dark:bg-surface-container-high rounded text-[8px] font-bold uppercase ${o.side === "BUY" ? 'text-green-600' : 'text-red-500'}">${o.side}</span>
                        </div>
                        <p class="text-[9px] text-on-surface-variant dark:text-outline-variant mt-1">
                            ${o.orderType} · ${o.quantity} sh @ ${fmtNum(o.limitPrice || o.stopPrice)} · ${o.timeInForce}
                        </p>
                    </div>
                    <button class="text-on-surface-variant hover:text-error transition-colors" onclick="window.cancelPaperOrder('${o.id}')">
                        <span class="material-symbols-outlined text-[18px]">cancel</span>
                    </button>
                `;
                ordPanel.appendChild(card);
            });
        }
        // Expose helper globally for inline cancel button clicks
        window.cancelPaperOrder = cancelOrder;

        // HISTORY panel
        const histPanel = document.getElementById('panel-history');
        histPanel.innerHTML = "";
        if (state.orders.length === 0) {
            histPanel.innerHTML = `<div class="py-8 text-center text-xs text-on-surface-variant dark:text-outline-variant">No orders submitted.</div>`;
        } else {
            state.orders.slice(0, 50).forEach((o) => {
                const card = document.createElement('div');
                card.className = "p-sm border border-outline-variant/10 rounded-xl bg-surface-container-lowest dark:bg-surface-container-low shadow-xs";
                
                let badgeTheme = "bg-slate-100 text-slate-700";
                if (o.status === "FILLED") badgeTheme = "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400";
                else if (o.status === "REJECTED" || o.status === "CANCELLED" || o.status === "EXPIRED") {
                    badgeTheme = "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400";
                }

                card.innerHTML = `
                    <div class="flex justify-between items-center">
                        <span class="text-xs font-bold tp-mono dark:text-white">${o.symbol} <b class="${o.side === 'BUY' ? 'text-green-600' : 'text-red-500'}">[${o.side}]</b></span>
                        <span class="px-2 py-0.5 rounded text-[8px] font-bold uppercase ${badgeTheme}">${o.status}</span>
                    </div>
                    <div class="text-[9px] text-on-surface-variant dark:text-outline-variant mt-1">
                        ${o.orderType} · ${o.quantity} sh ${o.averageFillPrice ? `@ ${fmtUSD(o.averageFillPrice)}` : ''} 
                        ${o.slippageBps ? `· ${fmtBps(o.slippageBps)} slip` : ''}
                        ${o.rejectionReason ? `— ${o.rejectionReason}` : ''}
                    </div>
                    <span class="text-[8px] text-on-surface-variant dark:text-outline-variant mt-0.5 block">${new Date(o.submittedAt).toLocaleTimeString()}</span>
                `;
                histPanel.appendChild(card);
            });
        }

        // TRADES panel
        const trdPanel = document.getElementById('panel-trades');
        trdPanel.innerHTML = "";
        if (state.closedTrades.length === 0) {
            trdPanel.innerHTML = `<div class="py-8 text-center text-xs text-on-surface-variant dark:text-outline-variant">No realized trades yet.</div>`;
        } else {
            state.closedTrades.slice(0, 50).forEach((t) => {
                const card = document.createElement('div');
                card.className = "p-sm border border-outline-variant/10 rounded-xl bg-surface-container-lowest dark:bg-surface-container-low shadow-xs";
                card.innerHTML = `
                    <div class="flex justify-between items-center">
                        <span class="text-xs font-bold tp-mono dark:text-white">${t.symbol}</span>
                        <span class="text-xs font-bold tp-mono ${t.pnl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}">
                            ${t.pnl >= 0 ? '+' : ''}${fmtUSD(t.pnl)}
                        </span>
                    </div>
                    <div class="text-[9px] text-on-surface-variant dark:text-outline-variant mt-1">
                        ${t.quantity} sh · Entry: ${fmtNum(t.entryPrice)} &rarr; Exit: ${fmtNum(t.exitPrice)}
                    </div>
                    <div class="text-[8px] text-on-surface-variant dark:text-outline-variant mt-1">
                        Fees: ${fmtUSD(t.fees)} ${t.slippageBps ? `· Slippage: ${fmtBps(t.slippageBps)}` : ''}
                    </div>
                `;
                trdPanel.appendChild(card);
            });
        }

        // STATS panel math calculations
        if (activeTab === "stats") {
            const trades = state.closedTrades;
            const total = trades.length;
            const wins = trades.filter(t => t.pnl > 0).length;
            const winRate = total ? (wins / total) * 100 : 0;
            const roi = ((equity - state.account.initialBalance) / state.account.initialBalance) * 100;
            
            let peak = -Infinity;
            let maxDd = 0;
            state.equityHistory.forEach(h => {
                peak = Math.max(peak, h.equity);
                const dd = ((peak - h.equity) / peak) * 100;
                maxDd = Math.max(maxDd, dd);
            });

            const avgSlip = total ? trades.reduce((sum, t) => sum + (t.slippageBps || 0), 0) / total : 0;

            document.getElementById('stat-total-trades').textContent = total;
            document.getElementById('stat-win-rate').textContent = `${winRate.toFixed(1)}%`;
            document.getElementById('stat-roi').textContent = `${roi >= 0 ? '+' : ''}${roi.toFixed(2)}%`;
            document.getElementById('stat-drawdown').textContent = `-${maxDd.toFixed(2)}%`;
            document.getElementById('stat-avg-slip').textContent = fmtBps(avgSlip);
            document.getElementById('stat-realized-pnl').textContent = fmtUSD(state.closedTrades.reduce((s, t) => s + t.pnl, 0));

            const recordsEl = document.getElementById('stats-records-txt');
            if (total > 0) {
                const best = trades.reduce((b, t) => t.pnl > b.pnl ? t : b, trades[0]);
                const worst = trades.reduce((w, t) => t.pnl < w.pnl ? t : w, trades[0]);
                recordsEl.innerHTML = `
                    Best trade: <b class="text-green-600 dark:text-green-400 font-bold">${best.symbol} (+${fmtUSD(best.pnl)})</b><br/>
                    Worst trade: <b class="text-red-500 font-bold">${worst.symbol} (${fmtUSD(worst.pnl)})</b>
                `;
            } else {
                recordsEl.textContent = "No trade summaries logged yet.";
            }
        }
    }

    let activeRange = '1D';

    // Generate Candlestick OHLC data for ApexCharts
    function generateCandlestickData(p, history, range = '1D') {
        const now = Date.now();
        let count = 30;
        let stepMs = 5 * 60 * 1000; // 5 min candles for 1D
        
        if (range === '1M') {
            count = 30;
            stepMs = 24 * 60 * 60 * 1000;
        } else if (range === '6M') {
            count = 45;
            stepMs = 4 * 24 * 60 * 60 * 1000;
        } else if (range === '1Y') {
            count = 52;
            stepMs = 7 * 24 * 60 * 60 * 1000;
        }
        
        const candles = [];
        let currentPrice = p.prevClose || p.ltp || 100;
        
        for (let i = count; i >= 1; i--) {
            const t = now - i * stepMs;
            const change = (Math.random() - 0.49) * 0.015 * currentPrice;
            const open = round2(currentPrice);
            const close = round2(Math.max(0.1, currentPrice + change));
            const high = round2(Math.max(open, close) + Math.random() * 0.008 * currentPrice);
            const low = round2(Math.max(0.05, Math.min(open, close) - Math.random() * 0.008 * currentPrice));
            
            candles.push({ x: t, y: [open, high, low, close] });
            currentPrice = close;
        }
        
        // Push latest live tick as current candle
        if (history && history.length > 0) {
            const open = history[0].price;
            const close = history[history.length - 1].price;
            const high = Math.max(...history.map(h => h.price));
            const low = Math.min(...history.map(h => h.price));
            candles.push({ x: now, y: [open, high, low, close] });
        }
        
        return candles;
    }

    // --- Charting logic via ApexCharts (Multi-style: Candles, Hollow, Line, Area, Bar) ---
    function renderPriceChart(symbol, history, range = activeRange, style = activeChartStyle) {
        const isDark = document.documentElement.classList.contains('dark');
        const p = state.prices[symbol] || { ltp: 100, prevClose: 100 };
        const rawCandles = generateCandlestickData(p, history, range);
        
        let apexType = 'candlestick';
        let seriesData = rawCandles;
        let strokeConfig = { curve: 'smooth', width: 2 };
        let plotOptions = {
            candlestick: {
                colors: { upward: '#16a34a', downward: '#dc2626' }
            }
        };
        let colors = ['#16a34a'];

        if (style === 'hollow') {
            apexType = 'candlestick';
            plotOptions = {
                candlestick: {
                    colors: { upward: isDark ? '#0f172a' : '#ffffff', downward: '#dc2626' },
                    wick: { useFillColor: true }
                }
            };
        } else if (style === 'line') {
            apexType = 'line';
            seriesData = rawCandles.map(c => ({ x: c.x, y: c.y[3] }));
            colors = ['#2563eb'];
        } else if (style === 'area') {
            apexType = 'area';
            seriesData = rawCandles.map(c => ({ x: c.x, y: c.y[3] }));
            colors = ['#16a34a'];
        } else if (style === 'bar') {
            apexType = 'bar';
            seriesData = rawCandles.map(c => ({ x: c.x, y: c.y[3] }));
            colors = ['#e89a23'];
        }

        // Re-create chart if type changed
        if (priceChart && priceChart.w && priceChart.w.config && priceChart.w.config.chart.type !== apexType) {
            priceChart.destroy();
            priceChart = null;
        }

        const options = {
            chart: {
                id: 'price-chart',
                type: apexType,
                height: 240,
                animations: { enabled: false },
                toolbar: {
                    show: true,
                    autoSelected: 'zoom',
                    tools: {
                        download: false,
                        selection: true,
                        zoom: true,
                        zoomin: true,
                        zoomout: true,
                        pan: true,
                        reset: true
                    }
                },
                zoom: {
                    enabled: true,
                    type: 'xy',
                    autoScaleYaxis: true
                },
                background: 'transparent',
                foreColor: isDark ? '#94a3b8' : '#64748b'
            },
            colors: colors,
            stroke: strokeConfig,
            plotOptions: plotOptions,
            series: [{ name: symbol, data: seriesData }],
            xaxis: {
                type: 'datetime',
                labels: {
                    datetimeUTC: false,
                    style: { fontSize: '9px', fontFamily: 'Inter' }
                },
                axisBorder: { show: false },
                axisTicks: { show: false }
            },
            yaxis: {
                decimalsInFloat: 2,
                labels: {
                    style: { fontSize: '9px', fontFamily: 'Inter' }
                }
            },
            grid: {
                borderColor: isDark ? '#334155' : '#e2e8f0',
                strokeDashArray: 3,
                yaxis: { lines: { show: true } },
                xaxis: { lines: { show: false } }
            },
            tooltip: {
                theme: isDark ? 'dark' : 'light',
                x: { format: 'dd MMM HH:mm' }
            }
        };

        const pos = state.positions[symbol];
        if (pos) {
            options.annotations = {
                yaxis: [{
                    y: pos.averageEntryPrice,
                    borderColor: '#e89a23',
                    strokeDashArray: 4,
                    label: {
                        borderColor: '#e89a23',
                        style: { color: '#fff', background: '#e89a23', fontSize: '9px', fontFamily: 'JetBrains Mono' },
                        text: `Avg Entry: $${pos.averageEntryPrice.toFixed(2)}`
                    }
                }]
            };
        }

        if (priceChart) {
            priceChart.updateOptions(options);
        } else {
            priceChart = new ApexCharts(document.querySelector('#apex-price-chart'), options);
            priceChart.render();
        }
    }

    function renderEquityChart(history) {
        const isDark = document.documentElement.classList.contains('dark');
        const chartData = history.map(h => ({ x: h.t, y: h.equity }));
        
        const options = {
            chart: {
                id: 'equity-chart',
                type: 'line',
                height: 120,
                animations: { enabled: false },
                toolbar: { show: false },
                background: 'transparent',
                foreColor: isDark ? '#94a3b8' : '#64748b'
            },
            colors: ['#e89a23'],
            dataLabels: { enabled: false },
            stroke: { curve: 'straight', width: 1.5 },
            series: [{ name: 'Equity', data: chartData }],
            xaxis: {
                type: 'datetime',
                labels: { show: false },
                axisBorder: { show: false },
                axisTicks: { show: false }
            },
            yaxis: {
                show: false,
                decimalsInFloat: 2
            },
            grid: {
                show: false
            },
            tooltip: {
                theme: isDark ? 'dark' : 'light',
                x: { format: 'HH:mm:ss' }
            }
        };

        if (equityChart) {
            equityChart.updateOptions(options);
        } else {
            equityChart = new ApexCharts(document.querySelector('#stats-equity-chart'), options);
            equityChart.render();
        }
    }

    // Company Financial Fundamentals Database
    const FUNDAMENTALS = {
        AAPL: { rev: "$119.58B (+2.1%)", net: "$33.92B", eps: "$2.18 (+$0.08 Beat)", margin: "30.7%", cash: "$61.55B", debt: "$106.63B", fcf: "$99.58B", ratios: "0.88 Quick / 1.45x D/E" },
        AMZN: { rev: "$169.96B (+13.9%)", net: "$10.62B", eps: "$1.00 (+$0.20 Beat)", margin: "18.2%", cash: "$86.78B", debt: "$67.15B", fcf: "$36.81B", ratios: "1.05 Quick / 0.75x D/E" },
        BTC: { rev: "N/A (Decentralized)", net: "N/A (PoW Reward 3.125)", eps: "N/A (21M Max Supply)", margin: "N/A", cash: "$1.30T MCap", debt: "$0.00 (No Liabilities)", fcf: "Hashrate 650 EH/s", ratios: "Crypto Commodity Asset" },
        GOOGL: { rev: "$86.31B (+13.5%)", net: "$20.69B", eps: "$1.64 (+$0.05 Beat)", margin: "27.5%", cash: "$110.97B", debt: "$28.88B", fcf: "$69.49B", ratios: "1.89 Quick / 0.12x D/E" },
        MSFT: { rev: "$62.02B (+17.6%)", net: "$21.87B", eps: "$2.93 (+$0.15 Beat)", margin: "44.6%", cash: "$81.02B", debt: "$71.54B", fcf: "$67.45B", ratios: "1.22 Quick / 0.35x D/E" },
        NVDA: { rev: "$26.04B (+262%)", net: "$14.88B", eps: "$6.12 (+$0.53 Beat)", margin: "64.9%", cash: "$31.44B", debt: "$11.05B", fcf: "$39.31B", ratios: "3.52 Quick / 0.22x D/E" },
        SPY: { rev: "$528.40 NAV", net: "500 Large-Cap Equities", eps: "Exp Ratio 0.09%", margin: "10.8% ROE", cash: "$510B AUM", debt: "N/A (ETF Trust)", fcf: "Yield 1.25%", ratios: "P/E 24.5x" },
        TSLA: { rev: "$25.17B (+3.5%)", net: "$7.93B", eps: "$0.71 (-$0.03 Miss)", margin: "17.2%", cash: "$29.09B", debt: "$5.21B", fcf: "$4.35B", ratios: "1.34 Quick / 0.08x D/E" },
        XOM: { rev: "$84.34B (-6.3%)", net: "$7.63B", eps: "$2.48 (+$0.27 Beat)", margin: "12.1%", cash: "$31.54B", debt: "$41.52B", fcf: "$35.24B", ratios: "1.10 Quick / 0.20x D/E" }
    };

    function renderFundamentals(sym) {
        const data = FUNDAMENTALS[sym] || FUNDAMENTALS.AAPL;
        const setTxt = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
        setTxt('fund-q-rev', data.rev);
        setTxt('fund-q-net', data.net);
        setTxt('fund-q-eps', data.eps);
        setTxt('fund-q-margin', data.margin);
        setTxt('fund-b-cash', data.cash);
        setTxt('fund-b-debt', data.debt);
        setTxt('fund-b-fcf', data.fcf);
        setTxt('fund-b-ratios', data.ratios);

        fetchFinnhubFundamentals(sym);
    }

    async function fetchFinnhubFundamentals(sym) {
        try {
            const res = await fetch(`/api/papertrading/fundamentals/${sym}`, { headers: authHeaders() });
            const data = await res.json();
            if (data && data.fundamentals) {
                const f = data.fundamentals;
                const setTxt = (id, txt) => { const el = document.getElementById(id); if (el && txt && txt !== 'N/A') el.textContent = txt; };
                if (f.revenueGrowth && f.revenueGrowth !== 'N/A') setTxt('fund-q-rev', `${f.revenueGrowth} 3Y Rev`);
                if (f.marketCap && f.marketCap !== 'N/A') setTxt('fund-q-net', f.marketCap);
                if (f.week52Low !== 'N/A' && f.week52High !== 'N/A') setTxt('fund-q-eps', `52W: ${f.week52Low} - ${f.week52High}`);
                if (f.peRatio && f.peRatio !== 'N/A') setTxt('fund-q-margin', `P/E: ${f.peRatio}`);
                if (f.marketCap && f.marketCap !== 'N/A') setTxt('fund-b-cash', f.marketCap);
                if (f.debtToEquity && f.debtToEquity !== 'N/A') setTxt('fund-b-debt', `D/E: ${f.debtToEquity}`);
                if (f.roe && f.roe !== 'N/A') setTxt('fund-b-fcf', `ROE: ${f.roe}`);
                if (f.quickRatio !== 'N/A' || f.dividendYield !== 'N/A') setTxt('fund-b-ratios', `Quick: ${f.quickRatio} | Div: ${f.dividendYield}`);
            }
        } catch (err) {
            console.warn('Finnhub fundamentals fallback:', err);
        }
    }

    async function fetchSymbolFinnhubNews(symbol) {
        const listEl = document.getElementById('finnhub-news-list');
        if (!listEl) return;
        listEl.innerHTML = `<p class="text-[10px] text-on-surface-variant italic">Loading live Finnhub news for ${symbol}...</p>`;
        try {
            const res = await fetch(`/api/papertrading/news/${symbol}`, { headers: authHeaders() });
            const data = await res.json();
            if (!data.news || data.news.length === 0) {
                listEl.innerHTML = `<p class="text-[10px] text-on-surface-variant italic">No recent Finnhub news articles found for ${symbol}.</p>`;
                return;
            }
            listEl.innerHTML = data.news.map(item => `
                <div class="p-2 bg-surface-container rounded-xl border border-outline-variant/10">
                    <a href="${item.url}" target="_blank" class="font-bold text-primary hover:underline line-clamp-1 text-xs block mb-0.5">${item.headline}</a>
                    <p class="text-[10px] text-on-surface-variant line-clamp-2 mb-1">${item.summary}</p>
                    <div class="flex justify-between text-[8px] font-semibold text-on-surface-variant/80 uppercase">
                        <span>${item.source}</span>
                        <span>${item.datetime}</span>
                    </div>
                </div>
            `).join('');
        } catch (err) {
            listEl.innerHTML = `<p class="text-[10px] text-red-500 font-semibold">Unable to connect to Finnhub news stream.</p>`;
        }
    }

    // --- Mode Switcher, Disclaimers, Custom Cash & Guided Tour ---
    function initNewFeatures() {
        // 1. Depth Panel Sub-tabs (Order Book vs Quarterly vs Balance vs Finnhub News)
        const subBook = document.getElementById('subtab-orderbook');
        const subQuarter = document.getElementById('subtab-quarterly');
        const subBalance = document.getElementById('subtab-balancesheet');
        const subNews = document.getElementById('subtab-news');
        const panelBook = document.getElementById('subpanel-orderbook');
        const panelQuarter = document.getElementById('subpanel-quarterly');
        const panelBalance = document.getElementById('subpanel-balancesheet');
        const panelNews = document.getElementById('subpanel-news');

        if (subBook && subQuarter && subBalance && subNews && panelBook && panelQuarter && panelBalance && panelNews) {
            const setSubActive = (activeBtn, activePanel) => {
                [subBook, subQuarter, subBalance, subNews].forEach(b => b.className = "flex-1 py-1 rounded-lg text-on-surface-variant hover:text-on-surface");
                [panelBook, panelQuarter, panelBalance, panelNews].forEach(p => p.classList.add('hidden'));
                activeBtn.className = "flex-1 py-1 rounded-lg bg-white shadow-sm text-primary font-bold";
                activePanel.classList.remove('hidden');
                renderFundamentals(selectedSymbol);
            };

            subBook.addEventListener('click', () => setSubActive(subBook, panelBook));
            subQuarter.addEventListener('click', () => setSubActive(subQuarter, panelQuarter));
            subBalance.addEventListener('click', () => setSubActive(subBalance, panelBalance));
            subNews.addEventListener('click', () => {
                setSubActive(subNews, panelNews);
                fetchSymbolFinnhubNews(selectedSymbol);
            });
        }

        // 2. Chart Type selector dropdown (Solid Candles, Hollow Candles, Line, Area, Bar)
        const chartTypeSelect = document.getElementById('select-chart-type');
        if (chartTypeSelect) {
            chartTypeSelect.addEventListener('change', (e) => {
                activeChartStyle = e.target.value;
                if (state.prices && state.prices[selectedSymbol]) {
                    renderPriceChart(selectedSymbol, state.prices[selectedSymbol].history, activeRange, activeChartStyle);
                }
            });
        }

        // 3. Timeframe selector buttons
        document.querySelectorAll('#chart-timeframe-controls .tf-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#chart-timeframe-controls .tf-btn').forEach(b => {
                    b.className = "tf-btn px-2 py-0.5 rounded-lg text-on-surface-variant hover:text-on-surface";
                });
                btn.className = "tf-btn px-2 py-0.5 rounded-lg bg-white shadow-sm text-primary font-bold";
                activeRange = btn.getAttribute('data-range');
                if (state.prices && state.prices[selectedSymbol]) {
                    renderPriceChart(selectedSymbol, state.prices[selectedSymbol].history, activeRange, activeChartStyle);
                }
            });
        });

        // 3. Mode Switcher (Practice vs Theory)
        const practiceBtn = document.getElementById('nav-mode-practice');
        const theoryBtn = document.getElementById('nav-mode-theory');
        const practiceSec = document.getElementById('section-practice');
        const theorySec = document.getElementById('section-theory');

        if (practiceBtn && theoryBtn && practiceSec && theorySec) {
            practiceBtn.addEventListener('click', () => {
                practiceBtn.className = "px-6 py-2 rounded-xl text-xs font-bold transition-all bg-white text-primary shadow-sm flex items-center gap-2";
                theoryBtn.className = "px-6 py-2 rounded-xl text-xs font-bold transition-all text-on-surface-variant hover:text-on-surface flex items-center gap-2";
                practiceSec.classList.remove('hidden');
                theorySec.classList.add('hidden');
                setTimeout(() => { if (priceChart) priceChart.windowResizeHandler(); }, 50);
            });

            theoryBtn.addEventListener('click', () => {
                theoryBtn.className = "px-6 py-2 rounded-xl text-xs font-bold transition-all bg-white text-primary shadow-sm flex items-center gap-2";
                practiceBtn.className = "px-6 py-2 rounded-xl text-xs font-bold transition-all text-on-surface-variant hover:text-on-surface flex items-center gap-2";
                theorySec.classList.remove('hidden');
                practiceSec.classList.add('hidden');
            });
        }

        checkDisclaimerModal();
        initCashAndTierControls();
        initTourEvents();
    }

    // Disclaimer modal logic
    function checkDisclaimerModal() {
        const modal = document.getElementById('disclaimer-modal');
        const closeBtn = document.getElementById('btn-close-disclaimer');
        const chkHide = document.getElementById('chk-hide-disclaimer');
        
        if (!modal) return;
        const isDismissed = localStorage.getItem('tradepilot_disclaimer_dismissed');
        if (!isDismissed) {
            modal.classList.remove('hidden');
        }
        
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                modal.classList.add('hidden');
                if (chkHide && chkHide.checked) {
                    localStorage.setItem('tradepilot_disclaimer_dismissed', 'true');
                }
            });
        }
    }

    // Cash config & difficulty tier controls
    function initCashAndTierControls() {
        const cashModal = document.getElementById('cash-modal');
        const btnConfig = document.getElementById('btn-customize-cash');
        const btnClose = document.getElementById('btn-close-cash-modal');
        const btnRandom = document.getElementById('btn-random-cash');
        const tierSelect = document.getElementById('select-difficulty-tier');
        
        if (btnConfig && cashModal) {
            btnConfig.addEventListener('click', () => cashModal.classList.remove('hidden'));
        }
        if (btnClose && cashModal) {
            btnClose.addEventListener('click', () => cashModal.classList.add('hidden'));
        }
        
        document.querySelectorAll('.btn-preset-cash').forEach(btn => {
            btn.addEventListener('click', () => {
                const amount = parseFloat(btn.getAttribute('data-cash'));
                setPortfolioCash(amount);
                if (cashModal) cashModal.classList.add('hidden');
            });
        });
        
        if (btnRandom) {
            btnRandom.addEventListener('click', () => {
                const randomAmounts = [15000, 25000, 75000, 150000, 250000, 1000000];
                const amount = randomAmounts[Math.floor(Math.random() * randomAmounts.length)];
                setPortfolioCash(amount);
                if (cashModal) cashModal.classList.add('hidden');
            });
        }
        
        if (tierSelect) {
            const savedTier = localStorage.getItem('tradepilot_difficulty_tier') || 'intermediate';
            tierSelect.value = savedTier;
            tierSelect.addEventListener('change', (e) => {
                localStorage.setItem('tradepilot_difficulty_tier', e.target.value);
                showNotice("UPDATED", `Guidance level set to: ${e.target.options[e.target.selectedIndex].text}`);
            });
        }
    }

    function setPortfolioCash(amount) {
        if (!state.account) state.account = { balance: 100000, initialBalance: 100000 };
        state.account.balance = amount;
        state.account.initialBalance = amount;
        updateDOM();
        queueSaveState();
        showNotice("UPDATED", `Starting cash updated to ${fmtUSD(amount)}`);
    }

    // Interactive Tour & "Describe Screen" engine (Viewport-Bounded & 6 Detailed Steps)
    const TOUR_STEPS = [
        {
            target: '#watchlist-search',
            title: '1. Watchlist & Live Symbols',
            desc: 'Search and select US stocks (AAPL, NVDA, TSLA) or Crypto (BTC) to switch active quotes and order book depth.'
        },
        {
            target: '#chart-panel',
            title: '2. Candlestick Price Chart',
            desc: 'Analyze live OHLC Candlesticks with timeframe range toggles (1D, 1M, 6M, 1Y) for multi-horizon trend analysis.'
        },
        {
            target: '#btn-show-depth',
            title: '3. Depth & Company Fundamentals',
            desc: 'Toggle Depth view to inspect Order Book Bids/Asks, 10-Q Quarterly Revenue/EPS, and SEC Balance Sheet ratios.'
        },
        {
            target: '#ticket-submit-btn',
            title: '4. Order Execution Ticket',
            desc: 'Execute Market orders, Limit orders, or Stop-loss triggers with real-time VWAP slippage estimation.'
        },
        {
            target: '#panel-positions',
            title: '5. Account Stats & Open Positions',
            desc: 'Monitor Cash, Net Equity, P&L, Open Positions, Resting Orders, and session Trade History in real time.'
        },
        {
            target: '#select-difficulty-tier',
            title: '6. Guidance Level & Cash Config',
            desc: 'Customize your guidance level (Beginner, Intermediate, Advanced) or reset/randomize starting cash balance anytime!'
        }
    ];

    let currentTourStep = 0;

    function startGuidedTour() {
        const tourCard = document.getElementById('tour-card');
        if (!tourCard) return;
        currentTourStep = 0;
        showTourStep(0);
    }

    function showTourStep(stepIdx) {
        const tourCard = document.getElementById('tour-card');
        if (!tourCard || stepIdx >= TOUR_STEPS.length) {
            if (tourCard) tourCard.classList.add('hidden');
            localStorage.setItem('tradepilot_tutorial_completed', 'true');
            return;
        }
        
        const step = TOUR_STEPS[stepIdx];
        const targetEl = document.querySelector(step.target);
        if (!targetEl) return;
        
        document.getElementById('tour-step-badge').textContent = `Step ${stepIdx + 1} of ${TOUR_STEPS.length}`;
        document.getElementById('tour-title').textContent = step.title;
        document.getElementById('tour-desc').textContent = step.desc;
        
        tourCard.classList.remove('hidden');
        
        const rect = targetEl.getBoundingClientRect();
        const cardWidth = 320;
        const cardHeight = 180;
        
        // Strict Viewport-Bounded positioning calculation
        let topPos = rect.bottom + 12;
        if (topPos + cardHeight > window.innerHeight - 20) {
            topPos = Math.max(70, rect.top - cardHeight - 12);
        }
        let leftPos = Math.max(20, Math.min(window.innerWidth - cardWidth - 20, rect.left));
        
        tourCard.style.position = 'fixed';
        tourCard.style.top = `${topPos}px`;
        tourCard.style.left = `${leftPos}px`;
        tourCard.style.zIndex = '9999';
    }

    function initTourEvents() {
        const describeBtn = document.getElementById('btn-describe-screen');
        const nextBtn = document.getElementById('tour-next-btn');
        const skipBtn = document.getElementById('tour-skip-btn');
        const closeBtn = document.getElementById('tour-close-btn');
        const tourCard = document.getElementById('tour-card');
        
        if (describeBtn) {
            describeBtn.addEventListener('click', () => startGuidedTour());
        }
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                currentTourStep++;
                if (currentTourStep < TOUR_STEPS.length) {
                    showTourStep(currentTourStep);
                } else {
                    if (tourCard) tourCard.classList.add('hidden');
                    localStorage.setItem('tradepilot_tutorial_completed', 'true');
                    showNotice("TUTORIAL", "Tour completed! You are ready to trade.");
                }
            });
        }
        if (skipBtn && tourCard) {
            skipBtn.addEventListener('click', () => {
                tourCard.classList.add('hidden');
                localStorage.setItem('tradepilot_tutorial_completed', 'true');
            });
        }
        if (closeBtn && tourCard) {
            closeBtn.addEventListener('click', () => {
                tourCard.classList.add('hidden');
                localStorage.setItem('tradepilot_tutorial_completed', 'true');
            });
        }
        
        // Auto-launch tour on first login
        const isCompleted = localStorage.getItem('tradepilot_tutorial_completed');
        if (!isCompleted) {
            setTimeout(() => startGuidedTour(), 1000);
        }
    }


    // --- Kickstart elements on load (guard: only init if terminal HTML is on this page) ---
    document.addEventListener('DOMContentLoaded', () => {
        if (!document.getElementById('apex-price-chart')) return; // not on this page
        window.cancelPaperOrder = cancelOrder; // Expose globally immediately
        loadSimulatorState();
        fetchRealTimePrices(); // Initial real-time fetch
        initNewFeatures();     // Initialize tour, modals, mode switcher, timeframes & tiers
        setInterval(tickSimulation, TICK_MS);
        setInterval(fetchRealTimePrices, 15000); // Poll real prices every 15s
    });

})();
