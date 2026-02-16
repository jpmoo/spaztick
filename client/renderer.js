(function () {
  'use strict';

  const API_BASE_KEY = 'spaztick_api_base';
  const API_KEY_KEY = 'spaztick_api_key';
  const THEME_KEY = 'spaztick_theme';
  const THEMES = ['light', 'dark', 'gray', 'blue', 'green', 'orange'];
  const DISPLAY_PROPERTIES_KEY = 'spaztick_display_properties';

  const TASK_PROPERTY_KEYS = ['number', 'due_date', 'available_date', 'priority', 'description', 'projects', 'tags'];
  const TASK_PROPERTY_LABELS = {
    number: 'Number',
    due_date: 'Due date',
    available_date: 'Available date',
    priority: 'Priority',
    description: 'Description',
    projects: 'Projects',
    tags: 'Tags',
  };
  let projectListCache = [];

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
  const connectionIndicator = document.getElementById('connection-indicator');
  const themeBtn = document.getElementById('theme-btn');
  const inboxItem = document.getElementById('inbox-item');

  let lastTasks = [];
  let lastTaskSource = null;

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
    closeSettings();
    checkConnection();
    loadProjects();
  }

  settingsBtn.addEventListener('click', openSettings);
  settingsClose.addEventListener('click', closeSettings);
  settingsSave.addEventListener('click', saveSettings);
  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) closeSettings();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !settingsOverlay.classList.contains('hidden')) closeSettings();
  });

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
      throw new Error(res.status === 401 ? 'Invalid API key' : res.status === 403 ? 'External API disabled' : text || res.statusText);
    }
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) return res.json();
    return res.text();
  }

  // --- Display settings (task properties & order) ---
  function getDisplayProperties() {
    try {
      const raw = localStorage.getItem(DISPLAY_PROPERTIES_KEY);
      if (raw) {
        const o = JSON.parse(raw);
        if (Array.isArray(o.order) && Array.isArray(o.visible)) {
          const visible = new Set(o.visible.filter((k) => TASK_PROPERTY_KEYS.includes(k)));
          const order = o.order.filter((k) => TASK_PROPERTY_KEYS.includes(k));
          return { order, visible };
        }
      }
    } catch (_) {}
    const order = ['number', 'due_date', 'priority'];
    return { order, visible: new Set(order) };
  }

  function saveDisplayProperties(order, visible) {
    localStorage.setItem(DISPLAY_PROPERTIES_KEY, JSON.stringify({
      order,
      visible: Array.from(visible),
    }));
  }

  function renderDisplayDropdown() {
    const listEl = document.getElementById('display-properties-list');
    if (!listEl) return;
    const { order, visible } = getDisplayProperties();
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
        const { order: o, visible: v } = getDisplayProperties();
        if (e.target.checked) v.add(key);
        else v.delete(key);
        if (!o.includes(key)) o.push(key);
        saveDisplayProperties(o, v);
        refreshTaskList();
      });
    });
    setupDisplayListDrag(listEl);
  }

  function setupDisplayListDrag(listEl) {
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
          const { visible } = getDisplayProperties();
          saveDisplayProperties(order, visible);
          refreshTaskList();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });
  }

  function refreshTaskList() {
    if (lastTasks.length && lastTaskSource) renderTaskList(lastTasks, lastTaskSource);
  }

  function projectIdToShortName(projectId) {
    const p = projectListCache.find((x) => x.id === projectId || String(x.id) === String(projectId));
    return p ? (p.short_id || p.name || projectId) : projectId;
  }

  function buildTaskRow(t) {
    const { order, visible } = getDisplayProperties();
    const row = document.createElement('div');
    row.className = 'task-row';
    row.dataset.type = 'task';
    row.dataset.id = t.id || '';
    row.dataset.number = t.number != null ? String(t.number) : '';
    row.addEventListener('click', onTaskClick);
    const statusComplete = (t.status || '').toLowerCase() === 'complete' || (t.status || '').toLowerCase() === 'completed' || (t.status || '').toLowerCase() === 'done' || (t.status || '').toLowerCase() === 'finished';
    const circleOpenSvg = '<svg class="status-icon" viewBox="0 0 32 32" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M0 16q0 3.264 1.28 6.208t3.392 5.12 5.12 3.424 6.208 1.248 6.208-1.248 5.12-3.424 3.392-5.12 1.28-6.208-1.28-6.208-3.392-5.12-5.088-3.392-6.24-1.28q-3.264 0-6.208 1.28t-5.12 3.392-3.392 5.12-1.28 6.208zM4 16q0-3.264 1.6-6.016t4.384-4.352 6.016-1.632 6.016 1.632 4.384 4.352 1.6 6.016-1.6 6.048-4.384 4.352-6.016 1.6-6.016-1.6-4.384-4.352-1.6-6.048z"/></svg>';
    const circleTickSvg = '<svg class="status-icon" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M0 8c0 4.418 3.59 8 8 8 4.418 0 8-3.59 8-8 0-4.418-3.59-8-8-8-4.418 0-8 3.59-8 8zm2 0c0-3.307 2.686-6 6-6 3.307 0 6 2.686 6 6 0 3.307-2.686 6-6 6-3.307 0-6-2.686-6-6zm9.778-1.672l-1.414-1.414L6.828 8.45 5.414 7.036 4 8.45l2.828 2.828 3.182-3.182 1.768-1.768z" fill-rule="evenodd"/></svg>';
    const folderOpenSvg = '<svg class="project-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M2 6C2 4.34315 3.34315 3 5 3H7.75093C8.82997 3 9.86325 3.43595 10.6162 4.20888L9.94852 4.85927L10.6162 4.20888L11.7227 5.34484C11.911 5.53807 12.1693 5.64706 12.4391 5.64706H16.4386C18.5513 5.64706 20.281 7.28495 20.4284 9.35939C21.7878 9.88545 22.5642 11.4588 21.977 12.927L20.1542 17.4853C19.5468 19.0041 18.0759 20 16.4402 20H6C4.88522 20 3.87543 19.5427 3.15116 18.8079C2.44035 18.0867 2 17.0938 2 16V6ZM18.3829 9.17647C18.1713 8.29912 17.3812 7.64706 16.4386 7.64706H12.4391C11.6298 7.64706 10.8548 7.3201 10.2901 6.7404L9.18356 5.60444L9.89987 4.90666L9.18356 5.60444C8.80709 5.21798 8.29045 5 7.75093 5H5C4.44772 5 4 5.44772 4 6V14.4471L5.03813 11.25C5.43958 10.0136 6.59158 9.17647 7.89147 9.17647H18.3829ZM5.03034 17.7499L6.94036 11.8676C7.07417 11.4555 7.45817 11.1765 7.89147 11.1765H19.4376C19.9575 11.1765 20.3131 11.7016 20.12 12.1844L18.2972 16.7426C17.9935 17.502 17.258 18 16.4402 18H6C5.64785 18 5.31756 17.9095 5.03034 17.7499Z"/></svg>';

    function addCell(key, html) {
      if (!html) return;
      const cell = document.createElement('div');
      cell.className = 'task-cell ' + key + '-cell';
      cell.innerHTML = html;
      row.appendChild(cell);
    }

    addCell('status', statusComplete ? circleTickSvg : circleOpenSvg);
    addCell('title', `<span class="cell-value">${(t.title || '(no title)').trim().replace(/</g, '&lt;')}</span>`);

    order.forEach((key) => {
      if (!visible.has(key)) return;
      let html = '';
      if (key === 'number') {
        html = t.number != null ? `<span class="cell-value">#${t.number}</span>` : '';
      } else if (key === 'available_date') {
        if (t.available_date) {
          const escaped = String(t.available_date).replace(/</g, '&lt;');
          const calEventSvg = '<svg class="date-icon calendar-event-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M4 8H20M4 8V16.8002C4 17.9203 4 18.4801 4.21799 18.9079C4.40973 19.2842 4.71547 19.5905 5.0918 19.7822C5.5192 20 6.07899 20 7.19691 20H16.8031C17.921 20 18.48 20 18.9074 19.7822C19.2837 19.5905 19.5905 19.2842 19.7822 18.9079C20 18.4805 20 17.9215 20 16.8036V8M4 8V7.2002C4 6.08009 4 5.51962 4.21799 5.0918C4.40973 4.71547 4.71547 4.40973 5.0918 4.21799C5.51962 4 6.08009 4 7.2002 4H8M20 8V7.19691C20 6.07899 20 5.5192 19.7822 5.0918C19.5905 4.71547 19.2837 4.40973 18.9074 4.21799C18.4796 4 17.9203 4 16.8002 4H16M8 4H16M8 4V2M16 4V2M11.75 16C11.8881 16 12 15.8881 12 15.75V12.25C12 12.1119 11.8881 12 8.25 12V15.75C8 15.8881 8.11193 16 8.25 16H11.75Z"/></svg>';
          html = calEventSvg + `<span class="cell-value">${escaped}</span>`;
        }
      } else if (key === 'due_date') {
        if (t.due_date) {
          const escaped = String(t.due_date).replace(/</g, '&lt;');
          const today = isToday(t.due_date);
          const overdue = isOverdue(t.due_date);
          const stateClass = overdue ? 'due-overdue' : (today ? 'due-today' : '');
          const calCheckSvg = '<svg class="date-icon calendar-check-icon ' + stateClass + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M4 8H20M4 8V16.8002C4 17.9203 4 18.4801 4.21799 18.9079C4.40973 19.2842 4.71547 19.5905 5.0918 19.7822C5.5192 20 6.07899 20 7.19691 20H16.8031C17.921 20 18.48 20 18.9074 19.7822C19.2837 19.5905 19.5905 19.2842 19.7822 18.9079C20 18.4805 20 17.9215 20 16.8036V8M4 8V7.2002C4 6.08009 4 5.51962 4.21799 5.0918C4.40973 4.71547 4.71547 4.40973 5.0918 4.21799C5.51962 4 6.08009 4 7.2002 4H8M20 8V7.19691C20 6.07899 20 5.5192 19.7822 5.0918C19.5905 4.71547 19.2837 4.40973 18.9074 4.21799C18.4796 4 17.9203 4 16.8002 4H16M8 4H16M8 4V2M16 4V2M15 12L11 16L9 14"/></svg>';
          html = calCheckSvg + `<span class="cell-value ${stateClass}">${escaped}</span>`;
        }
      } else if (key === 'priority') {
        html = t.priority != null ? `<span class="cell-value">${t.priority}</span>` : '';
      } else if (key === 'description') {
        const d = (t.description || '').trim();
        html = d ? `<span class="cell-value" title="${d.replace(/"/g, '&quot;').substring(0, 200)}">${d.substring(0, 50).replace(/</g, '&lt;')}${d.length > 50 ? '…' : ''}</span>` : '';
      } else if (key === 'projects') {
        const p = (t.projects || []);
        if (p.length) {
          const names = p.map((id) => projectIdToShortName(id)).map((s) => String(s).replace(/</g, '&lt;'));
          html = folderOpenSvg + '<span class="cell-value">' + names.join(', ') + '</span>';
        }
      } else if (key === 'tags') {
        const tg = (t.tags || []);
        html = tg.length ? `<span class="cell-value">${tg.join(', ').replace(/</g, '&lt;')}</span>` : '';
      }
      addCell(key, html);
    });
    return row;
  }

  function renderTaskList(tasks, source) {
    lastTasks = tasks;
    lastTaskSource = source;
    const center = document.getElementById('center-content');
    if (!tasks || !tasks.length) {
      center.innerHTML = '<p class="placeholder">No tasks.</p>';
      return;
    }
    const ul = document.createElement('ul');
    ul.className = 'task-list';
    ul.style.listStyle = 'none';
    ul.style.padding = '0';
    ul.style.margin = '0';
    tasks.forEach((t) => ul.appendChild(buildTaskRow(t)));
    center.innerHTML = '';
    center.appendChild(ul);
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
    try {
      const list = await api('/api/external/projects');
      projectListCache = Array.isArray(list) ? list : [];
      if (!projectListCache.length) {
        projectsList.innerHTML = '<li class="nav-item placeholder">No projects</li>';
        return;
      }
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
  function formatInspectorValue(key, value) {
    if (value == null || value === '') return null;
    if (key === 'description' || key === 'notes') return escapeHtml(value);
    if (Array.isArray(value)) return value.length ? escapeHtml(value.join(', ')) : null;
    if (typeof value === 'object') return escapeHtml(JSON.stringify(value));
    if (key === 'flagged') return value ? 'Yes' : 'No';
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
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
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

  // --- Init ---
  if (inboxItem) inboxItem.addEventListener('click', onInboxClick);
  checkConnection();
  loadProjects();
  setInterval(checkConnection, 30000);
})();
