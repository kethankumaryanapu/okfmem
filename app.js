/**
 * OKFMem - AI Chatbot Interface with Smart Long-Term Memory
 */

// Toast helper
let toastTimeout = null;

function triggerToast(message) {
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toast-message');
  if (!toast || !toastMessage) return;

  toastMessage.textContent = message;
  toast.classList.add('show');

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 2400);
}

/* ==========================================================================
   State Management: Chat History & Memories
   ========================================================================== */

let activeChatId = null;

let chatHistory = [
  {
    id: "chat-1",
    group: "Today",
    title: "Python discussion",
    time: "10:42 AM",
    pinned: true,
    messages: [
      { sender: "user", text: "How do I structure an async Python project?", time: "10:40 AM" },
      { sender: "assistant", text: "Use async/await syntax with asyncio event loops. OKFMem remembers your Python project preferences.", time: "10:42 AM", memoryPill: "Applied Memory: Learning Python" }
    ]
  },
  {
    id: "chat-2",
    group: "Today",
    title: "AI project discussion",
    time: "09:15 AM",
    pinned: false,
    messages: [
      { sender: "user", text: "What are some practical AI memory management ideas?", time: "09:14 AM" },
      { sender: "assistant", text: "OKFMem provides long-term context tracking with privacy-aware memory processing.", time: "09:15 AM", memoryPill: "Applied Memory: AI Project" }
    ]
  },
  {
    id: "chat-3",
    group: "Yesterday",
    title: "Data Science questions",
    time: "Yesterday 4:30 PM",
    pinned: false,
    messages: [
      { sender: "user", text: "Which libraries work best for high performance data processing?", time: "Yesterday 4:28 PM" },
      { sender: "assistant", text: "A Pandas and Polars combination offers fast data wrangling capabilities.", time: "Yesterday 4:30 PM" }
    ]
  },
  {
    id: "chat-4",
    group: "Yesterday",
    title: "Machine Learning discussion",
    time: "Yesterday 11:20 AM",
    pinned: false,
    messages: [
      { sender: "user", text: "Which models work best for real-time text classification?", time: "Yesterday 11:18 AM" },
      { sender: "assistant", text: "Transformer embeddings combined with long-term memory yield top results.", time: "Yesterday 11:20 AM" }
    ]
  }
];

let activeMemoryId = "M001";
let activeMemoryFilter = "All";

let memories = [];

/* ==========================================================================
   Navigation Drawers & Modals Toggle
   ========================================================================== */

function toggleHistoryDrawer() {
  const drawer = document.getElementById('history-drawer');
  const overlay = document.getElementById('history-overlay');
  if (!drawer || !overlay) return;

  const isOpen = drawer.classList.contains('open');
  if (isOpen) {
    closeHistoryDrawer();
  } else {
    closeMemoryDrawer();
    renderHistoryList();
    drawer.classList.add('open');
    overlay.classList.add('open');
  }
}

function closeHistoryDrawer() {
  const drawer = document.getElementById('history-drawer');
  const overlay = document.getElementById('history-overlay');
  if (drawer) drawer.classList.remove('open');
  if (overlay) overlay.classList.remove('open');
}

function toggleMemoryDrawer() {
  const drawer = document.getElementById('memory-drawer');
  const overlay = document.getElementById('drawer-overlay');
  const badge = document.getElementById('btn-memory-drawer');

  if (!drawer || !overlay) return;

  const isOpen = drawer.classList.contains('open');
  if (isOpen) {
    closeMemoryDrawer();
  } else {
    closeHistoryDrawer();
    renderMemoryList();
    drawer.classList.add('open');
    overlay.classList.add('open');
    if (badge) badge.classList.add('active');
  }
}

function closeMemoryDrawer() {
  const drawer = document.getElementById('memory-drawer');
  const overlay = document.getElementById('drawer-overlay');
  const badge = document.getElementById('btn-memory-drawer');
  if (drawer) drawer.classList.remove('open');
  if (overlay) overlay.classList.remove('open');
  if (badge) badge.classList.remove('active');
}

/* ==========================================================================
   Chat History Logic (Separate from Memories)
   ========================================================================== */

function startNewChat() {
  activeChatId = null;
  const container = document.getElementById('messages-container');
  if (container) container.innerHTML = '';

  const welcome = document.getElementById('welcome-state');
  if (welcome) welcome.style.display = 'flex';

  closeHistoryDrawer();
  triggerToast('New chat thread started');
}

