(function () {
  'use strict';

  if (typeof window.electronAPI !== 'undefined') {
    document.documentElement.classList.add('electron-app');
    document.addEventListener('click', (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      const href = (a.getAttribute('href') || '').trim();
      if (href.startsWith('http://') || href.startsWith('https://')) {
        e.preventDefault();
        e.stopPropagation();
        window.electronAPI.openExternalUrl(href).catch(() => {});
      }
    }, true);
  }

  const API_BASE_KEY = 'spaztick_api_base';
  const API_KEY_KEY = 'spaztick_api_key';
  const THEME_KEY = 'spaztick_theme';
  const THEMES = ['light', 'dark', 'blue', 'green', 'orange', 'cupertino'];
  const DISPLAY_PROPERTIES_KEY = 'spaztick_display_properties';
  const INSPECTOR_HEIGHT_KEY = 'spaztick_inspector_height';
  const DEFAULT_INSPECTOR_HEIGHT = 220;
  const TASK_LIST_DEFAULT_WIDTHS = {
    title: 180,
    status: 72,
    available_date: 100,
    due_date: 100,
    description: 40,
    projects: 90,
    tags: 80,
    recurrence: 40,
    blocking: 40,
  };
  const TASK_LIST_COLUMN_LABELS = {
    status: 'Status',
    title: 'Name',
    available_date: 'Avail',
    due_date: 'Due',
    description: 'Desc',
    projects: 'Proj',
    tags: 'Tags',
    recurrence: 'Recur',
    blocking: 'Block',
  };
  const TASK_LIST_MIN_WIDTH = 48;
  const TASK_LIST_MOVE_WIDTH = 28;
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
  const SHOW_DUE_OVERDUE_COUNTS_KEY = 'spaztick_show_due_overdue_counts';
  const NAV_SECTION_OPEN_PREFIX = 'spaztick_nav_section_open_';
  const NAV_PROJECT_ORDER_KEY = 'spaztick_nav_project_order';
  const NAV_LIST_ORDER_KEY = 'spaztick_nav_list_order';
  const NAV_FAVORITES_KEY = 'spaztick_favorites';
  const NAV_TAG_SORT_KEY = 'spaztick_nav_tag_sort';
  const NAV_BOARDS_KEY = 'spaztick_boards';
  const NAV_BOARD_ORDER_KEY = 'spaztick_nav_board_order';
  const DEFAULT_OPEN_VIEW_KEY = 'spaztick_default_open_view';
  const TASK_LIST_SEPARATOR_KEY = 'spaztick_task_list_separator';

  const TASK_PROPERTY_KEYS = ['due_date', 'available_date', 'description', 'projects', 'tags', 'recurrence', 'blocking'];
  const TASK_PROPERTY_LABELS = {
    due_date: 'Due date',
    available_date: 'Available date',
    priority: 'Priority',
    description: 'Description',
    projects: 'Projects',
    tags: 'Tags',
    recurrence: 'Recurrence',
    blocking: 'Blocking',
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
  let listsListCache = [];
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
  /** One of: 'overdue' | 'due_today' | 'upcoming' | 'complete' for nav count buckets */
  function taskCountBucket(t) {
    if (t.status === 'complete') return 'complete';
    const due = parseDateOnly(t.due_date);
    if (due && isOverdue(t.due_date)) return 'overdue';
    if (due && isToday(t.due_date)) return 'due_today';
    return 'upcoming';
  }
  function countTasksByBucket(tasks) {
    const c = { overdue: 0, due_today: 0, upcoming: 0, complete: 0 };
    tasks.forEach((t) => { c[taskCountBucket(t)] += 1; });
    return c;
  }
  function renderNavCounts(counts) {
    const o = counts.overdue || 0;
    const d = counts.due_today || 0;
    const u = counts.upcoming || 0;
    const c = counts.complete || 0;
    return `<span class="nav-item-count"><span class="count count-overdue">${o}</span><span class="count count-due-today">${d}</span><span class="count count-upcoming">${u}</span><span class="count count-complete">${c}</span></span>`;
  }
  function renderNavCountsSimple(counts) {
    const incomplete = (counts.overdue || 0) + (counts.due_today || 0) + (counts.upcoming || 0);
    const complete = counts.complete || 0;
    return `<span class="nav-item-count nav-item-count-simple"><span class="count count-incomplete">${incomplete}</span><span class="count count-complete-simple">${complete}</span></span>`;
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
  const settingsDefaultOpenView = document.getElementById('settings-default-open-view');
  const settingsTaskListSeparator = document.getElementById('settings-task-list-separator');
  const customFormatEditBtn = document.getElementById('custom-format-edit-btn');
  const customFormatOverlay = document.getElementById('custom-date-format-overlay');
  const customFormatInput = document.getElementById('custom-format-input');
  const customFormatPreview = document.getElementById('custom-format-preview');
  const customFormatClose = document.getElementById('custom-format-close');
  const customFormatSave = document.getElementById('custom-format-save');
  const descriptionModalOverlay = document.getElementById('description-modal-overlay');
  const descriptionModalClose = document.getElementById('description-modal-close');
  const descriptionEditTextarea = document.getElementById('description-edit-textarea');
  const descriptionNotesLines = document.getElementById('description-notes-lines');
  const descriptionModalSave = document.getElementById('description-modal-save');
  const descriptionTabEdit = document.getElementById('description-tab-edit');
  const descriptionTabPreview = document.getElementById('description-tab-preview');
  const descriptionEditPanel = document.getElementById('description-edit-panel');
  const descriptionPreviewPanel = document.getElementById('description-preview-panel');
  const connectionIndicator = document.getElementById('connection-indicator');
  const themeBtn = document.getElementById('theme-btn');
  const inboxItem = document.getElementById('inbox-item');
  const inboxCountEl = document.getElementById('inbox-count');
  const listsListEl = document.getElementById('lists-list');
  const tagsListEl = document.getElementById('tags-list');
  const tagsSortRow = document.getElementById('tags-sort-row');
  const navigatorAddBtn = document.getElementById('navigator-add-btn');
  const navigatorAddPopover = document.getElementById('navigator-add-popover');

  let lastTasks = [];
  let lastTaskSource = null;
  /** When viewing a list, cache list meta (sort_definition etc.) for display dropdown. */
  let lastListMeta = null;
  let lastSearchQuery = '';
  let displayedTasks = [];
  let currentInspectorTag = null;
  let currentBoardId = null;

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
  function getDefaultOpenView() {
    try {
      const v = localStorage.getItem(DEFAULT_OPEN_VIEW_KEY);
      return (v && typeof v === 'string') ? v : 'inbox';
    } catch (_) {}
    return 'inbox';
  }
  function setDefaultOpenView(value) {
    try {
      localStorage.setItem(DEFAULT_OPEN_VIEW_KEY, value || 'inbox');
    } catch (_) {}
  }
  const TASK_LIST_SEPARATOR_VALUES = ['none', 'dotted', 'shading'];
  function getTaskListSeparator() {
    try {
      const v = localStorage.getItem(TASK_LIST_SEPARATOR_KEY);
      return TASK_LIST_SEPARATOR_VALUES.includes(v) ? v : 'none';
    } catch (_) {}
    return 'none';
  }
  function setTaskListSeparator(value) {
    try {
      localStorage.setItem(TASK_LIST_SEPARATOR_KEY, TASK_LIST_SEPARATOR_VALUES.includes(value) ? value : 'none');
    } catch (_) {}
  }
  function applyTaskListSeparator() {
    const v = getTaskListSeparator();
    TASK_LIST_SEPARATOR_VALUES.forEach((x) => document.body.classList.remove('task-list-sep-' + x));
    document.body.classList.add('task-list-sep-' + v);
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

  const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function renderMarkdownInline(text) {
    if (text == null || text === '') return '';
    let out = escapeHtml(text);
    out = out.replace(/(^|[\s>(])(https?:\/\/[^\s<>"\']+)/g, (_, before, url) => before + '<a href="' + escapeAttr(url) + '" target="_blank" rel="noopener">' + url + '</a>');
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => '<a href="' + escapeAttr(url) + '" target="_blank" rel="noopener">' + label + '</a>');
    out = out.replace(/(?<![.:/A-Za-z0-9-])(#[\w-]+)/g, '<span class="title-tag-pill">$1</span>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
    return out;
  }
  /** Render a single line for display: headings, task checkbox, or inline. lineIndex optional, for checkbox data-line-index. */
  function renderMarkdownLine(line, lineIndex) {
    const s = line;
    const headingMatch = s.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const inner = renderMarkdownInline(headingMatch[2].trim());
      return { html: `<h${level} class="description-line-heading">${inner}</h${level}>`, isCheckbox: false };
    }
    const checkboxMatch = s.match(/^(\s*)([-*])\s+\[([ xX])\]\s+(.*)$/);
    if (checkboxMatch) {
      const checked = checkboxMatch[3].toLowerCase() === 'x';
      const rest = renderMarkdownInline(checkboxMatch[4] || '');
      const idx = lineIndex != null ? String(lineIndex) : '';
      return {
        html: `<label class="description-line-checkbox"><input type="checkbox" ${checked ? 'checked' : ''} data-line-index="${escapeHtml(idx)}" /><span class="description-line-checkbox-text">${rest}</span></label>`,
        isCheckbox: true,
        checked,
      };
    }
    if (s.trim() === '') return { html: '<div class="description-line description-line-empty">&nbsp;</div>', isCheckbox: false };
    const inner = renderMarkdownInline(s);
    return { html: `<div class="description-line description-line-p">${inner}</div>`, isCheckbox: false };
  }
  function renderMarkdown(text) {
    if (!text || typeof text !== 'string') return '';
    const lines = text.split('\n');
    const parts = [];
    for (let i = 0; i < lines.length; i++) {
      const { html } = renderMarkdownLine(lines[i], i);
      parts.push(html);
    }
    return parts.join('');
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

  /** Created/updated/completed: always m/d/yyyy, h:mm am/pm (12-hour, local time). */
  function formatDateTimeForInspector(value) {
    if (value == null || value === '') return null;
    const s = String(value).trim();
    const hasTime = s.indexOf('T') !== -1;
    const d = hasTime ? new Date(s) : parseDateValue(s);
    if (!d || isNaN(d.getTime())) return s.replace(/</g, '&lt;');
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const year = d.getFullYear();
    const datePart = `${month}/${day}/${year}`;
    if (!hasTime) return datePart;
    const h = d.getHours();
    const m = d.getMinutes();
    const am = h < 12;
    const h12 = h % 12 || 12;
    return `${datePart}, ${h12}:${String(m).padStart(2, '0')} ${am ? 'am' : 'pm'}`;
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

  // --- Panel toggles (bottom bar) + sync main-area classes for floating layout (center padding) ---
  const mainArea = document.querySelector('.main-area');
  function syncMainAreaPanelClasses() {
    if (!mainArea) return;
    mainArea.classList.toggle('left-open', leftPanel && !leftPanel.classList.contains('collapsed'));
    mainArea.classList.toggle('left-collapsed', leftPanel && leftPanel.classList.contains('collapsed'));
    mainArea.classList.toggle('right-open', rightPanel && !rightPanel.classList.contains('collapsed'));
    mainArea.classList.toggle('right-collapsed', rightPanel && rightPanel.classList.contains('collapsed'));
  }
  function toggleLeftPanel() {
    leftPanel.classList.toggle('collapsed');
    syncMainAreaPanelClasses();
  }

  function toggleRightPanel() {
    rightPanel.classList.toggle('collapsed');
    syncMainAreaPanelClasses();
  }

  toggleLeft.addEventListener('click', toggleLeftPanel);
  toggleRight.addEventListener('click', toggleRightPanel);
  syncMainAreaPanelClasses();

  function getShowDueOverdueCounts() {
    const v = localStorage.getItem(SHOW_DUE_OVERDUE_COUNTS_KEY);
    return v === null || v === 'true';
  }
  function setShowDueOverdueCounts(show) {
    localStorage.setItem(SHOW_DUE_OVERDUE_COUNTS_KEY, show ? 'true' : 'false');
  }

  // --- Settings modal ---
  const settingsShowDueOverdueCounts = document.getElementById('settings-show-due-overdue-counts');
  function openSettings() {
    settingsApiBase.value = getApiBase();
    settingsApiKey.value = getApiKey();
    if (settingsShowDueOverdueCounts) settingsShowDueOverdueCounts.checked = getShowDueOverdueCounts();
    if (settingsTaskListSeparator) settingsTaskListSeparator.value = getTaskListSeparator();
    if (settingsDateFormat) settingsDateFormat.value = getDateFormat();
    if (customFormatEditBtn) customFormatEditBtn.classList.toggle('hidden', settingsDateFormat?.value !== 'custom');
    if (settingsDefaultOpenView) {
      const current = getDefaultOpenView();
      const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const options = ['<option value="inbox">Inbox</option>'];
      (projectListCache || []).forEach((p) => {
        const id = (p.id || '').replace(/"/g, '&quot;');
        const name = escape(p.name || p.short_id || 'Project');
        options.push(`<option value="project:${id}">Project: ${name}</option>`);
      });
      (getLists ? getLists() : []).forEach((l) => {
        const id = (l.id || '').replace(/"/g, '&quot;');
        const name = escape(l.name || 'List');
        options.push(`<option value="list:${id}">List: ${name}</option>`);
      });
      settingsDefaultOpenView.innerHTML = options.join('');
      settingsDefaultOpenView.value = current;
    }
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
    if (settingsShowDueOverdueCounts) setShowDueOverdueCounts(settingsShowDueOverdueCounts.checked);
    if (settingsTaskListSeparator) setTaskListSeparator(settingsTaskListSeparator.value);
    if (settingsDateFormat) setDateFormat(settingsDateFormat.value);
    if (settingsDefaultOpenView) setDefaultOpenView(settingsDefaultOpenView.value);
    applyTaskListSeparator();
    closeSettings();
    checkConnection();
    loadProjects();
    loadLists();
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

  function exportAppData() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('spaztick_')) data[key] = localStorage.getItem(key);
    }
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'spaztick-data-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function importAppData() {
    const input = document.getElementById('settings-import-data-file');
    if (!input) return;
    input.value = '';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (typeof data !== 'object' || data === null) throw new Error('Invalid format');
          for (const key of Object.keys(data)) {
            if (key.startsWith('spaztick_') && typeof data[key] === 'string') {
              localStorage.setItem(key, data[key]);
            }
          }
          closeSettings();
          window.location.reload();
        } catch (e) {
          alert(e.message || 'Invalid or corrupted file.');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  const settingsExportData = document.getElementById('settings-export-data');
  const settingsImportData = document.getElementById('settings-import-data');
  if (settingsExportData) settingsExportData.addEventListener('click', exportAppData);
  if (settingsImportData) settingsImportData.addEventListener('click', importAppData);

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
  const archivedProjectsOverlay = document.getElementById('archived-projects-overlay');
  const archivedProjectsList = document.getElementById('archived-projects-list');
  const archivedProjectsClose = document.getElementById('archived-projects-close');
  async function openArchivedProjectsModal() {
    if (!archivedProjectsList) return;
    archivedProjectsList.innerHTML = '<p class="placeholder">Loading…</p>';
    if (archivedProjectsOverlay) {
      archivedProjectsOverlay.classList.remove('hidden');
      archivedProjectsOverlay.setAttribute('aria-hidden', 'false');
    }
    try {
      const list = await api('/api/external/projects?status=archived');
      const projects = Array.isArray(list) ? list : [];
      if (!projects.length) {
        archivedProjectsList.innerHTML = '<p class="placeholder">No archived projects.</p>';
        return;
      }
      const escape = (s) => (s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'));
      function archivedDateShort(updatedAt) {
        if (!updatedAt) return '—';
        const d = new Date(updatedAt);
        return isNaN(d.getTime()) ? '—' : `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
      }
      const unarchiveIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M11 5.41421V15C11 15.5523 11.4477 16 12 16C12.5523 16 13 15.5523 13 15V5.41421L15.2929 7.70711C15.6834 8.09763 16.3166 8.09763 16.7071 7.70711C17.0976 7.31658 17.0976 6.68342 16.7071 6.29289L12.7071 2.29289C12.3166 1.90237 11.6834 1.90237 11.2929 2.29289L7.29289 6.29289C6.90237 6.68342 6.90237 7.31658 7.29289 7.70711C7.68342 8.09763 8.31658 8.09763 8.70711 7.70711L11 5.41421ZM2 4C1.44772 4 1 4.44772 1 5C1 5.55228 1.44772 6 2 6H3V17C3 18.6569 4.34315 20 6 20H18C19.6569 20 21 18.6569 21 17V6H22C22.5523 6 23 5.55228 23 5C23 4.44772 22.5523 4 22 4H20C19.4477 4 19 4.44772 19 5V17C19 17.5523 18.5523 18 18 18H6C5.44772 18 5 17.5523 5 17V5C5 4.44772 4.55228 4 4 4H2Z" fill="currentColor"/></svg>';
      const trashIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M18 6L17.1991 18.0129C17.129 19.065 17.0939 19.5911 16.8667 19.99C16.6666 20.3412 16.3648 20.6235 16.0011 20.7998C15.588 21 15.0607 21 14.0062 21H9.99377C8.93927 21 8.41202 21 7.99889 20.7998C7.63517 20.6235 7.33339 20.3412 7.13332 19.99C6.90607 19.5911 6.871 19.065 6.80086 18.0129L6 6M4 6H20M16 6L15.7294 5.18807C15.4671 4.40125 15.3359 4.00784 15.0927 3.71698C14.8779 3.46013 14.6021 3.26132 14.2905 3.13878C13.9376 3 13.523 3 12.6936 3H11.3064C10.477 3 10.0624 3 9.70951 3.13878C9.39792 3.26132 9.12208 3.46013 8.90729 3.71698C8.66405 4.00784 8.53292 4.40125 8.27064 5.18807L8 6M14 10V17M10 10V17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      archivedProjectsList.innerHTML = projects.map((p) => {
        const name = escape(p.name || p.short_id || '');
        const shortId = escape(p.short_id || '');
        const archivedDate = archivedDateShort(p.updated_at);
        const id = (p.id || '').replace(/"/g, '&quot;');
        return `<div class="archived-project-row" data-project-id="${id}">
          <span class="archived-project-name">${name}</span>
          <span class="archived-project-short">${shortId}</span>
          <span class="archived-project-updated">${archivedDate}</span>
          <span class="archived-project-actions">
            <button type="button" class="archived-project-action-btn archived-project-unarchive" data-project-id="${id}" title="Unarchive">${unarchiveIcon}</button>
            <button type="button" class="archived-project-action-btn archived-project-delete" data-project-id="${id}" title="Delete">${trashIcon}</button>
          </span>
        </div>`;
      }).join('');
      archivedProjectsList.querySelectorAll('.archived-project-unarchive').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const pid = btn.dataset.projectId;
          if (!pid || !confirm('Unarchive this project? It will appear in the project list again.')) return;
          try {
            await api(`/api/external/projects/${encodeURIComponent(pid)}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'active' }),
            });
            loadProjects();
            openArchivedProjectsModal();
          } catch (err) {
            alert(err.message || 'Failed to unarchive project.');
          }
        });
      });
      archivedProjectsList.querySelectorAll('.archived-project-delete').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const pid = btn.dataset.projectId;
          if (!pid || !confirm('Delete this project? It will be removed from all tasks. This cannot be undone.')) return;
          try {
            await api(`/api/external/projects/${encodeURIComponent(pid)}`, { method: 'DELETE' });
            loadProjects();
            openArchivedProjectsModal();
          } catch (err) {
            alert(err.message || 'Failed to delete project.');
          }
        });
      });
    } catch (e) {
      archivedProjectsList.innerHTML = `<p class="placeholder">${e.message || 'Error loading archived projects.'}</p>`;
    }
  }
  function closeArchivedProjectsModal() {
    if (archivedProjectsOverlay) {
      archivedProjectsOverlay.classList.add('hidden');
      archivedProjectsOverlay.setAttribute('aria-hidden', 'true');
    }
  }
  const settingsViewArchivedBtn = document.getElementById('settings-view-archived-projects');
  if (settingsViewArchivedBtn) settingsViewArchivedBtn.addEventListener('click', openArchivedProjectsModal);
  if (archivedProjectsClose) archivedProjectsClose.addEventListener('click', closeArchivedProjectsModal);
  if (archivedProjectsOverlay) archivedProjectsOverlay.addEventListener('click', (e) => { if (e.target === archivedProjectsOverlay) closeArchivedProjectsModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (archivedProjectsOverlay && !archivedProjectsOverlay.classList.contains('hidden')) closeArchivedProjectsModal();
      else if (recurrenceModalOverlay && !recurrenceModalOverlay.classList.contains('hidden')) closeRecurrenceModal();
      else if (descriptionModalOverlay && !descriptionModalOverlay.classList.contains('hidden')) closeDescriptionModal();
      else if (customFormatOverlay && !customFormatOverlay.classList.contains('hidden')) closeCustomDateFormatModal();
      else if (!settingsOverlay.classList.contains('hidden')) closeSettings();
    }
  });

  if (customFormatOverlay) {
    customFormatOverlay.addEventListener('click', (e) => { if (e.target === customFormatOverlay) closeCustomDateFormatModal(); });
  }
  if (customFormatClose) customFormatClose.addEventListener('click', closeCustomDateFormatModal);
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
  if (descriptionModalSave) {
    descriptionModalSave.addEventListener('click', async () => {
      const text = descriptionEditTextarea ? descriptionEditTextarea.value : '';
      if (descriptionModalForNewTask) {
        newTaskState.description = text;
        closeDescriptionModal();
        const notesBtn = newTaskModalContent && newTaskModalContent.querySelector('.new-task-notes-btn');
        if (notesBtn) notesBtn.classList.toggle('muted', !text.trim());
        return;
      }
      if (!descriptionModalTaskId) return;
      try {
        const updated = await updateTask(descriptionModalTaskId, { notes: text });
        updateTaskInLists(updated);
        const row = document.querySelector(`.task-row[data-id="${descriptionModalTaskId}"]`);
        const inspectorDiv = document.getElementById('inspector-content');
        if ((row && row.classList.contains('selected')) || (inspectorDiv && inspectorDiv.dataset.taskId === descriptionModalTaskId)) loadTaskDetails(descriptionModalTaskId);
        closeDescriptionModal();
      } catch (e) {
        console.error('Failed to update description:', e);
        alert(e.message || 'Failed to save description.');
      }
    });
  }
  if (descriptionNotesLines) {
    descriptionNotesLines.addEventListener('change', onDescriptionPreviewCheckboxChange);
  }
  function switchDescriptionModalToEdit() {
    if (descriptionTabEdit) descriptionTabEdit.classList.add('active');
    if (descriptionTabPreview) descriptionTabPreview.classList.remove('active');
    if (descriptionTabEdit) descriptionTabEdit.setAttribute('aria-selected', 'true');
    if (descriptionTabPreview) descriptionTabPreview.setAttribute('aria-selected', 'false');
    if (descriptionEditPanel) descriptionEditPanel.classList.remove('hidden');
    if (descriptionPreviewPanel) descriptionPreviewPanel.classList.add('hidden');
    if (descriptionEditTextarea) descriptionEditTextarea.focus();
  }
  function switchDescriptionModalToPreview() {
    updateDescriptionPreview();
    if (descriptionTabEdit) descriptionTabEdit.classList.remove('active');
    if (descriptionTabPreview) descriptionTabPreview.classList.add('active');
    if (descriptionTabEdit) descriptionTabEdit.setAttribute('aria-selected', 'false');
    if (descriptionTabPreview) descriptionTabPreview.setAttribute('aria-selected', 'true');
    if (descriptionEditPanel) descriptionEditPanel.classList.add('hidden');
    if (descriptionPreviewPanel) descriptionPreviewPanel.classList.remove('hidden');
  }
  if (descriptionTabEdit) {
    descriptionTabEdit.addEventListener('click', () => switchDescriptionModalToEdit());
  }
  if (descriptionTabPreview) {
    descriptionTabPreview.addEventListener('click', () => switchDescriptionModalToPreview());
  }

  const TAG_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;
  function validateTagName(name) {
    const s = (name || '').trim();
    if (!s) return null;
    if (!TAG_NAME_REGEX.test(s)) return null;
    return s;
  }
  // --- Recurrence modal ---
  const recurrenceModalOverlay = document.getElementById('recurrence-modal-overlay');
  let recurrenceModalTaskId = null;
  /** When set, recurrence modal is in "new task" mode; on Save call this with recurrence object and close. */
  let recurrenceModalForNewTaskCallback = null;
  let recurrenceModalCleared = false;
  /** True only when user clicked "Clear recurrence"; used so we send null only then, not when opening for a task with no recurrence. */
  let recurrenceUserClickedClear = false;

  function recurrenceIntervalUnit() {
    const freq = (document.getElementById('recurrence-freq') && document.getElementById('recurrence-freq').value) || 'daily';
    const intervalEl = document.getElementById('recurrence-interval');
    const n = Math.max(1, parseInt(intervalEl && intervalEl.value, 10) || 1);
    const plural = n !== 1;
    const units = { daily: ['day', 'days'], weekly: ['week', 'weeks'], monthly: ['month', 'months'], yearly: ['year', 'years'] };
    const pair = units[freq] || units.daily;
    return plural ? pair[1] : pair[0];
  }
  function updateRecurrenceFreqOptions() {
    const freq = document.getElementById('recurrence-freq') && document.getElementById('recurrence-freq').value;
    const unitEl = document.getElementById('recurrence-interval-unit');
    if (unitEl) unitEl.textContent = recurrenceIntervalUnit();
    ['weekly', 'monthly', 'yearly'].forEach((name) => {
      const el = document.getElementById('recurrence-' + name + '-options');
      if (el) el.classList.toggle('hidden', freq !== name);
    });
  }
  function recurrenceFormToObject() {
    const anchorEl = document.getElementById('recurrence-anchor');
    const freqEl = document.getElementById('recurrence-freq');
    const intervalEl = document.getElementById('recurrence-interval');
    const freq = (freqEl && freqEl.value) || 'daily';
    const interval = Math.max(1, parseInt(intervalEl && intervalEl.value, 10) || 1);
    const rec = {
      anchor: (anchorEl && anchorEl.value) || 'scheduled',
      freq,
      interval,
      end_condition: 'never',
    };
    const endEl = document.querySelector('input[name="recurrence-end"]:checked');
    const endVal = endEl && endEl.value;
    if (endVal === 'after_count') {
      const n = document.getElementById('recurrence-end-after-count');
      rec.end_condition = 'after_count';
      rec.end_after_count = Math.max(1, parseInt(n && n.value, 10) || 1);
    } else if (endVal === 'end_date') {
      const d = document.getElementById('recurrence-end-date') && document.getElementById('recurrence-end-date').value;
      if (d) {
        rec.end_condition = 'end_date';
        rec.end_date = d;
      }
    }
    if (freq === 'weekly') {
      const days = [];
      document.querySelectorAll('#recurrence-weekly-options input[type="checkbox"]:checked').forEach((cb) => {
        const day = parseInt(cb.dataset.day, 10);
        if (!Number.isNaN(day)) days.push(day);
      });
      if (days.length) rec.by_weekday = days.sort((a, b) => a - b);
    }
    if (freq === 'monthly') {
      const ruleEl = document.querySelector('input[name="recurrence-monthly-rule"]:checked');
      const rule = ruleEl && ruleEl.value;
      if (rule === 'day_of_month') {
        const dayEl = document.getElementById('recurrence-monthly-day');
        rec.monthly_rule = 'day_of_month';
        rec.monthly_day = Math.min(31, Math.max(1, parseInt(dayEl && dayEl.value, 10) || 1));
      } else {
        const weekEl = document.getElementById('recurrence-monthly-week');
        const wdayEl = document.getElementById('recurrence-monthly-weekday');
        rec.monthly_rule = 'weekday_of_month';
        rec.monthly_week = parseInt(weekEl && weekEl.value, 10) || 1;
        rec.monthly_weekday = parseInt(wdayEl && wdayEl.value, 10) || 0;
      }
    }
    if (freq === 'yearly') {
      const mEl = document.getElementById('recurrence-yearly-month');
      const dEl = document.getElementById('recurrence-yearly-day');
      rec.yearly_month = Math.min(12, Math.max(1, parseInt(mEl && mEl.value, 10) || 1));
      rec.yearly_day = Math.min(31, Math.max(1, parseInt(dEl && dEl.value, 10) || 1));
    }
    return rec;
  }
  function recurrencePopulateForm(rec) {
    recurrenceModalCleared = !rec || typeof rec !== 'object';
    if (!rec || typeof rec !== 'object') {
      const anchorSelect = document.getElementById('recurrence-anchor');
      if (anchorSelect) anchorSelect.value = 'scheduled';
      const f = document.getElementById('recurrence-freq');
      if (f) f.value = 'daily';
      const i = document.getElementById('recurrence-interval');
      if (i) i.value = '1';
      updateRecurrenceFreqOptions();
      document.querySelectorAll('#recurrence-weekly-options input[type="checkbox"]').forEach((cb) => { cb.checked = false; });
      document.querySelectorAll('input[name="recurrence-monthly-rule"]').forEach((r) => { r.checked = r.value === 'day_of_month'; });
      const md = document.getElementById('recurrence-monthly-day');
      if (md) md.value = '1';
      document.querySelectorAll('input[name="recurrence-end"]').forEach((r) => { r.checked = r.value === 'never'; });
      document.getElementById('recurrence-end-after-count').value = '5';
      const ed = document.getElementById('recurrence-end-date');
      if (ed) ed.value = '';
      return;
    }
    const anchorSelect = document.getElementById('recurrence-anchor');
    if (anchorSelect) anchorSelect.value = rec.anchor || 'scheduled';
    const f = document.getElementById('recurrence-freq');
    if (f) f.value = rec.freq || 'daily';
    const i = document.getElementById('recurrence-interval');
    if (i) i.value = String(rec.interval != null ? rec.interval : 1);
    updateRecurrenceFreqOptions();
    const byWeekday = rec.by_weekday || [];
    document.querySelectorAll('#recurrence-weekly-options input[type="checkbox"]').forEach((cb) => {
      const day = parseInt(cb.dataset.day, 10);
      cb.checked = byWeekday.indexOf(day) !== -1;
    });
    if (rec.monthly_rule === 'weekday_of_month') {
      document.querySelectorAll('input[name="recurrence-monthly-rule"]').forEach((r) => { r.checked = r.value === 'weekday_of_month'; });
      const w = document.getElementById('recurrence-monthly-week');
      const wd = document.getElementById('recurrence-monthly-weekday');
      if (w) w.value = String(rec.monthly_week != null ? rec.monthly_week : 1);
      if (wd) wd.value = String(rec.monthly_weekday != null ? rec.monthly_weekday : 0);
    } else {
      document.querySelectorAll('input[name="recurrence-monthly-rule"]').forEach((r) => { r.checked = r.value === 'day_of_month'; });
      const md = document.getElementById('recurrence-monthly-day');
      if (md) md.value = String(rec.monthly_day != null ? rec.monthly_day : 1);
    }
    document.querySelectorAll('input[name="recurrence-end"]').forEach((r) => {
      r.checked = (r.value === (rec.end_condition || 'never'));
    });
    const eac = document.getElementById('recurrence-end-after-count');
    if (eac) eac.value = String(rec.end_after_count != null ? rec.end_after_count : 5);
    const ed = document.getElementById('recurrence-end-date');
    if (ed) ed.value = rec.end_date || '';
    const ym = document.getElementById('recurrence-yearly-month');
    const yd = document.getElementById('recurrence-yearly-day');
    if (ym) ym.value = String(rec.yearly_month != null ? rec.yearly_month : 1);
    if (yd) yd.value = String(rec.yearly_day != null ? rec.yearly_day : 1);
    recurrenceModalCleared = false;
  }

  function hasDueDate(task) {
    const d = (task && task.due_date != null && task.due_date !== '') ? String(task.due_date).trim().substring(0, 10) : '';
    return /^\d{4}-\d{2}-\d{2}$/.test(d);
  }

  function openRecurrenceModal(taskId, options) {
    recurrenceModalTaskId = taskId;
    recurrenceModalForNewTaskCallback = (options && options.forNewTask && options.onSave) ? options.onSave : null;
    recurrenceUserClickedClear = false;
    function showRecurrenceForm(rec, canSetRecurrence) {
      recurrencePopulateForm(rec || null);
      const noDueMsg = document.getElementById('recurrence-no-due-date-msg');
      const formBody = document.getElementById('recurrence-form-body');
      const saveBtn = document.getElementById('recurrence-modal-save');
      if (noDueMsg) noDueMsg.classList.toggle('hidden', canSetRecurrence);
      if (formBody) formBody.classList.toggle('hidden', !canSetRecurrence);
      if (saveBtn) {
        saveBtn.disabled = !canSetRecurrence;
        saveBtn.title = canSetRecurrence ? '' : 'Set a due date for this task first';
      }
      if (recurrenceModalOverlay) {
        recurrenceModalOverlay.classList.remove('hidden');
        recurrenceModalOverlay.setAttribute('aria-hidden', 'false');
      }
    }
    if (taskId == null && recurrenceModalForNewTaskCallback) {
      const dueDate = (options && options.dueDate) ? String(options.dueDate).trim().substring(0, 10) : '';
      const canSet = /^\d{4}-\d{2}-\d{2}$/.test(dueDate);
      showRecurrenceForm((options && options.initialRecurrence) || null, canSet);
      return;
    }
    if (!taskId) return;
    api(`/api/external/tasks/${encodeURIComponent(taskId)}`)
      .then((task) => {
        showRecurrenceForm(task.recurrence || null, hasDueDate(task));
      })
      .catch((e) => {
        console.error('Failed to load task for recurrence:', e);
        alert(e.message || 'Failed to load task.');
      });
  }
  function closeRecurrenceModal() {
    recurrenceModalTaskId = null;
    recurrenceModalForNewTaskCallback = null;
    if (recurrenceModalOverlay) {
      recurrenceModalOverlay.classList.add('hidden');
      recurrenceModalOverlay.setAttribute('aria-hidden', 'true');
    }
  }

  if (recurrenceModalOverlay) {
    recurrenceModalOverlay.addEventListener('click', (e) => { if (e.target === recurrenceModalOverlay) closeRecurrenceModal(); });
  }
  const recurrenceModalClose = document.getElementById('recurrence-modal-close');
  if (recurrenceModalClose) recurrenceModalClose.addEventListener('click', closeRecurrenceModal);
  async function saveRecurrenceModal() {
    const saveBtn = document.getElementById('recurrence-modal-save');
    if (saveBtn && saveBtn.disabled) return;
    const rec = recurrenceUserClickedClear ? null : recurrenceFormToObject();
    if (recurrenceModalForNewTaskCallback) {
      recurrenceModalForNewTaskCallback(rec);
      closeRecurrenceModal();
      return;
    }
    if (!recurrenceModalTaskId) return;
    try {
      const updated = await updateTask(recurrenceModalTaskId, { recurrence: rec });
      updateTaskInLists(updated);
      const row = document.querySelector(`.task-row[data-id="${recurrenceModalTaskId}"]`);
      const inspectorDiv = document.getElementById('inspector-content');
      if ((row && row.classList.contains('selected')) || (inspectorDiv && inspectorDiv.dataset.taskId === recurrenceModalTaskId)) loadTaskDetails(recurrenceModalTaskId);
      closeRecurrenceModal();
      refreshTaskList();
    } catch (e) {
      console.error('Failed to save recurrence:', e);
      alert(e.message || 'Failed to save recurrence.');
    }
  }
  const recurrenceModalSave = document.getElementById('recurrence-modal-save');
  if (recurrenceModalSave) {
    recurrenceModalSave.addEventListener('click', () => saveRecurrenceModal());
  }
  const recurrenceClearAndSaveBtn = document.getElementById('recurrence-clear-and-save');
  if (recurrenceClearAndSaveBtn) {
    recurrenceClearAndSaveBtn.addEventListener('click', () => {
      recurrenceUserClickedClear = true;
      recurrenceModalCleared = true;
      recurrencePopulateForm(null);
      saveRecurrenceModal();
    });
  }

  const blockingModalOverlay = document.getElementById('blocking-modal-overlay');
  const blockingModalClose = document.getElementById('blocking-modal-close');
  let blockingModalTaskId = null;
  let blockingModalTaskLabelMap = {}; // id -> { number, title }

  function taskToLabel(t) {
    if (!t) return '(unknown)';
    const num = t.number != null ? `#${t.number}` : '';
    const title = (t.title || '').trim() || '(no title)';
    return num ? `${num} ${title}` : title;
  }

  async function openBlockingModal(taskId) {
    if (!taskId) return;
    blockingModalTaskId = taskId;
    try {
      const [task, allTasks] = await Promise.all([
        api(`/api/external/tasks/${encodeURIComponent(taskId)}`),
        api('/api/external/tasks?limit=500'),
      ]);
      const taskList = Array.isArray(allTasks) ? allTasks : [];
      blockingModalTaskLabelMap = {};
      taskList.forEach((t) => {
        if (t && t.id) blockingModalTaskLabelMap[t.id] = { number: t.number, title: t.title };
      });
      if (task && task.id) blockingModalTaskLabelMap[task.id] = { number: task.number, title: task.title };

      const dependsOn = Array.isArray(task.depends_on) ? task.depends_on : [];
      const blocks = Array.isArray(task.blocks) ? task.blocks : [];

      const blockedByList = document.getElementById('blocking-modal-blocked-by-list');
      const blocksList = document.getElementById('blocking-modal-blocks-list');
      const addBlockedBySelect = document.getElementById('blocking-add-blocked-by');
      const addBlocksSelect = document.getElementById('blocking-add-blocks');

      function renderBlockedBy() {
        blockedByList.innerHTML = dependsOn.map((id) => {
          const lab = blockingModalTaskLabelMap[id] ? taskToLabel(blockingModalTaskLabelMap[id]) : (id.substring(0, 8) + '…');
          const esc = lab.replace(/</g, '&lt;').replace(/"/g, '&quot;');
          return `<li class="blocking-list-item" data-task-id="${(id || '').replace(/"/g, '&quot;')}">
            <span class="blocking-item-label">${esc}</span>
            <button type="button" class="blocking-remove-btn" data-task-id="${(id || '').replace(/"/g, '&quot;')}" aria-label="Remove">×</button>
          </li>`;
        }).join('');
        blockedByList.querySelectorAll('.blocking-remove-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const depId = btn.dataset.taskId;
            if (!depId) return;
            try {
              await api(`/api/external/tasks/${encodeURIComponent(taskId)}/dependencies/${encodeURIComponent(depId)}`, { method: 'DELETE' });
              const idx = dependsOn.indexOf(depId);
              if (idx !== -1) dependsOn.splice(idx, 1);
              removeBoardConnectionsBetweenTasks(taskId, depId);
              if (currentBoardId) refreshBoardAfterTaskUpdate(currentBoardId).catch(() => {});
              renderBlockedBy();
              renderPickers();
              const updated = await api(`/api/external/tasks/${encodeURIComponent(taskId)}`);
              updateTaskInLists(updated);
              const inspectorDiv = document.getElementById('inspector-content');
              if (inspectorDiv && inspectorDiv.dataset.taskId === taskId) loadTaskDetails(taskId);
            } catch (e) {
              alert(e.message || 'Failed to remove dependency.');
            }
          });
        });
      }

      function renderBlocks() {
        blocksList.innerHTML = blocks.map((id) => {
          const lab = blockingModalTaskLabelMap[id] ? taskToLabel(blockingModalTaskLabelMap[id]) : (id.substring(0, 8) + '…');
          const esc = lab.replace(/</g, '&lt;').replace(/"/g, '&quot;');
          return `<li class="blocking-list-item" data-task-id="${(id || '').replace(/"/g, '&quot;')}">
            <span class="blocking-item-label">${esc}</span>
            <button type="button" class="blocking-remove-btn" data-task-id="${(id || '').replace(/"/g, '&quot;')}" aria-label="Remove">×</button>
          </li>`;
        }).join('');
        blocksList.querySelectorAll('.blocking-remove-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const otherId = btn.dataset.taskId;
            if (!otherId) return;
            try {
              await api(`/api/external/tasks/${encodeURIComponent(otherId)}/dependencies/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
              const idx = blocks.indexOf(otherId);
              if (idx !== -1) blocks.splice(idx, 1);
              removeBoardConnectionsBetweenTasks(taskId, otherId);
              if (currentBoardId) refreshBoardAfterTaskUpdate(currentBoardId).catch(() => {});
              renderBlocks();
              renderPickers();
              const updated = await api(`/api/external/tasks/${encodeURIComponent(taskId)}`);
              updateTaskInLists(updated);
              const inspectorDiv = document.getElementById('inspector-content');
              if (inspectorDiv && inspectorDiv.dataset.taskId === taskId) loadTaskDetails(taskId);
            } catch (e) {
              alert(e.message || 'Failed to remove dependency.');
            }
          });
        });
      }

      function renderPickers() {
        const others = taskList.filter((t) => t && t.id && t.id !== taskId);
        const blockedByOptions = others.filter((t) => !dependsOn.includes(t.id));
        const blocksOptions = others.filter((t) => !blocks.includes(t.id));
        const option = (t) => `<option value="${(t.id || '').replace(/"/g, '&quot;')}">${taskToLabel(t).replace(/</g, '&lt;')}</option>`;
        addBlockedBySelect.innerHTML = '<option value="">— Choose task —</option>' + blockedByOptions.map(option).join('');
        addBlocksSelect.innerHTML = '<option value="">— Choose task —</option>' + blocksOptions.map(option).join('');
      }

      renderBlockedBy();
      renderBlocks();
      renderPickers();

      addBlockedBySelect.onchange = async function () {
        const depId = this.value;
        if (!depId) return;
        try {
          await api(`/api/external/tasks/${encodeURIComponent(taskId)}/dependencies`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ depends_on_task_id: depId }),
          });
          if (!dependsOn.includes(depId)) dependsOn.push(depId);
          const t = taskList.find((x) => x.id === depId);
          if (t) blockingModalTaskLabelMap[depId] = { number: t.number, title: t.title };
          renderBlockedBy();
          renderPickers();
          this.value = '';
          const updated = await api(`/api/external/tasks/${encodeURIComponent(taskId)}`);
          updateTaskInLists(updated);
          const inspectorDiv = document.getElementById('inspector-content');
          if (inspectorDiv && inspectorDiv.dataset.taskId === taskId) loadTaskDetails(taskId);
        } catch (e) {
          alert(e.message || 'Failed to add dependency.');
        }
      };
      addBlocksSelect.onchange = async function () {
        const otherId = this.value;
        if (!otherId) return;
        try {
          await api(`/api/external/tasks/${encodeURIComponent(otherId)}/dependencies`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ depends_on_task_id: taskId }),
          });
          if (!blocks.includes(otherId)) blocks.push(otherId);
          const t = taskList.find((x) => x.id === otherId);
          if (t) blockingModalTaskLabelMap[otherId] = { number: t.number, title: t.title };
          renderBlocks();
          renderPickers();
          this.value = '';
          const updated = await api(`/api/external/tasks/${encodeURIComponent(taskId)}`);
          updateTaskInLists(updated);
          const inspectorDiv = document.getElementById('inspector-content');
          if (inspectorDiv && inspectorDiv.dataset.taskId === taskId) loadTaskDetails(taskId);
        } catch (e) {
          alert(e.message || 'Failed to add dependency.');
        }
      };

      if (blockingModalOverlay) {
        blockingModalOverlay.classList.remove('hidden');
        blockingModalOverlay.setAttribute('aria-hidden', 'false');
      }
    } catch (e) {
      console.error('Failed to open blocking modal:', e);
      alert(e.message || 'Failed to load task.');
    }
  }

  function closeBlockingModal() {
    blockingModalTaskId = null;
    if (blockingModalOverlay) {
      blockingModalOverlay.classList.add('hidden');
      blockingModalOverlay.setAttribute('aria-hidden', 'true');
    }
  }

  if (blockingModalOverlay) {
    blockingModalOverlay.addEventListener('click', (e) => { if (e.target === blockingModalOverlay) closeBlockingModal(); });
  }
  if (blockingModalClose) blockingModalClose.addEventListener('click', closeBlockingModal);
  const recurrenceFreqEl = document.getElementById('recurrence-freq');
  if (recurrenceFreqEl) recurrenceFreqEl.addEventListener('change', updateRecurrenceFreqOptions);
  const recurrenceIntervalEl = document.getElementById('recurrence-interval');
  if (recurrenceIntervalEl) {
    recurrenceIntervalEl.addEventListener('input', updateRecurrenceFreqOptions);
    recurrenceIntervalEl.addEventListener('change', updateRecurrenceFreqOptions);
  }
  // --- Theme cycle ---
  function getTheme() {
    const t = localStorage.getItem(THEME_KEY) || 'light';
    return THEMES.includes(t) ? t : 'light';
  }
  function setTheme(theme) {
    localStorage.setItem(THEME_KEY, theme);
    if (theme === 'light') document.body.removeAttribute('data-theme');
    else document.body.setAttribute('data-theme', theme);
    const themeTitle = 'Theme: ' + theme + ' (click to cycle)';
    if (themeBtn) themeBtn.title = themeTitle;
    const boardThemeBtnEl = document.getElementById('board-theme-btn');
    if (boardThemeBtnEl) boardThemeBtnEl.title = themeTitle;
  }
  function cycleTheme() {
    const i = THEMES.indexOf(getTheme());
    setTheme(THEMES[(i + 1) % THEMES.length]);
  }
  if (themeBtn) themeBtn.addEventListener('click', cycleTheme);
  setTheme(getTheme());

  // --- API fetch helper ---
  // path must start with / (e.g. /api/external/projects). Base URL = server root where /api/external/* is served.
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
    const result = await api(`/api/external/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (currentBoardId) {
      refreshBoardTasks(currentBoardId).then(() => {
        syncBoardCardsToQualifyingTasks(currentBoardId);
        renderBoardRegions(currentBoardId);
        renderBoardCards(currentBoardId);
      });
    }
    return result;
  }

  // --- Display settings (task properties & order) by context: inbox, project, list:<id>, tag:<name> ---
  function displayKey(source) {
    if (source === 'inbox') return 'inbox';
    if (typeof source === 'string' && source.startsWith('list:')) return source;
    if (typeof source === 'string' && source.startsWith('tag:')) return source;
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
          const showPriority = o.showPriority === true;
          const sortBy = Array.isArray(o.sortBy) ? o.sortBy.filter((s) => s && SORT_FIELD_KEYS.includes(s.key)) : [];
          const manualSort = o.manualSort === true;
          const manualOrder = Array.isArray(o.manualOrder) ? o.manualOrder.filter((id) => id != null) : [];
          return { order, visible, showFlagged, showCompleted, showHighlightDue, showPriority, sortBy, manualSort, manualOrder };
        }
      }
    } catch (_) {}
    const order = ['due_date'];
    return { order, visible: new Set(order), showFlagged: true, showCompleted: true, showHighlightDue: true, showPriority: false, sortBy: [], manualSort: false, manualOrder: [] };
  }

  function saveDisplayProperties(source, order, visible, showFlagged, showCompleted, showHighlightDue, showPriority, sortBy, manualSort, manualOrder) {
    const key = displayKey(source != null ? source : 'project');
    let all = {};
    try {
      const raw = localStorage.getItem(DISPLAY_PROPERTIES_KEY);
      if (raw) all = JSON.parse(raw) || {};
    } catch (_) {}
    const current = getDisplayProperties(source);
    const existing = all[key] && typeof all[key] === 'object' ? all[key] : {};
    all[key] = {
      order: order || current.order,
      visible: visible != null ? Array.from(visible) : Array.from(current.visible),
      showFlagged: showFlagged !== undefined ? showFlagged : current.showFlagged,
      showCompleted: showCompleted !== undefined ? showCompleted : current.showCompleted,
      showHighlightDue: showHighlightDue !== undefined ? showHighlightDue : current.showHighlightDue,
      showPriority: showPriority !== undefined ? showPriority : current.showPriority,
      sortBy: sortBy !== undefined ? sortBy : current.sortBy,
      manualSort: manualSort !== undefined ? manualSort : current.manualSort,
      manualOrder: manualOrder !== undefined ? manualOrder : current.manualOrder,
      columnWidths: existing.columnWidths && typeof existing.columnWidths === 'object' ? existing.columnWidths : {},
    };
    localStorage.setItem(DISPLAY_PROPERTIES_KEY, JSON.stringify(all));
  }

  function getTaskListColumnWidths(source) {
    const key = displayKey(source != null ? source : 'project');
    try {
      const raw = localStorage.getItem(DISPLAY_PROPERTIES_KEY);
      if (raw) {
        const all = JSON.parse(raw) || {};
        const o = all[key];
        if (o && typeof o === 'object' && o.columnWidths && typeof o.columnWidths === 'object') return { ...o.columnWidths };
      }
    } catch (_) {}
    return {};
  }

  function saveTaskListColumnWidth(colKey, widthPx, source) {
    const w = Math.max(TASK_LIST_MIN_WIDTH, Math.round(widthPx));
    const key = displayKey(source != null ? source : 'project');
    let all = {};
    try {
      const raw = localStorage.getItem(DISPLAY_PROPERTIES_KEY);
      if (raw) all = JSON.parse(raw) || {};
    } catch (_) {}
    if (!all[key] || typeof all[key] !== 'object') all[key] = {};
    if (!all[key].columnWidths || typeof all[key].columnWidths !== 'object') all[key].columnWidths = {};
    all[key].columnWidths[colKey] = w;
    localStorage.setItem(DISPLAY_PROPERTIES_KEY, JSON.stringify(all));
  }

  function renderDisplayDropdown() {
    const listEl = document.getElementById('display-properties-list');
    const flaggedCb = document.getElementById('display-show-flagged');
    const completedCb = document.getElementById('display-show-completed');
    const highlightDueCb = document.getElementById('display-show-highlight-due');
    const manualSortCb = document.getElementById('display-manual-sort');
    const dropdownEl = document.getElementById('display-settings-dropdown');
    if (!listEl) return;
    const source = lastTaskSource != null ? lastTaskSource : 'project';
    const isListSource = typeof source === 'string' && source.startsWith('list:');
    if (dropdownEl) dropdownEl.classList.toggle('display-dropdown-list-only', !!isListSource);
    const { order, visible, showFlagged, showCompleted, showHighlightDue, showPriority, sortBy, manualSort, manualOrder } = getDisplayProperties(source);
    if (flaggedCb) {
      flaggedCb.checked = showFlagged;
      flaggedCb.onchange = () => {
        const { order: o, visible: v, showCompleted: sc, showHighlightDue: sh, showPriority: sp } = getDisplayProperties(source);
        saveDisplayProperties(source, o, v, flaggedCb.checked, sc, sh, sp);
        refreshTaskList();
      };
    }
    if (completedCb) {
      completedCb.checked = showCompleted;
      completedCb.onchange = () => {
        const { order: o, visible: v, showFlagged: sf, showHighlightDue: sh, showPriority: sp } = getDisplayProperties(source);
        saveDisplayProperties(source, o, v, sf, completedCb.checked, sh, sp);
        refreshTaskList();
      };
    }
    if (highlightDueCb) {
      highlightDueCb.checked = showHighlightDue;
      highlightDueCb.onchange = () => {
        const { order: o, visible: v, showFlagged: sf, showCompleted: sc, showPriority: sp } = getDisplayProperties(source);
        saveDisplayProperties(source, o, v, sf, sc, highlightDueCb.checked, sp);
        refreshTaskList();
      };
    }
    const priorityCb = document.getElementById('display-show-priority');
    if (priorityCb) {
      priorityCb.checked = showPriority;
      priorityCb.onchange = () => {
        const { order: o, visible: v, showFlagged: sf, showCompleted: sc, showHighlightDue: sh } = getDisplayProperties(source);
        saveDisplayProperties(source, o, v, sf, sc, sh, priorityCb.checked);
        refreshTaskList();
      };
    }
    if (manualSortCb) {
      manualSortCb.checked = manualSort;
      manualSortCb.onchange = () => {
        const { order: o, visible: v, showFlagged: sf, showCompleted: sc, showHighlightDue: sh, showPriority: sp, sortBy: sb } = getDisplayProperties(source);
        saveDisplayProperties(source, o, v, sf, sc, sh, sp, sb, manualSortCb.checked);
        refreshTaskList();
      };
    }
    renderSortLadder(source);
    const addSortBtn = document.getElementById('display-sort-add');
    if (addSortBtn) {
      addSortBtn.onclick = () => {
        const current = getDisplaySortRows(source);
        const next = [...current, { key: 'due_date', dir: 'asc' }];
        applyDisplaySort(source, next);
        renderSortLadder(source);
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
        const { showFlagged: sf, showCompleted: sc, showHighlightDue: sh, showPriority: sp } = getDisplayProperties(source);
        saveDisplayProperties(source, o, v, sf, sc, sh, sp);
        refreshTaskList();
      });
    });
    setupDisplayListDrag(listEl, source);
  }

  function listSortDefinitionToSortBy(listMeta) {
    if (!listMeta || !listMeta.sort_definition) return [];
    let sd = listMeta.sort_definition;
    if (typeof sd === 'string') {
      try { sd = JSON.parse(sd); } catch (_) { return []; }
    }
    const within = (sd && Array.isArray(sd.sort_within_group)) ? sd.sort_within_group : [];
    return within.map((s) => ({
      key: (s && SORT_FIELD_KEYS.includes(s.field)) ? s.field : 'due_date',
      dir: (s && (s.direction === 'desc' || s.direction === 'asc')) ? s.direction : 'asc',
    })).filter((s) => SORT_FIELD_KEYS.includes(s.key));
  }

  function getDisplaySortRows(source) {
    const isListSource = typeof source === 'string' && source.startsWith('list:');
    const listId = isListSource ? source.slice(5) : null;
    const listMetaMatches = listId && lastListMeta && (String(lastListMeta.id) === String(listId) || String(lastListMeta.short_id) === String(listId));
    if (isListSource && listMetaMatches) {
      const fromServer = listSortDefinitionToSortBy(lastListMeta);
      return fromServer.length ? fromServer : [{ key: 'due_date', dir: 'asc' }];
    }
    const { sortBy } = getDisplayProperties(source);
    return sortBy.length ? sortBy.map((s) => ({ key: s.key || 'due_date', dir: s.dir || 'asc' })) : [];
  }

  function applyDisplaySort(source, sb) {
    const { order: o, visible: v, showFlagged: sf, showCompleted: sc, showHighlightDue: sh, showPriority: sp } = getDisplayProperties(source);
    saveDisplayProperties(source, o, v, sf, sc, sh, sp, sb);
    const isListSource = typeof source === 'string' && source.startsWith('list:');
    const listId = isListSource ? source.slice(5) : null;
    if (isListSource && listId) {
      const sort_definition = { group_by: [], sort_within_group: sb.map((s) => ({ field: s.key, direction: s.dir })) };
      api(`/api/external/lists/${encodeURIComponent(listId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sort_definition }),
      }).then(() => {
        if (lastListMeta && (String(lastListMeta.id) === String(listId) || String(lastListMeta.short_id) === String(listId))) {
          lastListMeta.sort_definition = sort_definition;
        }
        refreshTaskList();
      }).catch((e) => {
        alert(e.message || 'Failed to save list sort.');
      });
    } else {
      refreshTaskList();
    }
  }

  function renderSortLadder(source) {
    const ladderEl = document.getElementById('display-sort-ladder');
    if (!ladderEl) return;
    const rows = getDisplaySortRows(source);
    ladderEl.innerHTML = rows.map((s, i) => {
      const fieldOpts = SORT_FIELD_KEYS.map((k) => `<option value="${k}" ${s.key === k ? 'selected' : ''}>${SORT_FIELD_LABELS[k] || k}</option>`).join('');
      return `<div class="display-sort-row" data-index="${i}">
        <button type="button" class="display-sort-move display-sort-move-up" aria-label="Move up">↑</button>
        <button type="button" class="display-sort-move display-sort-move-down" aria-label="Move down">↓</button>
        <select class="display-sort-field" aria-label="Sort by">${fieldOpts}</select>
        <select class="display-sort-dir" aria-label="Direction">
          <option value="asc" ${s.dir === 'asc' ? 'selected' : ''}>Asc</option>
          <option value="desc" ${s.dir === 'desc' ? 'selected' : ''}>Desc</option>
        </select>
        <button type="button" class="display-sort-remove" aria-label="Remove sort level">×</button>
      </div>`;
    }).join('');
    const applySortChange = (sb) => {
      applyDisplaySort(source, sb);
    };
    const syncSortBy = () => {
      const rowEls = ladderEl.querySelectorAll('.display-sort-row');
      const sb = Array.from(rowEls).map((row) => ({
        key: row.querySelector('.display-sort-field').value,
        dir: row.querySelector('.display-sort-dir').value,
      }));
      applySortChange(sb);
    };
    ladderEl.querySelectorAll('.display-sort-field, .display-sort-dir').forEach((el) => {
      el.addEventListener('change', syncSortBy);
    });
    ladderEl.querySelectorAll('.display-sort-remove').forEach((btn, i) => {
      btn.addEventListener('click', () => {
        const rowEls = ladderEl.querySelectorAll('.display-sort-row');
        const sb = Array.from(rowEls).map((row) => ({
          key: row.querySelector('.display-sort-field').value,
          dir: row.querySelector('.display-sort-dir').value,
        }));
        const next = sb.filter((_, j) => j !== i);
        applySortChange(next.length ? next : [{ key: 'due_date', dir: 'asc' }]);
        renderSortLadder(source);
      });
    });
    ladderEl.querySelectorAll('.display-sort-move-up').forEach((btn, i) => {
      btn.addEventListener('click', () => {
        if (i === 0) return;
        const rowEls = ladderEl.querySelectorAll('.display-sort-row');
        const sb = Array.from(rowEls).map((row) => ({
          key: row.querySelector('.display-sort-field').value,
          dir: row.querySelector('.display-sort-dir').value,
        }));
        const next = [...sb];
        [next[i - 1], next[i]] = [next[i], next[i - 1]];
        applySortChange(next);
        renderSortLadder(source);
      });
    });
    ladderEl.querySelectorAll('.display-sort-move-down').forEach((btn, i) => {
      btn.addEventListener('click', () => {
        const rowEls = ladderEl.querySelectorAll('.display-sort-row');
        const sb = Array.from(rowEls).map((row) => ({
          key: row.querySelector('.display-sort-field').value,
          dir: row.querySelector('.display-sort-dir').value,
        }));
        if (i >= sb.length - 1) return;
        const next = [...sb];
        [next[i], next[i + 1]] = [next[i + 1], next[i]];
        applySortChange(next);
        renderSortLadder(source);
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
        const indicator = document.createElement('div');
        indicator.className = 'drop-indicator';
        indicator.style.display = 'none';
        listEl.appendChild(indicator);
        let dropIndex = 0;
        const onMove = (e2) => {
          if (!dragged) return;
          const rect = listEl.getBoundingClientRect();
          const items = Array.from(listEl.querySelectorAll('li'));
          const y = e2.clientY;
          if (y < rect.top) dropIndex = 0;
          else if (y > rect.bottom) dropIndex = items.length;
          else {
            const idx = items.findIndex((item) => item.getBoundingClientRect().top + item.offsetHeight / 2 > y);
            dropIndex = idx < 0 ? items.length : idx;
          }
          updateDropIndicator(listEl, indicator, dropIndex, items);
        };
        const onUp = () => {
          if (dragged) {
            const items = Array.from(listEl.querySelectorAll('li'));
            if (dropIndex >= 0 && dropIndex <= items.length) {
              listEl.insertBefore(dragged, items[dropIndex] || null);
            }
            dragged.classList.remove('dragging');
          }
          if (indicator.parentNode) indicator.remove();
          dragged = null;
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          const order = Array.from(listEl.querySelectorAll('li')).map((el) => el.dataset.key);
          const { visible, showFlagged: sf, showCompleted: sc, showHighlightDue: sh, showPriority: sp } = getDisplayProperties(ctx);
          saveDisplayProperties(ctx, order, visible, sf, sc, sh, sp);
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
        } else if (field === 'completed_at') {
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
    const wrapper = center.querySelector('.task-list-wrapper');
    if (!wrapper) {
      renderTaskList(displayedTasks, src);
      return;
    }
    const ul = wrapper.querySelector('ul.task-list');
    if (!ul) return;
    const { order, visible, manualSort } = getDisplayProperties(src);
    const columnKeys = [];
    if (manualSort) columnKeys.push('move');
    columnKeys.push('status');
    columnKeys.push('title');
    order.forEach((k) => { if (visible.has(k)) columnKeys.push(k); });
    const selectedRow = center.querySelector('.task-row.selected');
    const selectedId = selectedRow && selectedRow.dataset.id;
    ul.innerHTML = '';
    displayedTasks.forEach((t) => ul.appendChild(buildTaskRow(t, columnKeys)));
    if (manualSort) setupTaskListDrag(center, ul, src);
    if (selectedId) {
      const row = center.querySelector(`.task-row[data-id="${selectedId}"]`);
      if (row) {
        row.classList.add('selected');
        // Do not call loadTaskDetails here: inspector is already showing this task. Calling it
        // would trigger updateTaskInLists -> redrawDisplayedTasks -> loadTaskDetails again (loop).
      }
    }
    applyBlockingHighlights();
  }

  function updateTaskInLists(updatedTask, opts) {
    if (!updatedTask || updatedTask.id == null) return;
    const id = String(updatedTask.id);
    const idxLast = (lastTasks || []).findIndex((t) => String(t.id) === id);
    if (idxLast >= 0) lastTasks[idxLast] = updatedTask;
    const idxDisp = (displayedTasks || []).findIndex((t) => String(t.id) === id);
    if (idxDisp >= 0) displayedTasks[idxDisp] = updatedTask;
    const center = document.getElementById('center-content');
    const ul = center && center.querySelector('ul.task-list');
    const existingRow = ul && ul.querySelector('.task-row[data-id="' + id + '"]');
    if (existingRow && displayedTasks[idxDisp]) {
      const src = lastTaskSource != null ? lastTaskSource : 'project';
      const { order, visible, manualSort } = getDisplayProperties(src);
      const columnKeys = [];
      if (manualSort) columnKeys.push('move');
      columnKeys.push('status');
      columnKeys.push('title');
      order.forEach((k) => { if (visible.has(k)) columnKeys.push(k); });
      const wasSelected = existingRow.classList.contains('selected');
      const newRow = buildTaskRow(displayedTasks[idxDisp], columnKeys);
      if (wasSelected) newRow.classList.add('selected');
      existingRow.parentNode.replaceChild(newRow, existingRow);
      if (manualSort) addDragToRow(newRow, ul, src);
    } else {
      redrawDisplayedTasks();
    }
    if (opts && opts.scheduleRefresh === false) return;
    scheduleRefreshAfterTaskChange();
  }

  const DISPLAY_SETTINGS_ICON = '<svg class="header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M3 8L15 8M15 8C15 9.65686 16.3431 11 18 11C19.6569 11 21 9.65685 21 8C21 6.34315 19.6569 5 18 5C16.3431 5 15 6.34315 15 8ZM9 16L21 16M9 16C9 17.6569 7.65685 19 6 19C4.34315 19 3 17.6569 3 16C3 14.3431 4.34315 13 6 13C7.65685 13 9 14.3431 9 16Z"/></svg>';
  const LIST_SETTINGS_ICON = '<svg class="header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M3 8L15 8M15 8C15 9.65686 16.3431 11 18 11C19.6569 11 21 9.65685 21 8C21 6.34315 19.6569 5 18 5C16.3431 5 15 6.34315 15 8ZM9 16L21 16M9 16C9 17.6569 7.65685 19 6 19C4.34315 19 3 17.6569 3 16C3 14.3431 4.34315 13 6 13C7.65685 13 9 14.3431 9 16Z"/></svg>';
  function updateCenterHeaderForSource() {
    const displaySettingsBtn = document.getElementById('display-settings-btn');
    const displayDropdown = document.getElementById('display-settings-dropdown');
    const isList = lastTaskSource && lastTaskSource.startsWith('list:');
    if (displaySettingsBtn) {
      displaySettingsBtn.innerHTML = isList ? LIST_SETTINGS_ICON : DISPLAY_SETTINGS_ICON;
      displaySettingsBtn.title = isList ? 'List filter & sort' : 'Display settings';
      displaySettingsBtn.setAttribute('aria-label', isList ? 'List filter and sort' : 'Display settings');
    }
    if (displayDropdown && isList) displayDropdown.classList.add('hidden');
  }

  const REFRESH_AFTER_TASK_DELAY_MS = 400;
  let refreshAfterTaskTimeoutId = null;
  function refreshLeftPanel() {
    loadProjects();
    loadLists();
    loadBoards();
    loadTags();
    loadFavorites();
  }
  function refreshCenterView() {
    if (lastTaskSource === 'inbox') loadInboxTasks();
    else if (lastTaskSource === 'search' && lastSearchQuery) runSearch(lastSearchQuery);
    else if (lastTaskSource && lastTaskSource.startsWith('list:')) {
      const listId = lastTaskSource.slice(5);
      if (listId) loadListTasks(listId);
    } else if (lastTaskSource && lastTaskSource.startsWith('tag:')) {
      const tagName = lastTaskSource.slice(4);
      if (tagName) loadTagTasks(tagName);
    } else if (lastTaskSource) loadProjectTasks(lastTaskSource);
  }
  function scheduleRefreshAfterTaskChange() {
    if (refreshAfterTaskTimeoutId) clearTimeout(refreshAfterTaskTimeoutId);
    refreshAfterTaskTimeoutId = setTimeout(() => {
      refreshAfterTaskTimeoutId = null;
      refreshLeftPanel();
      /* Skip refreshCenterView to avoid panel blink: the list was already updated in updateTaskInLists. */
    }, REFRESH_AFTER_TASK_DELAY_MS);
  }
  function refreshLeftAndCenter() {
    refreshLeftPanel();
    refreshCenterView();
  }

  async function loadListTasks(listId) {
    const center = document.getElementById('center-content');
    if (!center) return;
    center.innerHTML = '<p class="placeholder">Loading…</p>';
    lastListMeta = null;
    try {
      const [tasks, list] = await Promise.all([
        api(`/api/external/lists/${encodeURIComponent(listId)}/tasks?limit=500`),
        api(`/api/external/lists/${encodeURIComponent(listId)}`),
      ]);
      lastListMeta = list && list.id ? list : null;
      const listSource = lastTaskSource && lastTaskSource.startsWith('list:') ? lastTaskSource : 'list:' + listId;
      renderTaskList(Array.isArray(tasks) ? tasks : [], listSource);
    } catch (e) {
      center.innerHTML = `<p class="placeholder">${e.message || 'Failed to load list tasks.'}</p>`;
    }
  }

  async function loadTagTasks(tagName) {
    const center = document.getElementById('center-content');
    if (!center) return;
    center.innerHTML = '<p class="placeholder">Loading…</p>';
    try {
      const tasks = await api(`/api/external/tasks?tag=${encodeURIComponent(tagName)}&limit=500`);
      const source = lastTaskSource && lastTaskSource.startsWith('tag:') ? lastTaskSource : 'tag:' + tagName;
      renderTaskList(Array.isArray(tasks) ? tasks : [], source);
    } catch (e) {
      center.innerHTML = `<p class="placeholder">${e.message || 'Failed to load tasks for tag.'}</p>`;
    }
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

  const CAL_EVENT_SVG = '<svg class="date-icon calendar-event-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M4 8H20M4 8V16.8002C4 17.9203 4 18.4801 4.21799 18.9079C4.40973 19.2842 4.71547 19.5905 5.0918 19.7822C5.5192 20 6.07899 20 7.19691 20H16.8031C17.921 20 18.48 20 18.9074 19.7822C19.2837 19.5905 19.5905 19.2842 19.7822 18.9079C20 18.4805 20 17.9215 20 16.8036V8M4 8V7.2002C4 6.08009 4 5.51962 4.21799 5.0918C4.40973 4.71547 4.71547 4.40973 5.0918 4.21799C5.51962 4 6.08009 4 7.2002 4H8M20 8V7.19691C20 6.07899 20 5.5192 19.7822 5.0918C19.5905 4.71547 19.2837 4.40973 18.9074 4.21799C18.4796 4 17.9203 4 16.8002 4H16M8 4H16M8 4V2M16 4V2M11.75 16C11.8881 16 12 15.8881 12 15.75V12.25C12 12.1119 11.8881 12 8.25 12V15.75C8 15.8881 8.11193 16 8.25 16H11.75Z"/></svg>';
  const CAL_CHECK_SVG = '<svg class="date-icon calendar-check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M4 8H20M4 8V16.8002C4 17.9203 4 18.4801 4.21799 18.9079C4.40973 19.2842 4.71547 19.5905 5.0918 19.7822C5.5192 20 6.07899 20 7.19691 20H16.8031C17.921 20 18.48 20 18.9074 19.7822C19.2837 19.5905 19.5905 19.2842 19.7822 18.9079C20 18.4805 20 17.9215 20 16.8036V8M4 8V7.2002C4 6.08009 4 5.51962 4.21799 5.0918C4.40973 4.71547 4.71547 4.40973 5.0918 4.21799C5.51962 4 6.08009 4 7.2002 4H8M20 8V7.19691C20 6.07899 20 5.5192 19.7822 5.0918C19.5905 4.71547 19.2837 4.40973 18.9074 4.21799C18.4796 4 17.9203 4 16.8002 4H16M8 4H16M8 4V2M16 4V2M15 12L11 16L9 14"/></svg>';

  const RECURRENCE_ICON_SVG = '<svg class="recurrence-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M4.06 13C4.02 12.67 4 12.34 4 12c0-4.42 3.58-8 8-8 2.5 0 4.73 1.15 6.2 2.94M19.94 11C19.98 11.33 20 11.66 20 12c0 4.42-3.58 8-8 8-2.5 0-4.73-1.15-6.2-2.94M9 17H6v.29M18.2 4v2.94M18.2 6.94V7L15.2 7M6 20v-2.71"/></svg>';
  /** Stop-palm icon (themeable via currentColor). Add class .blocking-icon-muted for muted state. */
  const BLOCKING_ICON_SVG = '<svg class="blocking-icon" viewBox="0 0 512 512" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M387.187,68.12c-4.226,0-8.328,0.524-12.249,1.511V55.44c0-27.622-22.472-50.094-50.094-50.094c-10.293,0-19.865,3.123-27.834,8.461C288.017,5.252,275.869,0,262.508,0c-22.84,0-42.156,15.365-48.16,36.302c-5.268-1.887-10.935-2.912-16.844-2.912c-27.622,0-50.094,22.472-50.094,50.094v82.984c-5.996-2.332-12.508-3.616-19.318-3.616c-29.43,0-53.373,23.936-53.373,53.366v99.695c0,63.299,38.525,185.645,184.315,195.649c4.274,0.289,8.586,0.438,12.813,0.438c91.218,0,165.435-72.378,165.435-161.35V118.214C437.281,90.592,414.81,68.12,387.187,68.12z M271.846,483.947c-3.585,0-7.209-0.126-10.896-0.376c-134.659-9.237-158.179-126.668-158.179-167.659v-99.695c0-13.979,11.341-25.313,25.32-25.313c13.98,0,25.321,11.334,25.321,25.313v76.997h22.05V83.485c0-12.172,9.87-22.042,22.041-22.042c12.172,0,22.042,9.87,22.042,22.042v152.959h20.922V50.094c0-12.172,9.87-22.041,22.041-22.041c12.172,0,22.042,9.87,22.042,22.041v186.35h18.253V55.44c0-12.172,9.87-22.041,22.042-22.041c12.171,0,22.041,9.87,22.041,22.041v181.004h18.261v-118.23c0-12.172,9.87-22.042,22.041-22.042c12.172,0,22.042,9.87,22.042,22.042V350.65C409.229,419.748,353.445,483.947,271.846,483.947z"/></svg>';

  const PRIORITY_CIRCLE_SVG = '<svg class="priority-circle-icon" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="8" fill="currentColor" stroke="none"/></svg>';
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
    const row = ev.target.closest('.task-row');
    const cell = ev.target.closest('.flagged-cell');
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
    const row = ev.target.closest('.task-row');
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

  function openPriorityDropdown(ev, cell, opts) {
    ev.stopPropagation();
    closePriorityDropdown();
    const taskId = cell.dataset.priorityTaskId;
    if (!taskId) return;
    const onAfterApply = opts && opts.onAfterApply;
    const dropdown = document.createElement('div');
    dropdown.className = 'task-priority-dropdown';
    dropdown.setAttribute('role', 'menu');
    const options = [
      { value: 3, label: '3 – High', cls: 'priority-3' },
      { value: 2, label: '2 – Medium high', cls: 'priority-2' },
      { value: 1, label: '1 – Medium low', cls: 'priority-1' },
      { value: 0, label: '0 – Low', cls: 'priority-0' },
      { value: null, label: 'No priority', cls: 'priority-empty' },
    ];
    options.forEach(({ value, label, cls }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'task-priority-dropdown-item';
      btn.innerHTML = `<span class="priority-circle-wrap ${cls}">${PRIORITY_CIRCLE_SVG}</span><span class="task-priority-dropdown-label">${label}</span>`;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        applyTaskPriority(taskId, value).then(() => {
          closePriorityDropdown();
          if (onAfterApply) onAfterApply();
        });
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

  /** Build date dropdown menu (Today, Tomorrow, Days of week, +/-, Clear, Pick date). onAfterApply called after applyTaskDate (e.g. to refresh inspector). */
  function buildDateDropdownContent(taskId, field, currentVal, onAfterApply) {
    let existingDate = (currentVal || '').trim().substring(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(existingDate)) {
      existingDate = todayDateStr();
    }
    const dropdown = document.createElement('div');
    dropdown.className = 'task-date-dropdown';
    dropdown.style.pointerEvents = 'auto';
    dropdown.setAttribute('role', 'menu');

    async function applyAndClose(dateStr) {
      try {
        await applyTaskDate(taskId, field, dateStr);
        closeDateDropdown();
        if (onAfterApply) onAfterApply();
      } catch (err) {
        console.error(err);
      }
    }

    function addDateButton(label, dateStr) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'task-date-dropdown-item';
      btn.textContent = label;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        applyAndClose(dateStr);
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
        applyAndClose(nextWeekdayDate(i));
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
    let weekdaysSubmenuHideTimer = null;
    function scheduleHideWeekdaysSubmenu() {
      if (weekdaysSubmenuHideTimer) clearTimeout(weekdaysSubmenuHideTimer);
      weekdaysSubmenuHideTimer = setTimeout(() => {
        weekdaysSubmenuHideTimer = null;
        hideWeekdaysSubmenu();
      }, 200);
    }
    function cancelHideWeekdaysSubmenu() {
      if (weekdaysSubmenuHideTimer) {
        clearTimeout(weekdaysSubmenuHideTimer);
        weekdaysSubmenuHideTimer = null;
      }
    }
    weekdaysTrigger.addEventListener('click', toggleWeekdaysSubmenu);
    weekdaysWrap.addEventListener('mouseenter', () => {
      cancelHideWeekdaysSubmenu();
      showWeekdaysSubmenu();
    });
    weekdaysWrap.addEventListener('mouseleave', (e) => {
      if (!weekdaysSubmenu.contains(e.relatedTarget)) scheduleHideWeekdaysSubmenu();
    });
    weekdaysSubmenu.addEventListener('mouseenter', cancelHideWeekdaysSubmenu);
    weekdaysSubmenu.addEventListener('mouseleave', (e) => {
      if (!weekdaysWrap.contains(e.relatedTarget)) scheduleHideWeekdaysSubmenu();
    });
    dropdown.appendChild(weekdaysWrap);

    const choices = [
      { label: '+1 day', fn: () => dateAddDays(existingDate, 1) },
      { label: '-1 day', fn: () => dateAddDays(existingDate, -1) },
      { label: '+1 week', fn: () => dateAddDays(existingDate, 7) },
      { label: '-1 week', fn: () => dateAddDays(existingDate, -7) },
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
        applyAndClose(newDate);
      });
      dropdown.appendChild(btn);
    });

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'task-date-dropdown-item';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      applyAndClose('');
    });
    dropdown.appendChild(clearBtn);

    return dropdown;
  }

  let overlayDropdownContainerEl = null;
  function getHashtagDropdownContainer() {
    if (!overlayDropdownContainerEl) {
      const el = document.createElement('div');
      el.id = 'overlay-dropdown-container';
      el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
      overlayDropdownContainerEl = el;
    }
    return overlayDropdownContainerEl;
  }

  function openDateDropdown(ev, cell) {
    ev.stopPropagation();
    closeDateDropdown();
    const row = cell.closest('.task-row');
    const taskId = row && row.dataset.id;
    const field = cell.dataset.dateField;
    let currentVal = (cell.dataset.dateValue || '').trim().substring(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(currentVal)) {
      currentVal = todayDateStr();
    }
    if (!taskId || !field) return;

    const dropdown = buildDateDropdownContent(taskId, field, currentVal, undefined);
    getHashtagDropdownContainer().appendChild(dropdown);
    dateDropdownEl = dropdown;
    document.body.appendChild(getHashtagDropdownContainer());

    const cellRect = cell.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.left = `${cellRect.left}px`;
    dropdown.style.top = `${cellRect.bottom + 4}px`;
    dropdown.style.minWidth = `${Math.max(cellRect.width, 160)}px`;

    requestAnimationFrame(() => document.addEventListener('click', dateDropdownOutside));
  }

  function openInspectorDateDropdown(ev, wrapEl, onAfterApply) {
    ev.stopPropagation();
    closeDateDropdown();
    const taskId = wrapEl.dataset.taskId;
    const field = wrapEl.dataset.dateField;
    const inputEl = wrapEl.querySelector('input[type="date"]');
    let currentVal = (inputEl && inputEl.value || '').trim().substring(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(currentVal)) currentVal = todayDateStr();
    if (!taskId || !field) return;

    const afterApply = onAfterApply || (() => loadTaskDetails(taskId));
    const dropdown = buildDateDropdownContent(taskId, field, currentVal, () => {
      afterApply();
    });
    getHashtagDropdownContainer().appendChild(dropdown);
    dateDropdownEl = dropdown;
    document.body.appendChild(getHashtagDropdownContainer());

    const trigger = wrapEl.querySelector('.inspector-date-dropdown-trigger');
    const anchor = trigger || wrapEl;
    const rect = anchor.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.minWidth = '160px';

    requestAnimationFrame(() => document.addEventListener('click', dateDropdownOutside));
  }

  let projectsDropdownEl = null;
  function closeProjectsDropdown() {
    if (projectsDropdownEl && projectsDropdownEl.parentNode) projectsDropdownEl.parentNode.removeChild(projectsDropdownEl);
    projectsDropdownEl = null;
    document.removeEventListener('click', projectsDropdownOutside);
  }
  function projectsDropdownOutside(ev) {
    if (projectsDropdownEl && !projectsDropdownEl.contains(ev.target) && !ev.target.closest('.projects-cell') && !ev.target.closest('.inspector-projects-wrap')) closeProjectsDropdown();
  }

  let taskTagsDropdownEl = null;
  function getTaskTagsDialog() {
    return null;
  }
  function closeTaskTagsDropdown() {
    if (taskTagsDropdownEl) {
      if (taskTagsDropdownEl.parentNode) taskTagsDropdownEl.parentNode.removeChild(taskTagsDropdownEl);
      taskTagsDropdownEl = null;
    }
    document.removeEventListener('click', taskTagsDropdownOutside);
  }
  function taskTagsDropdownOutside(ev) {
    if (taskTagsDropdownEl && !taskTagsDropdownEl.contains(ev.target) && !ev.target.closest('.tags-cell') && !ev.target.closest('.inspector-tags-btn') && !ev.target.closest('.new-task-tags-btn') && !ev.target.closest('#board-region-edit-overlay')) closeTaskTagsDropdown();
  }
  async function openTaskTagsDropdown(ev, anchorEl, options) {
    ev.stopPropagation();
    closeTaskTagsDropdown();
    closeProjectsDropdown();
    const taskId = options && options.taskId != null && options.taskId !== '' ? String(options.taskId) : null;
    const forNewTask = options && options.forNewTask;
    if (!taskId && !forNewTask) return;
    let currentTags = (Array.isArray(options.currentTags) ? options.currentTags : []).map((t) => String(t).trim()).filter(Boolean);
    const onAfterApply = options && options.onAfterApply;

    const dropdown = document.createElement('div');
    dropdown.className = 'task-tags-dropdown';
    dropdown.style.pointerEvents = 'auto';
    dropdown.setAttribute('role', 'dialog');
    dropdown.setAttribute('aria-label', 'Assign tags');

    async function applyTags(tags) {
      if (forNewTask) {
        currentTags = tags;
        if (onAfterApply) onAfterApply(tags);
        return;
      }
      try {
        const updated = await updateTask(taskId, { tags });
        updateTaskInLists(updated);
        if (onAfterApply) onAfterApply();
      } catch (e) {
        console.error('Failed to update tags:', e);
      }
    }

    // --- Current tags (same structure as projects: list + remove button each) ---
    const currentSection = document.createElement('div');
    currentSection.className = 'task-projects-section';
    const currentTitle = document.createElement('div');
    currentTitle.className = 'task-projects-section-title';
    currentTitle.textContent = 'Current tags';
    currentSection.appendChild(currentTitle);
    const currentList = document.createElement('div');
    currentList.className = 'task-projects-current-list';

    function renderCurrentTags() {
      currentList.innerHTML = '';
      const sorted = [...currentTags].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      sorted.forEach((tag) => {
        const item = document.createElement('div');
        item.className = 'task-projects-current-item';
        const label = '#' + String(tag).replace(/</g, '&lt;');
        item.innerHTML = `<span class="task-projects-current-label">${label}</span> <button type="button" class="task-projects-remove" aria-label="Remove">×</button>`;
        const removeBtn = item.querySelector('button');
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          currentTags = currentTags.filter((t) => t !== tag);
          applyTags(currentTags).then(() => {
            closeTaskTagsDropdown();
            if (!forNewTask && onAfterApply) onAfterApply();
          });
        });
        currentList.appendChild(item);
      });
      if (currentTags.length === 0) currentList.innerHTML = '<span class="task-projects-empty">None</span>';
    }
    renderCurrentTags();
    currentSection.appendChild(currentList);
    dropdown.appendChild(currentSection);

    // --- Add tag (same structure as projects: search + results) ---
    const searchSection = document.createElement('div');
    searchSection.className = 'task-projects-section task-projects-search-section';
    const searchTitle = document.createElement('div');
    searchTitle.className = 'task-projects-section-title';
    searchTitle.textContent = 'Add tag';
    searchSection.appendChild(searchTitle);
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search or add tag…';
    searchInput.className = 'task-projects-search-input';
    searchSection.appendChild(searchInput);
    const resultsDiv = document.createElement('div');
    resultsDiv.className = 'task-projects-results';
    searchSection.appendChild(resultsDiv);

    let allTagNames = [];
    try {
      const allTags = await api('/api/external/tags');
      allTagNames = Array.isArray(allTags) ? [...new Set(allTags.map((x) => String(x.tag || '').trim()).filter(Boolean))].sort() : [];
    } catch (_) {}

    function renderSearchResults() {
      const q = (searchInput.value || '').trim().toLowerCase();
      resultsDiv.innerHTML = '';
      if (!q) return;
      const currentSet = new Set(currentTags.map((t) => t.toLowerCase()));
      let matches = allTagNames.filter((tag) => {
        if (currentSet.has(tag.toLowerCase())) return false;
        return tag.toLowerCase().includes(q);
      });
      matches = matches.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      if (matches.length) {
        matches.forEach((tag) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'task-projects-result-item';
          btn.textContent = '#' + tag;
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const next = [...currentTags, tag].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
            applyTags(next).then(() => {
              closeTaskTagsDropdown();
              if (!forNewTask && onAfterApply) onAfterApply();
            });
          });
          resultsDiv.appendChild(btn);
        });
      } else {
        const createBtn = document.createElement('button');
        createBtn.type = 'button';
        createBtn.className = 'task-projects-result-item task-projects-create';
        createBtn.textContent = `Add tag "#${q}"`;
        createBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const name = validateTagName(searchInput.value.trim());
          if (!name) {
            alert('Tag must be a single word: letters, numbers, underscore or dash only.');
            return;
          }
          currentTags = [...currentTags, name].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
          await applyTags(currentTags);
          if (!allTagNames.includes(name)) {
            allTagNames = [...allTagNames, name].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
          }
          closeTaskTagsDropdown();
          if (!forNewTask && onAfterApply) onAfterApply();
          loadTags();
        });
        resultsDiv.appendChild(createBtn);
      }
    }
    searchInput.addEventListener('input', renderSearchResults);
    searchInput.addEventListener('focus', renderSearchResults);

    dropdown.appendChild(searchSection);

    const container = getHashtagDropdownContainer();
    container.appendChild(dropdown);
    document.body.appendChild(container);
    taskTagsDropdownEl = dropdown;
    const rect = anchorEl.getBoundingClientRect();
    const minW = Math.max(rect.width, 240);
    const fromInspector = anchorEl.closest('.inspector-content') || anchorEl.closest('.right-panel');
    dropdown.style.position = 'fixed';
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.minWidth = `${minW}px`;
    dropdown.style.maxHeight = '320px';
    dropdown.style.overflowY = 'auto';
    if (fromInspector) {
      dropdown.style.right = `${window.innerWidth - rect.right}px`;
      dropdown.style.left = 'auto';
    } else {
      dropdown.style.left = `${rect.left}px`;
    }
    requestAnimationFrame(() => {
      document.addEventListener('click', taskTagsDropdownOutside);
      searchInput.focus();
    });
  }

  let descriptionModalTaskId = null;
  let descriptionModalForNewTask = false;

  function updateDescriptionPreview() {
    if (!descriptionNotesLines || !descriptionEditTextarea) return;
    const raw = descriptionEditTextarea.value;
    descriptionNotesLines.innerHTML = raw.trim() ? renderMarkdown(raw) : '<p class="description-preview-empty">No content. Use the Edit tab to add notes.</p>';
    // Checkbox toggles are handled by a single delegated listener on descriptionNotesLines (see setup below).
  }

  /** Single delegated handler for checkbox toggles in the preview (no per-render listeners). */
  function onDescriptionPreviewCheckboxChange(ev) {
    const cb = ev.target;
    if (!cb.matches || !cb.matches('input[type="checkbox"][data-line-index]')) return;
    const idx = parseInt(cb.getAttribute('data-line-index'), 10);
    if (Number.isNaN(idx)) return;
    const lines = descriptionEditTextarea.value.split('\n');
    const line = lines[idx] || '';
    const m = line.match(/^(\s*[-*])\s+\[([ xX])\]\s+(.*)$/);
    if (m) {
      lines[idx] = m[1] + ' [' + (m[2].toLowerCase() === 'x' ? ' ' : 'x') + '] ' + m[3];
      descriptionEditTextarea.value = lines.join('\n');
      updateDescriptionPreview();
    }
  }

  function openDescriptionModal(ev, cell) {
    if (ev && ev.stopPropagation) ev.stopPropagation();
    const taskId = cell && cell.dataset.descriptionTaskId;
    if (!taskId) return;
    const task = getTaskById(taskId);
    const notesOrDesc = (task && (task.notes != null && task.notes !== '' ? task.notes : task.description));
    const desc = notesOrDesc != null ? String(notesOrDesc) : '';
    descriptionModalForNewTask = false;
    descriptionModalTaskId = taskId;
    if (descriptionEditTextarea) descriptionEditTextarea.value = desc;
    switchDescriptionModalToEdit();
    if (descriptionModalOverlay) {
      descriptionModalOverlay.classList.remove('hidden');
      descriptionModalOverlay.setAttribute('aria-hidden', 'false');
      setTimeout(() => descriptionEditTextarea && descriptionEditTextarea.focus(), 50);
    }
  }
  function closeDescriptionModal() {
    descriptionModalTaskId = null;
    descriptionModalForNewTask = false;
    if (descriptionModalOverlay) {
      descriptionModalOverlay.classList.add('hidden');
      descriptionModalOverlay.setAttribute('aria-hidden', 'true');
    }
  }
  function openDescriptionModalForNewTask() {
    descriptionModalTaskId = null;
    descriptionModalForNewTask = true;
    if (descriptionEditTextarea) descriptionEditTextarea.value = newTaskState.description || '';
    switchDescriptionModalToEdit();
    if (descriptionModalOverlay) {
      descriptionModalOverlay.classList.remove('hidden');
      descriptionModalOverlay.setAttribute('aria-hidden', 'false');
      setTimeout(() => descriptionEditTextarea && descriptionEditTextarea.focus(), 50);
    }
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

  function openProjectsDropdown(ev, cellOrAnchor, options) {
    ev.stopPropagation();
    closeProjectsDropdown();
    closeTaskTagsDropdown();
    const fromInspector = options && (options.taskId != null || options.currentIds != null);
    const forNewTask = options && options.forNewTask;
    const row = fromInspector ? null : cellOrAnchor.closest('.task-row');
    const taskId = fromInspector ? (options.taskId != null ? String(options.taskId) : (row && row.dataset.id)) : (row && row.dataset.id);
    let currentIds = [];
    if (fromInspector && options.currentIds != null) {
      currentIds = Array.isArray(options.currentIds) ? options.currentIds : [];
    } else {
      try {
        currentIds = JSON.parse(cellOrAnchor.dataset.projectsJson || '[]');
      } catch (_) {}
    }
    if (!taskId && !forNewTask) return;

    const onAfterApply = options && options.onAfterApply;
    const anchorEl = (options && options.anchorEl) || cellOrAnchor;

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
        if (taskId) {
          applyTaskProjects(taskId, next).then(() => {
            closeProjectsDropdown();
            if (onAfterApply) onAfterApply();
          });
        } else {
          currentIds = next;
          if (onAfterApply) onAfterApply(next);
          closeProjectsDropdown();
        }
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
            if (taskId) {
              applyTaskProjects(taskId, next).then(() => {
                closeProjectsDropdown();
                if (onAfterApply) onAfterApply();
              });
            } else {
              currentIds = next;
              if (onAfterApply) onAfterApply(next);
              closeProjectsDropdown();
            }
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
            if (taskId) {
              await applyTaskProjects(taskId, next);
              if (onAfterApply) onAfterApply();
            } else {
              currentIds = next;
              if (onAfterApply) onAfterApply(next);
            }
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

    const rect = anchorEl.getBoundingClientRect();
    const minW = Math.max(rect.width, 240);
    const anchorInRightPanel = anchorEl.closest('.inspector-content') || anchorEl.closest('.right-panel');
    dropdown.style.position = 'fixed';
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.minWidth = `${minW}px`;
    dropdown.style.maxHeight = '320px';
    dropdown.style.overflowY = 'auto';
    if (anchorInRightPanel) {
      dropdown.style.right = `${window.innerWidth - rect.right}px`;
      dropdown.style.left = 'auto';
    } else {
      dropdown.style.left = `${rect.left}px`;
    }

    requestAnimationFrame(() => {
      document.addEventListener('click', projectsDropdownOutside);
      searchInput.focus();
    });
  }

  function formatTitleWithTagPills(titleText) {
    if (!titleText) return '';
    const escaped = titleText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return escaped.replace(/(?<![.:/A-Za-z0-9-])(#[\w-]+)/g, '<span class="title-tag-pill">$1</span>');
  }

  function buildTaskRow(t, columnKeys) {
    const source = lastTaskSource != null ? lastTaskSource : 'project';
    const { order, visible, showFlagged, showHighlightDue, showPriority, manualSort } = getDisplayProperties(source);
    const row = document.createElement('div');
    row.className = 'task-row';
    row.dataset.type = 'task';
    row.dataset.id = t.id || '';
    row.dataset.number = t.number != null ? String(t.number) : '';
    row.dataset.statusComplete = isTaskCompleted(t) ? '1' : '0';
    if (t.is_blocked) row.classList.add('task-blocked');
    const moveHandleSvg = '<svg class="task-move-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M22 6C22.5523 6 23 6.44772 23 7C23 7.55229 22.5523 8 22 8H2C1.44772 8 1 7.55228 1 7C1 6.44772 1.44772 6 2 6L22 6Z"/><path d="M22 11C22.5523 11 23 11.4477 23 12C23 12.5523 22.5523 13 22 13H2C1.44772 13 1 12.5523 1 12C1 11.4477 1.44772 11 2 11H22Z"/><path d="M23 17C23 16.4477 22.5523 16 22 16H2C1.44772 16 1 16.4477 1 17C1 17.5523 1.44772 18 2 18H22C22.5523 18 23 17.5523 23 17Z"/></svg>';
    const statusComplete = isTaskCompleted(t);
    const circleOpenSvg = '<svg class="status-icon" viewBox="0 0 32 32" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M0 16q0 3.264 1.28 6.208t3.392 5.12 5.12 3.424 6.208 1.248 6.208-1.248 5.12-3.424 3.392-5.12 1.28-6.208-1.28-6.208-3.392-5.12-5.088-3.392-6.24-1.28q-3.264 0-6.208 1.28t-5.12 3.392-3.392 5.12-1.28 6.208zM4 16q0-3.264 1.6-6.016t4.384-4.352 6.016-1.632 6.016 1.632 4.384 4.352 1.6 6.016-1.6 6.048-4.384 4.352-6.016 1.6-6.016-1.6-4.384-4.352-1.6-6.048z"/></svg>';
    const circleTickSvg = '<svg class="status-icon" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M0 8c0 4.418 3.59 8 8 8 4.418 0 8-3.59 8-8 0-4.418-3.59-8-8-8-4.418 0-8 3.59-8 8zm2 0c0-3.307 2.686-6 6-6 3.307 0 6 2.686 6 6 0 3.307-2.686 6-6 6-3.307 0-6-2.686-6-6zm9.778-1.672l-1.414-1.414L6.828 8.45 5.414 7.036 4 8.45l2.828 2.828 3.182-3.182 1.768-1.768z" fill-rule="evenodd"/></svg>';
    const folderOpenSvg = '<svg class="project-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M2 6C2 4.34315 3.34315 3 5 3H7.75093C8.82997 3 9.86325 3.43595 10.6162 4.20888L9.94852 4.85927L10.6162 4.20888L11.7227 5.34484C11.911 5.53807 12.1693 5.64706 12.4391 5.64706H16.4386C18.5513 5.64706 20.281 7.28495 20.4284 9.35939C21.7878 9.88545 22.5642 11.4588 21.977 12.927L20.1542 17.4853C19.5468 19.0041 18.0759 20 16.4402 20H6C4.88522 20 3.87543 19.5427 3.15116 18.8079C2.44035 18.0867 2 17.0938 2 16V6ZM18.3829 9.17647C18.1713 8.29912 17.3812 7.64706 16.4386 7.64706H12.4391C11.6298 7.64706 10.8548 7.3201 10.2901 6.7404L9.18356 5.60444L9.89987 4.90666L9.18356 5.60444C8.80709 5.21798 8.29045 5 7.75093 5H5C4.44772 5 4 5.44772 4 6V14.4471L5.03813 11.25C5.43958 10.0136 6.59158 9.17647 7.89147 9.17647H18.3829ZM5.03034 17.7499L6.94036 11.8676C7.07417 11.4555 7.45817 11.1765 7.89147 11.1765H19.4376C19.9575 11.1765 20.3131 11.7016 20.12 12.1844L18.2972 16.7426C17.9935 17.502 17.258 18 16.4402 18H6C5.64785 18 5.31756 17.9095 5.03034 17.7499Z"/></svg>';
    const documentIconSvg = '<svg class="description-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M9.29289 1.29289C9.48043 1.10536 9.73478 1 10 1H18C19.6569 1 21 2.34315 21 4V20C21 21.6569 19.6569 23 18 23H6C4.34315 23 3 21.6569 3 20V8C3 7.73478 3.10536 7.48043 3.29289 7.29289L9.29289 1.29289ZM18 3H11V8C11 8.55228 10.5523 9 10 9H5V20C5 20.5523 5.44772 21 6 21H18C18.5523 21 19 20.5523 19 20V4C19 3.44772 18.5523 3 18 3ZM6.41421 7H9V4.41421L6.41421 7ZM7 13C7 12.4477 7.44772 12 8 12H16C16.5523 12 17 12.4477 17 13C17 13.5523 16.5523 14 16 14H8C7.44772 14 7 13.4477 7 13ZM7 17C7 16.4477 7.44772 16 8 16H16C16.5523 16 17 16.4477 17 17C17 17.5523 16.5523 18 16 18H8C7.44772 18 7 17.5523 7 17Z"/></svg>';
    const tagIconSvg = '<svg class="tags-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M4 5C4 4.44772 4.44772 4 5 4H11.1716C11.4368 4 11.6911 4.10536 11.8787 4.29289L19.8787 12.2929C20.2692 12.6834 20.2692 13.3166 19.8787 13.7071L13.7071 19.8787C13.3166 20.2692 12.6834 20.2692 12.2929 19.8787L4.29289 11.8787C4.10536 11.6911 4 11.4368 4 11.1716V5ZM5 2C3.34315 2 2 3.34315 2 5L2 11.1716C2 11.9672 2.31607 12.7303 2.87868 13.2929L10.8787 21.2929C12.0503 22.4645 13.9497 22.4645 15.1213 21.2929L21.2929 15.1213C22.4645 13.9497 22.4645 12.0503 21.2929 10.8787L13.2929 2.87868C12.7303 2.31607 11.9672 2 11.1716 2H5ZM8 10C9.10457 10 10 9.10457 10 8C10 6.89543 9.10457 6 8 6C6.89543 6 6 6.89543 6 8C6 9.10457 6.89543 10 8 10Z"/></svg>';
    const refreshIconSvg = '<svg class="recurrence-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M4.06 13C4.02 12.67 4 12.34 4 12c0-4.42 3.58-8 8-8 2.5 0 4.73 1.15 6.2 2.94M19.94 11C19.98 11.33 20 11.66 20 12c0 4.42-3.58 8-8 8-2.5 0-4.73-1.15-6.2-2.94M9 17H6v.29M18.2 4v2.94M18.2 6.94V7L15.2 7M6 20v-2.71"/></svg>';

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
      if (opts && opts.recurrenceTaskId != null) {
        cell.dataset.recurrenceTaskId = opts.recurrenceTaskId;
      }
      if (opts && opts.tagsTaskId != null) {
        cell.dataset.tagsTaskId = opts.tagsTaskId;
        cell.dataset.tagsJson = opts.tagsJson != null ? opts.tagsJson : '[]';
      }
      if (opts && opts.blockingTaskId != null) {
        cell.dataset.blockingTaskId = opts.blockingTaskId;
      }
      row.appendChild(cell);
    }

    columnKeys.forEach((key) => {
      if (key === 'move') {
        const moveWrap = document.createElement('div');
        moveWrap.className = 'task-row-move';
        moveWrap.innerHTML = moveHandleSvg;
        moveWrap.setAttribute('aria-label', 'Drag to reorder');
        row.appendChild(moveWrap);
        return;
      }
      if (key === 'status') {
        const combined = document.createElement('div');
        combined.className = 'task-cell status-combined-cell';
        const inner = document.createElement('div');
        inner.className = 'task-cell-inner';
        if (showPriority) {
          const p = t.priority;
          const cls = priorityClass(p);
          const title = p != null ? `Priority ${p} (click to change)` : 'No priority (click to set)';
          const priorityHtml = `<span class="priority-circle-wrap ${cls}" title="${title}">${PRIORITY_CIRCLE_SVG}</span>`;
          const priorityCell = document.createElement('div');
          priorityCell.className = 'task-cell priority-cell';
          priorityCell.innerHTML = priorityHtml;
          if (t.id) {
            priorityCell.dataset.priorityTaskId = t.id;
            priorityCell.dataset.priorityValue = p != null ? String(p) : '';
          }
          inner.appendChild(priorityCell);
        }
        if (showFlagged) {
          const flagged = t.flagged === true || t.flagged === 1;
          const flagCell = document.createElement('div');
          flagCell.className = 'task-cell flagged-cell';
          flagCell.innerHTML = `<span class="flagged-icon ${flagged ? '' : 'empty'}" title="${flagged ? 'Flagged (click to unflag)' : 'Click to flag'}">★</span>`;
          if (t.id) {
            flagCell.dataset.flaggedTaskId = t.id;
            flagCell.dataset.flagged = flagged ? '1' : '0';
          }
          inner.appendChild(flagCell);
        }
        const statusCell = document.createElement('div');
        statusCell.className = 'task-cell status-cell';
        statusCell.innerHTML = statusComplete ? circleTickSvg : circleOpenSvg;
        inner.appendChild(statusCell);
        combined.appendChild(inner);
        row.appendChild(combined);
        return;
      }
      if (key === 'title') {
        addCell('title', `<span class="cell-value">${formatTitleWithTagPills((t.title || '(no title)').trim())}</span>`, { titleTaskId: t.id });
        return;
      }
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
      }
      if (key === 'due_date') {
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
      }
      if (key === 'description') {
        const d = (t.notes || t.description || '').trim();
        let tooltip = d ? d.replace(/"/g, '&quot;').replace(/</g, '&lt;') : 'No notes (click to add)';
        if (tooltip.length > 500) tooltip = tooltip.substring(0, 500) + '…';
        const iconClass = 'description-icon-wrap ' + (d ? '' : 'empty');
        html = `<span class="${iconClass}" title="${tooltip}">${documentIconSvg}</span>`;
        addCell(key, html, { descriptionTaskId: t.id });
        return;
      }
      if (key === 'projects') {
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
      }
      if (key === 'tags') {
        const tg = (t.tags || []).map((x) => String(x).trim()).filter(Boolean);
        const hasVal = tg.length > 0;
        const iconClass = 'tags-icon-wrap ' + (hasVal ? '' : 'empty');
        const title = hasVal ? `Tags: ${tg.join(', ')} (click to edit)` : 'No tags (click to assign)';
        html = `<span class="${iconClass}" title="${title.replace(/"/g, '&quot;')}">${tagIconSvg}</span>`;
        addCell(key, html, { tagsTaskId: t.id, tagsJson: JSON.stringify(tg) });
        return;
      }
      if (key === 'recurrence') {
        const hasRec = t.recurrence && typeof t.recurrence === 'object' && (t.recurrence.freq || t.recurrence.interval);
        const iconClass = 'recurrence-icon-wrap ' + (hasRec ? '' : 'empty');
        const title = hasRec ? 'Recurring (click to edit)' : 'Click to set recurrence';
        html = `<span class="${iconClass}" title="${title}">${refreshIconSvg}</span>`;
        addCell(key, html, { recurrenceTaskId: t.id });
        return;
      }
      if (key === 'blocking') {
        const dependsOn = (t.depends_on || []);
        const blocks = (t.blocks || []);
        const hasBlocking = dependsOn.length > 0 || blocks.length > 0;
        const iconClass = 'blocking-icon-wrap ' + (hasBlocking ? '' : 'blocking-icon-muted');
        const title = hasBlocking ? 'Blocking (click to edit)' : 'Click to set blocking';
        html = `<span class="${iconClass}" title="${title}">${BLOCKING_ICON_SVG}</span>`;
        addCell(key, html, { blockingTaskId: t.id });
        return;
      }
      addCell(key, html);
    });

    const statusCell = row.querySelector('.status-cell');
    if (statusCell) statusCell.classList.add('task-cell-clickable');
    const flaggedCell = row.querySelector('.flagged-cell');
    if (flaggedCell && flaggedCell.dataset.flaggedTaskId) flaggedCell.classList.add('task-cell-clickable');
    row.querySelectorAll('[data-date-field]').forEach((cell) => cell.classList.add('task-cell-clickable'));
    const projectsCell = row.querySelector('.projects-cell');
    if (projectsCell && projectsCell.dataset.projectsTaskId) projectsCell.classList.add('task-cell-clickable');
    const descriptionCell = row.querySelector('.description-cell');
    if (descriptionCell && descriptionCell.dataset.descriptionTaskId) descriptionCell.classList.add('task-cell-clickable');
    const tagsCell = row.querySelector('.tags-cell');
    if (tagsCell && tagsCell.dataset.tagsTaskId) tagsCell.classList.add('task-cell-clickable');
    const priorityCell = row.querySelector('.priority-cell');
    if (priorityCell && priorityCell.dataset.priorityTaskId) priorityCell.classList.add('task-cell-clickable');
    const recurrenceCell = row.querySelector('.recurrence-cell');
    if (recurrenceCell && recurrenceCell.dataset.recurrenceTaskId) recurrenceCell.classList.add('task-cell-clickable');
    const blockingCell = row.querySelector('.blocking-cell');
    if (blockingCell && blockingCell.dataset.blockingTaskId) blockingCell.classList.add('task-cell-clickable');

    return row;
  }

  function startTitleEdit(titleCell) {
    const row = titleCell.closest('.task-row');
    const taskId = row && row.dataset.id;
    if (!taskId) return;
    titleEditInProgress = true;
    const span = titleCell.querySelector('.cell-value');
    const currentTitle = (span && span.textContent || '').trim() || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'task-title-edit-input';
    input.value = currentTitle;
    input.setAttribute('aria-label', 'Edit task title');
    titleCell.innerHTML = '';
    titleCell.appendChild(input);
    attachHashtagAutocomplete(input);
    input.focus();
    input.select();

    function saveAndClose() {
      titleEditInProgress = false;
      const newTitle = (input.value || '').trim();
      const displayTitle = newTitle || '(no title)';
      titleCell.innerHTML = `<span class="cell-value">${formatTitleWithTagPills(displayTitle)}</span>`;
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
      titleEditInProgress = false;
      titleCell.innerHTML = `<span class="cell-value">${formatTitleWithTagPills(currentTitle || '(no title)')}</span>`;
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
    updateCenterHeaderForSource();
    const center = document.getElementById('center-content');
    if (!tasks || !tasks.length) {
      displayedTasks = [];
      center.innerHTML = '<p class="placeholder">No tasks.</p>';
      return;
    }
    const src = source != null ? source : 'project';
    const isListSource = typeof src === 'string' && src.startsWith('list:');
    const { showCompleted, sortBy, manualSort, manualOrder } = getDisplayProperties(src);
    let toShow = showCompleted ? tasks : tasks.filter((t) => !isTaskCompleted(t));
    if (!isListSource) {
      if (manualSort && manualOrder && manualOrder.length) {
        toShow = orderTasksByManual(toShow, manualOrder);
      } else if (sortBy && sortBy.length) {
        toShow = orderTasksBySort(toShow, sortBy);
      }
    }
    displayedTasks = [...toShow];
    if (!toShow.length) {
      center.innerHTML = '<p class="placeholder">No tasks.</p>';
      return;
    }
    const { order, visible, manualSort: showMove } = getDisplayProperties(src);
    const columnKeys = [];
    if (showMove) columnKeys.push('move');
    columnKeys.push('status');
    columnKeys.push('title');
    order.forEach((k) => { if (visible.has(k)) columnKeys.push(k); });

    const widths = getTaskListColumnWidths(src);
    function colWidth(key) {
      if (key === 'move') return TASK_LIST_MOVE_WIDTH + 'px';
      if (key === 'title') {
        const w = widths[key] != null ? widths[key] : (TASK_LIST_DEFAULT_WIDTHS[key] || 180);
        return `minmax(${Math.max(TASK_LIST_MIN_WIDTH, w)}px, 1fr)`;
      }
      const w = widths[key] != null ? widths[key] : (TASK_LIST_DEFAULT_WIDTHS[key] || 100);
      return `minmax(${TASK_LIST_MIN_WIDTH}px, ${w}px)`;
    }
    const gridCols = columnKeys.map(colWidth).join(' ');
    const wrapper = document.createElement('div');
    wrapper.className = 'task-list-wrapper';
    wrapper.style.setProperty('--task-grid-cols', gridCols);

    const headerRow = document.createElement('div');
    headerRow.className = 'task-list-header-row';
    columnKeys.forEach((colKey) => {
      const th = document.createElement('div');
      let cls = 'task-list-header-cell';
      if (colKey === 'title') cls += ' task-list-header-cell-title';
      if (colKey === 'blocking') cls += ' task-list-header-cell-blocking';
      if (colKey !== 'move') cls += ' has-resize';
      th.className = cls;
      th.textContent = colKey === 'move' ? '' : (TASK_LIST_COLUMN_LABELS[colKey] || colKey);
      if (colKey !== 'move') {
        const handle = document.createElement('div');
        handle.className = 'task-list-resize-handle';
        handle.setAttribute('aria-label', `Resize ${TASK_LIST_COLUMN_LABELS[colKey] || colKey} column`);
        handle.dataset.columnKey = colKey;
        th.appendChild(handle);
      }
      headerRow.appendChild(th);
    });
    wrapper.appendChild(headerRow);

    const ul = document.createElement('ul');
    ul.className = 'task-list';
    ul.style.listStyle = 'none';
    ul.style.padding = '0';
    ul.style.margin = '0';
    toShow.forEach((t) => ul.appendChild(buildTaskRow(t, columnKeys)));
    wrapper.appendChild(ul);
    center.innerHTML = '';
    center.appendChild(wrapper);

    (function setupResize(headerRowEl, wrapperEl, source) {
      headerRowEl.querySelectorAll('.task-list-resize-handle').forEach((handle) => {
        const colKey = handle.dataset.columnKey;
        if (!colKey) return;
        handle.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const startX = e.clientX;
          const colIndex = columnKeys.indexOf(colKey);
          if (colIndex < 0) return;
          const th = headerRowEl.children[colIndex];
          const defaultW = colKey === 'title' ? (TASK_LIST_DEFAULT_WIDTHS[colKey] || 180) : (TASK_LIST_DEFAULT_WIDTHS[colKey] || 100);
          const startColW = th ? th.getBoundingClientRect().width : (widths[colKey] != null ? widths[colKey] : defaultW);
          const onMove = (e2) => {
            const delta = e2.clientX - startX;
            let newW = Math.max(TASK_LIST_MIN_WIDTH, startColW + delta);
            saveTaskListColumnWidth(colKey, newW, source);
            const newWidths = getTaskListColumnWidths(source);
            const newGridCols = columnKeys.map((k) => {
              if (k === 'move') return TASK_LIST_MOVE_WIDTH + 'px';
              if (k === 'title') {
                const w = newWidths[k] != null ? newWidths[k] : (TASK_LIST_DEFAULT_WIDTHS[k] || 180);
                return k === colKey ? `minmax(${newW}px, 1fr)` : `minmax(${Math.max(TASK_LIST_MIN_WIDTH, w)}px, 1fr)`;
              }
              const w = newWidths[k] != null ? newWidths[k] : (TASK_LIST_DEFAULT_WIDTHS[k] || 100);
              return k === colKey ? newW + 'px' : `minmax(${TASK_LIST_MIN_WIDTH}px, ${w}px)`;
            }).join(' ');
            wrapperEl.style.setProperty('--task-grid-cols', newGridCols);
          };
          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
      });
    })(headerRow, wrapper, src);

    if (!isListSource && manualSort) setupTaskListDrag(center, ul, src);
    const inspectorContent = document.getElementById('inspector-content');
    const shownId = inspectorContent && inspectorContent.dataset.taskId;
    if (shownId) {
      const row = Array.from(center.querySelectorAll('.task-row')).find((r) => String(r.dataset.id) === String(shownId));
      if (row) row.classList.add('selected');
    }
  }

  function addDragToRow(row, listEl, source) {
    const ctx = source != null ? source : 'project';
    const handle = row.querySelector('.task-row-move');
    if (!handle) return;
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      let dragged = row;
      row.classList.add('dragging');
      const indicator = document.createElement('div');
      indicator.className = 'drop-indicator';
      indicator.style.display = 'none';
      listEl.appendChild(indicator);
      let dropIndex = 0;
      const onMove = (e2) => {
        if (!dragged) return;
        const items = Array.from(listEl.querySelectorAll('.task-row'));
        const y = e2.clientY;
        const rect = listEl.getBoundingClientRect();
        if (y < rect.top) dropIndex = 0;
        else if (y > rect.bottom) dropIndex = items.length;
        else {
          const idx = items.findIndex((item) => item.getBoundingClientRect().top + item.offsetHeight / 2 > y);
          dropIndex = idx < 0 ? items.length : idx;
        }
        updateDropIndicator(listEl, indicator, dropIndex, items);
      };
      const onUp = () => {
        if (dragged) {
          const items = Array.from(listEl.querySelectorAll('.task-row'));
          if (dropIndex >= 0 && dropIndex <= items.length) {
            listEl.insertBefore(dragged, items[dropIndex] || null);
          }
          dragged.classList.remove('dragging');
        }
        if (indicator.parentNode) indicator.remove();
        dragged = null;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const newOrder = Array.from(listEl.querySelectorAll('.task-row')).map((r) => r.dataset.id).filter(Boolean);
        const { order: o, visible: v, showFlagged: sf, showCompleted: sc, showHighlightDue: sh, showPriority: sp, sortBy: sb } = getDisplayProperties(ctx);
        saveDisplayProperties(ctx, o, v, sf, sc, sh, sp, sb, true, newOrder);
        refreshTaskList();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function setupTaskListDrag(center, listEl, source) {
    listEl.querySelectorAll('.task-row').forEach((row) => addDragToRow(row, listEl, source));
  }

  let pendingTaskClickTimeoutId = null;
  let titleEditInProgress = false;
  function onTaskClick(ev, rowEl) {
    const row = rowEl != null ? rowEl : ev.currentTarget;
    if (!row.classList.contains('task-row')) return;
    ev.stopPropagation();
    const id = row.dataset.id;
    const num = row.dataset.number;
    const isTitleCell = ev.target.closest('.title-cell');
    function doSelectAndLoad() {
      if (titleEditInProgress) return;
      pendingTaskClickTimeoutId = null;
      document.querySelectorAll('#center-content .task-row').forEach((x) => x.classList.remove('selected'));
      row.classList.add('selected');
      document.getElementById('inspector-title').textContent = `Task ${num || id || ''}`;
      document.getElementById('inspector-content').innerHTML = '<p class="placeholder">Loading…</p>';
      if (id) loadTaskDetails(id);
    }
    if (isTitleCell) {
      if (pendingTaskClickTimeoutId) clearTimeout(pendingTaskClickTimeoutId);
      pendingTaskClickTimeoutId = setTimeout(doSelectAndLoad, 600);
    } else {
      doSelectAndLoad();
    }
  }

  (function setupTaskListDelegation() {
    const centerContent = document.getElementById('center-content');
    if (!centerContent) return;
    centerContent.addEventListener('click', (ev) => {
      const row = ev.target.closest('.task-row');
      if (!row || !row.classList.contains('task-row')) return;
      const statusCell = ev.target.closest('.status-cell');
      if (statusCell) {
        ev.stopPropagation();
        updateTaskStatus(row.dataset.id, ev);
        return;
      }
      const flaggedCell = ev.target.closest('.flagged-cell');
      if (flaggedCell && flaggedCell.dataset.flaggedTaskId) {
        ev.stopPropagation();
        updateTaskFlag(row.dataset.id, ev);
        return;
      }
      const dateCell = ev.target.closest('[data-date-field]');
      if (dateCell) {
        ev.stopPropagation();
        openDateDropdown(ev, dateCell);
        return;
      }
      const projectsCell = ev.target.closest('.projects-cell');
      if (projectsCell && projectsCell.dataset.projectsTaskId) {
        ev.stopPropagation();
        openProjectsDropdown(ev, projectsCell);
        return;
      }
      const descriptionCell = ev.target.closest('.description-cell');
      if (descriptionCell && descriptionCell.dataset.descriptionTaskId) {
        ev.stopPropagation();
        openDescriptionModal(ev, descriptionCell);
        return;
      }
      const tagsCell = ev.target.closest('.tags-cell');
      if (tagsCell && tagsCell.dataset.tagsTaskId) {
        ev.stopPropagation();
        openTaskTagsDropdown(ev, tagsCell, { taskId: tagsCell.dataset.tagsTaskId, currentTags: JSON.parse(tagsCell.dataset.tagsJson || '[]') });
        return;
      }
      const priorityCell = ev.target.closest('.priority-cell');
      if (priorityCell && priorityCell.dataset.priorityTaskId) {
        ev.stopPropagation();
        openPriorityDropdown(ev, priorityCell);
        return;
      }
      const recurrenceCell = ev.target.closest('.recurrence-cell');
      if (recurrenceCell && recurrenceCell.dataset.recurrenceTaskId) {
        ev.stopPropagation();
        openRecurrenceModal(recurrenceCell.dataset.recurrenceTaskId);
        return;
      }
      const blockingCell = ev.target.closest('.blocking-cell');
      if (blockingCell && blockingCell.dataset.blockingTaskId) {
        ev.stopPropagation();
        openBlockingModal(blockingCell.dataset.blockingTaskId);
        return;
      }
      ev.stopPropagation();
      onTaskClick(ev, row);
    });
    centerContent.addEventListener('dblclick', (ev) => {
      const titleCell = ev.target.closest('.title-cell');
      if (!titleCell || !titleCell.dataset.titleTaskId) return;
      const row = ev.target.closest('.task-row');
      if (!row) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (pendingTaskClickTimeoutId) {
        clearTimeout(pendingTaskClickTimeoutId);
        pendingTaskClickTimeoutId = null;
      }
      startTitleEdit(titleCell);
    });
  })();

  // --- Inbox (tasks with no project) ---
  function onInboxClick() {
    currentInspectorTag = null;
    lastTaskSource = 'inbox';
    if (inboxItem) inboxItem.classList.add('selected');
    projectsList.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
    if (listsListEl) listsListEl.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
    if (tagsListEl) tagsListEl.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
    if (favoritesListEl) favoritesListEl.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
    document.getElementById('center-title').textContent = 'Inbox';
    const centerDescInbox = document.getElementById('center-description');
    if (centerDescInbox) centerDescInbox.textContent = '';
    document.getElementById('center-content').innerHTML = '<p class="placeholder">Loading…</p>';
    document.getElementById('inspector-title').textContent = 'Inspector';
    document.getElementById('inspector-content').innerHTML = '<p class="placeholder">Select an item to inspect.</p>';
    lastSelectedTaskBlocking = null;
    applyBlockingHighlights();
    updateCenterHeaderForSource();
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

  async function runSearch(query) {
    const q = (query || '').trim();
    if (!q) return;
    lastSearchQuery = q;
    lastTaskSource = 'search';
    const centerTitle = document.getElementById('center-title');
    const centerDesc = document.getElementById('center-description');
    const center = document.getElementById('center-content');
    if (centerTitle) centerTitle.textContent = `Search for "${q}"`;
    if (centerDesc) centerDesc.textContent = '';
    center.innerHTML = '<p class="placeholder">Searching…</p>';
    lastSelectedTaskBlocking = null;
    applyBlockingHighlights();
    if (inboxItem) inboxItem.classList.remove('selected');
    if (projectsList) projectsList.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
    if (listsListEl) listsListEl.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
    if (favoritesListEl) favoritesListEl.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
    updateCenterHeaderForSource();
    try {
      const isTag = q.startsWith('#');
      const term = isTag ? q.slice(1).trim() : q;
      if (!term) {
        center.innerHTML = '<p class="placeholder">Enter a search term or #tag.</p>';
        return;
      }
      const params = new URLSearchParams();
      params.set('limit', '500');
      params.set('status', 'incomplete');
      if (isTag) params.set('q', term);
      else params.set('search', term);
      const raw = await api(`/api/external/tasks?${params.toString()}`);
      const list = Array.isArray(raw) ? raw : [];
      const termLower = term.toLowerCase();
      const tasks = list.filter((t) => {
        const title = (t.title || '').toLowerCase();
        const desc = (t.notes || t.description || '').toLowerCase();
        const tags = (t.tags || []).map((tag) => String(tag).toLowerCase());
        if (isTag) return tags.some((tag) => tag === termLower || tag.includes(termLower));
        return title.includes(termLower) || desc.includes(termLower) || tags.some((tag) => tag.includes(termLower));
      });
      renderTaskList(tasks, 'search');
    } catch (e) {
      center.innerHTML = '<p class="placeholder">' + (e.message || 'Search failed') + '</p>';
      lastTasks = [];
    }
  }

  // --- Load projects (left panel) and task counts for Inbox / Projects ---
  async function loadProjects() {
    const key = getApiKey();
    if (!key) {
      projectsList.innerHTML = '<li class="nav-item placeholder">Set API key in Settings</li>';
      if (inboxCountEl) inboxCountEl.textContent = '';
      return;
    }
    if (!normalizedPrioritiesThisSession) {
      try {
        await api('/api/external/tasks/normalize-priorities', { method: 'POST' });
        normalizedPrioritiesThisSession = true;
      } catch (_) {}
    }
    try {
      const [list, tasksRaw, listsRaw] = await Promise.all([
        api('/api/external/projects?status=active'),
        api('/api/external/tasks?limit=1000').catch(() => []),
        api('/api/external/lists').catch(() => []),
      ]);
      const tasks = Array.isArray(tasksRaw) ? tasksRaw : [];
      const showDueOverdueCounts = getShowDueOverdueCounts();
      const countRendererNav = showDueOverdueCounts ? (c) => renderNavCounts(c) : (c) => renderNavCountsSimple(c);
      const inboxTasks = tasks.filter((t) => !t.projects || t.projects.length === 0);
      if (inboxCountEl) inboxCountEl.innerHTML = countRendererNav(countTasksByBucket(inboxTasks));

      projectListCache = Array.isArray(list) ? list : [];
      listsListCache = applyListOrder(Array.isArray(listsRaw) ? listsRaw : []);
      if (!projectListCache.length) {
        projectsList.innerHTML = '<li class="nav-item placeholder">No projects</li>';
        const listsList0 = document.getElementById('lists-list');
        if (listsList0) {
          const listPlaceholder0 = listsList0.querySelector('.nav-item.placeholder');
          if (listPlaceholder0) {
            const showDueOverdue0 = getShowDueOverdueCounts();
            const countRenderer0 = showDueOverdue0 ? (c) => renderNavCounts(c) : (c) => renderNavCountsSimple(c);
            const countWrap0 = listPlaceholder0.querySelector('.nav-item-count');
            if (countWrap0) countWrap0.outerHTML = countRenderer0(countTasksByBucket([]));
          }
        }
        return;
      }
      const projectOrder = getProjectOrder();
      if (projectOrder.length) {
        projectListCache.sort((a, b) => {
          const ia = projectOrder.indexOf(String(a.id));
          const ib = projectOrder.indexOf(String(b.id));
          if (ia !== -1 && ib !== -1) return ia - ib;
          if (ia !== -1) return -1;
          if (ib !== -1) return 1;
          const nameA = (a.name || a.short_id || '').toString().toLowerCase();
          const nameB = (b.name || b.short_id || '').toString().toLowerCase();
          return nameA.localeCompare(nameB, undefined, { numeric: true });
        });
      } else {
        projectListCache.sort((a, b) => {
          const nameA = (a.name || a.short_id || '').toString().toLowerCase();
          const nameB = (b.name || b.short_id || '').toString().toLowerCase();
          return nameA.localeCompare(nameB, undefined, { numeric: true });
        });
      }
      const projectTasksMap = new Map();
      projectListCache.forEach((p) => projectTasksMap.set(String(p.id), []));
      tasks.forEach((t) => {
        (t.projects || []).forEach((pid) => {
          const k = String(pid);
          if (projectTasksMap.has(k)) projectTasksMap.get(k).push(t);
        });
      });
      const archiveSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M20.5 7V13C20.5 16.7712 20.5 18.6569 19.3284 19.8284C18.1569 21 16.2712 21 12.5 21H11.5C7.72876 21 5.84315 21 4.67157 19.8284C3.5 18.6569 3.5 16.7712 3.5 13V7"/><path d="M2 5C2 4.05719 2 3.58579 2.29289 3.29289C2.58579 3 3.05719 3 4 3H20C20.9428 3 21.4142 3 21.7071 3.29289C22 3.58579 22 4.05719 22 5C22 5.94281 22 6.41421 21.7071 6.70711C21.4142 7 20.9428 7 20 7H4C3.05719 7 2.58579 7 2.29289 6.70711C2 6.41421 2 5.94281 2 5Z"/><path d="M12 7L12 16M12 16L15 12.6667M12 16L9 12.6667"/></svg>';
      const minusSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>';
      const moveSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 6C22.5523 6 23 6.44772 23 7C23 7.55229 22.5523 8 22 8H2C1.44772 8 1 7.55228 1 7C1 6.44772 1.44772 6 2 6L22 6Z"/><path d="M22 11C22.5523 11 23 11.4477 23 12C23 12.5523 22.5523 13 22 13H2C1.44772 13 1 12.5523 1 12C1 11.4477 1.44772 11 2 11H22Z"/><path d="M23 17C23 16.4477 22.5523 16 22 16H2C1.44772 16 1 16.4477 1 17C1 17.5523 1.44772 18 2 18H22C22.5523 18 23 17.5523 23 17Z"/></svg>';
      projectsList.innerHTML = projectListCache.map((p) => {
        const name = (p.name || p.short_id || 'Project').replace(/</g, '&lt;');
        const projectTasks = projectTasksMap.get(String(p.id)) || [];
        const countHtml = countRendererNav(countTasksByBucket(projectTasks));
        const label = (p.name || p.short_id || 'Project').replace(/</g, '&lt;').replace(/"/g, '&quot;');
        const idEsc = (p.id || '').replace(/"/g, '&quot;');
        const isFav = isInFavorites('project', p.id);
        const starIcon = isFav ? STAR_PROHIBITED_SVG_14 : STAR_ADD_SVG_14;
        const favTitle = isFav ? 'Remove from favorites' : 'Add to favorites';
        const favBtn = `<button type="button" class="nav-action-btn nav-item-favorite-toggle" data-favorite="${isFav ? '1' : '0'}" title="${favTitle}" aria-label="${favTitle}">${starIcon}</button>`;
        const actions = `<span class="nav-item-actions">${favBtn}<button type="button" class="nav-action-btn nav-item-archive" title="Archive" aria-label="Archive project">${archiveSvg}</button><button type="button" class="nav-action-btn nav-item-delete" title="Delete" aria-label="Delete project">${minusSvg}</button><span class="nav-item-drag-handle" title="Reorder" aria-label="Drag to reorder">${moveSvg}</span></span>`;
        return `<li class="nav-item" data-type="project" data-id="${idEsc}" data-label="${label}">${name}${countHtml}${actions}</li>`;
      }).join('');
      projectsList.querySelectorAll('.nav-item').forEach((el) => {
        el.addEventListener('click', onProjectClick);
      });
      projectsList.querySelectorAll('.nav-item-archive').forEach((btn) => {
        btn.addEventListener('click', (e) => { e.stopPropagation(); onProjectArchive(e); });
      });
      projectsList.querySelectorAll('.nav-item-delete').forEach((btn) => {
        btn.addEventListener('click', (e) => { e.stopPropagation(); onProjectDelete(e); });
      });
      projectsList.querySelectorAll('.nav-item-favorite-toggle').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const li = btn.closest('.nav-item');
          if (!li || !li.dataset.id) return;
          const id = li.dataset.id;
          const label = (li.dataset.label || 'Project').replace(/&quot;/g, '"');
          if (isInFavorites('project', id)) {
            removeFromFavorites('project', id);
          } else {
            addToFavorites('project', id, label);
          }
          loadProjects();
        });
      });
      projectsList.querySelectorAll('.nav-item-drag-handle').forEach((handle) => {
        handle.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); onNavItemDragStart(e, 'project'); });
      });
      const listsList = document.getElementById('lists-list');
      if (listsList) {
        loadLists();
      }
      loadTags(tasks);
    } catch (e) {
      projectListCache = [];
      projectsList.innerHTML = `<li class="nav-item placeholder">${e.message || 'Error'}</li>`;
      if (inboxCountEl) inboxCountEl.textContent = '';
    }
  }

  function onProjectClick(ev) {
    if (ev.target.closest('.nav-item-actions')) return;
    const li = ev.currentTarget;
    if (li.classList.contains('placeholder')) return;
    currentInspectorTag = null;
    if (inboxItem) inboxItem.classList.remove('selected');
    projectsList.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
    if (listsListEl) listsListEl.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
    if (tagsListEl) tagsListEl.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
    if (favoritesListEl) favoritesListEl.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
    li.classList.add('selected');
    const type = li.dataset.type;
    const id = li.dataset.id;
    lastTaskSource = type === 'project' && id ? id : null;
    updateCenterHeaderForSource();
    document.getElementById('center-title').textContent = type === 'project' ? (li.dataset.label || 'Project') : 'List';
    const centerDescNav = document.getElementById('center-description');
    if (centerDescNav) centerDescNav.textContent = '';
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

  function getProjectOrder() {
    try {
      const raw = localStorage.getItem(NAV_PROJECT_ORDER_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr.map(String) : [];
      }
    } catch (_) {}
    return [];
  }
  function saveProjectOrder(ids) {
    try {
      localStorage.setItem(NAV_PROJECT_ORDER_KEY, JSON.stringify(ids));
    } catch (_) {}
  }
  function getListOrder() {
    try {
      const raw = localStorage.getItem(NAV_LIST_ORDER_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr.map(String) : [];
      }
    } catch (_) {}
    return [];
  }
  function saveListOrder(ids) {
    try {
      localStorage.setItem(NAV_LIST_ORDER_KEY, JSON.stringify(ids));
    } catch (_) {}
  }
  function getFavorites() {
    try {
      const raw = localStorage.getItem(NAV_FAVORITES_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr.filter((f) => f && (f.type === 'project' || f.type === 'list' || f.type === 'board' || f.type === 'tag') && f.id) : [];
      }
    } catch (_) {}
    return [];
  }
  function saveFavorites(arr) {
    try {
      localStorage.setItem(NAV_FAVORITES_KEY, JSON.stringify(arr));
    } catch (_) {}
  }
  function isInFavorites(type, id) {
    const favs = getFavorites();
    return favs.some((f) => f.type === type && String(f.id) === String(id));
  }
  function addToFavorites(type, id, label) {
    if (isInFavorites(type, id)) return;
    const favs = getFavorites();
    const defaultLabel = type === 'project' ? 'Project' : type === 'list' ? 'List' : type === 'board' ? 'Board' : 'Tag';
    favs.push({ type, id: String(id), label: String(label || defaultLabel) });
    saveFavorites(favs);
    loadFavorites();
  }
  function removeFromFavorites(type, id) {
    const favs = getFavorites().filter((f) => !(f.type === type && String(f.id) === String(id)));
    saveFavorites(favs);
    loadFavorites();
  }
  function getBoards() {
    try {
      const raw = localStorage.getItem(NAV_BOARDS_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr.filter((b) => b && b.id && (b.baseType === 'project' || b.baseType === 'list') && b.baseId) : [];
      }
    } catch (_) {}
    return [];
  }
  function saveBoards(boards) {
    try {
      localStorage.setItem(NAV_BOARDS_KEY, JSON.stringify(boards));
    } catch (_) {}
  }
  function getBoardOrder() {
    try {
      const raw = localStorage.getItem(NAV_BOARD_ORDER_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr.map(String) : [];
      }
    } catch (_) {}
    return [];
  }
  function saveBoardOrder(ids) {
    try {
      localStorage.setItem(NAV_BOARD_ORDER_KEY, JSON.stringify(ids));
    } catch (_) {}
  }
  const favoritesListEl = document.getElementById('favorites-list');
  const boardsListEl = document.getElementById('boards-list');
  const NAV_PROJECT_ICON_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M2 6C2 4.34315 3.34315 3 5 3H7.75093C8.82997 3 9.86325 3.43595 10.6162 4.20888L9.94852 4.85927L10.6162 4.20888L11.7227 5.34484C11.911 5.53807 12.1693 5.64706 12.4391 5.64706H16.4386C18.5513 5.64706 20.281 7.28495 20.4284 9.35939C21.7878 9.88545 22.5642 11.4588 21.977 12.927L20.1542 17.4853C19.5468 19.0041 18.0759 20 16.4402 20H6C4.88522 20 3.87543 19.5427 3.15116 18.8079C2.44035 18.0867 2 17.0938 2 16V6ZM18.3829 9.17647C18.1713 8.29912 17.3812 7.64706 16.4386 7.64706H12.4391C11.6298 7.64706 10.8548 7.3201 10.2901 6.7404L9.18356 5.60444L9.89987 4.90666L9.18356 5.60444C8.80709 5.21798 8.29045 5 7.75093 5H5C4.44772 5 4 5.44772 4 6V14.4471L5.03813 11.25C5.43958 10.0136 6.59158 9.17647 7.89147 9.17647H18.3829ZM5.03034 17.7499L6.94036 11.8676C7.07417 11.4555 7.45817 11.1765 7.89147 11.1765H19.4376C19.9575 11.1765 20.3131 11.7016 20.12 12.1844L18.2972 16.7426C17.9935 17.502 17.258 18 16.4402 18H6C5.64785 18 5.31756 17.9095 5.03034 17.7499Z"/></svg>';
  const NAV_LIST_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" xmlns="http://www.w3.org/2000/svg"><path d="M8 5.00005C7.01165 5.00082 6.49359 5.01338 6.09202 5.21799C5.71569 5.40973 5.40973 5.71569 5.21799 6.09202C5 6.51984 5 7.07989 5 8.2V17.8C5 18.9201 5 19.4802 5.21799 19.908C5.40973 20.2843 5.71569 20.5903 6.09202 20.782C6.51984 21 7.07989 21 8.2 21H15.8C16.9201 21 17.4802 21 17.908 20.782C18.2843 20.5903 18.5903 20.2843 18.782 19.908C19 19.4802 19 18.9201 19 17.8V8.2C19 7.07989 19 6.51984 18.782 6.09202C18.5903 5.71569 18.2843 5.40973 17.908 5.21799C17.5064 5.01338 16.9884 5.00082 16 5.00005M8 5.00005V7H16V5.00005M8 5.00005V4.70711C8 4.25435 8.17986 3.82014 8.5 3.5C8.82014 3.17986 9.25435 3 9.70711 3H14.2929C14.7456 3 15.1799 3.17986 15.5 3.5C15.8201 3.82014 16 4.25435 16 4.70711V5.00005M15 12H12M15 16H12M9 12H9.01M9 16H9.01" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const NAV_TAG_ICON_SVG = '<svg class="nav-tag-icon" viewBox="0 0 24 24" fill="currentColor" width="14" height="14" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M4 5C4 4.44772 4.44772 4 5 4H11.1716C11.4368 4 11.6911 4.10536 11.8787 4.29289L19.8787 12.2929C20.2692 12.6834 20.2692 13.3166 19.8787 13.7071L13.7071 19.8787C13.3166 20.2692 12.6834 20.2692 12.2929 19.8787L4.29289 11.8787C4.10536 11.6911 4 11.4368 4 11.1716V5ZM5 2C3.34315 2 2 3.34315 2 5L2 11.1716C2 11.9672 2.31607 12.7303 2.87868 13.2929L10.8787 21.2929C12.0503 22.4645 13.9497 22.4645 15.1213 21.2929L21.2929 15.1213C22.4645 13.9497 22.4645 12.0503 21.2929 10.8787L13.2929 2.87868C12.7303 2.31607 11.9672 2 11.1716 2H5ZM8 10C9.10457 10 10 9.10457 10 8C10 6.89543 9.10457 6 8 6C6.89543 6 6 6.89543 6 8C6 9.10457 6.89543 10 8 10Z"/></svg>';
  const NAV_BOARD_ICON_SVG = '<svg class="section-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill-rule="nonzero" d="M18.25 2.5C19.98 2.5 21.4 3.85 21.5 5.56L21.5 17.75C21.5 19.55 20.05 21 18.25 21H6.25C4.52 21 3.1 19.65 3 17.94L3 5.75C3 3.95 4.46 2.5 6.25 2.5H18.25ZM11.5 9.5H4.5V17.75L4.51 17.91C4.59 18.8 5.34 19.5 6.25 19.5H11.5V9.5ZM20 15.5H13V19.5H18.25C19.22 19.5 20 18.72 20 17.75V15.5ZM18.25 4H13V14H20V5.75C20 4.7 19.16 4 18.25 4ZM11.5 4H6.25C5.21 4 4.5 4.83 4.5 5.75V8H11.5V4Z"/></svg>';
  /* Star-add: add to favorites (from star-add-svgrepo-com). Star-prohibited: remove from favorites (from star-prohibited-svgrepo-com). Both use currentColor for theme. */
  const STAR_ADD_SVG_14 = '<svg class="star-add-icon" viewBox="0 0 24 24" fill="currentColor" width="14" height="14" xmlns="http://www.w3.org/2000/svg"><path fill-rule="nonzero" d="M12.6728137,2.75963841 L15.3563695,8.20794048 L21.3672771,9.07653583 C21.9828509,9.16548822 22.2288847,9.92194118 21.7834166,10.355994 L20.4150744,11.6887401 C19.9202594,11.4400424 19.3893043,11.2526832 18.8321893,11.1366429 L19.6468361,10.3435066 L14.7508503,9.63602099 C14.5061256,9.60065749 14.2945567,9.44694368 14.1853,9.2251246 L12,4.78840895 L9.81470005,9.2251246 C9.70544328,9.44694368 9.49387437,9.60065749 9.24914969,9.63602099 L4.35428754,10.3433442 L7.89856004,13.7927085 C8.07576033,13.9651637 8.15657246,14.2138779 8.11458106,14.4575528 L7.27468983,19.3314183 L11.0013001,17.3686786 C11.0004347,17.4123481 11,17.4561233 11,17.5 C11,18.0076195 11.0581888,18.5016483 11.1682599,18.9757801 L6.6265261,21.3681981 C6.07605002,21.6581549 5.43223188,21.1903936 5.53789075,20.5772582 L6.56928006,14.5921347 L2.21690124,10.3563034 C1.77102944,9.92237116 2.01694609,9.16551755 2.63272295,9.07653583 L8.6436305,8.20794048 L11.3271863,2.75963841 C11.6020985,2.20149668 12.3979015,2.20149668 12.6728137,2.75963841 Z M17.5,13.9992349 L17.4101244,14.0072906 C17.2060313,14.0443345 17.0450996,14.2052662 17.0080557,14.4093593 L17,14.4992349 L16.9996498,16.9992349 L14.4976498,17 L14.4077742,17.0080557 C14.2036811,17.0450996 14.0427494,17.2060313 14.0057055,17.4101244 L13.9976498,17.5 L14.0057055,17.5898756 C14.0427494,17.7939687 14.2036811,17.9549004 14.4077742,17.9919443 L14.4976498,18 L17.0006498,17.9992349 L17.0011076,20.5034847 L17.0091633,20.5933603 C17.0462073,20.7974534 17.207139,20.9583851 17.411232,20.995429 L17.5011076,21.0034847 L17.5909833,20.995429 C17.7950763,20.9583851 17.956008,20.7974534 17.993052,20.5933603 L18.0011076,20.5034847 L18.0006498,17.9992349 L20.5045655,18 L20.5944411,17.9919443 C20.7985342,17.9549004 20.9594659,17.7939687 20.9965098,17.5898756 L21.0045655,17.5 L20.9965098,17.4101244 C20.9594659,17.2060313 20.7985342,17.0450996 20.5944411,17.0080557 L20.5045655,17 L17.9996498,16.9992349 L18,14.4992349 L17.9919443,14.4093593 C17.9549004,14.2052662 17.7939687,14.0443345 17.5898756,14.0072906 L17.5,13.9992349 Z"/></svg>';
  const STAR_PROHIBITED_SVG_14 = '<svg class="star-prohibited-icon" viewBox="0 0 24 24" fill="currentColor" width="14" height="14" xmlns="http://www.w3.org/2000/svg"><path d="M8.64372 8.20797L11.3273 2.75967C11.6022 2.20153 12.398 2.20153 12.6729 2.75967L15.3565 8.20797L21.3674 9.07657C21.9829 9.16552 22.229 9.92197 21.7835 10.356L20.4155 11.689C19.9208 11.4402 19.3899 11.2529 18.8328 11.1368L19.6469 10.3435L14.7509 9.63605C14.5062 9.60069 14.2947 9.44698 14.1854 9.22516L12.0001 4.78844L9.81479 9.22516C9.70554 9.44698 9.49397 9.60069 9.24924 9.63605L4.35438 10.3434L7.89865 13.7927C8.07585 13.9652 8.15667 14.2139 8.11468 14.4576L7.27478 19.3315L11.0013 17.3686C11.0004 17.4123 11 17.4561 11 17.5C11 18.0077 11.0582 18.5018 11.1683 18.976L6.62662 21.3682C6.07614 21.6582 5.43233 21.1904 5.53798 20.5773L6.56937 14.5922L2.217 10.3563C1.77112 9.9224 2.01704 9.16555 2.63282 9.07657L8.64372 8.20797Z"/><path d="M23 17.5C23 20.5376 20.5376 23 17.5 23C14.4624 23 12 20.5376 12 17.5C12 14.4624 14.4624 12 17.5 12C20.5376 12 23 14.4624 23 17.5ZM13.5 17.5C13.5 18.3335 13.755 19.1075 14.1911 19.7482L19.7482 14.1911C19.1075 13.755 18.3335 13.5 17.5 13.5C15.2909 13.5 13.5 15.2909 13.5 17.5ZM17.5 21.5C19.7091 21.5 21.5 19.7091 21.5 17.5C21.5 16.6665 21.245 15.8925 20.8089 15.2518L15.2518 20.8089C15.8925 21.245 16.6665 21.5 17.5 21.5Z"/></svg>';
  const STAR_ADD_SVG_18 = '<svg class="star-add-icon" viewBox="0 0 24 24" fill="currentColor" width="18" height="18" xmlns="http://www.w3.org/2000/svg"><path fill-rule="nonzero" d="M12.6728137,2.75963841 L15.3563695,8.20794048 L21.3672771,9.07653583 C21.9828509,9.16548822 22.2288847,9.92194118 21.7834166,10.355994 L20.4150744,11.6887401 C19.9202594,11.4400424 19.3893043,11.2526832 18.8321893,11.1366429 L19.6468361,10.3435066 L14.7508503,9.63602099 C14.5061256,9.60065749 14.2945567,9.44694368 14.1853,9.2251246 L12,4.78840895 L9.81470005,9.2251246 C9.70544328,9.44694368 9.49387437,9.60065749 9.24914969,9.63602099 L4.35428754,10.3433442 L7.89856004,13.7927085 C8.07576033,13.9651637 8.15657246,14.2138779 8.11458106,14.4575528 L7.27468983,19.3314183 L11.0013001,17.3686786 C11.0004347,17.4123481 11,17.4561233 11,17.5 C11,18.0076195 11.0581888,18.5016483 11.1682599,18.9757801 L6.6265261,21.3681981 C6.07605002,21.6581549 5.43223188,21.1903936 5.53789075,20.5772582 L6.56928006,14.5921347 L2.21690124,10.3563034 C1.77102944,9.92237116 2.01694609,9.16551755 2.63272295,9.07653583 L8.6436305,8.20794048 L11.3271863,2.75963841 C11.6020985,2.20149668 12.3979015,2.20149668 12.6728137,2.75963841 Z M17.5,13.9992349 L17.4101244,14.0072906 C17.2060313,14.0443345 17.0450996,14.2052662 17.0080557,14.4093593 L17,14.4992349 L16.9996498,16.9992349 L14.4976498,17 L14.4077742,17.0080557 C14.2036811,17.0450996 14.0427494,17.2060313 14.0057055,17.4101244 L13.9976498,17.5 L14.0057055,17.5898756 C14.0427494,17.7939687 14.2036811,17.9549004 14.4077742,17.9919443 L14.4976498,18 L17.0006498,17.9992349 L17.0011076,20.5034847 L17.0091633,20.5933603 C17.0462073,20.7974534 17.207139,20.9583851 17.411232,20.995429 L17.5011076,21.0034847 L17.5909833,20.995429 C17.7950763,20.9583851 17.956008,20.7974534 17.993052,20.5933603 L18.0011076,20.5034847 L18.0006498,17.9992349 L20.5045655,18 L20.5944411,17.9919443 C20.7985342,17.9549004 20.9594659,17.7939687 20.9965098,17.5898756 L21.0045655,17.5 L20.9965098,17.4101244 C20.9594659,17.2060313 20.7985342,17.0450996 20.5944411,17.0080557 L20.5045655,17 L17.9996498,16.9992349 L18,14.4992349 L17.9919443,14.4093593 C17.9549004,14.2052662 17.7939687,14.0443345 17.5898756,14.0072906 L17.5,13.9992349 Z"/></svg>';
  const STAR_PROHIBITED_SVG_18 = '<svg class="star-prohibited-icon" viewBox="0 0 24 24" fill="currentColor" width="18" height="18" xmlns="http://www.w3.org/2000/svg"><path d="M8.64372 8.20797L11.3273 2.75967C11.6022 2.20153 12.398 2.20153 12.6729 2.75967L15.3565 8.20797L21.3674 9.07657C21.9829 9.16552 22.229 9.92197 21.7835 10.356L20.4155 11.689C19.9208 11.4402 19.3899 11.2529 18.8328 11.1368L19.6469 10.3435L14.7509 9.63605C14.5062 9.60069 14.2947 9.44698 14.1854 9.22516L12.0001 4.78844L9.81479 9.22516C9.70554 9.44698 9.49397 9.60069 9.24924 9.63605L4.35438 10.3434L7.89865 13.7927C8.07585 13.9652 8.15667 14.2139 8.11468 14.4576L7.27478 19.3315L11.0013 17.3686C11.0004 17.4123 11 17.4561 11 17.5C11 18.0077 11.0582 18.5018 11.1683 18.976L6.62662 21.3682C6.07614 21.6582 5.43233 21.1904 5.53798 20.5773L6.56937 14.5922L2.217 10.3563C1.77112 9.9224 2.01704 9.16555 2.63282 9.07657L8.64372 8.20797Z"/><path d="M23 17.5C23 20.5376 20.5376 23 17.5 23C14.4624 23 12 20.5376 12 17.5C12 14.4624 14.4624 12 17.5 12C20.5376 12 23 14.4624 23 17.5ZM13.5 17.5C13.5 18.3335 13.755 19.1075 14.1911 19.7482L19.7482 14.1911C19.1075 13.755 18.3335 13.5 17.5 13.5C15.2909 13.5 13.5 15.2909 13.5 17.5ZM17.5 21.5C19.7091 21.5 21.5 19.7091 21.5 17.5C21.5 16.6665 21.245 15.8925 20.8089 15.2518L15.2518 20.8089C15.8925 21.245 16.6665 21.5 17.5 21.5Z"/></svg>';
  const INSPECTOR_STAR_ADD_SVG = STAR_ADD_SVG_18;
  const INSPECTOR_STAR_PROHIBITED_SVG = STAR_PROHIBITED_SVG_18;
  const INSPECTOR_ARCHIVE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="18" height="18" xmlns="http://www.w3.org/2000/svg"><path d="M20.5 7V13C20.5 16.7712 20.5 18.6569 19.3284 19.8284C18.1569 21 16.2712 21 12.5 21H11.5C7.72876 21 5.84315 21 4.67157 19.8284C3.5 18.6569 3.5 16.7712 3.5 13V7"/><path d="M2 5C2 4.05719 2 3.58579 2.29289 3.29289C2.58579 3 3.05719 3 4 3H20C20.9428 3 21.4142 3 21.7071 3.29289C22 3.58579 22 4.05719 22 5C22 5.94281 22 6.41421 21.7071 6.70711C21.4142 7 20.9428 7 20 7H4C3.05719 7 2.58579 7 2.29289 6.70711C2 6.41421 2 5.94281 2 5Z"/><path d="M12 7L12 16M12 16L15 12.6667M12 16L9 12.6667"/></svg>';
  const INSPECTOR_TRASH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18" xmlns="http://www.w3.org/2000/svg"><path d="M18 6L17.1991 18.0129C17.129 19.065 17.0939 19.5911 16.8667 19.99C16.6666 20.3412 16.3648 20.6235 16.0011 20.7998C15.588 21 15.0607 21 14.0062 21H9.99377C8.93927 21 8.41202 21 7.99889 20.7998C7.63517 20.6235 7.33339 20.3412 7.13332 19.99C6.90607 19.5911 6.871 19.065 6.80086 18.0129L6 6M4 6H20M16 6L15.7294 5.18807C15.4671 4.40125 15.3359 4.00784 15.0927 3.71698C14.8779 3.46013 14.6021 3.26132 14.2905 3.13878C13.9376 3 13.523 3 12.6936 3H11.3064C10.477 3 10.0624 3 9.70951 3.13878C9.39792 3.26132 9.12208 3.46013 8.90729 3.71698C8.66405 4.00784 8.53292 4.40125 8.27064 5.18807L8 6M14 10V17M10 10V17"/></svg>';
  const INSPECTOR_SAVE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M18.1716 1C18.702 1 19.2107 1.21071 19.5858 1.58579L22.4142 4.41421C22.7893 4.78929 23 5.29799 23 5.82843V20C23 21.6569 21.6569 23 20 23H4C2.34315 23 1 21.6569 1 20V4C1 2.34315 2.34315 1 4 1H18.1716ZM4 3C3.44772 3 3 3.44772 3 4V20C3 20.5523 3.44772 21 4 21L5 21L5 15C5 13.3431 6.34315 12 8 12L16 12C17.6569 12 19 13.3431 19 15V21H20C20.5523 21 21 20.5523 21 20V6.82843C21 6.29799 20.7893 5.78929 20.4142 5.41421L18.5858 3.58579C18.2107 3.21071 17.702 3 17.1716 3H17V5C17 6.65685 15.6569 8 14 8H10C8.34315 8 7 6.65685 7 5V3H4ZM17 21V15C17 14.4477 16.5523 14 16 14L8 14C7.44772 14 7 14.4477 7 15L7 21L17 21ZM9 3H15V5C15 5.55228 14.5523 6 14 6H10C9.44772 6 9 5.55228 9 5V3Z"/></svg>';
  /* Duplicate icon: from duplicate-document asset, inline SVG with currentColor for theme */
  const INSPECTOR_DUPLICATE_SVG = '<svg viewBox="0 0 512 512" fill="currentColor" width="18" height="18" xmlns="http://www.w3.org/2000/svg"><g transform="translate(64, 42.666667)"><path d="M320,128 L384,192 L384,426.666667 L128,426.666667 L128,128 L320,128 Z M302.314667,170.666667 L170.666667,170.666667 L170.666667,384 L341.333333,384 L341.333333,209.685333 L302.314667,170.666667 Z M277.333333,213.333333 L277.333,256 L320,256 L320,298.666667 L277.333,298.666 L277.333333,341.333333 L234.666667,341.333333 L234.666,298.666 L192,298.666667 L192,256 L234.666,256 L234.666667,213.333333 L277.333333,213.333333 Z M192,0 L256,64 L256,106.666 L213.333,106.666 L213.333333,81.6853333 L174.314667,42.6666667 L42.6666667,42.6666667 L42.6666667,256 L106.666,256 L106.666,298.666 L0,298.666667 L0,0 L192,0 Z"/></g></svg>';
  const INSPECTOR_STATUS_TICK_SVG = '<svg class="inspector-status-img" viewBox="0 0 16 16" fill="currentColor" width="15" height="15" xmlns="http://www.w3.org/2000/svg"><path d="M0 8c0 4.418 3.59 8 8 8 4.418 0 8-3.59 8-8 0-4.418-3.59-8-8-8-4.418 0-8 3.59-8 8zm2 0c0-3.307 2.686-6 6-6 3.307 0 6 2.686 6 6 0 3.307-2.686 6-6 6-3.307 0-6-2.686-6-6zm9.778-1.672l-1.414-1.414L6.828 8.45 5.414 7.036 4 8.45l2.828 2.828 3.182-3.182 1.768-1.768z" fill-rule="evenodd"/></svg>';
  const INSPECTOR_STATUS_OPEN_SVG = '<svg class="inspector-status-img" viewBox="0 0 32 32" fill="currentColor" width="15" height="15" xmlns="http://www.w3.org/2000/svg"><path d="M0 16q0 3.264 1.28 6.208t3.392 5.12 5.12 3.424 6.208 1.248 6.208-1.248 5.12-3.424 3.392-5.12 1.28-6.208-1.28-6.208-3.392-5.12-5.088-3.392-6.24-1.28q-3.264 0-6.208 1.28t-5.12 3.392-3.392 5.12-1.28 6.208zM4 16q0-3.264 1.6-6.016t4.384-4.352 6.016-1.632 6.016 1.632 4.384 4.352 1.6 6.016-1.6 6.048-4.384 4.352-6.016 1.6-6.016-1.6-4.384-4.352-1.6-6.048z"/></svg>';
  const INSPECTOR_DOCUMENT_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M9.29289 1.29289C9.48043 1.10536 9.73478 1 10 1H18C19.6569 1 21 2.34315 21 4V20C21 21.6569 19.6569 23 18 23H6C4.34315 23 3 21.6569 3 20V8C3 7.73478 3.10536 7.48043 3.29289 7.29289L9.29289 1.29289ZM18 3H11V8C11 8.55228 10.5523 9 10 9H5V20C5 20.5523 5.44772 21 6 21H18C18.5523 21 19 20.5523 19 20V4C19 3.44772 18.5523 3 18 3ZM6.41421 7H9V4.41421L6.41421 7ZM7 13C7 12.4477 7.44772 12 8 12H16C16.5523 12 17 12.4477 17 13C17 13.5523 16.5523 14 16 14H8C7.44772 14 7 13.5523 7 13ZM7 17C7 16.4477 7.44772 16 8 16H16C16.5523 16 17 16.4477 17 17C17 17.5523 16.5523 18 16 18H8C7.44772 18 7 17.5523 7 17Z"/></svg>';
  /* Tag icon: from assets/tag-svgrepo-com.svg, currentColor for theme */
  const INSPECTOR_TAG_SVG = '<svg class="inspector-tag-icon" viewBox="0 0 24 24" fill="currentColor" width="18" height="18" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M4 5C4 4.44772 4.44772 4 5 4H11.1716C11.4368 4 11.6911 4.10536 11.8787 4.29289L19.8787 12.2929C20.2692 12.6834 20.2692 13.3166 19.8787 13.7071L13.7071 19.8787C13.3166 20.2692 12.6834 20.2692 12.2929 19.8787L4.29289 11.8787C4.10536 11.6911 4 11.4368 4 11.1716V5ZM5 2C3.34315 2 2 3.34315 2 5L2 11.1716C2 11.9672 2.31607 12.7303 2.87868 13.2929L10.8787 21.2929C12.0503 22.4645 13.9497 22.4645 15.1213 21.2929L21.2929 15.1213C22.4645 13.9497 22.4645 12.0503 21.2929 10.8787L13.2929 2.87868C12.7303 2.31607 11.9672 2 11.1716 2H5ZM8 10C9.10457 10 10 9.10457 10 8C10 6.89543 9.10457 6 8 6C6.89543 6 6 6.89543 6 8C6 9.10457 6.89543 10 8 10Z"/></svg>';
  /* Projects icon: inline SVG with currentColor for theme (from folder-open asset) */
  const INSPECTOR_PROJECTS_ICON_SVG = '<svg class="inspector-projects-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M2 6C2 4.34315 3.34315 3 5 3H7.75093C8.82997 3 9.86325 3.43595 10.6162 4.20888L9.94852 4.85927L10.6162 4.20888L11.7227 5.34484C11.911 5.53807 12.1693 5.64706 12.4391 5.64706H16.4386C18.5513 5.64706 20.281 7.28495 20.4284 9.35939C21.7878 9.88545 22.5642 11.4588 21.977 12.927L20.1542 17.4853C19.5468 19.0041 18.0759 20 16.4402 20H6C4.88522 20 3.87543 19.5427 3.15116 18.8079C2.44035 18.0867 2 17.0938 2 16V6ZM18.3829 9.17647C18.1713 8.29912 17.3812 7.64706 16.4386 7.64706H12.4391C11.6298 7.64706 10.8548 7.3201 10.2901 6.7404L9.18356 5.60444L9.89987 4.90666L9.18356 5.60444C8.80709 5.21798 8.29045 5 7.75093 5H5C4.44772 5 4 5.44772 4 6V14.4471L5.03813 11.25C5.43958 10.0136 6.59158 9.17647 7.89147 9.17647H18.3829ZM5.03034 17.7499L6.94036 11.8676C7.07417 11.4555 7.45817 11.1765 7.89147 11.1765H19.4376C19.9575 11.1765 20.3131 11.7016 20.12 12.1844L18.2972 16.7426C17.9935 17.502 17.258 18 16.4402 18H6C5.64785 18 5.31756 17.9095 5.03034 17.7499Z"/></svg>';
  function loadFavorites() {
    if (!favoritesListEl) return;
    const favs = getFavorites();
    if (!favs.length) {
      favoritesListEl.innerHTML = '<li class="nav-item placeholder">—</li>';
      return;
    }
    const moveSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 6C22.5523 6 23 6.44772 23 7C23 7.55229 22.5523 8 22 8H2C1.44772 8 1 7.55228 1 7C1 6.44772 1.44772 6 2 6L22 6Z"/><path d="M22 11C22.5523 11 23 11.4477 23 12C23 12.5523 22.5523 13 22 13H2C1.44772 13 1 12.5523 1 12C1 11.4477 1.44772 11 2 11H22Z"/><path d="M23 17C23 16.4477 22.5523 16 22 16H2C1.44772 16 1 16.4477 1 17C1 17.5523 1.44772 18 2 18H22C22.5523 18 23 17.5523 23 17Z"/></svg>';
    favoritesListEl.innerHTML = favs.map((f) => {
      const name = (f.label || '').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      const idEsc = (f.id || '').replace(/"/g, '&quot;');
      const actions = `<span class="nav-item-actions"><button type="button" class="nav-action-btn nav-item-delete nav-item-favorite-remove" title="Remove from favorites" aria-label="Remove from favorites">${STAR_PROHIBITED_SVG_14}</button><span class="nav-item-drag-handle" title="Reorder" aria-label="Drag to reorder">${moveSvg}</span></span>`;
      const iconSvg = f.type === 'list' ? NAV_LIST_ICON_SVG : f.type === 'tag' ? NAV_TAG_ICON_SVG : f.type === 'board' ? NAV_BOARD_ICON_SVG : NAV_PROJECT_ICON_SVG;
      const iconHtml = `<span class="nav-item-icon">${iconSvg}</span>`;
      if (f.type === 'list') {
        return `<li class="nav-item nav-item-favorite" data-type="list" data-list-id="${idEsc}" data-id="${idEsc}" data-label="${name}">${iconHtml}${name}${actions}</li>`;
      }
      if (f.type === 'tag') {
        return `<li class="nav-item nav-item-favorite" data-type="tag" data-tag="${idEsc}" data-id="${idEsc}" data-label="${name}">${iconHtml}${name}${actions}</li>`;
      }
      if (f.type === 'board') {
        return `<li class="nav-item nav-item-favorite" data-type="board" data-board-id="${idEsc}" data-id="${idEsc}" data-label="${name}">${iconHtml}${name}${actions}</li>`;
      }
      return `<li class="nav-item nav-item-favorite" data-type="project" data-id="${idEsc}" data-label="${name}">${iconHtml}${name}${actions}</li>`;
    }).join('');
    favoritesListEl.querySelectorAll('.nav-item').forEach((el) => {
      if (el.classList.contains('placeholder')) return;
      el.addEventListener('click', onFavoriteItemClick);
    });
    favoritesListEl.querySelectorAll('.nav-item-favorite-remove').forEach((btn) => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); onFavoriteRemove(e); });
    });
    favoritesListEl.querySelectorAll('.nav-item-drag-handle').forEach((handle) => {
      handle.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); onNavItemDragStart(e, 'favorites'); });
    });
  }
  function onFavoriteItemClick(ev) {
    if (ev.target.closest('.nav-item-actions')) return;
    const li = ev.currentTarget;
    if (li.classList.contains('placeholder')) return;
    if (inboxItem) inboxItem.classList.remove('selected');
    if (projectsList) projectsList.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
    if (listsListEl) listsListEl.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
    if (tagsListEl) tagsListEl.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
    favoritesListEl.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
    li.classList.add('selected');
    const type = li.dataset.type;
    const id = type === 'list' ? li.dataset.listId : type === 'tag' ? (li.dataset.tag || li.dataset.id) : type === 'board' ? (li.dataset.boardId || li.dataset.id) : li.dataset.id;
    const label = li.dataset.label || (type === 'project' ? 'Project' : type === 'tag' ? 'Tag' : type === 'board' ? 'Board' : 'List');
    if (type === 'board' && id) {
      openBoardView(id);
      return;
    }
    if (type === 'tag' && id) {
      currentInspectorTag = id;
      document.getElementById('inspector-title').textContent = 'Tag';
      loadTagDetails(id);
      const tagLi = tagsListEl && tagsListEl.querySelector(`.nav-item[data-tag="${id.replace(/"/g, '\\"')}"]`);
      if (tagLi) {
        tagsListEl.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
        tagLi.classList.add('selected');
      }
      return;
    }
    if (type === 'project' && id) {
      lastTaskSource = id;
      document.getElementById('center-title').textContent = label;
      const centerDesc = document.getElementById('center-description');
      if (centerDesc) centerDesc.textContent = '';
      document.getElementById('inspector-title').textContent = 'Project';
      document.getElementById('inspector-content').innerHTML = '<p class="placeholder">Loading…</p>';
      updateCenterHeaderForSource();
      loadProjectDetails(id);
      loadProjectTasks(id);
    } else if (type === 'list' && id) {
      lastTaskSource = 'list:' + id;
      document.getElementById('center-title').textContent = label;
      const centerDesc = document.getElementById('center-description');
      if (centerDesc) centerDesc.textContent = '';
      document.getElementById('inspector-title').textContent = 'List';
      document.getElementById('inspector-content').innerHTML = '<p class="placeholder">Loading…</p>';
      updateCenterHeaderForSource();
      loadListTasks(id);
      loadListDetails(id);
    }
  }
  async function onFavoriteRemove(ev) {
    const li = ev.target.closest('.nav-item-favorite');
    if (!li) return;
    const type = li.dataset.type;
    const id = type === 'list' ? li.dataset.listId : type === 'tag' ? (li.dataset.tag || li.dataset.id) : type === 'board' ? (li.dataset.boardId || li.dataset.id) : li.dataset.id;
    removeFromFavorites(type, id);
  }
  function loadBoards() {
    if (!boardsListEl) return;
    const boards = getBoards();
    const order = getBoardOrder();
    const sorted = order.length
      ? [...boards].sort((a, b) => {
          const ia = order.indexOf(String(a.id));
          const ib = order.indexOf(String(b.id));
          if (ia !== -1 && ib !== -1) return ia - ib;
          if (ia !== -1) return -1;
          if (ib !== -1) return 1;
          return (a.name || '').localeCompare(b.name || '', undefined, { numeric: true });
        })
      : [...boards].sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true }));
    if (!sorted.length) {
      boardsListEl.innerHTML = '<li class="nav-item placeholder">—</li>';
      return;
    }
    const minusSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>';
    const moveSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 6C22.5523 6 23 6.44772 23 7C23 7.55229 22.5523 8 22 8H2C1.44772 8 1 7.55228 1 7C1 6.44772 1.44772 6 2 6L22 6Z"/><path d="M22 11C22.5523 11 23 11.4477 23 12C23 12.5523 22.5523 13 22 13H2C1.44772 13 1 12.5523 1 12C1 11.4477 1.44772 11 2 11H22Z"/><path d="M23 17C23 16.4477 22.5523 16 22 16H2C1.44772 16 1 16.4477 1 17C1 17.5523 1.44772 18 2 18H22C22.5523 18 23 17.5523 23 17Z"/></svg>';
    boardsListEl.innerHTML = sorted.map((board) => {
      const name = (board.name || 'Board').replace(/</g, '&lt;');
      const idEsc = (board.id || '').replace(/"/g, '&quot;');
      const label = (board.name || 'Board').replace(/"/g, '&quot;');
      const isFav = isInFavorites('board', board.id);
      const starIcon = isFav ? STAR_PROHIBITED_SVG_14 : STAR_ADD_SVG_14;
      const favTitle = isFav ? 'Remove from favorites' : 'Add to favorites';
      const favBtn = `<button type="button" class="nav-action-btn nav-item-favorite-toggle" data-favorite="${isFav ? '1' : '0'}" title="${favTitle}" aria-label="${favTitle}">${starIcon}</button>`;
      const actions = `<span class="nav-item-actions">${favBtn}<button type="button" class="nav-action-btn nav-item-delete nav-item-board-delete" title="Delete board" aria-label="Delete board">${minusSvg}</button><span class="nav-item-drag-handle" title="Reorder" aria-label="Drag to reorder">${moveSvg}</span></span>`;
      return `<li class="nav-item" data-type="board" data-board-id="${idEsc}" data-id="${idEsc}" data-label="${label}">${name}${actions}</li>`;
    }).join('');
    boardsListEl.querySelectorAll('.nav-item').forEach((el) => {
      if (el.classList.contains('placeholder')) return;
      el.addEventListener('click', onBoardClick);
    });
    boardsListEl.querySelectorAll('.nav-item-favorite-toggle').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const li = btn.closest('.nav-item');
        if (!li || !li.dataset.boardId) return;
        const id = li.dataset.boardId;
        const board = getBoards().find((b) => String(b.id) === String(id));
        const label = board ? board.name : 'Board';
        if (isInFavorites('board', id)) removeFromFavorites('board', id);
        else addToFavorites('board', id, label);
        loadBoards();
        loadFavorites();
      });
    });
    boardsListEl.querySelectorAll('.nav-item-board-delete').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const li = btn.closest('.nav-item');
        if (!li || !li.dataset.boardId) return;
        const id = li.dataset.boardId;
        if (!confirm('Delete this board? This cannot be undone.')) return;
        const boards = getBoards().filter((b) => String(b.id) !== String(id));
        saveBoards(boards);
        saveBoardOrder(getBoardOrder().filter((bid) => bid !== id));
        removeFromFavorites('board', id);
        loadBoards();
        if (currentBoardId === id) closeBoardView();
      });
    });
    boardsListEl.querySelectorAll('.nav-item-drag-handle').forEach((handle) => {
      handle.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); onNavItemDragStart(e, 'board'); });
    });
  }
  function onBoardClick(ev) {
    if (ev.target.closest('.nav-item-actions')) return;
    const li = ev.currentTarget;
    if (li.classList.contains('placeholder')) return;
    const id = li.dataset.boardId || li.dataset.id;
    if (id) openBoardView(id);
  }
  const appEl = document.getElementById('app');
  const boardViewEl = document.getElementById('board-view');
  const boardViewTitleEl = document.getElementById('board-view-title');
  const boardViewCloseBtn = document.getElementById('board-view-close');
  const boardDuplicateBtn = document.getElementById('board-duplicate-btn');
  const boardDeleteBtn = document.getElementById('board-delete-btn');
  const boardViewCanvasEl = document.getElementById('board-view-canvas');
  const boardCanvasInnerEl = document.getElementById('board-canvas-inner');
  const boardRegionsLayerEl = document.getElementById('board-regions-layer');
  const boardConnectionsLayerEl = document.getElementById('board-connections-layer');
  const boardCardsLayerEl = document.getElementById('board-cards-layer');
  const boardAddTaskBtn = document.getElementById('board-add-task-btn');
  const boardAddRegionBtn = document.getElementById('board-add-region-btn');
  const boardAddAgendaBtn = document.getElementById('board-add-agenda-btn');
  const boardAddTaskPopover = document.getElementById('board-add-task-popover');
  const boardAddTaskListEl = document.getElementById('board-add-task-list');
  const boardZoomOutBtn = document.getElementById('board-zoom-out');
  const boardZoomInBtn = document.getElementById('board-zoom-in');
  const boardZoomSelect = document.getElementById('board-zoom-select');
  const boardThemeBtn = document.getElementById('board-theme-btn');
  const boardGridBtn = document.getElementById('board-grid-btn');
  const boardGridLayerEl = document.getElementById('board-grid-layer');
  const bottomBarEl = document.querySelector('.bottom-bar');
  const BOARD_GRID_VISIBLE_KEY = 'spaztick_board_grid_visible';
  const BOARD_GRID_SIZE = 30;
  let boardTasksCache = {};
  const BOARD_DEFAULT_CARD_WIDTH = 260;
  const BOARD_DEFAULT_CARD_HEIGHT = 160;
  const BOARD_MIN_CARD_WIDTH = 187;
  const BOARD_MIN_CARD_HEIGHT = 108;
  const BOARD_ZOOM_MIN = 25;
  const BOARD_ZOOM_MAX = 300;
  const BOARD_ZOOM_STEP = 25;
  const BOARD_CARD_EXPAND_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M16 8L21 3M21 3H16M21 3V8M8 8L3 3M3 3L3 8M3 3L8 3M8 16L3 21M3 21H8M3 21L3 16M16 16L21 21M21 21V16M21 21H16"/></svg>';

  function getBoardCards(boardId) {
    const board = getBoards().find((b) => String(b.id) === String(boardId));
    if (!board) return [];
    if (!Array.isArray(board.cards)) board.cards = [];
    return board.cards;
  }
  function setBoardCards(boardId, cards) {
    const boards = getBoards();
    const board = boards.find((b) => String(b.id) === String(boardId));
    if (!board) return;
    board.cards = cards;
    saveBoards(boards);
  }

  const BOARD_REGION_DEFAULT_SIZE = 220;
  const BOARD_REGION_COLORS = ['#e5e7eb', '#fef3c7', '#d1fae5', '#dbeafe', '#e9d5ff', '#fce7f3', '#fed7aa', '#d6d3d1'];
  function getBoardRegions(boardId) {
    const board = getBoards().find((b) => String(b.id) === String(boardId));
    if (!board) return [];
    if (!Array.isArray(board.regions)) board.regions = [];
    return board.regions;
  }
  function setBoardRegions(boardId, regions) {
    const boards = getBoards();
    const board = boards.find((b) => String(b.id) === String(boardId));
    if (!board) return;
    board.regions = regions;
    saveBoards(boards);
  }

  /** Agenda: date range as YYYY-MM-DD array (local dates). direction: before | after | before_and_after. days: 1-4. */
  function getAgendaDateRange(region) {
    const n = Math.min(4, Math.max(1, parseInt(region.agendaDays, 10) || 1));
    const dir = region.agendaDirection || 'before_and_after';
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    const today = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dates = [];
    if (dir === 'before' || dir === 'before_and_after') {
      for (let i = n; i >= 1; i--) {
        const day = new Date(y, m, d - i);
        dates.push(`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`);
      }
    }
    dates.push(today);
    if (dir === 'after' || dir === 'before_and_after') {
      for (let i = 1; i <= n; i++) {
        const day = new Date(y, m, d + i);
        dates.push(`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`);
      }
    }
    return dates;
  }

  function formatAgendaDayHeader(dateStr) {
    const d = parseDateValue(dateStr);
    if (!d) return dateStr || '';
    const wd = WEEKDAY_NAMES[d.getDay()];
    const m = d.getMonth() + 1;
    const day = d.getDate();
    return `${wd} ${m}/${day}`;
  }

  /** Which column indices (0-based) does this task touch? null = outside range. */
  function getTaskAgendaColumnIndices(task, dateRange) {
    if (!dateRange.length || !task) return null;
    const av = (task.available_date) ? String(task.available_date).trim().substring(0, 10) : '';
    const due = (task.due_date) ? String(task.due_date).trim().substring(0, 10) : '';
    const dateSet = new Set(dateRange);
    const hasAv = av && /^\d{4}-\d{2}-\d{2}$/.test(av) && dateSet.has(av);
    const hasDue = due && /^\d{4}-\d{2}-\d{2}$/.test(due) && dateSet.has(due);
    if (!hasAv && !hasDue) return null;
    const avIdx = hasAv ? dateRange.indexOf(av) : -1;
    const dueIdx = hasDue ? dateRange.indexOf(due) : -1;
    let startIdx = avIdx >= 0 ? avIdx : dueIdx;
    let endIdx = dueIdx >= 0 ? dueIdx : avIdx;
    if (startIdx < 0) return null;
    if (endIdx < 0) endIdx = startIdx;
    if (startIdx > endIdx) { const t = startIdx; startIdx = endIdx; endIdx = t; }
    const out = [];
    for (let i = startIdx; i <= endIdx; i++) out.push(i);
    return out;
  }

  /** Sort for agenda: priority desc (3 first), then due date desc (null last), then name asc. */
  function agendaTaskSortCompare(a, b) {
    const pa = a && a.priority != null ? a.priority : -1;
    const pb = b && b.priority != null ? b.priority : -1;
    if (pa !== pb) return pb - pa;
    const da = (a && a.due_date) ? String(a.due_date).trim().substring(0, 10) : '';
    const db = (b && b.due_date) ? String(b.due_date).trim().substring(0, 10) : '';
    if (da !== db) {
      if (!da) return 1;
      if (!db) return -1;
      return db.localeCompare(da);
    }
    const na = (a && a.title) ? String(a.title) : '';
    const nb = (b && b.title) ? String(b.title) : '';
    return na.localeCompare(nb, undefined, { sensitivity: 'base' });
  }

  /** Get task for board context: from boardTasksCache if available, else getTaskById. */
  function getTaskForBoard(boardId, taskId) {
    const id = String(taskId);
    const cache = boardTasksCache[boardId];
    if (cache) {
      const t = cache.find((x) => String(x.id) === id);
      if (t) return t;
    }
    return getTaskById(taskId);
  }

  /** Apply region addTags (only if task doesn't have them) and setPriority to a single task.
   *  options.useFreshTask: if true, fetch task from API before applying (use after cross-region drop so tags are up to date). */
  async function applyRegionSettingsToTask(taskId, region, boardId, options) {
    if (!region || !taskId) return;
    let task = getTaskForBoard(boardId, taskId);
    if (options && options.useFreshTask) {
      try {
        task = await api(`/api/external/tasks/${encodeURIComponent(taskId)}`);
      } catch (_) {
        if (!task) return;
      }
    }
    const addTags = Array.isArray(region.addTags) ? region.addTags : [];
    const currentTags = Array.isArray(task && task.tags) ? task.tags : [];
    const tagSet = new Set(currentTags.map((t) => String(t).toLowerCase()));
    const toAdd = addTags.filter((tag) => !tagSet.has(String(tag).toLowerCase()));
    const newTags = toAdd.length ? [...currentTags, ...toAdd] : null;
    const body = {};
    if (newTags) body.tags = newTags;
    if (region.setPriority !== undefined) body.priority = region.setPriority;
    if (Object.keys(body).length) await updateTask(taskId, body);
  }

  /** Apply region addTags and setPriority to all tasks currently in the region. */
  async function applyRegionSettingsToSnappedTasks(region, boardId) {
    if (!region || !boardId) return;
    const lines = region.lines || [];
    for (const line of lines) {
      const taskId = line.taskId;
      if (taskId) await applyRegionSettingsToTask(taskId, region, boardId);
    }
  }

  /** When a task is unsnapped from a region, remove region addTags from the task if removeTagsOnUnsnap is set. */
  async function onTaskUnsnappedFromRegion(taskId, region, boardIdForCache) {
    if (!taskId || !region) return;
    if (!region.removeTagsOnUnsnap) return;
    const addTags = Array.isArray(region.addTags) ? region.addTags : [];
    if (addTags.length === 0) return;
    const boardId = boardIdForCache != null ? boardIdForCache : currentBoardId;
    let task = boardId ? getTaskForBoard(boardId, taskId) : getTaskById(taskId);
    if (!task || !Array.isArray(task.tags)) {
      try {
        task = await api(`/api/external/tasks/${encodeURIComponent(taskId)}`);
      } catch (_) {
        return;
      }
    }
    if (!task) return;
    const currentTags = Array.isArray(task.tags) ? task.tags : [];
    const removeSet = new Set(addTags.map((t) => String(t).toLowerCase()));
    const newTags = currentTags.filter((t) => !removeSet.has(String(t).toLowerCase()));
    if (newTags.length !== currentTags.length) await updateTask(taskId, { tags: newTags });
  }

  function getBoardConnections(boardId) {
    const board = getBoards().find((b) => String(b.id) === String(boardId));
    if (!board) return [];
    if (!Array.isArray(board.connections)) board.connections = [];
    return board.connections;
  }
  function setBoardConnections(boardId, connections) {
    const boards = getBoards();
    const board = boards.find((b) => String(b.id) === String(boardId));
    if (!board) return;
    board.connections = connections;
    saveBoards(boards);
  }

  /** Persist a connection's curve (control point) to storage. Use after dragging control or moving an endpoint. */
  function persistConnectionCurve(boardId, conn) {
    const boards = getBoards();
    const board = boards.find((b) => String(b.id) === String(boardId));
    if (!board) return;
    if (!Array.isArray(board.connections)) board.connections = [];
    const fromId = String(conn.fromTaskId);
    const toId = String(conn.toTaskId);
    const existing = board.connections.find((c) => String(c.fromTaskId) === fromId && String(c.toTaskId) === toId);
    if (existing) {
      existing.controlX = conn.controlX;
      existing.controlY = conn.controlY;
      existing.fromSide = conn.fromSide;
      existing.toSide = conn.toSide;
    } else {
      board.connections.push({
        id: conn.id,
        fromTaskId: conn.fromTaskId,
        toTaskId: conn.toTaskId,
        fromSide: conn.fromSide || 'right',
        toSide: conn.toSide || 'left',
        controlX: conn.controlX,
        controlY: conn.controlY,
        label: conn.label || '',
        fromDependency: !!conn.fromDependency,
      });
    }
    saveBoards(boards);
  }

  /** Remove one stored connection with the given from-to pair (e.g. when moving an endpoint to a new card). */
  function removeBoardConnection(boardId, fromTaskId, toTaskId) {
    const boards = getBoards();
    const board = boards.find((b) => String(b.id) === String(boardId));
    if (!board || !Array.isArray(board.connections)) return;
    const fromId = String(fromTaskId);
    const toId = String(toTaskId);
    board.connections = board.connections.filter(
      (c) => !(String(c.fromTaskId) === fromId && String(c.toTaskId) === toId)
    );
    saveBoards(boards);
  }

  /** Remove any stored board connection between two tasks (e.g. after deleting a dependency in blocking modal). */
  function removeBoardConnectionsBetweenTasks(taskIdA, taskIdB) {
    const a = String(taskIdA);
    const b = String(taskIdB);
    const boards = getBoards();
    let anyChanged = false;
    boards.forEach((board) => {
      if (!Array.isArray(board.connections)) return;
      const prevLen = board.connections.length;
      board.connections = board.connections.filter(
        (c) => !(String(c.fromTaskId) === a && String(c.toTaskId) === b) && !(String(c.fromTaskId) === b && String(c.toTaskId) === a)
      );
      if (board.connections.length !== prevLen) anyChanged = true;
    });
    if (anyChanged) saveBoards(boards);
    if (currentBoardId) renderBoardConnections(currentBoardId);
  }

  /** Task IDs that are currently on the board (as cards or in region lines). Connections only show when both ends are visible. */
  function getBoardVisibleTaskIds(boardId) {
    const ids = new Set();
    getBoardCards(boardId).forEach((c) => ids.add(String(c.taskId)));
    (getBoardRegions(boardId) || []).forEach((r) => (r.lines || []).forEach((line) => ids.add(String(line.taskId))));
    return ids;
  }

  async function refreshBoardTasks(boardId) {
    const board = getBoards().find((b) => String(b.id) === String(boardId));
    if (!board || !board.baseId) return [];
    try {
      let tasks;
      if (board.baseType === 'list') {
        tasks = await api(`/api/external/lists/${encodeURIComponent(board.baseId)}/tasks?limit=500`);
      } else {
        tasks = await api(`/api/external/tasks?project_id=${encodeURIComponent(board.baseId)}`);
      }
      const list = Array.isArray(tasks) ? tasks : [];
      boardTasksCache[boardId] = list;
      return list;
    } catch (_) {
      boardTasksCache[boardId] = [];
      return [];
    }
  }

  function refreshBoardAfterTaskUpdate(boardId) {
    return refreshBoardTasks(boardId).then(() => {
      syncBoardCardsToQualifyingTasks(boardId);
      renderBoardRegions(boardId);
      renderBoardCards(boardId);
      renderBoardConnections(boardId);
      updateBoardAddTaskBadge(boardId);
    });
  }

  /** Keep only cards/region lines whose task still meets board criteria (list/project). Call after refreshBoardTasks. */
  function syncBoardCardsToQualifyingTasks(boardId) {
    const qualifyingIds = new Set((boardTasksCache[boardId] || []).map((t) => String(t.id)));
    const cards = getBoardCards(boardId);
    const kept = cards.filter((c) => qualifyingIds.has(String(c.taskId)));
    if (kept.length !== cards.length) setBoardCards(boardId, kept);
    const regions = getBoardRegions(boardId);
    let regionsChanged = false;
    regions.forEach((r) => {
      if (!Array.isArray(r.lines)) return;
      const beforeIds = new Set((r.lines || []).map((line) => String(line.taskId)));
      r.lines = r.lines.filter((line) => qualifyingIds.has(String(line.taskId)));
      const afterIds = new Set((r.lines || []).map((line) => String(line.taskId)));
      beforeIds.forEach((taskId) => {
        if (!afterIds.has(taskId)) onTaskUnsnappedFromRegion(taskId, r, boardId);
      });
      if (r.lines.length !== beforeIds.size) regionsChanged = true;
    });
    if (regionsChanged) setBoardRegions(boardId, regions);
  }

  let boardPanZoom = { x: 0, y: 0, scale: 1 };
  function applyBoardTransform() {
    if (!boardCanvasInnerEl) return;
    const { x, y, scale } = boardPanZoom;
    boardCanvasInnerEl.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  }
  function getBoardViewportCenter() {
    if (!boardViewCanvasEl) return { x: 0, y: 0 };
    const rect = boardViewCanvasEl.getBoundingClientRect();
    const scale = boardPanZoom.scale;
    return {
      x: (rect.width / 2 - boardPanZoom.x) / scale,
      y: (rect.height / 2 - boardPanZoom.y) / scale
    };
  }
  /** Viewport in canvas coordinates: { left, top, width, height }. */
  function getBoardViewportBounds() {
    if (!boardViewCanvasEl) return { left: 0, top: 0, width: 400, height: 300 };
    const rect = boardViewCanvasEl.getBoundingClientRect();
    const scale = boardPanZoom.scale;
    return {
      left: -boardPanZoom.x / scale,
      top: -boardPanZoom.y / scale,
      width: rect.width / scale,
      height: rect.height / scale
    };
  }
  /** Obstacles = cards (x,y,width,height) and regions (x,y,w,h). Returns first position in viewport where a rect of size cardW×cardH fits with gap from obstacles, or viewport center. */
  function findEmptySpotInViewport(boardId, cardW, cardH) {
    const gap = 12;
    const step = 40;
    const bounds = getBoardViewportBounds();
    const obstacles = [];
    getBoardCards(boardId).forEach((c) => {
      obstacles.push({
        left: (c.x || 0) - gap,
        top: (c.y || 0) - gap,
        width: (c.width || BOARD_DEFAULT_CARD_WIDTH) + 2 * gap,
        height: (c.height || BOARD_DEFAULT_CARD_HEIGHT) + 2 * gap
      });
    });
    (getBoardRegions(boardId) || []).forEach((r) => {
      const rw = r.w || 200;
      const rh = r.h || 200;
      obstacles.push({
        left: (r.x || 0) - gap,
        top: (r.y || 0) - gap,
        width: rw + 2 * gap,
        height: rh + 2 * gap
      });
    });
    function overlaps(aLeft, aTop, aW, aH) {
      return obstacles.some((o) => !(aLeft + aW < o.left || o.left + o.width < aLeft || aTop + aH < o.top || o.top + o.height < aTop));
    }
    const padding = 16;
    let top = Math.floor((bounds.top + padding) / step) * step;
    const bottom = bounds.top + bounds.height - cardH - padding;
    const rightLimit = bounds.left + bounds.width - cardW - padding;
    while (top <= bottom) {
      let left = Math.floor((bounds.left + padding) / step) * step;
      while (left <= rightLimit) {
        if (!overlaps(left, top, cardW, cardH)) return { x: Math.round(left), y: Math.round(top) };
        left += step;
      }
      top += step;
    }
    const center = getBoardViewportCenter();
    return { x: Math.round(center.x - cardW / 2), y: Math.round(center.y - cardH / 2) };
  }
  function setBoardZoomTowardPoint(clientX, clientY, newScale) {
    if (!boardViewCanvasEl) return;
    const rect = boardViewCanvasEl.getBoundingClientRect();
    const cx = (clientX - rect.left - boardPanZoom.x) / boardPanZoom.scale;
    const cy = (clientY - rect.top - boardPanZoom.y) / boardPanZoom.scale;
    boardPanZoom.scale = newScale;
    boardPanZoom.x = clientX - rect.left - cx * newScale;
    boardPanZoom.y = clientY - rect.top - cy * newScale;
    applyBoardTransform();
    const pct = Math.round(boardPanZoom.scale * 100);
    if (boardZoomSelect) {
      boardZoomSelect.value = String(pct);
      const opt = Array.from(boardZoomSelect.options).find((o) => o.value === String(pct));
      if (!opt) {
        const o = document.createElement('option');
        o.value = String(pct);
        o.textContent = pct + '%';
        boardZoomSelect.appendChild(o);
        boardZoomSelect.value = String(pct);
      }
    }
  }
  function setBoardZoom(percentOrScale) {
    const pct = typeof percentOrScale === 'number' && percentOrScale >= 1 && percentOrScale <= 300
      ? percentOrScale
      : Math.max(BOARD_ZOOM_MIN, Math.min(BOARD_ZOOM_MAX, Math.round(percentOrScale)));
    const scaleMultiplier = pct / 100;
    boardPanZoom.scale = scaleMultiplier;
    applyBoardTransform();
    if (boardZoomSelect) {
      const val = String(pct);
      boardZoomSelect.value = val;
      const opt = Array.from(boardZoomSelect.options).find((o) => o.value === val);
      if (!opt) {
        const o = document.createElement('option');
        o.value = val;
        o.textContent = pct + '%';
        boardZoomSelect.appendChild(o);
        boardZoomSelect.value = val;
      }
    }
  }

  function openBoardView(boardId) {
    const board = getBoards().find((b) => String(b.id) === String(boardId));
    if (!board) return;
    currentBoardId = boardId;
    if (inboxItem) inboxItem.classList.remove('selected');
    if (projectsList) projectsList.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
    if (listsListEl) listsListEl.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
    if (tagsListEl) tagsListEl.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
    if (favoritesListEl) favoritesListEl.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
    if (boardsListEl) {
      boardsListEl.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
      const boardLi = boardsListEl.querySelector(`.nav-item[data-board-id="${String(boardId).replace(/"/g, '\\"')}"]`);
      if (boardLi) boardLi.classList.add('selected');
    }
    if (boardViewTitleEl) boardViewTitleEl.textContent = board.name || 'Board';
    const savedScale = typeof board.viewScale === 'number' && board.viewScale >= BOARD_ZOOM_MIN / 100 && board.viewScale <= BOARD_ZOOM_MAX / 100 ? board.viewScale : null;
    const savedX = typeof board.viewX === 'number' ? board.viewX : null;
    const savedY = typeof board.viewY === 'number' ? board.viewY : null;
    if (savedScale != null && savedX != null && savedY != null) {
      boardPanZoom = { x: savedX, y: savedY, scale: savedScale };
      applyBoardTransform();
      const pct = Math.round(boardPanZoom.scale * 100);
      if (boardZoomSelect) {
        boardZoomSelect.value = String(pct);
        const opt = Array.from(boardZoomSelect.options).find((o) => o.value === String(pct));
        if (!opt) {
          const o = document.createElement('option');
          o.value = String(pct);
          o.textContent = pct + '%';
          boardZoomSelect.appendChild(o);
          boardZoomSelect.value = String(pct);
        }
      }
    } else {
      boardPanZoom = { x: 0, y: 0, scale: 1 };
      applyBoardTransform();
      setBoardZoom(100);
    }
    if (boardAddTaskPopover) boardAddTaskPopover.classList.add('hidden');
    if (mainArea) mainArea.classList.add('hidden');
    if (bottomBarEl) bottomBarEl.classList.add('hidden');
    if (appEl) appEl.classList.add('board-open');
    if (boardViewEl) {
      boardViewEl.classList.remove('hidden');
      boardViewEl.setAttribute('aria-hidden', 'false');
    }
    refreshBoardTasks(boardId).then(() => {
      syncBoardCardsToQualifyingTasks(boardId);
      renderBoardRegions(boardId);
      renderBoardCards(boardId);
      updateBoardAddTaskBadge(boardId);
    });
    renderBoardGrid();
    setupBoardCanvasPanZoom();
    setupBoardZoomControls();
    setupBoardGrid();
    setupBoardDuplicateDelete(boardId);
    setupBoardTitleEdit(boardId);
    setupBoardAddTask(boardId);
    setupBoardRegions(boardId);
  }
  function setupBoardTitleEdit(boardId) {
    if (!boardViewTitleEl) return;
    boardViewTitleEl.addEventListener('dblclick', (e) => {
      e.preventDefault();
      const currentName = (boardViewTitleEl.textContent || '').trim() || 'Board';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = currentName;
      input.className = 'board-view-title-edit';
      input.setAttribute('aria-label', 'Board name');
      boardViewTitleEl.textContent = '';
      boardViewTitleEl.appendChild(input);
      input.focus();
      input.select();
      function finish() {
        const val = (input.value || '').trim() || 'Board';
        const boards = getBoards();
        const board = boards.find((b) => String(b.id) === String(boardId));
        if (board) {
          board.name = val;
          saveBoards(boards);
          const favs = getFavorites();
          const updated = favs.map((f) => (f.type === 'board' && String(f.id) === String(boardId)) ? { ...f, label: val } : f);
          if (updated.some((f, i) => f !== favs[i])) {
            saveFavorites(updated);
          }
        }
        if (input.parentElement === boardViewTitleEl) boardViewTitleEl.removeChild(input);
        boardViewTitleEl.textContent = val;
        loadBoards();
        loadFavorites();
      }
      function cancel() {
        if (input.parentElement === boardViewTitleEl) boardViewTitleEl.removeChild(input);
        boardViewTitleEl.textContent = currentName;
      }
      input.addEventListener('blur', finish);
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
        if (ev.key === 'Escape') { ev.preventDefault(); cancel(); }
      });
    });
  }
  function setupBoardDuplicateDelete(boardId) {
    if (boardDuplicateBtn) {
      boardDuplicateBtn.onclick = () => openNewBoardModal(boardId);
    }
    if (boardDeleteBtn) {
      boardDeleteBtn.onclick = () => {
        if (!confirm('Delete this board? This cannot be undone.')) return;
        const boards = getBoards().filter((b) => String(b.id) !== String(boardId));
        saveBoards(boards);
        saveBoardOrder(getBoardOrder().filter((bid) => bid !== boardId));
        removeFromFavorites('board', boardId);
        loadBoards();
        loadFavorites();
        if (currentBoardId === boardId) closeBoardView();
      };
    }
  }
  function closeBoardView() {
    if (currentBoardId) {
      const boards = getBoards();
      const board = boards.find((b) => String(b.id) === String(currentBoardId));
      if (board) {
        board.viewScale = boardPanZoom.scale;
        board.viewX = boardPanZoom.x;
        board.viewY = boardPanZoom.y;
        saveBoards(boards);
      }
    }
    currentBoardId = null;
    if (mainArea) mainArea.classList.remove('hidden');
    if (bottomBarEl) bottomBarEl.classList.remove('hidden');
    if (appEl) appEl.classList.remove('board-open');
    if (boardViewEl) {
      boardViewEl.classList.add('hidden');
      boardViewEl.setAttribute('aria-hidden', 'true');
    }
  }
  if (boardViewCloseBtn) boardViewCloseBtn.addEventListener('click', closeBoardView);

  function setupBoardCanvasPanZoom() {
    if (!boardViewCanvasEl || !boardCanvasInnerEl) return;
    let panStart = null;
    let connectionRedirectTarget = null;
    function findElementUnderRegions(clientX, clientY) {
      const connLayer = document.getElementById('board-connections-layer');
      const cardsLayer = document.getElementById('board-cards-layer');
      const regionsLayer = document.getElementById('board-regions-layer');
      if (!connLayer || !cardsLayer || !regionsLayer) return null;
      const saveConn = connLayer.style.pointerEvents;
      const saveCards = cardsLayer.style.pointerEvents;
      const saveRegions = regionsLayer.style.pointerEvents;
      connLayer.style.pointerEvents = 'none';
      cardsLayer.style.pointerEvents = 'none';
      regionsLayer.style.pointerEvents = 'auto';
      const under = document.elementFromPoint(clientX, clientY);
      connLayer.style.pointerEvents = saveConn;
      cardsLayer.style.pointerEvents = saveCards;
      regionsLayer.style.pointerEvents = saveRegions;
      return under && under.closest('.board-region') ? under : null;
    }
    boardViewCanvasEl.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.board-card')) return;
      if (e.target.closest('.board-connections-svg-hit path') || e.target.closest('.board-connections-svg-hit circle')) return;
      if (e.target.closest('.board-connections-layer')) {
        const targetEl = findElementUnderRegions(e.clientX, e.clientY);
        if (targetEl) {
          connectionRedirectTarget = targetEl;
          const opts = { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, button: e.button, buttons: e.buttons };
          targetEl.dispatchEvent(new MouseEvent('mousedown', opts));
          return;
        }
      }
      if (e.target.closest('.board-zoom-btn') || e.target.closest('.board-grid-btn') || e.target.closest('.board-zoom-select') || e.target.closest('.board-add-task-btn') || e.target.closest('.board-add-region-btn') || e.target.closest('.board-add-agenda-btn') || e.target.closest('.board-add-task-popover')) return;
      panStart = { x: e.clientX - boardPanZoom.x, y: e.clientY - boardPanZoom.y };
      boardViewCanvasEl.classList.add('panning');
    });
    boardViewCanvasEl.addEventListener('dblclick', (e) => {
      if (e.target.closest('.board-connections-svg-hit path') || e.target.closest('.board-connections-svg-hit circle')) return;
      if (e.target.closest('.board-connections-layer')) {
        const regionEl = findElementUnderRegions(e.clientX, e.clientY)?.closest('.board-region');
        if (regionEl) {
          regionEl.dispatchEvent(new MouseEvent('dblclick', { ...e, bubbles: true }));
        }
      }
    });
    document.addEventListener('mousemove', (e) => {
      if (panStart === null) return;
      boardPanZoom.x = e.clientX - panStart.x;
      boardPanZoom.y = e.clientY - panStart.y;
      applyBoardTransform();
    });
    document.addEventListener('mouseup', (e) => {
      if (connectionRedirectTarget) {
        const target = connectionRedirectTarget;
        connectionRedirectTarget = null;
        const opts = { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, button: e.button, buttons: e.buttons };
        target.dispatchEvent(new MouseEvent('mouseup', opts));
        target.dispatchEvent(new MouseEvent('click', opts));
      }
      panStart = null;
      if (boardViewCanvasEl) boardViewCanvasEl.classList.remove('panning');
    });
    boardViewCanvasEl.addEventListener('wheel', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.target.closest('.board-card')) return;
      if (e.target.closest('.board-view-zoom') || e.target.closest('.board-grid-btn')) return;
      e.preventDefault();
      const pct = boardPanZoom.scale * 100;
      const newPct = Math.max(BOARD_ZOOM_MIN, Math.min(BOARD_ZOOM_MAX, pct - e.deltaY));
      setBoardZoomTowardPoint(e.clientX, e.clientY, newPct / 100);
    }, { passive: false });

    let pinchStart = null;
    boardViewCanvasEl.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        const rect = boardViewCanvasEl.getBoundingClientRect();
        const dist = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY);
        const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        pinchStart = { dist, scale: boardPanZoom.scale, x: boardPanZoom.x, y: boardPanZoom.y, centerX, centerY, rectLeft: rect.left, rectTop: rect.top };
      }
    }, { passive: true });
    boardViewCanvasEl.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2 && pinchStart) {
        e.preventDefault();
        const dist = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY);
        const ratio = dist / pinchStart.dist;
        const newScale = Math.max(BOARD_ZOOM_MIN / 100, Math.min(BOARD_ZOOM_MAX / 100, pinchStart.scale * ratio));
        const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const cx = (centerX - pinchStart.rectLeft - pinchStart.x) / pinchStart.scale;
        const cy = (centerY - pinchStart.rectTop - pinchStart.y) / pinchStart.scale;
        boardPanZoom.scale = newScale;
        boardPanZoom.x = centerX - pinchStart.rectLeft - cx * newScale;
        boardPanZoom.y = centerY - pinchStart.rectTop - cy * newScale;
        applyBoardTransform();
        const pct = Math.round(boardPanZoom.scale * 100);
        if (boardZoomSelect) {
          boardZoomSelect.value = String(pct);
          const opt = Array.from(boardZoomSelect.options).find((o) => o.value === String(pct));
          if (!opt) {
            const o = document.createElement('option');
            o.value = String(pct);
            o.textContent = pct + '%';
            boardZoomSelect.appendChild(o);
            boardZoomSelect.value = String(pct);
          }
        }
      }
    }, { passive: false });
    boardViewCanvasEl.addEventListener('touchend', (e) => {
      if (e.touches.length < 2) pinchStart = null;
    }, { passive: true });
  }
  function setupBoardZoomControls() {
    if (boardThemeBtn) boardThemeBtn.addEventListener('click', cycleTheme);
    if (boardZoomOutBtn) boardZoomOutBtn.addEventListener('click', () => setBoardZoom(Math.round(boardPanZoom.scale * 100) - BOARD_ZOOM_STEP));
    if (boardZoomInBtn) boardZoomInBtn.addEventListener('click', () => setBoardZoom(Math.round(boardPanZoom.scale * 100) + BOARD_ZOOM_STEP));
    if (boardZoomSelect) boardZoomSelect.addEventListener('change', () => setBoardZoom(Number(boardZoomSelect.value)));
  }
  function setupBoardGrid() {
    if (!boardGridBtn) return;
    boardGridBtn.onclick = () => {
      const cur = localStorage.getItem(BOARD_GRID_VISIBLE_KEY) === '1';
      localStorage.setItem(BOARD_GRID_VISIBLE_KEY, cur ? '0' : '1');
      renderBoardGrid();
    };
  }
  function updateBoardAddTaskBadge(boardId) {
    const badge = document.getElementById('board-add-task-badge');
    if (!boardAddTaskBtn || !badge) return;
    const cards = getBoardCards(boardId);
    const placedIds = new Set(cards.map((c) => c.taskId));
    (getBoardRegions(boardId) || []).forEach((r) => (r.lines || []).forEach((line) => placedIds.add(String(line.taskId))));
    const tasks = boardTasksCache[boardId] || [];
    const count = tasks.filter((t) => !placedIds.has(String(t.id))).length;
    badge.textContent = String(count > 99 ? '99+' : count);
    badge.classList.toggle('hidden', count === 0);
    badge.setAttribute('aria-hidden', count === 0 ? 'true' : 'false');
  }

  function setupBoardAddTask(boardId) {
    if (!boardAddTaskBtn || !boardAddTaskPopover || !boardAddTaskListEl) return;
    boardAddTaskBtn.onclick = (e) => {
      e.stopPropagation();
      const open = !boardAddTaskPopover.classList.toggle('hidden');
      if (open) {
        updateBoardAddTaskBadge(boardId);
        const board = getBoards().find((b) => String(b.id) === String(boardId));
        const cards = getBoardCards(boardId);
        const placedIds = new Set(cards.map((c) => c.taskId));
        (getBoardRegions(boardId) || []).forEach((r) => (r.lines || []).forEach((line) => placedIds.add(String(line.taskId))));
        const tasks = boardTasksCache[boardId] || [];
        const unplaced = tasks.filter((t) => !placedIds.has(String(t.id)));
        boardAddTaskListEl.innerHTML = unplaced.length
          ? unplaced.map((t) => {
              const title = (t.title || '(no title)').replace(/</g, '&lt;');
              const id = (t.id || '').replace(/"/g, '&quot;');
              return `<li data-task-id="${id}" role="option">${title}</li>`;
            }).join('')
          : '<li class="empty">No unplaced tasks</li>';
        boardAddTaskListEl.querySelectorAll('li[data-task-id]').forEach((li) => {
          li.addEventListener('click', () => {
            const taskId = li.dataset.taskId;
            const cards = getBoardCards(boardId);
            const w = BOARD_MIN_CARD_WIDTH;
            const h = BOARD_MIN_CARD_HEIGHT;
            const pos = findEmptySpotInViewport(boardId, w, h);
            const newCard = { taskId, x: pos.x, y: pos.y, width: w, height: h };
            cards.push(newCard);
            setBoardCards(boardId, cards);
            renderBoardCards(boardId);
            updateBoardAddTaskBadge(boardId);
            boardAddTaskPopover.classList.add('hidden');
          });
        });
      }
    };
    document.addEventListener('click', (e) => {
      if (boardAddTaskPopover.classList.contains('hidden')) return;
      if (!boardAddTaskPopover.contains(e.target) && !boardAddTaskBtn.contains(e.target)) boardAddTaskPopover.classList.add('hidden');
    });
  }

  const BOARD_AGENDA_DEFAULT_WIDTH = 380;
  const BOARD_AGENDA_DEFAULT_HEIGHT = 260;
  function setupBoardRegions(boardId) {
    if (!boardRegionsLayerEl) return;
    if (boardAddRegionBtn) {
      boardAddRegionBtn.onclick = () => {
        const regions = getBoardRegions(boardId);
        const id = 'region-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        const center = getBoardViewportCenter();
        const sz = BOARD_REGION_DEFAULT_SIZE;
        const newRegion = { id, x: Math.round(center.x - sz / 2), y: Math.round(center.y - sz / 2), w: sz, h: sz, title: '', color: BOARD_REGION_COLORS[0], lines: [] };
        regions.push(newRegion);
        setBoardRegions(boardId, regions);
        renderBoardRegions(boardId);
      };
    }
    if (boardAddAgendaBtn) {
      boardAddAgendaBtn.onclick = () => {
        const regions = getBoardRegions(boardId);
        const id = 'region-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        const center = getBoardViewportCenter();
        const w = BOARD_AGENDA_DEFAULT_WIDTH;
        const h = BOARD_AGENDA_DEFAULT_HEIGHT;
        const newRegion = {
          id,
          type: 'agenda',
          x: Math.round(center.x - w / 2),
          y: Math.round(center.y - h / 2),
          w,
          h,
          title: 'Agenda',
          color: BOARD_REGION_COLORS[0],
          lines: [],
          showPriority: true,
          showFlag: true,
          agendaDays: 1,
          agendaDirection: 'before_and_after'
        };
        regions.push(newRegion);
        setBoardRegions(boardId, regions);
        renderBoardRegions(boardId);
        if (window.openBoardRegionEdit) window.openBoardRegionEdit(newRegion);
      };
    }
    const overlay = document.getElementById('board-region-edit-overlay');
    const titleInput = document.getElementById('board-region-edit-title-input');
    const regionEditTitleEl = document.getElementById('board-region-edit-title');
    const colorsEl = document.getElementById('board-region-edit-colors');
    const showPriorityCb = document.getElementById('board-region-edit-show-priority');
    const showFlagCb = document.getElementById('board-region-edit-show-flag');
    const agendaSectionEl = document.getElementById('board-region-edit-agenda-section');
    const regionOnlySectionEl = document.getElementById('board-region-edit-region-only-section');
    const agendaDaysInput = document.getElementById('board-region-edit-agenda-days');
    const agendaDirectionSelect = document.getElementById('board-region-edit-agenda-direction');
    const tagsListEl = document.getElementById('board-region-edit-tags-list');
    const tagsAddBtn = document.getElementById('board-region-edit-tags-add-btn');
    const removeTagsOnUnsnapCb = document.getElementById('board-region-edit-remove-tags-on-unsnap');
    const prioritySelect = document.getElementById('board-region-edit-priority');
    const saveBtn = document.getElementById('board-region-edit-save');
    const deleteBtn = document.getElementById('board-region-edit-delete');
    const duplicateBtn = document.getElementById('board-region-edit-duplicate');
    const closeBtn = document.getElementById('board-region-edit-close');
    if (saveBtn) saveBtn.innerHTML = INSPECTOR_SAVE_SVG;
    if (deleteBtn) deleteBtn.innerHTML = INSPECTOR_TRASH_SVG;
    if (duplicateBtn) duplicateBtn.innerHTML = INSPECTOR_DUPLICATE_SVG;
    let editingRegionId = null;
    let regionEditAddTags = [];
    let regionEditRemoveTagsOnUnsnap = false;
    let regionEditSetPriority = undefined; // undefined = no change, null = no priority, 0-3 = value
    function renderRegionEditTagsDisplay() {
      if (!tagsListEl) return;
      tagsListEl.innerHTML = '';
      (regionEditAddTags || []).forEach((tag) => {
        const chip = document.createElement('span');
        chip.className = 'board-region-edit-tag-chip';
        const label = '#' + String(tag).replace(/</g, '&lt;');
        chip.innerHTML = `<span>${label}</span> <button type="button" aria-label="Remove tag">×</button>`;
        const removeBtn = chip.querySelector('button');
        removeBtn.addEventListener('click', () => {
          regionEditAddTags = regionEditAddTags.filter((t) => t !== tag);
          renderRegionEditTagsDisplay();
        });
        tagsListEl.appendChild(chip);
      });
    }
    function openRegionEdit(region) {
      editingRegionId = region.id;
      const isAgenda = region.type === 'agenda';
      if (regionEditTitleEl) regionEditTitleEl.textContent = isAgenda ? 'Agenda' : 'Region';
      if (titleInput) titleInput.value = region.title || (isAgenda ? 'Agenda' : '');
      if (showPriorityCb) showPriorityCb.checked = region.showPriority !== false;
      if (showFlagCb) showFlagCb.checked = region.showFlag !== false;
      if (agendaSectionEl) agendaSectionEl.classList.toggle('hidden', !isAgenda);
      if (regionOnlySectionEl) regionOnlySectionEl.classList.toggle('hidden', !!isAgenda);
      if (isAgenda && agendaDaysInput) agendaDaysInput.value = Math.min(4, Math.max(1, parseInt(region.agendaDays, 10) || 1));
      if (isAgenda && agendaDirectionSelect) agendaDirectionSelect.value = region.agendaDirection || 'before_and_after';
      regionEditAddTags = Array.isArray(region.addTags) ? region.addTags.slice() : [];
      regionEditRemoveTagsOnUnsnap = !!region.removeTagsOnUnsnap;
      regionEditSetPriority = region.setPriority;
      if (removeTagsOnUnsnapCb) removeTagsOnUnsnapCb.checked = regionEditRemoveTagsOnUnsnap;
      if (prioritySelect) {
        if (regionEditSetPriority === undefined || regionEditSetPriority === '') prioritySelect.value = '';
        else if (regionEditSetPriority === null) prioritySelect.value = 'none';
        else prioritySelect.value = String(regionEditSetPriority);
      }
      renderRegionEditTagsDisplay();
      if (colorsEl) {
        colorsEl.innerHTML = BOARD_REGION_COLORS.map((c) => `<button type="button" class="board-region-color-swatch ${c === (region.color || BOARD_REGION_COLORS[0]) ? 'selected' : ''}" data-color="${c}" style="background:${c}" aria-label="Color ${c}"></button>`).join('');
        colorsEl.querySelectorAll('.board-region-color-swatch').forEach((btn) => {
          btn.addEventListener('click', () => {
            colorsEl.querySelectorAll('.board-region-color-swatch').forEach((b) => b.classList.remove('selected'));
            btn.classList.add('selected');
          });
        });
      }
      if (tagsAddBtn) {
        tagsAddBtn.onclick = (ev) => {
          openTaskTagsDropdown(ev, tagsAddBtn, {
            forNewTask: true,
            currentTags: regionEditAddTags.slice(),
            onAfterApply: (tags) => {
              regionEditAddTags = tags;
              renderRegionEditTagsDisplay();
            }
          });
        };
      }
      if (overlay) { overlay.classList.remove('hidden'); overlay.setAttribute('aria-hidden', 'false'); }
      if (titleInput) setTimeout(() => titleInput.focus(), 50);
    }
    function closeRegionEdit() {
      editingRegionId = null;
      if (overlay) { overlay.classList.add('hidden'); overlay.setAttribute('aria-hidden', 'true'); }
    }
    async function saveRegionEdit() {
      if (!editingRegionId || !currentBoardId) { closeRegionEdit(); return; }
      const regions = getBoardRegions(currentBoardId);
      const r = regions.find((x) => x.id === editingRegionId);
      if (r) {
        r.title = (titleInput && titleInput.value) ? String(titleInput.value).trim() : '';
        const sel = colorsEl && colorsEl.querySelector('.board-region-color-swatch.selected');
        r.color = sel && sel.dataset.color ? sel.dataset.color : (r.color || BOARD_REGION_COLORS[0]);
        r.showPriority = showPriorityCb ? showPriorityCb.checked : true;
        r.showFlag = showFlagCb ? showFlagCb.checked : true;
        if (r.type === 'agenda') {
          r.agendaDays = Math.min(4, Math.max(1, parseInt(agendaDaysInput && agendaDaysInput.value ? agendaDaysInput.value : 1, 10)));
          r.agendaDirection = (agendaDirectionSelect && agendaDirectionSelect.value) || 'before_and_after';
        } else {
          r.addTags = Array.isArray(regionEditAddTags) ? regionEditAddTags.slice() : [];
          r.removeTagsOnUnsnap = !!(removeTagsOnUnsnapCb && removeTagsOnUnsnapCb.checked);
          const priVal = prioritySelect ? prioritySelect.value : '';
          if (priVal === '') r.setPriority = undefined;
          else if (priVal === 'none') r.setPriority = null;
          else { const n = parseInt(priVal, 10); r.setPriority = (n >= 0 && n <= 3) ? n : undefined; }
        }
        setBoardRegions(currentBoardId, regions);
        await applyRegionSettingsToSnappedTasks(r, currentBoardId);
        renderBoardRegions(currentBoardId);
      }
      closeRegionEdit();
    }
    function deleteRegionEdit() {
      if (!editingRegionId || !currentBoardId) { closeRegionEdit(); return; }
      if (!confirm('Delete this region? Tasks in it can be re-added to the board from the add task list.')) return;
      const regions = getBoardRegions(currentBoardId);
      const doomed = regions.find((r) => r.id === editingRegionId);
      if (doomed && (doomed.lines || []).length) {
        doomed.lines.forEach((line) => { if (line.taskId) onTaskUnsnappedFromRegion(line.taskId, doomed, currentBoardId); });
      }
      const next = regions.filter((r) => r.id !== editingRegionId);
      setBoardRegions(currentBoardId, next);
      renderBoardRegions(currentBoardId);
      renderBoardConnections(currentBoardId);
      closeRegionEdit();
    }
    function duplicateRegionEdit() {
      if (!editingRegionId || !currentBoardId) return;
      const regions = getBoardRegions(currentBoardId);
      const src = regions.find((r) => r.id === editingRegionId);
      if (!src) return;
      const originalTitle = (src.title || '').trim() || 'Region';
      const newTitle = originalTitle + ' - Copy';
      const newId = 'region-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      const copy = {
        id: newId,
        title: newTitle,
        color: src.color || BOARD_REGION_COLORS[0],
        x: (src.x || 0) + 24,
        y: (src.y || 0) + 24,
        w: src.w || BOARD_REGION_DEFAULT_SIZE,
        h: src.h || BOARD_REGION_DEFAULT_SIZE,
        lines: [],
        showPriority: src.showPriority !== false,
        showFlag: src.showFlag !== false,
        addTags: Array.isArray(src.addTags) ? src.addTags.slice() : [],
        removeTagsOnUnsnap: !!src.removeTagsOnUnsnap,
        setPriority: src.setPriority
      };
      if (src.type === 'agenda') {
        copy.type = 'agenda';
        copy.agendaDays = Math.min(4, Math.max(1, parseInt(src.agendaDays, 10) || 1));
        copy.agendaDirection = src.agendaDirection || 'before_and_after';
        copy.w = src.w || BOARD_AGENDA_DEFAULT_WIDTH;
        copy.h = src.h || BOARD_AGENDA_DEFAULT_HEIGHT;
      }
      regions.push(copy);
      setBoardRegions(currentBoardId, regions);
      renderBoardRegions(currentBoardId);
      renderBoardConnections(currentBoardId);
    }
    if (saveBtn) saveBtn.onclick = saveRegionEdit;
    if (deleteBtn) deleteBtn.onclick = deleteRegionEdit;
    if (duplicateBtn) duplicateBtn.onclick = duplicateRegionEdit;
    if (closeBtn) closeBtn.onclick = closeRegionEdit;
    if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) closeRegionEdit(); });
    if (titleInput) titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveRegionEdit(); } });
    window.openBoardRegionEdit = openRegionEdit;
    window.closeBoardRegionEdit = closeRegionEdit;
  }

  function buildBoardRegionLineDiv(taskId, t, region, showPriority, showFlag, boardId) {
    const bid = boardId != null ? boardId : currentBoardId;
    const lineDiv = document.createElement('div');
    lineDiv.className = 'board-region-line';
    lineDiv.dataset.taskId = taskId;
    lineDiv.dataset.regionId = region.id;
    const statusSvg = t && isTaskCompleted(t) ? INSPECTOR_STATUS_TICK_SVG : INSPECTOR_STATUS_OPEN_SVG;
    const titleText = (t && t.title) ? String(t.title).replace(/</g, '&lt;') : 'Task ' + taskId;
    const priorityCls = t ? priorityClass(t.priority) : 'priority-empty';
    const flagged = t && (t.flagged === true || t.flagged === 1);
    const flagHtml = showFlag ? ('<span class="board-region-line-flagged' + (flagged ? '' : ' empty') + '">★</span>') : '';
    const priorityHtml = showPriority ? (`<span class="board-region-line-priority priority-circle-wrap ${priorityCls}" data-priority-task-id="${(taskId || '').replace(/"/g, '&quot;')}" title="Priority (click to change)">${PRIORITY_CIRCLE_SVG}</span>`) : '';
    const av = t && (t.available_date || '').toString().trim().substring(0, 10);
    const due = t && (t.due_date || '').toString().trim().substring(0, 10);
    const avStr = av ? formatDate(av) : '';
    const dueStr = due ? formatDate(due) : '';
    const duePart = dueStr && t
      ? (isOverdue(t.due_date) ? `<span class="due-overdue">Due: ${dueStr}</span>` : isToday(t.due_date) ? `<span class="due-today">Due: ${dueStr}</span>` : `Due: ${dueStr}`)
      : (dueStr ? `Due: ${dueStr}` : '');
    const datesStr = [avStr && `Avail: ${avStr}`, duePart].filter(Boolean).join(' · ') || '—';
    const taskIdEsc = (taskId || '').replace(/"/g, '&quot;');
    lineDiv.innerHTML = priorityHtml + flagHtml + `<span class="board-region-line-status">${statusSvg}</span><div class="board-region-line-text"><span class="board-region-line-title">${titleText}</span><span class="board-region-line-dates">${datesStr}</span></div><button type="button" class="board-region-line-expand" data-task-id="${taskIdEsc}" title="Expand" aria-label="Expand">${BOARD_CARD_EXPAND_SVG}</button>`;
    const expandBtn = lineDiv.querySelector('.board-region-line-expand');
    if (expandBtn) expandBtn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); openBoardTaskInspectorModal(taskId, () => refreshBoardAfterTaskUpdate(bid)); });
    const prioritySpan = lineDiv.querySelector('.board-region-line-priority');
    const flagSpan = lineDiv.querySelector('.board-region-line-flagged');
    const statusSpan = lineDiv.querySelector('.board-region-line-status');
    if (prioritySpan && t) prioritySpan.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); openPriorityDropdown(e, prioritySpan, { onAfterApply: () => refreshBoardAfterTaskUpdate(bid) }); });
    if (flagSpan && t) flagSpan.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); updateTask(taskId, { flagged: !flagged }).then(() => refreshBoardAfterTaskUpdate(bid)); });
    if (statusSpan && t) statusSpan.addEventListener('click', (e) => { e.stopPropagation(); const newStatus = isTaskCompleted(t) ? 'incomplete' : 'complete'; updateTask(taskId, { status: newStatus }).then(() => refreshBoardAfterTaskUpdate(bid)); });
    return lineDiv;
  }

  function renderBoardRegions(boardId) {
    if (!boardRegionsLayerEl) return;
    const regions = getBoardRegions(boardId);
    const tasks = boardTasksCache[boardId] || [];
    const taskMap = new Map(tasks.map((t) => [String(t.id), t]));
    boardRegionsLayerEl.innerHTML = '';
    regions.forEach((region, regionIndex) => {
      const el = document.createElement('div');
      el.className = 'board-region' + (region.type === 'agenda' ? ' board-region-agenda' : '');
      el.dataset.regionId = region.id;
      el.dataset.regionIndex = String(regionIndex);
      el.style.left = (region.x || 0) + 'px';
      el.style.top = (region.y || 0) + 'px';
      el.style.width = (region.w || BOARD_REGION_DEFAULT_SIZE) + 'px';
      el.style.height = (region.h || BOARD_REGION_DEFAULT_SIZE) + 'px';
      el.style.backgroundColor = region.color || BOARD_REGION_COLORS[0];
      const title = (region.title || '').replace(/</g, '&lt;');
      if (region.type === 'agenda') {
        const dateRange = getAgendaDateRange(region);
        const placements = [];
        const outside = [];
        (region.lines || []).forEach((line, lineIndex) => {
          const taskId = String(line.taskId);
          const t = taskMap.get(taskId);
          const indices = getTaskAgendaColumnIndices(t, dateRange);
          if (indices && indices.length) {
            const startColIdx = indices[0];
            const endColIdx = indices[indices.length - 1];
            placements.push({ taskId, task: t, lineIndex, startColIdx, endColIdx });
          } else {
            outside.push({ taskId, task: t, lineIndex });
          }
        });
        placements.sort((a, b) => agendaTaskSortCompare(a.task, b.task));
        outside.sort((a, b) => agendaTaskSortCompare(a.task, b.task));
        const showPriority = region.showPriority !== false;
        const showFlag = region.showFlag !== false;
        const dayHeaders = dateRange.map((d) => formatAgendaDayHeader(d));
        const numCols = dateRange.length;
        el.innerHTML = `<div class="board-region-header"><span class="board-region-title">${title || 'Agenda'}</span></div><div class="board-region-agenda-days"></div><div class="board-region-agenda-outside"><div class="board-region-agenda-outside-title">Outside of date range</div><div class="board-region-agenda-outside-lines"></div></div><div class="board-region-resize-handle"></div>`;
        const daysEl = el.querySelector('.board-region-agenda-days');
        const outsideLinesEl = el.querySelector('.board-region-agenda-outside-lines');
        daysEl.style.display = 'grid';
        daysEl.style.gridTemplateColumns = `repeat(${numCols}, 1fr)`;
        daysEl.style.gridTemplateRows = 'auto 1fr';
        dateRange.forEach((_, colIdx) => {
          const colDiv = document.createElement('div');
          colDiv.className = 'board-region-agenda-column board-region-agenda-column-header';
          colDiv.style.gridColumn = String(colIdx + 1);
          colDiv.style.gridRow = '1';
          colDiv.innerHTML = `<div class="board-region-agenda-day-header">${(dayHeaders[colIdx] || '').replace(/</g, '&lt;')}</div>`;
          daysEl.appendChild(colDiv);
        });
        const linesContainer = document.createElement('div');
        linesContainer.className = 'board-region-agenda-lines';
        linesContainer.style.gridColumn = '1 / -1';
        linesContainer.style.gridRow = '2';
        linesContainer.style.display = 'grid';
        linesContainer.style.gridTemplateColumns = `repeat(${numCols}, 1fr)`;
        linesContainer.style.gridAutoRows = 'minmax(32px, auto)';
        linesContainer.style.overflowY = 'auto';
        linesContainer.style.minHeight = '0';
        linesContainer.style.gap = '2px';
        linesContainer.style.padding = '4px 6px 8px';
        linesContainer.style.alignContent = 'start';
        if (numCols > 1) {
          const stops = ['transparent 0%'];
          for (let i = 1; i < numCols; i++) {
            const pct = (100 * i / numCols).toFixed(4);
            stops.push(
              `transparent calc(${pct}% - 0.5px)`,
              `rgba(0,0,0,0.08) calc(${pct}% - 0.5px)`,
              `rgba(0,0,0,0.08) calc(${pct}% + 0.5px)`,
              `transparent calc(${pct}% + 0.5px)`
            );
          }
          stops.push('transparent 100%');
          linesContainer.style.backgroundImage = `linear-gradient(to right, ${stops.join(', ')})`;
        }
        placements.forEach(({ taskId, task: t, lineIndex, startColIdx, endColIdx }) => {
          const lineDiv = buildBoardRegionLineDiv(taskId, t, region, showPriority, showFlag, boardId);
          lineDiv.dataset.lineIndex = String(lineIndex);
          lineDiv.style.gridColumn = `${startColIdx + 1} / ${endColIdx + 2}`;
          linesContainer.appendChild(lineDiv);
          attachBoardRegionLineDrag(lineDiv, boardId, regionIndex, lineIndex);
        });
        daysEl.appendChild(linesContainer);
        outside.forEach(({ taskId, task: t, lineIndex }) => {
          const lineDiv = buildBoardRegionLineDiv(taskId, t, region, showPriority, showFlag, boardId);
          lineDiv.dataset.lineIndex = String(lineIndex);
          outsideLinesEl.appendChild(lineDiv);
          attachBoardRegionLineDrag(lineDiv, boardId, regionIndex, lineIndex);
        });
        const headerEl = el.querySelector('.board-region-header');
        if (headerEl) attachBoardRegionMove(headerEl, el, boardId, regionIndex);
        const resizeHandle = el.querySelector('.board-region-resize-handle');
        if (resizeHandle) attachBoardRegionResize(resizeHandle, el, boardId, regionIndex);
        el.addEventListener('dblclick', (e) => { if (!e.target.closest('.board-region-line') && !e.target.closest('.board-region-resize-handle')) window.openBoardRegionEdit && window.openBoardRegionEdit(region); });
        boardRegionsLayerEl.appendChild(el);
        return;
      }
      el.innerHTML = `<div class="board-region-header"><span class="board-region-title">${title || 'Region'}</span></div><div class="board-region-lines"></div><div class="board-region-resize-handle"></div>`;
      const linesEl = el.querySelector('.board-region-lines');
      const headerEl = el.querySelector('.board-region-header');
      const titleSpan = el.querySelector('.board-region-title');
      if (titleSpan && headerEl) {
        titleSpan.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          e.preventDefault();
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'board-region-title-edit';
          input.value = region.title || '';
          input.setAttribute('aria-label', 'Region title');
          const finish = (save) => {
            if (save) {
              const newTitle = (input.value || '').trim();
              const regions = getBoardRegions(boardId);
              const r = regions[regionIndex];
              if (r) r.title = newTitle;
              setBoardRegions(boardId, regions);
            }
            renderBoardRegions(boardId);
          };
          input.addEventListener('keydown', (k) => {
            if (k.key === 'Enter') { k.preventDefault(); finish(true); }
            if (k.key === 'Escape') { k.preventDefault(); finish(false); }
          });
          input.addEventListener('blur', () => finish(true));
          titleSpan.style.display = 'none';
          headerEl.appendChild(input);
          input.focus();
          input.select();
        });
      }
      const showPriority = region.showPriority !== false;
      const showFlag = region.showFlag !== false;
      (region.lines || []).forEach((line, lineIndex) => {
        const taskId = String(line.taskId);
        const t = taskMap.get(taskId);
        const lineDiv = buildBoardRegionLineDiv(taskId, t, region, showPriority, showFlag, boardId);
        lineDiv.dataset.lineIndex = String(lineIndex);
        linesEl.appendChild(lineDiv);
        attachBoardRegionLineDrag(lineDiv, boardId, regionIndex, lineIndex);
      });
      el.addEventListener('dblclick', (e) => { if (!e.target.closest('.board-region-line') && !e.target.closest('.board-region-resize-handle')) window.openBoardRegionEdit && window.openBoardRegionEdit(region); });
      const resizeHandle = el.querySelector('.board-region-resize-handle');
      if (resizeHandle) attachBoardRegionResize(resizeHandle, el, boardId, regionIndex);
      if (headerEl) attachBoardRegionMove(headerEl, el, boardId, regionIndex);
      boardRegionsLayerEl.appendChild(el);
    });
  }
  function attachBoardRegionMove(headerEl, regionEl, boardId, regionIndex) {
    headerEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const regions = getBoardRegions(boardId);
      const region = regions[regionIndex];
      if (!region) return;
      const startX = region.x || 0;
      const startY = region.y || 0;
      const startMouseX = e.clientX;
      const startMouseY = e.clientY;
      const scale = boardPanZoom.scale;
      function onMove(ev) {
        const dx = (ev.clientX - startMouseX) / scale;
        const dy = (ev.clientY - startMouseY) / scale;
        region.x = Math.round(startX + dx);
        region.y = Math.round(startY + dy);
        regionEl.style.left = region.x + 'px';
        regionEl.style.top = region.y + 'px';
        setBoardRegions(boardId, regions);
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
  function attachBoardRegionResize(handleEl, regionEl, boardId, regionIndex) {
    handleEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const regions = getBoardRegions(boardId);
      const region = regions[regionIndex];
      if (!region) return;
      const startW = regionEl.offsetWidth;
      const startH = regionEl.offsetHeight;
      const startX = e.clientX;
      const startY = e.clientY;
      const scale = boardPanZoom.scale;
      function onMove(ev) {
        const dw = (ev.clientX - startX) / scale;
        const dh = (ev.clientY - startY) / scale;
        region.w = Math.max(120, Math.round(startW + dw));
        region.h = Math.max(80, Math.round(startH + dh));
        regionEl.style.width = region.w + 'px';
        regionEl.style.height = region.h + 'px';
        setBoardRegions(boardId, regions);
      }
      function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
  function attachBoardRegionLineDrag(lineEl, boardId, regionIndex, lineIndex) {
    lineEl.addEventListener('mousedown', (e) => {
      if (e.target.closest('.board-region-line-expand') || e.target.closest('.board-region-line-priority') || e.target.closest('.board-region-line-flagged') || e.target.closest('.board-region-line-status')) return;
      e.preventDefault();
      e.stopPropagation();
      const regions = getBoardRegions(boardId);
      const region = regions[regionIndex];
      const line = (region.lines || [])[lineIndex];
      if (!line) return;
      const taskId = line.taskId;
      const rect = lineEl.getBoundingClientRect();
      const startY = e.clientY;
      let dragGhost = null;
      function onMove(ev) {
        if (!dragGhost) {
          dragGhost = document.createElement('div');
          dragGhost.className = 'board-region-line board-region-line-dragging';
          dragGhost.innerHTML = lineEl.innerHTML;
          dragGhost.style.position = 'fixed';
          dragGhost.style.left = rect.left + 'px';
          dragGhost.style.top = rect.top + 'px';
          dragGhost.style.width = rect.width + 'px';
          dragGhost.style.zIndex = '9999';
          dragGhost.style.pointerEvents = 'none';
          dragGhost.style.opacity = '0.9';
          document.body.appendChild(dragGhost);
          lineEl.style.opacity = '0.4';
        }
        dragGhost.style.top = (ev.clientY - rect.height / 2) + 'px';
        dragGhost.style.left = (ev.clientX - rect.width / 2) + 'px';
      }
      async function onUp(ev) {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (dragGhost && dragGhost.parentNode) dragGhost.parentNode.removeChild(dragGhost);
        lineEl.style.opacity = '';
        const canvasRect = boardViewCanvasEl.getBoundingClientRect();
        const scale = boardPanZoom.scale;
        const dropCanvasX = (ev.clientX - canvasRect.left - boardPanZoom.x) / scale;
        const dropCanvasY = (ev.clientY - canvasRect.top - boardPanZoom.y) / scale;
        const regions = getBoardRegions(boardId);
        let targetRegionIndex = -1;
        for (let i = 0; i < regions.length; i++) {
          const r = regions[i];
          const rx = r.x || 0, ry = r.y || 0, rw = r.w || 200, rh = r.h || 200;
          if (dropCanvasX >= rx && dropCanvasX <= rx + rw && dropCanvasY >= ry && dropCanvasY <= ry + rh) { targetRegionIndex = i; break; }
        }
        const fromRegion = regions[regionIndex];
        const droppingIntoOtherRegion = targetRegionIndex >= 0 && targetRegionIndex !== regionIndex;
        if (targetRegionIndex < 0 || droppingIntoOtherRegion) {
          await onTaskUnsnappedFromRegion(taskId, fromRegion, boardId);
        }
        fromRegion.lines = fromRegion.lines.filter((_, i) => i !== lineIndex);
        if (targetRegionIndex >= 0) {
          if (targetRegionIndex === regionIndex) {
            const regionEl = boardRegionsLayerEl.querySelectorAll('.board-region')[regionIndex];
            const lineEls = regionEl ? Array.from(regionEl.querySelectorAll('.board-region-line')).filter((el) => el !== lineEl) : [];
            let insertIdx = lineEls.length;
            for (let i = 0; i < lineEls.length; i++) {
              const r = lineEls[i].getBoundingClientRect();
              if (ev.clientY < r.top + r.height / 2) { insertIdx = i; break; }
            }
            fromRegion.lines.splice(insertIdx, 0, { taskId });
          } else {
            regions[targetRegionIndex].lines.push({ taskId });
            await applyRegionSettingsToTask(taskId, regions[targetRegionIndex], boardId, { useFreshTask: true });
          }
        } else {
          const cards = getBoardCards(boardId);
          cards.push({ taskId, x: Math.round(dropCanvasX - BOARD_MIN_CARD_WIDTH / 2), y: Math.round(dropCanvasY - 40), width: BOARD_MIN_CARD_WIDTH, height: BOARD_MIN_CARD_HEIGHT });
          setBoardCards(boardId, cards);
        }
        setBoardRegions(boardId, regions);
        renderBoardRegions(boardId);
        renderBoardCards(boardId);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp, { once: true });
    });
  }

  const BOARD_CONNECTIONS_SVG_SIZE = 100000;
  function renderBoardConnections(boardId) {
    if (!boardConnectionsLayerEl || !boardCardsLayerEl) return;
    const visibleIds = getBoardVisibleTaskIds(boardId);
    const storedConnections = getBoardConnections(boardId);
    const storedFiltered = storedConnections.filter((c) => {
      if (String(c.fromTaskId) === String(c.toTaskId)) return false;
      return visibleIds.has(String(c.fromTaskId)) && visibleIds.has(String(c.toTaskId));
    });
    const storedPair = new Set(storedFiltered.map((c) => `${c.fromTaskId}\t${c.toTaskId}`));
    const taskList = (boardTasksCache[boardId] || []).filter((t) => t && visibleIds.has(String(t.id)));
    const dependencyConnections = [];
    taskList.forEach((task) => {
      const toId = String(task.id);
      (task.depends_on || []).forEach((depId) => {
        const fromId = String(depId);
        if (!visibleIds.has(fromId) || fromId === toId) return;
        if (storedPair.has(`${fromId}\t${toId}`)) return;
        dependencyConnections.push({
          id: 'dep-' + fromId + '-' + toId,
          fromTaskId: fromId,
          toTaskId: toId,
          fromSide: 'right',
          toSide: 'left',
          label: '',
          fromDependency: true,
        });
      });
    });
    const allConnections = [...storedFiltered, ...dependencyConnections];
    const connections = allConnections;
    function getCardEl(taskId) {
      return boardCardsLayerEl.querySelector(`.board-card[data-task-id="${String(taskId).replace(/"/g, '\\"')}"]`);
    }
    function anchor(cardEl, side) {
      if (!cardEl) return null;
      const l = cardEl.offsetLeft;
      const t = cardEl.offsetTop;
      const w = cardEl.offsetWidth;
      const h = cardEl.offsetHeight;
      if (side === 'left') return { x: l, y: t + h / 2 };
      if (side === 'right') return { x: l + w, y: t + h / 2 };
      if (side === 'top') return { x: l + w / 2, y: t };
      if (side === 'bottom') return { x: l + w / 2, y: t + h };
      return { x: l + w, y: t + h / 2 };
    }
    const SIDES = ['left', 'right', 'top', 'bottom'];
    /** Outward unit vector from card edge for the given side (points away from card). */
    function outward(side) {
      if (side === 'left') return { x: -1, y: 0 };
      if (side === 'right') return { x: 1, y: 0 };
      if (side === 'top') return { x: 0, y: -1 };
      if (side === 'bottom') return { x: 0, y: 1 };
      return { x: 1, y: 0 };
    }
    /** True if segment from fromAnchor to control would go back into the from-card. */
    function fromSegmentCrossesCard(anchorPt, controlX, controlY, side) {
      const out = outward(side);
      return (controlX - anchorPt.x) * out.x + (controlY - anchorPt.y) * out.y < 0;
    }
    /** True if segment from control to toAnchor would go back into the to-card. */
    function toSegmentCrossesCard(anchorPt, controlX, controlY, side) {
      const out = outward(side);
      return (anchorPt.x - controlX) * out.x + (anchorPt.y - controlY) * out.y < 0;
    }
    /** Pick fromSide and toSide that minimize total segment length (fromAnchor->control + control->toAnchor). Always prefer the shortest line. */
    function pickHandlesForShortestLine(fromEl, toEl, cx, cy, currentFrom, currentTo) {
      if (!fromEl || !toEl) return null;
      let bestLen = Infinity;
      let bestFrom = currentFrom || 'right';
      let bestTo = currentTo || 'left';
      for (const fs of SIDES) {
        const a1 = anchor(fromEl, fs);
        if (!a1) continue;
        const d1 = Math.hypot(cx - a1.x, cy - a1.y);
        for (const ts of SIDES) {
          const a2 = anchor(toEl, ts);
          if (!a2) continue;
          const d2 = Math.hypot(a2.x - cx, a2.y - cy);
          const len = d1 + d2;
          if (len < bestLen) {
            bestLen = len;
            bestFrom = fs;
            bestTo = ts;
          }
        }
      }
      return { fromSide: bestFrom, toSide: bestTo };
    }
    boardConnectionsLayerEl.innerHTML = '';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'board-connections-svg');
    svg.setAttribute('width', BOARD_CONNECTIONS_SVG_SIZE);
    svg.setAttribute('height', BOARD_CONNECTIONS_SVG_SIZE);
    svg.setAttribute('style', 'position:absolute;left:0;top:0;pointer-events:none;overflow:visible;');
    const svgHit = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgHit.setAttribute('class', 'board-connections-svg-hit');
    svgHit.setAttribute('width', BOARD_CONNECTIONS_SVG_SIZE);
    svgHit.setAttribute('height', BOARD_CONNECTIONS_SVG_SIZE);
    svgHit.setAttribute('style', 'position:absolute;left:0;top:0;overflow:visible;');
    const connectionElements = new Map();
    connections.forEach((conn) => {
      const fromEl = getCardEl(conn.fromTaskId);
      const toEl = getCardEl(conn.toTaskId);
      if (!fromEl || !toEl) return;
      let cx = conn.controlX != null ? conn.controlX : 0;
      let cy = conn.controlY != null ? conn.controlY : 0;
      const defaultP1 = anchor(fromEl, 'right');
      const defaultP2 = anchor(toEl, 'left');
      if (!defaultP1 || !defaultP2) return;
      if (conn.controlX == null || conn.controlY == null) {
        cx = (defaultP1.x + defaultP2.x) / 2;
        cy = (defaultP1.y + defaultP2.y) / 2;
      }
      const best = pickHandlesForShortestLine(fromEl, toEl, cx, cy, conn.fromSide, conn.toSide);
      if (best) {
        conn.fromSide = best.fromSide;
        conn.toSide = best.toSide;
      }
      const p1 = anchor(fromEl, conn.fromSide || 'right');
      const p2 = anchor(toEl, conn.toSide || 'left');
      if (!p1 || !p2) return;
      const d = `M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}`;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'var(--text-muted)');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('marker-end', 'url(#board-arrow)');
      svg.appendChild(path);
      const midT = 0.5;
      let midX = (1 - midT) * (1 - midT) * p1.x + 2 * (1 - midT) * midT * cx + midT * midT * p2.x;
      let midY = (1 - midT) * (1 - midT) * p1.y + 2 * (1 - midT) * midT * cy + midT * midT * p2.y;
      let labelEl = null;
      if (conn.label) {
        labelEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        labelEl.setAttribute('x', midX);
        labelEl.setAttribute('y', midY);
        labelEl.setAttribute('text-anchor', 'middle');
        labelEl.setAttribute('dominant-baseline', 'middle');
        labelEl.setAttribute('font-size', '11');
        labelEl.setAttribute('fill', 'var(--text)');
        labelEl.textContent = conn.label;
        svg.appendChild(labelEl);
      }
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('class', 'board-connection-group');
      group.setAttribute('data-connection-id', conn.id);
      const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      hitPath.setAttribute('d', d);
      hitPath.setAttribute('fill', 'none');
      hitPath.setAttribute('stroke', 'transparent');
      hitPath.setAttribute('stroke-width', '16');
      hitPath.setAttribute('data-connection-id', conn.id);
      hitPath.style.cursor = 'pointer';
      hitPath.style.pointerEvents = 'stroke';
      hitPath.style.display = 'block';
      hitPath.addEventListener('click', (e) => {
        e.stopPropagation();
        if (conn.fromDependency) return;
        const label = prompt('Connection label:', conn.label || '') || '';
        conn.label = label;
        setBoardConnections(boardId, getBoardConnections(boardId));
        renderBoardConnections(boardId);
      });
      hitPath.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!confirm('Delete this connection? This will also remove the blocking relationship between these tasks.')) return;
        const toId = String(conn.toTaskId);
        const fromId = String(conn.fromTaskId);
        api(`/api/external/tasks/${encodeURIComponent(toId)}/dependencies/${encodeURIComponent(fromId)}`, { method: 'DELETE' })
          .then(() => {
            removeBoardConnectionsBetweenTasks(fromId, toId);
            return refreshBoardAfterTaskUpdate(boardId);
          })
          .catch((err) => {
            console.error('Failed to remove blocking relationship:', err);
            alert(err.message || 'Failed to remove blocking relationship.');
          });
      });
      group.appendChild(hitPath);
      const controlCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      controlCircle.setAttribute('cx', cx);
      controlCircle.setAttribute('cy', cy);
      controlCircle.setAttribute('r', '14');
      controlCircle.setAttribute('fill', 'rgba(37, 99, 235, 0.2)');
      controlCircle.setAttribute('stroke', 'rgba(37, 99, 235, 0.6)');
      controlCircle.setAttribute('stroke-width', '1.5');
      controlCircle.setAttribute('data-connection-id', conn.id);
      controlCircle.setAttribute('class', 'board-connection-control');
      controlCircle.style.cursor = 'move';
      controlCircle.style.pointerEvents = 'all';
      controlCircle.style.display = 'block';
      connectionElements.set(conn.id, { path, hitPath, controlCircle, labelEl, p1, p2 });
      controlCircle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startY = e.clientY;
        const startCX = conn.controlX != null ? conn.controlX : (p1.x + p2.x) / 2;
        const startCY = conn.controlY != null ? conn.controlY : (p1.y + p2.y) / 2;
        const scale = boardPanZoom.scale;
        const el = connectionElements.get(conn.id);
        function onMove(ev) {
          conn.controlX = startCX + (ev.clientX - startX) / scale;
          conn.controlY = startCY + (ev.clientY - startY) / scale;
          const ncx = conn.controlX;
          const ncy = conn.controlY;
          const fromEl = getCardEl(conn.fromTaskId);
          const toEl = getCardEl(conn.toTaskId);
          const best = pickHandlesForShortestLine(fromEl, toEl, ncx, ncy, conn.fromSide, conn.toSide);
          if (best) {
            conn.fromSide = best.fromSide;
            conn.toSide = best.toSide;
          }
          const curP1 = anchor(fromEl, conn.fromSide || 'right');
          const curP2 = anchor(toEl, conn.toSide || 'left');
          const ax = curP1 ? curP1.x : p1.x;
          const ay = curP1 ? curP1.y : p1.y;
          const bx = curP2 ? curP2.x : p2.x;
          const by = curP2 ? curP2.y : p2.y;
          const nd = `M ${ax} ${ay} Q ${ncx} ${ncy} ${bx} ${by}`;
          const nmidX = (1 - midT) * (1 - midT) * ax + 2 * (1 - midT) * midT * ncx + midT * midT * bx;
          const nmidY = (1 - midT) * (1 - midT) * ay + 2 * (1 - midT) * midT * ncy + midT * midT * by;
          if (el) {
            el.path.setAttribute('d', nd);
            el.hitPath.setAttribute('d', nd);
            el.controlCircle.setAttribute('cx', ncx);
            el.controlCircle.setAttribute('cy', ncy);
            if (el.labelEl) {
              el.labelEl.setAttribute('x', nmidX);
              el.labelEl.setAttribute('y', nmidY);
            }
          }
        }
        function onUp() {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          persistConnectionCurve(boardId, conn);
          renderBoardConnections(boardId);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
      group.appendChild(controlCircle);

      function clientToCanvas(cx, cy) {
        const rect = boardViewCanvasEl && boardViewCanvasEl.getBoundingClientRect();
        if (!rect) return { x: 0, y: 0 };
        const s = boardPanZoom.scale;
        return { x: (cx - rect.left - boardPanZoom.x) / s, y: (cy - rect.top - boardPanZoom.y) / s };
      }
      function attachEndpointDrag(circleEl, endpoint) {
        circleEl.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const isFrom = endpoint === 'from';
          const fixedPoint = isFrom ? p2 : p1;
          let previewPath = null;
          function onMove(ev) {
            const pt = clientToCanvas(ev.clientX, ev.clientY);
            if (!previewPath && boardConnectionsLayerEl) {
              const svg = boardConnectionsLayerEl.querySelector('.board-connections-svg');
              if (!svg) return;
              previewPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
              previewPath.setAttribute('class', 'board-connection-preview');
              previewPath.setAttribute('stroke', 'var(--accent)');
              previewPath.setAttribute('stroke-width', '2');
              previewPath.setAttribute('fill', 'none');
              svg.appendChild(previewPath);
            }
            if (previewPath) {
              if (isFrom) previewPath.setAttribute('d', `M ${pt.x} ${pt.y} Q ${(pt.x + fixedPoint.x) / 2} ${(pt.y + fixedPoint.y) / 2} ${fixedPoint.x} ${fixedPoint.y}`);
              else previewPath.setAttribute('d', `M ${fixedPoint.x} ${fixedPoint.y} Q ${(fixedPoint.x + pt.x) / 2} ${(fixedPoint.y + pt.y) / 2} ${pt.x} ${pt.y}`);
            }
          }
          function onUp(ev) {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            if (previewPath && previewPath.parentNode) previewPath.parentNode.removeChild(previewPath);
            const layer = document.getElementById('board-connections-layer');
            const prevPointer = layer && layer.style.pointerEvents;
            if (layer) layer.style.pointerEvents = 'none';
            const target = document.elementFromPoint(ev.clientX, ev.clientY);
            if (layer) layer.style.pointerEvents = prevPointer || '';
            const toHandle = target && target.closest('.board-connection-handle');
            const toCard = (toHandle && toHandle.closest('.board-card')) || (target && target.closest('.board-card'));
            if (toCard) {
              const toTaskId = toCard.dataset.taskId;
              let toSide = (toHandle && toHandle.dataset.side) || null;
              if (!toSide && toCard.getBoundingClientRect) {
                const rect = toCard.getBoundingClientRect();
                const x = ev.clientX - (rect.left + rect.width / 2);
                const y = ev.clientY - (rect.top + rect.height / 2);
                if (Math.abs(x) > Math.abs(y)) toSide = x > 0 ? 'right' : 'left';
                else toSide = y > 0 ? 'bottom' : 'top';
              }
              toSide = toSide || 'right';
              const sameAsOther = isFrom
                ? (String(toTaskId) === String(conn.toTaskId) && toSide === (conn.toSide || 'left'))
                : (String(toTaskId) === String(conn.fromTaskId) && toSide === (conn.fromSide || 'right'));
              const wouldBeSelf = isFrom ? String(toTaskId) === String(conn.toTaskId) : String(toTaskId) === String(conn.fromTaskId);
              if (!sameAsOther && toTaskId && !wouldBeSelf) {
                const newAnchor = anchor(toCard, toSide);
                if (newAnchor) {
                  const oldFromId = String(conn.fromTaskId);
                  const oldToId = String(conn.toTaskId);
                  const currentCx = conn.controlX != null ? conn.controlX : (p1.x + p2.x) / 2;
                  const currentCy = conn.controlY != null ? conn.controlY : (p1.y + p2.y) / 2;
                  if (isFrom) {
                    const dx = newAnchor.x - p1.x;
                    const dy = newAnchor.y - p1.y;
                    conn.fromTaskId = toTaskId;
                    conn.fromSide = toSide;
                    conn.controlX = currentCx + dx;
                    conn.controlY = currentCy + dy;
                  } else {
                    const dx = newAnchor.x - p2.x;
                    const dy = newAnchor.y - p2.y;
                    conn.toTaskId = toTaskId;
                    conn.toSide = toSide;
                  conn.controlX = currentCx + dx;
                  conn.controlY = currentCy + dy;
                  }
                  removeBoardConnection(boardId, oldFromId, oldToId);
                  persistConnectionCurve(boardId, conn);
                  renderBoardConnections(boardId);
                  const newToId = String(conn.toTaskId);
                  const newFromId = String(conn.fromTaskId);
                  api(`/api/external/tasks/${encodeURIComponent(oldToId)}/dependencies/${encodeURIComponent(oldFromId)}`, { method: 'DELETE' })
                    .then(() => api(`/api/external/tasks/${encodeURIComponent(newToId)}/dependencies`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ depends_on_task_id: newFromId }),
                    }))
                    .then(() => refreshBoardAfterTaskUpdate(boardId))
                    .catch((err) => {
                      console.error('Failed to update blocking relationship:', err);
                      alert(err.message || 'Failed to update blocking relationship.');
                    });
                }
              }
            }
          }
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
      }

      const startCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      startCircle.setAttribute('cx', p1.x);
      startCircle.setAttribute('cy', p1.y);
      startCircle.setAttribute('r', '10');
      startCircle.setAttribute('fill', 'rgba(37, 99, 235, 0.25)');
      startCircle.setAttribute('stroke', 'rgba(37, 99, 235, 0.7)');
      startCircle.setAttribute('stroke-width', '1.5');
      startCircle.setAttribute('class', 'board-connection-endpoint');
      startCircle.setAttribute('data-connection-id', conn.id);
      startCircle.setAttribute('data-endpoint', 'from');
      startCircle.style.cursor = 'grab';
      startCircle.style.pointerEvents = 'all';
      attachEndpointDrag(startCircle, 'from');
      group.appendChild(startCircle);

      const endCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      endCircle.setAttribute('cx', p2.x);
      endCircle.setAttribute('cy', p2.y);
      endCircle.setAttribute('r', '10');
      endCircle.setAttribute('fill', 'rgba(37, 99, 235, 0.25)');
      endCircle.setAttribute('stroke', 'rgba(37, 99, 235, 0.7)');
      endCircle.setAttribute('stroke-width', '1.5');
      endCircle.setAttribute('class', 'board-connection-endpoint');
      endCircle.setAttribute('data-connection-id', conn.id);
      endCircle.setAttribute('data-endpoint', 'to');
      endCircle.style.cursor = 'grab';
      endCircle.style.pointerEvents = 'all';
      attachEndpointDrag(endCircle, 'to');
      group.appendChild(endCircle);

      svgHit.appendChild(group);
    });
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', 'board-arrow');
    marker.setAttribute('markerWidth', '10');
    marker.setAttribute('markerHeight', '10');
    marker.setAttribute('refX', '9');
    marker.setAttribute('refY', '3');
    marker.setAttribute('orient', 'auto');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', '0 0, 10 3, 0 6');
    poly.setAttribute('fill', 'var(--text-muted)');
    marker.appendChild(poly);
    defs.appendChild(marker);
    svg.insertBefore(defs, svg.firstChild);
    boardConnectionsLayerEl.appendChild(svg);
    boardConnectionsLayerEl.appendChild(svgHit);
  }

  function renderBoardGrid() {
    if (!boardGridLayerEl) return;
    const visible = localStorage.getItem(BOARD_GRID_VISIBLE_KEY) === '1';
    if (boardGridLayerEl.classList) boardGridLayerEl.classList.toggle('hidden', !visible);
    if (boardGridLayerEl.setAttribute) boardGridLayerEl.setAttribute('aria-hidden', visible ? 'false' : 'true');
    if (boardGridBtn) boardGridBtn.classList.toggle('active', visible);
    if (!visible) {
      boardGridLayerEl.innerHTML = '';
      boardGridLayerEl.classList.remove('board-grid-visible');
      boardGridLayerEl.style.width = '';
      boardGridLayerEl.style.height = '';
      boardGridLayerEl.style.left = '';
      boardGridLayerEl.style.top = '';
      return;
    }
    boardGridLayerEl.innerHTML = '';
    boardGridLayerEl.classList.add('board-grid-visible');
    const gridHalf = Math.floor(BOARD_CONNECTIONS_SVG_SIZE / 2);
    boardGridLayerEl.style.left = -gridHalf + 'px';
    boardGridLayerEl.style.top = -gridHalf + 'px';
    boardGridLayerEl.style.width = BOARD_CONNECTIONS_SVG_SIZE + 'px';
    boardGridLayerEl.style.height = BOARD_CONNECTIONS_SVG_SIZE + 'px';
  }

  function renderBoardCards(boardId) {
    if (!boardCardsLayerEl) return;
    const cards = getBoardCards(boardId);
    const tasks = boardTasksCache[boardId] || [];
    const taskMap = new Map(tasks.map((t) => [String(t.id), t]));
    boardCardsLayerEl.innerHTML = '';
    cards.forEach((card, idx) => {
      const task = taskMap.get(String(card.taskId));
      const w = card.width || BOARD_DEFAULT_CARD_WIDTH;
      const h = card.height || BOARD_DEFAULT_CARD_HEIGHT;
      const el = document.createElement('div');
      el.className = 'board-card';
      el.dataset.boardId = boardId;
      el.dataset.taskId = card.taskId;
      el.dataset.cardIndex = String(idx);
      el.style.left = (card.x || 0) + 'px';
      el.style.top = (card.y || 0) + 'px';
      el.style.width = w + 'px';
      el.style.height = h + 'px';
      if (!task) {
        el.innerHTML = `<div class="board-card-header"><span class="board-card-title">Task ${card.taskId}</span></div><div class="board-card-dates">Loading…</div>`;
        boardCardsLayerEl.appendChild(el);
        api(`/api/external/tasks/${encodeURIComponent(card.taskId)}`).then((t) => {
          if (boardTasksCache[boardId]) {
            const idx = boardTasksCache[boardId].findIndex((x) => String(x.id) === String(t.id));
            if (idx >= 0) boardTasksCache[boardId][idx] = t;
            else boardTasksCache[boardId].push(t);
          }
          updateBoardCardContent(el, t, boardId);
        }).catch(() => { el.querySelector('.board-card-dates').textContent = 'Task not found'; });
        return;
      }
      el.innerHTML = buildBoardCardHtml(task, card.taskId, BOARD_CARD_EXPAND_SVG);
      boardCardsLayerEl.appendChild(el);
      attachBoardCardBehavior(el, task, boardId, idx);
    });
    renderBoardConnections(boardId);
  }
  function buildBoardCardHtml(t, taskId, expandSvg) {
    const title = (t.title || '(no title)').replace(/</g, '&lt;');
    const statusComplete = isTaskCompleted(t);
    const flagged = t.flagged === true || t.flagged === 1;
    const priorityCls = priorityClass(t.priority);
    const av = (t.available_date || '').toString().trim().substring(0, 10);
    const due = (t.due_date || '').toString().trim().substring(0, 10);
    const statusSvg = statusComplete ? INSPECTOR_STATUS_TICK_SVG : INSPECTOR_STATUS_OPEN_SVG;
    const flagHtml = '<span class="board-card-flagged' + (flagged ? '' : ' empty') + '">★</span>';
    const avStr = av ? formatDate(av) : '';
    const dueStr = due ? formatDate(due) : '';
    const duePart = dueStr
      ? (isOverdue(t.due_date) ? `<span class="due-overdue">Due: ${dueStr}</span>` : isToday(t.due_date) ? `<span class="due-today">Due: ${dueStr}</span>` : `Due: ${dueStr}`)
      : '';
    const datesStr = [avStr && `Avail: ${avStr}`, duePart].filter(Boolean).join(' · ') || '—';
    const taskIdEsc = (taskId || '').replace(/"/g, '&quot;');
    return `
      <span class="board-connection-handle board-connection-handle-left" data-side="left" title="Drag to connect to another task" aria-label="Connection handle left"></span>
      <span class="board-connection-handle board-connection-handle-right" data-side="right" title="Drag to connect to another task" aria-label="Connection handle right"></span>
      <span class="board-connection-handle board-connection-handle-top" data-side="top" title="Drag to connect to another task" aria-label="Connection handle top"></span>
      <span class="board-connection-handle board-connection-handle-bottom" data-side="bottom" title="Drag to connect to another task" aria-label="Connection handle bottom"></span>
      <div class="board-card-header">
        <span class="board-card-priority priority-circle-wrap ${priorityCls}" data-priority-task-id="${taskIdEsc}" title="Priority (click to change)">${PRIORITY_CIRCLE_SVG}</span>
        ${flagHtml}
        <span class="board-card-status">${statusSvg}</span>
        <span class="board-card-title">${title}</span>
      </div>
      <div class="board-card-dates">${datesStr}</div>
      <div class="board-card-footer">
        <button type="button" class="board-card-archive" data-task-id="${taskIdEsc}" title="Remove from board" aria-label="Remove from board">${INSPECTOR_ARCHIVE_SVG}</button>
        <button type="button" class="board-card-expand" data-task-id="${taskIdEsc}" title="Expand" aria-label="Expand">${expandSvg}</button>
      </div>
      <div class="board-card-resize-handle"></div>
    `;
  }
  function updateBoardCardContent(el, t, boardId) {
    const taskId = el.dataset.taskId;
    const idx = parseInt(el.dataset.cardIndex, 10);
    el.innerHTML = buildBoardCardHtml(t, taskId, BOARD_CARD_EXPAND_SVG);
    attachBoardCardBehavior(el, t, boardId, idx);
  }
  function attachBoardCardBehavior(el, task, boardId, cardIndex) {
    const taskId = el.dataset.taskId;
    const header = el.querySelector('.board-card-header');
    const titleEl = el.querySelector('.board-card-title');
    const datesEl = el.querySelector('.board-card-dates');
    const expandBtn = el.querySelector('.board-card-expand');
    const archiveBtn = el.querySelector('.board-card-archive');
    const resizeHandle = el.querySelector('.board-card-resize-handle');
    if (archiveBtn) {
      archiveBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const cards = getBoardCards(boardId);
        cards.splice(cardIndex, 1);
        setBoardCards(boardId, cards);
        renderBoardCards(boardId);
        renderBoardConnections(boardId);
        updateBoardAddTaskBadge(boardId);
      });
    }
    if (header) {
      header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.board-card-expand') || e.target.closest('.board-card-resize-handle') || e.target.closest('.board-connection-handle') || e.target.closest('.board-card-archive') || e.target.closest('.board-card-priority') || e.target.closest('.board-card-flagged') || e.target.closest('.board-card-status')) return;
        e.preventDefault();
        const cards = getBoardCards(boardId);
        const card = cards[cardIndex];
        const startCardX = card.x || 0;
        const startCardY = card.y || 0;
        const startMouseX = e.clientX;
        const startMouseY = e.clientY;
        const scale = boardPanZoom.scale;
        function onMove(ev) {
          const dx = (ev.clientX - startMouseX) / scale;
          const dy = (ev.clientY - startMouseY) / scale;
          card.x = Math.round(startCardX + dx);
          card.y = Math.round(startCardY + dy);
          el.style.left = card.x + 'px';
          el.style.top = card.y + 'px';
          setBoardCards(boardId, cards);
          renderBoardConnections(boardId);
        }
        function onUp() {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          const cx = card.x + (el.offsetWidth / 2);
          const cy = card.y + (el.offsetHeight / 2);
          const regions = getBoardRegions(boardId);
          let droppedIntoRegion = null;
          for (let i = 0; i < regions.length; i++) {
            const r = regions[i];
            const rx = r.x || 0, ry = r.y || 0, rw = r.w || 200, rh = r.h || 200;
            if (cx >= rx && cx <= rx + rw && cy >= ry && cy <= ry + rh) { droppedIntoRegion = i; break; }
          }
          if (droppedIntoRegion !== null) {
            cards.splice(cardIndex, 1);
            if (!regions[droppedIntoRegion].lines) regions[droppedIntoRegion].lines = [];
            regions[droppedIntoRegion].lines.push({ taskId });
            setBoardCards(boardId, cards);
            setBoardRegions(boardId, regions);
            applyRegionSettingsToTask(taskId, regions[droppedIntoRegion], boardId);
            renderBoardRegions(boardId);
            renderBoardCards(boardId);
          } else {
            setBoardCards(boardId, cards);
          }
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    }
    if (resizeHandle) {
      resizeHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startW = el.offsetWidth;
        const startH = el.offsetHeight;
        const startX = e.clientX;
        const startY = e.clientY;
        const cards = getBoardCards(boardId);
        const card = cards[cardIndex];
        function onMove(ev) {
          const dw = ev.clientX - startX;
          const dh = ev.clientY - startY;
          const nw = Math.max(187, startW + dw);
          const nh = Math.max(108, startH + dh);
          card.width = Math.round(nw);
          card.height = Math.round(nh);
          el.style.width = card.width + 'px';
          el.style.height = card.height + 'px';
          setBoardCards(boardId, cards);
        }
        function onUp() {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          setBoardCards(boardId, cards);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    }
    if (expandBtn) {
      expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openBoardTaskInspectorModal(taskId, () => { renderBoardCards(boardId); renderBoardConnections(boardId); });
      });
    }
    el.querySelectorAll('.board-connection-handle').forEach((handle) => {
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const side = handle.dataset.side || 'right';
        const l = el.offsetLeft;
        const t = el.offsetTop;
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        const startX = side === 'left' ? l : side === 'right' ? l + w : l + w / 2;
        const startY = side === 'top' ? t : side === 'bottom' ? t + h : t + h / 2;
        let previewPath = null;
        const canvasRect = boardViewCanvasEl.getBoundingClientRect();
        const scale = boardPanZoom.scale;
        function clientToCanvas(cx, cy) {
          return { x: (cx - canvasRect.left - boardPanZoom.x) / scale, y: (cy - canvasRect.top - boardPanZoom.y) / scale };
        }
        function onMove(ev) {
          const end = clientToCanvas(ev.clientX, ev.clientY);
          if (!previewPath && boardConnectionsLayerEl) {
            const svg = boardConnectionsLayerEl.querySelector('svg');
            if (!svg) return;
            previewPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            previewPath.setAttribute('class', 'board-connection-preview');
            previewPath.setAttribute('stroke', 'var(--accent)');
            previewPath.setAttribute('stroke-width', '2');
            previewPath.setAttribute('fill', 'none');
            svg.appendChild(previewPath);
          }
          if (previewPath) {
            const mx = (startX + end.x) / 2;
            const my = (startY + end.y) / 2;
            previewPath.setAttribute('d', `M ${startX} ${startY} Q ${mx} ${my} ${end.x} ${end.y}`);
          }
        }
        function onUp(ev) {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          if (previewPath && previewPath.parentNode) previewPath.parentNode.removeChild(previewPath);
          const target = document.elementFromPoint(ev.clientX, ev.clientY);
          const toHandle = target && target.closest('.board-connection-handle');
          const toCard = toHandle && toHandle.closest('.board-card');
          const toTaskId = toCard && toCard.dataset.taskId;
          const toSide = (toHandle && toHandle.dataset.side) || 'right';
          const sameHandle = toCard === el && toSide === side;
          const selfConnection = toTaskId && String(toTaskId) === String(taskId);
          if (toCard && toHandle && !sameHandle && toTaskId && !selfConnection) {
            const connections = getBoardConnections(boardId);
            const id = 'conn-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
            connections.push({ id, fromTaskId: taskId, toTaskId, fromSide: side, toSide, label: '' });
            setBoardConnections(boardId, connections);
            renderBoardConnections(boardId);
            api(`/api/external/tasks/${encodeURIComponent(toTaskId)}/dependencies`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ depends_on_task_id: taskId }),
            }).then(() => refreshBoardAfterTaskUpdate(boardId)).catch((err) => {
              console.error('Failed to add blocking relationship:', err);
              const conns = getBoardConnections(boardId).filter((c) => c.id !== id);
              setBoardConnections(boardId, conns);
              renderBoardConnections(boardId);
              alert(err.message || 'Failed to add blocking relationship.');
            });
          }
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });
    const priorityEl = el.querySelector('.board-card-priority');
    const statusEl = el.querySelector('.board-card-status');
    const flagEl = el.querySelector('.board-card-flagged');
    if (priorityEl) {
      priorityEl.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        openPriorityDropdown(e, priorityEl, { onAfterApply: () => refreshBoardAfterTaskUpdate(boardId) });
      });
    }
    if (statusEl) {
      statusEl.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const newStatus = isTaskCompleted(task) ? 'incomplete' : 'complete';
        updateTask(taskId, { status: newStatus }).then(() => refreshBoardAfterTaskUpdate(boardId));
      });
    }
    if (flagEl) {
      flagEl.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        updateTask(taskId, { flagged: !(task.flagged === true || task.flagged === 1) }).then(() => refreshBoardAfterTaskUpdate(boardId));
      });
    }
    if (titleEl) {
      titleEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const input = document.createElement('input');
        input.type = 'text';
        input.value = (task.title || '').trim();
        input.className = 'inspector-edit-input';
        input.style.width = '100%';
        titleEl.replaceWith(input);
        attachHashtagAutocomplete(input);
        input.focus();
        input.select();
        const save = () => {
          const v = (input.value || '').trim();
          updateTask(taskId, { title: v || '(no title)' }).then((t2) => {
            if (boardTasksCache[boardId]) {
              const i = boardTasksCache[boardId].findIndex((x) => String(x.id) === String(taskId));
              if (i >= 0) boardTasksCache[boardId][i] = t2;
            }
            const span = document.createElement('span');
            span.className = 'board-card-title';
            span.textContent = (t2.title || '(no title)').replace(/</g, '&lt;');
            input.replaceWith(span);
            attachBoardCardBehavior(el, t2, boardId, cardIndex);
          });
        };
        input.addEventListener('blur', save);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
      });
    }
  }
  function openBoardTaskInspectorModal(taskId, onUpdate) {
    const overlay = document.getElementById('board-task-inspector-overlay');
    const content = document.getElementById('board-task-inspector-content');
    const titleEl = document.getElementById('board-task-inspector-title');
    const closeBtn = document.getElementById('board-task-inspector-close');
    if (!overlay || !content) return;
    if (titleEl) titleEl.textContent = 'Task';
    content.innerHTML = '<p class="placeholder">Loading…</p>';
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    const onTitle = (num) => { if (titleEl) titleEl.textContent = num != null ? `Task ${num}` : 'Task'; };
    loadTaskDetailsInto(content, taskId, () => {
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');
      if (onUpdate) onUpdate();
    }, currentBoardId, onTitle);
    const close = () => {
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');
      if (onUpdate) onUpdate();
    };
    if (closeBtn) closeBtn.onclick = close;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }
  function loadTaskDetailsInto(containerEl, taskId, onClose, boardId, onTitle) {
    if (!containerEl) return;
    loadTaskDetails(taskId, { container: containerEl, onClose, boardId: boardId || null, onTitle: onTitle || null });
  }

  function applyListOrder(lists) {
    if (!Array.isArray(lists) || !lists.length) return lists;
    const order = getListOrder();
    if (!order.length) return lists;
    const byId = new Map(lists.map((l) => [String(l.id), l]));
    const ordered = order.map((id) => byId.get(id)).filter(Boolean);
    const rest = lists.filter((l) => !order.includes(String(l.id)));
    return ordered.concat(rest);
  }
  function getLists() {
    return Array.isArray(listsListCache) ? listsListCache.slice() : [];
  }
  async function loadListsFromApi() {
    try {
      const data = await api('/api/external/lists');
      const raw = Array.isArray(data) ? data : [];
      listsListCache = applyListOrder(raw);
    } catch (_) {
      listsListCache = [];
    }
    loadLists();
  }
  function loadLists() {
    if (!listsListEl) return;
    const lists = getLists();
    const showDueOverdueCounts = getShowDueOverdueCounts();
    const countRendererNav = showDueOverdueCounts ? (c) => renderNavCounts(c) : (c) => renderNavCountsSimple(c);
    if (!lists.length) {
      listsListEl.innerHTML = `<li class="nav-item placeholder">—</li>`;
      return;
    }
    const minusSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>';
    const moveSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 6C22.5523 6 23 6.44772 23 7C23 7.55229 22.5523 8 22 8H2C1.44772 8 1 7.55228 1 7C1 6.44772 1.44772 6 2 6L22 6Z"/><path d="M22 11C22.5523 11 23 11.4477 23 12C23 12.5523 22.5523 13 22 13H2C1.44772 13 1 12.5523 1 12C1 11.4477 1.44772 11 2 11H22Z"/><path d="M23 17C23 16.4477 22.5523 16 22 16H2C1.44772 16 1 16.4477 1 17C1 17.5523 1.44772 18 2 18H22C22.5523 18 23 17.5523 23 17Z"/></svg>';
    listsListEl.innerHTML = lists.map((list) => {
      const name = (list.name || '').replace(/</g, '&lt;');
      const label = (list.name || '').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      const listIdEsc = (list.id || '').replace(/"/g, '&quot;');
      const isFav = isInFavorites('list', list.id);
      const starIconList = isFav ? STAR_PROHIBITED_SVG_14 : STAR_ADD_SVG_14;
      const favTitle = isFav ? 'Remove from favorites' : 'Add to favorites';
      const favBtn = `<button type="button" class="nav-action-btn nav-item-favorite-toggle" data-favorite="${isFav ? '1' : '0'}" title="${favTitle}" aria-label="${favTitle}">${starIconList}</button>`;
      const actions = `<span class="nav-item-actions">${favBtn}<button type="button" class="nav-action-btn nav-item-delete" title="Delete" aria-label="Delete list">${minusSvg}</button><span class="nav-item-drag-handle" title="Reorder" aria-label="Drag to reorder">${moveSvg}</span></span>`;
      return `<li class="nav-item" data-type="list" data-list-id="${listIdEsc}" data-label="${label}">${name}${actions}</li>`;
    }).join('');
    listsListEl.querySelectorAll('.nav-item').forEach((el) => {
      el.addEventListener('click', onListClick);
    });
    listsListEl.querySelectorAll('.nav-item-delete').forEach((btn) => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); onListDelete(e); });
    });
    listsListEl.querySelectorAll('.nav-item-favorite-toggle').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const li = btn.closest('.nav-item');
        if (!li || !li.dataset.listId) return;
        const id = li.dataset.listId;
        const label = (li.dataset.label || 'List').replace(/&quot;/g, '"');
        if (isInFavorites('list', id)) {
          removeFromFavorites('list', id);
        } else {
          addToFavorites('list', id, label);
        }
        loadLists();
      });
    });
    listsListEl.querySelectorAll('.nav-item-drag-handle').forEach((handle) => {
      handle.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); onNavItemDragStart(e, 'list'); });
    });
  }

  let cachedTagNames = [];

  // --- # Hashtag autocomplete: inline suggestion (Gmail-style), Tab to accept ---
  /** Apply user's capitalization from fragment to tag (e.g. "Marg" + "margaret" -> "Margaret"). */
  function applyCaseFromFragment(fragment, tag) {
    if (!fragment || !tag) return tag;
    let out = '';
    for (let i = 0; i < tag.length; i++) {
      out += i < fragment.length ? fragment[i] : tag[i];
    }
    return out;
  }

  function hideHashtagInlineSuggestion(wrapper) {
    if (!wrapper) return;
    const span = wrapper.querySelector('.hashtag-inline-suggestion');
    if (span) {
      span.textContent = '';
      span.classList.remove('visible');
    }
    wrapper.dataset.hashtagSuggestionTag = '';
    wrapper.dataset.hashtagSuggestionFragment = '';
  }

  function acceptHashtagInlineSuggestion(input, tag, fragment) {
    const val = input.value || '';
    const st = input.selectionStart != null ? input.selectionStart : val.length;
    const before = val.substring(0, st);
    const hashIdx = before.lastIndexOf('#');
    if (hashIdx === -1) return;
    const displayTag = (fragment != null && fragment !== '') ? applyCaseFromFragment(fragment, tag) : tag;
    const newText = val.substring(0, hashIdx) + '#' + displayTag + ' ' + val.substring(st);
    input.value = newText;
    const newPos = hashIdx + 1 + displayTag.length + 1;
    input.setSelectionRange(newPos, newPos);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function updateHashtagInlineSuggestion(input, wrapper, tagNames) {
    const value = input.value || '';
    const start = input.selectionStart != null ? input.selectionStart : value.length;
    const textBefore = value.substring(0, start);
    const lastHash = textBefore.lastIndexOf('#');
    const suggestionSpan = wrapper && wrapper.querySelector('.hashtag-inline-suggestion');
    const measureSpan = wrapper && wrapper.querySelector('.hashtag-inline-measure');
    if (!suggestionSpan || !measureSpan) return;
    if (lastHash === -1) {
      hideHashtagInlineSuggestion(wrapper);
      return;
    }
    const fragment = textBefore.substring(lastHash + 1);
    if (!/^[a-zA-Z0-9_-]*$/.test(fragment)) {
      hideHashtagInlineSuggestion(wrapper);
      return;
    }
    const tags = tagNames && tagNames.length ? tagNames : [];
    const match = tags.find((t) => t.toLowerCase().startsWith(fragment.toLowerCase()));
    if (!match) {
      hideHashtagInlineSuggestion(wrapper);
      return;
    }
    const displayTag = applyCaseFromFragment(fragment, match);
    const suffix = displayTag.substring(fragment.length);
    if (!suffix) {
      hideHashtagInlineSuggestion(wrapper);
      return;
    }
    const textToCursor = value.substring(0, start);
    const cs = getComputedStyle(input);
    const paddingLeft = parseFloat(cs.paddingLeft) || 0;
    const paddingTop = parseFloat(cs.paddingTop) || 0;
    if (input.tagName === 'TEXTAREA') {
      const lines = textToCursor.split('\n');
      const lineIndex = Math.max(0, lines.length - 1);
      const currentLine = lines[lineIndex] || '';
      measureSpan.textContent = currentLine;
      let lineHeight = parseFloat(cs.lineHeight);
      if (Number.isNaN(lineHeight) || lineHeight <= 0) lineHeight = 1.2 * (parseFloat(cs.fontSize) || 16);
      suggestionSpan.style.left = (paddingLeft + measureSpan.offsetWidth) + 'px';
      suggestionSpan.style.top = (paddingTop + lineIndex * lineHeight) + 'px';
    } else {
      measureSpan.textContent = textToCursor;
      suggestionSpan.style.left = (paddingLeft + measureSpan.offsetWidth) + 'px';
      suggestionSpan.style.top = paddingTop + 'px';
    }
    suggestionSpan.textContent = suffix;
    suggestionSpan.classList.add('visible');
    wrapper.dataset.hashtagSuggestionTag = match;
    wrapper.dataset.hashtagSuggestionFragment = fragment;
  }

  function wrapInputForHashtagInline(input) {
    let wrapper = input.closest('.hashtag-inline-wrap');
    if (wrapper) return wrapper;
    const parent = input.parentNode;
    wrapper = document.createElement('div');
    wrapper.className = 'hashtag-inline-wrap';
    parent.insertBefore(wrapper, input);
    wrapper.appendChild(input);
    const measureSpan = document.createElement('span');
    measureSpan.className = 'hashtag-inline-measure';
    measureSpan.setAttribute('aria-hidden', 'true');
    const cs = getComputedStyle(input);
    measureSpan.style.font = cs.font;
    measureSpan.style.fontSize = cs.fontSize;
    measureSpan.style.fontFamily = cs.fontFamily;
    measureSpan.style.fontWeight = cs.fontWeight;
    measureSpan.style.letterSpacing = cs.letterSpacing;
    measureSpan.style.paddingLeft = '0';
    measureSpan.style.paddingTop = '0';
    wrapper.appendChild(measureSpan);
    const suggestionSpan = document.createElement('span');
    suggestionSpan.className = 'hashtag-inline-suggestion';
    suggestionSpan.setAttribute('aria-hidden', 'true');
    suggestionSpan.style.font = cs.font;
    suggestionSpan.style.fontSize = cs.fontSize;
    suggestionSpan.style.fontFamily = cs.fontFamily;
    suggestionSpan.style.fontWeight = cs.fontWeight;
    suggestionSpan.style.letterSpacing = cs.letterSpacing;
    wrapper.appendChild(suggestionSpan);
    return wrapper;
  }

  let hashtagAutocompleteInputTimeout = null;
  /** For new-task modal: attach autocomplete only after user types # so typing is fast until then. */
  function attachHashtagAutocompleteLazy(el) {
    if (!el || el.dataset.hashtagAutocompleteLazy === 'true') return;
    el.dataset.hashtagAutocompleteLazy = 'true';
    function attach() {
      el.removeEventListener('keydown', onKeydown);
      el.removeEventListener('input', onInput);
      el.dataset.hashtagAutocompleteLazy = 'false';
      attachHashtagAutocomplete(el);
    }
    function onKeydown(ev) {
      if (ev.key === '#') attach();
    }
    function onInput() {
      if ((el.value || '').includes('#')) attach();
    }
    el.addEventListener('keydown', onKeydown);
    el.addEventListener('input', onInput);
  }

  function attachHashtagAutocomplete(el) {
    if (!el || el.dataset.hashtagAutocomplete === 'true') return;
    el.dataset.hashtagAutocomplete = 'true';
    const wrapper = wrapInputForHashtagInline(el);
    const tags = cachedTagNames.length ? cachedTagNames : [];

    el.addEventListener('input', () => {
      if (hashtagAutocompleteInputTimeout) clearTimeout(hashtagAutocompleteInputTimeout);
      const debounceMs = el.closest('#new-task-modal-overlay') || el.closest('#description-modal-overlay') ? 150 : 80;
      hashtagAutocompleteInputTimeout = setTimeout(() => {
        hashtagAutocompleteInputTimeout = null;
        updateHashtagInlineSuggestion(el, wrapper, cachedTagNames.length ? cachedTagNames : []);
      }, debounceMs);
    });

    el.addEventListener('keydown', (e) => {
      const tag = wrapper.dataset.hashtagSuggestionTag;
      const fragment = wrapper.dataset.hashtagSuggestionFragment;
      if (e.key === 'Tab' && tag) {
        e.preventDefault();
        acceptHashtagInlineSuggestion(el, tag, fragment);
        hideHashtagInlineSuggestion(wrapper);
        return;
      }
      if (e.key === 'Escape') {
        if (tag) {
          e.preventDefault();
          hideHashtagInlineSuggestion(wrapper);
        }
      }
    });

    el.addEventListener('keyup', () => {
      requestAnimationFrame(() => updateHashtagInlineSuggestion(el, wrapper, cachedTagNames.length ? cachedTagNames : []));
    });
    el.addEventListener('click', () => {
      requestAnimationFrame(() => updateHashtagInlineSuggestion(el, wrapper, cachedTagNames.length ? cachedTagNames : []));
    });

    el.addEventListener('blur', () => {
      setTimeout(() => hideHashtagInlineSuggestion(wrapper), 120);
    });
  }
  if (descriptionEditTextarea) attachHashtagAutocomplete(descriptionEditTextarea);

  function getTagSort() {
    const v = (localStorage.getItem(NAV_TAG_SORT_KEY) || 'name_asc').trim();
    return ['name_asc', 'name_desc', 'count_asc', 'count_desc'].includes(v) ? v : 'name_asc';
  }
  function setTagSort(value) {
    if (['name_asc', 'name_desc', 'count_asc', 'count_desc'].includes(value)) {
      localStorage.setItem(NAV_TAG_SORT_KEY, value);
    }
  }

  async function loadTags(optionalTasks) {
    if (!tagsListEl) return;
    if (!getApiKey()) {
      tagsListEl.innerHTML = '<li class="nav-item placeholder">Set API key to list tags</li>';
      cachedTagNames = [];
      return;
    }
    try {
      let tasks = optionalTasks;
      if (!Array.isArray(tasks)) tasks = await api('/api/external/tasks?limit=1000').catch(() => []);
      let tags = await api('/api/external/tags');
      tags = Array.isArray(tags) ? tags.slice() : [];
      cachedTagNames = tags.map((item) => String(item.tag || '').trim()).filter(Boolean);
      if (!tags.length) {
        tagsListEl.innerHTML = '<li class="nav-item placeholder">—</li>';
        return;
      }
      const tagToTasksMap = new Map();
      tags.forEach((item) => {
        const rawTag = String(item.tag || '').trim();
        if (!rawTag) return;
        const tagTasks = (tasks || []).filter((t) => (t.tags || []).some((x) => String(x).trim() === rawTag));
        tagToTasksMap.set(rawTag, tagTasks);
      });
      const sort = getTagSort();
      if (sort === 'name_asc') tags.sort((a, b) => String(a.tag || '').localeCompare(String(b.tag || ''), undefined, { sensitivity: 'base' }));
      else if (sort === 'name_desc') tags.sort((a, b) => String(b.tag || '').localeCompare(String(a.tag || ''), undefined, { sensitivity: 'base' }));
      else if (sort === 'count_asc') tags.sort((a, b) => (tagToTasksMap.get(String(a.tag || '').trim()) || []).length - (tagToTasksMap.get(String(b.tag || '').trim()) || []).length);
      else if (sort === 'count_desc') tags.sort((a, b) => (tagToTasksMap.get(String(b.tag || '').trim()) || []).length - (tagToTasksMap.get(String(a.tag || '').trim()) || []).length);

      const showDueOverdueCounts = getShowDueOverdueCounts();
      const countRendererNav = showDueOverdueCounts ? (c) => renderNavCounts(c) : (c) => renderNavCountsSimple(c);
      const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      tagsListEl.innerHTML = tags.map((item) => {
        const rawTag = String(item.tag || '').trim();
        const tag = escape(rawTag);
        const tagTasks = tagToTasksMap.get(rawTag) || [];
        const countHtml = countRendererNav(countTasksByBucket(tagTasks)).replace('class="nav-item-count', 'class="nav-item-count nav-item-count-tag');
        const isFav = isInFavorites('tag', rawTag);
        const starIcon = isFav ? STAR_PROHIBITED_SVG_14 : STAR_ADD_SVG_14;
        const favTitle = isFav ? 'Remove from favorites' : 'Add to favorites';
        const favBtn = `<button type="button" class="nav-action-btn nav-item-favorite-toggle" data-favorite="${isFav ? '1' : '0'}" title="${favTitle}" aria-label="${favTitle}">${starIcon}</button>`;
        const actions = `<span class="nav-item-actions">${favBtn}</span>`;
        return `<li class="nav-item" data-type="tag" data-tag="${tag}">#${tag} ${countHtml}${actions}</li>`;
      }).join('');
      tagsListEl.querySelectorAll('.nav-item').forEach((el) => {
        el.addEventListener('click', onTagClick);
      });
      tagsListEl.querySelectorAll('.nav-item-favorite-toggle').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const li = btn.closest('.nav-item');
          if (!li || !li.dataset.tag) return;
          const tagName = li.dataset.tag || '';
          if (isInFavorites('tag', tagName)) {
            removeFromFavorites('tag', tagName);
          } else {
            addToFavorites('tag', tagName, '#' + tagName);
          }
          loadTags();
          loadFavorites();
        });
      });
    } catch (e) {
      tagsListEl.innerHTML = '<li class="nav-item placeholder">Failed to load tags</li>';
    }
  }
  function syncTagsSortActive() {
    const current = getTagSort();
    document.querySelectorAll('.tags-sort-row .tags-sort-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.sort === current);
    });
  }
  document.querySelectorAll('.tags-sort-row .tags-sort-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      setTagSort(btn.dataset.sort);
      syncTagsSortActive();
      loadTags();
    });
  });

  function onTagClick(ev) {
    const li = ev.currentTarget;
    if (li.classList.contains('placeholder')) return;
    const tag = li.dataset.tag;
    if (!tag) return;
    currentInspectorTag = tag;
    if (inboxItem) inboxItem.classList.remove('selected');
    if (projectsList) projectsList.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
    if (listsListEl) listsListEl.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
    if (tagsListEl) tagsListEl.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
    if (favoritesListEl) favoritesListEl.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
    li.classList.add('selected');
    lastTaskSource = 'tag:' + tag;
    updateCenterHeaderForSource();
    const centerTitle = document.getElementById('center-title');
    if (centerTitle) centerTitle.textContent = '#' + tag;
    const centerDesc = document.getElementById('center-description');
    if (centerDesc) centerDesc.textContent = '';
    document.getElementById('center-content').innerHTML = '<p class="placeholder">Loading…</p>';
    document.getElementById('inspector-title').textContent = 'Tag';
    requestAnimationFrame(() => {
      loadTagDetails(tag);
      loadTagTasks(tag);
    });
  }

  function loadTagDetails(tagName) {
    const div = document.getElementById('inspector-content');
    const titleEl = document.getElementById('inspector-title');
    if (!div || !titleEl) return;
    currentInspectorTag = tagName;
    titleEl.textContent = 'Tag';
    const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const tagEsc = escape(tagName);
    div.innerHTML = '<div class="inspector-content-inner">' +
      '<p class="inspector-label-line"><strong>Name</strong></p>' +
      '<input type="text" id="inspector-tag-name" class="inspector-edit-input" value="' + tagEsc + '" placeholder="Tag name (letters, numbers, _ or -)" aria-label="Tag name" maxlength="80" />' +
      '<div class="inspector-tag-actions">' +
      '<button type="button" id="inspector-tag-delete" class="inspector-action-btn" title="Delete tag" aria-label="Delete">' + INSPECTOR_TRASH_SVG + '</button>' +
      '<button type="button" id="inspector-tag-save" class="inspector-action-btn inspector-save-action-btn" title="Rename tag" aria-label="Save">' + INSPECTOR_SAVE_SVG + '</button>' +
      '</div></div>';
    const nameInput = document.getElementById('inspector-tag-name');
    const deleteBtn = document.getElementById('inspector-tag-delete');
    const saveBtn = document.getElementById('inspector-tag-save');
    if (nameInput) {
      nameInput.addEventListener('input', () => {
        const v = nameInput.value;
        if (!TAG_NAME_REGEX.test(v.replace(/\s/g, ''))) {
          nameInput.setCustomValidity('Single word: letters, numbers, underscore or dash only.');
        } else {
          nameInput.setCustomValidity('');
        }
      });
    }
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        if (!confirm('Delete tag "#' + tagName + '"? It will be removed from all task tags and any #' + tagName + ' in titles/notes.')) return;
        try {
          const res = await api('/api/execute-pending-confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tool: 'tag_delete', tag: tagName }),
          });
          const data = typeof res === 'object' ? res : {};
          if (data.ok) {
            currentInspectorTag = null;
            loadTags();
            titleEl.textContent = 'Inspector';
            div.innerHTML = '<p class="placeholder">Select an item to inspect.</p>';
            if (lastTaskSource === 'tag:' + tagName) {
              lastTaskSource = 'inbox';
              const centerTitle = document.getElementById('center-title');
              if (centerTitle) centerTitle.textContent = 'Inbox';
              loadInboxTasks();
            } else if (lastTaskSource) refreshTaskList();
          } else {
            alert(data.message || 'Delete failed.');
          }
        } catch (e) {
          alert(e.message || 'Failed to delete tag.');
        }
      });
    }
    if (saveBtn && nameInput) {
      saveBtn.addEventListener('click', async () => {
        const newName = validateTagName(nameInput.value);
        if (!newName) {
          alert('Tag name must be a single word: letters, numbers, underscore or dash only.');
          return;
        }
        if (newName === tagName) return;
        if (!confirm('Rename tag "#' + tagName + '" to "#' + newName + '"? This will update task tags and any #' + tagName + ' in titles/notes.')) return;
        try {
          const res = await api('/api/execute-pending-confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tool: 'tag_rename', old_tag: tagName, new_tag: newName }),
          });
          const data = typeof res === 'object' ? res : {};
          if (data.ok) {
            currentInspectorTag = newName;
            loadTags();
            loadTagDetails(newName);
            if (lastTaskSource === 'tag:' + tagName) {
              lastTaskSource = 'tag:' + newName;
              const centerTitle = document.getElementById('center-title');
              if (centerTitle) centerTitle.textContent = '#' + newName;
              loadTagTasks(newName);
            } else if (lastTaskSource) refreshTaskList();
            const tagLi = tagsListEl && tagsListEl.querySelector(`.nav-item[data-tag="${newName.replace(/"/g, '\\"')}"]`);
            if (tagLi) {
              tagsListEl.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
              tagLi.classList.add('selected');
            }
          } else {
            alert(data.message || 'Rename failed.');
          }
        } catch (e) {
          alert(e.message || 'Failed to rename tag.');
        }
      });
    }
  }

  function onListClick(ev) {
    if (ev.target.closest('.nav-item-actions')) return;
    const li = ev.currentTarget;
    if (li.classList.contains('placeholder')) return;
    currentInspectorTag = null;
    if (inboxItem) inboxItem.classList.remove('selected');
    projectsList.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
    listsListEl.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
    if (tagsListEl) tagsListEl.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
    if (favoritesListEl) favoritesListEl.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
    li.classList.add('selected');
    const id = li.dataset.listId;
    const name = li.dataset.label || 'List';
    lastTaskSource = 'list:' + (id || '');
    document.getElementById('center-title').textContent = name;
    const centerDescListClick = document.getElementById('center-description');
    if (centerDescListClick) centerDescListClick.textContent = '';
    document.getElementById('inspector-title').textContent = 'List';
    document.getElementById('inspector-content').innerHTML = '<p class="placeholder">Loading…</p>';
    updateCenterHeaderForSource();
    if (id) {
      loadListTasks(id);
      loadListDetails(id);
    }
  }
  let hasAppliedDefaultOpenView = false;
  function applyDefaultOpenView() {
    if (hasAppliedDefaultOpenView) return;
    hasAppliedDefaultOpenView = true;
    const v = getDefaultOpenView();
    if (!v || v === 'inbox') {
      if (inboxItem) inboxItem.click();
      return;
    }
    if (v.startsWith('project:')) {
      const id = v.slice(8).trim();
      if (!id) { if (inboxItem) inboxItem.click(); return; }
      const li = projectsList && projectsList.querySelector(`.nav-item[data-type="project"][data-id="${id.replace(/"/g, '\\"')}"]`);
      if (li) {
        li.click();
        return;
      }
    }
    if (v.startsWith('list:')) {
      const id = v.slice(5).trim();
      if (!id) { if (inboxItem) inboxItem.click(); return; }
      const li = listsListEl && listsListEl.querySelector(`.nav-item[data-list-id="${id.replace(/"/g, '\\"')}"]`);
      if (li) {
        li.click();
        return;
      }
    }
    if (inboxItem) inboxItem.click();
  }
  async function onProjectArchive(ev) {
    const li = ev.target.closest('.nav-item[data-type="project"]');
    if (!li || !li.dataset.id) return;
    const name = li.dataset.label || 'Project';
    if (!confirm(`Archive project "${name}"?`)) return;
    try {
      await api(`/api/external/projects/${encodeURIComponent(li.dataset.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      });
      await loadProjects();
    } catch (e) {
      alert(e.message || 'Failed to archive project');
    }
  }
  async function onProjectDelete(ev) {
    const li = ev.target.closest('.nav-item[data-type="project"]');
    if (!li || !li.dataset.id) return;
    const name = li.dataset.label || 'Project';
    if (!confirm(`Delete project "${name}"? This cannot be undone.`)) return;
    try {
      await api(`/api/external/projects/${encodeURIComponent(li.dataset.id)}`, { method: 'DELETE' });
      await loadProjects();
    } catch (e) {
      alert(e.message || 'Failed to delete project');
    }
  }
  async function onListDelete(ev) {
    const li = ev.target.closest('.nav-item[data-type="list"]');
    if (!li || !li.dataset.listId) return;
    const name = li.dataset.label || 'List';
    if (!confirm(`Delete list "${name}"?`)) return;
    try {
      await api(`/api/external/lists/${encodeURIComponent(li.dataset.listId)}`, { method: 'DELETE' });
      await loadListsFromApi();
      if (lastTaskSource === 'list:' + li.dataset.listId) {
        lastTaskSource = '';
        if (inboxItem) inboxItem.click();
      }
    } catch (e) {
      alert(e.message || 'Failed to delete list');
    }
  }
  let navDragState = null;
  function updateDropIndicator(listEl, indicator, dropIndex, items) {
    if (!indicator || !listEl) return;
    const listRect = listEl.getBoundingClientRect();
    let topPx;
    if (items.length === 0) {
      topPx = 0;
    } else if (dropIndex === 0) {
      topPx = items[0].getBoundingClientRect().top - listRect.top + listEl.scrollTop;
    } else if (dropIndex >= items.length) {
      const last = items[items.length - 1];
      const lastBottom = last.getBoundingClientRect().bottom - listRect.top + listEl.scrollTop;
      topPx = Math.max(0, lastBottom - 2);
    } else {
      topPx = items[dropIndex].getBoundingClientRect().top - listRect.top + listEl.scrollTop;
    }
    indicator.style.top = topPx + 'px';
    indicator.style.display = 'block';
  }
  function onNavItemDragStart(ev, kind) {
    if (navDragState) return;
    const li = ev.target.closest('.nav-item');
    if (!li || li.classList.contains('placeholder')) return;
    const listEl = kind === 'project' ? projectsList : kind === 'favorites' ? favoritesListEl : kind === 'board' ? boardsListEl : listsListEl;
    const items = Array.from(listEl.querySelectorAll('.nav-item:not(.placeholder)'));
    const idx = items.indexOf(li);
    if (idx === -1) return;
    li.classList.add('nav-item-dragging');
    const indicator = document.createElement('div');
    indicator.className = 'drop-indicator';
    indicator.style.display = 'none';
    listEl.appendChild(indicator);
    navDragState = { kind, listEl, items, index: idx, li, y0: ev.clientY, indicator, dropIndex: idx };
    function onMove(e) {
      if (!navDragState) return;
      e.preventDefault();
      const y = e.clientY;
      const rect = listEl.getBoundingClientRect();
      const currentItems = Array.from(listEl.querySelectorAll('.nav-item:not(.placeholder)'));
      let dropIndex;
      if (y < rect.top) {
        dropIndex = 0;
      } else if (currentItems.length > 0) {
        const lastItem = currentItems[currentItems.length - 1];
        const lastBottom = lastItem.getBoundingClientRect().bottom;
        const sectionBody = listEl.closest('.nav-section-body');
        const sectionBottom = sectionBody ? sectionBody.getBoundingClientRect().bottom : rect.bottom;
        const bottomZone = 24;
        if (y >= lastBottom - bottomZone || y >= sectionBottom - bottomZone) {
          dropIndex = currentItems.length;
        } else {
          dropIndex = currentItems.findIndex((item) => item.getBoundingClientRect().top + item.offsetHeight / 2 > y);
          if (dropIndex < 0) dropIndex = currentItems.length;
        }
      } else {
        dropIndex = currentItems.length;
      }
      navDragState.dropIndex = dropIndex;
      updateDropIndicator(listEl, navDragState.indicator, dropIndex, currentItems);
    }
    function onUp() {
      if (!navDragState) return;
      const listEl = navDragState.listEl;
      const currentItems = Array.from(listEl.querySelectorAll('.nav-item:not(.placeholder)'));
      const dropIndex = navDragState.dropIndex;
      if (dropIndex >= 0 && dropIndex <= currentItems.length) {
        listEl.insertBefore(navDragState.li, currentItems[dropIndex] || null);
      }
      navDragState.li.classList.remove('nav-item-dragging');
      if (navDragState.indicator && navDragState.indicator.parentNode) navDragState.indicator.remove();
      const items = Array.from(listEl.querySelectorAll('.nav-item:not(.placeholder)'));
      if (navDragState.kind === 'project') {
        const ids = Array.from(listEl.querySelectorAll('.nav-item:not(.placeholder)')).map((el) => el.dataset.id).filter(Boolean);
        saveProjectOrder(ids);
      } else if (navDragState.kind === 'favorites') {
        const favs = Array.from(listEl.querySelectorAll('.nav-item:not(.placeholder)')).map((el) => {
          const type = el.dataset.type;
          const id = type === 'list' ? el.dataset.listId : type === 'board' ? (el.dataset.boardId || el.dataset.id) : type === 'tag' ? (el.dataset.tag || el.dataset.id) : el.dataset.id;
          const label = el.dataset.label || '';
          return { type, id, label };
        }).filter((f) => f.type && f.id);
        saveFavorites(favs);
      } else if (navDragState.kind === 'board') {
        const ids = Array.from(listEl.querySelectorAll('.nav-item:not(.placeholder)')).map((el) => el.dataset.boardId || el.dataset.id).filter(Boolean);
        saveBoardOrder(ids);
      } else {
        const ids = Array.from(listEl.querySelectorAll('.nav-item:not(.placeholder)')).map((el) => el.dataset.listId).filter(Boolean);
        saveListOrder(ids);
        const lists = getLists();
        const ordered = ids.map((id) => lists.find((l) => l.id === id)).filter(Boolean);
        const rest = lists.filter((l) => !ids.includes(l.id));
        listsListCache = ordered.concat(rest);
        loadLists();
      }
      navDragState = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }
  function openListInCenter(listId) {
    const lists = getLists();
    const list = lists.find((l) => l.id === listId);
    if (!list) return;
    if (inboxItem) inboxItem.classList.remove('selected');
    projectsList.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
    listsListEl.querySelectorAll('.nav-item').forEach((x) => {
      x.classList.toggle('selected', x.dataset.listId === listId);
    });
    lastTaskSource = 'list:' + listId;
    document.getElementById('center-title').textContent = list.name || 'List';
    const centerDescOpen = document.getElementById('center-description');
    if (centerDescOpen) centerDescOpen.textContent = '';
    document.getElementById('inspector-title').textContent = 'List';
    document.getElementById('inspector-content').innerHTML = '<p class="placeholder">Loading…</p>';
    updateCenterHeaderForSource();
    loadListTasks(listId);
    loadListDetails(listId);
  }

  const PROJECT_INSPECTOR_KEYS = [
    ['name', 'Name'],
    ['short_id', 'Short ID'],
    ['description', 'Description'],
    ['created_at', 'Created'],
    ['updated_at', 'Updated'],
  ];
  const LIST_INSPECTOR_KEYS = [
    ['name', 'Name'],
    ['short_id', 'Short ID'],
    ['description', 'Description'],
    ['created_at', 'Created'],
    ['updated_at', 'Updated'],
  ];
  const TASK_INSPECTOR_KEYS = [
    ['number', 'Number'],
    ['title', 'Title'],
    ['status', 'Status'],
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

  function escapeHtmlForInspector(s) {
    if (s == null) return '';
    return String(s).replace(/</g, '&lt;').replace(/\n/g, '<br>').replace(/"/g, '&quot;');
  }
  const DATE_INSPECTOR_KEYS = ['due_date', 'available_date'];
  const DATETIME_INSPECTOR_KEYS = ['created_at', 'updated_at', 'completed_at'];

  function formatRecurrenceForDisplay(rec) {
    if (!rec || typeof rec !== 'object') return null;
    const freq = rec.freq || 'daily';
    const interval = rec.interval || 1;
    const parts = [];
    if (interval !== 1) parts.push(`every ${interval}`);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    if (freq === 'weekly' && Array.isArray(rec.by_weekday) && rec.by_weekday.length) {
      const resolved = rec.by_weekday.map((d) => (typeof d === 'number' && d >= 0 && d <= 6 ? dayNames[d] : String(d)));
      parts.push(`Weekly on ${resolved.join(', ')}`);
    } else if (freq === 'monthly') {
      if (rec.monthly_rule === 'day_of_month' && rec.monthly_day != null) parts.push(`Monthly on day ${rec.monthly_day}`);
      else if (rec.monthly_rule === 'weekday_of_month') {
        const w = { 1: 'First', 2: 'Second', 3: 'Third', 4: 'Fourth', 5: 'Last' }[rec.monthly_week];
        const wd = typeof rec.monthly_weekday === 'number' ? dayNames[rec.monthly_weekday] : rec.monthly_weekday;
        parts.push(w && wd ? `Monthly on ${w} ${wd}` : 'Monthly');
      } else parts.push('Monthly');
    } else if (freq === 'yearly' && rec.yearly_month != null && rec.yearly_day != null) {
      const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      parts.push(`Yearly on ${months[rec.yearly_month] || rec.yearly_month}/${rec.yearly_day}`);
    } else parts.push(freq.charAt(0).toUpperCase() + freq.slice(1));
    const end = rec.end_condition || 'never';
    if (end === 'after_count' && rec.end_after_count != null) parts.push(`, ${rec.end_after_count} times`);
    else if (end === 'end_date' && rec.end_date) parts.push(`, until ${rec.end_date}`);
    if (rec.anchor === 'completed') parts.push(' (from completed date)');
    return parts.length ? parts.join(' ') : 'Recurring';
  }

  function formatInspectorValue(key, value) {
    if (value == null || value === '') return null;
    if (key === 'recurrence') return formatRecurrenceForDisplay(value);
    if (key === 'description' || key === 'notes') return escapeHtmlForInspector(value);
    if (Array.isArray(value)) return value.length ? escapeHtmlForInspector(value.join(', ')) : null;
    if (typeof value === 'object') return escapeHtmlForInspector(JSON.stringify(value));
    if (key === 'flagged') return value ? 'Yes' : 'No';
    if (DATETIME_INSPECTOR_KEYS.includes(key)) return formatDateTimeForInspector(value);
    if (DATE_INSPECTOR_KEYS.includes(key)) return formatDate(value);
    return escapeHtmlForInspector(String(value));
  }

  function escapeAttr(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }
  async function loadProjectDetails(projectIdOrShortId) {
    lastSelectedTaskBlocking = null;
    applyBlockingHighlights();
    try {
      const p = await api(`/api/external/projects/${encodeURIComponent(projectIdOrShortId)}`);
      const div = document.getElementById('inspector-content');
      const titleEl = document.getElementById('inspector-title');
      titleEl.textContent = (p.name || '(no name)').trim();
      div.dataset.inspectorProjectId = p.id || '';
      const nameVal = escapeAttr(p.name ?? '');
      const descVal = String(p.description ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const shortId = escapeAttr(p.short_id ?? '');
      const createdVal = p.created_at ? formatDateTimeForInspector(p.created_at) : '—';
      const updatedVal = p.updated_at ? formatDateTimeForInspector(p.updated_at) : '—';
      div.innerHTML = `
        <div class="inspector-content-inner">
          <p><strong>Short ID:</strong> ${shortId || '—'}</p>
          <p><strong>Created:</strong> ${createdVal}</p>
          <p><strong>Updated:</strong> ${updatedVal}</p>
          <div class="setting-row">
            <label for="inspector-project-name"><strong>Name</strong></label>
            <input type="text" id="inspector-project-name" value="${nameVal}" class="inspector-edit-input" />
          </div>
          <div class="setting-row">
            <label for="inspector-project-description"><strong>Description</strong></label>
            <textarea id="inspector-project-description" rows="3" class="inspector-edit-textarea">${descVal}</textarea>
          </div>
        </div>
        <div class="inspector-project-actions">
          <button type="button" id="inspector-project-favorite-toggle" class="inspector-action-btn" title="${isInFavorites('project', p.id) ? 'Remove from favorites' : 'Add to favorites'}" aria-label="${isInFavorites('project', p.id) ? 'Remove from favorites' : 'Add to favorites'}">${isInFavorites('project', p.id) ? INSPECTOR_STAR_PROHIBITED_SVG : INSPECTOR_STAR_ADD_SVG}</button>
          <button type="button" id="inspector-project-archive" class="inspector-action-btn" title="Archive" aria-label="Archive">${INSPECTOR_ARCHIVE_SVG}</button>
          <button type="button" id="inspector-project-delete" class="inspector-action-btn" title="Delete" aria-label="Delete">${INSPECTOR_TRASH_SVG}</button>
          <button type="button" id="inspector-project-save" class="inspector-action-btn inspector-save-action-btn" title="Save" aria-label="Save">${INSPECTOR_SAVE_SVG}</button>
        </div>
      `;
      const pid = p.id;
      const favToggleProjectBtn = document.getElementById('inspector-project-favorite-toggle');
      if (favToggleProjectBtn) {
        favToggleProjectBtn.addEventListener('click', () => {
          if (isInFavorites('project', pid)) {
            removeFromFavorites('project', pid);
          } else {
            addToFavorites('project', pid, p.name || 'Project');
          }
          loadProjects();
          loadProjectDetails(pid);
        });
      }
      const nameInput = document.getElementById('inspector-project-name');
      const descInput = document.getElementById('inspector-project-description');
      document.getElementById('inspector-project-save').addEventListener('click', async () => {
        try {
          await api(`/api/external/projects/${encodeURIComponent(pid)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: (nameInput && nameInput.value) ? nameInput.value.trim() : undefined,
              description: (descInput && descInput.value) ? descInput.value.trim() : undefined,
            }),
          });
          if (titleEl) titleEl.textContent = (nameInput && nameInput.value) ? nameInput.value.trim() : '(no name)';
          loadProjectDetails(pid);
          refreshLeftAndCenter();
        } catch (err) {
          alert(err.message || 'Failed to save project.');
        }
      });
      document.getElementById('inspector-project-archive').addEventListener('click', async () => {
        if (!confirm('Archive this project? It will be hidden from the project list until you unarchive it.')) return;
        try {
          await api(`/api/external/projects/${encodeURIComponent(pid)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'archived' }),
          });
          loadProjects();
          document.getElementById('inspector-title').textContent = 'Inspector';
          document.getElementById('inspector-content').innerHTML = '<p class="placeholder">Select an item to inspect.</p>';
          lastTaskSource = null;
          document.getElementById('center-title').textContent = '';
          const centerDescEl = document.getElementById('center-description');
          if (centerDescEl) centerDescEl.textContent = '';
          document.getElementById('center-content').innerHTML = '<p class="placeholder">Select a project or list.</p>';
        } catch (err) {
          alert(err.message || 'Failed to archive project.');
        }
      });
      document.getElementById('inspector-project-delete').addEventListener('click', async () => {
        if (!confirm('Delete this project? It will be removed from all tasks. This cannot be undone.')) return;
        try {
          await api(`/api/external/projects/${encodeURIComponent(pid)}`, { method: 'DELETE' });
          loadProjects();
          document.getElementById('inspector-title').textContent = 'Inspector';
          document.getElementById('inspector-content').innerHTML = '<p class="placeholder">Select an item to inspect.</p>';
          lastTaskSource = null;
          document.getElementById('center-title').textContent = '';
          const centerDesc = document.getElementById('center-description');
          if (centerDesc) centerDesc.textContent = '';
          document.getElementById('center-content').innerHTML = '<p class="placeholder">Select a project or list.</p>';
        } catch (err) {
          alert(err.message || 'Failed to delete project.');
        }
      });
      const centerDesc = document.getElementById('center-description');
      if (centerDesc && (String(lastTaskSource) === String(p.id) || String(lastTaskSource) === String(p.short_id))) {
        centerDesc.textContent = p.description || '';
      }
    } catch (e) {
      document.getElementById('inspector-title').textContent = 'Inspector';
      document.getElementById('inspector-content').innerHTML = `<p class="placeholder">${e.message || 'Error loading project.'}</p>`;
    }
  }

  async function loadListDetails(listId) {
    lastSelectedTaskBlocking = null;
    applyBlockingHighlights();
    try {
      const lst = await api(`/api/external/lists/${encodeURIComponent(listId)}`);
      const div = document.getElementById('inspector-content');
      const titleEl = document.getElementById('inspector-title');
      titleEl.textContent = (lst.name || '(no name)').trim();
      div.dataset.inspectorListId = lst.id || listId;
      const shortId = escapeAttr(lst.short_id ?? '');
      const createdVal = lst.created_at ? formatDateTimeForInspector(lst.created_at) : '—';
      const updatedVal = lst.updated_at ? formatDateTimeForInspector(lst.updated_at) : '—';
      const nameVal = escapeAttr(lst.name ?? '');
      const descVal = String(lst.description ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const telegramCronVal = escapeAttr((lst.telegram_send_cron ?? '').trim());
      div.innerHTML = `
        <div class="inspector-content-inner">
          <p><strong>Short ID:</strong> ${shortId || '—'}</p>
          <p><strong>Created:</strong> ${createdVal}</p>
          <p><strong>Updated:</strong> ${updatedVal}</p>
          <div class="setting-row">
            <label for="inspector-list-name"><strong>Name</strong></label>
            <input type="text" id="inspector-list-name" value="${nameVal}" class="inspector-edit-input" />
          </div>
          <div class="setting-row">
            <label for="inspector-list-description"><strong>Description</strong></label>
            <textarea id="inspector-list-description" rows="3" class="inspector-edit-textarea">${descVal}</textarea>
          </div>
          <div class="setting-row">
            <label for="inspector-list-telegram-cron"><strong>Send to Telegram (cron)</strong></label>
            <input type="text" id="inspector-list-telegram-cron" value="${telegramCronVal}" class="inspector-edit-input" placeholder="e.g. 0 9 * * * (9am daily)" aria-label="Cron: when to send this list via Telegram" />
          </div>
        </div>
        <div class="inspector-project-actions">
          <button type="button" id="inspector-list-favorite-toggle" class="inspector-action-btn" title="${isInFavorites('list', lst.id || listId) ? 'Remove from favorites' : 'Add to favorites'}" aria-label="${isInFavorites('list', lst.id || listId) ? 'Remove from favorites' : 'Add to favorites'}">${isInFavorites('list', lst.id || listId) ? INSPECTOR_STAR_PROHIBITED_SVG : INSPECTOR_STAR_ADD_SVG}</button>
          <button type="button" id="inspector-list-duplicate" class="inspector-action-btn" title="Duplicate" aria-label="Duplicate">${INSPECTOR_DUPLICATE_SVG}</button>
          <button type="button" id="inspector-list-delete" class="inspector-action-btn" title="Delete" aria-label="Delete">${INSPECTOR_TRASH_SVG}</button>
          <button type="button" id="inspector-list-save" class="inspector-action-btn inspector-save-action-btn" title="Save" aria-label="Save">${INSPECTOR_SAVE_SVG}</button>
        </div>
      `;
      const lid = lst.id || listId;
      const favToggleListBtn = document.getElementById('inspector-list-favorite-toggle');
      if (favToggleListBtn) {
        favToggleListBtn.addEventListener('click', () => {
          if (isInFavorites('list', lid)) {
            removeFromFavorites('list', lid);
          } else {
            addToFavorites('list', lid, lst.name || 'List');
          }
          loadLists();
          loadListDetails(lid);
        });
      }
      const nameInput = document.getElementById('inspector-list-name');
      const descInput = document.getElementById('inspector-list-description');
      const telegramCronInput = document.getElementById('inspector-list-telegram-cron');
      document.getElementById('inspector-list-save').addEventListener('click', async () => {
        try {
          const cronRaw = telegramCronInput && telegramCronInput.value ? telegramCronInput.value.trim() : '';
          await api(`/api/external/lists/${encodeURIComponent(lid)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: (nameInput && nameInput.value) ? nameInput.value.trim() : undefined,
              description: (descInput && descInput.value) ? descInput.value.trim() : undefined,
              telegram_send_cron: cronRaw,
            }),
          });
          if (titleEl) titleEl.textContent = (nameInput && nameInput.value) ? nameInput.value.trim() : '(no name)';
          loadListDetails(lid);
          refreshLeftAndCenter();
        } catch (err) {
          alert(err.message || 'Failed to save list.');
        }
      });
      document.getElementById('inspector-list-delete').addEventListener('click', async () => {
        if (!confirm('Delete this list? This cannot be undone.')) return;
        try {
          await api(`/api/external/lists/${encodeURIComponent(lid)}`, { method: 'DELETE' });
          loadLists();
          document.getElementById('inspector-title').textContent = 'Inspector';
          document.getElementById('inspector-content').innerHTML = '<p class="placeholder">Select an item to inspect.</p>';
          lastTaskSource = null;
          document.getElementById('center-title').textContent = '';
          const centerDescList = document.getElementById('center-description');
          if (centerDescList) centerDescList.textContent = '';
          document.getElementById('center-content').innerHTML = '<p class="placeholder">Select a project or list.</p>';
        } catch (err) {
          alert(err.message || 'Failed to delete list.');
        }
      });
      const centerDescListEl = document.getElementById('center-description');
      if (centerDescListEl && lastTaskSource === 'list:' + (lst.id || listId)) {
        centerDescListEl.textContent = lst.description || '';
      }
      document.getElementById('inspector-list-duplicate').addEventListener('click', () => {
        duplicateListSource = lst;
        if (duplicateListName) duplicateListName.value = (lst.name ? `Copy of ${lst.name}` : 'Copy of list').trim();
        if (duplicateListOverlay) {
          duplicateListOverlay.classList.remove('hidden');
          duplicateListOverlay.setAttribute('aria-hidden', 'false');
          setTimeout(() => duplicateListName && duplicateListName.focus(), 50);
        }
      });
    } catch (e) {
      document.getElementById('inspector-title').textContent = 'Inspector';
      document.getElementById('inspector-content').innerHTML = `<p class="placeholder">${e.message || 'Error loading list.'}</p>`;
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


  async function loadTaskDetails(taskId, opts) {
    currentInspectorTag = null;
    const div = (opts && opts.container) ? opts.container : document.getElementById('inspector-content');
    if (!div) return;
    try {
      const t = await api(`/api/external/tasks/${encodeURIComponent(taskId)}`);
      updateTaskInLists(t, { scheduleRefresh: false });
      if (opts && opts.onTitle != null && t.number != null) opts.onTitle(t.number);
      div.dataset.taskId = taskId;
      const createdVal = t.created_at ? formatDateTimeForInspector(t.created_at) : '—';
      const updatedVal = t.updated_at ? formatDateTimeForInspector(t.updated_at) : '—';
      const completedVal = t.completed_at ? formatDateTimeForInspector(t.completed_at) : null;
      const avDate = (t.available_date || '').toString().trim().substring(0, 10);
      const dueDate = (t.due_date || '').toString().trim().substring(0, 10);
      const avDateAttr = /^\d{4}-\d{2}-\d{2}$/.test(avDate) ? avDate : '';
      const dueDateAttr = /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : '';
      const projectIds = Array.isArray(t.projects) ? t.projects : [];
      const projectShortIds = projectIds.map((id) => projectIdToShortName(id)).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
      const projectsListStr = projectShortIds.join(', ') || '—';
      const statusComplete = isTaskCompleted(t);
      const flagged = t.flagged === true || t.flagged === 1;
      const hasDescription = (t.notes || t.description || '').toString().trim().length > 0;
      const recText = formatRecurrenceForDisplay(t.recurrence);
      const hasRecurrence = !!(t.recurrence && typeof t.recurrence === 'object' && (t.recurrence.freq || t.recurrence.interval));

      const titleVal = (t.title || '').trim();
      let html = '';
      html += `<p class="inspector-label-line"><strong>Created:</strong> ${createdVal}</p>`;
      html += `<p class="inspector-label-line"><strong>Updated:</strong> ${updatedVal}</p>`;
      if (completedVal) html += `<p class="inspector-label-line"><strong>Last completed:</strong> ${completedVal}</p>`;
      html += '<div class="inspector-title-block">';
      html += '<p class="inspector-label-line"><strong>Title</strong></p>';
      html += '<input type="text" class="inspector-edit-input inspector-title-input" value="' + escapeAttr(titleVal) + '" data-task-id="' + escapeAttr(taskId) + '" placeholder="Task title" aria-label="Title" />';
      html += '</div>';

      html += '<p class="inspector-label-line inspector-dates-heading"><strong>Available and due dates</strong></p>';
      html += '<div class="inspector-dates-block">';
      html += `<div class="inspector-date-row inspector-date-available" data-task-id="${escapeAttr(taskId)}" data-date-field="available_date">
        <span class="inspector-date-icon" aria-hidden="true">${CAL_EVENT_SVG}</span>
        <button type="button" class="inspector-date-dropdown-trigger" title="Quick set available date" aria-haspopup="true" aria-label="Available date options">▾</button>
        <input type="date" class="inspector-date-input inspector-date-input-small" value="${escapeAttr(avDateAttr)}" title="Available date" aria-label="Available date" />
      </div>`;
      html += `<div class="inspector-date-row inspector-date-due" data-task-id="${escapeAttr(taskId)}" data-date-field="due_date">
        <span class="inspector-date-icon" aria-hidden="true">${CAL_CHECK_SVG}</span>
        <button type="button" class="inspector-date-dropdown-trigger" title="Quick set due date" aria-haspopup="true" aria-label="Due date options">▾</button>
        <input type="date" class="inspector-date-input inspector-date-input-small" value="${escapeAttr(dueDateAttr)}" title="Due date" aria-label="Due date" />
      </div>`;
      html += '</div>';

      html += '<div class="inspector-actions-row" data-task-id="' + escapeAttr(taskId) + '">';
      html += '<button type="button" class="inspector-action-icon inspector-status-btn" title="' + (statusComplete ? 'Mark incomplete' : 'Mark complete') + '" aria-label="Toggle status">';
      html += statusComplete ? INSPECTOR_STATUS_TICK_SVG : INSPECTOR_STATUS_OPEN_SVG;
      html += '</button>';
      const priorityCls = priorityClass(t.priority);
      html += '<button type="button" class="inspector-action-icon inspector-priority-btn" data-priority-task-id="' + escapeAttr(taskId) + '" title="Priority (click to change)" aria-haspopup="true" aria-label="Priority"><span class="priority-circle-wrap ' + priorityCls + '">' + PRIORITY_CIRCLE_SVG + '</span></button>';
      html += '<button type="button" class="inspector-action-icon inspector-flag-btn' + (flagged ? '' : ' muted') + '" data-flagged="' + (flagged ? '1' : '0') + '" title="' + (flagged ? 'Unflag' : 'Flag') + '" aria-label="Toggle flag">';
      html += '<span class="inspector-flag-star flagged-icon' + (flagged ? '' : ' empty') + '">★</span>';
      html += '</button>';
      html += '<span class="inspector-actions-projects inspector-projects-wrap" data-task-id="' + escapeAttr(taskId) + '" data-projects-json="' + escapeAttr(JSON.stringify(projectIds)) + '">';
      html += '<button type="button" class="inspector-action-icon inspector-projects-btn' + (projectIds.length ? '' : ' muted') + '" title="Add or remove projects" aria-haspopup="true" aria-label="Projects">';
      html += INSPECTOR_PROJECTS_ICON_SVG;
      html += '</button>';
      html += '</span>';
      const taskTags = (t.tags || []).map((x) => String(x).trim()).filter(Boolean);
      html += '<button type="button" class="inspector-action-icon inspector-tags-btn' + (taskTags.length ? '' : ' muted') + '" data-task-id="' + escapeAttr(taskId) + '" data-tags-json="' + escapeAttr(JSON.stringify(taskTags)) + '" title="Assign tags" aria-label="Assign tags">';
      html += INSPECTOR_TAG_SVG;
      html += '</button>';
      html += '<button type="button" class="inspector-action-icon inspector-notes-btn' + (hasDescription ? '' : ' muted') + '" data-description-task-id="' + escapeAttr(taskId) + '" title="Notes / description" aria-label="Edit notes">';
      html += INSPECTOR_DOCUMENT_SVG;
      html += '</button>';
      html += '<button type="button" class="inspector-action-icon inspector-recurrence-btn' + (hasRecurrence ? '' : ' muted') + '" data-task-id="' + escapeAttr(taskId) + '" title="' + (hasRecurrence ? 'Edit recurrence' : 'Set recurrence') + '" aria-label="Recurrence">';
      html += RECURRENCE_ICON_SVG;
      html += '</button>';
      const hasBlockingRel = ((t.depends_on || []).length > 0) || ((t.blocks || []).length > 0);
      html += '<button type="button" class="inspector-action-icon inspector-blocking-btn' + (hasBlockingRel ? '' : ' muted') + '" data-task-id="' + escapeAttr(taskId) + '" title="Blocking" aria-label="Blocking">';
      html += BLOCKING_ICON_SVG;
      html += '</button>';
      html += '<button type="button" class="inspector-action-icon inspector-delete-btn" data-task-id="' + escapeAttr(taskId) + '" title="Delete task" aria-label="Delete">';
      html += INSPECTOR_TRASH_SVG;
      html += '</button>';
      html += '</div>';

      div.innerHTML = '<div class="inspector-content-inner"><div class="inspector-scroll">' + html + '</div><p class="inspector-immediate-note">All changes are applied immediately</p></div>';

      const titleInput = div.querySelector('.inspector-title-input');
      if (titleInput) {
        const saveTitle = () => {
          const newTitle = (titleInput.value || '').trim();
          updateTask(taskId, { title: newTitle || '(no title)' }).then((updated) => {
            if (updated) updateTaskInLists(updated);
            const row = document.querySelector(`.task-row[data-id="${taskId}"]`);
            if (row) {
              const titleCell = row.querySelector('.title-cell .cell-value');
              if (titleCell) titleCell.textContent = newTitle || '(no title)';
            }
          }).catch((err) => console.error(err));
        };
        titleInput.addEventListener('blur', saveTitle);
        titleInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            titleInput.blur();
          }
        });
        attachHashtagAutocomplete(titleInput);
      }

      div.querySelectorAll('.inspector-recurrence-btn').forEach((btn) => {
        btn.addEventListener('click', () => openRecurrenceModal(btn.dataset.taskId));
      });
      div.querySelectorAll('.inspector-blocking-btn').forEach((btn) => {
        btn.addEventListener('click', () => openBlockingModal(btn.dataset.taskId));
      });

      div.querySelectorAll('.inspector-date-row').forEach((row) => {
        const taskIdVal = row.dataset.taskId;
        const field = row.dataset.dateField;
        const input = row.querySelector('input[type="date"]');
        if (input) {
          input.addEventListener('change', () => {
            const v = (input.value || '').trim().substring(0, 10);
            if (v || field) applyTaskDate(taskIdVal, field, v).then(() => loadTaskDetails(taskIdVal, opts));
          });
        }
        row.querySelectorAll('.inspector-date-dropdown-trigger').forEach((trigger) => {
          trigger.addEventListener('click', (ev) => openInspectorDateDropdown(ev, row, () => loadTaskDetails(taskId, opts)));
        });
      });

      const projectsWrap = div.querySelector('.inspector-projects-wrap');
      if (projectsWrap) {
        const trigger = projectsWrap.querySelector('.inspector-projects-btn');
        if (trigger) {
          trigger.addEventListener('click', (ev) => {
            openProjectsDropdown(ev, projectsWrap, {
              taskId,
              currentIds: projectIds,
              anchorEl: trigger,
              onAfterApply: () => loadTaskDetails(taskId, opts),
            });
          });
        }
      }

      div.querySelectorAll('.inspector-status-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const newStatus = isTaskCompleted(t) ? 'incomplete' : 'complete';
          updateTask(taskId, { status: newStatus }).then((updated) => {
            updateTaskInLists(updated);
            loadTaskDetails(taskId, opts);
          }).catch((err) => console.error(err));
        });
      });
      div.querySelectorAll('.inspector-priority-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => openPriorityDropdown(e, btn, { onAfterApply: () => loadTaskDetails(taskId, opts) }));
      });
      div.querySelectorAll('.inspector-flag-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          updateTask(taskId, { flagged: !flagged }).then((updated) => {
            updateTaskInLists(updated);
            loadTaskDetails(taskId, opts);
          }).catch((err) => console.error(err));
        });
      });
      div.querySelectorAll('.inspector-tags-btn').forEach((btn) => {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          openTaskTagsDropdown(ev, btn, { taskId: btn.dataset.taskId, currentTags: JSON.parse(btn.dataset.tagsJson || '[]'), onAfterApply: () => loadTaskDetails(taskId, opts) });
        });
      });
      div.querySelectorAll('.inspector-notes-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const fakeCell = { dataset: { descriptionTaskId: taskId } };
          openDescriptionModal({ stopPropagation: () => {} }, fakeCell);
        });
      });
      div.querySelectorAll('.inspector-delete-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.taskId;
          if (!id) return;
          if (!confirm('Delete this task? This cannot be undone.')) return;
          try {
            await api(`/api/external/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
            if (opts && opts.boardId) {
              const cards = getBoardCards(opts.boardId).filter((c) => String(c.taskId) !== String(id));
              setBoardCards(opts.boardId, cards);
            }
            if (opts && opts.onClose) opts.onClose();
            document.getElementById('inspector-title').textContent = 'Inspector';
            const mainInspector = document.getElementById('inspector-content');
            if (mainInspector) mainInspector.innerHTML = '<div class="inspector-content-inner"><p class="placeholder">Select an item to inspect.</p></div>';
            refreshTaskList();
            scheduleRefreshAfterTaskChange();
          } catch (err) {
            alert(err.message || 'Failed to delete task.');
          }
        });
      });
      const isMainInspector = !opts || !opts.container;
      if (isMainInspector) {
        lastSelectedTaskBlocking = {
          depends_on: (t.depends_on || []).map(String),
          blocks: (t.blocks || []).map(String),
        };
        applyBlockingHighlights();
      }
    } catch (e) {
      const mainDiv = document.getElementById('inspector-content');
      if (mainDiv) mainDiv.innerHTML = `<div class="inspector-content-inner"><p class="placeholder">${e.message || 'Error'}</p></div>`;
      if (!opts || !opts.container) {
        lastSelectedTaskBlocking = null;
        applyBlockingHighlights();
      }
    }
  }

  // --- Chat ---
  function appendChatMessage(role, text) {
    hideTypingIndicator();
    const wrap = document.createElement('div');
    wrap.className = `chat-message ${role}`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    const str = String(text ?? '');
    if (role === 'model' && /<[a-z][\s\S]*>/i.test(str)) {
      bubble.classList.add('chat-bubble-html');
      bubble.innerHTML = str;
    } else {
      const escaped = str.replace(/</g, '&lt;').replace(/\n/g, '<br>');
      bubble.innerHTML = `<span class="text">${escaped}</span>`;
    }
    wrap.appendChild(bubble);
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

  // --- Panel and chat resize: create handles in JS (position: fixed, thin strip, same look/feel) ---
  const HANDLE_WIDTH = 6;
  const HANDLE_HEIGHT = 6;
  const MIN_INSPECTOR = 80;
  const MIN_CHAT = 120;
  let leftPanelResizeHandleEl = null;
  let rightPanelResizeHandleEl = null;
  let chatResizeHandleEl = null;

  function positionPanelResizeHandles() {
    if (!mainArea || !leftPanel || !rightPanel) return;
    const leftCollapsed = leftPanel.classList.contains('collapsed');
    const rightCollapsed = rightPanel.classList.contains('collapsed');
    if (leftPanelResizeHandleEl) {
      leftPanelResizeHandleEl.style.display = leftCollapsed ? 'none' : '';
      if (!leftCollapsed) {
        const r = leftPanel.getBoundingClientRect();
        leftPanelResizeHandleEl.style.left = (r.right - HANDLE_WIDTH / 2) + 'px';
        leftPanelResizeHandleEl.style.width = HANDLE_WIDTH + 'px';
        leftPanelResizeHandleEl.style.top = r.top + 'px';
        leftPanelResizeHandleEl.style.height = (r.bottom - r.top) + 'px';
      }
    }
    if (rightPanelResizeHandleEl) {
      rightPanelResizeHandleEl.style.display = rightCollapsed ? 'none' : '';
      if (!rightCollapsed) {
        const r = rightPanel.getBoundingClientRect();
        rightPanelResizeHandleEl.style.left = (r.left - HANDLE_WIDTH / 2) + 'px';
        rightPanelResizeHandleEl.style.width = HANDLE_WIDTH + 'px';
        rightPanelResizeHandleEl.style.top = r.top + 'px';
        rightPanelResizeHandleEl.style.height = (r.bottom - r.top) + 'px';
      }
    }
    if (chatResizeHandleEl && inspectorContent) {
      chatResizeHandleEl.style.display = rightCollapsed ? 'none' : '';
      if (!rightCollapsed) {
        const panelR = rightPanel.getBoundingClientRect();
        const inspectorR = inspectorContent.getBoundingClientRect();
        // Place handle entirely below inspector so it doesn't cover inspector buttons (e.g. Save).
        chatResizeHandleEl.style.left = panelR.left + 'px';
        chatResizeHandleEl.style.width = (panelR.right - panelR.left) + 'px';
        chatResizeHandleEl.style.top = inspectorR.bottom + 'px';
        chatResizeHandleEl.style.height = HANDLE_HEIGHT + 'px';
      }
    }
  }

  function createPanelResizeHandles() {
    if (!mainArea || !leftPanel || !rightPanel) return;
    // Restore saved panel widths here so layout is correct before we position handles (same pattern as inspector height).
    try {
      const savedLeft = localStorage.getItem(LEFT_PANEL_WIDTH_KEY);
      if (savedLeft != null && savedLeft !== '') {
        const px = parseInt(savedLeft, 10);
        if (Number.isFinite(px) && px >= MIN_LEFT_PANEL_WIDTH && px <= MAX_LEFT_PANEL_WIDTH) {
          mainArea.style.setProperty('--left-panel-width', `${px}px`);
        }
      }
      const savedRight = localStorage.getItem(RIGHT_PANEL_WIDTH_KEY);
      if (savedRight != null && savedRight !== '') {
        const px = parseInt(savedRight, 10);
        if (Number.isFinite(px) && px >= MIN_RIGHT_PANEL_WIDTH && px <= MAX_RIGHT_PANEL_WIDTH) {
          mainArea.style.setProperty('--right-panel-width', `${px}px`);
        }
      }
    } catch (_) {}
    // Force reflow so getBoundingClientRect() in positionPanelResizeHandles sees restored widths
    if (leftPanel) void leftPanel.offsetWidth;
    if (rightPanel) void rightPanel.offsetWidth;
    const style = document.createElement('style');
    style.textContent = `
      .panel-resize-handle-vertical,
      .panel-resize-handle-horizontal {
        position: fixed;
        z-index: 2147483647;
        pointer-events: auto;
        user-select: none;
        -webkit-user-select: none;
        margin: 0;
        padding: 0;
      }
      .panel-resize-handle-vertical { cursor: ew-resize; }
      .panel-resize-handle-horizontal { cursor: ns-resize; }
      .panel-resize-handle-vertical:hover,
      .panel-resize-handle-horizontal:hover { background: rgba(37, 99, 235, 0.12); }
    `;
    document.head.appendChild(style);

    leftPanelResizeHandleEl = document.createElement('div');
    leftPanelResizeHandleEl.id = 'left-panel-resize-handle';
    leftPanelResizeHandleEl.className = 'panel-resize-handle-vertical';
    leftPanelResizeHandleEl.title = 'Drag to resize';
    leftPanelResizeHandleEl.setAttribute('aria-label', 'Resize left panel');
    leftPanelResizeHandleEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth = leftPanel.getBoundingClientRect().width;
      const onMove = (e2) => {
        const dx = e2.clientX - startX;
        let newW = Math.round(startWidth + dx);
        newW = Math.max(MIN_LEFT_PANEL_WIDTH, Math.min(MAX_LEFT_PANEL_WIDTH, newW));
        mainArea.style.setProperty('--left-panel-width', `${newW}px`);
        positionPanelResizeHandles();
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const w = leftPanel.getBoundingClientRect().width;
        if (Number.isFinite(w) && w >= MIN_LEFT_PANEL_WIDTH) {
          try { localStorage.setItem(LEFT_PANEL_WIDTH_KEY, String(Math.round(w))); } catch (_) {}
        }
        positionPanelResizeHandles();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    document.body.appendChild(leftPanelResizeHandleEl);

    rightPanelResizeHandleEl = document.createElement('div');
    rightPanelResizeHandleEl.id = 'right-panel-resize-handle';
    rightPanelResizeHandleEl.className = 'panel-resize-handle-vertical';
    rightPanelResizeHandleEl.title = 'Drag to resize';
    rightPanelResizeHandleEl.setAttribute('aria-label', 'Resize right panel');
    rightPanelResizeHandleEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth = rightPanel.getBoundingClientRect().width;
      const onMove = (e2) => {
        const dx = e2.clientX - startX;
        let newW = Math.round(startWidth - dx);
        newW = Math.max(MIN_RIGHT_PANEL_WIDTH, Math.min(MAX_RIGHT_PANEL_WIDTH, newW));
        mainArea.style.setProperty('--right-panel-width', `${newW}px`);
        positionPanelResizeHandles();
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const w = rightPanel.getBoundingClientRect().width;
        if (Number.isFinite(w) && w >= MIN_RIGHT_PANEL_WIDTH) {
          try { localStorage.setItem(RIGHT_PANEL_WIDTH_KEY, String(Math.round(w))); } catch (_) {}
        }
        positionPanelResizeHandles();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    document.body.appendChild(rightPanelResizeHandleEl);

    if (inspectorContent) {
      chatResizeHandleEl = document.createElement('div');
      chatResizeHandleEl.id = 'chat-resize-handle';
      chatResizeHandleEl.className = 'panel-resize-handle-horizontal';
      chatResizeHandleEl.title = 'Drag to resize';
      chatResizeHandleEl.setAttribute('aria-label', 'Resize chat');
      chatResizeHandleEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const dragStartY = e.clientY;
        const dragStartHeight = inspectorContent.getBoundingClientRect().height;
        const onMove = (e2) => {
          const dy = e2.clientY - dragStartY;
          const panelRect = rightPanel.getBoundingClientRect();
          const newH = Math.max(MIN_INSPECTOR, Math.min(panelRect.height - MIN_CHAT, dragStartHeight + dy));
          rightPanel.style.setProperty('--inspector-height', `${newH}px`);
          positionPanelResizeHandles();
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          const h = inspectorContent.getBoundingClientRect().height;
          if (typeof h === 'number' && h >= MIN_INSPECTOR) {
            try { localStorage.setItem(INSPECTOR_HEIGHT_KEY, String(Math.round(h))); } catch (_) {}
          }
          positionPanelResizeHandles();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
      document.body.appendChild(chatResizeHandleEl);
    }

    positionPanelResizeHandles();
    window.addEventListener('resize', positionPanelResizeHandles);
    // Defer reposition until after layout has settled (fixes wrong position on first load).
    requestAnimationFrame(() => {
      requestAnimationFrame(positionPanelResizeHandles);
    });
    window.addEventListener('load', () => requestAnimationFrame(positionPanelResizeHandles));
    // Delayed fallbacks for slow layout (e.g. Electron window restore, fonts).
    setTimeout(positionPanelResizeHandles, 50);
    setTimeout(positionPanelResizeHandles, 200);
    // Reposition when main area or panels actually get their size (most reliable for first paint).
    if (mainArea && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => positionPanelResizeHandles());
      ro.observe(mainArea);
      if (leftPanel) ro.observe(leftPanel);
      if (rightPanel) ro.observe(rightPanel);
    }
  }

  function attachPanelResizeHandles() {
    createPanelResizeHandles();
    if (mainArea && leftPanel && rightPanel) {
      const mo = new MutationObserver(() => positionPanelResizeHandles());
      mo.observe(leftPanel, { attributes: true, attributeFilter: ['class'] });
      mo.observe(rightPanel, { attributes: true, attributeFilter: ['class'] });
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachPanelResizeHandles);
  } else {
    attachPanelResizeHandles();
  }

  // --- Display settings button & dropdown (or list filter/sort modal when viewing a list) ---
  const displaySettingsBtn = document.getElementById('display-settings-btn');
  const displayDropdown = document.getElementById('display-settings-dropdown');
  if (displaySettingsBtn && displayDropdown) {
    displaySettingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isList = lastTaskSource && lastTaskSource.startsWith('list:');
      if (isList) {
        const listId = lastTaskSource.slice(5);
        if (listId) openListSettingsModal(listId);
        return;
      }
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

  // --- List filter & sort modal (when viewing a list) ---
  const LIST_FILTER_FIELDS = [
    { field: 'title', label: 'Title', valueType: 'text', operators: [
      { op: 'contains', label: 'contains' }, { op: 'equals', label: 'equals' }, { op: 'starts_with', label: 'starts with' }, { op: 'ends_with', label: 'ends with' }, { op: 'not_contains', label: 'does not contain' }
    ]},
    { field: 'status', label: 'Status', valueType: 'status', operators: [{ op: 'equals', label: 'is' }] },
    { field: 'due_date', label: 'Due date', valueType: 'date', operators: [
      { op: 'is_empty', label: 'is empty' }, { op: 'is_on', label: 'is on' }, { op: 'is_before', label: 'is before' }, { op: 'is_after', label: 'is after' }, { op: 'is_on_or_before', label: 'on or before' }, { op: 'is_on_or_after', label: 'on or after' }
    ]},
    { field: 'available_date', label: 'Available date', valueType: 'date', operators: [
      { op: 'is_empty', label: 'is empty' }, { op: 'is_on', label: 'is on' }, { op: 'is_before', label: 'is before' }, { op: 'is_after', label: 'is after' }, { op: 'is_on_or_before', label: 'on or before' }, { op: 'is_on_or_after', label: 'on or after' }
    ]},
    { field: 'completed_at', label: 'Completed date', valueType: 'date', operators: [
      { op: 'is_empty', label: 'is empty' }, { op: 'is_on', label: 'is on' }, { op: 'is_before', label: 'is before' }, { op: 'is_after', label: 'is after' }, { op: 'is_on_or_before', label: 'on or before' }, { op: 'is_on_or_after', label: 'on or after' }
    ]},
    { field: 'priority', label: 'Priority', valueType: 'number', operators: [
      { op: 'equals', label: 'equals' }, { op: 'greater_than', label: '>' }, { op: 'less_than', label: '<' }, { op: 'greater_or_equal', label: '>=' }, { op: 'less_or_equal', label: '<=' }
    ]},
    { field: 'flagged', label: 'Focused', valueType: 'flagged', operators: [{ op: 'equals', label: 'is' }] },
    { field: 'blocked', label: 'Blocked', valueType: 'blocked', operators: [{ op: 'equals', label: 'is' }] },
    { field: 'tags', label: 'Tags', valueType: 'tags', operators: [{ op: 'is_empty', label: 'has no tags' }, { op: 'includes', label: 'is tagged' }, { op: 'excludes', label: 'is not tagged' }] },
    { field: 'project', label: 'Project', valueType: 'projects', operators: [{ op: 'is_empty', label: 'is empty' }, { op: 'includes', label: 'is in' }, { op: 'excludes', label: 'is not in' }] },
  ];
  const LIST_SORT_FIELDS = [
    { key: 'due_date', label: 'Due date' }, { key: 'available_date', label: 'Available date' }, { key: 'completed_at', label: 'Completed date' }, { key: 'created_at', label: 'Created' }, { key: 'title', label: 'Name' }, { key: 'priority', label: 'Priority' }, { key: 'status', label: 'Status' }
  ];
  let currentListSettingsListId = null;
  let lastSelectedTaskBlocking = null;

  function applyBlockingHighlights() {
    const center = document.getElementById('center-content');
    if (!center) return;
    const rows = center.querySelectorAll('.task-row');
    rows.forEach((row) => {
      row.classList.remove('blocking-selected', 'blocked-by-selected');
    });
    if (lastSelectedTaskBlocking) {
      const depSet = new Set((lastSelectedTaskBlocking.depends_on || []).map(String));
      const blocksSet = new Set((lastSelectedTaskBlocking.blocks || []).map(String));
      rows.forEach((row) => {
        const id = row.dataset.id;
        if (!id) return;
        if (depSet.has(id)) row.classList.add('blocking-selected');
        if (blocksSet.has(id)) row.classList.add('blocked-by-selected');
      });
    }
  }

  function syncDatePickerFromText(row) {
    const dateInput = row && row.querySelector('.list-filter-date-picker');
    const textInput = row && row.querySelector('.list-filter-value');
    const dateBtn = row && row.querySelector('.date-picker-btn');
    if (!dateInput || !textInput || textInput.tagName !== 'INPUT') return;
    const hasText = (textInput.value || '').trim() !== '';
    if (hasText) dateInput.value = '';
    dateInput.disabled = hasText;
    if (dateBtn) dateBtn.disabled = hasText;
    dateInput.classList.toggle('date-picker-disabled-by-text', hasText);
    if (dateBtn) dateBtn.classList.toggle('date-picker-disabled-by-text', hasText);
  }

  function bindDatePickerInRow(row) {
    const dateInput = row && row.querySelector('.list-filter-date-picker');
    const textInput = row && row.querySelector('.list-filter-value');
    const dateBtn = row && row.querySelector('.date-picker-btn');
    if (dateInput && textInput) {
      dateInput.onchange = () => { textInput.value = dateInput.value || ''; syncDatePickerFromText(row); };
      if (dateBtn) dateBtn.onclick = () => { dateInput.showPicker ? dateInput.showPicker() : dateInput.focus(); };
      textInput.oninput = () => syncDatePickerFromText(row);
      textInput.onchange = () => syncDatePickerFromText(row);
      syncDatePickerFromText(row);
    }
  }

  function listSettingsConditionToRow(cond) {
    const f = LIST_FILTER_FIELDS.find((x) => x.field === (cond && cond.field));
    const fieldConfig = f || LIST_FILTER_FIELDS[0];
    const op = (cond && cond.operator) || (fieldConfig.operators[0] && fieldConfig.operators[0].op);
    const value = cond && cond.value;
    const valueStr = value === undefined || value === null ? '' : (Array.isArray(value) ? value.join(', ') : String(value));
    const opOpts = fieldConfig.operators.map((o) => `<option value="${o.op}" ${o.op === op ? 'selected' : ''}>${o.label}</option>`).join('');
    const fieldOpts = LIST_FILTER_FIELDS.map((x) => `<option value="${x.field}" ${x.field === fieldConfig.field ? 'selected' : ''}>${x.label}</option>`).join('');
    const isDate = fieldConfig.valueType === 'date';
    const valueHtml = isDate
      ? `<div class="filter-value-wrap"><input type="text" class="list-filter-value" placeholder="e.g. today, today+3" value="${(valueStr || '').replace(/"/g, '&quot;')}" /><input type="date" class="list-filter-date-picker" title="Pick date" /><button type="button" class="date-picker-btn" aria-label="Pick date">Date</button></div>`
      : fieldConfig.valueType === 'status'
        ? `<div class="filter-value-wrap"><select class="list-filter-value"><option value="incomplete" ${valueStr === 'incomplete' ? 'selected' : ''}>Incomplete</option><option value="complete" ${valueStr === 'complete' ? 'selected' : ''}>Complete</option></select></div>`
        : fieldConfig.valueType === 'flagged' || fieldConfig.valueType === 'blocked'
          ? `<div class="filter-value-wrap"><select class="list-filter-value"><option value="false" ${valueStr === 'false' || valueStr === '0' ? 'selected' : ''}>No</option><option value="true" ${valueStr === 'true' || valueStr === '1' ? 'selected' : ''}>Yes</option></select></div>`
          : `<div class="filter-value-wrap"><input type="text" class="list-filter-value" placeholder="${fieldConfig.valueType === 'tags' ? 'e.g. work, urgent' : fieldConfig.valueType === 'projects' ? 'comma-separated short ids, e.g. 1off, work' : fieldConfig.valueType === 'number' ? '0-3' : 'value'}" value="${(valueStr || '').replace(/"/g, '&quot;')}" /></div>`;
    return `<div class="list-settings-filter-row" data-field="${fieldConfig.field}">
      <select class="list-filter-field" aria-label="Field">${fieldOpts}</select>
      <select class="list-filter-op" aria-label="Operator">${opOpts}</select>
      ${valueHtml}
      <button type="button" class="list-settings-remove" aria-label="Remove">×</button>
    </div>`;
  }

  function renderFilterGroup(groupNode, isRoot) {
    const operator = (groupNode && groupNode.operator) || 'AND';
    const children = (groupNode && groupNode.children) || [];
    const childrenHtml = children.map((c) => {
      if (c && c.type === 'group') return renderFilterGroup(c, false);
      return listSettingsConditionToRow(c && c.type === 'condition' ? c : {});
    }).join('');
    const removeBtn = isRoot ? '' : '<button type="button" class="list-settings-remove list-settings-group-remove" aria-label="Remove group">×</button>';
    return `<div class="list-settings-filter-group" data-operator="${operator}">
      <div class="list-settings-group-header">
        <select class="list-settings-group-operator" aria-label="Combine with">
          <option value="AND" ${operator === 'AND' ? 'selected' : ''}>and</option>
          <option value="OR" ${operator === 'OR' ? 'selected' : ''}>or</option>
        </select>
        <span class="muted" style="font-size:12px;">${isRoot ? 'Match all of the following' : 'group'}</span>
        ${removeBtn}
      </div>
      <div class="list-settings-group-children">${childrenHtml}</div>
      <div class="list-settings-group-actions">
        <button type="button" class="btn-secondary btn-sm list-settings-add-condition" aria-label="Add condition">Add condition</button>
        <button type="button" class="btn-secondary btn-sm list-settings-add-group" aria-label="Add group">Add group</button>
      </div>
    </div>`;
  }

  function listSettingsSortToRow(s) {
    const field = (s && s.field) || 'due_date';
    const direction = (s && s.direction) || 'asc';
    const fieldOpts = LIST_SORT_FIELDS.map((x) => `<option value="${x.key}" ${x.key === field ? 'selected' : ''}>${x.label}</option>`).join('');
    return `<div class="list-settings-sort-row">
      <button type="button" class="list-sort-move list-sort-move-up" aria-label="Move up">↑</button>
      <button type="button" class="list-sort-move list-sort-move-down" aria-label="Move down">↓</button>
      <select class="list-sort-field" aria-label="Sort by">${fieldOpts}</select>
      <select class="list-sort-dir" aria-label="Direction">
        <option value="asc" ${direction === 'asc' ? 'selected' : ''}>Asc</option>
        <option value="desc" ${direction === 'desc' ? 'selected' : ''}>Desc</option>
      </select>
      <button type="button" class="list-settings-remove" aria-label="Remove">×</button>
    </div>`;
  }

  function openListSettingsModal(listId) {
    currentListSettingsListId = listId;
    const overlay = document.getElementById('list-settings-overlay');
    const filtersEl = document.getElementById('list-settings-filters');
    const columnsEl = document.getElementById('list-settings-columns');
    const sortEl = document.getElementById('list-settings-sort');
    if (!overlay || !filtersEl || !sortEl) return;
    (async () => {
      try {
        const list = await api(`/api/external/lists/${encodeURIComponent(listId)}`);
        const qd = list && list.query_definition;
        const sd = list && list.sort_definition;
        let rootGroup;
        if (qd && qd.type === 'group' && Array.isArray(qd.children)) {
          rootGroup = qd;
        } else if (qd && qd.type === 'condition') {
          rootGroup = { type: 'group', operator: 'AND', children: [qd] };
        } else if (qd && qd.type === 'group') {
          rootGroup = { type: 'group', operator: qd.operator || 'AND', children: qd.children || [] };
        } else {
          rootGroup = { type: 'group', operator: 'AND', children: [] };
        }
        filtersEl.innerHTML = renderFilterGroup(rootGroup, true);
        const sortWithin = (sd && Array.isArray(sd.sort_within_group)) ? sd.sort_within_group : [];
        sortEl.innerHTML = sortWithin.length ? sortWithin.map((s) => listSettingsSortToRow(s)).join('') : listSettingsSortToRow({});
      } catch (_) {
        filtersEl.innerHTML = renderFilterGroup({ type: 'group', operator: 'AND', children: [] }, true);
        sortEl.innerHTML = listSettingsSortToRow({});
      }
      filtersEl.querySelectorAll('.list-settings-filter-row').forEach(bindDatePickerInRow);
      const source = 'list:' + listId;
      const { order, visible, showFlagged, showCompleted, showHighlightDue, showPriority } = getDisplayProperties(source);
      const flaggedCb = document.getElementById('list-settings-show-flagged');
      const completedCb = document.getElementById('list-settings-show-completed');
      const highlightDueCb = document.getElementById('list-settings-show-highlight-due');
      const priorityCb = document.getElementById('list-settings-show-priority');
      if (flaggedCb) flaggedCb.checked = showFlagged;
      if (completedCb) completedCb.checked = showCompleted;
      if (highlightDueCb) highlightDueCb.checked = showHighlightDue;
      if (priorityCb) priorityCb.checked = showPriority;
      const allOrdered = [...order];
      TASK_PROPERTY_KEYS.forEach((k) => { if (!allOrdered.includes(k)) allOrdered.push(k); });
      const dragHandleSvg = '<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M22 6C22.5523 6 23 6.44772 23 7C23 7.55229 22.5523 8 22 8H2C1.44772 8 1 7.55228 1 7C1 6.44772 1.44772 6 2 6L22 6Z"/><path d="M22 11C22.5523 11 23 11.4477 23 12C23 12.5523 22.5523 13 22 13H2C1.44772 13 1 12.5523 1 12C1 11.4477 1.44772 11 2 11H22Z"/><path d="M23 17C23 16.4477 22.5523 16 22 16H2C1.44772 16 1 16.4477 1 17C1 17.5523 1.44772 18 2 18H22C22.5523 18 23 17.5523 23 17Z"/></svg>';
      if (columnsEl) {
        columnsEl.innerHTML = allOrdered.map((key) => {
          const label = TASK_PROPERTY_LABELS[key] || key;
          const checked = visible.has(key);
          return `<li class="list-settings-column-row" data-key="${key}">
            <span class="drag-handle" aria-label="Drag to reorder">${dragHandleSvg}</span>
            <input type="checkbox" id="list-col-${key}" ${checked ? 'checked' : ''}>
            <label for="list-col-${key}">${label}</label>
          </li>`;
        }).join('');
      }
      setupListSettingsModalHandlers();
      overlay.classList.remove('hidden');
      overlay.setAttribute('aria-hidden', 'false');
    })();
  }

  function setupListSettingsModalHandlers() {
    const filtersEl = document.getElementById('list-settings-filters');
    const columnsEl = document.getElementById('list-settings-columns');
    const sortEl = document.getElementById('list-settings-sort');
    const addSortBtn = document.getElementById('list-settings-add-sort');
    if (!filtersEl || !sortEl) return;
    const listId = currentListSettingsListId;
    const listSource = listId ? 'list:' + listId : null;

    if (!filtersEl._listSettingsDelegationBound) {
      filtersEl._listSettingsDelegationBound = true;
      filtersEl.addEventListener('click', (e) => {
        const removeBtn = e.target.closest('.list-settings-remove');
        if (removeBtn) {
          if (removeBtn.classList.contains('list-settings-group-remove')) {
            removeBtn.closest('.list-settings-filter-group').remove();
          } else {
            removeBtn.closest('.list-settings-filter-row').remove();
          }
          return;
        }
        const addCondBtn = e.target.closest('.list-settings-add-condition');
        if (addCondBtn) {
          const group = addCondBtn.closest('.list-settings-filter-group');
          const children = group && group.querySelector('.list-settings-group-children');
          if (children) {
            const div = document.createElement('div');
            div.innerHTML = listSettingsConditionToRow({});
            const newRow = div.firstElementChild;
            children.appendChild(newRow);
            bindDatePickerInRow(newRow);
          }
          return;
        }
        const addGroupBtn = e.target.closest('.list-settings-add-group');
        if (addGroupBtn) {
          const group = addGroupBtn.closest('.list-settings-filter-group');
          const children = group && group.querySelector('.list-settings-group-children');
          if (children) {
            const div = document.createElement('div');
            div.innerHTML = renderFilterGroup({ type: 'group', operator: 'AND', children: [] }, false);
            children.appendChild(div.firstElementChild);
          }
          return;
        }
      });
      filtersEl.addEventListener('change', (e) => {
        const fieldSelect = e.target.closest('.list-filter-field');
        if (!fieldSelect) return;
        const row = fieldSelect.closest('.list-settings-filter-row');
        if (!row) return;
        const f = LIST_FILTER_FIELDS.find((x) => x.field === fieldSelect.value);
        const valueWrap = row.querySelector('.filter-value-wrap');
        const opSelect = row.querySelector('.list-filter-op');
        if (!valueWrap || !opSelect || !f) return;
        const opOpts = f.operators.map((o) => `<option value="${o.op}">${o.label}</option>`).join('');
        opSelect.innerHTML = opOpts;
        const isDate = f.valueType === 'date';
        const newValueHtml = isDate
          ? `<input type="text" class="list-filter-value" placeholder="e.g. today, today+3" /><input type="date" class="list-filter-date-picker" title="Pick date" /><button type="button" class="date-picker-btn" aria-label="Pick date">Date</button>`
            : f.valueType === 'status'
            ? `<select class="list-filter-value"><option value="incomplete">Incomplete</option><option value="complete">Complete</option></select>`
            : f.valueType === 'flagged' || f.valueType === 'blocked'
              ? `<select class="list-filter-value"><option value="false">No</option><option value="true">Yes</option></select>`
              : `<input type="text" class="list-filter-value" placeholder="${f.valueType === 'tags' ? 'e.g. work, urgent' : f.valueType === 'projects' ? 'short ids: 1off, work' : f.valueType === 'number' ? '0-3' : 'value'}" />`;
        valueWrap.innerHTML = newValueHtml;
        bindDatePickerInRow(row);
      });
    }

    if (!sortEl._listSettingsDelegationBound) {
      sortEl._listSettingsDelegationBound = true;
      sortEl.addEventListener('click', (e) => {
        const row = e.target.closest('.list-settings-sort-row');
        if (!row) return;
        if (e.target.closest('.list-settings-remove')) {
          row.remove();
          return;
        }
        if (e.target.closest('.list-sort-move-up')) {
          const prev = row.previousElementSibling;
          if (prev) sortEl.insertBefore(row, prev);
          return;
        }
        if (e.target.closest('.list-sort-move-down')) {
          const next = row.nextElementSibling;
          if (next) sortEl.insertBefore(next, row);
          return;
        }
      });
    }

    if (addSortBtn && !addSortBtn._listSettingsAddBound) {
      addSortBtn._listSettingsAddBound = true;
      addSortBtn.onclick = () => {
        const div = document.createElement('div');
        div.innerHTML = listSettingsSortToRow({});
        sortEl.appendChild(div.firstElementChild);
      };
    }

    if (columnsEl && listSource) {
      const flaggedCb = document.getElementById('list-settings-show-flagged');
      const completedCb = document.getElementById('list-settings-show-completed');
      const highlightDueCb = document.getElementById('list-settings-show-highlight-due');
      if (flaggedCb) {
        flaggedCb.onchange = () => {
          const { order: o, visible: v, showCompleted: sc, showHighlightDue: sh, showPriority: sp } = getDisplayProperties(listSource);
          saveDisplayProperties(listSource, o, v, flaggedCb.checked, sc, sh, sp);
          if (lastTaskSource === listSource) refreshTaskList();
        };
      }
      if (completedCb) {
        completedCb.onchange = () => {
          const { order: o, visible: v, showFlagged: sf, showHighlightDue: sh, showPriority: sp } = getDisplayProperties(listSource);
          saveDisplayProperties(listSource, o, v, sf, completedCb.checked, sh, sp);
          if (lastTaskSource === listSource) refreshTaskList();
        };
      }
      if (highlightDueCb) {
        highlightDueCb.onchange = () => {
          const { order: o, visible: v, showFlagged: sf, showCompleted: sc, showPriority: sp } = getDisplayProperties(listSource);
          saveDisplayProperties(listSource, o, v, sf, sc, highlightDueCb.checked, sp);
          if (lastTaskSource === listSource) refreshTaskList();
        };
      }
      const priorityCb = document.getElementById('list-settings-show-priority');
      if (priorityCb) {
        priorityCb.onchange = () => {
          const { order: o, visible: v, showFlagged: sf, showCompleted: sc, showHighlightDue: sh } = getDisplayProperties(listSource);
          saveDisplayProperties(listSource, o, v, sf, sc, sh, priorityCb.checked);
          if (lastTaskSource === listSource) refreshTaskList();
        };
      }
      columnsEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        cb.addEventListener('change', (e) => {
          const key = e.target.id.replace('list-col-', '');
          const { order: o, visible: v } = getDisplayProperties(listSource);
          if (e.target.checked) v.add(key);
          else v.delete(key);
          if (!o.includes(key)) o.push(key);
          const { showFlagged: sf, showCompleted: sc, showHighlightDue: sh, showPriority: sp } = getDisplayProperties(listSource);
          saveDisplayProperties(listSource, o, v, sf, sc, sh, sp);
          if (lastTaskSource === listSource) refreshTaskList();
        });
      });
      setupDisplayListDrag(columnsEl, listSource);
    }
  }

  /** Resolve relative date strings to YYYY-MM-DD for list filter payload so the API gets a concrete date. */
  function resolveListFilterDateValue(str) {
    if (str == null || typeof str !== 'string') return str;
    const s = str.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const todayLower = s.toLowerCase();
    if (todayLower === 'today') return todayDateStr();
    const plusMatch = s.match(/^today\s*\+\s*(\d+)$/i);
    if (plusMatch) return dateAddDays(todayDateStr(), parseInt(plusMatch[1], 10));
    const minusMatch = s.match(/^today\s*-\s*(\d+)$/i);
    if (minusMatch) return dateAddDays(todayDateStr(), -parseInt(minusMatch[1], 10));
    return s;
  }

  function collectConditionFromRow(row) {
    const fieldSelect = row.querySelector('.list-filter-field');
    const opSelect = row.querySelector('.list-filter-op');
    const valueEl = row.querySelector('.list-filter-value');
    const field = fieldSelect && fieldSelect.value;
    const op = opSelect && opSelect.value;
    const f = LIST_FILTER_FIELDS.find((x) => x.field === field);
    if (!field || !op || !f) return null;
    let value = valueEl && (valueEl.tagName === 'SELECT' ? valueEl.value : valueEl.value.trim());
    if (f.valueType === 'number' && value !== '') value = parseInt(value, 10);
    if (f.valueType === 'tags' && value) value = value.split(',').map((s) => s.trim()).filter(Boolean);
    if (f.valueType === 'projects' && value) value = value.split(',').map((s) => s.trim()).filter(Boolean);
    if (f.valueType === 'flagged' || f.valueType === 'blocked') value = value === 'true' || value === '1';
    if (f.valueType === 'date' && typeof value === 'string' && value) value = resolveListFilterDateValue(value);
    if (op === 'is_empty') value = null;
    return { type: 'condition', field, operator: op, value };
  }

  function collectGroupFromEl(groupEl) {
    const headerSelect = groupEl.querySelector(':scope > .list-settings-group-header .list-settings-group-operator');
    const operator = (headerSelect && headerSelect.value) || 'AND';
    const childrenEl = groupEl.querySelector(':scope > .list-settings-group-children');
    const children = [];
    if (childrenEl) {
      childrenEl.querySelectorAll(':scope > .list-settings-filter-row, :scope > .list-settings-filter-group').forEach((el) => {
        if (el.classList.contains('list-settings-filter-row')) {
          const c = collectConditionFromRow(el);
          if (c) children.push(c);
        } else if (el.classList.contains('list-settings-filter-group')) {
          children.push(collectGroupFromEl(el));
        }
      });
    }
    return { type: 'group', operator, children };
  }

  function collectListSettingsPayload() {
    const filtersEl = document.getElementById('list-settings-filters');
    const sortEl = document.getElementById('list-settings-sort');
    const rootGroupEl = filtersEl && filtersEl.querySelector(':scope > .list-settings-filter-group');
    const query_definition = rootGroupEl ? collectGroupFromEl(rootGroupEl) : { type: 'group', operator: 'AND', children: [] };
    const sortWithin = [];
    (sortEl && sortEl.querySelectorAll('.list-settings-sort-row')).forEach((row) => {
      const fieldSelect = row.querySelector('.list-sort-field');
      const dirSelect = row.querySelector('.list-sort-dir');
      if (fieldSelect && dirSelect) sortWithin.push({ field: fieldSelect.value, direction: dirSelect.value });
    });
    const sort_definition = { group_by: [], sort_within_group: sortWithin };
    return { query_definition, sort_definition };
  }

  function closeListSettingsModal() {
    const overlay = document.getElementById('list-settings-overlay');
    if (overlay) {
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');
    }
    currentListSettingsListId = null;
  }

  const listSettingsClose = document.getElementById('list-settings-close');
  const listSettingsSave = document.getElementById('list-settings-save');
  const listSettingsOverlay = document.getElementById('list-settings-overlay');
  if (listSettingsClose) listSettingsClose.addEventListener('click', closeListSettingsModal);
  if (listSettingsOverlay) listSettingsOverlay.addEventListener('click', (e) => { if (e.target === listSettingsOverlay) closeListSettingsModal(); });
  if (listSettingsSave) {
    listSettingsSave.addEventListener('click', async () => {
      const listId = currentListSettingsListId;
      if (!listId) { closeListSettingsModal(); return; }
      try {
        const { query_definition, sort_definition } = collectListSettingsPayload();
        await api(`/api/external/lists/${encodeURIComponent(listId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query_definition, sort_definition }),
        });
        closeListSettingsModal();
        refreshLeftAndCenter();
      } catch (e) {
        alert(e.message || 'Failed to save list settings.');
      }
    });
  }

  function refreshNavigator() {
    refreshLeftPanel();
    refreshCenterView();
  }
  const navigatorRefreshBtn = document.getElementById('navigator-refresh-btn');
  if (navigatorRefreshBtn) navigatorRefreshBtn.addEventListener('click', refreshNavigator);

  const navigatorEditBtn = document.getElementById('navigator-edit-btn');
  function exitEditMode() {
    if (!leftPanel) return;
    leftPanel.classList.remove('left-panel-edit-mode');
    if (navigatorEditBtn) navigatorEditBtn.classList.remove('active');
    if (tagsSortRow) {
      tagsSortRow.classList.add('hidden');
      tagsSortRow.setAttribute('aria-hidden', 'true');
    }
    document.querySelectorAll('.nav-section[data-section]').forEach((section) => {
      const sectionId = section.dataset.section;
      if (sectionId === 'inbox') return;
      const header = section.querySelector('.nav-section-header');
      const open = getNavSectionOpen(sectionId);
      if (!open) section.classList.add('collapsed');
      else section.classList.remove('collapsed');
      if (header) header.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    loadProjects();
    loadLists();
    loadBoards();
    loadTags();
    if (editModeOutsideClickRef) {
      document.removeEventListener('click', editModeOutsideClickRef, true);
      editModeOutsideClickRef = null;
    }
  }
  let editModeOutsideClickRef = null;
  function enterEditMode() {
    if (!leftPanel) return;
    leftPanel.classList.add('left-panel-edit-mode');
    if (navigatorEditBtn) navigatorEditBtn.classList.add('active');
    document.querySelectorAll('#nav-section-favorites, #nav-section-projects, #nav-section-lists, #nav-section-tags').forEach((section) => {
      section.classList.remove('collapsed');
      const header = section.querySelector('.nav-section-header');
      if (header) header.setAttribute('aria-expanded', 'true');
    });
    if (tagsSortRow) {
      tagsSortRow.classList.remove('hidden');
      tagsSortRow.setAttribute('aria-hidden', 'false');
    }
    syncTagsSortActive();
    editModeOutsideClickRef = (ev) => {
      if (ev.target.closest('#navigator-edit-btn')) return;
      if (ev.target.closest('.nav-item-actions')) return;
      if (ev.target.closest('#tags-sort-row') || ev.target.closest('.tags-sort-btn')) return;
      exitEditMode();
    };
    document.addEventListener('click', editModeOutsideClickRef, true);
  }
  if (navigatorEditBtn) {
    navigatorEditBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (leftPanel && leftPanel.classList.contains('left-panel-edit-mode')) exitEditMode();
      else enterEditMode();
    });
  }

  // --- Navigator add (plus) button: popover → Project or List → modals ---
  const newProjectOverlay = document.getElementById('new-project-overlay');
  const newProjectName = document.getElementById('new-project-name');
  const newProjectClose = document.getElementById('new-project-close');
  const newProjectCreate = document.getElementById('new-project-create');
  const newListOverlay = document.getElementById('new-list-overlay');
  const newListName = document.getElementById('new-list-name');
  const newListClose = document.getElementById('new-list-close');
  const newListCreate = document.getElementById('new-list-create');
  const duplicateListOverlay = document.getElementById('duplicate-list-overlay');
  const duplicateListName = document.getElementById('duplicate-list-name');
  const duplicateListClose = document.getElementById('duplicate-list-close');
  const duplicateListCreate = document.getElementById('duplicate-list-create');
  let duplicateListSource = null;
  const newBoardOverlay = document.getElementById('new-board-overlay');
  const newBoardTitleEl = document.getElementById('new-board-title');
  const newBoardName = document.getElementById('new-board-name');
  const newBoardBase = document.getElementById('new-board-base');
  const newBoardClose = document.getElementById('new-board-close');
  const newBoardCreate = document.getElementById('new-board-create');
  let newBoardDuplicateSourceId = null;

  function closeAddPopover() {
    if (navigatorAddPopover) {
      navigatorAddPopover.classList.add('hidden');
      if (navigatorAddBtn) navigatorAddBtn.setAttribute('aria-expanded', 'false');
    }
  }
  // --- New task modal ---
  const newTaskModalOverlay = document.getElementById('new-task-modal-overlay');
  const newTaskModalClose = document.getElementById('new-task-modal-close');
  const newTaskModalSave = document.getElementById('new-task-modal-save');
  const newTaskModalContent = document.getElementById('new-task-modal-content');
  let newTaskState = {
    title: '',
    available_date: '',
    due_date: '',
    status: 'incomplete',
    flagged: false,
    description: '',
    recurrence: null,
    projects: [],
    tags: [],
  };

  function closeNewTaskModal() {
    if (newTaskModalOverlay) {
      newTaskModalOverlay.classList.add('hidden');
      newTaskModalOverlay.setAttribute('aria-hidden', 'true');
    }
  }

  function openNewTaskModal() {
    // Auto-assign project when a project is active in the view; same for tag.
    const fromProject = lastTaskSource && lastTaskSource !== 'inbox' && lastTaskSource !== 'search' && !lastTaskSource.startsWith('list:') && !lastTaskSource.startsWith('tag:');
    const fromTag = lastTaskSource && lastTaskSource.startsWith('tag:');
    let initialProjects = fromProject ? [lastTaskSource] : [];
    let initialTags = fromTag ? [lastTaskSource.slice(4)] : [];
    if (!initialProjects.length && projectsList) {
      const sel = projectsList.querySelector('.nav-item.selected');
      if (sel && sel.dataset.type === 'project' && sel.dataset.id) initialProjects = [sel.dataset.id];
    }
    if (!initialTags.length && tagsListEl) {
      const sel = tagsListEl.querySelector('.nav-item.selected');
      if (sel && sel.dataset.type === 'tag' && sel.dataset.tag) initialTags = [sel.dataset.tag];
    }
    newTaskState = {
      title: '',
      available_date: '',
      due_date: '',
      status: 'incomplete',
      flagged: false,
      description: '',
      recurrence: null,
      projects: initialProjects,
      tags: initialTags,
    };
    if (!newTaskModalContent) return;
    const hasRecurrence = !!(newTaskState.recurrence && typeof newTaskState.recurrence === 'object' && (newTaskState.recurrence.freq || newTaskState.recurrence.interval));
    const avAttr = /^\d{4}-\d{2}-\d{2}$/.test(newTaskState.available_date) ? newTaskState.available_date : '';
    const dueAttr = /^\d{4}-\d{2}-\d{2}$/.test(newTaskState.due_date) ? newTaskState.due_date : '';
    const projectsListStr = newTaskState.projects.map((id) => projectIdToShortName(id)).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })).join(', ') || '—';
    let html = '';
    html += '<div class="new-task-title-wrap">';
    html += '<input type="text" id="new-task-title-input" class="inspector-edit-input new-task-title-input" value="" placeholder="Task title" aria-label="Title" />';
    html += '</div>';
    html += '<p class="inspector-label-line inspector-dates-heading"><strong>Available and due dates</strong></p>';
    html += '<div class="inspector-dates-block new-task-dates-block">';
    html += '<div class="inspector-date-row new-task-date-available" data-date-field="available_date">';
    html += '<span class="inspector-date-icon" aria-hidden="true">' + CAL_EVENT_SVG + '</span>';
    html += '<input type="date" class="inspector-date-input inspector-date-input-small new-task-available-date" value="' + escapeAttr(avAttr) + '" title="Available date" aria-label="Available date" />';
    html += '</div>';
    html += '<div class="inspector-date-row new-task-date-due" data-date-field="due_date">';
    html += '<span class="inspector-date-icon" aria-hidden="true">' + CAL_CHECK_SVG + '</span>';
    html += '<input type="date" class="inspector-date-input inspector-date-input-small new-task-due-date" value="' + escapeAttr(dueAttr) + '" title="Due date" aria-label="Due date" />';
    html += '</div>';
    html += '</div>';
    html += '<div class="inspector-actions-row new-task-actions-row">';
    html += '<button type="button" class="inspector-action-icon inspector-flag-btn muted new-task-flag-btn" data-flagged="0" title="Flag" aria-label="Toggle flag"><span class="inspector-flag-star flagged-icon empty">★</span></button>';
    html += '<button type="button" class="inspector-action-icon inspector-notes-btn' + (newTaskState.description ? '' : ' muted') + ' new-task-notes-btn" title="Notes / description" aria-label="Edit notes">' + INSPECTOR_DOCUMENT_SVG + '</button>';
    html += '<button type="button" class="inspector-action-icon inspector-recurrence-btn muted new-task-recurrence-btn" title="Set recurrence" aria-label="Recurrence">' + RECURRENCE_ICON_SVG + '</button>';
    html += '<span class="inspector-actions-projects inspector-projects-wrap new-task-projects-wrap" data-projects-json="' + escapeAttr(JSON.stringify(newTaskState.projects)) + '">';
    html += '<button type="button" class="inspector-action-icon inspector-projects-btn' + (newTaskState.projects.length ? '' : ' muted') + ' new-task-projects-btn" title="Add or remove projects" aria-haspopup="true" aria-label="Projects">' + INSPECTOR_PROJECTS_ICON_SVG + '</button>';
    html += '</span>';
    html += '<span class="inspector-actions-tags new-task-tags-wrap" data-tags-json="' + escapeAttr(JSON.stringify(newTaskState.tags)) + '">';
    html += '<button type="button" class="inspector-action-icon inspector-tags-btn new-task-tags-btn' + (newTaskState.tags.length ? '' : ' muted') + '" title="Add or remove tags" aria-haspopup="true" aria-label="Tags">' + INSPECTOR_TAG_SVG + '</button>';
    html += '</span>';
    html += '</div>';
    newTaskModalContent.innerHTML = html;

    const titleInput = newTaskModalContent.querySelector('#new-task-title-input');
    const availableInput = newTaskModalContent.querySelector('.new-task-available-date');
    const dueInput = newTaskModalContent.querySelector('.new-task-due-date');
    if (titleInput) titleInput.value = newTaskState.title;
    attachHashtagAutocompleteLazy(titleInput);

    newTaskModalContent.querySelector('.new-task-flag-btn').addEventListener('click', () => {
      newTaskState.flagged = !newTaskState.flagged;
      const btn = newTaskModalContent.querySelector('.new-task-flag-btn');
      btn.classList.toggle('muted', !newTaskState.flagged);
      btn.querySelector('.flagged-icon').classList.toggle('empty', !newTaskState.flagged);
      btn.title = newTaskState.flagged ? 'Unflag' : 'Flag';
    });
    newTaskModalContent.querySelector('.new-task-notes-btn').addEventListener('click', () => {
      openDescriptionModalForNewTask();
    });
    newTaskModalContent.querySelector('.new-task-recurrence-btn').addEventListener('click', () => {
      openRecurrenceModal(null, {
        forNewTask: true,
        dueDate: dueInput ? dueInput.value : '',
        initialRecurrence: newTaskState.recurrence,
        onSave: (rec) => {
          newTaskState.recurrence = rec;
          const btn = newTaskModalContent.querySelector('.new-task-recurrence-btn');
          if (btn) {
            btn.classList.toggle('muted', !rec || !(rec.freq || rec.interval));
            btn.title = (rec && (rec.freq || rec.interval)) ? 'Edit recurrence' : 'Set recurrence';
          }
          closeRecurrenceModal();
        },
      });
    });
    const projectsWrap = newTaskModalContent.querySelector('.new-task-projects-wrap');
    const projectsBtn = newTaskModalContent.querySelector('.new-task-projects-btn');
    if (projectsWrap && projectsBtn) {
      projectsBtn.addEventListener('click', (ev) => {
        openProjectsDropdown(ev, projectsWrap, {
          taskId: null,
          forNewTask: true,
          currentIds: newTaskState.projects,
          anchorEl: projectsBtn,
          onAfterApply: (ids) => {
            newTaskState.projects = ids;
            projectsWrap.dataset.projectsJson = JSON.stringify(ids);
            projectsBtn.classList.toggle('muted', !ids.length);
          },
        });
      });
    }
    const tagsWrap = newTaskModalContent.querySelector('.new-task-tags-wrap');
    const tagsBtn = newTaskModalContent.querySelector('.new-task-tags-btn');
    if (tagsWrap && tagsBtn) {
      tagsBtn.addEventListener('click', (ev) => {
        openTaskTagsDropdown(ev, tagsBtn, {
          taskId: null,
          forNewTask: true,
          currentTags: newTaskState.tags,
          anchorEl: tagsBtn,
          onAfterApply: (tags) => {
            newTaskState.tags = Array.isArray(tags) ? tags : [];
            tagsWrap.dataset.tagsJson = JSON.stringify(newTaskState.tags);
            tagsBtn.classList.toggle('muted', !newTaskState.tags.length);
          },
        });
      });
    }
    if (availableInput) availableInput.addEventListener('change', () => { newTaskState.available_date = (availableInput.value || '').trim().substring(0, 10); });
    if (dueInput) dueInput.addEventListener('change', () => { newTaskState.due_date = (dueInput.value || '').trim().substring(0, 10); });

    if (newTaskModalOverlay) {
      newTaskModalOverlay.classList.remove('hidden');
      newTaskModalOverlay.setAttribute('aria-hidden', 'false');
      if (titleInput) setTimeout(() => titleInput.focus(), 50);
    }
  }

  if (newTaskModalClose) newTaskModalClose.addEventListener('click', closeNewTaskModal);
  if (newTaskModalOverlay) newTaskModalOverlay.addEventListener('click', (e) => { if (e.target === newTaskModalOverlay) closeNewTaskModal(); });
  if (newTaskModalSave) {
    newTaskModalSave.addEventListener('click', async () => {
      const titleEl = newTaskModalContent && newTaskModalContent.querySelector('#new-task-title-input');
      const availableEl = newTaskModalContent && newTaskModalContent.querySelector('.new-task-available-date');
      const dueEl = newTaskModalContent && newTaskModalContent.querySelector('.new-task-due-date');
      const title = (titleEl && titleEl.value) ? titleEl.value.trim() : '';
      if (!title) {
        alert('Please enter a title.');
        return;
      }
      newTaskState.title = title;
      newTaskState.available_date = (availableEl && availableEl.value) ? (availableEl.value || '').trim().substring(0, 10) : '';
      newTaskState.due_date = (dueEl && dueEl.value) ? (dueEl.value || '').trim().substring(0, 10) : '';
      const notesVal = newTaskState.description || null;
      const body = {
        title: newTaskState.title,
        available_date: newTaskState.available_date || null,
        due_date: newTaskState.due_date || null,
        status: newTaskState.status,
        flagged: newTaskState.flagged,
        description: notesVal,
        notes: notesVal,
        recurrence: newTaskState.recurrence || null,
        projects: newTaskState.projects && newTaskState.projects.length ? newTaskState.projects : null,
        tags: newTaskState.tags && newTaskState.tags.length ? newTaskState.tags : null,
      };
      try {
        await api('/api/external/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        closeNewTaskModal();
        scheduleRefreshAfterTaskChange();
      } catch (e) {
        alert(e.message || 'Failed to create task.');
      }
    });
  }

  const navigatorAddTaskBtn = document.getElementById('navigator-add-task-btn');
  const navigatorSearchInput = document.getElementById('navigator-search-input');
  const navigatorSearchBtn = document.getElementById('navigator-search-btn');
  const navigatorFavoritesBtn = document.getElementById('navigator-favorites-btn');
  const navigatorFavoritesPopover = document.getElementById('navigator-favorites-popover');
  const navigatorFavoritesList = document.getElementById('navigator-favorites-list');
  if (navigatorAddTaskBtn) {
    navigatorAddTaskBtn.addEventListener('click', () => openNewTaskModal());
  }
  function closeNavigatorFavoritesPopover() {
    if (navigatorFavoritesPopover) navigatorFavoritesPopover.classList.add('hidden');
    if (navigatorFavoritesPopover) navigatorFavoritesPopover.setAttribute('aria-hidden', 'true');
    if (navigatorFavoritesBtn) navigatorFavoritesBtn.setAttribute('aria-expanded', 'false');
  }
  function fillNavigatorFavoritesPopover() {
    if (!navigatorFavoritesList) return;
    const favs = getFavorites();
    const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const iconSvg = (type) => type === 'list' ? NAV_LIST_ICON_SVG : type === 'tag' ? NAV_TAG_ICON_SVG : type === 'board' ? NAV_BOARD_ICON_SVG : NAV_PROJECT_ICON_SVG;
    if (!favs.length) {
      navigatorFavoritesList.innerHTML = '<li class="navigator-favorites-empty">No favorites yet. Add from the left panel.</li>';
      return;
    }
    navigatorFavoritesList.innerHTML = favs.map((f) => {
      const name = escape(f.label || f.id || '');
      const idEsc = escape(f.id || '');
      const icon = iconSvg(f.type);
      return `<li class="navigator-favorites-item" data-type="${escape(f.type)}" data-id="${idEsc}" data-label="${name}"><span class="navigator-fav-icon">${icon}</span><span>${name}</span></li>`;
    }).join('');
    navigatorFavoritesList.querySelectorAll('.navigator-favorites-item').forEach((el) => {
      el.addEventListener('click', () => {
        const type = el.dataset.type;
        const id = el.dataset.id;
        const label = el.dataset.label || '';
        closeNavigatorFavoritesPopover();
        if (type === 'board' && id) {
          openBoardView(id);
          return;
        }
        if (type === 'tag' && id) {
          currentInspectorTag = id;
          document.getElementById('inspector-title').textContent = 'Tag';
          loadTagDetails(id);
          const tagLi = tagsListEl && tagsListEl.querySelector(`.nav-item[data-tag="${id.replace(/"/g, '\\"')}"]`);
          if (tagLi) {
            if (inboxItem) inboxItem.classList.remove('selected');
            if (projectsList) projectsList.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
            if (listsListEl) listsListEl.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
            if (tagsListEl) tagsListEl.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
            if (favoritesListEl) favoritesListEl.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
            tagLi.classList.add('selected');
          }
          return;
        }
        if (type === 'project' && id) {
          lastTaskSource = id;
          document.getElementById('center-title').textContent = label;
          const centerDesc = document.getElementById('center-description');
          if (centerDesc) centerDesc.textContent = '';
          document.getElementById('inspector-title').textContent = 'Project';
          document.getElementById('inspector-content').innerHTML = '<p class="placeholder">Loading…</p>';
          updateCenterHeaderForSource();
          loadProjectDetails(id);
          loadProjectTasks(id);
          if (inboxItem) inboxItem.classList.remove('selected');
          if (projectsList) projectsList.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
          if (listsListEl) listsListEl.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
          if (tagsListEl) tagsListEl.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
          if (favoritesListEl) favoritesListEl.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
          const projLi = projectsList && projectsList.querySelector(`.nav-item[data-id="${id.replace(/"/g, '\\"')}"]`);
          if (projLi) projLi.classList.add('selected');
          return;
        }
        if (type === 'list' && id) {
          lastTaskSource = 'list:' + id;
          document.getElementById('center-title').textContent = label;
          const centerDesc = document.getElementById('center-description');
          if (centerDesc) centerDesc.textContent = '';
          document.getElementById('inspector-title').textContent = 'List';
          document.getElementById('inspector-content').innerHTML = '<p class="placeholder">Loading…</p>';
          updateCenterHeaderForSource();
          loadListTasks(id);
          loadListDetails(id);
          if (inboxItem) inboxItem.classList.remove('selected');
          if (projectsList) projectsList.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
          if (listsListEl) listsListEl.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
          if (tagsListEl) tagsListEl.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
          if (favoritesListEl) favoritesListEl.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
          const listLi = listsListEl && listsListEl.querySelector(`.nav-item[data-list-id="${id.replace(/"/g, '\\"')}"]`);
          if (listLi) listLi.classList.add('selected');
          return;
        }
      });
    });
  }
  if (navigatorFavoritesBtn && navigatorFavoritesPopover) {
    navigatorFavoritesBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !navigatorFavoritesPopover.classList.toggle('hidden');
      navigatorFavoritesBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      navigatorFavoritesPopover.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
      if (isOpen) fillNavigatorFavoritesPopover();
    });
    document.addEventListener('click', (e) => {
      if (navigatorFavoritesPopover && !navigatorFavoritesPopover.classList.contains('hidden') &&
          !navigatorFavoritesPopover.contains(e.target) && !navigatorFavoritesBtn.contains(e.target)) {
        closeNavigatorFavoritesPopover();
      }
    });
    if (navigatorFavoritesPopover) navigatorFavoritesPopover.addEventListener('click', (e) => e.stopPropagation());
  }
  if (navigatorSearchBtn) navigatorSearchBtn.addEventListener('click', () => runSearch(navigatorSearchInput && navigatorSearchInput.value));
  if (navigatorSearchInput) {
    navigatorSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runSearch(navigatorSearchInput.value);
    });
  }
  if (navigatorAddBtn && navigatorAddPopover) {
    navigatorAddBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !navigatorAddPopover.classList.toggle('hidden');
      navigatorAddBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
    document.addEventListener('click', closeAddPopover);
    navigatorAddPopover.addEventListener('click', (e) => e.stopPropagation());
    navigatorAddPopover.querySelectorAll('.navigator-add-popover-item').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const choice = btn.dataset.choice;
        closeAddPopover();
        if (choice === 'project') {
          if (newProjectOverlay) {
            if (newProjectName) newProjectName.value = '';
            newProjectOverlay.classList.remove('hidden');
            newProjectOverlay.setAttribute('aria-hidden', 'false');
            setTimeout(() => newProjectName && newProjectName.focus(), 50);
          }
        } else if (choice === 'list') {
          if (newListOverlay) {
            if (newListName) newListName.value = '';
            newListOverlay.classList.remove('hidden');
            newListOverlay.setAttribute('aria-hidden', 'false');
            setTimeout(() => newListName && newListName.focus(), 50);
          }
        } else if (choice === 'board') {
          openNewBoardModal();
        }
      });
    });
  }
  function openNewBoardModal(sourceBoardId) {
    if (!newBoardOverlay || !newBoardBase) return;
    newBoardDuplicateSourceId = sourceBoardId || null;
    if (newBoardTitleEl) newBoardTitleEl.textContent = newBoardDuplicateSourceId ? 'Duplicate board' : 'New board';
    const select = newBoardBase;
    select.innerHTML = '<option value="">— Select a list or project —</option>';
    const projects = projectListCache || [];
    const lists = getLists();
    const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    lists.forEach((l) => {
      const id = `list:${(l.id || '').replace(/"/g, '&quot;')}`;
      const name = escape(l.name || 'List');
      select.appendChild(new Option(`List: ${name}`, id));
    });
    projects.forEach((p) => {
      const id = `project:${(p.id || '').replace(/"/g, '&quot;')}`;
      const name = escape(p.name || p.short_id || 'Project');
      select.appendChild(new Option(`Project: ${name}`, id));
    });
    if (newBoardName) newBoardName.value = '';
    select.selectedIndex = 0;
    newBoardOverlay.classList.remove('hidden');
    newBoardOverlay.setAttribute('aria-hidden', 'false');
    setTimeout(() => newBoardName && newBoardName.focus(), 50);
  }
  function closeNewBoardModal() {
    newBoardDuplicateSourceId = null;
    if (newBoardTitleEl) newBoardTitleEl.textContent = 'New board';
    if (newBoardOverlay) {
      newBoardOverlay.classList.add('hidden');
      newBoardOverlay.setAttribute('aria-hidden', 'true');
    }
  }
  if (newBoardCreate) {
    newBoardCreate.addEventListener('click', () => {
      const name = newBoardName && newBoardName.value.trim();
      const baseVal = newBoardBase && newBoardBase.value;
      if (!name) {
        alert('Enter a board name.');
        return;
      }
      if (!baseVal || !baseVal.startsWith('list:') && !baseVal.startsWith('project:')) {
        alert('Select a list or project to base this board on.');
        return;
      }
      const [baseType, baseId] = baseVal.startsWith('list:') ? ['list', baseVal.slice(5)] : ['project', baseVal.slice(8)];
      const id = 'board_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
      const boards = getBoards();
      const newBoard = { id, name, baseType, baseId };
      boards.push(newBoard);
      if (newBoardDuplicateSourceId) {
        const source = boards.find((b) => String(b.id) === String(newBoardDuplicateSourceId));
        if (source) {
          newBoard.regions = Array.isArray(source.regions) ? JSON.parse(JSON.stringify(source.regions)) : [];
          if (typeof source.viewScale === 'number') newBoard.viewScale = source.viewScale;
          if (typeof source.viewX === 'number') newBoard.viewX = source.viewX;
          if (typeof source.viewY === 'number') newBoard.viewY = source.viewY;
        }
      }
      saveBoards(boards);
      const order = getBoardOrder();
      if (!order.includes(id)) {
        order.push(id);
        saveBoardOrder(order);
      }
      closeNewBoardModal();
      loadBoards();
      loadFavorites();
      openBoardView(id);
    });
  }
  if (newBoardClose) newBoardClose.addEventListener('click', closeNewBoardModal);
  if (newBoardOverlay) newBoardOverlay.addEventListener('click', (e) => { if (e.target === newBoardOverlay) closeNewBoardModal(); });

  function closeNewProjectModal() {
    if (newProjectOverlay) {
      newProjectOverlay.classList.add('hidden');
      newProjectOverlay.setAttribute('aria-hidden', 'true');
    }
  }
  if (newProjectCreate) {
    newProjectCreate.addEventListener('click', async () => {
      const name = newProjectName && newProjectName.value.trim();
      if (!name) return;
      try {
        await api('/api/external/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        closeNewProjectModal();
        loadProjects();
      } catch (e) {
        console.error('Failed to create project:', e);
        alert(e.message || 'Failed to create project.');
      }
    });
  }
  if (newProjectClose) newProjectClose.addEventListener('click', closeNewProjectModal);
  if (newProjectOverlay) {
    newProjectOverlay.addEventListener('click', (e) => { if (e.target === newProjectOverlay) closeNewProjectModal(); });
  }

  function closeNewListModal() {
    if (newListOverlay) {
      newListOverlay.classList.add('hidden');
      newListOverlay.setAttribute('aria-hidden', 'true');
    }
  }
  if (newListCreate) {
    newListCreate.addEventListener('click', async () => {
      const name = newListName && newListName.value.trim();
      if (!name) return;
      try {
        const created = await api('/api/external/lists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, query_definition: {} }),
        });
        await loadListsFromApi();
        closeNewListModal();
        if (created && created.id) openListInCenter(created.id);
      } catch (e) {
        console.error('Failed to create list:', e);
        alert(e.message || 'Failed to create list.');
      }
    });
  }
  if (newListClose) newListClose.addEventListener('click', closeNewListModal);
  if (newListOverlay) {
    newListOverlay.addEventListener('click', (e) => { if (e.target === newListOverlay) closeNewListModal(); });
  }

  function closeDuplicateListModal() {
    if (duplicateListOverlay) {
      duplicateListOverlay.classList.add('hidden');
      duplicateListOverlay.setAttribute('aria-hidden', 'true');
    }
    duplicateListSource = null;
  }
  if (duplicateListCreate) {
    duplicateListCreate.addEventListener('click', async () => {
      const name = duplicateListName && duplicateListName.value.trim();
      if (!name) {
        alert('Name is required.');
        return;
      }
      if (!duplicateListSource) {
        alert('No list to duplicate.');
        return;
      }
      const qd = duplicateListSource.query_definition;
      const sd = duplicateListSource.sort_definition;
      const query_definition = (qd != null && (typeof qd !== 'object' || Object.keys(qd).length > 0))
        ? qd
        : { type: 'group', operator: 'AND', children: [] };
      try {
        const created = await api('/api/external/lists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            query_definition,
            sort_definition: sd != null ? sd : undefined,
          }),
        });
        if (created && created.id) {
          const sourceKey = 'list:' + (duplicateListSource.id || '');
          const props = getDisplayProperties(sourceKey);
          saveDisplayProperties('list:' + created.id, props.order, props.visible, props.showFlagged, props.showCompleted, props.showHighlightDue, props.showPriority, props.sortBy, props.manualSort, props.manualOrder);
        }
        closeDuplicateListModal();
        await loadListsFromApi();
        if (created && created.id) openListInCenter(created.id);
      } catch (e) {
        console.error('Failed to duplicate list:', e);
        alert(e.message || 'Failed to duplicate list.');
      }
    });
  }
  if (duplicateListClose) duplicateListClose.addEventListener('click', closeDuplicateListModal);
  if (duplicateListOverlay) {
    duplicateListOverlay.addEventListener('click', (e) => { if (e.target === duplicateListOverlay) closeDuplicateListModal(); });
  }

  // --- Init ---
  if (inboxItem) inboxItem.addEventListener('click', onInboxClick);

  // --- Collapsible nav sections (Projects, Lists): persist open/closed; Inbox is label-only ---
  function getNavSectionOpen(sectionId) {
    const key = NAV_SECTION_OPEN_PREFIX + sectionId;
    const stored = localStorage.getItem(key);
    return stored === null ? true : stored === 'true';
  }
  function setNavSectionOpen(sectionId, open) {
    localStorage.setItem(NAV_SECTION_OPEN_PREFIX + sectionId, String(open));
  }
  document.querySelectorAll('.nav-section[data-section]').forEach((section) => {
    const sectionId = section.dataset.section;
    if (sectionId === 'inbox') return;
    const header = section.querySelector('.nav-section-header');
    const body = section.querySelector('.nav-section-body');
    if (!header || !body) return;
    const open = getNavSectionOpen(sectionId);
    if (!open) section.classList.add('collapsed');
    header.setAttribute('aria-expanded', open ? 'true' : 'false');
    header.addEventListener('click', () => {
      const isCollapsed = section.classList.toggle('collapsed');
      const nowOpen = !isCollapsed;
      setNavSectionOpen(sectionId, nowOpen);
      header.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
    });
  });

  checkConnection();
  applyTaskListSeparator();
  loadProjects().then(() => {
    loadLists();
    loadFavorites();
    loadBoards();
    loadTags();
    applyDefaultOpenView();
  });
  setInterval(checkConnection, 30000);
})();
