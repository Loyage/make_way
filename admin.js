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
  let catalog = { version: 1, chapters: [] };
  let currentChapterIndex = 0;
  let currentLevelIndex = null;
  let tool = 'water';
  let roadGrade = 0;
  let activeRoute = 0;      // which route the home/goal tools place
  let activeHome = 0;       // which home the "home" tool places
  let activeGoal = 0;       // which goal the "goal" tool places
  let hover = null, dragging = false, dragAnchor = null, lastCell = null;
  let dirty = false;
  let cellSize = 40;

  // ── Current level helpers ─────────────────────────────────────────────
  const chapters = () => catalog.chapters;
  const currentChapter = () => chapters()[currentChapterIndex] || null;
  const current = () => (currentLevelIndex === null ? null : currentChapter()?.levels[currentLevelIndex] || null);
  const allLevels = () => chapters().flatMap(chapter => chapter.levels);
  const currentRoute = () => current()?.routes[activeRoute] || null;
  const currentHome = () => currentRoute()?.homes?.[activeHome] || null;
  const currentGoal = () => currentRoute()?.goals?.[activeGoal] || null;
  function removeInitialEdgesAt(level,cells) { const removed=new Set(cells);level.initialEdges=(level.initialEdges||[]).filter(([a,b])=>!removed.has(a)&&!removed.has(b)); }
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
    catalog = data.catalog;
    currentChapterIndex = 0;
    currentLevelIndex = chapters()[0]?.levels.length ? 0 : null;
    dirty = false;
    const status=$('save-status');status.textContent='已从磁盘载入';status.classList.remove('dirty');
    renderAll();
  }
  async function login(password) {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ password }) });
    $('login').hidden = true; $('panel').hidden = false;
    await loadLevels();
  }
  async function save() {
    await api('/api/levels', { method: 'PUT', body: JSON.stringify(catalog) });
    dirty = false; const el = $('save-status'); el.textContent = '已保存'; el.classList.remove('dirty');
    toast('已保存到 levels.json，重启游戏服务后生效');
  }

  // ── Toast ─────────────────────────────────────────────────────────────
  let toastTimer;
  function toast(text) {
    const el = $('toast'); el.textContent = text; el.classList.add('visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 2600);
  }

  // ── Tool hint (keeps toolbar labels + status bar in sync with the active
  //    home/goal of the active route) ─────────────────────────────────────
  const TOOL_HINTS = {
    water: '水面（点击/拖拽着色）', bridge: '桥梁（置于水面上）', tree: '树木',
    road: '初始道路（拖动连接相邻格）', erase: '擦除地形/断开道路'
  };
  function updateToolHint() {
    const route = currentRoute();
    const homeCount = route ? route.homes.length : 0;
    const goalCount = route ? route.goals.length : 0;
    $('tool-home').textContent = `住宅${homeCount ? ` ${activeHome + 1}/${homeCount}` : '（无，点击新增）'}`;
    $('tool-goal').textContent = `目的地${goalCount ? ` ${activeGoal + 1}/${goalCount}` : '（无，点击新增）'}`;
    if (tool === 'home' || tool === 'goal') {
      const names = { home: `住宅 ${activeHome + 1}（路线 ${activeRoute + 1}，共 ${homeCount} 个）`, goal: `目的地 ${activeGoal + 1}（路线 ${activeRoute + 1}，共 ${goalCount} 个）` };
      $('map-status').textContent = '当前工具：' + names[tool];
    } else {
      $('map-status').textContent = '当前工具：' + TOOL_HINTS[tool];
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────────
  function renderLevelNav() {
    const nav = $('level-nav'); nav.replaceChildren();
    chapters().forEach((chapter, ci) => {
      const group=document.createElement('section');group.className='chapter-nav-group';
      const head=document.createElement('div');head.className='chapter-nav-head';head.classList.toggle('selected',ci===currentChapterIndex);
      const choose=document.createElement('button');choose.className='chapter-select';choose.type='button';
      const title=document.createElement('strong');title.textContent=chapter.name;
      const count=document.createElement('small');count.textContent=`${chapter.levels.length} 关`;
      choose.append(title,count);choose.onclick=()=>selectChapter(ci);
      const edit=document.createElement('button');edit.className='chapter-icon';edit.type='button';edit.textContent='✎';edit.title='编辑章节';edit.onclick=()=>editChapter(ci);
      const remove=document.createElement('button');remove.className='chapter-icon danger-btn';remove.type='button';remove.textContent='×';remove.title='删除章节';remove.onclick=()=>deleteChapter(ci);
      head.append(choose,edit,remove);group.append(head);
      const list=document.createElement('div');list.className='chapter-levels';
      chapter.levels.forEach((level,li)=>{
        const b=document.createElement('button');b.className=ci===currentChapterIndex&&li===currentLevelIndex?'selected':'';
        const name=document.createElement('span');name.textContent=level.name||level.id;
        const id=document.createElement('small');id.textContent=level.id;
        b.append(name,id);b.onclick=()=>selectLevel(ci,li);list.append(b);
      });
      group.append(list);nav.append(group);
    });
  }
  function renderEditor() {
    const level = current();
    const body = $('editor-body');
    if (!level) {
      body.hidden = true; $('editor-title').textContent = currentChapter()?.name || '未选择关卡';
      $('editor-subtitle').textContent = currentChapter()?'此章节暂无关卡，可从左侧新建。':'从左侧选择或新建一个章节开始编辑。';
      return;
    }
    body.hidden = false;
    $('editor-title').textContent = level.name;
    $('editor-subtitle').textContent = `${currentChapter().name} · ${level.difficulty} · ${level.lesson} · id: ${level.id}`;
    const chapterSelect=$('f-chapter');chapterSelect.replaceChildren(...chapters().map(chapter=>{const option=document.createElement('option');option.value=chapter.id;option.textContent=chapter.name;return option;}));chapterSelect.value=currentChapter().id;
    $('f-id').value = level.id;
    $('f-name').value = level.name; $('f-english').value = level.english;
    $('f-difficulty').value = level.difficulty; $('f-lesson').value = level.lesson;
    $('f-title').value = level.title; $('f-description').value = level.description;
    $('f-tip').value = level.tip;
    $('f-budget').value = level.budget; $('f-duration').value = level.duration; $('f-target').value = level.target;
    $('f-bus-line-limit').value = level.busLineLimit ?? 1;
    for (const name of ['grade', 'load', 'cut', 'inspect', 'signals', 'bus']) $('f-' + name).checked = Boolean(level.features[name]);
    renderRoutes();
    draw();
  }
  function renderRoutes() {
    const list = $('route-list'); list.replaceChildren();
    const level = current();
    level.routes.forEach((route, ri) => {
      if (!Array.isArray(route.homes)) route.homes = [];
      if (!Array.isArray(route.goals)) route.goals = [];
      const card = document.createElement('div');
      card.className = 'route-card' + (ri === activeRoute ? ' selected' : '');
      const head = document.createElement('div'); head.className = 'route-card-head';
      const dot = document.createElement('span'); dot.className = 'route-dot'; dot.style.background = route.color;
      const name = document.createElement('input'); name.value = route.name;
      name.onchange = () => { route.name = name.value; markDirty(); renderLevelNav(); };
      const select = document.createElement('button'); select.className = 'tool';
      select.textContent = ri === activeRoute ? '当前' : '设为当前';
      select.onclick = () => { activeRoute = ri; activeHome = 0; activeGoal = 0; renderRoutes(); draw(); };
      head.append(dot, name, select);
      card.append(head);

      const mkCoord = (labelText, val, onchange) => {
        const l = document.createElement('label'); l.textContent = labelText;
        const inp = document.createElement('input'); inp.type = 'text'; inp.value = val;
        inp.onchange = () => { onchange(Number(inp.value)); markDirty(); draw(); };
        l.append(inp); return l;
      };
      const mkText = (labelText, val, onchange) => {
        const l = document.createElement('label'); l.textContent = labelText;
        const inp = document.createElement('input'); inp.type = 'text'; inp.value = val;
        inp.onchange = () => { onchange(inp.value); markDirty(); };
        l.append(inp); return l;
      };

      const homesTitle = document.createElement('strong'); homesTitle.textContent = '住宅（输出）';
      card.append(homesTitle);
      route.homes.forEach((h, hi) => {
        const row = document.createElement('div'); row.className = 'route-card-grid';
        row.append(
          mkCoord(`住宅${hi + 1} 坐标`, h.cell, v => { removeInitialEdgesAt(level,[h.cell]);h.cell = v; }),
          mkText('居民产生率 generationRate（人/秒）', h.generationRate ?? h.rate, v => { h.generationRate = Number(v); delete h.rate; delete h.carRate; }),
          mkText('总人口 passengers', h.passengers, v => { h.passengers = Number(v); })
        );
        const use = document.createElement('button'); use.className = 'tool'; use.textContent = hi === activeHome ? '当前' : '设为当前';
        use.onclick = () => { activeRoute = ri; activeHome = hi; renderRoutes(); draw(); };
        const del = document.createElement('button'); del.className = 'tool danger-btn'; del.textContent = '删除';
        del.onclick = () => { if(route.homes.length===1){toast('每条路线至少保留一个住宅');return;}removeInitialEdgesAt(level,[h.cell]);route.homes.splice(hi, 1); if (activeHome >= route.homes.length) activeHome = Math.max(0, route.homes.length - 1); markDirty(); renderRoutes(); draw(); };
        row.append(use, del); card.append(row);
      });
      const addHome = document.createElement('button'); addHome.className = 'tool'; addHome.textContent = '＋ 住宅';
      addHome.onclick = () => { route.homes.push({ cell: keyCoord(3, 3), generationRate: 1, passengers: 60 }); activeRoute = ri; activeHome = route.homes.length - 1; markDirty(); renderRoutes(); draw(); };
      card.append(addHome);

      const goalsTitle = document.createElement('strong'); goalsTitle.textContent = '目的地（输入）';
      card.append(goalsTitle);
      route.goals.forEach((g, gi) => {
        const row = document.createElement('div'); row.className = 'route-card-grid';
        row.append(
          mkCoord(`目的地${gi + 1} 坐标`, g.cell, v => { removeInitialEdgesAt(level,[g.cell]);g.cell = v; }),
          mkText('标签 label', g.label, v => { g.label = v; }),
          mkText('输入上限 input（留空为不限）', g.input ?? '', v => { g.input = v === '' ? undefined : Number(v); })
        );
        const use = document.createElement('button'); use.className = 'tool'; use.textContent = gi === activeGoal ? '当前' : '设为当前';
        use.onclick = () => { activeRoute = ri; activeGoal = gi; renderRoutes(); draw(); };
        const del = document.createElement('button'); del.className = 'tool danger-btn'; del.textContent = '删除';
        del.onclick = () => { if(route.goals.length===1){toast('每条路线至少保留一个目的地');return;}removeInitialEdgesAt(level,[g.cell]);route.goals.splice(gi, 1); if (activeGoal >= route.goals.length) activeGoal = Math.max(0, route.goals.length - 1); markDirty(); renderRoutes(); draw(); };
        row.append(use, del); card.append(row);
      });
      const addGoal = document.createElement('button'); addGoal.className = 'tool'; addGoal.textContent = '＋ 目的地';
      addGoal.onclick = () => { route.goals.push({ cell: keyCoord(11, 7), label: '目的地' }); activeRoute = ri; activeGoal = route.goals.length - 1; markDirty(); renderRoutes(); draw(); };
      card.append(addGoal);

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
      remove.onclick = () => { if(level.routes.length===1){toast('每个关卡至少保留一条路线');return;}removeInitialEdgesAt(level,[...route.homes,...route.goals].map(building=>building.cell));level.routes.splice(ri, 1); if (activeRoute >= level.routes.length) activeRoute = Math.max(0, level.routes.length - 1); markDirty(); renderRoutes(); draw(); };
      colorRow.append(remove);
      card.append(colorRow);
      list.append(card);
    });
    updateToolHint();
  }
  function renderAll() { renderLevelNav(); renderEditor(); }

  // ── Selection & CRUD ─────────────────────────────────────────────────
  function selectChapter(ci) { currentChapterIndex=ci;currentLevelIndex=chapters()[ci].levels.length?0:null;activeRoute=0;activeHome=0;activeGoal=0;renderAll(); }
  function selectLevel(ci,li) { currentChapterIndex=ci;currentLevelIndex=li;activeRoute=0;activeHome=0;activeGoal=0;renderAll(); }
  function uniqueChapterId() { let n=chapters().length+1,id=`chapter-${n}`;while(chapters().some(chapter=>chapter.id===id))id=`chapter-${++n}`;return id; }
  function newChapter() {
    const chapter={id:uniqueChapterId(),name:'新章节',english:'NEW CHAPTER',levels:[]};
    chapters().push(chapter);currentChapterIndex=chapters().length-1;currentLevelIndex=null;markDirty();renderAll();
  }
  function editChapter(ci) {
    const chapter=chapters()[ci],name=prompt('章节名称',chapter.name);if(name===null)return;
    const english=prompt('章节英文名',chapter.english);if(english===null)return;
    const id=prompt('章节 id（小写字母、数字和连字符）',chapter.id);if(id===null)return;
    const next={name:name.trim(),english:english.trim(),id:id.trim()};
    if(!next.name||!next.english||!/^[-a-z0-9]+$/.test(next.id)){toast('章节名称、英文名不能为空，id 只能包含小写字母、数字和连字符');return;}
    if(chapters().some((item,index)=>index!==ci&&item.id===next.id)){toast('章节 id 不能重复');return;}
    Object.assign(chapter,next);currentChapterIndex=ci;markDirty();renderAll();
  }
  function deleteChapter(ci) {
    const chapter=chapters()[ci];
    if(chapter.levels.length){toast('请先移动或删除该章节中的全部关卡');return;}
    if(chapters().length===1){toast('至少保留一个章节');return;}
    if(!confirm(`确定删除空章节「${chapter.name}」？`))return;
    chapters().splice(ci,1);if(ci<currentChapterIndex)currentChapterIndex--;else if(ci===currentChapterIndex)currentChapterIndex=Math.min(ci,chapters().length-1);currentLevelIndex=chapters()[currentChapterIndex].levels.length?0:null;markDirty();renderAll();
  }
  function newLevel() {
    const chapter=currentChapter();if(!chapter){toast('请先新建章节');return;}
    let n=allLevels().length+1,id=`level-${n}`;while(allLevels().some(level=>level.id===id))id=`level-${++n}`;
    chapter.levels.push({
      id, name: '新关卡', english: 'NEW LEVEL', difficulty: '自定义', title: '未命名关卡',
      description: '请在此填写关卡任务说明。', tip: '请在此填写给玩家的规划提示。', lesson: '自定义', features: { grade: true, load: true, cut: true, inspect: true, signals: true, bus: true },
      busLineLimit: 3, budget: 100, duration: 90, target: 100, water: [], bridges: [], trees: [], routes: [{
        name: '路线一 → 目的地', color: COLORS[0].color, light: COLORS[0].light,
        homes: [{ cell: keyCoord(2, 2), generationRate: 1, passengers: 60 }],
        goals: [{ cell: keyCoord(12, 8), label: '目的地' }]
      }], initialEdges: []
    });
    currentLevelIndex=chapter.levels.length-1;activeRoute=0;activeHome=0;activeGoal=0;markDirty();renderAll();
  }
  function duplicateLevel() {
    const src=current(),chapter=currentChapter();if(!src)return;
    const copy=JSON.parse(JSON.stringify(src)),base=copy.id+'-copy';let id=base,n=2;while(allLevels().some(level=>level.id===id))id=`${base}-${n++}`;copy.id=id;copy.name=copy.name+'（副本）';
    chapter.levels.splice(currentLevelIndex+1,0,copy);currentLevelIndex++;activeRoute=0;activeHome=0;activeGoal=0;markDirty();renderAll();
  }
  function deleteLevel() {
    const level=current(),chapter=currentChapter();if(!level)return;
    if(!confirm(`确定删除关卡「${level.name}」？此操作不可撤销。`))return;
    chapter.levels.splice(currentLevelIndex,1);currentLevelIndex=chapter.levels.length?Math.min(currentLevelIndex,chapter.levels.length-1):null;
    activeRoute=0;activeHome=0;activeGoal=0;markDirty();renderAll();
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
    const occupied = level.routes.some(route=>[...(route.homes||[]),...(route.goals||[])].some(building=>building.cell===cell));
    if (['water','bridge','tree'].includes(tool) && occupied) { toast('建筑所在格不能改为水面、桥梁或树木'); return; }
    if (tool === 'home' || tool === 'goal') {
      const route=currentRoute();if(!route){toast('请先添加一条路线');return;}
      const building=tool==='home'?route.homes[activeHome]:route.goals[activeGoal];
      const conflict=level.routes.some(item=>[...item.homes,...item.goals].some(other=>other!==building&&other.cell===cell));
      if(conflict){toast(`此处已有其他住宅或目的地（格 ${cell}）`);return;}
      if(building.cell!==cell)removeInitialEdgesAt(level,[building.cell]);
      remove(level.water);remove(level.trees);remove(level.bridges);building.cell=cell;
    } else if (tool === 'erase') {
      // Remove terrain and any edge touching this cell. Buildings are edited
      // with their dedicated tools and are intentionally preserved.
      remove(level.water); remove(level.trees); remove(level.bridges);
      level.initialEdges = (level.initialEdges || []).filter(([a, b]) => a !== cell && b !== cell);
    } else {
      if (tool === 'water') { level.water.push(cell); remove(level.bridges); remove(level.trees); level.initialEdges=(level.initialEdges||[]).filter(([a,b])=>a!==cell&&b!==cell); }
      else if (tool === 'bridge') { if (!level.water.includes(cell)) level.water.push(cell); if (!level.bridges.includes(cell)) level.bridges.push(cell); remove(level.trees); }
      else if (tool === 'tree') { remove(level.water); remove(level.bridges); if (!level.trees.includes(cell)) level.trees.push(cell); level.initialEdges=(level.initialEdges||[]).filter(([a,b])=>a!==cell&&b!==cell); }
    }
    level.water = [...new Set(level.water)];
    level.bridges = [...new Set(level.bridges)];
    level.trees = [...new Set(level.trees)];
    updateToolHint();markDirty();draw();
  }
  function connectCells(a, b) {
    const level = current();
    if (a === b) return;
    const ax = point(a).x, ay = point(a).y, bx = point(b).x, by = point(b).y;
    if (Math.abs(ax - bx) + Math.abs(ay - by) !== 1) return;
    const buildings=new Set(level.routes.flatMap(route=>[...route.homes,...route.goals].map(building=>building.cell)));
    if(buildings.has(a)&&buildings.has(b)){toast('初始道路不能直接连接两座建筑');return;}
    for(const cell of [a,b]) if(!buildings.has(cell)&&(level.trees.includes(cell)||level.water.includes(cell)&&!level.bridges.includes(cell))){toast('初始道路不能经过树木或非桥梁水面');return;}
    const existing = (level.initialEdges || []).find(([x, y]) => x === a && y === b || x === b && y === a);
    if (existing) {
      if(existing[2]!==roadGrade){existing[2]=roadGrade;markDirty();}
    } else { level.initialEdges = (level.initialEdges || []).concat([[a,b,roadGrade]]); markDirty(); }
  }
  function connectPath(from,to) {
    let {x,y}=point(from);const target=point(to),dx=Math.abs(target.x-x),dy=Math.abs(target.y-y);let ix=0,iy=0,current=from;
    while(x!==target.x||y!==target.y){
      if(x!==target.x&&(y===target.y||(ix+.5)/(dx||1)<=(iy+.5)/(dy||1))){x+=Math.sign(target.x-x);ix++;}
      else{y+=Math.sign(target.y-y);iy++;}
      const next=keyCoord(x,y);connectCells(current,next);current=next;
    }
    return current;
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
      (route.homes || []).forEach(h => drawBuilding(h.cell, route.color, true));
      (route.goals || []).forEach(g => drawBuilding(g.cell, route.color, false));
    });
    // highlight the active home/goal of the active route
    const route = currentRoute();
    if (route) {
      const ch = route.homes?.[activeHome];
      const cg = route.goals?.[activeGoal];
      if (ch) markActive(ch.cell, route.color);
      if (cg) markActive(cg.cell, route.color);
    }
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
  function markActive(n, color) {
    const s = cellSize; const { x, y } = point(n);
    ctx.save();
    ctx.strokeStyle = '#e0ac58';
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect((x + .08) * s, (y + .08) * s, s * .84, s * .84);
    ctx.restore();
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
  $('logout').onclick = async () => { if(dirty&&!confirm('有未保存更改，确定退出登录并放弃这些更改吗？'))return;dirty=false;await api('/api/logout', { method: 'POST' }); location.reload(); };
  $('save').onclick = async () => { try { await save(); } catch (err) { toast('保存失败：' + err.message); } };
  $('reload').onclick = async () => { if(dirty&&!confirm('有未保存更改，确定从磁盘重新载入并放弃这些更改吗？'))return;try { await loadLevels(); toast('已从磁盘重新载入'); } catch (err) { toast(err.message); } };
  $('new-chapter').onclick = newChapter;
  $('new-level').onclick = newLevel;
  $('duplicate').onclick = duplicateLevel;
  $('delete-level').onclick = deleteLevel;
  $('add-route').onclick = () => {
    const level = current(); if (!level) return;
    const c = COLORS[level.routes.length % COLORS.length];
    level.routes.push({ name: '新路线 → 目的地', color: c.color, light: c.light, homes: [{ cell: keyCoord(3, 3), generationRate: 1, passengers: 60 }], goals: [{ cell: keyCoord(11, 7), label: '目的地' }] });
    activeRoute = level.routes.length - 1; activeHome = 0; activeGoal = 0; markDirty(); renderRoutes(); draw();
  };

  // Bind field inputs to current level
  $('f-chapter').onchange=()=>{
    const level=current(),targetIndex=chapters().findIndex(chapter=>chapter.id===$('f-chapter').value);if(!level||targetIndex<0||targetIndex===currentChapterIndex)return;
    currentChapter().levels.splice(currentLevelIndex,1);chapters()[targetIndex].levels.push(level);currentChapterIndex=targetIndex;currentLevelIndex=chapters()[targetIndex].levels.length-1;markDirty();renderAll();toast('关卡已移动到所选章节');
  };
  const textFields = { 'f-id': 'id', 'f-name': 'name', 'f-english': 'english', 'f-difficulty': 'difficulty', 'f-lesson': 'lesson', 'f-title': 'title', 'f-description': 'description', 'f-tip': 'tip' };
  for (const [elId, prop] of Object.entries(textFields)) {
    $(elId).onchange = () => { const l = current(); if (l) { l[prop] = $(elId).value; markDirty(); renderLevelNav(); $('editor-title').textContent = l.name; } };
  }
  for (const elId of ['f-budget', 'f-duration', 'f-target']) {
    $(elId).onchange = () => { const l = current(); const prop = elId.replace('f-', ''); if (l) { l[prop] = Number($(elId).value); markDirty(); } };
  }
  $('f-bus-line-limit').onchange = () => { const l = current(); if (l) { l.busLineLimit = Number($('f-bus-line-limit').value); markDirty(); } };
  for (const name of ['grade', 'load', 'cut', 'inspect', 'signals', 'bus']) {
    $('f-' + name).onchange = () => { const l = current(); if (l) { l.features[name] = $('f-' + name).checked; markDirty(); } };
  }

  // Tool buttons
  document.querySelectorAll('.toolbar [data-tool]').forEach(btn => {
    btn.onclick = () => {
      tool = btn.dataset.tool;
      document.querySelectorAll('.toolbar [data-tool]').forEach(b => b.classList.toggle('active', b === btn));
      $('grade-control').style.visibility = tool === 'road' ? 'visible' : 'hidden';
      updateToolHint();
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
      lastCell = connectPath(lastCell, hover);
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

  $('grade-control').style.visibility = 'hidden';
  new ResizeObserver(resize).observe(canvas);
  resize();
})();
