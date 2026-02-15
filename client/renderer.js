(function () {
  'use strict';

  const API_BASE_KEY = 'spaztick_api_base';
  const API_KEY_KEY = 'spaztick_api_key';

  const leftPanel = document.getElementById('left-panel');
  const rightPanel = document.getElementById('right-panel');
  const toggleLeft = document.getElementById('toggle-left');
  const toggleRight = document.getElementById('toggle-right');
  const projectsList = document.getElementById('projects-list');
  const chatMessages = document.getElementById('chat-messages');
  const chatInput = document.getElementById('chat-input');
  const chatSend = document.getElementById('chat-send');
  const settingsOverlay = document.getElementById('settings-overlay');
  const settingsBtn = document.getElementById('settings-btn');
  const settingsClose = document.getElementById('settings-close');
  const settingsSave = document.getElementById('settings-save');
  const settingsApiBase = document.getElementById('settings-api-base');
  const settingsApiKey = document.getElementById('settings-api-key');
  const connectionIndicator = document.getElementById('connection-indicator');

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

  // --- Load projects (left panel) ---
  async function loadProjects() {
    const key = getApiKey();
    if (!key) {
      projectsList.innerHTML = '<li class="nav-item placeholder">Set API key in Settings</li>';
      return;
    }
    try {
      const list = await api('/api/external/projects');
      if (!list || !list.length) {
        projectsList.innerHTML = '<li class="nav-item placeholder">No projects</li>';
        return;
      }
      projectsList.innerHTML = list.map((p) => {
        const name = (p.name || p.short_id || 'Project').replace(/</g, '&lt;');
        const shortId = (p.short_id || '').replace(/</g, '&lt;');
        return `<li class="nav-item" data-type="project" data-id="${(p.id || '').replace(/"/g, '&quot;')}" data-short-id="${shortId}">${name}${shortId ? ` (${shortId})` : ''}</li>`;
      }).join('');
      projectsList.querySelectorAll('.nav-item').forEach((el) => {
        el.addEventListener('click', onProjectClick);
      });
    } catch (e) {
      projectsList.innerHTML = `<li class="nav-item placeholder">${e.message || 'Error'}</li>`;
    }
  }

  function onProjectClick(ev) {
    const li = ev.currentTarget;
    if (li.classList.contains('placeholder')) return;
    projectsList.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('selected'));
    li.classList.add('selected');
    const type = li.dataset.type;
    const id = li.dataset.id;
    const shortId = li.dataset.shortId;
    document.getElementById('center-title').textContent = type === 'project' ? (li.textContent.trim() || 'Project') : 'List';
    document.getElementById('center-content').innerHTML = '<p class="placeholder">Loading tasks…</p>';
    document.getElementById('inspector-title').textContent = 'Inspector';
    document.getElementById('inspector-content').innerHTML = '<p class="placeholder">Select an item to inspect.</p>';
    if (type === 'project' && id) loadProjectTasks(id);
  }

  async function loadProjectTasks(projectIdOrShortId) {
    try {
      const tasks = await api(`/api/external/tasks?project_id=${encodeURIComponent(projectIdOrShortId)}`);
      const center = document.getElementById('center-content');
      if (!tasks || !tasks.length) {
        center.innerHTML = '<p class="placeholder">No tasks in this project.</p>';
        return;
      }
      center.innerHTML = '<ul class="task-list"></ul>';
      const ul = center.querySelector('.task-list');
      ul.style.listStyle = 'none';
      ul.style.padding = '0';
      ul.style.margin = '0';
      tasks.forEach((t) => {
        const li = document.createElement('li');
        li.className = 'nav-item';
        li.dataset.type = 'task';
        li.dataset.id = t.id || '';
        li.dataset.number = t.number != null ? String(t.number) : '';
        li.textContent = (t.title || '(no title)').trim() + (t.number != null ? ` #${t.number}` : '');
        li.style.marginBottom = '4px';
        li.addEventListener('click', onTaskClick);
        ul.appendChild(li);
      });
    } catch (e) {
      document.getElementById('center-content').innerHTML = `<p class="placeholder">${e.message || 'Error loading tasks'}</p>`;
    }
  }

  function onTaskClick(ev) {
    const li = ev.currentTarget;
    ev.stopPropagation();
    document.querySelectorAll('#center-content .nav-item').forEach((x) => x.classList.remove('selected'));
    li.classList.add('selected');
    const id = li.dataset.id;
    const num = li.dataset.number;
    document.getElementById('inspector-title').textContent = `Task ${num || id || ''}`;
    document.getElementById('inspector-content').innerHTML = '<p class="placeholder">Loading…</p>';
    if (id) loadTaskDetails(id);
  }

  async function loadTaskDetails(taskId) {
    try {
      const t = await api(`/api/external/tasks/${encodeURIComponent(taskId)}`);
      const div = document.getElementById('inspector-content');
      const title = (t.title || '(no title)').replace(/</g, '&lt;');
      const status = (t.status || 'incomplete').replace(/</g, '&lt;');
      let html = `<p><strong>${title}</strong></p><p>Status: ${status}</p>`;
      if (t.due_date) html += `<p>Due: ${String(t.due_date).replace(/</g, '&lt;')}</p>`;
      if (t.description) html += `<p>${String(t.description).replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`;
      div.innerHTML = html;
    } catch (e) {
      document.getElementById('inspector-content').innerHTML = `<p class="placeholder">${e.message || 'Error'}</p>`;
    }
  }

  // --- Chat ---
  function appendChatMessage(role, text) {
    const wrap = document.createElement('div');
    wrap.className = 'chat-message';
    wrap.innerHTML = `<div class="role">${role === 'user' ? 'You' : 'Model'}</div><div class="text">${String(text).replace(/</g, '&lt;').replace(/\n/g, '<br>')}</div>`;
    chatMessages.appendChild(wrap);
    chatMessages.scrollTop = chatMessages.scrollHeight;
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
      chatSend.disabled = false;
    }
  }

  // --- Init ---
  checkConnection();
  loadProjects();
  setInterval(checkConnection, 30000);
})();
