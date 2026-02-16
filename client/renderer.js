(function () {
  'use strict';

  const API_BASE_KEY = 'spaztick_api_base';
  const API_KEY_KEY = 'spaztick_api_key';
  const THEME_KEY = 'spaztick_theme';
  const THEMES = ['light', 'dark', 'blue', 'green', 'orange'];
  const DISPLAY_PROPERTIES_KEY = 'spaztick_display_properties';
  const INSPECTOR_HEIGHT_KEY = 'spaztick_inspector_height';
  const DEFAULT_INSPECTOR_HEIGHT = 220;
  const LEFT_PANEL_WIDTH_KEY = 'spaztick_left_panel_width';
  const MIN_LEFT_PANEL_WIDTH = 180;
  const MAX_LEFT_PANEL_WIDTH = 480;
  const DEFAULT_LEFT_PANEL_WIDTH = 320;
  const RIGHT_PANEL_WIDTH_KEY = 'spaztick_right_panel_width';
  const MIN_RIGHT_PANEL_WIDTH = 220;
  const MAX_RIGHT_PANEL_WIDTH = 560;
  const DEFAULT_RIGHT_PANEL_WIDTH = 320;
  const DATE_FORMAT_KEY = 'spaztick_date_format';
  const DATE_FORMAT_CUSTOM_KEY = 'spaztick_date_format_custom';

  const TASK_PROPERTY_KEYS = ['due_date', 'available_date', 'priority', 'description', 'projects', 'tags'];
  const TASK_PROPERTY_LABELS = {
    due_date: 'Due date',
    available_date: 'Available date',
    priority: 'Priority',
    description: 'Description',
    projects: 'Projects',
    tags: 'Tags',
  };
  const SORT_FIELD_KEYS = ['title', 'available_date', 'due_date', 'priority', 'status'];
  const SORT_FIELD_LABELS = {
    title: 'Name',
    available_date: 'Available date',
    due_date: 'Due date',
    priority: 'Priority',
    status: 'Status',
  };
  let projectListCache = [];
  let normalizedPrioritiesThisSession = false;

  function parseDateOnly(str) {
    if (!str || typeof str !== 'string') return null;
    const s = str.trim().substring(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    return s;
  }
  function isToday(dateStr) {
    const d = parseDateOnly(dateStr);
    if (!d) return false;
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return d === `${y}-${m}-${day}`;
  }
  function isOverdue(dateStr) {
    const d = parseDateOnly(dateStr);
    if (!d) return false;
    return d < (() => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; })();
  }

  const leftPanel = document.getElementById('left-panel');
  const rightPanel = document.getElementById('right-panel');
  const toggleLeft = document.getElementById('toggle-left');
  const toggleRight = document.getElementById('toggle-right');
  const projectsList = document.getElementById('projects-list');
  const chatMessages = document.getElementById('chat-messages');
  const chatInput = document.getElementById('chat-input');
  const chatSend = document.getElementById('chat-send');
  const chatTyping = document.getElementById('chat-typing');
  const chatResizeHandle = document.getElementById('chat-resize-handle');
  const inspectorContent = document.getElementById('inspector-content');
  const settingsOverlay = document.getElementById('settings-overlay');
  const settingsBtn = document.getElementById('settings-btn');
  const settingsClose = document.getElementById('settings-close');
  const settingsSave = document.getElementById('settings-save');
  const settingsApiBase = document.getElementById('settings-api-base');
  const settingsApiKey = document.getElementById('settings-api-key');
  const settingsDateFormat = document.getElementById('settings-date-format');
  const customFormatEditBtn = document.getElementById('custom-format-edit-btn');
  const customFormatOverlay = document.getElementById('custom-date-format-overlay');
  const customFormatInput = document.getElementById('custom-format-input');
  const customFormatPreview = document.getElementById('custom-format-preview');
  const customFormatClose = document.getElementById('custom-format-close');
  const customFormatCancel = document.getElementById('custom-format-cancel');
  const customFormatSave = document.getElementById('custom-format-save');
  const descriptionModalOverlay = document.getElementById('description-modal-overlay');
  const descriptionModalClose = document.getElementById('description-modal-close');
  const descriptionEditTextarea = document.getElementById('description-edit-textarea');
  const descriptionEditPane = document.getElementById('description-edit-pane');
  const descriptionPreviewPane = document.getElementById('description-preview-pane');
  const descriptionTabEdit = document.getElementById('description-tab-edit');
  const descriptionTabPreview = document.getElementById('description-tab-preview');
  const descriptionModalCancel = document.getElementById('description-modal-cancel');
  const descriptionModalSave = document.getElementById('description-modal-save');
  const connectionIndicator = document.getElementById('connection-indicator');
  const themeBtn = document.getElementById('theme-btn');
  const inboxItem = document.getElementById('inbox-item');

  let lastTasks = [];
  let lastTaskSource = null;
  let displayedTasks = [];

  function getApiBase() {
    return localStorage.getItem(API_BASE_KEY) || 'http://localhost:8081';
  }

  function getApiKey() {
    return localStorage.getItem(API_KEY_KEY) || '';
  }

  function setApiConfig(base, key) {
    if (base != null) localStorage.setItem(API_BASE_KEY, base);
    if (key != null) localStorage.setItem(API_KEY_KEY, key);
  }

  // --- Date format (settings + task/inspector display) ---
  function getDateFormat() {
    const v = localStorage.getItem(DATE_FORMAT_KEY);
    return (v === 'short' || v === 'short-eu' || v === 'short-iso' || v === 'medium' || v === 'long' || v === 'custom') ? v : 'short';
  }
  function getDateFormatCustom() {
    return localStorage.getItem(DATE_FORMAT_CUSTOM_KEY) || 'YYYY-MM-DD';
  }
  function setDateFormat(kind, customPattern) {
    if (kind != null) localStorage.setItem(DATE_FORMAT_KEY, kind);
    if (customPattern !== undefined) localStorage.setItem(DATE_FORMAT_CUSTOM_KEY, customPattern);
  }

  function parseDateValue(str) {
    if (str == null || typeof str !== 'string') return null;
    const s = str.trim();
    const datePart = s.substring(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
    // Parse as local date to avoid timezone shift (new Date('YYYY-MM-DD') is UTC midnight)
    const [y, m, day] = datePart.split('-').map(Number);
    const d = new Date(y, m - 1, day);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH_NAMES_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function formatDateWithPattern(d, pattern) {
    const y = d.getFullYear();
    const m = d.getMonth();
    const month = m + 1;
    const day = d.getDate();
    let out = pattern
      .replace('YYYY', String(y))
      .replace('YY', String(y).slice(-2))
      .replace('MMMM', MONTH_NAMES_FULL[m])
      .replace('MMM', MONTH_NAMES_SHORT[m])
      .replace('MM', String(month).padStart(2, '0'))
      .replace('M', String(month))
      .replace('DD', String(day).padStart(2, '0'))
      .replace('D', String(day));
    return out;
  }

  function renderMarkdown(text) {
    if (!text || typeof text !== 'string') return '';
    const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    let out = escape(text);
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    out = out.replace(/\n\n/g, '</p><p>');
    out = out.replace(/\n/g, '<br>');
    return '<p>' + out + '</p>';
  }

  function formatDate(dateStr) {
    const d = parseDateValue(dateStr);
    if (!d) return dateStr != null && dateStr !== '' ? String(dateStr).replace(/</g, '&lt;') : '';
    const kind = getDateFormat();
    let pattern;
    if (kind === 'custom') {
      pattern = getDateFormatCustom() || 'YYYY-MM-DD';
      return formatDateWithPattern(d, pattern);
    }
    if (kind === 'short') return formatDateWithPattern(d, 'MM/DD/YYYY');
    if (kind === 'short-eu') return formatDateWithPattern(d, 'DD/MM/YYYY');
    if (kind === 'short-iso') return formatDateWithPattern(d, 'YYYY-MM-DD');
    if (kind === 'medium') return formatDateWithPattern(d, 'MMM D, YYYY');
    if (kind === 'long') return formatDateWithPattern(d, 'MMMM D, YYYY');
    return formatDateWithPattern(d, 'MM/DD/YYYY');
  }

  // --- Connection status indicator ---
  async function checkConnection() {
    if (!connectionIndicator) return;
    const key = getApiKey();
    const base = getApiBase().replace(/\/$/, '');
    connectionIndicator.classList.remove('connected', 'disconnected');
    connectionIndicator.classList.add('checking');
    connectionIndicator.title = 'Checking connection…';
    if (!key) {
      connectionIndicator.classList.remove('checking');
      connectionIndicator.classList.add('disconnected');
      connectionIndicator.title = 'Not connected: no API key. Set one in Settings.';
      return;
    }
    try {
      const res = await fetch(`${base}/api/external/projects`, {
        method: 'GET',
        headers: { 'X-API-Key': key },
      });
      if (res.ok) {
        connectionIndicator.classList.remove('checking', 'disconnected');
        connectionIndicator.classList.add('connected');
        connectionIndicator.title = 'Connected to tasks server at ' + base;
      } else if (res.status === 401) {
        connectionIndicator.classList.remove('checking', 'connected');
        connectionIndicator.classList.add('disconnected');
        connectionIndicator.title = 'Not connected: invalid API key. Check Settings.';
      } else if (res.status === 403) {
        connectionIndicator.classList.remove('checking', 'connected');
        connectionIndicator.classList.add('disconnected');
        connectionIndicator.title = 'Not connected: external API disabled on server. Enable it in Spaztick web UI.';
      } else {
        connectionIndicator.classList.remove('checking', 'connected');
        connectionIndicator.classList.add('disconnected');
        connectionIndicator.title = 'Not connected: server returned ' + res.status + '. Check URL and API key in Settings.';
      }
    } catch (e) {
      connectionIndicator.classList.remove('checking', 'connected');
      connectionIndicator.classList.add('disconnected');
      connectionIndicator.title = 'Not connected: ' + (e.message || 'network error') + '. Check URL in Settings.';
    }
  }

  // --- Panel toggles (bottom bar) ---
  function toggleLeftPanel() {
    leftPanel.classList.toggle('collapsed');
  }

  function toggleRightPanel() {
    rightPanel.classList.toggle('collapsed');
  }

  toggleLeft.addEventListener('click', toggleLeftPanel);
  toggleRight.addEventListener('click', toggleRightPanel);

  // --- Settings modal ---
  function openSettings() {
    settingsApiBase.value = getApiBase();
    settingsApiKey.value = getApiKey();
    if (settingsDateFormat) settingsDateFormat.value = getDateFormat();
    if (customFormatEditBtn) customFormatEditBtn.classList.toggle('hidden', settingsDateFormat?.value !== 'custom');
    settingsOverlay.classList.remove('hidden');
    settingsOverlay.setAttribute('aria-hidden', 'false');
  }

  function closeSettings() {
    settingsOverlay.classList.add('hidden');
    settingsOverlay.setAttribute('aria-hidden', 'true');
  }

  function saveSettings() {
    const base = settingsApiBase.value.trim() || 'http://localhost:8081';
    const key = settingsApiKey.value.trim();
    setApiConfig(base, key);
    if (settingsDateFormat) setDateFormat(settingsDateFormat.value);
    closeSettings();
    checkConnection();
    loadProjects();
  }

  function openCustomDateFormatModal() {
    if (customFormatInput) customFormatInput.value = getDateFormatCustom();
    updateCustomFormatPreview();
    if (customFormatOverlay) {
      customFormatOverlay.classList.remove('hidden');
      customFormatOverlay.setAttribute('aria-hidden', 'false');
      if (customFormatInput) setTimeout(() => customFormatInput.focus(), 50);
    }
  }
  function closeCustomDateFormatModal() {
    if (customFormatOverlay) {
      customFormatOverlay.classList.add('hidden');
      customFormatOverlay.setAttribute('aria-hidden', 'true');
    }
  }
  function updateCustomFormatPreview() {
    if (!customFormatPreview || !customFormatInput) return;
    const pattern = (customFormatInput.value || '').trim() || 'YYYY-MM-DD';
    const d = new Date(2025, 0, 15); // Jan 15, 2025
    try {
      customFormatPreview.textContent = formatDateWithPattern(d, pattern);
    } catch (_) {
      customFormatPreview.textContent = '—';
    }
  }

  settingsBtn.addEventListener('click', openSettings);
  settingsClose.addEventListener('click', closeSettings);
  settingsSave.addEventListener('click', saveSettings);
  if (settingsDateFormat) {
    settingsDateFormat.addEventListener('change', () => {
      if (settingsDateFormat.value === 'custom') openCustomDateFormatModal();
      if (customFormatEditBtn) customFormatEditBtn.classList.toggle('hidden', settingsDateFormat.value !== 'custom');
    });
  }
  if (customFormatEditBtn) {
    customFormatEditBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openCustomDateFormatModal();
    });
  }
  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) closeSettings();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (descriptionModalOverlay && !descriptionModalOverlay.classList.contains('hidden')) closeDescriptionModal();
      else if (customFormatOverlay && !customFormatOverlay.classList.contains('hidden')) closeCustomDateFormatModal();
      else if (!settingsOverlay.classList.contains('hidden')) closeSettings();
    }
  });

  if (customFormatOverlay) {
    customFormatOverlay.addEventListener('click', (e) => { if (e.target === customFormatOverlay) closeCustomDateFormatModal(); });
  }
  if (customFormatClose) customFormatClose.addEventListener('click', closeCustomDateFormatModal);
  if (customFormatCancel) customFormatCancel.addEventListener('click', closeCustomDateFormatModal);
  if (customFormatSave) {
    customFormatSave.addEventListener('click', () => {
      const pattern = (customFormatInput && customFormatInput.value || '').trim() || 'YYYY-MM-DD';
      setDateFormat('custom', pattern);
      closeCustomDateFormatModal();
      if (settingsDateFormat) settingsDateFormat.value = 'custom';
      refreshTaskList();
    });
  }
  if (customFormatInput) {
    customFormatInput.addEventListener('input', updateCustomFormatPreview);
    customFormatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') customFormatSave && customFormatSave.click(); });
  }

  if (descriptionModalOverlay) {
    descriptionModalOverlay.addEventListener('click', (e) => { if (e.target === descriptionModalOverlay) closeDescriptionModal(); });
  }
  if (descriptionModalClose) descriptionModalClose.addEventListener('click', closeDescriptionModal);
  if (descriptionModalCancel) descriptionModalCancel.addEventListener('click', closeDescriptionModal);
  if (descriptionModalSave) {
    descriptionModalSave.addEventListener('click', async () => {
      if (!descriptionModalTaskId) return;
      const text = descriptionEditTextarea ? descriptionEditTextarea.value : '';
      try {
        const updated = await updateTask(descriptionModalTaskId, { description: text });
        updateTaskInLists(updated);
        const row = document.querySelector(`.task-row[data-id="${descriptionModalTaskId}"]`);
        if (row && row.classList.contains('selected')) loadTaskDetails(descriptionModalTaskId);
        closeDescriptionModal();
      } catch (e) {
        console.error('Failed to update description:', e);
        alert(e.message || 'Failed to save description.');
      }
    });
  }
  if (descriptionTabEdit) descriptionTabEdit.addEventListener('click', () => switchDescriptionTab(false));
  if (descriptionTabPreview) descriptionTabPreview.addEventListener('click', () => switchDescriptionTab(true));

  // --- Theme cycle ---
  function getTheme() {
    const t = localStorage.getItem(THEME_KEY) || 'light';
    return THEMES.includes(t) ? t : 'light';
  }
  function setTheme(theme) {
    localStorage.setItem(THEME_KEY, theme);
    if (theme === 'light') document.body.removeAttribute('data-theme');
    else document.body.setAttribute('data-theme', theme);
    if (themeBtn) themeBtn.title = 'Theme: ' + theme + ' (click to cycle)';
  }
  function cycleTheme() {
    const i = THEMES.indexOf(getTheme());
    setTheme(THEMES[(i + 1) % THEMES.length]);
  }
  if (themeBtn) themeBtn.addEventListener('click', cycleTheme);
  setTheme(getTheme());

  // --- API fetch helper ---
  async function api(path, options = {}) {
    const base = getApiBase().replace(/\/$/, '');
    const key = getApiKey();
    const headers = { ...options.headers };
    if (key) headers['X-API-Key'] = key;
    const res = await fetch(`${base}${path}`, { ...options, headers });
    if (!res.ok) {
      const text = await res.text();
      let msg = text || res.statusText;
      if (res.status === 401) msg = 'Invalid API key';
      else if (res.status === 403) msg = 'External API disabled';
      else if (text && text.startsWith('{')) {
        try {
          const j = JSON.parse(text);
          if (j.detail) msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail);
        } catch (_) {}
      }
      throw new Error(msg);
    }
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) return res.json();
    return res.text();
  }

  async function updateTask(taskId, body) {
    return api(`/api/external/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  // --- Display settings (task properties & order) by context: inbox, project, list:<id> ---
  function displayKey(source) {
    if (source === 'inbox') return 'inbox';
    if (typeof source === 'string' && source.startsWith('list:')) return source;
    return 'project';
  }

  function getDisplayProperties(source) {
    const key = displayKey(source != null ? source : 'project');
    try {
      const raw = localStorage.getItem(DISPLAY_PROPERTIES_KEY);
      if (raw) {
        const all = JSON.parse(raw);
        const o = (all[key] || all) && (typeof all[key] === 'object' ? all[key] : all);
        if (o && (Array.isArray(o.order) && Array.isArray(o.visible))) {
          const visible = new Set(o.visible.filter((k) => TASK_PROPERTY_KEYS.includes(k)));
          const order = o.order.filter((k) => TASK_PROPERTY_KEYS.includes(k));
          const showFlagged = o.showFlagged !== false;
          const showCompleted = o.showCompleted !== false;
          const showHighlightDue = o.showHighlightDue !== false;
          const sortBy = Array.isArray(o.sortBy) ? o.sortBy.filter((s) => s && SORT_FIELD_KEYS.includes(s.key)) : [];
          const manualSort = o.manualSort === true;
          const manualOrder = Array.isArray(o.manualOrder) ? o.manualOrder.filter((id) => id != null) : [];
          return { order, visible, showFlagged, showCompleted, showHighlightDue, sortBy, manualSort, manualOrder };
        }
      }
    } catch (_) {}
    const order = ['due_date', 'priority'];
    return { order, visible: new Set(order), showFlagged: true, showCompleted: true, showHighlightDue: true, sortBy: [], manualSort: false, manualOrder: [] };
  }

  function saveDisplayProperties(source, order, visible, showFlagged, showCompleted, showHighlightDue, sortBy, manualSort, manualOrder) {
    const key = displayKey(source != null ? source : 'project');
    let all = {};
    try {
      const raw = localStorage.getItem(DISPLAY_PROPERTIES_KEY);
      if (raw) all = JSON.parse(raw) || {};
    } catch (_) {}
    const current = getDisplayProperties(source);
    all[key] = {
      order: order || current.order,
      visible: visible != null ? Array.from(visible) : Array.from(current.visible),
      showFlagged: showFlagged !== undefined ? showFlagged : current.showFlagged,
      showCompleted: showCompleted !== undefined ? showCompleted : current.showCompleted,
      showHighlightDue: showHighlightDue !== undefined ? showHighlightDue : current.showHighlightDue,
      sortBy: sortBy !== undefined ? sortBy : current.sortBy,
      manualSort: manualSort !== undefined ? manualSort : current.manualSort,
      manualOrder: manualOrder !== undefined ? manualOrder : current.manualOrder,
    };
    localStorage.setItem(DISPLAY_PROPERTIES_KEY, JSON.stringify(all));
  }

  function renderDisplayDropdown() {
    const listEl = document.getElementById('display-properties-list');
    const flaggedCb = document.getElementById('display-show-flagged');
    const completedCb = document.getElementById('display-show-completed');
    const highlightDueCb = document.getElementById('display-show-highlight-due');
    const manualSortCb = document.getElementById('display-manual-sort');
    if (!listEl) return;
    const source = lastTaskSource != null ? lastTaskSource : 'project';
    const { order, visible, showFlagged, showCompleted, showHighlightDue, sortBy, manualSort, manualOrder } = getDisplayProperties(source);
    if (flaggedCb) {
      flaggedCb.checked = showFlagged;
      flaggedCb.onchange = () => {
        const { order: o, visible: v, showCompleted: sc, showHighlightDue: sh } = getDisplayProperties(source);
        saveDisplayProperties(source, o, v, flaggedCb.checked, sc, sh);
        refreshTaskList();
      };
    }
    if (completedCb) {
      completedCb.checked = showCompleted;
      completedCb.onchange = () => {
        const { order: o, visible: v, showFlagged: sf, showHighlightDue: sh } = getDisplayProperties(source);
        saveDisplayProperties(source, o, v, sf, completedCb.checked, sh);
        refreshTaskList();
      };
    }
    if (highlightDueCb) {
      highlightDueCb.checked = showHighlightDue;
      highlightDueCb.onchange = () => {
        const { order: o, visible: v, showFlagged: sf, showCompleted: sc } = getDisplayProperties(source);
        saveDisplayProperties(source, o, v, sf, sc, highlightDueCb.checked);
        refreshTaskList();
      };
    }
    if (manualSortCb) {
      manualSortCb.checked = manualSort;
      manualSortCb.onchange = () => {
        const { order: o, visible: v, showFlagged: sf, showCompleted: sc, showHighlightDue: sh, sortBy: sb } = getDisplayProperties(source);
        saveDisplayProperties(source, o, v, sf, sc, sh, sb, manualSortCb.checked);
        refreshTaskList();
      };
    }
    renderSortLadder(source);
    const addSortBtn = document.getElementById('display-sort-add');
    if (addSortBtn) {
      addSortBtn.onclick = () => {
        const { order: o, visible: v, showFlagged: sf, showCompleted: sc, showHighlightDue: sh, sortBy: sb } = getDisplayProperties(source);
        const next = [...sb, { key: 'due_date', dir: 'asc' }];
        saveDisplayProperties(source, o, v, sf, sc, sh, next);
        renderSortLadder(source);
        refreshTaskList();
      };
    }
    const allOrdered = [...order];
    TASK_PROPERTY_KEYS.forEach((k) => { if (!allOrdered.includes(k)) allOrdered.push(k); });
    listEl.innerHTML = allOrdered.map((key) => {
      const label = TASK_PROPERTY_LABELS[key] || key;
      const checked = visible.has(key);
      return `<li data-key="${key}">
        <span class="drag-handle" aria-label="Drag to reorder"><svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M22 6C22.5523 6 23 6.44772 23 7C23 7.55229 22.5523 8 22 8H2C1.44772 8 1 7.55228 1 7C1 6.44772 1.44772 6 2 6L22 6Z"/><path d="M22 11C22.5523 11 23 11.4477 23 12C23 12.5523 22.5523 13 22 13H2C1.44772 13 1 12.5523 1 12C1 11.4477 1.44772 11 2 11H22Z"/><path d="M23 17C23 16.4477 22.5523 16 22 16H2C1.44772 16 1 16.4477 1 17C1 17.5523 1.44772 18 2 18H22C22.5523 18 23 17.5523 23 17Z"/></svg></span>
        <input type="checkbox" id="disp-${key}" ${checked ? 'checked' : ''}>
        <label for="disp-${key}">${label}</label>
      </li>`;
    }).join('');
    listEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', (e) => {
        const key = e.target.id.replace('disp-', '');
        const { order: o, visible: v } = getDisplayProperties(source);
        if (e.target.checked) v.add(key);
        else v.delete(key);
        if (!o.includes(key)) o.push(key);
        const { showFlagged: sf, showCompleted: sc, showHighlightDue: sh } = getDisplayProperties(source);
        saveDisplayProperties(source, o, v, sf, sc, sh);
        refreshTaskList();
      });
    });
    setupDisplayListDrag(listEl, source);
  }

  function renderSortLadder(source) {
    const ladderEl = document.getElementById('display-sort-ladder');
    if (!ladderEl) return;
    const { sortBy } = getDisplayProperties(source);
    const rows = sortBy.length ? sortBy.map((s) => ({ key: s.key || 'due_date', dir: s.dir || 'asc' })) : [];
    ladderEl.innerHTML = rows.map((s, i) => {
      const fieldOpts = SORT_FIELD_KEYS.map((k) => `<option value="${k}" ${s.key === k ? 'selected' : ''}>${SORT_FIELD_LABELS[k] || k}</option>`).join('');
      return `<div class="display-sort-row" data-index="${i}">
        <select class="display-sort-field" aria-label="Sort by">${fieldOpts}</select>
        <select class="display-sort-dir" aria-label="Direction">
          <option value="asc" ${s.dir === 'asc' ? 'selected' : ''}>Asc</option>
          <option value="desc" ${s.dir === 'desc' ? 'selected' : ''}>Desc</option>
        </select>
        <button type="button" class="display-sort-remove" aria-label="Remove sort level">×</button>
      </div>`;
    }).join('');
    const syncSortBy = () => {
      const rows = ladderEl.querySelectorAll('.display-sort-row');
      const sb = Array.from(rows).map((row) => ({
        key: row.querySelector('.display-sort-field').value,
        dir: row.querySelector('.display-sort-dir').value,
      }));
      const { order: o, visible: v, showFlagged: sf, showCompleted: sc, showHighlightDue: sh } = getDisplayProperties(source);
      saveDisplayProperties(source, o, v, sf, sc, sh, sb);
      refreshTaskList();
    };
    ladderEl.querySelectorAll('.display-sort-field, .display-sort-dir').forEach((el) => {
      el.addEventListener('change', syncSortBy);
    });
    ladderEl.querySelectorAll('.display-sort-remove').forEach((btn, i) => {
      btn.addEventListener('click', () => {
        const { order: o, visible: v, showFlagged: sf, showCompleted: sc, showHighlightDue: sh, sortBy: sb } = getDisplayProperties(source);
        const next = sb.filter((_, j) => j !== i);
        saveDisplayProperties(source, o, v, sf, sc, sh, next);
        renderSortLadder(source);
        refreshTaskList();
      });
    });
  }

  function setupDisplayListDrag(listEl, source) {
    const ctx = source != null ? source : 'project';
    let dragged = null;
    listEl.querySelectorAll('li').forEach((li) => {
      const handle = li.querySelector('.drag-handle');
      if (!handle) return;
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        dragged = li;
        li.classList.add('dragging');
        const onMove = (e2) => {
          if (!dragged) return;
          const rect = listEl.getBoundingClientRect();
          const items = Array.from(listEl.querySelectorAll('li'));
          const y = e2.clientY - rect.top;
          let idx = items.findIndex((item) => item.getBoundingClientRect().top + item.offsetHeight / 2 > e2.clientY);
          if (idx < 0) idx = items.length;
          const curIdx = items.indexOf(dragged);
          if (curIdx !== idx && idx !== curIdx + 1) {
            if (idx > curIdx) idx--;
            listEl.insertBefore(dragged, listEl.children[idx]);
          }
        };
        const onUp = () => {
          if (dragged) dragged.classList.remove('dragging');
          dragged = null;
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          const order = Array.from(listEl.querySelectorAll('li')).map((el) => el.dataset.key);
          const { visible, showFlagged: sf, showCompleted: sc, showHighlightDue: sh } = getDisplayProperties(ctx);
          saveDisplayProperties(ctx, order, visible, sf, sc, sh);
          refreshTaskList();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });
  }

  function orderTasksBySort(tasks, sortBy) {
    if (!sortBy || !sortBy.length) return [...tasks];
    const key = (t) => String(t.id ?? '');
    return [...tasks].sort((a, b) => {
      for (const { key: field, dir } of sortBy) {
        let va = a[field];
        let vb = b[field];
        if (field === 'status') {
          va = isTaskCompleted(a) ? 1 : 0;
          vb = isTaskCompleted(b) ? 1 : 0;
        } else if (field === 'title') {
          va = (a.title || '').trim().toLowerCase();
          vb = (b.title || '').trim().toLowerCase();
        } else if (field === 'available_date' || field === 'due_date') {
          va = (va || '').toString().trim().substring(0, 10);
          vb = (vb || '').toString().trim().substring(0, 10);
        }
        const emptyA = va == null || va === '';
        const emptyB = vb == null || vb === '';
        if (emptyA && emptyB) continue;
        if (emptyA) return dir === 'asc' ? 1 : -1;
        if (emptyB) return dir === 'asc' ? -1 : 1;
        let cmp = 0;
        if (typeof va === 'string' && typeof vb === 'string') cmp = va.localeCompare(vb, undefined, { numeric: true });
        else if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
        else cmp = String(va).localeCompare(String(vb), undefined, { numeric: true });
        if (cmp !== 0) return dir === 'desc' ? -cmp : cmp;
      }
      return 0;
    });
  }

  function orderTasksByManual(tasks, manualOrder) {
    if (!manualOrder || !manualOrder.length) return [...tasks];
    const idToTask = new Map(tasks.map((t) => [String(t.id), t]));
    const ordered = [];
    for (const id of manualOrder) {
      const t = idToTask.get(id);
      if (t) ordered.push(t);
    }
    tasks.forEach((t) => {
      if (!ordered.includes(t)) ordered.push(t);
    });
    return ordered;
  }

  function refreshTaskList() {
    if (lastTasks.length && lastTaskSource) renderTaskList(lastTasks, lastTaskSource);
  }

  function redrawDisplayedTasks() {
    if (!displayedTasks.length || !lastTaskSource) return;
    const center = document.getElementById('center-content');
    if (!center) return;
    const src = lastTaskSource;
    const { manualSort } = getDisplayProperties(src);
    const selectedRow = center.querySelector('.task-row.selected');
    const selectedId = selectedRow && selectedRow.dataset.id;
    const ul = document.createElement('ul');
    ul.className = 'task-list';
    ul.style.listStyle = 'none';
    ul.style.padding = '0';
    ul.style.margin = '0';
    displayedTasks.forEach((t) => ul.appendChild(buildTaskRow(t)));
    center.innerHTML = '';
    center.appendChild(ul);
    if (manualSort) setupTaskListDrag(center, ul, src);
    if (selectedId) {
      const row = center.querySelector(`.task-row[data-id="${selectedId}"]`);
      if (row) {
        row.classList.add('selected');
        loadTaskDetails(selectedId);
      }
    }
  }

  function updateTaskInLists(updatedTask) {
    if (!updatedTask || updatedTask.id == null) return;
    const id = String(updatedTask.id);
    const idxLast = (lastTasks || []).findIndex((t) => String(t.id) === id);
    if (idxLast >= 0) lastTasks[idxLast] = updatedTask;
    const idxDisp = (displayedTasks || []).findIndex((t) => String(t.id) === id);
    if (idxDisp >= 0) displayedTasks[idxDisp] = updatedTask;
    redrawDisplayedTasks();
  }

  function refreshCenterView() {
    if (lastTaskSource === 'inbox') loadInboxTasks();
    else if (lastTaskSource && lastTaskSource.startsWith('list:')) return; // lists: future
    else if (lastTaskSource) loadProjectTasks(lastTaskSource);
  }

  function projectIdToShortName(projectId) {
    const p = projectListCache.find((x) => x.id === projectId || String(x.id) === String(projectId));
    return p ? (p.short_id || p.name || projectId) : projectId;
  }

  function isTaskCompleted(t) {
    const s = (t.status || '').toLowerCase();
    return s === 'complete' || s === 'completed' || s === 'done' || s === 'finished';
  }

  function dateAddDays(dateStr, deltaDays) {
    const d = parseDateValue(dateStr);
    if (!d) return null;
    d.setDate(d.getDate() + deltaDays);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function todayDateStr() {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  }

  /** weekday: 0 = Sunday, 1 = Monday, ... 6 = Saturday. Returns next occurrence (or same day + 7 if today is that weekday). */
  function nextWeekdayDate(weekday) {
    const t = new Date();
    const todayDow = t.getDay();
    let daysAhead = (weekday - todayDow + 7) % 7;
    if (daysAhead === 0) daysAhead = 7;
    t.setDate(t.getDate() + daysAhead);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  }

  const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const PRIORITY_CIRCLE_SVG = '<svg class="priority-circle-icon" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="8"/></svg>';
  function priorityClass(p) {
    if (p == null || p === '' || p === undefined) return 'priority-empty';
    const n = Number(p);
    if (n === 0) return 'priority-0';
    if (n === 1) return 'priority-1';
    if (n === 2) return 'priority-2';
    if (n === 3) return 'priority-3';
    return 'priority-empty';
  }

  async function updateTaskFlag(taskId, ev) {
    ev.stopPropagation();
    if (!taskId) return;
    const row = ev.currentTarget.closest('.task-row');
    const cell = ev.currentTarget.closest('.flagged-cell');
    const isFlagged = cell && cell.dataset.flagged === '1';
    try {
      const updated = await updateTask(taskId, { flagged: !isFlagged });
      updateTaskInLists(updated);
      const inspectorTitle = document.getElementById('inspector-title');
      if (inspectorTitle && inspectorTitle.textContent.startsWith('Task') && row && row.classList.contains('selected')) {
        loadTaskDetails(taskId);
      }
    } catch (e) {
      console.error('Failed to update flag:', e);
    }
  }

  async function updateTaskStatus(taskId, ev) {
    ev.stopPropagation();
    if (!taskId) return;
    const row = ev.currentTarget.closest('.task-row');
    const wasComplete = row && row.dataset.statusComplete === '1';
    const newStatus = wasComplete ? 'incomplete' : 'complete';
    try {
      const updated = await updateTask(taskId, { status: newStatus });
      updateTaskInLists(updated);
      const inspectorTitle = document.getElementById('inspector-title');
      if (inspectorTitle && inspectorTitle.textContent.startsWith('Task') && row && row.classList.contains('selected')) {
        loadTaskDetails(taskId);
      }
    } catch (e) {
      console.error('Failed to update status:', e);
    }
  }

  async function applyTaskPriority(taskId, value) {
    if (!taskId) return;
    try {
      const body = { priority: value };
      const updated = await updateTask(taskId, body);
      updateTaskInLists(updated);
      const row = document.querySelector(`.task-row[data-id="${taskId}"]`);
      if (row && row.classList.contains('selected')) loadTaskDetails(taskId);
    } catch (e) {
      console.error('Failed to update priority:', e);
      alert(e.message || 'Failed to update priority.');
    }
  }

  let priorityDropdownEl = null;
  function closePriorityDropdown() {
    if (priorityDropdownEl && priorityDropdownEl.parentNode) priorityDropdownEl.parentNode.removeChild(priorityDropdownEl);
    priorityDropdownEl = null;
    document.removeEventListener('click', priorityDropdownOutside);
  }
  function priorityDropdownOutside(ev) {
    if (!priorityDropdownEl) return;
    if (priorityDropdownEl.contains(ev.target)) return;
    closePriorityDropdown();
  }

  function openPriorityDropdown(ev, cell) {
    ev.stopPropagation();
    closePriorityDropdown();
    const row = cell.closest('.task-row');
    const taskId = cell.dataset.priorityTaskId;
    if (!taskId) return;
    const dropdown = document.createElement('div');
    dropdown.className = 'task-priority-dropdown';
    dropdown.setAttribute('role', 'menu');
    const options = [
      { value: 3, label: '3 – High', cls: 'priority-3' },
      { value: 2, label: '2 – Medium high', cls: 'priority-2' },
      { value: 1, label: '1 – Medium low', cls: 'priority-1' },
      { value: 0, label: '0 – Low', cls: 'priority-0' },
    ];
    options.forEach(({ value, label, cls }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'task-priority-dropdown-item';
      btn.innerHTML = `<span class="priority-circle-wrap ${cls}">${PRIORITY_CIRCLE_SVG}</span><span class="task-priority-dropdown-label">${label}</span>`;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        applyTaskPriority(taskId, value);
        closePriorityDropdown();
      });
      dropdown.appendChild(btn);
    });
    document.body.appendChild(dropdown);
    priorityDropdownEl = dropdown;
    const cellRect = cell.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.left = `${cellRect.left}px`;
    dropdown.style.top = `${cellRect.bottom + 4}px`;
    dropdown.style.minWidth = `${Math.max(cellRect.width, 180)}px`;
    requestAnimationFrame(() => document.addEventListener('click', priorityDropdownOutside));
  }

  let dateDropdownEl = null;
  function closeDateDropdown() {
    if (dateDropdownEl && dateDropdownEl.parentNode) dateDropdownEl.parentNode.removeChild(dateDropdownEl);
    dateDropdownEl = null;
    document.removeEventListener('click', dateDropdownOutside);
  }
  function dateDropdownOutside(ev) {
    if (!dateDropdownEl) return;
    if (dateDropdownEl.contains(ev.target)) return;
    if (dateDropdownEl.contains(document.activeElement)) return;
    closeDateDropdown();
  }

  function getTaskById(taskId) {
    const id = String(taskId);
    return (displayedTasks || []).find((t) => String(t.id) === id) || (lastTasks || []).find((t) => String(t.id) === id);
  }

  function validateDateRange(field, newDateStr, task) {
    if (!newDateStr || !task) return null;
    const d = newDateStr.trim().substring(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    if (field === 'due_date') {
      const av = (task.available_date || '').toString().trim().substring(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(av) && d < av) return 'Due date cannot be before available date.';
    } else {
      const due = (task.due_date || '').toString().trim().substring(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(due) && d > due) return 'Available date cannot be after due date.';
    }
    return null;
  }

  async function applyTaskDate(taskId, field, newDateStr) {
    if (!taskId || !field) return;
    const task = getTaskById(taskId);
    if (newDateStr && newDateStr.trim()) {
      const err = validateDateRange(field, newDateStr, task);
      if (err) {
        alert(err);
        return;
      }
    }
    try {
      const body = field === 'due_date'
        ? { due_date: (newDateStr && newDateStr.trim()) || null }
        : { available_date: (newDateStr && newDateStr.trim()) || null };
      const updated = await updateTask(taskId, body);
      updateTaskInLists(updated);
      const row = document.querySelector(`.task-row[data-id="${taskId}"]`);
      if (row && row.classList.contains('selected')) loadTaskDetails(taskId);
    } catch (e) {
      console.error('Failed to update date:', e);
      alert(e.message || 'Failed to update date.');
    }
  }

  function openDateDropdown(ev, cell) {
    ev.stopPropagation();
    closeDateDropdown();
    const row = cell.closest('.task-row');
    const taskId = row && row.dataset.id;
    const field = cell.dataset.dateField;
    let currentVal = (cell.dataset.dateValue || '').trim().substring(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(currentVal)) {
      const t = new Date();
      currentVal = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    }
    if (!taskId || !field) return;

    const dropdown = document.createElement('div');
    dropdown.className = 'task-date-dropdown';
    dropdown.setAttribute('role', 'menu');

    function addDateButton(label, dateStr) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'task-date-dropdown-item';
      btn.textContent = label;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        applyTaskDate(taskId, field, dateStr);
        closeDateDropdown();
      });
      dropdown.appendChild(btn);
    }

    addDateButton('Today', todayDateStr());
    addDateButton('Tomorrow', dateAddDays(todayDateStr(), 1));

    const weekdaysWrap = document.createElement('div');
    weekdaysWrap.className = 'task-date-dropdown-submenu-trigger-wrap';
    const weekdaysTrigger = document.createElement('button');
    weekdaysTrigger.type = 'button';
    weekdaysTrigger.className = 'task-date-dropdown-item task-date-dropdown-submenu-trigger';
    weekdaysTrigger.textContent = 'Days of the Week';
    weekdaysTrigger.setAttribute('aria-haspopup', 'true');
    weekdaysTrigger.setAttribute('aria-expanded', 'false');
    const weekdaysSubmenu = document.createElement('div');
    weekdaysSubmenu.className = 'task-date-dropdown-submenu';
    weekdaysSubmenu.setAttribute('role', 'menu');
    WEEKDAY_NAMES.forEach((name, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'task-date-dropdown-item';
      btn.textContent = name;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        applyTaskDate(taskId, field, nextWeekdayDate(i));
        closeDateDropdown();
      });
      weekdaysSubmenu.appendChild(btn);
    });
    weekdaysWrap.appendChild(weekdaysTrigger);
    weekdaysWrap.appendChild(weekdaysSubmenu);
    function showWeekdaysSubmenu() {
      weekdaysSubmenu.classList.add('visible');
      weekdaysTrigger.setAttribute('aria-expanded', 'true');
    }
    function hideWeekdaysSubmenu() {
      weekdaysSubmenu.classList.remove('visible');
      weekdaysTrigger.setAttribute('aria-expanded', 'false');
    }
    function toggleWeekdaysSubmenu(e) {
      e.stopPropagation();
      if (weekdaysSubmenu.classList.contains('visible')) hideWeekdaysSubmenu();
      else showWeekdaysSubmenu();
    }
    weekdaysTrigger.addEventListener('click', toggleWeekdaysSubmenu);
    weekdaysWrap.addEventListener('mouseenter', showWeekdaysSubmenu);
    weekdaysWrap.addEventListener('mouseleave', (e) => {
      if (!weekdaysSubmenu.contains(e.relatedTarget)) hideWeekdaysSubmenu();
    });
    weekdaysSubmenu.addEventListener('mouseleave', (e) => {
      if (!weekdaysWrap.contains(e.relatedTarget)) hideWeekdaysSubmenu();
    });
    dropdown.appendChild(weekdaysWrap);

    const choices = [
      { label: '+1 day', fn: () => dateAddDays(currentVal, 1) },
      { label: '-1 day', fn: () => dateAddDays(currentVal, -1) },
      { label: '+1 week', fn: () => dateAddDays(currentVal, 7) },
      { label: '-1 week', fn: () => dateAddDays(currentVal, -7) },
    ];
    choices.forEach(({ label, fn }) => {
      const newDate = fn();
      if (!newDate) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'task-date-dropdown-item';
      btn.textContent = label;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        applyTaskDate(taskId, field, newDate);
        closeDateDropdown();
      });
      dropdown.appendChild(btn);
    });

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'task-date-dropdown-item';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      applyTaskDate(taskId, field, '');
      closeDateDropdown();
    });
    dropdown.appendChild(clearBtn);

    const pickerWrap = document.createElement('div');
    pickerWrap.className = 'task-date-dropdown-picker-wrap';
    const pickerLabel = document.createElement('label');
    pickerLabel.textContent = 'Pick date: ';
    const picker = document.createElement('input');
    picker.type = 'date';
    const existingDate = (cell.dataset.dateValue || '').trim().substring(0, 10);
    picker.value = /^\d{4}-\d{2}-\d{2}$/.test(existingDate) ? existingDate : '';
    picker.className = 'task-date-picker-input';
    picker.addEventListener('change', (e) => {
      const v = e.target.value;
      if (v) {
        applyTaskDate(taskId, field, v);
        closeDateDropdown();
      }
    });
    pickerWrap.addEventListener('click', (e) => e.stopPropagation());
    pickerLabel.appendChild(picker);
    pickerWrap.appendChild(pickerLabel);
    dropdown.appendChild(pickerWrap);

    document.body.appendChild(dropdown);
    dateDropdownEl = dropdown;

    const cellRect = cell.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.left = `${cellRect.left}px`;
    dropdown.style.top = `${cellRect.bottom + 4}px`;
    dropdown.style.minWidth = `${Math.max(cellRect.width, 160)}px`;

    requestAnimationFrame(() => document.addEventListener('click', dateDropdownOutside));
  }

  let projectsDropdownEl = null;
  function closeProjectsDropdown() {
    if (projectsDropdownEl && projectsDropdownEl.parentNode) projectsDropdownEl.parentNode.removeChild(projectsDropdownEl);
    projectsDropdownEl = null;
    document.removeEventListener('click', projectsDropdownOutside);
  }
  function projectsDropdownOutside(ev) {
    if (projectsDropdownEl && !projectsDropdownEl.contains(ev.target) && !ev.target.closest('.projects-cell')) closeProjectsDropdown();
  }

  let descriptionModalTaskId = null;
  function openDescriptionModal(ev, cell) {
    ev.stopPropagation();
    const taskId = cell && cell.dataset.descriptionTaskId;
    if (!taskId) return;
    const task = getTaskById(taskId);
    const desc = (task && (task.description != null)) ? String(task.description) : '';
    descriptionModalTaskId = taskId;
    if (descriptionEditTextarea) descriptionEditTextarea.value = desc;
    if (descriptionPreviewPane) descriptionPreviewPane.innerHTML = renderMarkdown(desc);
    if (descriptionEditPane) descriptionEditPane.classList.remove('hidden');
    if (descriptionPreviewPane) descriptionPreviewPane.classList.add('hidden');
    if (descriptionTabEdit) { descriptionTabEdit.classList.add('active'); descriptionTabEdit.setAttribute('aria-pressed', 'true'); }
    if (descriptionTabPreview) { descriptionTabPreview.classList.remove('active'); descriptionTabPreview.setAttribute('aria-pressed', 'false'); }
    if (descriptionModalOverlay) {
      descriptionModalOverlay.classList.remove('hidden');
      descriptionModalOverlay.setAttribute('aria-hidden', 'false');
      if (descriptionEditTextarea) setTimeout(() => descriptionEditTextarea.focus(), 50);
    }
  }
  function closeDescriptionModal() {
    descriptionModalTaskId = null;
    if (descriptionModalOverlay) {
      descriptionModalOverlay.classList.add('hidden');
      descriptionModalOverlay.setAttribute('aria-hidden', 'true');
    }
  }
  function switchDescriptionTab(toPreview) {
    if (toPreview && descriptionEditTextarea && descriptionPreviewPane) {
      descriptionPreviewPane.innerHTML = renderMarkdown(descriptionEditTextarea.value);
    }
    if (descriptionEditPane) descriptionEditPane.classList.toggle('hidden', toPreview);
    if (descriptionPreviewPane) descriptionPreviewPane.classList.toggle('hidden', !toPreview);
    if (descriptionTabEdit) { descriptionTabEdit.classList.toggle('active', !toPreview); descriptionTabEdit.setAttribute('aria-pressed', !toPreview ? 'true' : 'false'); }
    if (descriptionTabPreview) { descriptionTabPreview.classList.toggle('active', toPreview); descriptionTabPreview.setAttribute('aria-pressed', toPreview ? 'true' : 'false'); }
  }

  async function applyTaskProjects(taskId, projectIds) {
    if (!taskId) return;
    try {
      const updated = await updateTask(taskId, { projects: projectIds });
      updateTaskInLists(updated);
      const row = document.querySelector(`.task-row[data-id="${taskId}"]`);
      if (row && row.classList.contains('selected')) loadTaskDetails(taskId);
    } catch (e) {
      console.error('Failed to update task projects:', e);
    }
  }

  function openProjectsDropdown(ev, cell) {
    ev.stopPropagation();
    closeProjectsDropdown();
    const row = cell.closest('.task-row');
    const taskId = row && row.dataset.id;
    let currentIds = [];
    try {
      currentIds = JSON.parse(cell.dataset.projectsJson || '[]');
    } catch (_) {}
    if (!taskId) return;

    const dropdown = document.createElement('div');
    dropdown.className = 'task-projects-dropdown';

    const currentSection = document.createElement('div');
    currentSection.className = 'task-projects-section';
    const currentTitle = document.createElement('div');
    currentTitle.className = 'task-projects-section-title';
    currentTitle.textContent = 'Current projects';
    currentSection.appendChild(currentTitle);
    const currentList = document.createElement('div');
    currentList.className = 'task-projects-current-list';
    const projectLabel = (pid) => {
      const p = projectListCache.find((x) => String(x.id) === String(pid));
      return (p ? (p.short_id || p.name || pid) : pid).toString().toLowerCase();
    };
    const sortedCurrentIds = [...currentIds].sort((a, b) => projectLabel(a).localeCompare(projectLabel(b), undefined, { numeric: true }));
    sortedCurrentIds.forEach((pid) => {
      const p = projectListCache.find((x) => String(x.id) === String(pid));
      const label = p ? (p.short_id || p.name || pid) : pid;
      const item = document.createElement('div');
      item.className = 'task-projects-current-item';
      item.innerHTML = `<span class="task-projects-current-label">${String(label).replace(/</g, '&lt;')}</span> <button type="button" class="task-projects-remove" aria-label="Remove">×</button>`;
      const removeBtn = item.querySelector('button');
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const next = currentIds.filter((id) => String(id) !== String(pid));
        applyTaskProjects(taskId, next);
        closeProjectsDropdown();
      });
      currentList.appendChild(item);
    });
    if (currentIds.length === 0) currentList.innerHTML = '<span class="task-projects-empty">None</span>';
    currentSection.appendChild(currentList);
    dropdown.appendChild(currentSection);

    const searchSection = document.createElement('div');
    searchSection.className = 'task-projects-section task-projects-search-section';
    const searchTitle = document.createElement('div');
    searchTitle.className = 'task-projects-section-title';
    searchTitle.textContent = 'Add project';
    searchSection.appendChild(searchTitle);
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search or create project…';
    searchInput.className = 'task-projects-search-input';
    searchSection.appendChild(searchInput);
    const resultsDiv = document.createElement('div');
    resultsDiv.className = 'task-projects-results';
    searchSection.appendChild(resultsDiv);

    function renderSearchResults() {
      const q = (searchInput.value || '').trim().toLowerCase();
      resultsDiv.innerHTML = '';
      if (!q) return;
      const attachedSet = new Set(currentIds.map((id) => String(id)));
      let matches = projectListCache.filter((p) => {
        if (attachedSet.has(String(p.id))) return false;
        const name = (p.name || '').toLowerCase();
        const short = (p.short_id || '').toLowerCase();
        return name.includes(q) || short.includes(q);
      });
      matches = matches.sort((a, b) => {
        const labelA = (a.short_id || a.name || a.id || '').toString().toLowerCase();
        const labelB = (b.short_id || b.name || b.id || '').toString().toLowerCase();
        return labelA.localeCompare(labelB, undefined, { numeric: true });
      });
      if (matches.length) {
        matches.forEach((p) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'task-projects-result-item';
          btn.textContent = (p.short_id ? p.short_id + ': ' : '') + (p.name || p.id);
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const next = [...currentIds, p.id];
            applyTaskProjects(taskId, next);
            closeProjectsDropdown();
          });
          resultsDiv.appendChild(btn);
        });
      } else {
        const createBtn = document.createElement('button');
        createBtn.type = 'button';
        createBtn.className = 'task-projects-result-item task-projects-create';
        createBtn.textContent = `Create project "${q}"`;
        createBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            const created = await api('/api/external/projects', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: searchInput.value.trim() }),
            });
            const next = [...currentIds, created.id];
            await applyTaskProjects(taskId, next);
            loadProjects();
            closeProjectsDropdown();
          } catch (err) {
            console.error('Failed to create project:', err);
          }
        });
        resultsDiv.appendChild(createBtn);
      }
    }
    searchInput.addEventListener('input', renderSearchResults);
    searchInput.addEventListener('focus', renderSearchResults);

    dropdown.appendChild(searchSection);

    document.body.appendChild(dropdown);
    projectsDropdownEl = dropdown;

    const cellRect = cell.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.left = `${cellRect.left}px`;
    dropdown.style.top = `${cellRect.bottom + 4}px`;
    dropdown.style.minWidth = `${Math.max(cellRect.width, 240)}px`;
    dropdown.style.maxHeight = '320px';
    dropdown.style.overflowY = 'auto';

    requestAnimationFrame(() => {
      document.addEventListener('click', projectsDropdownOutside);
      searchInput.focus();
    });
  }

  function buildTaskRow(t) {
    const source = lastTaskSource != null ? lastTaskSource : 'project';
    const { order, visible, showFlagged, showHighlightDue, manualSort } = getDisplayProperties(source);
    const row = document.createElement('div');
    row.className = 'task-row';
    row.dataset.type = 'task';
    row.dataset.id = t.id || '';
    row.dataset.number = t.number != null ? String(t.number) : '';
    row.dataset.statusComplete = isTaskCompleted(t) ? '1' : '0';
    row.addEventListener('click', onTaskClick);
    const moveHandleSvg = '<svg class="task-move-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M22 6C22.5523 6 23 6.44772 23 7C23 7.55229 22.5523 8 22 8H2C1.44772 8 1 7.55228 1 7C1 6.44772 1.44772 6 2 6L22 6Z"/><path d="M22 11C22.5523 11 23 11.4477 23 12C23 12.5523 22.5523 13 22 13H2C1.44772 13 1 12.5523 1 12C1 11.4477 1.44772 11 2 11H22Z"/><path d="M23 17C23 16.4477 22.5523 16 22 16H2C1.44772 16 1 16.4477 1 17C1 17.5523 1.44772 18 2 18H22C22.5523 18 23 17.5523 23 17Z"/></svg>';
    if (manualSort) {
      const moveWrap = document.createElement('div');
      moveWrap.className = 'task-row-move';
      moveWrap.innerHTML = moveHandleSvg;
      moveWrap.setAttribute('aria-label', 'Drag to reorder');
      row.appendChild(moveWrap);
    }
    const statusComplete = isTaskCompleted(t);
    const circleOpenSvg = '<svg class="status-icon" viewBox="0 0 32 32" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M0 16q0 3.264 1.28 6.208t3.392 5.12 5.12 3.424 6.208 1.248 6.208-1.248 5.12-3.424 3.392-5.12 1.28-6.208-1.28-6.208-3.392-5.12-5.088-3.392-6.24-1.28q-3.264 0-6.208 1.28t-5.12 3.392-3.392 5.12-1.28 6.208zM4 16q0-3.264 1.6-6.016t4.384-4.352 6.016-1.632 6.016 1.632 4.384 4.352 1.6 6.016-1.6 6.048-4.384 4.352-6.016 1.6-6.016-1.6-4.384-4.352-1.6-6.048z"/></svg>';
    const circleTickSvg = '<svg class="status-icon" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M0 8c0 4.418 3.59 8 8 8 4.418 0 8-3.59 8-8 0-4.418-3.59-8-8-8-4.418 0-8 3.59-8 8zm2 0c0-3.307 2.686-6 6-6 3.307 0 6 2.686 6 6 0 3.307-2.686 6-6 6-3.307 0-6-2.686-6-6zm9.778-1.672l-1.414-1.414L6.828 8.45 5.414 7.036 4 8.45l2.828 2.828 3.182-3.182 1.768-1.768z" fill-rule="evenodd"/></svg>';
    const folderOpenSvg = '<svg class="project-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M2 6C2 4.34315 3.34315 3 5 3H7.75093C8.82997 3 9.86325 3.43595 10.6162 4.20888L9.94852 4.85927L10.6162 4.20888L11.7227 5.34484C11.911 5.53807 12.1693 5.64706 12.4391 5.64706H16.4386C18.5513 5.64706 20.281 7.28495 20.4284 9.35939C21.7878 9.88545 22.5642 11.4588 21.977 12.927L20.1542 17.4853C19.5468 19.0041 18.0759 20 16.4402 20H6C4.88522 20 3.87543 19.5427 3.15116 18.8079C2.44035 18.0867 2 17.0938 2 16V6ZM18.3829 9.17647C18.1713 8.29912 17.3812 7.64706 16.4386 7.64706H12.4391C11.6298 7.64706 10.8548 7.3201 10.2901 6.7404L9.18356 5.60444L9.89987 4.90666L9.18356 5.60444C8.80709 5.21798 8.29045 5 7.75093 5H5C4.44772 5 4 5.44772 4 6V14.4471L5.03813 11.25C5.43958 10.0136 6.59158 9.17647 7.89147 9.17647H18.3829ZM5.03034 17.7499L6.94036 11.8676C7.07417 11.4555 7.45817 11.1765 7.89147 11.1765H19.4376C19.9575 11.1765 20.3131 11.7016 20.12 12.1844L18.2972 16.7426C17.9935 17.502 17.258 18 16.4402 18H6C5.64785 18 5.31756 17.9095 5.03034 17.7499Z"/></svg>';
    const documentIconSvg = '<svg class="description-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M9.29289 1.29289C9.48043 1.10536 9.73478 1 10 1H18C19.6569 1 21 2.34315 21 4V20C21 21.6569 19.6569 23 18 23H6C4.34315 23 3 21.6569 3 20V8C3 7.73478 3.10536 7.48043 3.29289 7.29289L9.29289 1.29289ZM18 3H11V8C11 8.55228 10.5523 9 10 9H5V20C5 20.5523 5.44772 21 6 21H18C18.5523 21 19 20.5523 19 20V4C19 3.44772 18.5523 3 18 3ZM6.41421 7H9V4.41421L6.41421 7ZM7 13C7 12.4477 7.44772 12 8 12H16C16.5523 12 17 12.4477 17 13C17 13.5523 16.5523 14 16 14H8C7.44772 14 7 13.4477 7 13ZM7 17C7 16.4477 7.44772 16 8 16H16C16.5523 16 17 16.4477 17 17C17 17.5523 16.5523 18 16 18H8C7.44772 18 7 17.5523 7 17Z"/></svg>';

    function addCell(key, html, opts) {
      if (!html && !(opts && opts.descriptionTaskId != null)) return;
      const cell = document.createElement('div');
      cell.className = 'task-cell ' + key + '-cell';
      cell.innerHTML = html;
      if (opts && opts.dateField) {
        cell.dataset.dateField = opts.dateField;
        cell.dataset.dateValue = opts.dateValue || '';
      }
      if (opts && opts.projectsTaskId != null) {
        cell.dataset.projectsTaskId = opts.projectsTaskId;
        cell.dataset.projectsJson = opts.projectsJson != null ? opts.projectsJson : '[]';
      }
      if (opts && opts.titleTaskId != null) {
        cell.dataset.titleTaskId = opts.titleTaskId;
      }
      if (opts && opts.flaggedTaskId != null) {
        cell.dataset.flaggedTaskId = opts.flaggedTaskId;
        cell.dataset.flagged = opts.flaggedValue ? '1' : '0';
      }
      if (opts && opts.descriptionTaskId != null) {
        cell.dataset.descriptionTaskId = opts.descriptionTaskId;
      }
      if (opts && opts.priorityTaskId != null) {
        cell.dataset.priorityTaskId = opts.priorityTaskId;
        cell.dataset.priorityValue = opts.priorityValue != null ? String(opts.priorityValue) : '';
      }
      row.appendChild(cell);
    }

    addCell('status', statusComplete ? circleTickSvg : circleOpenSvg);
    if (showFlagged) {
      const flagged = t.flagged === true || t.flagged === 1;
      addCell('flagged', `<span class="flagged-icon ${flagged ? '' : 'empty'}" title="${flagged ? 'Flagged (click to unflag)' : 'Click to flag'}">★</span>`, { flaggedTaskId: t.id, flaggedValue: flagged });
    }
    addCell('title', `<span class="cell-value">${(t.title || '(no title)').trim().replace(/</g, '&lt;')}</span>`, { titleTaskId: t.id });

    order.forEach((key) => {
      if (!visible.has(key)) return;
      let html = '';
      if (key === 'available_date') {
        const dateVal = (t.available_date || '').toString().trim().substring(0, 10);
        const hasVal = /^\d{4}-\d{2}-\d{2}$/.test(dateVal);
        const muteClass = hasVal ? '' : ' empty';
        const calEventSvg = '<svg class="date-icon calendar-event-icon' + muteClass + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M4 8H20M4 8V16.8002C4 17.9203 4 18.4801 4.21799 18.9079C4.40973 19.2842 4.71547 19.5905 5.0918 19.7822C5.5192 20 6.07899 20 7.19691 20H16.8031C17.921 20 18.48 20 18.9074 19.7822C19.2837 19.5905 19.5905 19.2842 19.7822 18.9079C20 18.4805 20 17.9215 20 16.8036V8M4 8V7.2002C4 6.08009 4 5.51962 4.21799 5.0918C4.40973 4.71547 4.71547 4.40973 5.0918 4.21799C5.51962 4 6.08009 4 7.2002 4H8M20 8V7.19691C20 6.07899 20 5.5192 19.7822 5.0918C19.5905 4.71547 19.2837 4.40973 18.9074 4.21799C18.4796 4 17.9203 4 16.8002 4H16M8 4H16M8 4V2M16 4V2M11.75 16C11.8881 16 12 15.8881 12 15.75V12.25C12 12.1119 11.8881 12 8.25 12V15.75C8 15.8881 8.11193 16 8.25 16H11.75Z"/></svg>';
        html = calEventSvg + (hasVal ? `<span class="cell-value">${formatDate(t.available_date)}</span>` : `<span class="cell-value empty" title="Click to set date">—</span>`);
        addCell(key, html, { dateField: 'available_date', dateValue: dateVal || '' });
        return;
      } else if (key === 'due_date') {
        const dateVal = (t.due_date || '').toString().trim().substring(0, 10);
        const hasVal = /^\d{4}-\d{2}-\d{2}$/.test(dateVal);
        const today = hasVal && isToday(t.due_date);
        const overdue = hasVal && isOverdue(t.due_date);
        const stateClass = showHighlightDue ? (overdue ? 'due-overdue' : (today ? 'due-today' : '')) : '';
        const muteClass = hasVal ? '' : ' empty';
        const calCheckSvg = '<svg class="date-icon calendar-check-icon ' + stateClass + muteClass + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M4 8H20M4 8V16.8002C4 17.9203 4 18.4801 4.21799 18.9079C4.40973 19.2842 4.71547 19.5905 5.0918 19.7822C5.5192 20 6.07899 20 7.19691 20H16.8031C17.921 20 18.48 20 18.9074 19.7822C19.2837 19.5905 19.5905 19.2842 19.7822 18.9079C20 18.4805 20 17.9215 20 16.8036V8M4 8V7.2002C4 6.08009 4 5.51962 4.21799 5.0918C4.40973 4.71547 4.71547 4.40973 5.0918 4.21799C5.51962 4 6.08009 4 7.2002 4H8M20 8V7.19691C20 6.07899 20 5.5192 19.7822 5.0918C19.5905 4.71547 19.2837 4.40973 18.9074 4.21799C18.4796 4 17.9203 4 16.8002 4H16M8 4H16M8 4V2M16 4V2M15 12L11 16L9 14"/></svg>';
        html = calCheckSvg + (hasVal ? `<span class="cell-value ${stateClass}">${formatDate(t.due_date)}</span>` : `<span class="cell-value empty" title="Click to set date">—</span>`);
        addCell(key, html, { dateField: 'due_date', dateValue: dateVal || '' });
        return;
      } else if (key === 'priority') {
        const p = t.priority;
        const cls = priorityClass(p);
        const title = p != null ? `Priority ${p} (click to change)` : 'No priority (click to set)';
        html = `<span class="priority-circle-wrap ${cls}" title="${title}">${PRIORITY_CIRCLE_SVG}</span>`;
        addCell(key, html, { priorityTaskId: t.id, priorityValue: p });
        return;
      } else if (key === 'description') {
        const d = (t.description || '').trim();
        let tooltip = d ? d.replace(/"/g, '&quot;').replace(/</g, '&lt;') : 'No description (click to add)';
        if (tooltip.length > 500) tooltip = tooltip.substring(0, 500) + '…';
        const iconClass = 'description-icon-wrap ' + (d ? '' : 'empty');
        html = `<span class="${iconClass}" title="${tooltip}">${documentIconSvg}</span>`;
        addCell(key, html, { descriptionTaskId: t.id });
        return;
      } else if (key === 'projects') {
        const p = (t.projects || []).map((id) => String(id));
        const hasVal = p.length > 0;
        const emptyClass = hasVal ? '' : ' empty';
        if (hasVal) {
          const labels = p.map((id) => projectIdToShortName(id)).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
          const names = labels.map((s) => String(s).replace(/</g, '&lt;')).join(', ');
          html = folderOpenSvg + '<span class="cell-value">' + names + '</span>';
        } else {
          html = '<span class="project-icon-wrap empty">' + folderOpenSvg + '</span><span class="cell-value empty" title="Click to add projects">—</span>';
        }
        addCell(key, html, { projectsTaskId: t.id, projectsJson: JSON.stringify(p) });
        return;
      } else if (key === 'tags') {
        const tg = (t.tags || []);
        const hasVal = tg.length > 0;
        html = hasVal ? `<span class="cell-value">${tg.join(', ').replace(/</g, '&lt;')}</span>` : `<span class="cell-value empty" title="No tags">—</span>`;
      }
      addCell(key, html);
    });

    const statusCell = row.querySelector('.status-cell');
    if (statusCell) {
      statusCell.classList.add('task-cell-clickable');
      statusCell.addEventListener('click', (ev) => updateTaskStatus(t.id, ev));
    }
    const flaggedCell = row.querySelector('.flagged-cell');
    if (flaggedCell && flaggedCell.dataset.flaggedTaskId) {
      flaggedCell.classList.add('task-cell-clickable');
      flaggedCell.addEventListener('click', (ev) => updateTaskFlag(t.id, ev));
    }
    row.querySelectorAll('[data-date-field]').forEach((cell) => {
      cell.classList.add('task-cell-clickable');
      cell.addEventListener('click', (ev) => openDateDropdown(ev, cell));
    });
    const projectsCell = row.querySelector('.projects-cell');
    if (projectsCell && projectsCell.dataset.projectsTaskId) {
      projectsCell.classList.add('task-cell-clickable');
      projectsCell.addEventListener('click', (ev) => openProjectsDropdown(ev, projectsCell));
    }
    const descriptionCell = row.querySelector('.description-cell');
    if (descriptionCell && descriptionCell.dataset.descriptionTaskId) {
      descriptionCell.classList.add('task-cell-clickable');
      descriptionCell.addEventListener('click', (ev) => openDescriptionModal(ev, descriptionCell));
    }
    const priorityCell = row.querySelector('.priority-cell');
    if (priorityCell && priorityCell.dataset.priorityTaskId) {
      priorityCell.classList.add('task-cell-clickable');
      priorityCell.addEventListener('click', (ev) => openPriorityDropdown(ev, priorityCell));
    }
    const titleCell = row.querySelector('.title-cell');
    if (titleCell && titleCell.dataset.titleTaskId) {
      titleCell.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        startTitleEdit(titleCell);
      });
    }

    return row;
  }

  function startTitleEdit(titleCell) {
    const row = titleCell.closest('.task-row');
    const taskId = row && row.dataset.id;
    if (!taskId) return;
    const span = titleCell.querySelector('.cell-value');
    const currentTitle = (span && span.textContent || '').trim() || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'task-title-edit-input';
    input.value = currentTitle;
    input.setAttribute('aria-label', 'Edit task title');
    titleCell.innerHTML = '';
    titleCell.appendChild(input);
    input.focus();
    input.select();

    function saveAndClose() {
      const newTitle = (input.value || '').trim();
      const displayTitle = newTitle || '(no title)';
      titleCell.innerHTML = `<span class="cell-value">${displayTitle.replace(/</g, '&lt;')}</span>`;
      if (newTitle !== currentTitle) {
        updateTask(taskId, { title: newTitle }).then((updated) => {
          if (updated) updateTaskInLists(updated);
          const inspectorTitle = document.getElementById('inspector-title');
          if (row.classList.contains('selected') && inspectorTitle && inspectorTitle.textContent.startsWith('Task')) {
            loadTaskDetails(taskId);
          }
        }).catch((e) => console.error('Failed to update title:', e));
      }
    }

    function cancel() {
      titleCell.innerHTML = `<span class="cell-value">${(currentTitle || '(no title)').replace(/</g, '&lt;')}</span>`;
    }

    let cancelled = false;
    input.addEventListener('blur', () => {
      if (!cancelled) saveAndClose();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelled = true;
        cancel();
        input.blur();
      }
    });
  }

  function renderTaskList(tasks, source) {
    lastTasks = tasks || [];
    lastTaskSource = source;
    const center = document.getElementById('center-content');
    if (!tasks || !tasks.length) {
      displayedTasks = [];
      center.innerHTML = '<p class="placeholder">No tasks.</p>';
      return;
    }
    const src = source != null ? source : 'project';
    const { showCompleted, sortBy, manualSort, manualOrder } = getDisplayProperties(src);
    let toShow = showCompleted ? tasks : tasks.filter((t) => !isTaskCompleted(t));
    if (manualSort && manualOrder && manualOrder.length) {
      toShow = orderTasksByManual(toShow, manualOrder);
    } else if (sortBy && sortBy.length) {
      toShow = orderTasksBySort(toShow, sortBy);
    }
    displayedTasks = [...toShow];
    if (!toShow.length) {
      center.innerHTML = '<p class="placeholder">No tasks.</p>';
      return;
    }
    const ul = document.createElement('ul');
    ul.className = 'task-list';
    ul.style.listStyle = 'none';
    ul.style.padding = '0';
    ul.style.margin = '0';
    toShow.forEach((t) => ul.appendChild(buildTaskRow(t)));
    center.innerHTML = '';
    center.appendChild(ul);
    if (manualSort) setupTaskListDrag(center, ul, src);
  }

  function setupTaskListDrag(center, listEl, source) {
    const ctx = source != null ? source : 'project';
    listEl.querySelectorAll('.task-row').forEach((row) => {
      const handle = row.querySelector('.task-row-move');
      if (!handle) return;
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        let dragged = row;
        row.classList.add('dragging');
        const onMove = (e2) => {
          if (!dragged) return;
          const items = Array.from(listEl.querySelectorAll('.task-row'));
          const y = e2.clientY;
          let idx = items.findIndex((item) => item.getBoundingClientRect().top + item.offsetHeight / 2 > y);
          if (idx < 0) idx = items.length;
          const curIdx = items.indexOf(dragged);
          if (curIdx !== idx && idx !== curIdx + 1) {
            if (idx > curIdx) idx--;
            listEl.insertBefore(dragged, listEl.children[idx]);
          }
        };
        const onUp = () => {
          if (dragged) dragged.classList.remove('dragging');
          dragged = null;
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          const newOrder = Array.from(listEl.querySelectorAll('.task-row')).map((r) => r.dataset.id).filter(Boolean);
          const { order: o, visible: v, showFlagged: sf, showCompleted: sc, showHighlightDue: sh, sortBy: sb } = getDisplayProperties(ctx);
          saveDisplayProperties(ctx, o, v, sf, sc, sh, sb, true, newOrder);
          refreshTaskList();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });
  }

  function onTaskClick(ev) {
    const row = ev.currentTarget;
    if (!row.classList.contains('task-row')) return;
    ev.stopPropagation();
    document.querySelectorAll('#center-content .task-row').forEach((x) => x.classList.remove('selected'));
    row.classList.add('selected');
    const id = row.dataset.id;
    const num = row.dataset.number;
    document.getElementById('inspector-title').textContent = `Task ${num || id || ''}`;
    document.getElementById('inspector-content').innerHTML = '<p class="placeholder">Loading…</p>';
    if (id) loadTaskDetails(id);
  }

  // --- Inbox (tasks with no project) ---
  function onInboxClick() {
    if (inboxItem) inboxItem.classList.add('selected');
    projectsList.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
    document.getElementById('center-title').textContent = 'Inbox';
    document.getElementById('center-content').innerHTML = '<p class="placeholder">Loading…</p>';
    document.getElementById('inspector-title').textContent = 'Inspector';
    document.getElementById('inspector-content').innerHTML = '<p class="placeholder">Select an item to inspect.</p>';
    loadInboxTasks();
  }

  async function loadInboxTasks() {
    try {
      const tasks = await api('/api/external/tasks?limit=500');
      const inbox = (tasks || []).filter((t) => !t.projects || t.projects.length === 0);
      const center = document.getElementById('center-content');
      if (!inbox.length) {
        center.innerHTML = '<p class="placeholder">No tasks without a project.</p>';
        lastTasks = [];
        lastTaskSource = null;
        return;
      }
      renderTaskList(inbox, 'inbox');
    } catch (e) {
      document.getElementById('center-content').innerHTML = '<p class="placeholder">' + (e.message || 'Error') + '</p>';
      lastTasks = [];
      lastTaskSource = null;
    }
  }

  // --- Load projects (left panel) ---
  async function loadProjects() {
    const key = getApiKey();
    if (!key) {
      projectsList.innerHTML = '<li class="nav-item placeholder">Set API key in Settings</li>';
      return;
    }
    if (!normalizedPrioritiesThisSession) {
      try {
        await api('/api/external/tasks/normalize-priorities', { method: 'POST' });
        normalizedPrioritiesThisSession = true;
      } catch (_) {}
    }
    try {
      const list = await api('/api/external/projects');
      projectListCache = Array.isArray(list) ? list : [];
      if (!projectListCache.length) {
        projectsList.innerHTML = '<li class="nav-item placeholder">No projects</li>';
        return;
      }
      projectListCache.sort((a, b) => {
        const nameA = (a.name || a.short_id || '').toString().toLowerCase();
        const nameB = (b.name || b.short_id || '').toString().toLowerCase();
        return nameA.localeCompare(nameB, undefined, { numeric: true });
      });
      projectsList.innerHTML = projectListCache.map((p) => {
        const name = (p.name || p.short_id || 'Project').replace(/</g, '&lt;');
        const shortId = (p.short_id || '').replace(/</g, '&lt;');
        return `<li class="nav-item" data-type="project" data-id="${(p.id || '').replace(/"/g, '&quot;')}" data-short-id="${shortId}">${name}${shortId ? ` (${shortId})` : ''}</li>`;
      }).join('');
      projectsList.querySelectorAll('.nav-item').forEach((el) => {
        el.addEventListener('click', onProjectClick);
      });
    } catch (e) {
      projectListCache = [];
      projectsList.innerHTML = `<li class="nav-item placeholder">${e.message || 'Error'}</li>`;
    }
  }

  function onProjectClick(ev) {
    const li = ev.currentTarget;
    if (li.classList.contains('placeholder')) return;
    if (inboxItem) inboxItem.classList.remove('selected');
    projectsList.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
    li.classList.add('selected');
    const type = li.dataset.type;
    const id = li.dataset.id;
    document.getElementById('center-title').textContent = type === 'project' ? (li.textContent.trim() || 'Project') : 'List';
    document.getElementById('center-content').innerHTML = '<p class="placeholder">Loading tasks…</p>';
    document.getElementById('inspector-title').textContent = 'Project';
    document.getElementById('inspector-content').innerHTML = '<p class="placeholder">Loading…</p>';
    if (type === 'project' && id) {
      loadProjectDetails(id);
      loadProjectTasks(id);
    } else {
      document.getElementById('inspector-content').innerHTML = '<p class="placeholder">Select an item to inspect.</p>';
    }
  }

  const PROJECT_INSPECTOR_KEYS = [
    ['name', 'Name'],
    ['short_id', 'Short ID'],
    ['status', 'Status'],
    ['description', 'Description'],
    ['created_at', 'Created'],
    ['updated_at', 'Updated'],
  ];
  const TASK_INSPECTOR_KEYS = [
    ['number', 'Number'],
    ['title', 'Title'],
    ['status', 'Status'],
    ['description', 'Description'],
    ['notes', 'Notes'],
    ['priority', 'Priority'],
    ['available_date', 'Available date'],
    ['due_date', 'Due date'],
    ['created_at', 'Created'],
    ['updated_at', 'Updated'],
    ['completed_at', 'Completed'],
    ['flagged', 'Flagged'],
    ['projects', 'Projects'],
    ['tags', 'Tags'],
    ['depends_on', 'Depends on'],
    ['recurrence', 'Recurrence'],
  ];

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/</g, '&lt;').replace(/\n/g, '<br>').replace(/"/g, '&quot;');
  }
  const DATE_INSPECTOR_KEYS = ['due_date', 'available_date', 'created_at', 'updated_at', 'completed_at'];

  function formatInspectorValue(key, value) {
    if (value == null || value === '') return null;
    if (key === 'description' || key === 'notes') return escapeHtml(value);
    if (Array.isArray(value)) return value.length ? escapeHtml(value.join(', ')) : null;
    if (typeof value === 'object') return escapeHtml(JSON.stringify(value));
    if (key === 'flagged') return value ? 'Yes' : 'No';
    if (DATE_INSPECTOR_KEYS.includes(key)) return formatDate(value);
    return escapeHtml(String(value));
  }

  async function loadProjectDetails(projectIdOrShortId) {
    try {
      const p = await api(`/api/external/projects/${encodeURIComponent(projectIdOrShortId)}`);
      const div = document.getElementById('inspector-content');
      const titleEl = document.getElementById('inspector-title');
      titleEl.textContent = (p.name || '(no name)').trim();
      let html = '';
      PROJECT_INSPECTOR_KEYS.forEach(([key, label]) => {
        if (!(key in p)) return;
        const val = formatInspectorValue(key, p[key]);
        if (val === null && key !== 'description' && key !== 'notes') return;
        if (key === 'description' || key === 'notes') {
          html += `<p><strong>${label}</strong></p><p class="inspector-block">${val || '—'}</p>`;
        } else {
          html += `<p><strong>${label}:</strong> ${val !== null ? val : '—'}</p>`;
        }
      });
      div.innerHTML = html || '<p class="placeholder">No details.</p>';
    } catch (e) {
      document.getElementById('inspector-title').textContent = 'Inspector';
      document.getElementById('inspector-content').innerHTML = `<p class="placeholder">${e.message || 'Error loading project.'}</p>`;
    }
  }

  async function loadProjectTasks(projectIdOrShortId) {
    try {
      const tasks = await api(`/api/external/tasks?project_id=${encodeURIComponent(projectIdOrShortId)}`);
      const center = document.getElementById('center-content');
      if (!tasks || !tasks.length) {
        center.innerHTML = '<p class="placeholder">No tasks in this project.</p>';
        lastTasks = [];
        lastTaskSource = null;
        return;
      }
      renderTaskList(tasks, projectIdOrShortId);
    } catch (e) {
      document.getElementById('center-content').innerHTML = `<p class="placeholder">${e.message || 'Error loading tasks'}</p>`;
      lastTasks = [];
      lastTaskSource = null;
    }
  }


  async function loadTaskDetails(taskId) {
    try {
      const t = await api(`/api/external/tasks/${encodeURIComponent(taskId)}`);
      const div = document.getElementById('inspector-content');
      let html = '';
      TASK_INSPECTOR_KEYS.forEach(([key, label]) => {
        if (!(key in t)) return;
        const val = formatInspectorValue(key, t[key]);
        if (val === null && key !== 'description' && key !== 'notes') return;
        if (key === 'description' || key === 'notes') {
          html += `<p><strong>${label}</strong></p><p class="inspector-block">${val || '—'}</p>`;
        } else {
          html += `<p><strong>${label}:</strong> ${val !== null ? val : '—'}</p>`;
        }
      });
      div.innerHTML = html || '<p class="placeholder">No details.</p>';
    } catch (e) {
      document.getElementById('inspector-content').innerHTML = `<p class="placeholder">${e.message || 'Error'}</p>`;
    }
  }

  // --- Chat ---
  function appendChatMessage(role, text) {
    hideTypingIndicator();
    const wrap = document.createElement('div');
    wrap.className = `chat-message ${role}`;
    const escaped = String(text).replace(/</g, '&lt;').replace(/\n/g, '<br>');
    wrap.innerHTML = `<div class="bubble"><span class="text">${escaped}</span></div>`;
    chatMessages.appendChild(wrap);
    scrollChatToBottom();
  }
  function showTypingIndicator() {
    if (chatTyping) chatTyping.classList.add('visible');
    scrollChatToBottom();
  }
  function hideTypingIndicator() {
    if (chatTyping) chatTyping.classList.remove('visible');
  }
  function scrollChatToBottom() {
    const wrap = chatMessages && chatMessages.parentElement;
    if (wrap && wrap.classList.contains('chat-messages-wrap')) {
      wrap.scrollTop = wrap.scrollHeight;
    } else if (chatMessages) {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  }

  const chatClear = document.getElementById('chat-clear');
  if (chatClear) {
    chatClear.addEventListener('click', () => {
      if (chatMessages) chatMessages.innerHTML = '';
      hideTypingIndicator();
    });
  }

  chatSend.addEventListener('click', sendChat);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  });

  async function sendChat() {
    const msg = (chatInput.value || '').trim();
    if (!msg) return;
    if (!getApiKey()) {
      appendChatMessage('model', 'Set API key (e.g. in Settings) to use chat.');
      return;
    }
    chatInput.value = '';
    appendChatMessage('user', msg);
    chatSend.disabled = true;
    showTypingIndicator();
    try {
      const data = await api('/api/external/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      appendChatMessage('model', data.response || '(no response)');
    } catch (e) {
      appendChatMessage('model', `Error: ${e.message}`);
    } finally {
      hideTypingIndicator();
      chatSend.disabled = false;
      scrollChatToBottom();
    }
  }

  // --- Resize chat (drag separator) ---
  if (chatResizeHandle && rightPanel && inspectorContent) {
    const MIN_INSPECTOR = 80;
    const MIN_CHAT = 120;
    let dragStartY = 0;
    let dragStartHeight = 0;
    chatResizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      dragStartY = e.clientY;
      dragStartHeight = inspectorContent.getBoundingClientRect().height;
      const onMove = (e2) => {
        const dy = e2.clientY - dragStartY;
        const panelRect = rightPanel.getBoundingClientRect();
        const newH = Math.max(MIN_INSPECTOR, Math.min(panelRect.height - MIN_CHAT, dragStartHeight + dy));
        rightPanel.style.setProperty('--inspector-height', `${newH}px`);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const h = inspectorContent.getBoundingClientRect().height;
        if (typeof h === 'number' && h >= MIN_INSPECTOR) {
          try { localStorage.setItem(INSPECTOR_HEIGHT_KEY, String(Math.round(h))); } catch (_) {}
        }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // Restore persisted inspector/chat height on load
  if (rightPanel) {
    try {
      const saved = localStorage.getItem(INSPECTOR_HEIGHT_KEY);
      if (saved != null && saved !== '') {
        const px = parseInt(saved, 10);
        if (Number.isFinite(px) && px >= 80) {
          rightPanel.style.setProperty('--inspector-height', `${px}px`);
        }
      }
    } catch (_) {}
  }

  // --- Left panel width resize (drag vertical border) + persist ---
  const mainArea = document.querySelector('.main-area');
  const leftPanelResizeHandle = document.getElementById('left-panel-resize-handle');
  if (leftPanelResizeHandle && leftPanel && mainArea) {
    leftPanelResizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = leftPanel.getBoundingClientRect().width;
      const onMove = (e2) => {
        const dx = e2.clientX - startX;
        let newW = Math.round(startWidth + dx);
        newW = Math.max(MIN_LEFT_PANEL_WIDTH, Math.min(MAX_LEFT_PANEL_WIDTH, newW));
        mainArea.style.setProperty('--left-panel-width', `${newW}px`);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const w = leftPanel.getBoundingClientRect().width;
        if (Number.isFinite(w) && w >= MIN_LEFT_PANEL_WIDTH) {
          try { localStorage.setItem(LEFT_PANEL_WIDTH_KEY, String(Math.round(w))); } catch (_) {}
        }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
  if (mainArea) {
    try {
      const saved = localStorage.getItem(LEFT_PANEL_WIDTH_KEY);
      if (saved != null && saved !== '') {
        const px = parseInt(saved, 10);
        if (Number.isFinite(px) && px >= MIN_LEFT_PANEL_WIDTH && px <= MAX_LEFT_PANEL_WIDTH) {
          mainArea.style.setProperty('--left-panel-width', `${px}px`);
        }
      }
    } catch (_) {}
  }

  // --- Right panel width resize (drag vertical border) + persist ---
  const rightPanelResizeHandle = document.getElementById('right-panel-resize-handle');
  if (rightPanelResizeHandle && rightPanel && mainArea) {
    rightPanelResizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = rightPanel.getBoundingClientRect().width;
      const onMove = (e2) => {
        const dx = e2.clientX - startX;
        let newW = Math.round(startWidth - dx);
        newW = Math.max(MIN_RIGHT_PANEL_WIDTH, Math.min(MAX_RIGHT_PANEL_WIDTH, newW));
        mainArea.style.setProperty('--right-panel-width', `${newW}px`);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const w = rightPanel.getBoundingClientRect().width;
        if (Number.isFinite(w) && w >= MIN_RIGHT_PANEL_WIDTH) {
          try { localStorage.setItem(RIGHT_PANEL_WIDTH_KEY, String(Math.round(w))); } catch (_) {}
        }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
  if (mainArea) {
    try {
      const saved = localStorage.getItem(RIGHT_PANEL_WIDTH_KEY);
      if (saved != null && saved !== '') {
        const px = parseInt(saved, 10);
        if (Number.isFinite(px) && px >= MIN_RIGHT_PANEL_WIDTH && px <= MAX_RIGHT_PANEL_WIDTH) {
          mainArea.style.setProperty('--right-panel-width', `${px}px`);
        }
      }
    } catch (_) {}
  }

  // --- Display settings button & dropdown ---
  const displaySettingsBtn = document.getElementById('display-settings-btn');
  const displayDropdown = document.getElementById('display-settings-dropdown');
  if (displaySettingsBtn && displayDropdown) {
    displaySettingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !displayDropdown.classList.toggle('hidden');
      displaySettingsBtn.setAttribute('aria-expanded', isOpen);
      if (isOpen) renderDisplayDropdown();
    });
    document.addEventListener('click', () => {
      if (!displayDropdown.classList.contains('hidden')) {
        displayDropdown.classList.add('hidden');
        displaySettingsBtn.setAttribute('aria-expanded', 'false');
      }
    });
    displayDropdown.addEventListener('click', (e) => e.stopPropagation());
  }

  const centerRefreshBtn = document.getElementById('center-refresh-btn');
  if (centerRefreshBtn) centerRefreshBtn.addEventListener('click', refreshCenterView);

  function refreshNavigator() {
    loadProjects();
    refreshCenterView();
  }
  const navigatorRefreshBtn = document.getElementById('navigator-refresh-btn');
  if (navigatorRefreshBtn) navigatorRefreshBtn.addEventListener('click', refreshNavigator);

  // --- Init ---
  if (inboxItem) inboxItem.addEventListener('click', onInboxClick);
  checkConnection();
  loadProjects();
  setInterval(checkConnection, 30000);
})();
