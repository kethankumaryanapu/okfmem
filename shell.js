/**
 * OKFMem - Shared Global Application Shell Navigation & Utility Script
 * Coordinates sidebar toggling, active page detection, theme syncing, and live memory metrics.
 */

(function () {
  'use strict';

  const API_BASE = 'http://localhost:5000/api';

  /* ==========================================================================
     Sidebar State & Toggle
     ========================================================================== */

  function isMobile() {
    return window.innerWidth <= 900;
  }

  function toggleSidebar() {
    const sidebar = document.getElementById('okf-sidebar') || document.querySelector('.mc-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (!sidebar) return;

    if (isMobile()) {
      const isOpen = sidebar.classList.contains('mobile-open');
      if (isOpen) {
        sidebar.classList.remove('mobile-open');
        if (overlay) overlay.classList.remove('active');
      } else {
        sidebar.classList.add('mobile-open');
        if (overlay) overlay.classList.add('active');
      }
    } else {
      const isCollapsed = sidebar.classList.toggle('collapsed');
      localStorage.setItem('okfmem_sidebar_collapsed', isCollapsed ? 'true' : 'false');
      updateSidebarToggleAria(isCollapsed);
    }
  }

  function closeMobileSidebar() {
    const sidebar = document.getElementById('okf-sidebar') || document.querySelector('.mc-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.remove('mobile-open');
    if (overlay) overlay.classList.remove('active');
  }

  function updateSidebarToggleAria(isCollapsed) {
    const toggleBtns = document.querySelectorAll('.btn-sidebar-toggle');
    toggleBtns.forEach(btn => {
      btn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
      btn.setAttribute('title', isCollapsed ? 'Expand Navigation Menu' : 'Collapse Navigation Menu');
    });
  }

  function initSidebar() {
    const sidebar = document.getElementById('okf-sidebar') || document.querySelector('.mc-sidebar');
    if (!sidebar) return;

    if (!isMobile()) {
      const savedState = localStorage.getItem('okfmem_sidebar_collapsed');
      if (savedState === 'true') {
        sidebar.classList.add('collapsed');
        updateSidebarToggleAria(true);
      } else {
        sidebar.classList.remove('collapsed');
        updateSidebarToggleAria(false);
      }
    }

    // Attach overlay click handler
    const overlay = document.getElementById('sidebar-overlay');
    if (overlay) {
      overlay.addEventListener('click', closeMobileSidebar);
    }

    // Window resize handler
    window.addEventListener('resize', () => {
      if (!isMobile()) {
        closeMobileSidebar();
        const savedState = localStorage.getItem('okfmem_sidebar_collapsed');
        if (savedState === 'true') {
          sidebar.classList.add('collapsed');
        } else {
          sidebar.classList.remove('collapsed');
        }
      }
    });
  }

  /* ==========================================================================
     Active Navigation Highlight
     ========================================================================== */

  function normalizePageName(pathStr) {
    if (!pathStr) return 'index';
    try {
      if (pathStr.startsWith('http://') || pathStr.startsWith('https://') || pathStr.startsWith('file://')) {
        const urlObj = new URL(pathStr, window.location.origin);
        pathStr = urlObj.pathname;
      }
    } catch (_) {}
    let p = pathStr.split('/').pop().split('?')[0].split('#')[0].toLowerCase();
    if (p.endsWith('.html')) p = p.slice(0, -5);
    if (p === '' || p === '/' || p === 'index') return 'index';
    return p;
  }

  function highlightActiveNav() {
    const navItems = document.querySelectorAll('.okf-nav-item, .mc-nav-item');
    if (!navItems.length) return;

    // Normalize current path
    const currentNorm = normalizePageName(window.location.pathname);

    navItems.forEach(item => {
      const link = item.querySelector('a');
      if (!link) return;

      const href = link.getAttribute('href');
      if (!href) return;

      const linkNorm = normalizePageName(href);
      const isCurrent = (currentNorm === linkNorm);

      if (isCurrent) {
        item.classList.add('active');
        link.setAttribute('aria-current', 'page');
      } else {
        item.classList.remove('active');
        link.removeAttribute('aria-current');
      }
    });

    // Synchronize top-bar active badges
    const memCenterBadges = document.querySelectorAll('.memory-access-badge, #btn-memory-center-badge');
    memCenterBadges.forEach(b => {
      if (currentNorm === 'memories') {
        b.classList.add('active');
      } else {
        b.classList.remove('active');
      }
    });

    const privacyIndicators = document.querySelectorAll('.privacy-indicator');
    privacyIndicators.forEach(p => {
      if (currentNorm === 'privacy') {
        p.classList.add('active');
      } else {
        p.classList.remove('active');
      }
    });
  }

  /* ==========================================================================
     Global Theme Synchronization
     ========================================================================== */

  function setTheme(themeName) {
    const isLight = themeName === 'light';
    const chosen = isLight ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', chosen);
    localStorage.setItem('okfmem_theme', chosen);

    const themeSelectors = document.querySelectorAll('.theme-selector, #theme-selector, #theme-selector-page');
    themeSelectors.forEach(sel => {
      if (sel) sel.value = chosen;
    });

    const activeBadges = document.querySelectorAll('.theme-active-badge, #theme-active-badge');
    activeBadges.forEach(b => {
      b.textContent = isLight ? 'White Theme Active' : 'Dark Theme Active';
    });

    // Notify user if triggerToast exists
    if (typeof window.triggerToast === 'function') {
      window.triggerToast(isLight ? 'Switched to White Theme' : 'Switched to Obsidian Dark Theme');
    }
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    setTheme(current === 'light' ? 'dark' : 'light');
  }

  function initTheme() {
    const saved = localStorage.getItem('okfmem_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    const themeSelectors = document.querySelectorAll('.theme-selector, #theme-selector, #theme-selector-page');
    themeSelectors.forEach(sel => {
      if (sel) sel.value = saved;
    });
  }

  /* ==========================================================================
     Live Memory Badge Count Fetcher
     ========================================================================== */

  async function updateLiveMemoryCount() {
    const badgeCounters = document.querySelectorAll('#top-memory-count, #memory-badge-count, #live-memory-count, .live-memory-count, #profile-total-memories');
    if (!badgeCounters.length) return;

    try {
      const res = await fetch(`${API_BASE}/memories`);
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.success && Array.isArray(data.memories)) {
        const count = data.memories.length;
        badgeCounters.forEach(el => {
          el.textContent = count;
        });
      }
    } catch (err) {
      // Backend not running or offline, fail gracefully
      console.debug('Memory count sync deferred:', err.message);
    }
  }

  /* ==========================================================================
     Initialization Lifecycle
     ========================================================================== */

  function onReady(fn) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      setTimeout(fn, 1);
    } else {
      document.addEventListener('DOMContentLoaded', fn);
    }
  }

  // Expose global methods
  window.toggleSidebar = toggleSidebar;
  window.closeMobileSidebar = closeMobileSidebar;
  window.toggleTheme = toggleTheme;
  window.setTheme = setTheme;
  window.updateLiveMemoryCount = updateLiveMemoryCount;
  window.highlightActiveNav = highlightActiveNav;

  // Immediate execution for instant rendering without FOUC
  initTheme();
  highlightActiveNav();

  onReady(() => {
    initSidebar();
    highlightActiveNav();
    updateLiveMemoryCount();
  });

})();
