// Shared "AI Mentor" chat logic — used by the sidebar panel on every app page.
(function () {
  const CHAT_URL = '/api/chat';
  const HISTORY_URL = '/api/chat/history';

  document.addEventListener('DOMContentLoaded', async function () {
    const chatLog = document.getElementById('global-ai-chat-log');
    const input = document.getElementById('global-ai-chat-input');
    const sendBtn = document.getElementById('global-ai-chat-send');

    if (!chatLog || !input || !sendBtn) return; // panel not present on this page

    function addBubble(text, sender) {
      const bubble = document.createElement('div');
      bubble.className = sender === 'user'
        ? 'ml-6 bg-primary dark:bg-dark-primary text-white dark:text-primary text-xs p-3 rounded-xl'
        : 'mr-6 bg-surface-container-low dark:bg-dark-surface-container text-on-surface dark:text-dark-on-surface text-xs p-3 rounded-xl border border-outline-variant/20';
      bubble.style.whiteSpace = 'pre-wrap';
      bubble.textContent = text;
      chatLog.appendChild(bubble);
      chatLog.scrollTop = chatLog.scrollHeight;
      return bubble;
    }

    // Load this user's previous conversation, if any
    let hasHistory = false;
    try {
      const authHeader = window.TradePilotAuth ? window.TradePilotAuth.authHeader() : {};
      const res = await fetch(HISTORY_URL, { headers: authHeader });
      if (res.ok) {
        const data = await res.json();
        if (data.history && data.history.length > 0) {
          hasHistory = true;
          data.history.forEach((msg) => {
            addBubble(msg.content, msg.role === 'user' ? 'user' : 'ai');
          });
        }
      }
    } catch (err) {
      // Silently ignore — chat will just start fresh
    }

    if (!hasHistory) {
      addBubble("Hi! I'm your AI Mentor. Ask me anything about markets, terms, or what you're looking at on this page.", 'ai');
    }

    async function sendMessage(message) {
      if (!message || !message.trim()) return;
      addBubble(message, 'user');
      input.value = '';
      const loadingBubble = addBubble('Thinking...', 'ai');

      try {
        const authHeader = window.TradePilotAuth ? window.TradePilotAuth.authHeader() : {};
        const res = await fetch(CHAT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader },
          body: JSON.stringify({
            message: message,
            context: `User is currently on the "${document.title}" page of the TradePilot app.`
          })
        });
        const data = await res.json();
        loadingBubble.textContent = res.ok ? data.reply : `Error: ${data.error || 'Something went wrong.'}`;
      } catch (err) {
        loadingBubble.textContent = 'Could not reach the AI server. Make sure the local server is running (npm start).';
      }
    }

    sendBtn.addEventListener('click', () => sendMessage(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendMessage(input.value);
    });
  });
})();