function renderHistoryList() {
  const container = document.getElementById('history-list-container');
  const searchInput = document.getElementById('history-search-input');
  if (!container) return;

  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

  let filtered = chatHistory.filter(c => c.title.toLowerCase().includes(query));

  if (filtered.length === 0) {
    container.innerHTML = `<div style="padding: 24px 16px; text-align: center; color: var(--text-muted); font-size: 13px;">No conversations found.</div>`;
    return;
  }

  const pinnedList = filtered.filter(c => c.pinned);
  const unpinnedList = filtered.filter(c => !c.pinned);

  const groups = ["Today", "Yesterday", "Earlier"];
  let html = '';

  if (pinnedList.length > 0) {
    html += `<div class="history-section-header">Pinned</div>`;
    pinnedList.forEach(chat => {
      html += createHistoryCardHtml(chat);
    });
  }

  groups.forEach(groupName => {
    const groupChats = unpinnedList.filter(c => c.group === groupName);
    if (groupChats.length > 0) {
      html += `<div class="history-section-header">${groupName}</div>`;
      groupChats.forEach(chat => {
        html += createHistoryCardHtml(chat);
      });
    }
  });

  container.innerHTML = html;
}

function createHistoryCardHtml(chat) {
  const isActive = activeChatId === chat.id ? 'active' : '';
  const isPinned = chat.pinned ? 'pinned' : '';

  return `
    <div class="history-card ${isActive}" onclick="loadConversation('${chat.id}')">
      <div class="history-card-info">
        <div class="history-card-title">${escapeHtml(chat.title)}</div>
        <div class="history-card-time">${chat.time}</div>
      </div>
      <div class="history-card-actions" onclick="event.stopPropagation()">
        <button class="action-icon-btn ${isPinned}" onclick="pinConversation('${chat.id}', event)" title="${chat.pinned ? 'Unpin' : 'Pin'}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14l-1.5-6h-11L5 17z"></path><path d="M9 11V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v7"></path></svg>
        </button>
        <button class="action-icon-btn" onclick="deleteConversation('${chat.id}', event)" title="Delete Conversation">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    </div>
  `;
}

function loadConversation(chatId) {
  const chat = chatHistory.find(c => c.id === chatId);
  if (!chat) return;

  activeChatId = chatId;
  const welcome = document.getElementById('welcome-state');
  if (welcome) welcome.style.display = 'none';

  const container = document.getElementById('messages-container');
  if (!container) return;

  container.innerHTML = '';

  chat.messages.forEach(msg => {
    if (msg.sender === 'user') {
      renderUserMessage(msg.text, msg.time);
    } else {
      renderAssistantMessage(msg.text, msg.time, msg.meta || msg.memoryPill);
    }
  });

  closeHistoryDrawer();
  scrollToBottom();
}

function pinConversation(chatId, e) {
  if (e && e.stopPropagation) e.stopPropagation();
  const chat = chatHistory.find(c => c.id === chatId);
  if (chat) {
    chat.pinned = !chat.pinned;
    renderHistoryList();
    triggerToast(chat.pinned ? 'Conversation pinned' : 'Conversation unpinned');
  }
}

function deleteConversation(chatId, e) {
  if (e && e.stopPropagation) e.stopPropagation();
  chatHistory = chatHistory.filter(c => c.id !== chatId);
  if (activeChatId === chatId) {
    startNewChat();
  }
  renderHistoryList();
  triggerToast('Conversation deleted');
}

/* ==========================================================================
   Memory Management Logic (Minimal Cards Interface)
   ========================================================================== */

