(() => {
  'use strict';
  const WIDTH = 16, HEIGHT = 12;
  const $ = id => document.getElementById(id);
  const keyCoord = (x, y) => y * WIDTH + x;
  const point = n => ({ x: n % WIDTH, y: Math.floor(n / WIDTH) });
  const COLORS = [
    { color: '#638d69', light: '#dae6cb', name: '松林' },
    { color: '#d19157', light: '#f2dfbf', name: '日落' },
    { color: '#9582b4', light: '#e7dff0', name: '丁香' },
    { color: '#578fa4', light: '#d3e7ed', name: '海风' },
    { color: '#bf768b', light: '#efd9e1', name: '玫瑰' }
  ];

  const canvas = $('map'), ctx = canvas.getContext('2d');
  let levels = [];          // full level set
  let currentIndex = null;  // selected index into levels
  let tool = 'water';
  let roadGrade = 0;
  let activeRoute = 0;      // which route the home/goal tools place
  let hover = null, dragging = false, dragAnchor = null, lastCell = null;
  let dirty = false;
  let cellSize = 40;

  // ── Current level helpers ─────────────────────────────────────────────
  const current = () => (currentIndex === null ? null : levels[currentIndex]);
  const currentRoute = () => current()?.routes[activeRoute] || null;
  function markDirty() { dirty = true; const el = $('save-status'); el.textContent = '有未保存更改'; el.classList.add('dirty'); }

  // ── API ───────────────────────────────────────────────────────────────
  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: options.body ? { 'Content-Type': 'application/json' } : {},
      ...options
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
      throw new Error(msg);
    }
    return res.json();
  }
  async function loadLevels() {
    const data = await api('/api/levels');
    levels = data.levels;
    currentIndex = levels.length ? 0 : null;
    dirty = false;
    renderAll();
  }
  async function login(password) {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ password }) });
    $('login').hidden = true; $('panel').hidden = false;
    await loadLevels();
  }
  async function save() {
    await api('/api/levels', { method: 'PUT', body: JSON.stringify(levels) });
    dirty = false; const el = $('save-status'); el.textContent = '已保存'; el.classList.remove('dirty');
    toast('已保存到 levels.json，重启游戏服务后生效');
  }

  // ── Toast ─────────────────────────────────────────────────────────────
  let toastTimer;
  function toast(text) {
    const el = $('toast'); el.textContent = text; el.classList.add('visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 2600);
  }

  // ── Rendering ─────────────────────────────────────────────────────────
  function renderLevelNav() {
    const nav = $('level-nav'); nav.replaceChildren();
    levels.forEach((level, i) => {
      const b = document.createElement('button');
      b.className = i === currentIndex ? 'selected' : '';
      const name = document.createElement('span'); name.textContent = level.name || level.id;
      const id = document.createElement('small'); id.textContent = level.id;
      b.append(name, id);
      b.onclick = () => selectLevel(i);
      nav.append(b);
    });
  }
  function renderEditor() {
    const level = current();
    const body = $('editor-body');
    if (!level) {
      body.hidden = true; $('editor-title').textContent = '未选择关卡';
      $('editor-subtitle').textContent = '从左侧选择或新建一个关卡开始编辑。';
      return;
    }
    body.hidden = false;
    $('editor-title').textContent = level.name;
    $('editor-subtitle').textContent = `${level.difficulty} · ${level.lesson} · id: ${level.id}`;
    $('f-id').value = level.id;
    $('f-name').value = level.name; $('f-english').value = level.english;
    $('f-difficulty').value = level.difficulty; $('f-lesson').value = level.lesson;
    $('f-title').value = level.title; $('f-description').value = level.description;
    $('f-tip').value = level.tip;
    $('f-budget').value = level.budget; $('f-duration').value = level.duration; $('f-target').value = level.target;
    for (const name of ['grade', 'load', 'cut', 'inspect', 'signals']) $('f-' + name).checked = level.features[name];
    renderRoutes();
    draw();
  }
  function renderRoutes() {
    const list = $('route-list'); list.replaceChildren();
    const level = current();
    level.routes.forEach((route, i) => {
      const card = document.createElement('div');
      card.className = 'route-card' + (i === activeRoute ? ' selected' : '');
      const head = document.createElement('div'); head.className = 'route-card-head';
      const dot = document.createElement('span'); dot.className = 'route-dot'; dot.style.background = route.color;
      const name = document.createElement('input'); name.value = route.name;
      name.onchange = () => { route.name = name.value; markDirty(); renderLevelNav(); };
      const select = document.createElement('button'); select.className = 'tool';
      select.textContent = i === activeRoute ? '当前' : '设为当前';
      select.onclick = () => { activeRoute = i; renderRoutes(); draw(); };
      head.append(dot, name, select);
      card.append(head);

      const grid = document.createElement('div'); grid.className = 'route-card-grid';
      const mkLabel = (labelText, val, onchange) => {
        const l = document.createElement('label'); l.textContent = labelText;
        const inp = document.createElement('input'); inp.type = 'text'; inp.value = val;
        inp.onchange = () => { onchange(inp.value); markDirty(); };
        l.append(inp); return l;
      };
      grid.append(
        mkLabel('目的地标签 label', route.label, v => route.label = v),
        mkLabel('客流速率 rate（人/秒）', route.rate, v => { route.rate = Number(v); }),
        mkLabel('住宅坐标 home', route.home, v => { route.home = Number(v); markDirty(); draw(); }),
        mkLabel('目的地坐标 goal', route.goal, v => { route.goal = Number(v); markDirty(); draw(); }),
        mkLabel('本轮人数 passengers', route.passengers, v => { route.passengers = Number(v); })
      );
      card.append(grid);

      const colorRow = document.createElement('div'); colorRow.className = 'color-row';
      colorRow.append(document.createTextNode('配色：'));
      COLORS.forEach(c => {
        const sw = document.createElement('button'); sw.className = 'color-swatch' + (route.color === c.color ? ' selected' : '');
        sw.style.background = c.color; sw.title = c.name;
        sw.onclick = () => { route.color = c.color; route.light = c.light; markDirty(); renderRoutes(); draw(); };
        colorRow.append(sw);
      });
      const remove = document.createElement('button'); remove.className = 'tool danger-btn'; remove.textContent = '删除路线';
      remove.style.marginLeft = 'auto';
      remove.onclick = () => { level.routes.splice(i, 1); if (activeRoute >= level.routes.length) activeRoute = Math.max(0, level.routes.length - 1); markDirty(); renderRoutes(); draw(); };
      colorRow.append(remove);
      card.append(colorRow);
      list.append(card);
    });
  }
  function renderAll() { renderLevelNav(); renderEditor(); }

  // ── Selection & CRUD ─────────────────────────────────────────────────
  function selectLevel(i) { currentIndex = i; activeRoute = 0; renderAll(); }
  function newLevel() {
    const id = 'level-' + (levels.length + 1);
    levels.push({
      id, name: '新关卡', english: 'NEW LEVEL', difficulty: '自定义', title: '未命名关卡',
      description: '', tip: '', lesson: '自定义', features: { grade: true, load: true, cut: true, inspect: true, signals: true },
      budget: 100, duration: 90, target: 100, water: [], bridges: [], trees: [], routes: [{
        name: '路线一 → 目的地', color: COLORS[0].color, light: COLORS[0].light,
        home: keyCoord(2, 2), goal: keyCoord(12, 8), label: '目的地', rate: 1, passengers: 60
      }], initialEdges: []
    });
    currentIndex = levels.length - 1; activeRoute = 0; markDirty(); renderAll();
  }
  function duplicateLevel() {
    const src = current(); if (!src) return;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = copy.id + '-copy'; copy.name = copy.name + '（副本）';
    levels.splice(currentIndex + 1, 0, copy);
    currentIndex = currentIndex + 1; activeRoute = 0; markDirty(); renderAll();
  }
  function deleteLevel() {
    const level = current(); if (!level) return;
    if (!confirm(`确定删除关卡「${level.name}」？此操作不可撤销。`)) return;
    levels.splice(currentIndex, 1);
    currentIndex = levels.length ? Math.min(currentIndex, levels.length - 1) : null;
    activeRoute = 0; markDirty(); renderAll();
  }

  // ── Map editing ──────────────────────────────────────────────────────
  function cellFromEvent(evt) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((evt.clientX - rect.left) / rect.width * WIDTH);
    const y = Math.floor((evt.clientY - rect.top) / rect.height * HEIGHT);
    return (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT) ? keyCoord(x, y) : null;
  }
  function applyTool(cell) {
    const level = current(); if (cell === null || !level) return;
    const remove = arr => { const i = arr.indexOf(cell); if (i >= 0) arr.splice(i, 1); };
    if (tool === 'home') { currentRoute().home = cell; }
    else if (tool === 'goal') { currentRoute().goal = cell; }
    else if (tool === 'erase') {
      // Remove terrain and any edge touching this cell.
      remove(level.water); remove(level.trees); remove(level.bridges);
      level.initialEdges = (level.initialEdges || []).filter(([a, b]) => a !== cell && b !== cell);
      // If a home/goal sits here, do nothing to it (must use home/goal tools).
    } else {
      if (tool === 'water') { level.water.push(cell); remove(level.bridges); remove(level.trees); }
      else if (tool === 'bridge') { if (!level.water.includes(cell)) level.water.push(cell); if (!level.bridges.includes(cell)) level.bridges.push(cell); remove(level.trees); }
      else if (tool === 'tree') { remove(level.water); remove(level.bridges); if (!level.trees.includes(cell)) level.trees.push(cell); }
    }
    // Deduplicate terrain arrays.
    level.water = [...new Set(level.water)];
    level.bridges = [...new Set(level.bridges)];
    level.trees = [...new Set(level.trees)];
    markDirty(); draw();
  }
  function connectCells(a, b) {
    const level = current();
    if (a === b) return;
    const ax = point(a).x, ay = point(a).y, bx = point(b).x, by = point(b).y;
    if (Math.abs(ax - bx) + Math.abs(ay - by) !== 1) return; // must be adjacent
    const edge = [a, b, roadGrade];
    const exists = (level.initialEdges || []).some(([x, y]) => (x === a && y === b) || (x === b && y === a));
    if (!exists) { level.initialEdges = (level.initialEdges || []).concat([edge]); markDirty(); }
  }

  // ── Drawing ──────────────────────────────────────────────────────────
  function resize() {
    const width = canvas.getBoundingClientRect().width;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(width * HEIGHT / WIDTH * dpr);
    cellSize = width / WIDTH;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  function draw() {
    const s = cellSize, w = WIDTH * s, h = HEIGHT * s;
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#eaf0df'; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
      ctx.strokeStyle = '#dce5d04d'; ctx.lineWidth = .65; ctx.strokeRect(x * s, y * s, s, s);
    }
    const level = current(); if (!level) return;
    // terrain
    for (const n of level.water) { const { x, y } = point(n); ctx.fillStyle = '#bbd9d8'; ctx.fillRect(x * s, y * s, s, s); }
    for (const n of level.trees) { const { x, y } = point(n); ctx.fillStyle = '#a9c398'; ctx.beginPath(); ctx.arc((x + .5) * s, (y + .5) * s, s * .3, 0, Math.PI * 2); ctx.fill(); }
    // initial roads
    for (const [a, b, grade] of level.initialEdges || []) {
      const pa = point(a), pb = point(b);
      const color = ['#b3bfa7', '#8da79c', '#708b9b'][grade] || '#b3bfa7';
      const width = [.3, .54, .78][grade] || .3;
      ctx.strokeStyle = color; ctx.lineWidth = s * width; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo((pa.x + .5) * s, (pa.y + .5) * s);
      ctx.lineTo((pb.x + .5) * s, (pb.y + .5) * s);
      ctx.stroke();
    }
    // buildings
    level.routes.forEach((route) => {
      drawBuilding(route.home, route.color, true);
      drawBuilding(route.goal, route.color, false);
    });
    // bridges over water
    for (const n of level.bridges) { const { x, y } = point(n); ctx.fillStyle = '#708b9b'; ctx.fillRect((x + .15) * s, (y + .5) * s, s * .7, s * .3); }
    // hover highlight
    if (hover !== null) {
      const { x, y } = point(hover);
      ctx.strokeStyle = tool === 'erase' ? '#c68b56' : '#6d936b'; ctx.lineWidth = 2;
      ctx.strokeRect(x * s + 1, y * s + 1, s - 2, s - 2);
    }
  }
  function drawBuilding(n, color, isHome) {
    const s = cellSize; const { x, y } = point(n);
    const cx = (x + .5) * s, cy = (y + .5) * s;
    ctx.fillStyle = color;
    if (isHome) {
      ctx.beginPath(); ctx.moveTo(cx - s * .22, cy + s * .05); ctx.lineTo(cx, cy - s * .26); ctx.lineTo(cx + s * .22, cy + s * .05); ctx.closePath(); ctx.fill();
      ctx.fillRect(cx - s * .17, cy + s * .02, s * .34, s * .3);
      ctx.fillStyle = '#fffef9'; ctx.font = `600 ${s * .2}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('⌂', cx, cy + s * .12);
    } else {
      ctx.fillRect(cx - s * .24, cy - s * .22, s * .48, s * .44);
      ctx.fillStyle = '#fffef9'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('▣', cx, cy);
    }
  }

  // ── Event wiring ─────────────────────────────────────────────────────
  async function doLogin() {
    const password = $('login-password').value;
    const errEl = $('login-error');
    errEl.textContent = '';
    if (!password) { errEl.textContent = '请输入管理员密码'; errEl.closest('.login-card').classList.remove('login-shake'); void errEl.closest('.login-card').offsetWidth; errEl.closest('.login-card').classList.add('login-shake'); return; }
    try { await login(password); }
    catch (err) {
      errEl.textContent = '登录失败：' + err.message;
      const card = errEl.closest('.login-card'); card.classList.remove('login-shake'); void card.offsetWidth; card.classList.add('login-shake');
    }
  }
  $('login-submit').onclick = doLogin;
  $('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doLogin(); } });
  $('logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); location.reload(); };
  $('save').onclick = async () => { try { await save(); } catch (err) { toast('保存失败：' + err.message); } };
  $('reload').onclick = async () => { try { await loadLevels(); toast('已从磁盘重新载入'); } catch (err) { toast(err.message); } };
  $('new-level').onclick = newLevel;
  $('duplicate').onclick = duplicateLevel;
  $('delete-level').onclick = deleteLevel;
  $('add-route').onclick = () => {
    const level = current(); if (!level) return;
    const c = COLORS[level.routes.length % COLORS.length];
    level.routes.push({ name: '新路线 → 目的地', color: c.color, light: c.light, home: keyCoord(3, 3), goal: keyCoord(11, 7), label: '目的地', rate: 1, passengers: 60 });
    activeRoute = level.routes.length - 1; markDirty(); renderRoutes(); draw();
  };

  // Bind field inputs to current level
  const textFields = { 'f-id': 'id', 'f-name': 'name', 'f-english': 'english', 'f-difficulty': 'difficulty', 'f-lesson': 'lesson', 'f-title': 'title', 'f-description': 'description', 'f-tip': 'tip' };
  for (const [elId, prop] of Object.entries(textFields)) {
    $(elId).onchange = () => { const l = current(); if (l) { l[prop] = $(elId).value; markDirty(); renderLevelNav(); $('editor-title').textContent = l.name; } };
  }
  for (const elId of ['f-budget', 'f-duration', 'f-target']) {
    $(elId).onchange = () => { const l = current(); const prop = elId.replace('f-', ''); if (l) { l[prop] = Number($(elId).value); markDirty(); } };
  }
  for (const name of ['grade', 'load', 'cut', 'inspect', 'signals']) {
    $('f-' + name).onchange = () => { const l = current(); if (l) { l.features[name] = $('f-' + name).checked; markDirty(); } };
  }

  // Tool buttons
  document.querySelectorAll('.toolbar [data-tool]').forEach(btn => {
    btn.onclick = () => {
      tool = btn.dataset.tool;
      document.querySelectorAll('.toolbar [data-tool]').forEach(b => b.classList.toggle('active', b === btn));
      const names = { water: '水面（点击/拖拽着色）', bridge: '桥梁（置于水面上）', tree: '树木', home: `住宅（路线 ${activeRoute + 1}）`, goal: `目的地（路线 ${activeRoute + 1}）`, road: '初始道路（拖动连接相邻格）', erase: '擦除地形/断开道路' };
      $('map-status').textContent = '当前工具：' + names[tool];
      $('grade-control').style.visibility = tool === 'road' ? 'visible' : 'hidden';
    };
  });
  $('road-grade').onchange = () => { roadGrade = Number($('road-grade').value); };

  // Canvas interaction
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); canvas.setPointerCapture(e.pointerId);
    dragging = true; hover = cellFromEvent(e); lastCell = hover; dragAnchor = hover;
    if (tool === 'road') { /* start drag, connect on move */ }
    else if (hover !== null) applyTool(hover);
  });
  canvas.addEventListener('pointermove', e => {
    hover = cellFromEvent(e);
    if (dragging && tool === 'road' && hover !== null && lastCell !== null) {
      connectCells(lastCell, hover); lastCell = hover;
    } else if (dragging && tool !== 'road' && hover !== null) {
      if (hover !== lastCell) { lastCell = hover; applyTool(hover); }
    }
    if (!dragging) draw();
  });
  const endDrag = () => { dragging = false; lastCell = null; dragAnchor = null; draw(); };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => { hover = null; if (!dragging) draw(); });

  // Keyboard: 1-7 tools
  const toolOrder = ['water', 'bridge', 'tree', 'home', 'goal', 'road', 'erase'];
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    const idx = parseInt(e.key, 10) - 1;
    if (idx >= 0 && idx < toolOrder.length) {
      const btn = document.querySelector(`.toolbar [data-tool="${toolOrder[idx]}"]`);
      if (btn) btn.click();
    }
    if (e.key.toLowerCase() === 's') { save().catch(err => toast('保存失败：' + err.message)); }
  });

  // Detect unsaved changes before leaving
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  new ResizeObserver(resize).observe(canvas);
  resize();
})();
