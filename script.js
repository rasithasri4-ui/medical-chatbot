/**
 * script.js — MedAssist Medical AI Chatbot
 *
 * Handles:
 * - Gemini API integration via fetch() [Vercel Secure Endpoint]
 * - Chat message rendering (user + AI)
 * - Typing indicator, auto-scroll, timestamps
 * - Sidebar toggle, quick topics, welcome cards
 * - Session-based chat history
 * - Emergency detection
 * - Error handling & toast notifications
 * - Character counter, send button state
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
  let conversationHistory = [];
  let isGenerating = false;
  let toastTimeout = null;
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

  function isEmergency(text) {
    return EMERGENCY_PATTERNS.some(pattern => pattern.test(text));
  }

  /* ─── UTILITY: TIMESTAMP ──────────────────────────────────────── */
  function getTimestamp() {
    return new Date().toLocaleTimeString([], {
      hour:   '2-digit',
      minute: '2-digit',
    });
  }

  /* ─── UTILITY: ESCAPE HTML ────────────────────────────────────── */
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
  function renderMarkdown(text) {
    let html = escapeHtml(text);
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/^[\-•]\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, (match) => `<ul>${match}</ul>`);
    html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/(?<!<\/ul>)(<li>(?:(?!<\/li>).)*<\/li>(?:\n<li>(?:(?!<\/li>).)*<\/li>)*)/gs, (match) => {
      if (match.startsWith('<li>')) return `<ol>${match}</ol>`;
      return match;
    });

    const paragraphs = html.split(/\n{2,}/);
    if (paragraphs.length > 1) {
      html = paragraphs
        .map(p => p.trim())
        .filter(p => p.length > 0)
        .map(p => {
          if (p.startsWith('<ul>') || p.startsWith('<ol>') || p.startsWith('<li>')) return p;
          return `<p>${p.replace(/\n/g, '<br/>')}</p>`;
        })
        .join('');
    } else {
      html = html.replace(/\n/g, '<br/>');
    }
    return html;
  }

  /* ─── WELCOME SCREEN MANAGEMENT ──────────────────────────────── */
  function hideWelcomeScreen() {
    if (welcomeScreen && !welcomeScreen.classList.contains('hidden')) {
      welcomeScreen.classList.add('hidden');
    }
  }

  function showWelcomeScreen() {
    if (welcomeScreen) welcomeScreen.classList.remove('hidden');
  }

  /* ─── RENDER: APPEND MESSAGE ──────────────────────────────────── */
  function appendMessage(sender, text, isError = false, emergency = false) {
    hideWelcomeScreen();

    const msg = document.createElement('div');
    msg.className = `message ${sender}${isError ? ' error' : ''}`;
    msg.setAttribute('role', 'listitem');

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

    const content = document.createElement('div');
    content.className = 'message-content';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    if (sender === 'ai') {
      bubble.innerHTML = renderMarkdown(text);
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
      bubble.textContent = text;
    }

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
  function scrollToBottom() {
    requestAnimationFrame(() => {
      chatContainer.scrollTo({
        top:       chatContainer.scrollHeight,
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
  function setInputEnabled(enabled) {
    userInput.disabled = !enabled;
    sendBtn.disabled   = !enabled || userInput.value.trim() === '';
    if (enabled) userInput.focus();
  }

  /* ─── TOAST NOTIFICATIONS ─────────────────────────────────────── */
  function showToast(message) {
    toastMessage.textContent = message;
    errorToast.style.display = 'flex';
    errorToast.classList.remove('fade-out');

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

  /* ─── VERCEL SECURE API CALL (NO EXPOSED KEY) ─────────────────── */
  async function callGeminiAPI(userMessage) {
    // Vercel backend api folder route-uku fetch request anupuroam
    const endpoint = '/api/chat';

    const response = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message: userMessage }),
    });

    if (!response.ok) {
      if (response.status === 500) {
        throw new Error('API Key missing in Vercel settings or Server error.');
      }
      throw new Error(`Server error: ${response.status}`);
    }

    const data = await response.json();
    const candidate = data?.candidates?.[0];
    if (!candidate) {
      throw new Error('No response generated. The content may have been filtered.');
    }

    const text = candidate?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Empty response received. Please try again.');
    }

    return text;
  }

  /* ─── SEND MESSAGE ────────────────────────────────────────────── */
  async function sendMessage() {
    const text = userInput.value.trim();

    if (!text || isGenerating) return;

    // 1. Render user message
    appendMessage('user', text);

    // 2. Clear input
    userInput.value = '';
    autoResizeTextarea();
    updateCharCounter();
    setInputEnabled(false);

    // 3. Add to conversation history
    conversationHistory.push({
      role:  'user',
      parts: [{ text }],
    });

    // 4. Check for emergency
    const emergency = isEmergency(text);

    // 5. Show typing indicator
    isGenerating = true;
    showTypingIndicator();

    try {
      // 6. Call secure Vercel API
      const aiResponse = await callGeminiAPI(text);

      // 7. Add AI response to history
      conversationHistory.push({
        role:  'model',
        parts: [{ text: aiResponse }],
      });

      // 8. Render AI response
      hideTypingIndicator();
      appendMessage('ai', aiResponse, false, emergency);

    } catch (error) {
      hideTypingIndicator();
      const errorText = error.message || 'An unexpected error occurred.';
      appendMessage('ai', `❌ ${errorText}`, true, false);
      showToast(errorText);
      conversationHistory.pop();
    } finally {
      isGenerating = false;
      setInputEnabled(true);
    }
  }

  /* ─── AUTO-RESIZE TEXTAREA ────────────────────────────────────── */
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
      sidebar.classList.toggle('collapsed');
      sidebarToggle.setAttribute('aria-expanded', (!sidebar.classList.contains('collapsed')).toString());
    }
  }

  function closeSidebarMobile() {
    sidebar.classList.remove('open');
    if (sidebarOverlay && sidebarOverlay.parentNode) {
      document.body.removeChild(sidebarOverlay);
    }
  }

  /* ─── HANDLE QUICK TOPIC CLICK ────────────────────────────────── */
  function handleTopicClick(topic) {
    if (isGenerating) return;
    userInput.value = topic;
    autoResizeTextarea();
    updateCharCounter();
    if (window.innerWidth <= 640) closeSidebarMobile();
    sendMessage();
  }

  /* ─── DISPLAY WELCOME MESSAGE ─────────────────────────────────── */
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
  sendBtn.addEventListener('click', () => sendMessage());

  userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  userInput.addEventListener('input', () => {
    autoResizeTextarea();
    updateCharCounter();
  });

  userInput.addEventListener('paste', () => {
    requestAnimationFrame(() => {
      autoResizeTextarea();
      updateCharCounter();
    });
  });

  newChatBtn.addEventListener('click', () => {
    clearChat();
    if (window.innerWidth <= 640) closeSidebarMobile();
  });

  clearChatBtn.addEventListener('click', () => {
    if (conversationHistory.length === 0 && messagesList.children.length === 0) return;
    if (window.confirm('Clear the current conversation? This cannot be undone.')) {
      clearChat();
    }
  });

  sidebarToggle.addEventListener('click', () => toggleSidebar());

  topicChips.forEach(chip => {
    chip.addEventListener('click', () => {
      handleTopicClick(chip.dataset.topic);
    });
  });

  welcomeCards.forEach(card => {
    card.addEventListener('click', () => {
      handleTopicClick(card.dataset.topic);
    });
  });

  dismissDisclaimer.addEventListener('click', () => {
    disclaimerBanner.classList.add('hidden');
  });

  toastClose.addEventListener('click', () => dismissToast());

  window.addEventListener('resize', () => {
    if (window.innerWidth > 640) {
      sidebar.classList.remove('open');
      if (sidebarOverlay && sidebarOverlay.parentNode) {
        document.body.removeChild(sidebarOverlay);
      }
    }
  });

  /* ─── INITIALISE ──────────────────────────────────────────────── */
  if (window.innerWidth > 640) {
    userInput.focus();
  }
  updateCharCounter();
  displayWelcomeMessage();
});