function setMemoryFilter(category, btnEl) {
  activeMemoryFilter = category;
  const pills = document.querySelectorAll('.filter-pill');
  pills.forEach(p => p.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');

  renderMemoryList();
}

function renderMemoryList() {
  const container = document.getElementById('drawer-memory-list');
  const searchInput = document.getElementById('memory-search-input');
  const badgeCount = document.getElementById('memory-badge-count');

  if (badgeCount) badgeCount.textContent = memories.length;

  if (!container) return;

  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

  let filtered = memories.filter(m => {
    const matchesCat = activeMemoryFilter === "All" || (m.category || '').toLowerCase() === activeMemoryFilter.toLowerCase();
    const matchesQuery = (m.title || '').toLowerCase().includes(query) ||
                         (m.fact || '').toLowerCase().includes(query) ||
                         (m.category || '').toLowerCase().includes(query);
    return matchesCat && matchesQuery;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div style="padding: 24px 16px; text-align: center; color: var(--text-muted); font-size: 13px;">No memory records found.</div>`;
    return;
  }

  let html = '';
  filtered.forEach(m => {
    const isProtected = m.privacy.toLowerCase() === 'protected';
    const badgeClass = isProtected ? 'state-permission' : 'state-safe';

    html += `
      <div class="drawer-memory-card">
        <div class="drawer-card-top">
          <span class="drawer-card-title" style="margin-bottom: 0; font-size: 14px;">${escapeHtml(m.title)}</span>
          <span class="privacy-badge ${badgeClass}">${m.privacy}</span>
        </div>
        <div style="font-size: 13px; color: var(--text-primary); margin: 6px 0 8px;">${escapeHtml(m.fact)}</div>
        <div style="font-size: 11px; color: var(--text-secondary); display: flex; justify-content: space-between; align-items: center;">
          <span>Category: <strong style="color: var(--text-primary);">${m.category}</strong></span>
        </div>
        <div class="memory-card-actions">
          <button class="btn btn-secondary btn-xs" onclick="openMemoryDetailById('${m.id}')">View Details</button>
          <button class="btn btn-ghost btn-xs" onclick="openOKFViewerForMemoryId('${m.id}')">View OKF</button>
          <button class="btn btn-ghost btn-xs btn-danger-ghost" style="margin-left: auto;" onclick="deleteMemoryById('${m.id}')" title="Delete Memory">Delete</button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function openMemoryDetailById(id) {
  const m = memories.find(item => item.id === id);
  if (!m) return;

  activeMemoryId = id;
  const modal = document.getElementById('memory-modal');
  if (!modal) return;

  const factEl = document.getElementById('detail-fact');
  if (factEl) factEl.textContent = m.fact;

  const catEl = document.getElementById('detail-category');
  if (catEl) catEl.textContent = m.category;

  const impEl = document.getElementById('detail-importance');
  if (impEl) impEl.textContent = m.importance;

  const confEl = document.getElementById('detail-confidence');
  if (confEl) confEl.textContent = typeof m.confidence === 'number' ? `${m.confidence}%` : (m.confidence || '');

  const privEl = document.getElementById('detail-privacy');
  if (privEl) {
    const isProtected = m.privacy.toLowerCase() === 'protected';
    const badgeClass = isProtected ? 'state-permission' : 'state-safe';
    privEl.innerHTML = `<span class="privacy-badge ${badgeClass}">${m.privacy}</span>`;
  }

  const srcEl = document.getElementById('detail-source');
  if (srcEl) srcEl.textContent = m.source || 'Conversation';

  const createdEl = document.getElementById('detail-created');
  if (createdEl) createdEl.textContent = m.created || '24 Aug 2026';

  modal.classList.add('open');
}

function closeMemoryModal(e) {
  if (e && e.stopPropagation) e.stopPropagation();
  const modal = document.getElementById('memory-modal');
  if (modal) modal.classList.remove('open');
}

async function deleteMemoryById(id) {
  try {
    const response = await fetch(`http://localhost:5000/api/memories/${id}`, {
      method: 'DELETE'
    });
    const data = await response.json();
    if (response.ok && data.success) {
      memories = memories.filter(m => m.id !== id);
      renderMemoryList();
      triggerToast('Memory deleted');
    } else {
      triggerToast(data.error || 'Failed to delete memory');
    }
  } catch (err) {
    console.error('Error deleting memory:', err);
    triggerToast('Error connecting to server');
  }
}

function deleteActiveMemory() {
  deleteMemoryById(activeMemoryId);
  closeMemoryModal();
}

/* OKF Representation Viewer */
async function openOKFViewerForMemoryId(id) {
  activeMemoryId = id;
  const m = memories.find(item => item.id === id) || memories[0];
  const okfCode = document.getElementById('okf-json-code');

  if (okfCode && m) {
    const slug = (m.title || "python").toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'python';
    const filename = `${slug}.md`;

    try {
      const response = await fetch(`http://localhost:5000/api/okf/memories/${filename}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: Failed to fetch OKF document`);
      }
      const markdownText = await response.text();
      okfCode.textContent = markdownText;
    } catch (error) {
      console.warn('Backend OKF file fetch fallback triggered for:', filename);
      const conceptType = `User ${m.category || 'Skill'}`;
      const title = m.title || 'Untitled Memory';
      const fact = m.fact || '';
      const tagSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const catSlug = (m.category || 'skill').toLowerCase();
      
      const fallbackMarkdown = `---
type: ${conceptType}
title: ${title}
description: ${fact}
tags:
  - ${tagSlug}
  - ${catSlug}
---

# ${title}

${fact}`;

      okfCode.textContent = fallbackMarkdown;
    }
  }

  closeMemoryModal();
  const okfModal = document.getElementById('okf-modal');
  if (okfModal) okfModal.classList.add('open');
}

function openOKFViewerForActiveMemory() {
  openOKFViewerForMemoryId(activeMemoryId);
}

function closeOKFModal(e) {
  if (e && e.stopPropagation) e.stopPropagation();
  const okfModal = document.getElementById('okf-modal');
  if (okfModal) okfModal.classList.remove('open');
}

function copyOKFJson() {
  const code = document.getElementById('okf-json-code');
  if (code) {
    navigator.clipboard.writeText(code.textContent);
    triggerToast('OKF content copied to clipboard');
  }
}

/* Export OKF Knowledge Bundle */
async function exportOKFBundle() {
  try {
    const response = await fetch('http://localhost:5000/api/okf/export');
    if (!response.ok) {
      throw new Error(`HTTP error status: ${response.status}`);
    }
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = 'okfmem-user-memory.zip';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    triggerToast('OKF Memory bundle exported');
  } catch (error) {
    console.error('Failed to export OKF bundle:', error);
    triggerToast('Export failed');
  }
}

/* Settings State & Management */
let userSettings = {
  memoryEnabled: true,
  autoSaveMemories: true,
  allowedCategories: ["Skill", "Preference", "Project", "Fact", "General"],
  privacyMode: "Protected"
};

async function fetchSettings() {
  try {
    const res = await fetch('http://localhost:5000/api/settings');
    const data = await res.json();
    if (data && data.success && data.settings) {
      userSettings = data.settings;
      syncSettingsUI();
    }
  } catch (err) {
    console.error('Failed to fetch settings from backend:', err);
  }
}

function syncSettingsUI() {
  const memEn = document.getElementById('setting-memory-enabled');
  const autoSave = document.getElementById('setting-autosave-memories');
  const privMode = document.getElementById('setting-privacy-mode');

  if (memEn) memEn.checked = userSettings.memoryEnabled !== false;
  if (autoSave) autoSave.checked = userSettings.autoSaveMemories !== false;
  if (privMode) privMode.value = userSettings.privacyMode || 'Protected';

  const cats = (userSettings.allowedCategories || []).map(c => String(c).toLowerCase());
  ['skill', 'preference', 'project', 'fact', 'general'].forEach(cat => {
    const el = document.getElementById(`cat-${cat}`);
    if (el) el.checked = cats.includes(cat);
  });
}

async function updateUserSettingsFromUI() {
  const allowedCategories = [];
  ['skill', 'preference', 'project', 'fact', 'general'].forEach(cat => {
    const el = document.getElementById(`cat-${cat}`);
    if (el && el.checked) {
      allowedCategories.push(cat.charAt(0).toUpperCase() + cat.slice(1));
    }
  });

  userSettings = {
    memoryEnabled: document.getElementById('setting-memory-enabled')?.checked ?? true,
    autoSaveMemories: document.getElementById('setting-autosave-memories')?.checked ?? true,
    privacyMode: document.getElementById('setting-privacy-mode')?.value ?? 'Protected',
    allowedCategories: allowedCategories
  };

  try {
    const res = await fetch('http://localhost:5000/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userSettings)
    });
    const data = await res.json();
    if (data && data.success) {
      triggerToast('Settings updated');
    }
  } catch (err) {
    console.error('Failed to save settings to backend:', err);
    triggerToast('Failed to save settings');
  }
}

/* Settings Modal */
function openSettingsModal() {
  syncSettingsUI();
  const modal = document.getElementById('settings-modal');
  if (modal) modal.classList.add('open');
}

function closeSettingsModal(e) {
  if (e && e.stopPropagation) e.stopPropagation();
  const modal = document.getElementById('settings-modal');
  if (modal) modal.classList.remove('open');
}

function switchSettingsTab(tabId, navBtn) {
  const navItems = document.querySelectorAll('.settings-nav-item');
  navItems.forEach(item => item.classList.remove('active'));
  if (navBtn) navBtn.classList.add('active');

  const panels = document.querySelectorAll('.settings-panel');
  panels.forEach(p => p.classList.remove('active'));

  const targetPanel = document.getElementById('tab-' + tabId);
  if (targetPanel) targetPanel.classList.add('active');
}

/* ==========================================================================
   Theme Management (Light / White Theme vs Dark Theme)
   ========================================================================== */
function setTheme(themeName) {
  const html = document.documentElement;
  const isLight = themeName === 'light';
  html.setAttribute('data-theme', isLight ? 'light' : 'dark');
  localStorage.setItem('okfmem_theme', isLight ? 'light' : 'dark');
  
  const selector = document.getElementById('theme-selector');
  if (selector) selector.value = isLight ? 'light' : 'dark';
  
  const badge = document.getElementById('theme-active-badge');
  if (badge) {
    badge.textContent = isLight ? 'White Theme Active' : 'Dark Theme Active';
  }

  triggerToast(isLight ? 'Switched to White Theme' : 'Switched to Dark Theme');
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  setTheme(current === 'light' ? 'dark' : 'light');
}

function initTheme() {
  const savedTheme = localStorage.getItem('okfmem_theme') || 'dark';
  const html = document.documentElement;
  html.setAttribute('data-theme', savedTheme);
  const selector = document.getElementById('theme-selector');
  if (selector) selector.value = savedTheme;
}

// Run initTheme on load
initTheme();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTheme);
} else {
  initTheme();
}


