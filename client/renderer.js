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

  const TASK_PROPERTY_KEYS = ['due_date', 'available_date', 'description', 'projects', 'tags', 'recurrence'];
  const TASK_PROPERTY_LABELS = {
    due_date: 'Due date',
    available_date: 'Available date',
    priority: 'Priority',
    description: 'Description',
    projects: 'Projects',
    tags: 'Tags',
    recurrence: 'Recurrence',
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
      const rest = renderMarkdownInline(checkboxMatch[5]);
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
    loadSettingsTags();
  }

  const settingsTagsList = document.getElementById('settings-tags-list');
  const settingsTagsRefresh = document.getElementById('settings-tags-refresh');
  async function loadSettingsTags() {
    if (!settingsTagsList) return;
    if (!getApiKey()) {
      settingsTagsList.innerHTML = '<li class="settings-tags-empty">Set API key above to list tags.</li>';
      return;
    }
    try {
      const tags = await api('/api/external/tags');
      if (!Array.isArray(tags) || !tags.length) {
        settingsTagsList.innerHTML = '<li class="settings-tags-empty">No tags yet. Tags come from task tags or #tag in titles/notes.</li>';
        return;
      }
      const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      settingsTagsList.innerHTML = tags.map((item) => {
        const tag = escape(item.tag || '');
        const count = Number(item.count) || 0;
        return `<li class="settings-tags-row" data-tag="${tag}" data-count="${count}">
          <span class="settings-tags-name">#${tag}</span>
          <span class="settings-tags-count">${count} task(s)</span>
          <button type="button" class="btn-secondary btn-sm settings-tag-rename" data-action="rename" aria-label="Rename tag">Rename</button>
          <button type="button" class="btn-secondary btn-sm settings-tag-delete" data-action="delete" aria-label="Delete tag">Delete</button>
        </li>`;
      }).join('');
      settingsTagsList.querySelectorAll('.settings-tag-rename').forEach((btn) => {
        btn.addEventListener('click', onSettingsTagRename);
      });
      settingsTagsList.querySelectorAll('.settings-tag-delete').forEach((btn) => {
        btn.addEventListener('click', onSettingsTagDelete);
      });
    } catch (e) {
      settingsTagsList.innerHTML = '<li class="settings-tags-empty">Failed to load tags: ' + (e.message || 'network error') + '</li>';
    }
  }

  async function onSettingsTagRename(ev) {
    const row = ev.target.closest('.settings-tags-row');
    if (!row) return;
    const oldTag = row.dataset.tag;
    const count = Number(row.dataset.count) || 0;
    const newTag = (prompt(`Rename tag #${oldTag} to:`, oldTag) || '').trim();
    if (!newTag || newTag === oldTag) return;
    const msg = `Rename tag "#${oldTag}" to "#${newTag}"? This will update task tags and any #${oldTag} in titles/notes (${count} task(s)).`;
    if (!confirm(msg)) return;
    try {
      const res = await api('/api/execute-pending-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'tag_rename', old_tag: oldTag, new_tag: newTag }),
      });
      const data = typeof res === 'object' ? res : {};
      if (data.ok) {
        loadSettingsTags();
        if (lastTaskSource) refreshTaskList();
        alert(data.message || 'Tag renamed.');
      } else {
        alert(data.message || 'Rename failed.');
      }
    } catch (e) {
      alert(e.message || 'Failed to rename tag.');
    }
  }

  async function onSettingsTagDelete(ev) {
    const row = ev.target.closest('.settings-tags-row');
    if (!row) return;
    const tag = row.dataset.tag;
    const count = Number(row.dataset.count) || 0;
    const msg = `Delete tag "#${tag}"? It will be removed from all task tags and any #${tag} in titles/notes (${count} task(s)).`;
    if (!confirm(msg)) return;
    try {
      const res = await api('/api/execute-pending-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'tag_delete', tag }),
      });
      const data = typeof res === 'object' ? res : {};
      if (data.ok) {
        loadSettingsTags();
        if (lastTaskSource) refreshTaskList();
        alert(data.message || 'Tag removed.');
      } else {
        alert(data.message || 'Delete failed.');
      }
    } catch (e) {
      alert(e.message || 'Failed to delete tag.');
    }
  }

  if (settingsTagsRefresh) settingsTagsRefresh.addEventListener('click', loadSettingsTags);

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
  if (descriptionEditTextarea) {
    attachHashtagAutocomplete(descriptionEditTextarea);
    descriptionEditTextarea.addEventListener('input', updateDescriptionPreview);
    descriptionEditTextarea.addEventListener('change', updateDescriptionPreview);
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
    if (themeBtn) themeBtn.title = 'Theme: ' + theme + ' (click to cycle)';
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
    return api(`/api/external/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
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
    };
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
        const { order: o, visible: v, showFlagged: sf, showCompleted: sc, showHighlightDue: sh, showPriority: sp, sortBy: sb } = getDisplayProperties(source);
        const next = [...sb, { key: 'due_date', dir: 'asc' }];
        saveDisplayProperties(source, o, v, sf, sc, sh, sp, next);
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
        const { showFlagged: sf, showCompleted: sc, showHighlightDue: sh, showPriority: sp } = getDisplayProperties(source);
        saveDisplayProperties(source, o, v, sf, sc, sh, sp);
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
      const { order: o, visible: v, showFlagged: sf, showCompleted: sc, showHighlightDue: sh, showPriority: sp } = getDisplayProperties(source);
      saveDisplayProperties(source, o, v, sf, sc, sh, sp, sb);
      refreshTaskList();
    };
    ladderEl.querySelectorAll('.display-sort-field, .display-sort-dir').forEach((el) => {
      el.addEventListener('change', syncSortBy);
    });
    ladderEl.querySelectorAll('.display-sort-remove').forEach((btn, i) => {
      btn.addEventListener('click', () => {
        const { order: o, visible: v, showFlagged: sf, showCompleted: sc, showHighlightDue: sh, showPriority: sp, sortBy: sb } = getDisplayProperties(source);
        const next = sb.filter((_, j) => j !== i);
        saveDisplayProperties(source, o, v, sf, sc, sh, sp, next);
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
    refreshLeftAndCenter();
  }

  const DISPLAY_SETTINGS_ICON = '<svg class="header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M3 8L15 8M15 8C15 9.65686 16.3431 11 18 11C19.6569 11 21 9.65685 21 8C21 6.34315 19.6569 5 18 5C16.3431 5 15 6.34315 15 8ZM9 16L21 16M9 16C9 17.6569 7.65685 19 6 19C4.34315 19 3 17.6569 3 16C3 14.3431 4.34315 13 6 13C7.65685 13 9 14.3431 9 16Z"/></svg>';
  const LIST_SETTINGS_ICON = '<img src="assets/settings-04-svgrepo-com.svg" class="header-icon header-icon-settings" alt="" width="20" height="20" />';
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

  function refreshLeftAndCenter() {
    loadProjects();
    loadLists();
    refreshCenterView();
  }

  async function loadListTasks(listId) {
    const center = document.getElementById('center-content');
    if (!center) return;
    center.innerHTML = '<p class="placeholder">Loading…</p>';
    try {
      const tasks = await api(`/api/external/lists/${encodeURIComponent(listId)}/tasks?limit=500`);
      const list = lastTaskSource && lastTaskSource.startsWith('list:') ? lastTaskSource : 'list:' + listId;
      renderTaskList(Array.isArray(tasks) ? tasks : [], list);
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
    document.body.appendChild(dropdown);
    dateDropdownEl = dropdown;

    const cellRect = cell.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.left = `${cellRect.left}px`;
    dropdown.style.top = `${cellRect.bottom + 4}px`;
    dropdown.style.minWidth = `${Math.max(cellRect.width, 160)}px`;

    requestAnimationFrame(() => document.addEventListener('click', dateDropdownOutside));
  }

  function openInspectorDateDropdown(ev, wrapEl) {
    ev.stopPropagation();
    closeDateDropdown();
    const taskId = wrapEl.dataset.taskId;
    const field = wrapEl.dataset.dateField;
    const inputEl = wrapEl.querySelector('input[type="date"]');
    let currentVal = (inputEl && inputEl.value || '').trim().substring(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(currentVal)) currentVal = todayDateStr();
    if (!taskId || !field) return;

    const dropdown = buildDateDropdownContent(taskId, field, currentVal, () => loadTaskDetails(taskId));
    document.body.appendChild(dropdown);
    dateDropdownEl = dropdown;

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
  function closeTaskTagsDropdown() {
    if (taskTagsDropdownEl && taskTagsDropdownEl.parentNode) taskTagsDropdownEl.parentNode.removeChild(taskTagsDropdownEl);
    taskTagsDropdownEl = null;
    document.removeEventListener('click', taskTagsDropdownOutside);
  }
  function taskTagsDropdownOutside(ev) {
    if (taskTagsDropdownEl && !taskTagsDropdownEl.contains(ev.target) && !ev.target.closest('.tags-cell') && !ev.target.closest('.inspector-tags-btn') && !ev.target.closest('.new-task-tags-btn')) closeTaskTagsDropdown();
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

    document.body.appendChild(dropdown);
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
    descriptionNotesLines.innerHTML = raw.trim() ? renderMarkdown(raw) : '<p class="description-preview-empty">Type above to see a live preview of headings, checkboxes, and #tags.</p>';
    descriptionNotesLines.querySelectorAll('input[type="checkbox"][data-line-index]').forEach((cb) => {
      cb.addEventListener('change', () => {
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
      });
    });
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
    updateDescriptionPreview();
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
    updateDescriptionPreview();
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

  function buildTaskRow(t) {
    const source = lastTaskSource != null ? lastTaskSource : 'project';
    const { order, visible, showFlagged, showHighlightDue, showPriority, manualSort } = getDisplayProperties(source);
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
      row.appendChild(cell);
    }

    if (showPriority) {
      const p = t.priority;
      const cls = priorityClass(p);
      const title = p != null ? `Priority ${p} (click to change)` : 'No priority (click to set)';
      const priorityHtml = `<span class="priority-circle-wrap ${cls}" title="${title}">${PRIORITY_CIRCLE_SVG}</span>`;
      addCell('priority', priorityHtml, { priorityTaskId: t.id, priorityValue: p });
    }
    if (showFlagged) {
      const flagged = t.flagged === true || t.flagged === 1;
      addCell('flagged', `<span class="flagged-icon ${flagged ? '' : 'empty'}" title="${flagged ? 'Flagged (click to unflag)' : 'Click to flag'}">★</span>`, { flaggedTaskId: t.id, flaggedValue: flagged });
    }
    addCell('status', statusComplete ? circleTickSvg : circleOpenSvg);
    addCell('title', `<span class="cell-value">${formatTitleWithTagPills((t.title || '(no title)').trim())}</span>`, { titleTaskId: t.id });

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
      } else if (key === 'description') {
        const d = (t.notes || t.description || '').trim();
        let tooltip = d ? d.replace(/"/g, '&quot;').replace(/</g, '&lt;') : 'No notes (click to add)';
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
        const tg = (t.tags || []).map((x) => String(x).trim()).filter(Boolean);
        const hasVal = tg.length > 0;
        const iconClass = 'tags-icon-wrap ' + (hasVal ? '' : 'empty');
        const title = hasVal ? `Tags: ${tg.join(', ')} (click to edit)` : 'No tags (click to assign)';
        html = `<span class="${iconClass}" title="${title.replace(/"/g, '&quot;')}">${tagIconSvg}</span>`;
        addCell(key, html, { tagsTaskId: t.id, tagsJson: JSON.stringify(tg) });
        return;
      } else if (key === 'recurrence') {
        const hasRec = t.recurrence && typeof t.recurrence === 'object' && (t.recurrence.freq || t.recurrence.interval);
        const iconClass = 'recurrence-icon-wrap ' + (hasRec ? '' : 'empty');
        const title = hasRec ? 'Recurring (click to edit)' : 'Click to set recurrence';
        html = `<span class="${iconClass}" title="${title}">${refreshIconSvg}</span>`;
        addCell(key, html, { recurrenceTaskId: t.id });
        return;
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
    const tagsCell = row.querySelector('.tags-cell');
    if (tagsCell && tagsCell.dataset.tagsTaskId) {
      tagsCell.classList.add('task-cell-clickable');
      tagsCell.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openTaskTagsDropdown(ev, tagsCell, { taskId: tagsCell.dataset.tagsTaskId, currentTags: JSON.parse(tagsCell.dataset.tagsJson || '[]') });
      });
    }
    const priorityCell = row.querySelector('.priority-cell');
    if (priorityCell && priorityCell.dataset.priorityTaskId) {
      priorityCell.classList.add('task-cell-clickable');
      priorityCell.addEventListener('click', (ev) => openPriorityDropdown(ev, priorityCell));
    }
    const recurrenceCell = row.querySelector('.recurrence-cell');
    if (recurrenceCell && recurrenceCell.dataset.recurrenceTaskId) {
      recurrenceCell.classList.add('task-cell-clickable');
      recurrenceCell.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openRecurrenceModal(recurrenceCell.dataset.recurrenceTaskId);
      });
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
    const ul = document.createElement('ul');
    ul.className = 'task-list';
    ul.style.listStyle = 'none';
    ul.style.padding = '0';
    ul.style.margin = '0';
    toShow.forEach((t) => ul.appendChild(buildTaskRow(t)));
    center.innerHTML = '';
    center.appendChild(ul);
    if (!isListSource && manualSort) setupTaskListDrag(center, ul, src);
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
  const boardViewCanvasEl = document.getElementById('board-view-canvas');
  const boardCanvasInnerEl = document.getElementById('board-canvas-inner');
  const boardCardsLayerEl = document.getElementById('board-cards-layer');
  const boardAddTaskBtn = document.getElementById('board-add-task-btn');
  const boardAddTaskPopover = document.getElementById('board-add-task-popover');
  const boardAddTaskListEl = document.getElementById('board-add-task-list');
  const boardZoomOutBtn = document.getElementById('board-zoom-out');
  const boardZoomInBtn = document.getElementById('board-zoom-in');
  const boardZoomSelect = document.getElementById('board-zoom-select');
  const bottomBarEl = document.querySelector('.bottom-bar');
  let boardTasksCache = {};
  const BOARD_DEFAULT_CARD_WIDTH = 260;
  const BOARD_DEFAULT_CARD_HEIGHT = 160;
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

  let boardPanZoom = { x: 0, y: 0, scale: 1 };
  function applyBoardTransform() {
    if (!boardCanvasInnerEl) return;
    const { x, y, scale } = boardPanZoom;
    boardCanvasInnerEl.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
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
    boardPanZoom = { x: 0, y: 0, scale: 1 };
    applyBoardTransform();
    setBoardZoom(100);
    if (boardAddTaskPopover) boardAddTaskPopover.classList.add('hidden');
    if (mainArea) mainArea.classList.add('hidden');
    if (bottomBarEl) bottomBarEl.classList.add('hidden');
    if (appEl) appEl.classList.add('board-open');
    if (boardViewEl) {
      boardViewEl.classList.remove('hidden');
      boardViewEl.setAttribute('aria-hidden', 'false');
    }
    refreshBoardTasks(boardId).then(() => renderBoardCards(boardId));
    setupBoardCanvasPanZoom();
    setupBoardZoomControls();
    setupBoardAddTask(boardId);
  }
  function closeBoardView() {
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
    boardViewCanvasEl.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.board-card')) return;
      if (e.target.closest('.board-zoom-btn') || e.target.closest('.board-zoom-select') || e.target.closest('.board-add-task-btn') || e.target.closest('.board-add-task-popover')) return;
      panStart = { x: e.clientX - boardPanZoom.x, y: e.clientY - boardPanZoom.y };
      boardViewCanvasEl.classList.add('panning');
    });
    document.addEventListener('mousemove', (e) => {
      if (panStart === null) return;
      boardPanZoom.x = e.clientX - panStart.x;
      boardPanZoom.y = e.clientY - panStart.y;
      applyBoardTransform();
    });
    document.addEventListener('mouseup', () => {
      panStart = null;
      if (boardViewCanvasEl) boardViewCanvasEl.classList.remove('panning');
    });
    boardViewCanvasEl.addEventListener('wheel', (e) => {
      if (e.target.closest('.board-card')) return;
      if (e.target.closest('.board-view-zoom')) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -BOARD_ZOOM_STEP : BOARD_ZOOM_STEP;
      setBoardZoom(Math.round(boardPanZoom.scale * 100) + delta);
    }, { passive: false });
  }
  function setupBoardZoomControls() {
    if (boardZoomOutBtn) boardZoomOutBtn.addEventListener('click', () => setBoardZoom(Math.round(boardPanZoom.scale * 100) - BOARD_ZOOM_STEP));
    if (boardZoomInBtn) boardZoomInBtn.addEventListener('click', () => setBoardZoom(Math.round(boardPanZoom.scale * 100) + BOARD_ZOOM_STEP));
    if (boardZoomSelect) boardZoomSelect.addEventListener('change', () => setBoardZoom(Number(boardZoomSelect.value)));
  }
  function setupBoardAddTask(boardId) {
    if (!boardAddTaskBtn || !boardAddTaskPopover || !boardAddTaskListEl) return;
    boardAddTaskBtn.onclick = (e) => {
      e.stopPropagation();
      const open = !boardAddTaskPopover.classList.toggle('hidden');
      if (open) {
        const board = getBoards().find((b) => String(b.id) === String(boardId));
        const cards = getBoardCards(boardId);
        const placedIds = new Set(cards.map((c) => c.taskId));
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
            const maxX = cards.length ? Math.max(...cards.map((c) => c.x + (c.width || BOARD_DEFAULT_CARD_WIDTH))) : 0;
            const newCard = { taskId, x: maxX + 24, y: 80, width: BOARD_DEFAULT_CARD_WIDTH, height: BOARD_DEFAULT_CARD_HEIGHT };
            cards.push(newCard);
            setBoardCards(boardId, cards);
            renderBoardCards(boardId);
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
  }
  function buildBoardCardHtml(t, taskId, expandSvg) {
    const title = (t.title || '(no title)').replace(/</g, '&lt;');
    const statusComplete = isTaskCompleted(t);
    const flagged = t.flagged === true || t.flagged === 1;
    const priorityCls = priorityClass(t.priority);
    const av = (t.available_date || '').toString().trim().substring(0, 10);
    const due = (t.due_date || '').toString().trim().substring(0, 10);
    const statusSvg = statusComplete ? INSPECTOR_STATUS_TICK_SVG : INSPECTOR_STATUS_OPEN_SVG;
    const flagHtml = flagged ? '<span class="board-card-flagged">★</span>' : '';
    const avStr = av ? formatDate(av) : '';
    const dueStr = due ? formatDate(due) : '';
    const datesStr = [avStr && `Avail: ${avStr}`, dueStr && `Due: ${dueStr}`].filter(Boolean).join(' · ') || '—';
    return `
      <div class="board-card-header">
        <span class="board-card-priority priority-circle-wrap ${priorityCls}">${PRIORITY_CIRCLE_SVG}</span>
        ${flagHtml}
        <span class="board-card-status">${statusSvg}</span>
        <span class="board-card-title">${title}</span>
      </div>
      <div class="board-card-dates">${datesStr}</div>
      <div class="board-card-footer">
        <button type="button" class="board-card-expand" data-task-id="${(taskId || '').replace(/"/g, '&quot;')}" title="Expand" aria-label="Expand">${expandSvg}</button>
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
    const resizeHandle = el.querySelector('.board-card-resize-handle');
    if (header) {
      header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.board-card-expand') || e.target.closest('.board-card-resize-handle')) return;
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
          const nw = Math.max(180, startW + dw);
          const nh = Math.max(100, startH + dh);
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
        openBoardTaskInspectorModal(taskId, () => renderBoardCards(boardId));
      });
    }
    const priorityEl = el.querySelector('.board-card-priority');
    const statusEl = el.querySelector('.board-card-status');
    const flagEl = el.querySelector('.board-card-flagged');
    if (priorityEl) {
      priorityEl.addEventListener('click', (e) => {
        e.stopPropagation();
        openPriorityDropdown(e, priorityEl, { onAfterApply: () => api(`/api/external/tasks/${encodeURIComponent(taskId)}`).then((t2) => updateBoardCardContent(el, t2, boardId)) });
      });
    }
    if (statusEl) {
      statusEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const newStatus = isTaskCompleted(task) ? 'incomplete' : 'complete';
        updateTask(taskId, { status: newStatus }).then((t2) => updateBoardCardContent(el, t2, boardId));
      });
    }
    if (flagEl) {
      flagEl.addEventListener('click', (e) => {
        e.stopPropagation();
        updateTask(taskId, { flagged: !task.flagged }).then((t2) => updateBoardCardContent(el, t2, boardId));
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

  // --- # Hashtag autocomplete (title / description) ---
  let hashtagAutocompleteDropdown = null;
  let hashtagAutocompleteState = null;

  function getHashtagDropdown() {
    if (!hashtagAutocompleteDropdown) {
      const d = document.createElement('div');
      d.id = 'hashtag-autocomplete-dropdown';
      d.className = 'hashtag-autocomplete-dropdown hidden';
      d.setAttribute('role', 'listbox');
      document.body.appendChild(d);
      hashtagAutocompleteDropdown = d;
    }
    return hashtagAutocompleteDropdown;
  }

  function hideHashtagAutocomplete() {
    const dd = getHashtagDropdown();
    dd.classList.add('hidden');
    dd.innerHTML = '';
    hashtagAutocompleteState = null;
  }

  function showHashtagAutocomplete(anchorEl, fragment, tagNames, onSelect) {
    const filtered = (tagNames || []).filter((t) => t.toLowerCase().startsWith((fragment || '').toLowerCase())).slice(0, 10);
    const dd = getHashtagDropdown();
    dd.innerHTML = '';
    if (!filtered.length) {
      dd.classList.add('hidden');
      hashtagAutocompleteState = null;
      return;
    }
    const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    filtered.forEach((tag, i) => {
      const item = document.createElement('div');
      item.className = 'hashtag-autocomplete-item';
      item.setAttribute('role', 'option');
      item.dataset.tag = tag;
      item.dataset.index = String(i);
      item.innerHTML = '#' + escape(tag);
      item.addEventListener('click', () => {
        onSelect(tag);
        hideHashtagAutocomplete();
      });
      dd.appendChild(item);
    });
    const rect = anchorEl.getBoundingClientRect();
    dd.style.left = rect.left + 'px';
    dd.style.top = (rect.bottom + 2) + 'px';
    dd.style.minWidth = Math.max(rect.width, 120) + 'px';
    dd.classList.remove('hidden');
    hashtagAutocompleteState = { anchorEl, fragment, tagNames: filtered, onSelect, selectedIndex: 0 };
    dd.querySelectorAll('.hashtag-autocomplete-item').forEach((el, i) => el.classList.toggle('selected', i === 0));
  }

  function attachHashtagAutocomplete(el) {
    if (!el || el.dataset.hashtagAutocomplete === 'true') return;
    el.dataset.hashtagAutocomplete = 'true';

    el.addEventListener('input', () => {
      const value = el.value || '';
      const start = el.selectionStart != null ? el.selectionStart : value.length;
      const textBefore = value.substring(0, start);
      const lastHash = textBefore.lastIndexOf('#');
      if (lastHash === -1) {
        hideHashtagAutocomplete();
        return;
      }
      const fragment = textBefore.substring(lastHash + 1);
      if (!/^[a-zA-Z0-9_-]*$/.test(fragment)) {
        hideHashtagAutocomplete();
        return;
      }
      const tags = cachedTagNames.length ? cachedTagNames : [];
      const onSelect = (tag) => {
        const val = el.value || '';
        const st = el.selectionStart != null ? el.selectionStart : val.length;
        const before = val.substring(0, st);
        const hashIdx = before.lastIndexOf('#');
        if (hashIdx === -1) return;
        const newText = val.substring(0, hashIdx) + '#' + tag + ' ' + val.substring(st);
        el.value = newText;
        const newPos = hashIdx + 1 + tag.length + 1;
        el.setSelectionRange(newPos, newPos);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      showHashtagAutocomplete(el, fragment, tags, onSelect);
    });

    el.addEventListener('keydown', (e) => {
      if (!hashtagAutocompleteState || hashtagAutocompleteState.anchorEl !== el) return;
      const dd = getHashtagDropdown();
      if (dd.classList.contains('hidden')) return;
      const items = dd.querySelectorAll('.hashtag-autocomplete-item');
      if (!items.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        hashtagAutocompleteState.selectedIndex = (hashtagAutocompleteState.selectedIndex + 1) % items.length;
        items.forEach((item, i) => item.classList.toggle('selected', i === hashtagAutocompleteState.selectedIndex));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        hashtagAutocompleteState.selectedIndex = (hashtagAutocompleteState.selectedIndex - 1 + items.length) % items.length;
        items.forEach((item, i) => item.classList.toggle('selected', i === hashtagAutocompleteState.selectedIndex));
        return;
      }
      if (e.key === 'Enter' && items[hashtagAutocompleteState.selectedIndex]) {
        e.preventDefault();
        const tag = items[hashtagAutocompleteState.selectedIndex].dataset.tag;
        if (tag) hashtagAutocompleteState.onSelect(tag);
        hideHashtagAutocomplete();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        hideHashtagAutocomplete();
      }
    });

    el.addEventListener('blur', () => {
      setTimeout(hideHashtagAutocomplete, 150);
    });
  }

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
    loadTagDetails(tag);
    loadTagTasks(tag);
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
      document.getElementById('inspector-list-save').addEventListener('click', async () => {
        try {
          await api(`/api/external/lists/${encodeURIComponent(lid)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: (nameInput && nameInput.value) ? nameInput.value.trim() : undefined,
              description: (descInput && descInput.value) ? descInput.value.trim() : undefined,
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
      updateTaskInLists(t);
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
      html += '<p class="inspector-immediate-note">All changes are applied immediately.</p>';
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
      html += '<button type="button" class="inspector-action-icon inspector-delete-btn" data-task-id="' + escapeAttr(taskId) + '" title="Delete task" aria-label="Delete">';
      html += INSPECTOR_TRASH_SVG;
      html += '</button>';
      html += '</div>';

      div.innerHTML = '<div class="inspector-content-inner">' + html + '</div>';

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
          trigger.addEventListener('click', (ev) => openInspectorDateDropdown(ev, row));
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
            refreshCenterView();
          } catch (err) {
            alert(err.message || 'Failed to delete task.');
          }
        });
      });
    } catch (e) {
      document.getElementById('inspector-content').innerHTML = `<div class="inspector-content-inner"><p class="placeholder">${e.message || 'Error'}</p></div>`;
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
    { field: 'priority', label: 'Priority', valueType: 'number', operators: [
      { op: 'equals', label: 'equals' }, { op: 'greater_than', label: '>' }, { op: 'less_than', label: '<' }, { op: 'greater_or_equal', label: '>=' }, { op: 'less_or_equal', label: '<=' }
    ]},
    { field: 'flagged', label: 'Focused', valueType: 'flagged', operators: [{ op: 'equals', label: 'is' }] },
    { field: 'tags', label: 'Tags', valueType: 'tags', operators: [{ op: 'is_empty', label: 'is empty' }, { op: 'includes', label: 'includes' }, { op: 'excludes', label: 'excludes' }] },
    { field: 'project', label: 'Project', valueType: 'projects', operators: [{ op: 'is_empty', label: 'is empty' }, { op: 'includes', label: 'includes' }, { op: 'excludes', label: 'excludes' }] },
  ];
  const LIST_SORT_FIELDS = [
    { key: 'due_date', label: 'Due date' }, { key: 'available_date', label: 'Available date' }, { key: 'created_at', label: 'Created' }, { key: 'completed_at', label: 'Completed' }, { key: 'title', label: 'Name' }, { key: 'priority', label: 'Priority' }, { key: 'status', label: 'Status' }
  ];
  let currentListSettingsListId = null;

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
        : fieldConfig.valueType === 'flagged'
          ? `<div class="filter-value-wrap"><select class="list-filter-value"><option value="false" ${valueStr === 'false' || valueStr === '0' ? 'selected' : ''}>No</option><option value="true" ${valueStr === 'true' || valueStr === '1' ? 'selected' : ''}>Yes</option></select></div>`
          : `<div class="filter-value-wrap"><input type="text" class="list-filter-value" placeholder="${fieldConfig.valueType === 'tags' ? 'comma-separated tags' : fieldConfig.valueType === 'number' ? '0-3' : 'value'}" value="${(valueStr || '').replace(/"/g, '&quot;')}" /></div>`;
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
    filtersEl.querySelectorAll('.list-settings-filter-row').forEach((row) => {
      const removeBtn = row.querySelector('.list-settings-remove:not(.list-settings-group-remove)');
      if (removeBtn) removeBtn.onclick = () => row.remove();
      const fieldSelect = row.querySelector('.list-filter-field');
      if (fieldSelect) {
        fieldSelect.onchange = () => {
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
              : f.valueType === 'flagged'
                ? `<select class="list-filter-value"><option value="false">No</option><option value="true">Yes</option></select>`
                : `<input type="text" class="list-filter-value" placeholder="${f.valueType === 'tags' ? 'comma-separated tags' : f.valueType === 'number' ? '0-3' : 'value'}" />`;
          valueWrap.innerHTML = newValueHtml;
          bindDatePickerInRow(row);
        };
      }
      bindDatePickerInRow(row);
    });
    filtersEl.querySelectorAll('.list-settings-group-remove').forEach((btn) => {
      btn.onclick = () => btn.closest('.list-settings-filter-group').remove();
    });
    filtersEl.querySelectorAll('.list-settings-add-condition').forEach((btn) => {
      btn.onclick = () => {
        const group = btn.closest('.list-settings-filter-group');
        const children = group && group.querySelector('.list-settings-group-children');
        if (!children) return;
        const div = document.createElement('div');
        div.innerHTML = listSettingsConditionToRow({});
        children.appendChild(div.firstElementChild);
        setupListSettingsModalHandlers();
      };
    });
    filtersEl.querySelectorAll('.list-settings-add-group').forEach((btn) => {
      btn.onclick = () => {
        const group = btn.closest('.list-settings-filter-group');
        const children = group && group.querySelector('.list-settings-group-children');
        if (!children) return;
        const div = document.createElement('div');
        div.innerHTML = renderFilterGroup({ type: 'group', operator: 'AND', children: [] }, false);
        children.appendChild(div.firstElementChild);
        setupListSettingsModalHandlers();
      };
    });
    sortEl.querySelectorAll('.list-settings-remove').forEach((btn) => {
      btn.onclick = () => { btn.closest('.list-settings-sort-row').remove(); };
    });
    if (addSortBtn) addSortBtn.onclick = () => {
      const div = document.createElement('div');
      div.innerHTML = listSettingsSortToRow({});
      sortEl.appendChild(div.firstElementChild);
      setupListSettingsModalHandlers();
    };
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
    if (f.valueType === 'flagged') value = value === 'true' || value === '1';
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
    loadProjects();
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
  const newBoardName = document.getElementById('new-board-name');
  const newBoardBase = document.getElementById('new-board-base');
  const newBoardClose = document.getElementById('new-board-close');
  const newBoardCreate = document.getElementById('new-board-create');

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
    const fromProject = lastTaskSource && lastTaskSource !== 'inbox' && lastTaskSource !== 'search' && !lastTaskSource.startsWith('list:') && !lastTaskSource.startsWith('tag:');
    const fromTag = lastTaskSource && lastTaskSource.startsWith('tag:');
    newTaskState = {
      title: '',
      available_date: '',
      due_date: '',
      status: 'incomplete',
      flagged: false,
      description: '',
      recurrence: null,
      projects: fromProject ? [lastTaskSource] : [],
      tags: fromTag ? [lastTaskSource.slice(4)] : [],
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
    attachHashtagAutocomplete(titleInput);

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
        refreshLeftAndCenter();
      } catch (e) {
        alert(e.message || 'Failed to create task.');
      }
    });
  }

  const navigatorAddTaskBtn = document.getElementById('navigator-add-task-btn');
  const navigatorSearchInput = document.getElementById('navigator-search-input');
  const navigatorSearchBtn = document.getElementById('navigator-search-btn');
  if (navigatorAddTaskBtn) {
    navigatorAddTaskBtn.addEventListener('click', () => openNewTaskModal());
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
  function openNewBoardModal() {
    if (!newBoardOverlay || !newBoardBase) return;
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
      boards.push({ id, name, baseType, baseId });
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
