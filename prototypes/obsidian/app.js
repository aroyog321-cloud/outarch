/* Obsidian is a standalone design prototype. Every operational action below is
   a local simulation. No Electron bridge, shell, network or provider is called. */
(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => (({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    '\'': '&#39;'
  })[char]));

  const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const button = (label, action, glyph = '', variant = '', extra = '') => `<button type="button" class="btn ${variant}" data-action="${action}" ${extra}>${glyph ? icon(glyph) : ''}${label}</button>`;
  const iconButton = (label, action, glyph, extra = '') => `<button type="button" class="icon-button" aria-label="${escape(label)}" title="${escape(label)}" data-action="${action}" ${extra}>${icon(glyph)}</button>`;
  const link = (route, label, glyph = '') => `<a href="#${route}" class="link-button">${label}${glyph ? icon(glyph) : ''}</a>`;
  const badge = (state, label = '') => `<span class="pill ${state}"><span class="dot" aria-hidden="true"></span>${escape(label || state[0].toUpperCase() + state.slice(1))}</span>`;
  const storageKey = 'mission-control.obsidian.prototype.v1';
  let demoGeneration = 0;

  function deferDemo(callback, delay) {
    const generation = demoGeneration;
    setTimeout(() => {
      if (generation === demoGeneration) callback();
    }, delay);
  }

  // Saved assistant cards contain only this small markup vocabulary. Local
  // browser storage is not a source of executable HTML or arbitrary actions.
  function safeReply(value) {
    const template = document.createElement('template');
    template.innerHTML = String(value || '');
    const tags = new Set(['P', 'STRONG', 'CODE', 'OL', 'LI', 'BUTTON', 'I']);
    const attrs = new Set(['class', 'type', 'data-action', 'data-id', 'data-lucide', 'aria-hidden']);
    for (const node of [...template.content.querySelectorAll('*')]) {
      if (!tags.has(node.tagName)) { node.remove(); continue; }
      for (const attribute of [...node.attributes]) {
        if (!attrs.has(attribute.name)) node.removeAttribute(attribute.name);
      }
      if (node.tagName === 'BUTTON') {
        node.type = 'button';
        if (!['inspect', 'needs', 'launch'].includes(node.dataset.action)) node.remove();
      }
    }
    return template.innerHTML;
  }

  const nav = [
    ['groundstation', 'Groundstation', 'layout-dashboard'],
    ['workspace', 'Workspace', 'panels-top-left'],
    ['needs', 'Needs You', 'inbox'],
    ['agents', 'Agents', 'bot'],
    ['recipes', 'Recipes', 'workflow'],
    ['history', 'History', 'history'],
    ['settings', 'Settings', 'settings-2']
  ];

  const routes = [
    ...nav,
    ['ai', 'Mission AI', 'sparkles'],
    ['integrations', 'Integrations', 'blocks'],
    ['projects', 'Projects', 'folder-open']
  ];

  const workerFixtures = [{
    id: 'web',
    name: 'Web application',
    role: 'Frontend',
    command: 'npm run dev',
    state: 'running',
    port: '5173',
    icon: 'app-window',
    detail: 'Ready in 384 ms',
    activity: '12s ago',
    cpu: '2.4%',
    memory: '186 MB'
  }, {
    id: 'api',
    name: 'API server',
    role: 'Backend',
    command: 'npm run dev:api',
    state: 'running',
    port: '3000',
    icon: 'server',
    detail: 'GET /health → 200',
    activity: '24s ago',
    cpu: '1.1%',
    memory: '92 MB'
  }, {
    id: 'db',
    name: 'PostgreSQL',
    role: 'Database',
    command: 'docker compose up db',
    state: 'running',
    port: '5432',
    icon: 'database',
    detail: 'Accepting connections',
    activity: '1m ago',
    cpu: '0.8%',
    memory: '128 MB'
  }, {
    id: 'tests',
    name: 'Test runner',
    role: 'Quality',
    command: 'npm test',
    state: 'failed',
    port: 'Exit 1',
    icon: 'flask-conical',
    detail: '3 assertions failed',
    activity: '2m ago',
    cpu: '0%',
    memory: '0 MB'
  }, {
    id: 'shell',
    name: 'Project shell',
    role: 'Utilities',
    command: 'powershell.exe',
    state: 'idle',
    port: '—',
    icon: 'terminal',
    detail: 'Ready when you are',
    activity: '8m ago',
    cpu: '0%',
    memory: '0 MB'
  }, {
    id: 'watch',
    name: 'File watcher',
    role: 'Utilities',
    command: 'npm run watch',
    state: 'running',
    port: 'Watching',
    icon: 'scan-eye',
    detail: 'Watching 142 source files',
    activity: '34s ago',
    cpu: '0.3%',
    memory: '46 MB'
  }];

  const decisionFixtures = [{
    id: 'test-failure',
    worker: 'tests',
    title: 'Test runner needs a closer look',
    summary: 'Three assertions failed in the authentication suite.',
    source: 'Test runner',
    type: 'failure',
    status: 'pending',
    time: '2m ago',
    evidence: 'FAIL  test/auth.test.ts\n\n  × rejects expired access tokens\n  × refreshes the session after rotation\n  × clears credentials on sign out\n\n  Expected: 401\n  Received: 200\n\nTests  3 failed · 41 passed · 44 total\nProcess exited with code 1.',
    impact: 'The authentication checks did not pass. The development server and database are still running.'
  }, {
    id: 'mcp-access',
    title: 'Claude requests project access',
    summary: 'Review a read-only request for the current project.',
    source: 'Secure MCP',
    type: 'approval',
    status: 'pending',
    time: '4m ago',
    evidence: 'Requester    Claude Code / local client\nCapability   filesystem.read\nScope        ./src and ./test\nDuration     This request only\nNetwork      None\nWrite access Not requested',
    impact: 'Approval would let this client read the named project folders once. It does not grant write or shell access.'
  }];

  const initial = () => ({
    workers: structuredClone(workerFixtures),
    decisions: structuredClone(decisionFixtures),

    recipes: [{
      id: 'full',
      name: 'Full development stack',
      description: 'Bring the database, API and frontend online in the right order.',
      workers: ['db', 'api', 'web'],
      icon: 'layers-3',
      last: 'Last run 18 minutes ago'
    }, {
      id: 'verify',
      name: 'Test & verify',
      description: 'Start the API, then run the project’s verification suite.',
      workers: ['api', 'tests'],
      icon: 'flask-conical',
      last: 'Last run 2 minutes ago'
    }, {
      id: 'minimal',
      name: 'Frontend focus',
      description: 'A lightweight workspace for interface development.',
      workers: ['web', 'shell'],
      icon: 'panel-top',
      last: 'Last run yesterday'
    }],

    history: [{
      id: 'e1',
      title: 'Authentication checks failed',
      detail: 'Test runner · 3 failed, 41 passed',
      type: 'failure',
      actor: 'Test runner',
      time: '14:32:08'
    }, {
      id: 'e2',
      title: 'Project access requested',
      detail: 'Secure MCP · filesystem.read · awaiting review',
      type: 'approval',
      actor: 'Secure MCP',
      time: '14:30:16'
    }, {
      id: 'e3',
      title: 'API health check passed',
      detail: 'API server · GET /health → 200',
      type: 'success',
      actor: 'API server',
      time: '14:28:41'
    }, {
      id: 'e4',
      title: 'Full development stack started',
      detail: '3 workers · database → API → web',
      type: 'recipe',
      actor: 'You',
      time: '14:16:23'
    }, {
      id: 'e5',
      title: 'Claude finished the route audit',
      detail: 'Agent · 6 files reviewed · evidence captured',
      type: 'agent',
      actor: 'Claude Code',
      time: '14:12:05'
    }],

    prefs: {
      material: 'solid',
      density: 'comfortable',
      motion: true,
      transparency: true,
      notifications: true,
      terminalSize: '13',
      cursor: 'Block',
      copySelection: false,
      autoStart: false
    },

    integrations: {
      vscode: true,
      mcp: true,
      automation: false,
      mobile: false,
      plugins: true,
      intelligence: true
    },

    projects: [{
      name: 'Mission Control',
      path: 'D:/Projects/mission-control',
      branch: 'main'
    }, {
      name: 'Commerce API',
      path: 'D:/Projects/commerce-api',
      branch: 'feat/auth-refresh'
    }, {
      name: 'Design system',
      path: 'D:/Projects/design-system',
      branch: 'main'
    }],

    project: 0,
    agentNames: ['Claude Code', 'Codex'],
    agentStates: ['running', 'running'],
    messages: []
  });

  let state = initial();

  try {
    const stored = JSON.parse(localStorage.getItem(storageKey));

    if (stored?.version === 1 && stored.state?.workers?.length && stored.state?.prefs) state = {
      ...state,
      ...stored.state
    };
  } catch {}

  const ui = {
    route: 'groundstation',
    filter: 'all',
    query: '',
    decision: 'test-failure',
    decisionFilter: 'active',
    agent: 0,
    settings: 'appearance',
    historyQuery: '',
    historyFilter: 'all',
    terminal: 'web',
    layout: 'split',
    scenario: 'normal',
    mobile: false,
    terminalOutput: {},
    paletteQuery: '',
    modalTrigger: null
  };

  const pending = () => state.decisions.filter(d => ['pending', 'acknowledged'].includes(d.status));
  const running = () => state.workers.filter(w => w.state === 'running');
  const currentProject = () => state.projects[state.project] || state.projects[0];

  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        version: 1,
        state
      }));
    } catch {}
  }

  function hydrate() {
    window.lucide?.createIcons({
      attrs: {
        'stroke-width': 1.6
      }
    });
  }

  function applyPrefs() {
    // This prototype intentionally has one visual system: the Vercel-inspired dark canvas.
    state.prefs.material = 'solid';
    document.body.dataset.material = 'solid';
    document.body.dataset.density = state.prefs.density;
    document.body.dataset.transparency = state.prefs.transparency ? 'on' : 'off';
    document.body.classList.toggle('reduce-motion', !state.prefs.motion);
  }

  function event(title, detail, type = 'success', actor = 'You') {
    state.history.unshift({
      id: crypto.randomUUID(),
      title,
      detail,
      type,
      actor,
      time: new Date().toLocaleTimeString('en-GB')
    });

    state.history = state.history.slice(0, 100);
    save();
  }

  function toast(message, detail = 'Local prototype only') {
    const region = $('#toasts');
    region.innerHTML = `<div class="toast">${icon('circle-check')}<div>${escape(message)}<small>${escape(detail)}</small></div>${iconButton('Dismiss notification', 'dismiss-toast', 'x')}</div>`;
    hydrate();
  }

  function go(route) {
    if (location.hash === `#${route}`) {
      ui.route = route;
      render();
      $('#content').focus();
    } else
      location.hash = route;
  }

  function pageHead(title, description, actions = '', eyebrow = '') {
    return `<div class="page-head"><div>${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ''}<h1>${title}</h1><p>${description}</p></div><div class="actions">${actions}</div></div>`;
  }

  function empty(title, description, action = '', glyph = 'inbox') {
    return `<div class="empty-state">${icon(glyph)}<h2>${title}</h2><p>${description}</p>${action}</div>`;
  }

  function renderShell() {
    const route = routes.find(r => r[0] === ui.route) || routes[0];
    $('#sidebar').classList.toggle('mobile-open', ui.mobile);

    $('#sidebar').innerHTML = `<button class="btn mobile-close" data-action="mobile-menu">Close navigation</button><a href="#groundstation" class="wordmark" aria-label="Mission Control home"><span class="brand-mark" aria-hidden="true">MC</span><div><span class="brand-name">Mission Control</span><small>Everything in its orbit.</small></div></a><button class="project-switch" data-action="projects"><span class="project-avatar">${escape(currentProject().name.slice(0, 2).toUpperCase())}</span><span><strong>${escape(currentProject().name)}</strong><small>Local workspace</small></span>${icon('chevrons-up-down')}</button><nav aria-label="Main navigation"><div class="nav-label">Workspace</div><div class="nav-group">${nav.map(
  ([id, label, glyph], i) => `<a class="nav-item ${ui.route === id ? 'active' : ''}" href="#${id}" ${ui.route === id ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span>${id === 'needs' && pending().length ? `<span class="count">${pending().length}</span>` : i < 2 ? `<kbd>${i + 1}</kbd>` : ''}</a>`
).join('')}</div></nav><nav aria-label="Connected tools"><div class="nav-label">Connected tools</div><div class="nav-group"><a class="nav-item ${ui.route === 'ai' ? 'active' : ''}" href="#ai" ${ui.route === 'ai' ? 'aria-current="page"' : ''}>${icon('sparkles')}<span>Mission AI</span></a><a class="nav-item ${ui.route === 'integrations' ? 'active' : ''}" href="#integrations" ${ui.route === 'integrations' ? 'aria-current="page"' : ''}>${icon('blocks')}<span>Integrations</span></a></div></nav><div class="sidebar-bottom"><div class="sidebar-note"><div class="line"><span class="dot mint"></span><span>Made for your machine</span></div><p>Local workspace. You’re in control.</p></div><div class="profile"><div class="avatar">SK</div><div><span>Satish Kumar</span><small>Personal workspace</small></div>${iconButton('Open settings', 'settings', 'chevrons-up-down')}</div></div>`;

    $('#topbar').innerHTML = `<div class="breadcrumb">${iconButton('Toggle navigation', 'mobile-menu', 'menu', `aria-expanded="${ui.mobile}" aria-controls="sidebar"`).replace('class="icon-button"', 'class="icon-button mobile-menu"')}<span>Workspace</span><span class="slash">/</span><strong>${route[1]}</strong></div><div class="top-actions"><span class="demo-badge"><span class="demo-full">INTERACTIVE DEMO</span><span class="demo-short">DEMO</span></span><button class="command-trigger" data-action="palette" aria-label="Search commands, Control K">${icon('search')}<span>Jump to anything…</span><kbd>Ctrl K</kbd></button>${iconButton('Keyboard shortcuts', 'shortcuts', 'circle-help')}${iconButton('Open Needs You', 'needs', 'bell')}</div>`;
    $('#statusbar').innerHTML = `<div><span><span class="dot ${ui.scenario === 'disconnected' ? 'amber' : 'mint'}"></span>${ui.scenario === 'disconnected' ? 'Disconnected scenario' : 'Demo engine'}</span><span class="status-detail">${icon('git-branch')}${escape(currentProject().branch)}</span><span class="status-detail">${running().length} workers running</span></div><div><span class="demo-footer">Simulated data · no commands execute</span><button data-action="tweaks">${icon('sliders-horizontal')} Tweaks</button></div>`;
  }

  function render() {
    applyPrefs();
    renderShell();

    const views = {
      groundstation,
      workspace,
      needs,
      agents,
      recipes,
      history,
      settings,
      ai,
      integrations,
      projects
    };

    $('#content').innerHTML = (views[ui.route] || groundstation)();
    document.title = `${routes.find(r => r[0] === ui.route)?.[1] || 'Groundstation'} · Mission Control`;
    hydrate();
  }

  function workerRows() {
    const workers = state.workers.filter(
      w => (ui.filter === 'all' || w.state === ui.filter) && `${w.name} ${w.command} ${w.role}`.toLowerCase().includes(ui.query.toLowerCase())
    );

    if (!workers.length) return `<tr><td colspan="5">${empty(
  'No workers match',
  `Try another name or clear the current filters.`,
  button('Clear filters', 'clear-workers', 'x')
)}</td></tr>`;

    return workers.map(
      w => `<tr class="worker-row worker-row--${w.state}"><td><div class="worker-cell"><span class="worker-symbol">${icon(w.icon)}</span><div><button class="worker-name" data-action="inspect" data-id="${w.id}">${escape(w.name)}</button><small>${escape(w.command)}</small></div></div></td><td>${badge(w.state)}</td><td class="runtime-column"><span class="table-sub mono">${escape(w.port)}</span></td><td class="evidence-column"><span class="table-sub">${escape(w.activity)}</span></td><td class="table-actions">${iconButton(`Inspect ${w.name}`, 'inspect', 'arrow-up-right', `data-id="${w.id}"`)}</td></tr>`
    ).join('');
  }

  function workerRegister() {
    return `<section class="panel"><div class="panel-head"><h2>Project operations <span class="muted" style="font-weight:400">${state.workers.length}</span></h2>${button('Add worker', 'add-worker', 'plus', 'quiet')}</div><div class="toolbar"><div class="segmented" role="group" aria-label="Filter workers">${[['all', 'All workers'], ['running', 'Running'], ['failed', 'Failed'], ['idle', 'Idle']].map(
  ([id, label]) => `<button data-action="filter-workers" data-id="${id}" aria-pressed="${ui.filter === id}">${label}</button>`
).join('')}</div><label class="search">${icon('search')}<span class="sr-only">Search workers</span><input id="worker-search" placeholder="Search workers…" value="${escape(ui.query)}"></label></div><table class="worker-table"><caption class="sr-only">Configured demo workers and their process states</caption><thead><tr><th scope="col">Worker / command</th><th scope="col">Status</th><th scope="col" class="runtime-column">Port / runtime</th><th scope="col" class="evidence-column">Activity</th><th scope="col"><span class="sr-only">Inspect</span></th></tr></thead><tbody id="worker-rows">${workerRows()}</tbody></table><div class="panel-foot"><span id="worker-count">${state.workers.length} workers in this project</span>${link('workspace', 'Open workspace', 'arrow-up-right')}</div></section>`;
  }

  function activityRows(events, full = false) {
    return events.map(
      e => `<div class="event-row"><div class="event-mark ${e.type === 'failure' ? 'red' : e.type === 'approval' ? 'amber' : ''}">${icon({
  failure: 'circle-alert',
  approval: 'shield-check',
  success: 'check',
  recipe: 'workflow',
  agent: 'bot'
}[e.type] || 'activity')}</div><div><strong>${escape(e.title)}</strong><small>${escape(e.detail)}</small></div><time>${escape(full ? e.time : e.time.slice(0, 5))}</time></div>`
    ).join('');
  }

  function groundstation() {
    const head = pageHead(
      'Groundstation',
      'A clear view of your project, from one place.',
      button('Mission graph', 'graph', 'git-fork', 'quiet') + button('Run recipe', 'launch-picker', 'play', 'primary')
    );

    if (ui.scenario === 'empty') return head + `<section class="panel">${empty(
  'Make room for your next idea',
  'Add a worker to your demo project, or start with a ready-made recipe.',
  button('Add your first worker', 'add-worker', 'plus', 'primary'),
  'folder-plus'
)}</section>`;

    if (ui.scenario === 'loading') return head + `<section class="panel" aria-busy="true"><div class="panel-head"><h2>Loading workspace…</h2>${button('Finish loading', 'finish-scenario', 'check')}</div>${Array.from({
  length: 8
}, () => '<div class="skeleton"></div>').join('')}</section>`;

    const count = pending().length;

    return head + (ui.scenario === 'disconnected' ? `<div class="notice-bar">${icon('wifi-off')}<span>Demo connection interrupted. Last known state is shown.</span>${button('Reconnect', 'reconnect', 'refresh-cw')}</div>` : '') + `<section class="briefing ${count ? 'briefing--attention' : 'briefing--clear'}"><span class="brief-icon">${icon(count ? 'scan-line' : 'check')}</span><div><h2>${count ? 'Your workspace is moving. Two things to check.'.replace('Two', count === 2 ? 'Two' : String(count)) : 'Everything is in a good place.'}</h2><p>${running().length} workers online. ${count ? `${count} items need your attention before the next step.` : 'No open decisions in this demo workspace.'}</p></div>${button(
  count ? 'Review attention' : 'Open workspace',
  count ? 'needs' : 'workspace',
  count ? 'arrow-right' : 'terminal'
)}</section><div class="overview-metrics"><div class="metric"><div class="metric-label">${icon('activity')}Active workers</div><div class="metric-value">${running().length}<small>/ ${state.workers.length}</small></div><div class="metric-foot"><span class="mint">${running().length} running</span> · ${state.workers.filter(w => w.state === 'idle').length} idle</div></div><div class="metric"><div class="metric-label">${icon('bot')}AI agents</div><div class="metric-value">${state.agentStates.filter(s => s === 'running').length}<small>active</small></div><div class="metric-foot">Working alongside you</div></div><div class="metric"><div class="metric-label">${icon('inbox')}Needs attention</div><div class="metric-value ${count ? 'amber' : ''}">${count.toString().padStart(2, '0')}<small>items</small></div><div class="metric-foot">${count ? 'Review, decide, move forward' : 'All decisions reviewed'}</div></div><div class="metric"><div class="metric-label">${icon('git-branch')}Current branch</div><div class="metric-value" style="font-size:24px;margin-top:12px">${escape(currentProject().branch)}</div><div class="metric-foot">Demo repository · local workspace</div></div></div><div class="dashboard-grid"><div>${workerRegister()}<div class="lower-grid"><section class="panel"><div class="panel-head"><h2>Recent activity</h2>${link('history', 'View all', 'arrow-up-right')}</div>${activityRows(state.history.slice(0, 3))}<div style="height:10px"></div></section><section class="panel"><div class="panel-head"><h2>Ready to run</h2>${link('recipes', 'Recipes', 'arrow-up-right')}</div>${state.recipes.slice(0, 3).map(
  r => `<div class="recipe-compact">${icon(r.icon)}<div><strong>${escape(r.name)}</strong><small>${r.workers.length} workers · ordered launch</small></div>${iconButton(`Run ${r.name}`, 'launch', 'play', `data-id="${r.id}"`)}</div>`
).join('')}<div style="height:10px"></div></section></div></div><aside class="rail" aria-label="Project context"><section class="panel"><div class="panel-head"><h2>${icon('inbox')}Needs You</h2><span class="pill pending">${count}</span></div>${count ? pending().slice(0, 2).map(
  d => `<div class="decision-preview"><div class="source">${escape(d.source)} · ${d.time}</div><h3 class="${d.type === 'failure' ? 'red' : 'amber'}">${icon(d.type === 'failure' ? 'circle-alert' : 'shield-check')}${d.type === 'failure' ? 'Tests need attention' : 'Access request'}</h3><p>${escape(d.summary)}</p>${button(
  'Review ' + (d.type === 'failure' ? 'failure' : 'request'),
  'review',
  'arrow-right',
  '',
  `data-id="${d.id}"`
)}</div>`
).join('') : `<div class="decision-preview"><h3 class="mint">${icon('check')}All caught up</h3><p>New decisions will appear here.</p></div>`}</section><section class="panel"><div class="panel-head"><h2>Working alongside you</h2>${link('agents', 'View', 'arrow-up-right')}</div>${state.agentNames.map(
  (name, i) => `<a class="agent-mini" href="#agents"><div class="agent-monogram ${i ? 'blue' : ''}">${name.slice(0, 2)}</div><div><strong>${escape(name)}</strong><small>${state.agentStates[i] === 'running' ? (i ? 'Reviewing authentication' : 'Mapping the project') : 'Paused by you'}</small></div><span class="dot" style="color:var(${state.agentStates[i] === 'running' ? '--mint' : '--muted'})" aria-label="${state.agentStates[i]}"></span></a>`
).join('')}<div class="panel-foot">${link('ai', 'Ask Mission AI for a briefing', 'sparkles')}</div></section></aside></div>`;
  }

  const logs = {
    web: [
      '$ npm run dev',
      '',
      'VITE 6.4.3   ready in 384 ms',
      '',
      '➜  Local:   http://localhost:5173/',
      '➜  Network: use --host to expose',
      '',
      '14:34:12  [vite] page reload src/App.tsx'
    ],

    api: [
      '$ npm run dev:api',
      '',
      '[server] Listening on localhost:3000',
      '[db] Connection pool established',
      '',
      'GET  /health           200   4 ms',
      'GET  /api/projects     200  12 ms',
      'GET  /api/workers      200   8 ms'
    ],

    db: [
      '$ docker compose up db',
      '',
      '[postgres] Database directory ready',
      '[postgres] Listening on port 5432',
      '[postgres] Ready to accept connections',
      '',
      'LOG: checkpoint complete'
    ],

    tests: [
      '$ npm test',
      '',
      'FAIL  test/auth.test.ts',
      '',
      '× rejects expired access tokens',
      '× refreshes session after rotation',
      '× clears credentials on sign out',
      '',
      'Tests  3 failed · 41 passed',
      'Process exited with code 1.'
    ],

    shell: [
      '$ powershell.exe',
      '',
      'Mission Control / project shell',
      '',
      'Demo commands: help, pwd, clear, npm test',
      'Input is simulated. No shell is running.'
    ],

    watch: ['$ npm run watch', '', 'Watching 142 files in ./src', 'Waiting for changes…']
  };

  function terminalPanel(worker, index) {
    const lines = ui.terminalOutput[worker.id] || logs[worker.id] || [`$ ${worker.command}`, 'Demo worker ready.'];

    return `<section class="terminal ${ui.terminal === worker.id ? 'active' : ''}"><div class="terminal-header"><span>${icon(worker.icon)}${escape(worker.name)}</span><div class="actions">${badge(worker.state)}${iconButton(`Focus ${worker.name}`, 'focus-terminal', 'maximize-2', `data-id="${worker.id}"`)}</div></div><div class="terminal-body" id="terminal-output-${worker.id}" style="font-size:${Number(state.prefs.terminalSize)}px"><div class="terminal-path">~/projects/${escape(currentProject().name.toLowerCase().replaceAll(' ', '-'))} · ${index + 1}</div>${lines.map(
  (line, i) => `<div class="terminal-line ${i === 0 ? 'terminal-command' : line.startsWith('×') || line.startsWith('FAIL') ? 'red' : line.includes('200') || line.includes('ready') ? 'mint' : ''}">${escape(line) || '&nbsp;'}</div>`
).join('')}</div><form class="terminal-input" data-form="terminal" data-id="${worker.id}"><span class="mint">❯</span><label class="sr-only" for="terminal-input-${worker.id}">Simulated command for ${escape(worker.name)}</label><input id="terminal-input-${worker.id}" name="command" autocomplete="off" placeholder="Type a demo command…"><button type="submit" aria-label="Run simulated command">Enter ↵</button></form></section>`;
  }

  function workspace() {
    const focus = state.workers.find(w => w.id === ui.terminal) || state.workers[0];
    let shown = ui.layout === 'focus' ? [focus] : [focus, ...state.workers.filter(w => w.id !== focus.id)].slice(0, 4);

    return pageHead(
      'Workspace',
      'Your tools, side by side. Stay in the flow.',
      `<div class="segmented" role="group" aria-label="Terminal layout"><button data-action="layout" data-id="split" aria-pressed="${ui.layout === 'split'}">${icon('grid-2x2')} Split</button><button data-action="layout" data-id="focus" aria-pressed="${ui.layout === 'focus'}">${icon('square')} Focus</button></div>` + button('Add worker', 'add-worker', 'plus', 'primary')
    ) + `<div class="workspace-layout"><nav class="workspace-nav panel" aria-label="Terminal workers"><h2>Project workers</h2>${state.workers.map(
  w => `<button class="workspace-item ${ui.terminal === w.id ? 'active' : ''}" data-action="select-terminal" data-id="${w.id}" aria-pressed="${ui.terminal === w.id}">${icon(w.icon)}${escape(w.name)}<span class="dot ${w.state === 'failed' ? 'red' : w.state === 'running' ? 'mint' : 'muted'}"></span></button>`
).join('')}</nav><div><div class="terminal-grid ${ui.layout === 'focus' ? 'focus-layout' : ''}">${shown.map(terminalPanel).join('')}</div><div class="workspace-hint"><span>${icon('info')} Simulated terminals. Try <code>help</code>, <code>pwd</code>, <code>npm test</code> or <code>clear</code>.</span>${button('Broadcast command', 'broadcast', 'radio', 'quiet')}</div></div></div>`;
  }

  function needs() {
    const records = ui.decisionFilter === 'active' ? pending() : state.decisions;
    const selected = records.find(d => d.id === ui.decision) || records[0];

    return pageHead(
      'Needs You',
      'A little attention, in exactly the right place.',
      `<div class="segmented" role="group" aria-label="Decision status"><button data-action="decision-filter" data-id="active" aria-pressed="${ui.decisionFilter === 'active'}">Open · ${pending().length}</button><button data-action="decision-filter" data-id="all" aria-pressed="${ui.decisionFilter === 'all'}">All decisions</button></div>`
    ) + (!selected ? `<section class="panel">${empty(
  'You’re all caught up',
  'Every demo decision has been reviewed. The workspace is ready for your next step.',
  button('Open workspace', 'workspace', 'terminal', 'primary'),
  'circle-check'
)}</section>` : `<div class="inbox-layout"><div class="panel inbox-list">${records.map(
  d => `<button class="inbox-entry ${d.id === selected.id ? 'active' : ''}" data-action="select-decision" data-id="${d.id}" aria-pressed="${d.id === selected.id}"><div class="entry-top"><span>${escape(d.source)}</span><span>${d.time}</span></div><strong>${escape(d.title)}</strong><p>${escape(d.summary)}</p><div style="margin-top:12px">${badge(d.status)}</div></button>`
).join('')}</div><article class="panel inbox-detail"><div class="actions">${badge(selected.status)}<span class="pill">${selected.type === 'failure' ? 'Process failure' : 'One-time approval'}</span></div><h2>${escape(selected.title)}</h2><p class="description">${escape(selected.summary)}</p><h3>What this means</h3><p class="description">${escape(selected.impact)}</p><h3>${selected.type === 'failure' ? 'The evidence' : 'Requested scope'}</h3><pre class="log-block">${escape(selected.evidence)}</pre>${selected.status === 'acknowledged' ? '<div class="info-block warning section-space">Acknowledged, still unresolved. Acknowledgement records that you have seen this failure; it does not repair the worker.</div>' : ''}${['pending', 'acknowledged'].includes(selected.status) ? `<div class="detail-actions"><small>Demo action · no real permissions change</small><div class="actions">${selected.type === 'failure' ? button(
  'Acknowledge',
  'acknowledge',
  'check',
  'quiet',
  `data-id="${selected.id}" ${selected.status === 'acknowledged' ? 'disabled' : ''}`
) + button('Inspect worker', 'inspect', 'arrow-up-right', 'primary', `data-id="${selected.worker}"`) : button('Deny request', 'deny', 'x', '', `data-id="${selected.id}"`) + button('Approve once', 'approve', 'shield-check', 'primary', `data-id="${selected.id}"`)}</div></div>` : `<div class="info-block section-space">This demo decision is ${escape(selected.status)}. The action is recorded in History.</div>`}</article></div>`);
  }

  function agents() {
    const i = Math.min(ui.agent, state.agentNames.length - 1), name = state.agentNames[i];

    return pageHead(
      'Agents',
      'The right context. A clear boundary. A useful collaborator.',
      button('Add agent', 'add-agent', 'plus', 'primary')
    ) + `<div class="agent-layout"><div class="panel" style="padding:10px">${state.agentNames.map(
  (name, j) => `<button class="agent-list-item ${i === j ? 'active' : ''}" data-action="select-agent" data-id="${j}" aria-pressed="${i === j}"><span class="agent-monogram ${j ? 'blue' : ''}">${escape(name.slice(0, 2))}</span><span><strong>${escape(name)}</strong><small>${state.agentStates[j] === 'running' ? 'Active · project scoped' : 'Paused'}</small></span></button>`
).join('')}</div><section class="panel"><div class="agent-detail-head"><div class="inspector-title"><span class="agent-monogram ${i ? 'blue' : ''}">${escape(name.slice(0, 2))}</span><div><h2>${escape(name)}</h2><p style="font-size:11px;margin-top:4px">Local agent · bounded authority</p></div></div><div class="actions">${badge(state.agentStates[i])}${button(
  state.agentStates[i] === 'running' ? 'Pause agent' : 'Resume agent',
  'toggle-agent',
  state.agentStates[i] === 'running' ? 'pause' : 'play',
  '',
  `data-id="${i}"`
)}</div></div><div class="agent-detail-body"><div class="info-block">${icon('scan-eye')}<strong>Reported activity</strong><br>${i ? 'Reviewing authentication behavior and the failing test evidence.' : 'Mapping project routes and checking how interface actions reach the engine.'}</div><div class="agent-stats"><div><strong>6</strong><small>Files reviewed · demo</small></div><div><strong>2 / 3</strong><small>Checkpoints verified</small></div><div><strong>Read only</strong><small>Current authority</small></div></div><h3>Evidence & checkpoints</h3><ul class="checkpoints"><li>${icon('circle-check')}Read the project context<small>Verified</small></li><li>${icon('circle-check')}Identify affected routes<small>Verified</small></li><li>${icon('circle')}Verify authentication recovery<small>Awaiting tests</small></li></ul><div class="facts"><div><dt>Working directory</dt><dd><code>${escape(currentProject().path)}</code></dd></div><div><dt>Tool requests</dt><dd>Reviewed individually in Needs You</dd></div></div><div class="actions">${button('Review decisions', 'needs', 'inbox')}${button('Ask Mission AI', 'ask-agent', 'sparkles', '', `data-id="${i}"`)}</div></div></section></div>`;
  }

  function recipes() {
    return pageHead(
      'Recipes',
      'Good workflows deserve a repeat button.',
      button('Create recipe', 'create-recipe', 'plus', 'primary')
    ) + `<div class="recipe-register">${state.recipes.map(
  r => `<article class="panel recipe-row"><span class="recipe-icon">${icon(r.icon)}</span><div><h2>${escape(r.name)}</h2><p>${escape(r.description)}</p><div class="recipe-meta"><span>${r.workers.length} workers</span><span>Ordered dependencies</span><span>${escape(r.last)}</span></div></div><div class="actions">${iconButton(`Edit ${r.name}`, 'edit-recipe', 'pencil', `data-id="${r.id}"`)}${button('Run recipe', 'launch', 'play', '', `data-id="${r.id}"`)}</div></article>`
).join('')}</div><div class="info-block section-space">${icon('git-fork')}Recipes connect existing workers in a deliberate order. Inspect a launch plan before running it.</div>`;
  }

  function filteredHistory() {
    return state.history.filter(
      e => (ui.historyFilter === 'all' || e.type === ui.historyFilter) && `${e.title} ${e.detail} ${e.actor}`.toLowerCase().includes(ui.historyQuery.toLowerCase())
    );
  }

  function historyContent() {
    const events = filteredHistory();

    return events.length ? activityRows(events, true) : empty(
      'No matching activity',
      'Change the event type or clear your search.',
      button('Clear filters', 'clear-history', 'x')
    );
  }

  function history() {
    return pageHead(
      'History',
      'A useful record of what happened, and why.',
      button('Export activity', 'export-history', 'download')
    ) + `<section class="panel"><div class="history-toolbar"><label class="search">${icon('search')}<span class="sr-only">Search activity</span><input id="history-search" placeholder="Search events or actors…" value="${escape(ui.historyQuery)}"></label><label><span class="sr-only">Event type</span><select id="history-filter">${[
  ['all', 'All events'],
  ['failure', 'Failures'],
  ['approval', 'Approvals'],
  ['success', 'Successful actions'],
  ['agent', 'Agent activity'],
  ['recipe', 'Recipe launches']
].map(
  ([id, label]) => `<option value="${id}" ${ui.historyFilter === id ? 'selected' : ''}>${label}</option>`
).join('')}</select></label></div><div class="history-date">DEMO SESSION · EVENTS ARE LOCAL TO THIS PROTOTYPE</div><div class="timeline-list" id="history-list">${historyContent()}</div></section>`;
  }

  const integrationData = [[
    'vscode',
    'VS Code Bridge',
    'code-xml',
    'Bring editor context and managed terminals into the same workspace.',
    'Editor context'
  ], [
    'mcp',
    'Secure MCP',
    'plug-zap',
    'Connect external AI tools with explicit, one-time permissions.',
    'Approval gated'
  ], [
    'intelligence',
    'Mission AI',
    'sparkles',
    'Understand the project through evidence and a focused conversation.',
    'Observe & propose'
  ], [
    'automation',
    'Automation',
    'workflow',
    'Turn recurring events into a reviewable next step.',
    'Human approval'
  ], [
    'mobile',
    'Mobile Companion',
    'smartphone',
    'Check workspace status and review requests from your phone.',
    'Paired devices'
  ], [
    'plugins',
    'Plugins',
    'blocks',
    'Add declarative project signals without arbitrary plugin execution.',
    'Scoped manifests'
  ]];

  function integrations() {
    return pageHead(
      'Integrations',
      'Your tools, connected on your terms.',
      button('Run diagnostics', 'diagnostics', 'activity')
    ) + `<div class="integrations-grid">${integrationData.map(
  ([id, name, glyph, desc, scope]) => `<article class="panel integration-card"><div class="integration-top"><div class="integration-icon">${icon(glyph)}</div>${badge(
  state.integrations[id] ? 'connected' : 'idle',
  state.integrations[id] ? 'Demo connected' : 'Not configured'
)}</div><h2>${name}</h2><p>${desc}</p><footer><small>${scope}</small>${button(state.integrations[id] ? 'Manage' : 'Set up', 'integration', 'arrow-up-right', '', `data-id="${id}"`)}</footer></article>`
).join('')}</div>`;
  }

  function ai() {
    return pageHead(
      'Mission AI',
      'A thinking partner with your project in view.',
      button('Clear conversation', 'clear-chat', 'rotate-ccw')
    ) + `<div class="ai-layout"><section class="panel ai-conversation"><div class="ai-intro"><div class="ai-emblem">${icon('sparkles')}</div><h2>A little clarity goes a long way.</h2><p>Ask about your workspace, investigate an issue, or plan the next step. Every answer starts with the evidence.</p><div class="suggestions">${['What needs my attention?', 'Why did the tests fail?', 'Plan a safe restart'].map((q, i) => button(q, 'ask-preset', '', '', `data-id="${i}"`)).join('')}</div></div><div class="messages" id="messages">${state.messages.map(
  m => m.role === 'user' ? `<div class="message-user">${escape(m.text)}</div>` : `<article class="message-assistant"><div class="response-label">${icon('sparkles')}MISSION AI · SCRIPTED DEMO RESPONSE</div>${safeReply(m.html)}</article>`
).join('')}</div><form class="ai-composer" data-form="ai"><div class="composer-box"><label class="sr-only" for="ai-prompt">Ask Mission AI</label><textarea id="ai-prompt" name="prompt" placeholder="Ask about this workspace…" required></textarea><div class="composer-bottom"><span>Project context attached · demo mode</span>${button('', 'send-ai', 'arrow-up', 'primary', 'aria-label="Send message"').replace('type="button"', 'type="submit"')}</div></div><small>Scripted responses. No AI service or API key is used.</small></form></section><aside class="panel context-panel"><h2>In context</h2><div class="context-item"><span>Project</span>${escape(currentProject().name)}</div><div class="context-item"><span>Workers</span>${running().length} running · ${state.workers.filter(w => w.state === 'failed').length} failed</div><div class="context-item"><span>Open decisions</span>${pending().length} awaiting review</div><div class="context-item"><span>Authority</span>Observe & propose</div><div class="context-item"><span>Evidence sources</span>Lifecycle events<br>Worker output<br>Approval requests</div><div style="margin-top:18px">${link('history', 'Open evidence history', 'arrow-up-right')}</div></aside></div>`;
  }

  const settingGroups = [
    ['appearance', 'Appearance'],
    ['terminal', 'Terminal'],
    ['notifications', 'Notifications'],
    ['project', 'Project defaults'],
    ['security', 'Security & privacy'],
    ['diagnostics', 'Diagnostics'],
    ['about', 'About']
  ];

  function toggleSetting(id, label, description) {
    return `<div class="setting-row"><div><strong>${label}</strong><p>${description}</p></div><label class="switch"><span class="sr-only">${label}</span><input type="checkbox" data-pref="${id}" ${state.prefs[id] ? 'checked' : ''}></label></div>`;
  }

  function materialOptions() {
    return `<section class="theme-system" aria-label="Visual system"><div class="theme-swatch" aria-hidden="true"><i></i><i></i><i></i></div><div><strong>Vercel dark</strong><p>One calm, high-contrast system: black, white, graphite, and purposeful blue.</p></div><span class="pill connected">Active</span></section>`;
  }

  function settingsBody() {
    switch (ui.settings) {
    case 'appearance':
      return `<h2>Make yourself comfortable</h2><p>A dark canvas, tuned to the way you work.</p>${materialOptions()}<div class="setting-row"><div><strong>Interface density</strong><p>Choose how much fits in a worker register.</p></div><label><span class="sr-only">Interface density</span><select data-pref="density"><option value="comfortable" ${state.prefs.density === 'comfortable' ? 'selected' : ''}>Comfortable</option><option value="compact" ${state.prefs.density === 'compact' ? 'selected' : ''}>Compact</option></select></label></div>${toggleSetting('motion', 'Interface motion', 'Subtle feedback when opening dialogs and using controls.')}`;
    case 'terminal':
      return `<h2>Terminal</h2><p>Preview preferences apply to the simulated terminal workspace.</p><div class="setting-row"><div><strong>Text size</strong><p>Change terminal output size.</p></div><label><span class="sr-only">Terminal text size</span><select data-pref="terminalSize">${['11', '12', '13', '14', '16'].map(n => `<option value="${n}" ${state.prefs.terminalSize === n ? 'selected' : ''}>${n} px</option>`).join('')}</select></label></div><div class="log-block section-space" style="font-size:${Number(state.prefs.terminalSize)}px">~/projects/mission-control<br><span class="mint">❯</span> npm run dev<br>VITE ready in 384 ms</div><div class="info-block section-space">The production terminal uses xterm and an engine-owned process. This prototype previews the visual interaction only.</div>`;
    case 'notifications':
      return `<h2>Notifications</h2><p>Keep interruption proportional to the decision.</p>${toggleSetting('notifications', 'Show demo notifications', 'Use in-app feedback after simulated worker actions.')}<div class="setting-row"><div><strong>Send a test notification</strong><p>Preview the in-app notification style.</p></div>${button('Send test', 'test-notification', 'bell')}</div><div class="info-block section-space">No operating-system notification permission is requested.</div>`;
    case 'project':
      return `<h2>Project defaults</h2><p>Preferences for ${escape(currentProject().name)}.</p>${toggleSetting(
  'autoStart',
  'Start new workers automatically',
  'New demo workers begin running after you create them.'
)}<div class="facts"><div><dt>Project folder</dt><dd><code>${escape(currentProject().path)}</code></dd></div><div><dt>Default shell</dt><dd>PowerShell</dd></div></div>${button('Switch project', 'projects', 'folder-open')}`;
    case 'security':
      return `<h2>Security & privacy</h2><p>Clear boundaries are part of the interface.</p><div class="setting-row"><div><strong>Local-only prototype</strong><p>No shell commands, network requests or credentials.</p></div>${badge('connected', 'Isolated')}</div><div class="setting-row"><div><strong>One-time approvals</strong><p>Each external request is reviewed individually.</p></div>${button('Open Needs You', 'needs', 'inbox')}</div><div class="setting-row"><div><strong>Connected tools</strong><p>Inspect the scope of each integration.</p></div>${button('Manage integrations', 'integrations', 'blocks')}</div><div class="info-block section-space">The production app must preserve EngineAPI permissions, protected credential storage and explicit confirmation tokens. This demo grants no real authority.</div>`;
    case 'diagnostics':
      return `<h2>Diagnostics</h2><p>Explore recovery states without interrupting a real workspace.</p><div class="setting-row"><div><strong>Demo connection</strong><p>Inspect local fixture and interface availability.</p></div>${button('Run checks', 'diagnostics', 'activity')}</div><div class="setting-row"><div><strong>Prototype scenarios</strong><p>Loading, empty workspace and lost connection.</p></div>${button('Open Tweaks', 'tweaks', 'sliders-horizontal')}</div><div class="setting-row"><div><strong>Reset demo data</strong><p>Restore only this prototype’s workers, events and preferences.</p></div>${button('Reset demo', 'reset-demo', 'rotate-ccw', 'danger')}</div>`;
    default:
      return `<h2>Mission Control / Obsidian</h2><p>A new direction for a developer’s daily workspace.</p><div class="info-block section-space">Independent HTML, CSS and JavaScript prototype. Designed around project operations, meaningful glass surfaces and an evidence-led workflow.</div><div class="facts"><div><dt>Edition</dt><dd>Interactive design study</dd></div><div><dt>Data</dt><dd>Fictional local fixtures</dd></div></div><div class="actions"><a class="btn" href="RESEARCH.md" target="_blank" rel="noopener">${icon('book-open')}Read research</a><a class="btn" href="DESIGN.md" target="_blank" rel="noopener">${icon('file-text')}Design decisions</a></div>`;
    }
  }

  function settings() {
    return pageHead('Settings', 'Make this space work for you.') + `<div class="settings-layout"><nav class="settings-menu" aria-label="Settings groups">${settingGroups.map(
  ([id, label]) => `<button class="${ui.settings === id ? 'active' : ''}" data-action="settings-group" data-id="${id}" aria-pressed="${ui.settings === id}">${label}</button>`
).join('')}<a class="nav-item" href="#integrations">Integrations ${icon('arrow-up-right')}</a></nav><section class="panel settings-section">${settingsBody()}</section></div>`;
  }

  function projects() {
    return pageHead(
      'Projects',
      'Different projects. One familiar place to work.',
      button('Add project', 'add-project', 'plus', 'primary')
    ) + `<section class="panel project-register">${state.projects.map(
  (p, i) => `<article class="project-row"><span class="project-avatar">${escape(p.name.slice(0, 2).toUpperCase())}</span><div><h2>${escape(p.name)} ${state.project === i ? '<span class="pill connected">Current</span>' : ''}</h2><p>${escape(p.path)}</p><small class="muted">${escape(p.branch)} · demo workspace</small></div>${button(
  state.project === i ? 'Open workspace' : 'Switch project',
  'choose-project',
  'arrow-up-right',
  '',
  `data-id="${i}"`
)}</article>`
).join('')}</section><div class="info-block section-space">${icon('info')}Projects preview switching context. This design study shares one demo worker fixture across project names; it does not open real folders.</div>`;
  }

  /* Dialogs and interactions */
  const modal = $('#modal');

  function openModal(title, description, body, footer = '', wide = false) {
    const alreadyOpen = modal.open;
    if (!alreadyOpen) ui.modalTrigger = document.activeElement;
    modal.innerHTML = `<header class="modal-header"><div><h2 id="modal-title">${title}</h2><p>${description}</p></div>${iconButton('Close dialog', 'close-modal', 'x')}</header><div class="modal-body">${body}</div>${footer ? `<footer class="modal-footer">${footer}</footer>` : ''}`;
    modal.style.width = wide ? 'min(760px, calc(100vw - 32px))' : '';

    if (!modal.open)
      modal.showModal();

    hydrate();
    if (alreadyOpen) ($('[autofocus]', modal) || $('input, select, textarea', modal) || $('button', modal))?.focus();
  }

  function closeModal() {
    modal.close();
  }

  modal.addEventListener('close', () => {
    if (ui.modalTrigger?.isConnected)
      ui.modalTrigger.focus();
    else
      $('#content').focus();
  });

  function inspect(id) {
    const w = state.workers.find(w => w.id === id);

    if (!w)
      return;

    openModal(
      escape(w.name),
      'Worker details · simulated evidence',
      `<div class="inspector-title"><span class="worker-symbol">${icon(w.icon)}</span><div>${badge(w.state)}<p style="font-size:11px;margin-top:4px">${escape(w.role)} · ${escape(w.detail)}</p></div></div><dl class="facts"><div><dt>Command</dt><dd><code>${escape(w.command)}</code></dd></div><div><dt>Directory</dt><dd><code>${escape(currentProject().path)}</code></dd></div><div><dt>CPU / memory</dt><dd>${escape(w.cpu)} / ${escape(w.memory)} · fixture</dd></div><div><dt>Port / exit</dt><dd>${escape(w.port)}</dd></div></dl><h3 style="margin-bottom:10px">Recent output</h3><pre class="log-block">${escape((ui.terminalOutput[id] || logs[id] || ['Demo worker ready.']).join('\n'))}</pre>${w.state === 'failed' ? '<div class="info-block warning section-space">This demo failure remains visible until a simulated successful retry. Acknowledging it alone does not resolve it.</div>' : ''}`,
      button('Open terminal', 'open-terminal', 'terminal', '', `data-id="${id}"`) + button(
        w.state === 'running' ? 'Stop worker' : w.state === 'failed' ? 'Retry checks' : 'Start worker',
        'worker-lifecycle',
        w.state === 'running' ? 'square' : 'play',
        w.state === 'running' ? 'danger' : 'primary',
        `data-id="${id}"`
      )
    );
  }

  function addWorker() {
    openModal(
      'Add a worker',
      'A reusable command in your project workspace.',
      `<form id="worker-form" data-form="worker"><div class="field"><label for="worker-name">Worker name</label><input id="worker-name" name="name" value="Project shell" required maxlength="80" autofocus><small>Give this worker a name you’ll recognize at a glance.</small></div><div class="field"><label for="worker-command">Command</label><input id="worker-command" name="command" value="powershell.exe" required maxlength="240" class="mono"></div><div class="field"><label for="worker-role">Role</label><select id="worker-role" name="role"><option>Utilities</option><option>Frontend</option><option>Backend</option><option>Database</option><option>Quality</option></select></div><div class="info-block">${icon('info')}The worker is created in local demo data. The command will not execute.</div></form>`,
      button('Cancel', 'close-modal') + '<button type="submit" form="worker-form" class="btn primary">Add worker</button>'
    );
  }

  function launchPicker() {
    openModal('Run a recipe', 'Choose a workflow, then inspect the launch plan.', state.recipes.map(
      r => `<div class="recipe-compact" style="padding:13px 0">${icon(r.icon)}<div><strong>${escape(r.name)}</strong><small>${r.workers.length} workers</small></div>${button('Preview', 'launch', 'arrow-right', '', `data-id="${r.id}"`)}</div>`
    ).join(''));
  }

  function launch(id) {
    const r = state.recipes.find(r => r.id === id);

    if (!r)
      return;

    openModal(
      escape(r.name),
      'Preview the order before starting your demo workflow.',
      `<p style="font-size:13px">${escape(r.description)}</p><div class="graph-view">${r.workers.map((wid, i) => {
  const w = state.workers.find(x => x.id === wid);
  return `${i ? '<div class="graph-link">↓ waits for the previous step</div>' : ''}<div class="graph-node">${icon(w.icon)}<div><strong style="font-size:12px">${escape(w.name)}</strong><div><code>${escape(w.command)}</code></div></div><span>${badge(w.state)}</span></div>`;
}).join('')}</div><div class="info-block">${icon('info')}This preview simulates each launch step. It will update workers and History locally.</div>`,
      button('Cancel', 'close-modal') + button('Run recipe', 'run-recipe', 'play', 'primary', `data-id="${id}"`)
    );
  }

  function recipeEditor(id) {
    const r = state.recipes.find(r => r.id === id);

    openModal(
      r ? 'Edit recipe' : 'Create recipe',
      'Define a reusable, ordered launch plan.',
      `<form id="recipe-form" data-form="recipe" data-id="${r?.id || ''}"><div class="field"><label for="recipe-name">Recipe name</label><input id="recipe-name" name="name" value="${escape(r?.name || 'My workflow')}" required maxlength="80"></div><div class="field"><label for="recipe-description">Description</label><input id="recipe-description" name="description" value="${escape(r?.description || 'A focused setup for the task at hand.')}" required maxlength="240"></div><div class="field-label">Workers · launch in the order shown</div><div id="recipe-steps">${[
  ...(r?.workers || []).map(wid => state.workers.find(w => w.id === wid)),
  ...state.workers.filter(w => !r?.workers.includes(w.id))
].map(
  w => `<label class="step-choice"><input type="checkbox" name="workers" value="${w.id}" ${r?.workers.includes(w.id) ? 'checked' : ''}>${escape(w.name)}<small>${escape(w.role)}</small></label>`
).join('')}</div><p id="recipe-error" class="error-text" role="alert"></p></form>`,
      button('Cancel', 'close-modal') + '<button type="submit" form="recipe-form" class="btn primary">Save recipe</button>'
    );
  }

  function integration(id) {
    const [, name, glyph, description, scope] = integrationData.find(r => r[0] === id) || integrationData[0];

    openModal(
      name,
      'Connection settings · prototype preview',
      `<div class="inspector-title"><span class="recipe-icon">${icon(glyph)}</span>${badge(
  state.integrations[id] ? 'connected' : 'idle',
  state.integrations[id] ? 'Demo connected' : 'Not configured'
)}</div><p style="font-size:13px;margin-top:17px">${description}</p><dl class="facts"><div><dt>Authority</dt><dd>${scope}</dd></div><div><dt>Workspace</dt><dd>${escape(currentProject().name)}</dd></div></dl>${id === 'automation' ? '<div class="info-block"><strong>Workflow preview</strong><br>When a worker fails → propose a restart → request approval in Needs You. Nothing runs automatically.</div>' : id === 'mobile' ? '<div class="info-block"><strong>Pairing preview</strong><br>A production flow would display a short-lived QR code and require confirmation on this device. This prototype creates no pairing token or real connection.</div>' : id === 'plugins' ? '<div class="info-block"><strong>Installed demo manifests</strong><br>Docker health · Framework diagnostics · Test results<br>Permissions: read project signals. No executable plugin code.</div>' : id === 'intelligence' ? '<div class="info-block">Mission AI uses scripted responses here. No API key is required or accepted.</div>' : '<div class="info-block">Access is scoped to this project. External actions are reviewed individually in Needs You.</div>'}`,
      button(
        state.integrations[id] ? 'Disconnect demo' : 'Connect demo',
        'toggle-integration',
        state.integrations[id] ? 'unplug' : 'plug',
        state.integrations[id] ? '' : 'primary',
        `data-id="${id}"`
      ) + (id === 'intelligence' ? button('Open Mission AI', 'open-ai', 'sparkles') : '')
    );
  }

  function tweaks() {
    openModal(
      'Tweaks',
      'Preview workspace scenarios and the moments between states.',
      `${materialOptions()}<div class="setting-row"><div><strong>Demo scenario</strong><p>Applies to Groundstation.</p></div><label><span class="sr-only">Demo scenario</span><select id="scenario-select">${[
  ['normal', 'Active workspace'],
  ['loading', 'Loading'],
  ['empty', 'Empty workspace'],
  ['disconnected', 'Disconnected']
].map(([id, name]) => `<option value="${id}" ${ui.scenario === id ? 'selected' : ''}>${name}</option>`).join('')}</select></label></div>${toggleSetting('motion', 'Interface motion', 'System reduced-motion preference always takes priority.')}`,
      button('Reset demo', 'reset-demo', 'rotate-ccw', 'quiet') + button('View Groundstation', 'apply-tweaks', 'arrow-right', 'primary')
    );
  }

  function graph() {
    openModal(
      'Mission dependencies',
      'A simple map of your development stack.',
      `<div class="pipeline">${['db', 'api', 'web'].map((id, i) => {
  const w = state.workers.find(x => x.id === id);
  return `${i ? icon('arrow-right') : ''}<button class="step" data-action="inspect" data-id="${id}">${icon(w.icon)}${escape(w.name)}</button>`;
}).join('')}</div><div class="graph-link">API server → Test runner (verification)</div><div class="info-block section-space">Database readiness unlocks the API. The API unlocks the web application. Tests verify the API separately.</div>`,
      button('Open recipes', 'open-recipes', 'workflow', 'primary')
    );
  }

  function commandPalette() {
    ui.modalTrigger = document.activeElement;
    modal.innerHTML = `<h2 id="modal-title" class="sr-only">Search commands</h2><div class="palette-search">${icon('search')}<label class="sr-only" for="palette-input">Find a page or action</label><input id="palette-input" placeholder="Where would you like to go?" autocomplete="off">${iconButton('Close command palette', 'close-modal', 'x')}</div><div class="palette-results" id="palette-results"></div><div class="palette-hint">↑ ↓ navigate · Enter open · Esc close</div>`;
    modal.style.width = 'min(580px, calc(100vw - 32px))';
    paletteResults('');

    if (!modal.open)
      modal.showModal();

    $('#palette-input').focus();
    hydrate();
  }

  function paletteResults(query) {
    const commands = [...routes.map(([id, name, glyph]) => ({
      name,
      glyph,
      action: 'navigate',
      id,
      group: 'Navigate'
    })), {
      name: 'Add worker',
      glyph: 'plus',
      action: 'add-worker',
      group: 'Create'
    }, {
      name: 'Run recipe',
      glyph: 'play',
      action: 'launch-picker',
      group: 'Run'
    }, {
      name: 'Mission dependencies',
      glyph: 'git-fork',
      action: 'graph',
      group: 'Inspect'
    }, {
      name: 'Customize this prototype',
      glyph: 'sliders-horizontal',
      action: 'tweaks',
      group: 'Appearance'
    }].filter(c => c.name.toLowerCase().includes(query.toLowerCase()));

    $('#palette-results').innerHTML = commands.length ? commands.map(
      c => `<button class="palette-result" data-action="${c.action}" data-id="${c.id || ''}">${icon(c.glyph)}${c.name}<small>${c.group}</small></button>`
    ).join('') : '<div class="empty-state"><p>No matching commands. Try “worker” or “recipes”.</p></div>';

    hydrate();
  }

  function diagnostics() {
    openModal(
      'Prototype diagnostics',
      'Local interface checks, without touching your services.',
      `<ul class="checkpoints"><li>${icon('circle-check')}Application routes available<small>10 views</small></li><li>${icon('circle-check')}Demo workers loaded<small>${state.workers.length} workers</small></li><li>${icon('circle-check')}Decision model available<small>${pending().length} open</small></li><li>${icon('circle-check')}Native dialog support<small>${typeof modal.showModal === 'function' ? 'Available' : 'Unavailable'}</small></li></ul><div class="info-block">These checks inspect the prototype only. Production engine, PTY and integration connectivity are not tested.</div>`,
      button('Done', 'close-modal', '', 'primary')
    );
  }

  function ask(text) {
    const question = text.trim();

    if (!question)
      return;

    state.messages.push({
      role: 'user',
      text: question
    });

    let html;

    if (/test|fail|auth/i.test(question)) {
      html = `<p>The demo evidence points to an authentication mismatch: the suite expected <code>401</code> but received <code>200</code>. ${state.workers.find(w => w.id === 'tests')?.state === 'failed' ? 'The test worker exited with code 1.' : 'The latest demo retry has completed.'}</p><ol><li>Inspect token expiry and refresh handling.</li><li>Check the test fixtures against the route contract.</li><li>Run the authentication checks again, then verify the result.</li></ol><p>This is a scripted explanation of the supplied fixture, not a diagnosis of your real repository.</p>${button('Inspect test evidence', 'inspect', 'file-search', '', 'data-id="tests"')}`;
    } else if (/restart|plan|recover/i.test(question)) {
      html = `<p>A staged restart makes the dependencies visible before you act.</p><ol><li>Check PostgreSQL readiness.</li><li>Start the API and verify <code>/health</code>.</li><li>Start the web application.</li><li>Run the tests as a separate verification step.</li></ol><p>No actions have been taken.</p>${button('Preview the launch plan', 'launch', 'workflow', '', 'data-id="full"')}`;
    } else {
      html = `<p>Your demo workspace has <strong>${running().length} running workers</strong> and <strong>${pending().length} open decisions</strong>.</p><p>${pending().length ? 'Review the test evidence and the scoped MCP request. A failed worker and an approval request need different actions.' : 'All demo decisions have been reviewed. History records what changed.'}</p><p>Ask about tests, attention, or a restart to explore this scripted assistant.</p>${button('Review Needs You', 'needs', 'inbox')}`;
    }

    state.messages.push({
      role: 'assistant',
      html
    });

    state.messages = state.messages.slice(-20);
    save();
    go('ai');
  }

  function workerAction(id) {
    const w = state.workers.find(w => w.id === id);

    if (!w)
      return;

    if (['starting', 'waiting'].includes(w.state)) {
      toast('This worker is already in a demo launch');
      return;
    }

    if (w.state === 'running') {
      openModal(
        `Stop ${escape(w.name)}?`,
        'This stops the selected demo worker.',
        `<p style="font-size:13px">${escape(w.name)} will become idle. Other demo workers remain unchanged. You can start it again from its inspector.</p>`,
        button('Cancel', 'close-modal') + button('Stop worker', 'confirm-stop', 'square', 'danger', `data-id="${id}"`)
      );

      return;
    }

    w.state = 'starting';
    w.detail = 'Starting demo worker';
    event(`${w.name} starting`, 'Local demo action');
    closeModal();
    render();
    toast(`${w.name} is starting`);

    deferDemo(() => {
      w.state = 'running';
      w.detail = id === 'tests' ? '44 demo checks passed' : 'Demo worker ready';
      w.port = id === 'tests' ? 'Exit 0' : w.port === '—' ? 'Shell' : w.port;
      w.activity = 'Just now';

      if (id === 'tests') {
        w.state = 'idle';

        ui.terminalOutput.tests = [
          '$ npm test',
          '',
          'PASS  test/auth.test.ts',
          '',
          'Tests  44 passed · 44 total',
          'Process exited with code 0.'
        ];

        state.decisions.filter(d => d.worker === id).forEach(d => d.status = 'resolved');
      }

      event(
        `${w.name} ${id === 'tests' ? 'verification passed' : 'started'}`,
        'Simulated result · no command executed'
      );

      render();

      if (state.prefs.notifications)
        toast(`${w.name} ${id === 'tests' ? 'checks passed' : 'is ready'}`);
    }, 900);
  }

  function runRecipe(id) {
    const recipe = state.recipes.find(r => r.id === id);
    if (!recipe) return;
    if (ui.activeRecipe) { toast('A demo recipe is already launching', 'Wait for its result before launching another.'); return; }
    closeModal();
    ui.activeRecipe = id;
    recipe.last = 'Last run just now';
    event(`${recipe.name} launch requested`, `${recipe.workers.length} demo workers · ordered plan`, 'recipe');
    recipe.workers.forEach(wid => { state.workers.find(w => w.id === wid).state = 'waiting'; });
    function step(index) {
      const worker = state.workers.find(w => w.id === recipe.workers[index]);
      worker.state = 'starting';
      worker.detail = 'Starting in recipe order';
      save(); render();
      deferDemo(() => {
        const failed = worker.id === 'tests';
        worker.state = failed ? 'failed' : 'running';
        worker.detail = failed ? '3 assertions failed' : 'Demo readiness verified';
        worker.activity = 'Just now';
        if (logs[worker.id]) ui.terminalOutput[worker.id] = [...logs[worker.id]];
        if (failed) {
          worker.port = 'Exit 1';
          const decision = state.decisions.find(d => d.worker === worker.id);
          if (decision) decision.status = 'pending';
          recipe.workers.slice(index + 1).forEach(wid => {
            const dependent = state.workers.find(w => w.id === wid);
            dependent.state = 'idle';
            dependent.detail = 'Launch blocked by a failed prerequisite';
          });
        }
        event(`${worker.name} ${failed ? 'verification failed' : 'is ready'}`, `Recipe: ${recipe.name}`, failed ? 'failure' : 'recipe');
        if (!failed && index + 1 < recipe.workers.length) step(index + 1);
        else {
          ui.activeRecipe = null;
          save(); render();
          toast(failed ? 'Demo launch stopped at the failed check' : 'Demo launch finished', recipe.name);
        }
      }, 500);
    }
    step(0);
    toast('Launching the demo workflow');
  }

  document.addEventListener('click', e => {
    const target = e.target.closest('[data-action]');

    if (!target || target.disabled)
      return;

    const action = target.dataset.action, id = target.dataset.id;

    if (target.closest('.palette-results') && !['navigate'].includes(action))
      closeModal();

    switch (action) {
    case 'navigate':
      closeModal();
      go(id);
      break;
    case 'projects':
    case 'settings':
    case 'needs':
    case 'workspace':
    case 'integrations':
      closeModal();
      go(action);
      break;
    case 'open-ai':
      closeModal();
      go('ai');
      break;
    case 'open-recipes':
      closeModal();
      go('recipes');
      break;
    case 'mobile-menu':
      ui.mobile = !ui.mobile;
      renderShell();
      hydrate();
      break;
    case 'palette':
      commandPalette();
      break;
    case 'close-modal':
      closeModal();
      break;
    case 'dismiss-toast':
      $('#toasts').innerHTML = '';
      break;
    case 'inspect':
      inspect(id);
      break;
    case 'filter-workers':
      ui.filter = id;
      render();
      break;
    case 'clear-workers':
      ui.filter = 'all';
      ui.query = '';
      render();
      break;
    case 'add-worker':
      addWorker();
      break;
    case 'launch-picker':
      launchPicker();
      break;
    case 'launch':
      launch(id);
      break;
    case 'create-recipe':
      recipeEditor();
      break;
    case 'edit-recipe':
      recipeEditor(id);
      break;
    case 'run-recipe':
      runRecipe(id);
      break;
    case 'review':
      ui.decision = id;
      ui.decisionFilter = 'active';
      go('needs');
      break;
    case 'select-decision':
      ui.decision = id;
      render();
      break;
    case 'decision-filter':
      ui.decisionFilter = id;
      render();
      break;
    case 'acknowledge':
      {
        const d = state.decisions.find(x => x.id === id);
        d.status = 'acknowledged';
        event('Failure acknowledged', `${d.source} · unresolved until recovery`, 'approval');
        render();
        toast('Acknowledged. The failure remains open.');
        break;
      }
    case 'approve':
      {
        const d = state.decisions.find(x => x.id === id);

        openModal(
          'Approve this request once?',
          'Review the exact scope before deciding.',
          `<pre class="log-block">${escape(d.evidence)}</pre><div class="info-block section-space">Demo approval only. No filesystem permission or external access is granted.</div>`,
          button('Cancel', 'close-modal') + button('Approve once', 'confirm-approve', 'shield-check', 'primary', `data-id="${id}"`)
        );

        break;
      }
    case 'confirm-approve':
    case 'deny':
      {
        const d = state.decisions.find(x => x.id === id);
        d.status = action === 'deny' ? 'denied' : 'resolved';

        event(
          action === 'deny' ? 'MCP request denied' : 'MCP request approved once',
          'Demo scope: ./src and ./test · read only',
          'approval'
        );

        closeModal();
        render();
        toast(action === 'deny' ? 'Request denied' : 'One-time demo approval recorded');
        break;
      }
    case 'worker-lifecycle':
      workerAction(id);
      break;
    case 'confirm-stop':
      {
        const w = state.workers.find(x => x.id === id);
        w.state = 'idle';
        w.detail = 'Stopped by you';
        w.activity = 'Just now';
        w.cpu = '0%';
        event(`${w.name} stopped`, 'Demo action · reversible');
        closeModal();
        render();
        toast('Demo worker stopped');
        break;
      }
    case 'open-terminal':
      closeModal();
      ui.terminal = id;
      ui.layout = 'focus';
      go('workspace');
      break;
    case 'select-terminal':
      ui.terminal = id;
      render();
      break;
    case 'focus-terminal':
      ui.terminal = id;
      ui.layout = ui.layout === 'focus' ? 'split' : 'focus';
      render();
      break;
    case 'layout':
      ui.layout = id;
      render();
      break;
    case 'broadcast':
      openModal(
        'Broadcast a demo command',
        'Choose the workers that should receive the same input.',
        `<form id="broadcast-form" data-form="broadcast"><div class="field"><label for="broadcast-command">Command</label><input id="broadcast-command" name="command" value="pwd" required></div>${state.workers.map(
  w => `<label class="step-choice"><input type="checkbox" name="workers" value="${w.id}">${escape(w.name)}</label>`
).join('')}<p id="broadcast-error" class="error-text" role="alert"></p><div class="info-block section-space">No real commands execute. The text is appended to selected demo terminal output.</div></form>`,
        button('Cancel', 'close-modal') + '<button class="btn primary" type="submit" form="broadcast-form">Send demo command</button>'
      );

      break;
    case 'select-agent':
      ui.agent = Number(id);
      render();
      break;
    case 'toggle-agent':
      state.agentStates[Number(id)] = state.agentStates[Number(id)] === 'running' ? 'idle' : 'running';

      event(
        `${state.agentNames[Number(id)]} ${state.agentStates[Number(id)] === 'running' ? 'resumed' : 'paused'}`,
        'Demo agent lifecycle',
        'agent'
      );

      render();
      toast('Demo agent state updated');
      break;
    case 'add-agent':
      openModal(
        'Add an agent',
        'Choose a name for a supervised demo collaborator.',
        `<form id="agent-form" data-form="agent"><div class="field"><label for="agent-name">Agent name</label><input id="agent-name" name="name" value="Project reviewer" required maxlength="60"></div><div class="info-block">A demo agent is added locally. No CLI or AI provider is started.</div></form>`,
        button('Cancel', 'close-modal') + '<button class="btn primary" type="submit" form="agent-form">Add agent</button>'
      );

      break;
    case 'ask-agent':
      ask(`What needs attention for ${state.agentNames[Number(id)]}?`);
      break;
    case 'ask-preset':
      ask(['What needs my attention?', 'Why did the tests fail?', 'Plan a safe restart'][Number(id)]);
      break;
    case 'clear-chat':
      state.messages = [];
      save();
      render();
      toast('Demo conversation cleared');
      break;
    case 'send-ai':
      break;
    case 'integration':
      integration(id);
      break;
    case 'toggle-integration':
      state.integrations[id] = !state.integrations[id];

      event(
        `${integrationData.find(x => x[0] === id)[1]} ${state.integrations[id] ? 'connected' : 'disconnected'}`,
        'Simulated connection state'
      );

      integration(id);
      render();
      toast('Demo connection updated');
      break;
    case 'settings-group':
      ui.settings = id;
      render();
      break;
    case 'material':
      state.prefs.material = 'solid';
      applyPrefs();
      break;
    case 'tweaks':
      tweaks();
      break;
    case 'apply-tweaks':
      closeModal();
      go('groundstation');
      break;
    case 'test-notification':
      toast('Your workspace has an update', 'This is a test notification. Dismiss it when ready.');
      break;
    case 'graph':
      graph();
      break;
    case 'diagnostics':
      diagnostics();
      break;
    case 'shortcuts':
      openModal(
        'A shorter way there',
        'Keyboard shortcuts for this prototype.',
        `<div class="facts"><div><dt>Search commands</dt><dd><kbd>Ctrl / ⌘ K</kbd></dd></div><div><dt>Close overlay</dt><dd><kbd>Esc</kbd></dd></div><div><dt>Groundstation</dt><dd><kbd>Alt 1</kbd></dd></div><div><dt>Workspace</dt><dd><kbd>Alt 2</kbd></dd></div><div><dt>Needs You</dt><dd><kbd>Alt 3</kbd></dd></div><div><dt>Activate a focused control</dt><dd><kbd>Enter / Space</kbd></dd></div></div><div class="info-block">All actions also have visible controls. The command palette supports arrow navigation.</div>`,
        button('Done', 'close-modal', '', 'primary')
      );

      break;
    case 'choose-project':
      state.project = Number(id);
      save();
      go('groundstation');
      toast(`Opened ${currentProject().name}`, 'Project context changed; shared demo fixture');
      break;
    case 'add-project':
      openModal(
        'Add a demo project',
        'Preview another workspace context.',
        `<form id="project-form" data-form="project"><div class="field"><label for="project-name">Project name</label><input id="project-name" name="name" required maxlength="80" placeholder="My next project"></div><div class="field"><label for="project-path">Folder path</label><input id="project-path" name="path" required maxlength="240" placeholder="D:/Projects/my-project"></div><div class="info-block">The folder will not be read or created.</div></form>`,
        button('Cancel', 'close-modal') + '<button class="btn primary" type="submit" form="project-form">Add project</button>'
      );

      break;
    case 'clear-history':
      ui.historyQuery = '';
      ui.historyFilter = 'all';
      render();
      break;
    case 'export-history':
      {
        const blob = new Blob([JSON.stringify(filteredHistory(), null, 2)], {
          type: 'application/json'
        });

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'mission-control-demo-history.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast('Demo activity exported');
        break;
      }
    case 'finish-scenario':
    case 'reconnect':
      ui.scenario = 'normal';
      render();
      toast('Demo workspace is available');
      break;
    case 'reset-demo':
      openModal(
        'Reset this demo?',
        'Restore the starting fixture and appearance.',
        `<p style="font-size:13px">This clears only Obsidian prototype preferences, workers, decisions, projects and conversation. Your actual app and files are not affected.</p>`,
        button('Cancel', 'close-modal') + button('Reset demo', 'confirm-reset', 'rotate-ccw', 'danger')
      );

      break;
    case 'confirm-reset':
      demoGeneration += 1;
      ui.activeRecipe = null;
      state = initial();
      ui.scenario = 'normal';
      ui.terminalOutput = {};
      ui.filter = 'all';
      ui.query = '';
      ui.agent = 0;
      ui.decision = 'test-failure';
      save();
      closeModal();
      go('groundstation');
      toast('Demo reset');
      break;
    }
  });

  function simulateCommand(id, command) {
    const w = state.workers.find(x => x.id === id);
    let out = [...(ui.terminalOutput[id] || logs[id] || [])];

    if (command.trim() === 'clear')
      out = [];
    else {
      out.push(`❯ ${command}`);

      if (command.trim() === 'pwd')
        out.push(currentProject().path);
      else if (command.trim() === 'help')
        out.push('Demo commands: help, pwd, clear, npm test.', 'Other text is echoed only. No process is started.');
      else if (command.trim() === 'npm test')
        out.push('Demo output: 44 checks passed.', 'Use Retry checks in the test inspector to update worker state.');
      else
        out.push('Demo input received. No shell command was executed.');
    }

    ui.terminalOutput[id] = out.slice(-80);
    return w;
  }

  document.addEventListener('submit', e => {
    const form = e.target.closest('[data-form]');

    if (!form)
      return;

    e.preventDefault();

    if (!form.reportValidity())
      return;

    const data = new FormData(form), kind = form.dataset.form;

    if (kind === 'worker') {
      const name = String(data.get('name')).trim(), command = String(data.get('command')).trim();

      if (!name || !command) {
        toast('Enter a worker name and command');
        return;
      }

      const id = 'worker-' + crypto.randomUUID();

      state.workers.push({
        id,
        name,
        command,
        role: data.get('role'),
        state: state.prefs.autoStart ? 'running' : 'idle',
        port: '—',
        icon: 'terminal',
        detail: 'Created in demo',
        activity: 'Just now',
        cpu: '0%',
        memory: '0 MB'
      });

      ui.scenario = 'normal';
      event(`${name} added`, 'Demo worker created');
      closeModal();
      render();
      toast('Worker added to the demo');
    }

    if (kind === 'recipe') {
      const workers = data.getAll('workers');

      if (!workers.length) {
        $('#recipe-error').textContent = 'Choose at least one worker for this recipe.';
        return;
      }

      const name = String(data.get('name')).trim();

      if (!name) {
        $('#recipe-error').textContent = 'Enter a recipe name.';
        return;
      }

      const id = form.dataset.id || 'recipe-' + crypto.randomUUID(),
            r = {
              id,
              name,
              description: String(data.get('description')).trim(),
              workers,
              icon: 'workflow',
              last: 'Not run yet'
            };

      const index = state.recipes.findIndex(x => x.id === id);

      if (index < 0)
        state.recipes.push(r);
      else
        state.recipes[index] = r;

      event(`${name} saved`, 'Demo recipe updated', 'recipe');
      closeModal();
      go('recipes');
      toast('Recipe saved');
    }

    if (kind === 'agent') {
      const name = String(data.get('name')).trim();

      if (!name)
        return;

      state.agentNames.push(name);
      state.agentStates.push('idle');
      ui.agent = state.agentNames.length - 1;
      event(`${name} added`, 'Demo agent created', 'agent');
      closeModal();
      go('agents');
      toast('Demo agent added');
    }

    if (kind === 'project') {
      const name = String(data.get('name')).trim(), path = String(data.get('path')).trim();

      if (!name || !path)
        return;

      state.projects.push({
        name,
        path,
        branch: 'main'
      });

      save();
      closeModal();
      render();
      toast('Demo project added');
    }

    if (kind === 'ai') {
      ask(String(data.get('prompt')));
    }

    if (kind === 'terminal') {
      const command = String(data.get('command')).trim();

      if (!command)
        return;

      simulateCommand(form.dataset.id, command);
      render();
      $(`#terminal-input-${form.dataset.id}`)?.focus();
    }

    if (kind === 'broadcast') {
      const ids = data.getAll('workers'), command = String(data.get('command')).trim();

      if (!ids.length || !command) {
        $('#broadcast-error').textContent = 'Enter a command and choose at least one worker.';
        return;
      }

      ids.forEach(id => simulateCommand(id, command));
      event('Demo command broadcast', `${ids.length} workers · text only`);
      closeModal();
      render();
      toast(`Demo input sent to ${ids.length} workers`);
    }
  });

  document.addEventListener('input', e => {
    if (e.target.id === 'worker-search') {
      ui.query = e.target.value;
      $('#worker-rows').innerHTML = workerRows();
      hydrate();
    }

    if (e.target.id === 'history-search') {
      ui.historyQuery = e.target.value;
      $('#history-list').innerHTML = historyContent();
      hydrate();
    }

    if (e.target.id === 'palette-input')
      paletteResults(e.target.value);
  });

  document.addEventListener('change', e => {
    const pref = e.target.dataset.pref;

    if (pref) {
      state.prefs[pref] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      save();
      applyPrefs();

      if (ui.route === 'settings' && ui.settings === 'terminal' && !modal.open)
        render();
    }

    if (e.target.id === 'history-filter') {
      ui.historyFilter = e.target.value;
      $('#history-list').innerHTML = historyContent();
      hydrate();
    }

    if (e.target.id === 'scenario-select')
      ui.scenario = e.target.value;
  });

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();

      if (modal.open)
        closeModal();
      else
        commandPalette();
    }

    if (e.altKey && /^[1-7]$/.test(e.key)) {
      e.preventDefault();

      if (modal.open)
        closeModal();

      go(nav[Number(e.key) - 1][0]);
    }

    if (e.key === 'Escape' && ui.mobile) {
      ui.mobile = false;
      renderShell();
      hydrate();
    }

    if (modal.open && $('#palette-input')) {
      const results = $$('.palette-result');

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const current = results.indexOf(document.activeElement);
        const next = e.key === 'ArrowDown' ? (current + 1) % results.length : (current <= 0 ? results.length - 1 : current - 1);
        results[next]?.focus();
      }

      if (e.key === 'Enter' && document.activeElement.id === 'palette-input') {
        e.preventDefault();
        results[0]?.click();
      }
    }
  });

  window.addEventListener('hashchange', () => {
    ui.route = routes.some(r => r[0] === location.hash.slice(1)) ? location.hash.slice(1) : 'groundstation';
    ui.mobile = false;
    render();
    $('#content').focus();
    window.scrollTo(0, 0);
  });

  ui.route = routes.some(r => r[0] === location.hash.slice(1)) ? location.hash.slice(1) : 'groundstation';
  render();
})();