/* ==========================================================================
   Chat Interactions (Teach New Fact & Recall Profile)
   ========================================================================== */

function teachNewFact() {
  const input = document.getElementById('prompt-input');
  if (input) {
    input.value = "I am currently learning Python and asynchronous programming.";
    input.focus();
    autoResizePromptInput();
    triggerToast("Sample fact loaded in prompt field");
  }
}

function sendSuggestedPrompt(text) {
  const input = document.getElementById('prompt-input');
  if (input) {
    input.value = text;
    autoResizePromptInput();
    submitMessage();
  }
}

function autoResizePromptInput() {
  const input = document.getElementById('prompt-input');
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 140) + 'px';
}

function handleKeyDown(e) {
  autoResizePromptInput();
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitMessage();
  }
}

function submitMessage() {
  const input = document.getElementById('prompt-input');
  if (!input) return;

  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  input.style.height = 'auto';

  const welcome = document.getElementById('welcome-state');
  if (welcome) welcome.style.display = 'none';

  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (!activeChatId) {
    activeChatId = "chat-" + Date.now();
    chatHistory.unshift({
      id: activeChatId,
      group: "Today",
      title: text.length > 28 ? text.substring(0, 28) + '...' : text,
      time: timeStr,
      pinned: false,
      messages: []
    });
  }

  const currentChat = chatHistory.find(c => c.id === activeChatId);
  if (currentChat) {
    currentChat.messages.push({ sender: 'user', text: text, time: timeStr });
  }

  renderUserMessage(text, timeStr);

  const loader = document.getElementById('typing-indicator');
  if (loader) loader.style.display = 'flex';

  scrollToBottom();

  generateAIResponse(text, currentChat);
}

