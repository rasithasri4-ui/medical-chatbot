/**
 * script.js — MedAssist Medical AI Chatbot
 *
 * Handles:
 *  - Gemini API integration via fetch()
 *  - Chat message rendering (user + AI)
 *  - Typing indicator, auto-scroll, timestamps
 *  - Sidebar toggle, quick topics, welcome cards
 *  - Session-based chat history
 *  - Emergency detection
 *  - Error handling & toast notifications
 *  - Character counter, send button state
 */

/* ─── WAIT FOR DOM ─────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {

  /* ─── ELEMENT REFERENCES ──────────────────────────────────────── */
  const userInput        = document.getElementById('userInput');
  const sendBtn          = document.getElementById('sendBtn');
  const messagesList     = document.getElementById('messagesList');
  const chatContainer    = document.getElementById('chatContainer');
  const typingIndicator  = document.getElementById('typingIndicator');
  const welcomeScreen    = document.getElementById('welcomeScreen');
  const newChatBtn       = document.getElementById('newChatBtn');
  const clearChatBtn     = document.getElementById('clearChatBtn');
  const sidebarToggle    = document.getElementById('sidebarToggle');
  const sidebar          = document.getElementById('sidebar');
  const charCounter      = document.getElementById('charCounter');
  const errorToast       = document.getElementById('errorToast');
  const toastMessage     = document.getElementById('toastMessage');
  const toastClose       = document.getElementById('toastClose');
  const disclaimerBanner = document.getElementById('disclaimerBanner');
  const dismissDisclaimer= document.getElementById('dismissDisclaimer');
  const topicChips       = document.querySelectorAll('.topic-chip');
  const welcomeCards     = document.querySelectorAll('.welcome-card');

  /* ─── STATE ───────────────────────────────────────────────────── */

  /**
   * conversationHistory stores messages for Gemini multi-turn context.
   * Each entry: { role: 'user'|'model', parts: [{ text: string }] }
   */
  let conversationHistory = [];

  /** Whether the AI is currently generating a response */
  let isGenerating = false;

  /** Toast auto-dismiss timeout reference */
  let toastTimeout = null;

  /** Mobile sidebar overlay element (created on demand) */
  let sidebarOverlay = null;

  /* ─── EMERGENCY KEYWORDS ──────────────────────────────────────── */
  const EMERGENCY_PATTERNS = [
    /chest\s*pain/i,
    /can'?t\s*breathe/i,
    /difficulty\s*breath/i,
    /heart\s*attack/i,
    /stroke/i,
    /unconscious/i,
    /not\s*breathing/i,
    /severe\s*bleed/i,
    /overdose/i,
    /suicid/i,
    /self.?harm/i,
    /seizure/i,
    /anaphyla/i,
    /choking/i,
    /severe\s*allerg/i,
    /coughing\s*blood/i,
    /vomiting\s*blood/i,
  ];

  /**
   * Checks whether a message contains potential emergency keywords.
   * @param {string} text
   * @returns {boolean}
   */
  function isEmergency(text) {
    return EMERGENCY_PATTERNS.some(pattern => pattern.test(text));
  }

  /* ─── UTILITY: TIMESTAMP ──────────────────────────────────────── */
  /**
   * Returns a human-readable time string (e.g. "9:42 AM").
   * @returns {string}
   */
  function getTimestamp() {
    return new Date().toLocaleTimeString([], {
      hour:   '2-digit',
      minute: '2-digit',
    });
  }

  /* ─── UTILITY: ESCAPE HTML ────────────────────────────────────── */
  /**
   * Escapes special HTML characters to prevent XSS.
   * @param {string} text
   * @returns {string}
   */
  function escapeHtml(text) {
    const map = {
      '&':  '&amp;',
      '<':  '&lt;',
      '>':  '&gt;',
      '"':  '&quot;',
      "'":  '&#039;',
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
  }

  /* ─── UTILITY: SIMPLE MARKDOWN RENDERER ──────────────────────── */
  /**
   * Converts a subset of Markdown to HTML:
   *   **bold**, *italic*, `code`, numbered/bulleted lists, line breaks.
   * @param {string} text
   * @returns {string}
   */
  function renderMarkdown(text) {
    // Escape HTML first to prevent XSS, then apply markdown.
    let html = escapeHtml(text);

    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Unordered lists (lines starting with - or •)
    html = html.replace(/^[\-•]\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, (match) => `<ul>${match}</ul>`);

    // Ordered lists (lines starting with 1. 2. etc.)
    html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');

    // Wrap consecutive <li> in <ol> if not already in <ul>
    // Simple approach: wrap multiple sequential <li> blocks
    html = html.replace(/(?<!<\/ul>)(<li>(?:(?!<\/li>).)*<\/li>(?:\n<li>(?:(?!<\/li>).)*<\/li>)*)/gs, (match) => {
      if (match.startsWith('<li>')) {
        return `<ol>${match}</ol>`;
      }
      return match;
    });

    // Paragraph / line breaks — split on double newlines
    const paragraphs = html.split(/\n{2,}/);
    if (paragraphs.length > 1) {
      html = paragraphs
        .map(p => p.trim())
        .filter(p => p.length > 0)
        .map(p => {
          if (p.startsWith('<ul>') || p.startsWith('<ol>') || p.startsWith('<li>')) {
            return p;
          }
          return `<p>${p.replace(/\n/g, '<br/>')}</p>`;
        })
        .join('');
    } else {
      html = html.replace(/\n/g, '<br/>');
    }

    return html;
  }

  /* ─── WELCOME SCREEN MANAGEMENT ──────────────────────────────── */
  /** Hides the welcome screen and reveals the messages list. */
  function hideWelcomeScreen() {
    if (welcomeScreen && !welcomeScreen.classList.contains('hidden')) {
      welcomeScreen.classList.add('hidden');
    }
  }

  /** Restores the welcome screen when the chat is cleared. */
  function showWelcomeScreen() {
    if (welcomeScreen) {
      welcomeScreen.classList.remove('hidden');
    }
  }

  /* ─── RENDER: APPEND MESSAGE ──────────────────────────────────── */
  /**
   * Creates and appends a message bubble to the chat.
   *
   * @param {'user'|'ai'} sender   - Who sent the message.
   * @param {string}      text     - Message content (may contain markdown for AI).
   * @param {boolean}     [isError=false] - Renders an error style for AI messages.
   * @param {boolean}     [emergency=false] - Appends an emergency notice.
   * @returns {HTMLElement} The root message element (for potential updates).
   */
  function appendMessage(sender, text, isError = false, emergency = false) {
    hideWelcomeScreen();

    const msg = document.createElement('div');
    msg.className = `message ${sender}${isError ? ' error' : ''}`;
    msg.setAttribute('role', 'listitem');

    // Avatar
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    if (sender === 'ai') {
      avatar.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect width="16" height="16" rx="5" fill="url(#msgGrad${Date.now()})"/>
          <path d="M8 3v10M3 8h10" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>
          <defs>
            <linearGradient id="msgGrad${Date.now()}" x1="0" y1="0" x2="16" y2="16">
              <stop stop-color="#3b82f6"/>
              <stop offset="1" stop-color="#06b6d4"/>
            </linearGradient>
          </defs>
        </svg>`;
    } else {
      avatar.textContent = 'You';
      avatar.style.fontSize = '0.65rem';
    }

    // Content wrapper
    const content = document.createElement('div');
    content.className = 'message-content';

    // Bubble
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    if (sender === 'ai') {
      bubble.innerHTML = renderMarkdown(text);

      // Emergency notice
      if (emergency) {
        const notice = document.createElement('div');
        notice.className = 'emergency-notice';
        notice.setAttribute('role', 'alert');
        notice.innerHTML = `
          <strong>🚨 Emergency Notice:</strong>&nbsp;
          If you or someone else is experiencing a medical emergency, please call
          <strong>911</strong> (or your local emergency number) immediately or go
          to the nearest emergency room. Do not delay seeking help.`;
        bubble.appendChild(notice);
      }
    } else {
      // User messages are plain text (already escaped inside renderMarkdown)
      bubble.textContent = text;
    }

    // Timestamp
    const timestamp = document.createElement('div');
    timestamp.className = 'message-timestamp';
    timestamp.setAttribute('aria-label', `Sent at ${getTimestamp()}`);
    timestamp.textContent = getTimestamp();

    content.appendChild(bubble);
    content.appendChild(timestamp);

    msg.appendChild(avatar);
    msg.appendChild(content);
    messagesList.appendChild(msg);

    scrollToBottom();
    return msg;
  }

  /* ─── SCROLL TO BOTTOM ────────────────────────────────────────── */
  /** Smoothly scrolls the chat container to the latest message. */
  function scrollToBottom() {
    requestAnimationFrame(() => {
      chatContainer.scrollTo({
        top:      chatContainer.scrollHeight,
        behavior: 'smooth',
      });
    });
  }

  /* ─── TYPING INDICATOR ────────────────────────────────────────── */
  function showTypingIndicator() {
    typingIndicator.style.display = 'flex';
    scrollToBottom();
  }

  function hideTypingIndicator() {
    typingIndicator.style.display = 'none';
  }

  /* ─── INPUT STATE MANAGEMENT ──────────────────────────────────── */
  /**
   * Enables/disables the input and send button.
   * @param {boolean} enabled
   */
  function setInputEnabled(enabled) {
    userInput.disabled = !enabled;
    sendBtn.disabled   = !enabled || userInput.value.trim() === '';
    if (enabled) userInput.focus();
  }

  /* ─── TOAST NOTIFICATIONS ─────────────────────────────────────── */
  /**
   * Shows an error toast with a given message.
   * Auto-dismisses after 5 seconds.
   * @param {string} message
   */
  function showToast(message) {
    toastMessage.textContent = message;
    errorToast.style.display = 'flex';
    errorToast.classList.remove('fade-out');

    // Clear any existing timeout
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => dismissToast(), 5000);
  }

  function dismissToast() {
    errorToast.classList.add('fade-out');
    setTimeout(() => {
      errorToast.style.display = 'none';
      errorToast.classList.remove('fade-out');
    }, 300);
  }

  /* ─── VALIDATE CONFIG ─────────────────────────────────────────── */
  /**
   * Checks that config.js was loaded and the API key has been set.
   * @returns {boolean}
   */
  function validateConfig() {
    if (typeof CONFIG === 'undefined') {
      showToast('Configuration error: config.js not found. Please check your setup.');
      return false;
    }
    if (
      !CONFIG.GEMINI_API_KEY ||
      CONFIG.GEMINI_API_KEY === 'YOUR_API_KEY_HERE' ||
      CONFIG.GEMINI_API_KEY.trim() === ''
    ) {
      appendMessage(
        'ai',
        '⚙️ **Setup Required**\n\n' +
        'To use MedAssist, you need to add your Gemini API key:\n\n' +
        '1. Open `config.js` in your project folder.\n' +
        '2. Replace `YOUR_API_KEY_HERE` with your actual key.\n' +
        '3. Get a free key at [Google AI Studio](https://aistudio.google.com/app/apikey).\n' +
        '4. Save the file and refresh this page.\n\n' +
        'Your key stays local — it is never sent anywhere except the Gemini API.',
        false,
        false
      );
      return false;
    }
    return true;
  }

  /* ─── GEMINI API CALL ─────────────────────────────────────────── */
  /**
   * Sends the conversation history to the Gemini API and returns the
   * generated text response.
   *
   * @param {string} userMessage - The latest message from the user.
   * @returns {Promise<string>}  - The AI's text response.
   */
  async function callGeminiAPI(userMessage) {
    const { GEMINI_API_KEY, GEMINI_MODEL, GEMINI_API_BASE_URL, SYSTEM_INSTRUCTION, MAX_TOKENS, TEMPERATURE } = CONFIG;

    const endpoint = `${GEMINI_API_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    // Build the request payload with full conversation history
    const requestBody = {
      system_instruction: {
        parts: [{ text: SYSTEM_INSTRUCTION }],
      },
      contents: conversationHistory,
      generationConfig: {
        maxOutputTokens: MAX_TOKENS,
        temperature:     TEMPERATURE,
        topP:            0.9,
        topK:            40,
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      ],
    };

    const response = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(requestBody),
    });

    // Handle HTTP-level errors
    if (!response.ok) {
      let errorMsg = `API error ${response.status}: ${response.statusText}`;
      try {
        const errBody = await response.json();
        if (errBody.error && errBody.error.message) {
          errorMsg = errBody.error.message;
        }
      } catch (_) { /* ignore JSON parse errors on error responses */ }

      // Provide user-friendly messages for common codes
      if (response.status === 400) throw new Error('Invalid request. Please check your API key and try again.');
      if (response.status === 401) throw new Error('Invalid API key. Please update your key in config.js.');
      if (response.status === 403) throw new Error('API access denied. Verify your API key permissions.');
      if (response.status === 429) throw new Error('Rate limit reached. Please wait a moment and try again.');
      if (response.status >= 500)  throw new Error('Gemini API server error. Please try again later.');

      throw new Error(errorMsg);
    }

    const data = await response.json();

    // Extract generated text from response
    const candidate = data?.candidates?.[0];
    if (!candidate) {
      throw new Error('No response generated. The content may have been filtered.');
    }

    // Check finish reason
    const finishReason = candidate.finishReason;
    if (finishReason === 'SAFETY') {
      throw new Error('Response was blocked for safety reasons. Please rephrase your question.');
    }
    if (finishReason === 'RECITATION') {
      throw new Error('Response blocked due to content policy. Please try a different question.');
    }

    const text = candidate?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Empty response received from the API. Please try again.');
    }

    return text;
  }

  /* ─── SEND MESSAGE ────────────────────────────────────────────── */
  /**
   * Main handler: reads user input, sends to Gemini, renders response.
   */
  async function sendMessage() {
    const text = userInput.value.trim();

    // Guard: no empty messages, no concurrent requests
    if (!text || isGenerating) return;

    // Validate API key / config
    if (!validateConfig()) return;

    // ── 1. Render user message ──
    appendMessage('user', text);

    // ── 2. Clear input ──
    userInput.value = '';
    autoResizeTextarea();
    updateCharCounter();
    setInputEnabled(false);

    // ── 3. Add to conversation history (for Gemini multi-turn) ──
    conversationHistory.push({
      role:  'user',
      parts: [{ text }],
    });

    // ── 4. Check for emergency keywords ──
    const emergency = isEmergency(text);

    // ── 5. Show typing indicator ──
    isGenerating = true;
    showTypingIndicator();

    try {
      // ── 6. Call Gemini API ──
      const aiResponse = await callGeminiAPI(text);

      // ── 7. Add AI response to history ──
      conversationHistory.push({
        role:  'model',
        parts: [{ text: aiResponse }],
      });

      // ── 8. Render AI response ──
      hideTypingIndicator();
      appendMessage('ai', aiResponse, false, emergency);

    } catch (error) {
      // ── 9. Handle errors ──
      hideTypingIndicator();

      const errorText =
        error.message ||
        'An unexpected error occurred. Please check your connection and try again.';

      appendMessage('ai', `❌ ${errorText}`, true, false);
      showToast(errorText);

      // Remove the user message from history since it didn't get a valid response
      conversationHistory.pop();

    } finally {
      isGenerating = false;
      setInputEnabled(true);
    }
  }

  /* ─── AUTO-RESIZE TEXTAREA ────────────────────────────────────── */
  /** Dynamically grows / shrinks the textarea based on content. */
  function autoResizeTextarea() {
    userInput.style.height = 'auto';
    const maxHeight = 140;
    userInput.style.height = Math.min(userInput.scrollHeight, maxHeight) + 'px';
  }

  /* ─── CHARACTER COUNTER ───────────────────────────────────────── */
  function updateCharCounter() {
    const len   = userInput.value.length;
    const max   = parseInt(userInput.getAttribute('maxlength'), 10) || 2000;
    const ratio = len / max;

    charCounter.textContent = `${len} / ${max}`;
    charCounter.classList.toggle('near-limit', ratio >= 0.8 && ratio < 1);
    charCounter.classList.toggle('at-limit',   ratio >= 1);

    sendBtn.disabled = len === 0 || isGenerating;
  }

  /* ─── CLEAR CHAT ──────────────────────────────────────────────── */
  function clearChat() {
    if (isGenerating) return;
    messagesList.innerHTML = '';
    conversationHistory    = [];
    showWelcomeScreen();
    userInput.value = '';
    autoResizeTextarea();
    updateCharCounter();
    userInput.focus();
  }

  /* ─── SIDEBAR TOGGLE ──────────────────────────────────────────── */
  function toggleSidebar() {
    const isMobile = window.innerWidth <= 640;

    if (isMobile) {
      // On mobile: absolute positioned sidebar with overlay
      sidebar.classList.toggle('open');
      if (sidebar.classList.contains('open')) {
        if (!sidebarOverlay) {
          sidebarOverlay = document.createElement('div');
          sidebarOverlay.className = 'sidebar-overlay';
          sidebarOverlay.addEventListener('click', () => closeSidebarMobile());
        }
        document.body.appendChild(sidebarOverlay);
      } else {
        closeSidebarMobile();
      }
    } else {
      // On desktop: collapse sidebar
      sidebar.classList.toggle('collapsed');
      sidebarToggle.setAttribute(
        'aria-expanded',
        (!sidebar.classList.contains('collapsed')).toString()
      );
    }
  }

  function closeSidebarMobile() {
    sidebar.classList.remove('open');
    if (sidebarOverlay && sidebarOverlay.parentNode) {
      document.body.removeChild(sidebarOverlay);
    }
  }

  /* ─── HANDLE QUICK TOPIC / WELCOME CARD CLICK ────────────────── */
  /**
   * Pre-fills the input with a suggested topic and sends it.
   * @param {string} topic
   */
  function handleTopicClick(topic) {
    if (isGenerating) return;
    userInput.value = topic;
    autoResizeTextarea();
    updateCharCounter();
    // On mobile, close sidebar first
    if (window.innerWidth <= 640) closeSidebarMobile();
    sendMessage();
  }

  /* ─── DISPLAY WELCOME MESSAGE ─────────────────────────────────── */
  /**
   * Appends the initial AI greeting message to the chat.
   * Called once on page load after DOM is ready.
   */
  function displayWelcomeMessage() {
    const greeting =
      `👋 **Welcome to MedAssist!** I'm your AI-powered health information companion.\n\n` +
      `I can help you with:\n` +
      `- General health questions & symptom information\n` +
      `- Wellness tips and preventive care\n` +
      `- Nutrition, fitness, and lifestyle guidance\n` +
      `- Understanding medical terms and conditions\n\n` +
      `**Please remember:** I provide general information only — always consult a qualified healthcare professional for personal medical advice, diagnosis, or treatment.\n\n` +
      `How can I help you today?`;

    appendMessage('ai', greeting);
  }

  /* ─── EVENT LISTENERS ─────────────────────────────────────────── */

  // Send on button click
  sendBtn.addEventListener('click', () => sendMessage());

  // Send on Enter (Shift+Enter = new line)
  userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize textarea & update char counter on input
  userInput.addEventListener('input', () => {
    autoResizeTextarea();
    updateCharCounter();
  });

  // Paste handling (auto-resize after paste)
  userInput.addEventListener('paste', () => {
    requestAnimationFrame(() => {
      autoResizeTextarea();
      updateCharCounter();
    });
  });

  // New chat button
  newChatBtn.addEventListener('click', () => {
    clearChat();
    // Close sidebar on mobile
    if (window.innerWidth <= 640) closeSidebarMobile();
  });

  // Clear chat button (topbar)
  clearChatBtn.addEventListener('click', () => {
    if (conversationHistory.length === 0 && messagesList.children.length === 0) return;
    if (window.confirm('Clear the current conversation? This cannot be undone.')) {
      clearChat();
    }
  });

  // Sidebar toggle
  sidebarToggle.addEventListener('click', () => toggleSidebar());

  // Quick topic chips (sidebar)
  topicChips.forEach(chip => {
    chip.addEventListener('click', () => {
      handleTopicClick(chip.dataset.topic);
    });
  });

  // Welcome cards
  welcomeCards.forEach(card => {
    card.addEventListener('click', () => {
      handleTopicClick(card.dataset.topic);
    });
  });

  // Dismiss disclaimer banner
  dismissDisclaimer.addEventListener('click', () => {
    disclaimerBanner.classList.add('hidden');
  });

  // Toast close button
  toastClose.addEventListener('click', () => dismissToast());

  // Handle window resize (sidebar behavior changes between mobile/desktop)
  window.addEventListener('resize', () => {
    if (window.innerWidth > 640) {
      // Remove mobile-specific classes when resizing to desktop
      sidebar.classList.remove('open');
      if (sidebarOverlay && sidebarOverlay.parentNode) {
        document.body.removeChild(sidebarOverlay);
      }
    }
  });

  /* ─── INITIALISE ──────────────────────────────────────────────── */

  // Focus input on load (desktop)
  if (window.innerWidth > 640) {
    userInput.focus();
  }

  // Initialise char counter
  updateCharCounter();

  // Display the AI welcome message
  displayWelcomeMessage();

});
