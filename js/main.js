/**
 * Nexus Website — Main JS
 * - Language detection & switching (auto-detect system language)
 * - Dynamic content rendering (features, panels, island, download)
 * - Scroll animations
 */

(function () {
  'use strict';

  // ============================================================
  // LANGUAGE
  // ============================================================
  const SUPPORTED = ['zh', 'en', 'fr', 'es'];
  const STORAGE_KEY = 'nexus-lang';

  /**
   * Detect the actual language from system/browser.
   * Falls back to 'en' if system language is not in SUPPORTED.
   */
  function getSystemLang() {
    var navLang = (navigator.language || navigator.userLanguage || '').toLowerCase();
    if (SUPPORTED.indexOf(navLang) !== -1) return navLang;
    var prefix = navLang.split('-')[0];
    if (SUPPORTED.indexOf(prefix) !== -1) return prefix;
    return 'en';
  }

  function detectLang() {
    // 1) URL param ?lang=xx (explicit override)
    var params = new URLSearchParams(window.location.search);
    var fromUrl = params.get('lang');
    if (fromUrl && SUPPORTED.indexOf(fromUrl) !== -1) return fromUrl;

    // 2) localStorage — if user explicitly chose a language, use it
    var stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored !== 'auto' && SUPPORTED.indexOf(stored) !== -1) return stored;

    // 3) Auto-detect from system language
    return getSystemLang();
  }

  var currentLang = detectLang();

  function setLang(lang) {
    currentLang = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang;
    applyTranslations();
    renderDynamic();
    updateSwitcherUI();
  }

  function setAutoLang() {
    localStorage.removeItem(STORAGE_KEY);
    currentLang = getSystemLang();
    document.documentElement.lang = currentLang;
    applyTranslations();
    renderDynamic();
    updateSwitcherUI();
  }

  function t(path) {
    var parts = path.split('.');
    var val = I18N[currentLang];
    for (var i = 0; i < parts.length; i++) {
      if (val == null) return path;
      val = val[parts[i]];
    }
    return val != null ? val : path;
  }

  function applyTranslations() {
    var els = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var key = el.getAttribute('data-i18n');
      el.innerHTML = t(key);
    }
  }

  // ============================================================
  // REUSABLE HELPERS
  // ============================================================

  function escapeHTML(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function makeObservedCard(div) {
    div.style.opacity = '0';
    div.style.transform = 'translateY(24px)';
    div.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';
    return div;
  }

  // ============================================================
  // FEATURES
  // ============================================================

  var FEATURE_ICONS = [
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>',
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/></svg>',
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>',
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>',
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>',
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>'
  ];

  function makeFeatureCard(item, idx) {
    var div = document.createElement('div');
    div.className = 'feature-card';
    makeObservedCard(div);
    div.innerHTML =
      '<div class="feature-icon">' + (FEATURE_ICONS[idx % FEATURE_ICONS.length]) + '</div>' +
      '<h3>' + escapeHTML(item.title) + '</h3>' +
      '<p>' + escapeHTML(item.desc) + '</p>';
    return div;
  }

  // ============================================================
  // DOWNLOAD
  // ============================================================

  var DOWNLOAD_OS = [
    { os: 'linux', svg: '<svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>' },
    { os: 'macos', svg: '<svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>' },
    { os: 'windows', svg: '<svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/></svg>' }
  ];

  function makeDownloadCard(d) {
    var nameKey = 'download.' + d.os;
    var pkgKey = nameKey + 'Pkg';
    var div = document.createElement('div');
    div.className = 'download-card';
    makeObservedCard(div);
    div.innerHTML =
      '<div class="download-os">' + d.svg + '<h3>' + escapeHTML(t(nameKey)) + '</h3></div>' +
      '<p>' + escapeHTML(t(pkgKey)) + '</p>' +
      '<a href="#" class="btn-download">' + escapeHTML(t('download.btn')) + '</a>';
    return div;
  }

  // ============================================================
  // DYNAMIC ISLAND FEATURES
  // ============================================================

  var ISLAND_ICONS = ['💬', '🔧', '🛡️', '📊', '📦', '📎'];

  function makeIslandFeatureItem(item, idx) {
    var div = document.createElement('div');
    div.className = 'island-feature-item';
    makeObservedCard(div);
    div.innerHTML =
      '<span class="ifi-icon">' + ISLAND_ICONS[idx % ISLAND_ICONS.length] + '</span>' +
      '<div class="ifi-content">' +
      '<h4>' + escapeHTML(item.label) + '</h4>' +
      '<p>' + escapeHTML(item.desc) + '</p>' +
      '</div>';
    return div;
  }

  // ============================================================
  // RENDER DYNAMIC SECTIONS
  // ============================================================

  function renderDynamic() {
    // Features
    var fGrid = document.getElementById('featuresGrid');
    if (fGrid) {
      fGrid.innerHTML = '';
      var items = I18N[currentLang].features.items;
      for (var i = 0; i < items.length; i++) {
        fGrid.appendChild(makeFeatureCard(items[i], i));
      }
    }

    // Island features
    var iList = document.getElementById('islandFeatureList');
    if (iList) {
      iList.innerHTML = '';
      var ifeatures = I18N[currentLang].island.features;
      for (var j = 0; j < ifeatures.length; j++) {
        iList.appendChild(makeIslandFeatureItem(ifeatures[j], j));
      }
    }

    // Download
    var dGrid = document.getElementById('downloadGrid');
    if (dGrid) {
      dGrid.innerHTML = '';
      for (var m = 0; m < DOWNLOAD_OS.length; m++) {
        dGrid.appendChild(makeDownloadCard(DOWNLOAD_OS[m]));
      }
    }

    // Re-observe new elements
    observeNewElements();
    bindDownloadButtons();
  }

  // ============================================================
  // LANGUAGE SWITCHER UI
  // ============================================================

  var LANG_LABELS = { auto: 'Auto', zh: '中文', en: 'English', fr: 'Français', es: 'Español' };
  var LANG_FLAGS = { auto: '🌐', zh: '🇨🇳', en: '🇺🇸', fr: '🇫🇷', es: '🇪🇸' };
  var LANG_WORD = { auto: 'Auto', zh: '语言', en: 'Language', fr: 'Langue', es: 'Idioma' };

  function createSwitcher() {
    var container = document.createElement('div');
    container.className = 'lang-switcher';
    container.id = 'langSwitcher';

    var btn = document.createElement('button');
    btn.className = 'lang-current';
    btn.innerHTML = '<span class="lang-word">' + LANG_WORD[currentLang] + '</span>' +
      '<span class="lang-flag">' + LANG_FLAGS[currentLang] + '</span>';
    btn.title = LANG_LABELS[currentLang];
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      container.classList.toggle('open');
    });

    var dropdown = document.createElement('div');
    dropdown.className = 'lang-dropdown';

    // "Auto" option — first item, uses system language
    var autoOpt = document.createElement('button');
    autoOpt.className = 'lang-option' + (localStorage.getItem(STORAGE_KEY) === null ? ' active' : '');
    autoOpt.innerHTML = '<span class="lang-flag">' + LANG_FLAGS.auto + '</span>' + LANG_LABELS.auto;
    autoOpt.addEventListener('click', function () {
      container.classList.remove('open');
      if (localStorage.getItem(STORAGE_KEY) !== null) setAutoLang();
    });
    dropdown.appendChild(autoOpt);

    // Supported language options
    for (var i = 0; i < SUPPORTED.length; i++) {
      (function (code) {
        var opt = document.createElement('button');
        opt.className = 'lang-option' + (localStorage.getItem(STORAGE_KEY) === code ? ' active' : '');
        opt.innerHTML = '<span class="lang-flag">' + LANG_FLAGS[code] + '</span>' + LANG_LABELS[code];
        opt.addEventListener('click', function () {
          container.classList.remove('open');
          if (localStorage.getItem(STORAGE_KEY) !== code) setLang(code);
        });
        dropdown.appendChild(opt);
      })(SUPPORTED[i]);
    }

    container.appendChild(btn);
    container.appendChild(dropdown);

    var navLinks = document.querySelector('.nav-links');
    if (navLinks) {
      navLinks.appendChild(container);
    }

    document.addEventListener('click', function () {
      container.classList.remove('open');
    });
  }

  function updateSwitcherUI() {
    var sw = document.getElementById('langSwitcher');
    if (!sw) return;
    var btn = sw.querySelector('.lang-current');
    if (btn) btn.innerHTML = '<span class="lang-word">' + LANG_WORD[currentLang] + '</span>' +
      '<span class="lang-flag">' + LANG_FLAGS[currentLang] + '</span>';
    var opts = sw.querySelectorAll('.lang-option');
    var stored = localStorage.getItem(STORAGE_KEY);
    opts.forEach(function (opt) {
      // Skip auto option (first one)
      var text = opt.textContent.trim();
      if (text === 'Auto') {
        opt.classList.toggle('active', stored === null);
      } else {
        // Match by language code
        for (var i = 0; i < SUPPORTED.length; i++) {
          if (LANG_LABELS[SUPPORTED[i]] === text) {
            opt.classList.toggle('active', stored === SUPPORTED[i]);
            break;
          }
        }
      }
    });
  }

  // ============================================================
  // SCROLL ANIMATIONS
  // ============================================================

  var observer;

  function observeNewElements() {
    if (observer) observer.disconnect();

    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              entry.target.style.opacity = '1';
              entry.target.style.transform = 'translateY(0)';
              observer.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.15 }
      );

      var cards = document.querySelectorAll('.feature-card, .download-card, .island-feature-item');
      cards.forEach(function (el) {
        observer.observe(el);
      });
    }
  }

  // ============================================================
  // DOWNLOAD BUTTONS
  // ============================================================

  function bindDownloadButtons() {
    var btns = document.querySelectorAll('.btn-download');
    btns.forEach(function (btn) {
      if (btn._bound) return;
      btn._bound = true;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var h3 = this.closest('.download-card').querySelector('h3');
        var os = h3 ? h3.textContent : 'Nexus';
        alert(
          'Nexus ' + os + ' build coming soon.\n\nBuild from source: git clone https://github.com/liufei/Nexus'
        );
      });
    });
  }

  // ============================================================
  // SMOOTH SCROLL
  // ============================================================

  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
      anchor.addEventListener('click', function (e) {
        var target = document.querySelector(this.getAttribute('href'));
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  // ============================================================
  // INIT
  // ============================================================

  function init() {
    applyTranslations();
    renderDynamic();
    createSwitcher();
    initSmoothScroll();
    observeNewElements();
    bindDownloadButtons();
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