function renderUserMessage(text, timeStr = '') {
  const container = document.getElementById('messages-container');
  if (!container) return;

  const t = timeStr || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const msgDiv = document.createElement('div');
  msgDiv.className = 'chat-message-row msg-user';
  msgDiv.innerHTML = `
    <div class="msg-header">
      <span>You</span> • <span>${t}</span>
    </div>
    <div class="msg-bubble">${escapeHtml(text)}</div>
  `;

  container.appendChild(msgDiv);
}

async function generateAIResponse(userText, currentChatObj) {
  const container = document.getElementById('messages-container');
  if (!container) return;

  const loader = document.getElementById('typing-indicator');
  if (loader) loader.style.display = 'flex';
  scrollToBottom();

  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  let responseText = "";
  let metaInfo = { provider: null, memories: [] };

  try {
    const allPriorMessages = (currentChatObj && Array.isArray(currentChatObj.messages))
      ? currentChatObj.messages.slice(0, -1)
      : [];
    const recentHistory = allPriorMessages
      .filter(m => m && m.text && !m.text.startsWith('Error:'))
      .slice(-6)
      .map(m => ({
        role: m.sender === 'assistant' ? 'model' : 'user',
        text: m.text
      }));

    const res = await fetch('http://localhost:5000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: userText,
        history: recentHistory
      })
    });

    const data = await res.json();
    if (res.ok && data.success && data.response) {
      responseText = data.response;
      
      if (data.provider) {
        metaInfo.provider = data.provider;
      }

      const memoryTitles = new Set();

      // Task 15.4 & Task 2B Explainable Memory Retrieval: Preserve complete used_memories with explanation
      if (Array.isArray(data.used_memories) && data.used_memories.length > 0) {
        data.used_memories.forEach(m => {
          if (m && m.title) memoryTitles.add(m.title);
        });
      }

      metaInfo.memories = Array.from(memoryTitles);
      metaInfo.used_memories = Array.isArray(data.used_memories) ? data.used_memories : [];

      if (Array.isArray(data.extracted_memories) && data.extracted_memories.length > 0) {
        await fetchMemories();
        const titles = data.extracted_memories.map(m => m.title).join(', ');
        triggerToast(`Memory extracted: ${titles}`);
      } else {
        await fetchMemories();
      }
    } else {
      responseText = `Error: ${data.error || 'Failed to process chat message'}`;
    }
  } catch (err) {
    responseText = "Error: Unable to connect to backend MemPrivacy chat pipeline.";
  } finally {
    if (loader) loader.style.display = 'none';
  }

  if (currentChatObj) {
    currentChatObj.messages.push({
      sender: 'assistant',
      text: responseText,
      time: timeStr,
      meta: metaInfo
    });
  }

  renderAssistantMessage(responseText, timeStr, metaInfo);
  scrollToBottom();
}

