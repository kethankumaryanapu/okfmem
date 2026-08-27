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
      renderAssistantMessage(msg.text, msg.time, msg.memoryPill);
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

  if (!container) return;

  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

  let filtered = memories.filter(m => {
    const matchesCat = activeMemoryFilter === "All" || m.category.toLowerCase() === activeMemoryFilter.toLowerCase();
    const matchesQuery = m.title.toLowerCase().includes(query) ||
                         m.fact.toLowerCase().includes(query) ||
                         m.category.toLowerCase().includes(query);
    return matchesCat && matchesQuery;
  });

  if (badgeCount) badgeCount.textContent = memories.length;

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

  document.getElementById('detail-fact').textContent = m.fact;
  document.getElementById('detail-category').textContent = m.category;
  document.getElementById('detail-importance').textContent = m.importance;
  document.getElementById('detail-confidence').textContent = typeof m.confidence === 'number' ? `${m.confidence}%` : (m.confidence || '');

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

function deleteMemoryById(id) {
  memories = memories.filter(m => m.id !== id);
  renderMemoryList();
  triggerToast('Memory deleted');
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
      console.error('Error fetching OKF document:', error);
      okfCode.textContent = "Failed to load OKF document.";
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

/* Settings Modal */
function openSettingsModal() {
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
   Chat Interactions (Teach New Fact & Recall Profile)
   ========================================================================== */

function teachNewFact() {
  const input = document.getElementById('prompt-input');
  if (input) {
    input.value = "I am currently learning Python and asynchronous programming.";
    input.focus();
    triggerToast("Sample fact loaded in prompt field");
  }
}

function sendSuggestedPrompt(text) {
  const input = document.getElementById('prompt-input');
  if (input) {
    input.value = text;
    submitMessage();
  }
}

function handleKeyDown(e) {
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

  try {
    const res = await fetch('http://localhost:5000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: userText })
    });

    const data = await res.json();
    if (res.ok && data.success && data.response) {
      responseText = data.response;
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
      time: timeStr
    });
  }

  renderAssistantMessage(responseText, timeStr);
  scrollToBottom();
}

function renderAssistantMessage(responseText, timeStr, memoryPillText) {
  const container = document.getElementById('messages-container');
  if (!container) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = 'chat-message-row msg-assistant';
  
  let pillHtml = '';
  if (memoryPillText) {
    pillHtml = `
      <div>
        <span class="memory-pill-inline" onclick="toggleMemoryDrawer()">
          <span class="memory-pill-dot"></span>
          <span>${memoryPillText}</span>
        </span>
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
      ${pillHtml}
    </div>
  `;

  container.appendChild(msgDiv);
}

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
});
