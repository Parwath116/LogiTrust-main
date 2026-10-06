/**
 * LogiTrust — Shared UI Library (ui.js)
 * Implements theme toggle, cookie banner, scroll progress, back-to-top,
 * custom toasts & confirm dialogs, keyboard shortcuts, mobile menu, and skeletons.
 */

const LogiTrustUI = (() => {
  // --- 1. THEME MANAGEMENT ---
  function getPreferredTheme() {
    const saved = localStorage.getItem("logitrust_theme");
    if (saved) return saved;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    if (document.body) document.body.setAttribute("data-theme", theme);
    localStorage.setItem("logitrust_theme", theme);
    updateThemeToggleIcons(theme);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") || getPreferredTheme();
    const next = current === "light" ? "dark" : "light";
    applyTheme(next);
    toast(`Switched to ${next} theme`, "info", 2000);
  }

  function updateThemeToggleIcons(theme) {
    document.querySelectorAll(".theme-toggle-icon").forEach((el) => {
      el.textContent = theme === "light" ? "🌙" : "☀️";
    });
  }

  // --- 2. SCROLL PROGRESS BAR ---
  function initScrollProgress() {
    let bar = document.getElementById("scroll-progress");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "scroll-progress";
      document.body.prepend(bar);
    }
    let ticking = false;
    window.addEventListener("scroll", () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const docHeight = document.documentElement.scrollHeight - window.innerHeight;
          const progress = docHeight > 0 ? (window.scrollY / docHeight) * 100 : 0;
          bar.style.width = Math.min(100, Math.max(0, progress)) + "%";
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });
  }

  // --- 3. BACK TO TOP BUTTON ---
  function initBackToTop() {
    let btn = document.getElementById("back-to-top");
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "back-to-top";
      btn.setAttribute("aria-label", "Back to top");
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>`;
      document.body.appendChild(btn);
    }
    btn.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    window.addEventListener("scroll", () => {
      if (window.scrollY > 400) {
        btn.classList.add("visible");
      } else {
        btn.classList.remove("visible");
      }
    }, { passive: true });
  }

  // --- 4. COOKIE NOTICE BANNER ---
  function initCookieNotice() {
    if (localStorage.getItem("logitrust_cookie_accepted")) return;
    let banner = document.getElementById("cookie-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "cookie-banner";
      banner.innerHTML = `
        <div class="cookie-text">
          <b>🍪 Local Storage Notice:</b> LogiTrust stores only strictly necessary session tokens and theme preferences. No tracking cookies are used.
        </div>
        <button class="cookie-btn" id="cookie-accept-btn">Got it</button>
      `;
      document.body.appendChild(banner);
    }
    setTimeout(() => {
      banner.classList.add("visible");
    }, 400);

    const acceptBtn = document.getElementById("cookie-accept-btn");
    if (acceptBtn) {
      acceptBtn.addEventListener("click", () => {
        localStorage.setItem("logitrust_cookie_accepted", "true");
        banner.classList.remove("visible");
        setTimeout(() => banner.remove(), 350);
      });
    }
  }

  // --- 5. TOAST NOTIFICATIONS ---
  function getToastContainer() {
    let container = document.getElementById("toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "toast-container";
      container.setAttribute("aria-live", "polite");
      document.body.appendChild(container);
    }
    return container;
  }

  function toast(message, type = "info", duration = 4000) {
    const container = getToastContainer();
    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    
    const icons = {
      success: "✅",
      error: "⚠️",
      warn: "🚩",
      info: "ℹ️",
    };
    const icon = icons[type] || icons.info;

    el.innerHTML = `
      <span style="font-size:15px;flex-shrink:0">${icon}</span>
      <div style="flex:1;word-break:break-word">${message}</div>
    `;

    el.addEventListener("click", () => {
      el.style.opacity = "0";
      el.style.transform = "translateX(30px)";
      setTimeout(() => el.remove(), 200);
    });

    container.appendChild(el);

    if (duration > 0) {
      setTimeout(() => {
        if (el.parentNode) {
          el.style.opacity = "0";
          el.style.transform = "translateX(30px)";
          setTimeout(() => el.remove(), 200);
        }
      }, duration);
    }
  }

  // --- 6. PROMISE-BASED CONFIRM MODAL ---
  let confirmResolver = null;
  function initConfirmModal() {
    let overlay = document.getElementById("confirm-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "confirm-overlay";
      overlay.className = "confirm-overlay";
      overlay.innerHTML = `
        <div class="confirm-box" role="dialog" aria-modal="true">
          <div class="confirm-title" id="confirm-title">Please Confirm</div>
          <div class="confirm-msg" id="confirm-msg">Are you sure you want to proceed?</div>
          <div class="confirm-actions">
            <button class="confirm-btn-cancel" id="confirm-btn-cancel">Cancel</button>
            <button class="confirm-btn-ok" id="confirm-btn-ok">Confirm</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeConfirm(false);
      });
      document.getElementById("confirm-btn-cancel").addEventListener("click", () => closeConfirm(false));
      document.getElementById("confirm-btn-ok").addEventListener("click", () => closeConfirm(true));
    }
  }

  function confirmDialog(message, title = "Please Confirm") {
    initConfirmModal();
    const overlay = document.getElementById("confirm-overlay");
    document.getElementById("confirm-title").textContent = title;
    document.getElementById("confirm-msg").textContent = message;
    overlay.classList.add("open");
    document.getElementById("confirm-btn-ok").focus();

    return new Promise((resolve) => {
      confirmResolver = resolve;
    });
  }

  function closeConfirm(result) {
    const overlay = document.getElementById("confirm-overlay");
    if (overlay) overlay.classList.remove("open");
    if (confirmResolver) {
      confirmResolver(result);
      confirmResolver = null;
    }
  }

  // --- 7. KEYBOARD SHORTCUTS HELP MODAL ---
  function initShortcutsModal() {
    let modal = document.getElementById("shortcuts-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "shortcuts-modal";
      modal.className = "confirm-overlay";
      modal.innerHTML = `
        <div class="confirm-box" style="max-width:460px" role="dialog" aria-modal="true">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
            <div class="confirm-title" style="margin-bottom:0">⌨️ Keyboard Shortcuts</div>
            <button class="modal-close" style="width:26px;height:26px;font-size:14px" id="shortcuts-close-btn">&times;</button>
          </div>
          <div class="shortcuts-grid">
            <div class="shortcut-key">Esc</div>
            <div style="font-size:12px;color:var(--text2)">Close any active modal or menu</div>
            <div class="shortcut-key">T</div>
            <div style="font-size:12px;color:var(--text2)">Toggle Dark / Light Theme</div>
            <div class="shortcut-key">N</div>
            <div style="font-size:12px;color:var(--text2)">Open New Shipment modal (Shipper)</div>
            <div class="shortcut-key">?</div>
            <div style="font-size:12px;color:var(--text2)">Open this shortcuts help dialog</div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.addEventListener("click", (e) => {
        if (e.target === modal) modal.classList.remove("open");
      });
      document.getElementById("shortcuts-close-btn").addEventListener("click", () => {
        modal.classList.remove("open");
      });
    }
  }

  function toggleShortcutsModal() {
    initShortcutsModal();
    const modal = document.getElementById("shortcuts-modal");
    modal.classList.toggle("open");
  }

  // --- 8. GLOBAL KEYBOARD SHORTCUTS HANDLER ---
  function initKeyShortcuts() {
    window.addEventListener("keydown", (e) => {
      // Ignore shortcuts when user is typing into input fields
      const tag = (e.target.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || e.target.isContentEditable) {
        if (e.key === "Escape") {
          e.target.blur();
        }
        return;
      }

      if (e.key === "Escape") {
        // Close confirm dialog
        closeConfirm(false);
        // Close shortcuts modal
        const scModal = document.getElementById("shortcuts-modal");
        if (scModal) scModal.classList.remove("open");
        // Close main shipment modal if present
        const mainModal = document.getElementById("modal");
        if (mainModal) mainModal.classList.remove("open");
        // Close mobile drawer
        document.querySelectorAll(".mobile-drawer").forEach((d) => d.classList.remove("open"));
        return;
      }

      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        toggleTheme();
        return;
      }

      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        toggleShortcutsModal();
        return;
      }

      if (e.key === "n" || e.key === "N") {
        if (typeof window.openModal === "function") {
          e.preventDefault();
          window.openModal();
        }
        return;
      }
    });
  }

  // --- 9. MOBILE MENU TOGGLE ---
  function initMobileMenu() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".mobile-hamburger");
      if (btn) {
        const drawer = document.getElementById("mobile-drawer");
        if (drawer) drawer.classList.toggle("open");
        return;
      }
      // Close mobile drawer on outside click or drawer link click
      const drawer = document.getElementById("mobile-drawer");
      if (drawer && drawer.classList.contains("open")) {
        if (!e.target.closest(".mobile-drawer") && !e.target.closest(".mobile-hamburger")) {
          drawer.classList.remove("open");
        } else if (e.target.closest(".mobile-drawer-link")) {
          drawer.classList.remove("open");
        }
      }
    });
  }

  // --- 10. SKELETON RENDERER (FIRST LOAD ONLY) ---
  function renderSkeletons(containerId, count = 3, type = "row") {
    const el = document.getElementById(containerId);
    if (!el || window._firstLoadComplete) return;
    let html = "";
    for (let i = 0; i < count; i++) {
      html += `<div class="skeleton ${type === 'card' ? 'skeleton-card' : 'skeleton-row'}"></div>`;
    }
    el.innerHTML = html;
  }

  // --- 11. INITIALIZATION ON DOM READY ---
  function init() {
    const theme = getPreferredTheme();
    applyTheme(theme);
    initScrollProgress();
    initBackToTop();
    initCookieNotice();
    initConfirmModal();
    initShortcutsModal();
    initKeyShortcuts();
    initMobileMenu();

    // Wire theme toggle buttons
    document.querySelectorAll(".theme-toggle-btn").forEach((btn) => {
      btn.addEventListener("click", toggleTheme);
    });

    // Wire logout buttons
    document.querySelectorAll(".logout-trigger").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (typeof LogiTrustAPI !== "undefined" && LogiTrustAPI.logout) {
          LogiTrustAPI.logout();
        } else {
          localStorage.removeItem("logitrust_jwt");
          window.location.href = "index.html";
        }
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  return {
    toast,
    confirm: confirmDialog,
    toggleTheme,
    applyTheme,
    renderSkeletons,
  };
})();

// Replace window.alert with toast notification for modern UX
window.alert = (msg) => LogiTrustUI.toast(msg, "info", 5000);