function renderAssistantMessage(responseText, timeStr, metaOrPill) {
  const container = document.getElementById('messages-container');
  if (!container) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = 'chat-message-row msg-assistant';
  
  let providerPillHtml = '';
  let memoryPillsHtml = '';

  if (metaOrPill) {
    if (typeof metaOrPill === 'string') {
      const cleanLabel = metaOrPill.startsWith('Memory used: ') ? metaOrPill : `Memory used: ${metaOrPill}`;
      memoryPillsHtml = `
        <span class="memory-pill-inline" onclick="toggleMemoryDrawer()">
          <span class="memory-pill-dot"></span>
          <span>${escapeHtml(cleanLabel)}</span>
        </span>
      `;
    } else if (typeof metaOrPill === 'object') {
      if (metaOrPill.provider) {
        const provRaw = String(metaOrPill.provider).toLowerCase();
        let provLabel = provRaw;
        if (provRaw === 'gemini') provLabel = 'Gemini';
        else if (provRaw === 'offline') provLabel = 'Offline';
        else if (provRaw === 'openai') provLabel = 'OpenAI';
        else provLabel = provRaw.charAt(0).toUpperCase() + provRaw.slice(1);

        providerPillHtml = `
          <span class="memory-pill-inline" style="cursor: default;">
            <span class="memory-pill-dot" style="background: var(--teal, #00b4d8); box-shadow: 0 0 6px var(--teal, #00b4d8);"></span>
            <span>Provider: ${escapeHtml(provLabel)}</span>
          </span>
        `;
      }

      // Task 2B Explainable Memory Retrieval: Render interactive popovers if used_memories available
      const usedMemoriesList = (Array.isArray(metaOrPill.used_memories) && metaOrPill.used_memories.length > 0)
        ? metaOrPill.used_memories
        : null;

      const mems = Array.isArray(metaOrPill.memories) ? metaOrPill.memories : (metaOrPill.memoryPill ? [metaOrPill.memoryPill] : []);

      if (usedMemoriesList) {
        memoryPillsHtml = usedMemoriesList.map((m, idx) => {
          const title = m.title || 'Untitled Memory';
          const cleanTitle = title.startsWith('Memory used: ') ? title : `Memory used: ${title}`;
          const exp = m.retrieval_explanation;

          // Legacy or fallback if no retrieval_explanation
          if (!exp) {
            return `
              <span class="memory-pill-inline" onclick="toggleMemoryDrawer()" title="Retrieved & applied to response">
                <span class="memory-pill-dot"></span>
                <span>${escapeHtml(cleanTitle)}</span>
              </span>
            `;
          }

          const scoreVal = typeof exp.score === 'number' ? exp.score.toFixed(1) : (exp.score || '1.0');
          const rankVal = exp.rank || (idx + 1);
          const categoryVal = m.category || 'General';
          const matchedTerms = Array.isArray(exp.matched_terms) ? exp.matched_terms : [];
          const matchedFields = Array.isArray(exp.matched_fields) ? exp.matched_fields : [];
          const breakdown = exp.score_breakdown || { keyword: 1.0, importance: 0.1, mention: 0.0 };
          const reasonText = exp.reason || `Matched keywords in ${categoryVal} memory.`;

          const termsHtml = matchedTerms.length > 0
            ? matchedTerms.map(t => `<span class="retrieval-tag">${escapeHtml(t)}</span>`).join('')
            : '<span class="retrieval-tag" style="opacity: 0.6;">Relevant query terms</span>';

          const fieldsHtml = matchedFields.length > 0
            ? matchedFields.map(f => `<span class="retrieval-tag retrieval-tag-field">${escapeHtml(f.charAt(0).toUpperCase() + f.slice(1))}</span>`).join('')
            : '<span class="retrieval-tag retrieval-tag-field">Content</span>';

          const kwScore = typeof breakdown.keyword === 'number' ? breakdown.keyword.toFixed(1) : '1.0';
          const impScore = typeof breakdown.importance === 'number' ? breakdown.importance.toFixed(1) : '0.1';
          const menScore = typeof breakdown.mention === 'number' ? breakdown.mention.toFixed(1) : '0.0';

          return `
            <div class="retrieval-pill-container">
              <button type="button" class="memory-pill-inline memory-pill-explainable" onclick="toggleRetrievalExplanation(this, event)" title="Click to see why this memory was used" aria-expanded="false">
                <span class="memory-pill-dot"></span>
                <span>${escapeHtml(cleanTitle)}</span>
                <span class="pill-explain-badge">Why?</span>
              </button>
              <div class="retrieval-explanation-popover" onclick="event.stopPropagation()">
                <div class="retrieval-popover-header">
                  <div class="retrieval-popover-title">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                    <span>Why was this memory used?</span>
                  </div>
                  <button type="button" class="btn btn-icon btn-xs" onclick="closeAllRetrievalPopovers()" title="Close explanation" style="padding: 2px;">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                  </button>
                </div>

                <div class="retrieval-mem-header">
                  <div class="retrieval-mem-title">${escapeHtml(title)}</div>
                  <span class="retrieval-category-badge">${escapeHtml(categoryVal)}</span>
                </div>

                <div class="retrieval-metrics-row">
                  <div class="retrieval-metric">
                    <span class="metric-label">Relevance Score</span>
                    <span class="metric-value score-highlight">${escapeHtml(scoreVal)}</span>
                  </div>
                  <div class="retrieval-metric">
                    <span class="metric-label">Retrieval Rank</span>
                    <span class="metric-value rank-highlight">#${escapeHtml(String(rankVal))}</span>
                  </div>
                </div>

                <div class="retrieval-section">
                  <div class="retrieval-section-label">Matched terms</div>
                  <div class="retrieval-tags-list">
                    ${termsHtml}
                  </div>
                </div>

                <div class="retrieval-section">
                  <div class="retrieval-section-label">Matched fields</div>
                  <div class="retrieval-tags-list">
                    ${fieldsHtml}
                  </div>
                </div>

                <div class="retrieval-section">
                  <div class="retrieval-section-label">Score breakdown</div>
                  <div class="score-breakdown-grid">
                    <div class="breakdown-row">
                      <span class="breakdown-name">Keyword match</span>
                      <span class="breakdown-score">+${escapeHtml(kwScore)}</span>
                    </div>
                    <div class="breakdown-row">
                      <span class="breakdown-name">Importance</span>
                      <span class="breakdown-score">+${escapeHtml(impScore)}</span>
                    </div>
                    <div class="breakdown-row">
                      <span class="breakdown-name">Previous mentions</span>
                      <span class="breakdown-score">+${escapeHtml(menScore)}</span>
                    </div>
                  </div>
                </div>

                <div class="retrieval-section" style="margin-bottom: 0;">
                  <div class="retrieval-section-label">Reason</div>
                  <div class="retrieval-reason-box">
                    ${escapeHtml(reasonText)}
                  </div>
                </div>

                <div class="retrieval-popover-footer">
                  <button type="button" class="btn btn-ghost btn-xs" onclick="toggleMemoryDrawer(); closeAllRetrievalPopovers();" style="width: 100%; justify-content: center;">
                    <span>Open Memory Drawer ➔</span>
                  </button>
                </div>
              </div>
            </div>
          `;
        }).join('');
      } else if (mems.length > 0) {
        memoryPillsHtml = mems.map(title => {
          const cleanTitle = title.startsWith('Memory used: ') ? title : `Memory used: ${title}`;
          return `
            <span class="memory-pill-inline" onclick="toggleMemoryDrawer()" title="Retrieved & applied to response">
              <span class="memory-pill-dot"></span>
              <span>${escapeHtml(cleanTitle)}</span>
            </span>
          `;
        }).join('');
      }
    }
  }

  let pillsContainerHtml = '';
  if (providerPillHtml || memoryPillsHtml) {
    pillsContainerHtml = `
      <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px;">
        ${providerPillHtml}
        ${memoryPillsHtml}
      </div>
    `;
  }

  msgDiv.innerHTML = `
    <div class="msg-header">
      <div class="brand-glyph" style="width: 14px; height: 14px; border-radius: 3px; display: inline-flex; align-items: center; justify-content: center; background: var(--surface-elevated); border: 1px solid var(--border-subtle);">
        <span style="width: 4px; height: 4px; border-radius: 1px; background: var(--red-primary);"></span>
      </div>
      <span style="color: var(--text-primary); font-weight: 600;">OKFMem</span> • <span>${timeStr}</span>
    </div>
    <div class="msg-bubble">
      ${escapeHtml(responseText).replace(/\n/g, '<br>')}
      ${pillsContainerHtml}
    </div>
  `;

  container.appendChild(msgDiv);
}

/* ==========================================================================
   Task 2B: Explainable Memory Retrieval Popover Interaction
   ========================================================================== */

function toggleRetrievalExplanation(btn, event) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  const container = btn.closest('.retrieval-pill-container');
  if (!container) return;

  const popover = container.querySelector('.retrieval-explanation-popover');
  if (!popover) return;

  const wasActive = popover.classList.contains('active');
  closeAllRetrievalPopovers();

  if (!wasActive) {
    popover.classList.add('active');
    btn.setAttribute('aria-expanded', 'true');
  }
}

function closeAllRetrievalPopovers() {
  document.querySelectorAll('.retrieval-explanation-popover.active').forEach(p => {
    p.classList.remove('active');
  });
  document.querySelectorAll('.memory-pill-explainable[aria-expanded="true"]').forEach(b => {
    b.setAttribute('aria-expanded', 'false');
  });
}

// Close popovers on click outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.retrieval-pill-container')) {
    closeAllRetrievalPopovers();
  }
});

function scrollToBottom() {
  const stream = document.getElementById('chat-stream');
  if (stream) stream.scrollTop = stream.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Global ESC listener to close open modals or drawers
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeAllRetrievalPopovers();
    closeMemoryModal();
    closeOKFModal();
    closeSettingsModal();
    closeHistoryDrawer();
    closeMemoryDrawer();
  }
});

// Backend Health Check
async function checkBackendHealth() {
  try {
    const response = await fetch('http://localhost:5000/api/health');
    if (!response.ok) {
      throw new Error(`HTTP error status: ${response.status}`);
    }
    const data = await response.json();
    console.log(data);
  } catch (error) {
    console.error('Failed to connect to OKFMem backend:', error);
  }
}

// Fetch Memories from Backend
async function fetchMemories() {
  try {
    const response = await fetch('http://localhost:5000/api/memories');
    if (!response.ok) {
      throw new Error(`HTTP error status: ${response.status}`);
    }
    const data = await response.json();
    if (data && data.success && Array.isArray(data.memories)) {
      memories = data.memories;
      renderMemoryList();
    }
  } catch (error) {
    console.error('Failed to fetch memories from backend:', error);
  }
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
  renderHistoryList();
  renderMemoryList();
  checkBackendHealth();
  fetchMemories();
  fetchSettings();

  const promptInput = document.getElementById('prompt-input');
  if (promptInput) {
    promptInput.addEventListener('input', autoResizePromptInput);
  }
});
