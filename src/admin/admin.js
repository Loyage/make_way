(() => {
  'use strict';
  const DEFAULT_WIDTH = 16, DEFAULT_HEIGHT = 12, MIN_MAP_SIZE = 8, MAX_MAP_SIZE = 64;
  const $ = id => document.getElementById(id);
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
  let activeCampaignDay = 0;
  let tool = 'view';
  let roadGrade = 0;
  let activeRoute = 0;      // which route the home/goal tools place
  let activeHome = 0;       // which home the "home" tool places
  let activeGoal = 0;       // which goal the "goal" tool places
  let hover = null, dragging = false, dragAnchor = null, lastCell = null;
  let dirty = false, savedSnapshot = '', history = [], historyIndex = -1, historyBatching = false;
  let simulationCity = null, simulationLevelId = null, simulationDay = 0, simulationSpeed = 1, simulationFrame = 0, simulationLast = 0, simulationAccumulator = 0, validationTimer = 0, validationSeq = 0;
  let cellSize = 40, viewportWidth = 0, viewportHeight = 0, viewZoom = 1, viewX = 0, viewY = 0, viewTarget = null, panLast = null;
  const pointers=new Map();let pinch=null;

  // ── Current level helpers ─────────────────────────────────────────────
  const chapters = () => catalog.chapters;
  const currentChapter = () => chapters()[currentChapterIndex] || null;
  const current = () => (currentLevelIndex === null ? null : currentChapter()?.levels[currentLevelIndex] || null);
  const mapWidth = () => current()?.width ?? DEFAULT_WIDTH;
  const mapHeight = () => current()?.height ?? DEFAULT_HEIGHT;
  const keyCoord = (x, y) => y * mapWidth() + x;
  const point = n => ({ x: n % mapWidth(), y: Math.floor(n / mapWidth()) });
  const allLevels = () => chapters().flatMap(chapter => chapter.levels);
  const activeRoutes = () => current()?.campaign?.days?.[activeCampaignDay]?.routes || current()?.routes || [];
  const allRoutes = level => level?.campaign?.days?.flatMap(day => day.routes || []) || level?.routes || [];
  const currentRoute = () => activeRoutes()[activeRoute] || null;
  const currentHome = () => currentRoute()?.homes?.[activeHome] || null;
  const currentGoal = () => currentRoute()?.goals?.[activeGoal] || null;
  const routePopulation = routes => routes.reduce((sum,route)=>sum+(route.homes||[]).reduce((total,home)=>total+Number(home.passengers||0),0),0);
  function removeLegacyTargets(data){for(const level of data.chapters.flatMap(chapter=>chapter.levels)){delete level.target;for(const day of level.campaign?.days||[])delete day.target;}return data;}
  const cellToXY = n => ({ x: n % mapWidth() - Math.floor(mapWidth()/2), y: Math.floor((mapHeight()-1)/2) - Math.floor(n / mapWidth()) });
  const xyToCell = (x, y) => { const col=x+Math.floor(mapWidth()/2),row=Math.floor((mapHeight()-1)/2)-y;return Number.isInteger(x)&&Number.isInteger(y)&&col>=0&&col<mapWidth()&&row>=0&&row<mapHeight()?keyCoord(col,row):null; };
  function removeInitialEdgesAt(level,cells) { const removed=new Set(cells);level.initialEdges=(level.initialEdges||[]).filter(([a,b])=>!removed.has(a)&&!removed.has(b)); }
  const catalogSnapshot = () => JSON.stringify(catalog);
  function updateDirtyStatus(label = '') {
    dirty = catalogSnapshot() !== savedSnapshot;
    const el = $('save-status'); el.textContent = label || (dirty ? '有未保存更改' : '已保存'); el.classList.toggle('dirty', dirty);
  }
  function updateHistoryButtons() { $('undo').disabled=historyIndex<=0;$('redo').disabled=historyIndex>=history.length-1; }
  function commitHistory() {
    const snapshot=catalogSnapshot();if(history[historyIndex]===snapshot){updateHistoryButtons();return;}
    history=history.slice(0,historyIndex+1);history.push(snapshot);if(history.length>60)history.shift();historyIndex=history.length-1;updateHistoryButtons();
  }
  function resetHistory(label) { savedSnapshot=catalogSnapshot();history=[savedSnapshot];historyIndex=0;updateHistoryButtons();updateDirtyStatus(label);scheduleValidation(); }
  function restoreHistory(index) {
    if(index<0||index>=history.length)return;stopSimulation(false);historyIndex=index;catalog=JSON.parse(history[index]);
    currentChapterIndex=Math.min(currentChapterIndex,Math.max(0,chapters().length-1));currentLevelIndex=currentLevelIndex===null?null:Math.min(currentLevelIndex,Math.max(0,(currentChapter()?.levels.length||1)-1));
    activeCampaignDay=0;activeRoute=0;activeHome=0;activeGoal=0;updateHistoryButtons();updateDirtyStatus();renderAll();scheduleValidation();
  }
  function markDirty() { if(simulationCity)stopSimulation();if(!historyBatching)commitHistory();updateDirtyStatus();scheduleValidation(); }

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
  async function validateCatalog(showToast = false) {
    const seq=++validationSeq,el=$('validation-status');el.textContent='校验中…';el.className='validation-status';
    try { const result=await api('/api/validate',{method:'POST',body:JSON.stringify(catalog)});if(seq!==validationSeq)return;el.textContent='✓ 配置有效';el.className='validation-status valid';if(showToast)toast('配置校验通过');return result; }
    catch(error){if(seq!==validationSeq)return;el.textContent='✕ '+error.message;el.className='validation-status invalid';if(showToast)toast('校验失败：'+error.message);return null;}
  }
  function scheduleValidation(){clearTimeout(validationTimer);validationTimer=setTimeout(()=>validateCatalog(false),400);}
  async function loadLevels() {
    const data = await api('/api/levels');
    catalog = removeLegacyTargets(data.catalog);
    currentChapterIndex = 0;
    currentLevelIndex = chapters()[0]?.levels.length ? 0 : null;
    stopSimulation(false);resetHistory('已从磁盘载入');
    renderAll();loadPresets().catch(()=>{});
  }
  async function login(password) {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ password }) });
    $('login').hidden = true; $('panel').hidden = false;
    await loadLevels();
  }
  async function save() {
    await api('/api/levels', { method: 'PUT', body: JSON.stringify(catalog) });
    savedSnapshot=catalogSnapshot();updateDirtyStatus('已保存');
    toast('已保存 levels.json 清单和 levels.local/ 分关数据，重启游戏服务后生效');
  }
  async function loadPresets() {
    const data = await api('/api/presets');
    const select = $('preset-select'), current = select.value;
    select.replaceChildren();
    const empty = document.createElement('option'); empty.value = ''; empty.textContent = data.presets.length ? '选择配置…' : '（暂无保存的配置）';
    select.append(empty);
    for (const name of data.presets) { const o = document.createElement('option'); o.value = name; o.textContent = name; select.append(o); }
    if (current && data.presets.includes(current)) select.value = current;
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
    view: '观察（拖动查看，Ctrl + 滚动缩放）', water: '水面（点击/拖拽着色）', bridge: '桥梁（置于水面上）', tree: '树木',
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
        const row=document.createElement('div');row.className='level-row';
        const order=document.createElement('span');order.className='level-order';order.textContent=String(li+1).padStart(2,'0');order.title=`第 ${li+1} 关`;
        const b=document.createElement('button');b.type='button';b.className=ci===currentChapterIndex&&li===currentLevelIndex?'selected':'';
        const name=document.createElement('span');name.textContent=level.name||level.id;
        const id=document.createElement('small');id.textContent=level.id;
        b.append(name,id);b.onclick=()=>selectLevel(ci,li);
        const up=document.createElement('button');up.className='level-move';up.type='button';up.textContent='↑';up.title='上移关卡';up.disabled=li===0;up.onclick=()=>moveLevel(ci,li,-1);
        const down=document.createElement('button');down.className='level-move';down.type='button';down.textContent='↓';down.title='下移关卡';down.disabled=li===chapter.levels.length-1;down.onclick=()=>moveLevel(ci,li,1);
        row.append(order,b,up,down);list.append(row);
      });
      group.append(list);nav.append(group);
    });
  }
  function moveLevel(ci,li,delta) {
    const chapter=chapters()[ci],target=li+delta;
    if(target<0||target>=chapter.levels.length)return;
    const [level]=chapter.levels.splice(li,1);chapter.levels.splice(target,0,level);
    currentChapterIndex=ci;currentLevelIndex=target;activeCampaignDay=0;activeRoute=0;activeHome=0;activeGoal=0;
    markDirty();renderAll();
  }
  function renderEditor() {
    const level = current();
    if(simulationCity&&(simulationLevelId!==level?.id||simulationDay!==activeCampaignDay))stopSimulation(false);
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
    $('f-budget').value = level.budget; $('f-duration').value = level.duration; $('f-population').value = routePopulation(level.routes);
    $('f-bus-line-limit').value = level.busLineLimit ?? 1;
    $('f-map-width').value = mapWidth();$('f-map-height').value = mapHeight();
    document.querySelector('.coord-legend').textContent=`坐标系：地图中心为原点 (0,0)，向右为 +x，向上为 +y；x 范围 ${-Math.floor(mapWidth()/2)}～${mapWidth()-Math.floor(mapWidth()/2)-1}，y 范围 ${Math.floor((mapHeight()-1)/2)-mapHeight()+1}～${Math.floor((mapHeight()-1)/2)}。`;
    const sizeSignature=`${mapWidth()}x${mapHeight()}`;if(canvas.dataset.mapSize!==sizeSignature){canvas.dataset.mapSize=sizeSignature;resetView();}
    for (const name of ['grade', 'load', 'cut', 'inspect', 'signals', 'bus']) $('f-' + name).checked = Boolean(level.features[name]);
    renderCampaign();
    renderRoutes();
    draw();
  }
  function renderCampaign() {
    const level=current(),enabled=Boolean(level?.campaign);
    $('f-campaign').checked=enabled;$('campaign-editor').hidden=!enabled;
    $('f-duration').disabled=enabled;
    if(!enabled)return;
    if(!Array.isArray(level.campaign.days)||level.campaign.days.length!==5)return;
    activeCampaignDay=Math.min(activeCampaignDay,4);
    level.routes=level.campaign.days[0].routes;
    level.duration=level.campaign.days[0].duration;
    const tabs=$('campaign-days');tabs.replaceChildren();
    level.campaign.days.forEach((day,index)=>{const button=document.createElement('button');button.type='button';button.className='tool'+(index===activeCampaignDay?' active':'');button.textContent=`第 ${index+1} 天`;button.setAttribute('role','tab');button.setAttribute('aria-selected',String(index===activeCampaignDay));button.onclick=()=>{activeCampaignDay=index;activeRoute=0;activeHome=0;activeGoal=0;renderCampaign();renderRoutes();draw();};tabs.append(button);});
    const day=level.campaign.days[activeCampaignDay];$('f-day-duration').value=day.duration;$('f-day-population').value=routePopulation(day.routes);$('f-day-income').value=day.maxIncome;
    $('copy-prev-day').disabled=activeCampaignDay===0;$('copy-next-day').disabled=activeCampaignDay===4;
  }
  function renderRoutes() {
    const list = $('route-list'); list.replaceChildren();
    const level = current(),routes=activeRoutes(),population=routePopulation(routes);
    $('f-population').value=level?.campaign?routePopulation(level.campaign.days[0].routes):population;
    if(level?.campaign)$('f-day-population').value=population;
    routes.forEach((route, ri) => {
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

      const mkXY = (labelText, cell, onchange) => {
        const l = document.createElement('label');
        const span = document.createElement('span'); span.textContent = labelText;
        const box = document.createElement('span'); box.className = 'coord-box';
        const { x, y } = cellToXY(cell);
        const xi = document.createElement('input'); xi.type = 'number'; xi.value = x; xi.title = 'x 轴（右为正）';
        const yi = document.createElement('input'); yi.type = 'number'; yi.value = y; yi.title = 'y 轴（上为正）';
        const apply = () => { const next = xyToCell(Number(xi.value), Number(yi.value)); if (next === null) { toast('坐标超出当前地图范围'); const cur = cellToXY(cell); xi.value = cur.x; yi.value = cur.y; return; } onchange(next); markDirty(); renderRoutes(); draw(); };
        xi.onchange = apply; yi.onchange = apply;
        box.append(xi, yi); l.append(span, box); return l;
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
          mkXY(`住宅${hi + 1} 坐标 (x, y)`, h.cell, v => { removeInitialEdgesAt(level,[h.cell]);h.cell = v; }),
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
          mkXY(`目的地${gi + 1} 坐标 (x, y)`, g.cell, v => { removeInitialEdgesAt(level,[g.cell]);g.cell = v; }),
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
      addGoal.onclick = () => { route.goals.push({ cell: keyCoord(Math.max(0,mapWidth()-3),Math.max(0,mapHeight()-3)), label: '目的地' }); activeRoute = ri; activeGoal = route.goals.length - 1; markDirty(); renderRoutes(); draw(); };
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
      remove.onclick = () => { if(routes.length===1){toast('每个关卡每天至少保留一条路线');return;}removeInitialEdgesAt(level,[...route.homes,...route.goals].map(building=>building.cell));routes.splice(ri, 1); if (activeRoute >= routes.length) activeRoute = Math.max(0, routes.length - 1); markDirty(); renderRoutes(); draw(); };
      colorRow.append(remove);
      card.append(colorRow);
      list.append(card);
    });
    updateToolHint();
  }
  function renderAll() { renderLevelNav(); renderEditor(); }

  // ── Selection & CRUD ─────────────────────────────────────────────────
  function selectChapter(ci) { currentChapterIndex=ci;currentLevelIndex=chapters()[ci].levels.length?0:null;activeCampaignDay=0;activeRoute=0;activeHome=0;activeGoal=0;renderAll(); }
  function selectLevel(ci,li) { currentChapterIndex=ci;currentLevelIndex=li;activeCampaignDay=0;activeRoute=0;activeHome=0;activeGoal=0;renderAll(); }
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
      id, name: '新关卡', english: 'NEW LEVEL', difficulty: '自定义', title: '未命名关卡', width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT,
      description: '请在此填写关卡任务说明。', tip: '请在此填写给玩家的规划提示。', lesson: '自定义', features: { grade: true, load: true, cut: true, inspect: true, signals: true, bus: true },
      busLineLimit: 3, budget: 100, duration: 90, water: [], bridges: [], trees: [], routes: [{
        name: '路线一 → 目的地', color: COLORS[0].color, light: COLORS[0].light,
        homes: [{ cell: 2 * DEFAULT_WIDTH + 2, generationRate: 1, passengers: 60 }],
        goals: [{ cell: 8 * DEFAULT_WIDTH + 12, label: '目的地' }]
      }], initialEdges: []
    });
    currentLevelIndex=chapter.levels.length-1;activeCampaignDay=0;activeRoute=0;activeHome=0;activeGoal=0;markDirty();renderAll();
  }
  function duplicateLevel() {
    const src=current(),chapter=currentChapter();if(!src)return;
    const copy=JSON.parse(JSON.stringify(src)),base=copy.id+'-copy';let id=base,n=2;while(allLevels().some(level=>level.id===id))id=`${base}-${n++}`;copy.id=id;copy.name=copy.name+'（副本）';
    chapter.levels.splice(currentLevelIndex+1,0,copy);currentLevelIndex++;activeCampaignDay=0;activeRoute=0;activeHome=0;activeGoal=0;markDirty();renderAll();
  }
  function deleteLevel() {
    const level=current(),chapter=currentChapter();if(!level)return;
    if(!confirm(`确定删除关卡「${level.name}」？此操作不可撤销。`))return;
    chapter.levels.splice(currentLevelIndex,1);currentLevelIndex=chapter.levels.length?Math.min(currentLevelIndex,chapter.levels.length-1):null;
    activeRoute=0;activeHome=0;activeGoal=0;markDirty();renderAll();
  }

  // ── Map editing ──────────────────────────────────────────────────────
  function applyMapSize() {
    const level=current(),oldWidth=mapWidth(),oldHeight=mapHeight(),width=Number($('f-map-width').value),height=Number($('f-map-height').value);
    if(!level)return;
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<MIN_MAP_SIZE||width>MAX_MAP_SIZE||height<MIN_MAP_SIZE||height>MAX_MAP_SIZE){toast(`地图宽高必须是 ${MIN_MAP_SIZE} 至 ${MAX_MAP_SIZE} 的整数`);renderEditor();return;}
    if(width===oldWidth&&height===oldHeight)return;
    const dx=Math.floor(width/2)-Math.floor(oldWidth/2),dy=Math.floor((height-1)/2)-Math.floor((oldHeight-1)/2);
    const translate=cell=>{const x=cell%oldWidth+dx,y=Math.floor(cell/oldWidth)+dy;return x>=0&&x<width&&y>=0&&y<height?y*width+x:null;};
    const buildings=allRoutes(level).flatMap(route=>[...(route.homes||[]),...(route.goals||[])]);
    if(buildings.some(building=>translate(building.cell)===null)){toast('缩小后的边界会裁掉建筑，请先移动建筑或增大尺寸');renderEditor();return;}
    if(!confirm(`将地图从 ${oldWidth} × ${oldHeight} 改为 ${width} × ${height}？内容会保持相对地图中心，边界外的地形和道路将被裁掉。`)){renderEditor();return;}
    const mapCells=values=>values.map(translate).filter(cell=>cell!==null);
    level.water=mapCells(level.water);level.bridges=mapCells(level.bridges);level.trees=mapCells(level.trees);
    level.initialEdges=(level.initialEdges||[]).map(([a,b,grade])=>[translate(a),translate(b),grade]).filter(([a,b])=>a!==null&&b!==null);
    for(const building of buildings)building.cell=translate(building.cell);
    level.width=width;level.height=height;hover=null;dragging=false;lastCell=null;markDirty();renderEditor();toast(`地图已调整为 ${width} × ${height}`);
  }
  function shiftMap() {
    const level=current(),dx=Number($('shift-x').value),dy=Number($('shift-y').value);if(!level)return;
    if(!Number.isInteger(dx)||!Number.isInteger(dy)){toast('整体挪动量必须是整数');return;}if(dx===0&&dy===0){toast('请输入非零挪动量');return;}
    const translate=cell=>{const x=cell%mapWidth()+dx,y=Math.floor(cell/mapWidth())-dy;return x>=0&&x<mapWidth()&&y>=0&&y<mapHeight()?keyCoord(x,y):null;};
    const routeGroups=[level.routes,...(level.campaign?.days||[]).map(day=>day.routes)].filter(Boolean),buildings=[...new Set(routeGroups.flatMap(routes=>routes.flatMap(route=>[...(route.homes||[]),...(route.goals||[])])))];
    const cells=[...level.water,...level.bridges,...level.trees,...(level.initialEdges||[]).flatMap(edge=>edge.slice(0,2)),...buildings.map(building=>building.cell)];
    if(cells.some(cell=>translate(cell)===null)){toast('移动后会有内容超出地图边界，操作已取消');return;}
    level.water=level.water.map(translate);level.bridges=level.bridges.map(translate);level.trees=level.trees.map(translate);level.initialEdges=(level.initialEdges||[]).map(([a,b,grade])=>[translate(a),translate(b),grade]);
    for(const building of buildings)building.cell=translate(building.cell);
    $('shift-x').value=0;$('shift-y').value=0;hover=null;markDirty();renderRoutes();draw();toast(`已整体移动：x ${dx>=0?'+':''}${dx}，y ${dy>=0?'+':''}${dy}`);
  }
  function eventPoint(evt){const rect=canvas.getBoundingClientRect();return{x:evt.clientX-rect.left,y:evt.clientY-rect.top};}
  function cellFromEvent(evt) {
    const p=eventPoint(evt),x=Math.floor((p.x-viewX)/cellSize),y=Math.floor((p.y-viewY)/cellSize);
    return (x>=0&&x<mapWidth()&&y>=0&&y<mapHeight())?keyCoord(x,y):null;
  }
  function applyTool(cell) {
    const level = current(); if (cell === null || !level) return;
    const remove = arr => { const i = arr.indexOf(cell); if (i >= 0) arr.splice(i, 1); };
    const occupied = allRoutes(level).some(route=>[...(route.homes||[]),...(route.goals||[])].some(building=>building.cell===cell));
    if (['water','bridge','tree'].includes(tool) && occupied) { toast('建筑所在格不能改为水面、桥梁或树木'); return; }
    if (tool === 'home' || tool === 'goal') {
      const route=currentRoute();if(!route){toast('请先添加一条路线');return;}
      const building=tool==='home'?route.homes[activeHome]:route.goals[activeGoal];
      const conflict=activeRoutes().some(item=>[...item.homes,...item.goals].some(other=>other!==building&&other.cell===cell));
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
    const buildings=new Set(activeRoutes().flatMap(route=>[...route.homes,...route.goals].map(building=>building.cell)));
    const futureBuildings=new Set(allRoutes(level).flatMap(route=>[...route.homes,...route.goals].map(building=>building.cell)).filter(cell=>!buildings.has(cell)));
    if([a,b].some(cell=>futureBuildings.has(cell))){toast('初始道路不能占用未来建筑工地');return;}
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
  function viewBounds(){const ww=mapWidth()*cellSize,wh=mapHeight()*cellSize;return{minX:ww<=viewportWidth?(viewportWidth-ww)/2:viewportWidth-ww,maxX:ww<=viewportWidth?(viewportWidth-ww)/2:0,minY:wh<=viewportHeight?(viewportHeight-wh)/2:viewportHeight-wh,maxY:wh<=viewportHeight?(viewportHeight-wh)/2:0};}
  function snapView(){const b=viewBounds(),target={x:Math.max(b.minX,Math.min(b.maxX,viewX)),y:Math.max(b.minY,Math.min(b.maxY,viewY))};viewTarget=target;const tick=()=>{if(viewTarget!==target)return;viewX+=(target.x-viewX)*.22;viewY+=(target.y-viewY)*.22;if(Math.hypot(target.x-viewX,target.y-viewY)<.25){viewX=target.x;viewY=target.y;viewTarget=null;draw();return;}draw();requestAnimationFrame(tick);};requestAnimationFrame(tick);}
  function resetView(){if(!current()||!viewportWidth)return;viewZoom=1;cellSize=Math.min(viewportWidth/mapWidth(),viewportHeight/mapHeight());viewX=(viewportWidth-mapWidth()*cellSize)/2;viewY=(viewportHeight-mapHeight()*cellSize)/2;viewTarget=null;}
  function moveView(dx,dy){const b=viewBounds(),rubber=(v,min,max)=>v<min?min+(v-min)*.32:v>max?max+(v-max)*.32:v;viewTarget=null;viewX=rubber(viewX+dx,b.minX,b.maxX);viewY=rubber(viewY+dy,b.minY,b.maxY);}
  function setZoom(next,x=viewportWidth/2,y=viewportHeight/2){const wx=(x-viewX)/cellSize,wy=(y-viewY)/cellSize;viewZoom=Math.max(1,Math.min(5,next));cellSize=Math.min(viewportWidth/mapWidth(),viewportHeight/mapHeight())*viewZoom;viewX=x-wx*cellSize;viewY=y-wy*cellSize;snapView();}
  function resize() {
    const rect=canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2),first=!viewportWidth;viewportWidth=rect.width;viewportHeight=rect.height;
    canvas.width=Math.round(viewportWidth*dpr);canvas.height=Math.round(viewportHeight*dpr);
    if(first)resetView();else{cellSize=Math.min(viewportWidth/mapWidth(),viewportHeight/mapHeight())*viewZoom;snapView();}draw();
  }
  function line(x1,y1,x2,y2,color,width){ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
  function circle(x,y,r,color){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();}
  function rounded(x,y,w,h,r,fill,stroke=null){ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=Math.max(1,cellSize*.025);ctx.stroke();}}
  function label(text,x,y,size,color,weight='500'){ctx.font=`${weight} ${size}px system-ui, sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=color;ctx.fillText(text,x,y);}
  function draw() {
    const level=current();if(!level)return;
    const dpr=Math.min(window.devicePixelRatio||1,2),s=cellSize,w=mapWidth()*s,h=mapHeight()*s,water=new Set(level.water),bridges=new Set(level.bridges);
    const buildings=new Set(activeRoutes().flatMap(route=>[...route.homes,...route.goals].map(building=>building.cell))),roads=new Map(),links=new Map();
    for(const [a,b,grade] of level.initialEdges||[]){if(!buildings.has(a))roads.set(a,grade);if(!buildings.has(b))roads.set(b,grade);if(!links.has(a))links.set(a,[]);if(!links.has(b))links.set(b,[]);links.get(a).push(b);links.get(b).push(a);}
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,viewportWidth,viewportHeight);ctx.save();ctx.translate(viewX,viewY);ctx.fillStyle='#eaf0df';ctx.fillRect(0,0,w,h);
    for(let y=0;y<mapHeight();y++)for(let x=0;x<mapWidth();x++){
      const n=keyCoord(x,y);if((x*7+y*11)%13===0){ctx.fillStyle='#e3ebd7';ctx.fillRect(x*s,y*s,s,s);}ctx.strokeStyle='#dce5d04d';ctx.lineWidth=.65;ctx.strokeRect(x*s,y*s,s,s);
      if((x*3+y*7)%9===0&&!water.has(n)&&!roads.has(n)&&!buildings.has(n)){line((x+.2)*s,(y+.72)*s,(x+.23)*s,(y+.64)*s,'#cedcbd',1);line((x+.27)*s,(y+.74)*s,(x+.3)*s,(y+.67)*s,'#cedcbd',1);}
    }
    for(const n of water){const{x,y}=point(n);ctx.fillStyle='#bbd9d8';ctx.fillRect(x*s,y*s,s,s);line((x+.2)*s,(y+.28)*s,(x+.55)*s,(y+.28)*s,'#d5e9e4',1.5);line((x+.55)*s,(y+.68)*s,(x+.85)*s,(y+.68)*s,'#a9cece',1.5);if(x===0||!water.has(n-1))line(x*s,y*s,x*s,(y+1)*s,'#d1e3cf',s*.08);if(x===mapWidth()-1||!water.has(n+1))line((x+1)*s,y*s,(x+1)*s,(y+1)*s,'#d1e3cf',s*.08);}
    for(const n of bridges){const{x,y}=point(n),horizontal=(x>0&&bridges.has(n-1))||(x<mapWidth()-1&&bridges.has(n+1));rounded(x*s+(horizontal?0:s*.15),y*s+(horizontal?s*.15:0),horizontal?s:s*.7,horizontal?s*.7:s,s*.06,'#d7d8cb');}
    ctx.lineCap='butt';
    for(const [n,grade] of roads){const{x,y}=point(n),cx=(x+.5)*s,cy=(y+.5)*s,type=[{color:'#b3bfa7',width:.3},{color:'#8da79c',width:.54},{color:'#708b9b',width:.78}][grade]||{color:'#b3bfa7',width:.3};rounded(cx-s*type.width/2,cy-s*type.width/2,s*type.width,s*type.width,s*.12,type.color);for(const v of links.get(n)||[]){const p=point(v);line(cx,cy,cx+(p.x-x)*s*.51,cy+(p.y-y)*s*.51,type.color,s*type.width);}ctx.setLineDash([s*.09,s*.08]);for(const v of links.get(n)||[]){const p=point(v);line(cx,cy,cx+(p.x-x)*s*.5,cy+(p.y-y)*s*.5,'#eaf0dfb0',s*.025);}ctx.setLineDash([]);if(grade)label(grade===1?'Ⅱ':'Ⅲ',(x+.2)*s,(y+.22)*s,s*.18,'#f8fbef','700');}
    for(const n of bridges){const{x,y}=point(n),horizontal=(x>0&&bridges.has(n-1))||(x<mapWidth()-1&&bridges.has(n+1)),cx=(x+.5)*s,cy=(y+.5)*s;if(horizontal){line(x*s,cy-s*.38,(x+1)*s,cy-s*.38,'#8d9b89',s*.04);line(x*s,cy+s*.38,(x+1)*s,cy+s*.38,'#8d9b89',s*.04);}else{line(cx-s*.38,y*s,cx-s*.38,(y+1)*s,'#8d9b89',s*.04);line(cx+s*.38,y*s,cx+s*.38,(y+1)*s,'#8d9b89',s*.04);}}
    for(const n of level.trees){const{x,y}=point(n),cx=(x+.5)*s,cy=(y+.48)*s;circle(cx+s*.04,cy+s*.16,s*.25,'#cddcbc');line(cx,cy,cx,cy+s*.31,'#a5b18d',s*.055);circle(cx-s*.1,cy,s*.19,'#a9c398');circle(cx+s*.1,cy+s*.015,s*.19,'#9ab88a');circle(cx,cy-s*.13,s*.19,'#b3cba1');}
    activeRoutes().forEach(route=>{(route.homes||[]).forEach(home=>drawBuilding(home,route,true));(route.goals||[]).forEach(goal=>drawBuilding(goal,route,false));});
    if(level.campaign){const active=new Set(activeRoutes().flatMap(route=>[...route.homes,...route.goals].map(building=>building.cell))),sites=new Map();for(let day=activeCampaignDay+1;day<level.campaign.days.length;day++)for(const route of level.campaign.days[day].routes)for(const building of [...route.homes,...route.goals])if(!active.has(building.cell)&&!sites.has(building.cell))sites.set(building.cell,day-activeCampaignDay);for(const [cell,days] of sites)drawSite(cell,days);}
    const route=currentRoute();if(route){const home=route.homes?.[activeHome],goal=route.goals?.[activeGoal];if(home)markActive(home.cell,route.color);if(goal)markActive(goal.cell,route.color);}
    if(simulationCity)drawSimulationVehicles();
    if(hover!==null){const{x,y}=point(hover);ctx.strokeStyle=tool==='erase'?'#c68b56':'#6d936b';ctx.lineWidth=2;ctx.strokeRect(x*s+1,y*s+1,s-2,s-2);}ctx.restore();
  }
  function drawSite(n,days) {
    const s=cellSize,{x,y}=point(n),cx=(x+.5)*s,cy=(y+.5)*s;ctx.save();ctx.fillStyle='#a6aaa4';ctx.strokeStyle='#777d78';ctx.lineWidth=1.5;ctx.setLineDash([3,2]);ctx.fillRect(cx-s*.24,cy-s*.2,s*.48,s*.4);ctx.strokeRect(cx-s*.28,cy-s*.24,s*.56,s*.48);ctx.setLineDash([]);ctx.fillStyle='#fff';ctx.font=`700 ${s*.24}px system-ui, sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(days),cx,cy);ctx.restore();
  }
  function drawBuilding(building,route,isHome){
    const s=cellSize,{x,y}=point(building.cell),cx=(x+.5)*s,cy=(y+.5)*s;rounded(x*s+s*.1,y*s+s*.15,s*.8,s*.8,s*.16,'#8d9a7d22');rounded(x*s+s*.08,y*s+s*.07,s*.84,s*.84,s*.17,route.light);
    if(isHome){const rate=building.generationRate??building.rate??1;if(rate===6){rounded(cx-s*.22,cy-s*.36,s*.44,s*.64,s*.025,route.color);for(let floor=0;floor<4;floor++)for(let col=0;col<2;col++)rounded(cx-s*.14+col*s*.17,cy-s*.28+floor*s*.13,s*.09,s*.07,0,route.light);}else{const width=rate===4?.32:.23;ctx.beginPath();ctx.moveTo(cx-s*width,cy-s*.03);ctx.lineTo(cx,cy-s*.29);ctx.lineTo(cx+s*width,cy-s*.03);ctx.closePath();ctx.fillStyle=route.color;ctx.fill();rounded(cx-s*width*.8,cy-s*.05,s*width*1.6,s*.31,s*.025,route.color);rounded(cx-s*.055,cy+s*.08,s*.11,s*.18,s*.01,route.light);}rounded((x+.53)*s,(y+.025)*s,s*.43,s*.27,s*.135,route.color);label(String(building.passengers),(x+.745)*s,(y+.16)*s,s*.14,'#fffef9','700');rounded((x+.055)*s,(y+.7)*s,s*.43,s*.235,s*.09,route.light,route.color);label(`+${rate}/s`,(x+.27)*s,(y+.815)*s,s*.125,route.color,'700');}
    else{rounded(cx-s*.26,cy-s*.25,s*.52,s*.49,s*.055,route.color);rounded(cx-s*.19,cy-s*.19,s*.38,s*.12,s*.025,route.light);for(let j=0;j<3;j++)rounded(cx-s*.18+j*s*.13,cy-s*.005,s*.075,s*.11,s*.01,route.light);rounded(cx-s*.045,cy+s*.12,s*.09,s*.12,s*.01,route.light);rounded((x+.53)*s,(y+.025)*s,s*.43,s*.27,s*.135,'#fffef9ee',route.color);label(building.input==null?'∞':String(building.input),(x+.745)*s,(y+.16)*s,s*.14,route.color,'700');}
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
  function drawSimulationVehicles(){
    const s=cellSize;for(const car of simulationCity.cars){const pose=simulationCity.pose(car),length=TrafficCore.VEHICLE_LENGTH*s,width=TrafficCore.VEHICLE_WIDTH*s;ctx.save();ctx.translate(pose.x*s,pose.y*s);ctx.rotate(pose.angle);rounded(-length/2,-width/2+s*.015,length,width,s*.025,'#344c3333');rounded(-length/2,-width/2,length,width,s*.025,simulationCity.routes[car.route].color);rounded(length*.1,-width*.36,length*.2,width*.72,s*.01,'#f5f6e9bb');ctx.restore();}
    for(const bus of simulationCity.buses){const pose=simulationCity.pose(bus),length=TrafficCore.BUS_LENGTH*s,width=TrafficCore.BUS_WIDTH*s;ctx.save();ctx.translate(pose.x*s,pose.y*s);ctx.rotate(pose.angle);rounded(-length/2,-width/2+s*.025,length,width,s*.03,'#1f353244');rounded(-length/2,-width/2,length,width,s*.035,simulationCity.busLine(bus.lineId)?.color||'#126f89','#fffef9');rounded(-length*.31,-width*.34,length*.45,width*.68,s*.012,'#d9eef0');rounded(length*.18,-width*.34,length*.19,width*.68,s*.012,'#f2bd4f');label('BUS',0,0,s*.07,'#fffef9','800');ctx.restore();}
  }
  function updateSimulationUI() {
    const city=simulationCity,stateNames={planning:'未开始',running:'运行中',paused:'已暂停',won:'已达标',lost:'未达标'};
    $('sim-state').textContent=city?stateNames[city.state]||city.state:'未开始';$('sim-delivered').textContent=city?`${city.delivered} / ${city.target}`:'0 / 0';$('sim-time').textContent=city?`${city.elapsed.toFixed(1)} / ${city.duration} 秒`:'0.0 / 0 秒';$('sim-cars').textContent=city?String(city.cars.length+city.buses.length):'0';$('sim-waiting').textContent=city?String(city.queues.reduce((sum,n)=>sum+n,0)):'0';
    $('sim-reset').disabled=!city;$('sim-start').textContent=!city||['won','lost'].includes(city.state)?'▶ 开始仿真':city.state==='running'?'Ⅱ 暂停':'▶ 继续';
  }
  function stopSimulation(redraw = true) {
    if(simulationFrame)cancelAnimationFrame(simulationFrame);simulationFrame=0;simulationCity=null;simulationLevelId=null;simulationAccumulator=0;simulationLast=0;updateSimulationUI();if(redraw)draw();
  }
  function simulationTick(now) {
    if(!simulationCity||simulationCity.state!=='running'){simulationFrame=0;updateSimulationUI();draw();return;}
    const delta=simulationLast?Math.min(.25,(now-simulationLast)/1000):0;simulationLast=now;simulationAccumulator+=delta*simulationSpeed;
    while(simulationAccumulator>=.05&&simulationCity.state==='running'){simulationCity.step(.05);simulationAccumulator-=.05;}
    updateSimulationUI();draw();simulationFrame=requestAnimationFrame(simulationTick);
  }
  function createSimulation() {
    const level=current();if(!level)return false;
    try {
      const copy=JSON.parse(JSON.stringify(catalog)),problem=TrafficCore.setLevels(copy);if(problem)throw new Error(problem);
      const day=level.campaign?.days?.[activeCampaignDay];simulationCity=new TrafficCore.City(level.id,day?{routes:day.routes,duration:day.duration}:{});simulationLevelId=level.id;simulationDay=activeCampaignDay;simulationCity.toggle();simulationAccumulator=0;simulationLast=0;updateSimulationUI();return true;
    } catch(error){stopSimulation(false);toast('无法开始仿真：'+error.message);return false;}
  }
  function toggleSimulation() {
    if(!simulationCity||['won','lost'].includes(simulationCity.state)){if(!createSimulation())return;}else simulationCity.toggle();
    if(simulationCity.state==='running'&&!simulationFrame){simulationLast=0;simulationFrame=requestAnimationFrame(simulationTick);}else{if(simulationFrame)cancelAnimationFrame(simulationFrame);simulationFrame=0;updateSimulationUI();draw();}
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
  $('undo').onclick=()=>restoreHistory(historyIndex-1);$('redo').onclick=()=>restoreHistory(historyIndex+1);
  $('apply-shift').onclick=shiftMap;$('validate').onclick=()=>validateCatalog(true);
  $('sim-start').onclick=toggleSimulation;$('sim-reset').onclick=()=>stopSimulation();
  $('sim-speed').onclick=()=>{const speeds=[1,2,4,.5],index=speeds.indexOf(simulationSpeed);simulationSpeed=speeds[(index+1)%speeds.length];$('sim-speed').textContent=simulationSpeed+'×';};
  $('save-preset').onclick = async () => {
    const name = prompt('请输入配置文件名（不能重复）：');
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) { toast('配置文件名不能为空'); return; }
    try { await api('/api/presets/' + encodeURIComponent(trimmed), { method: 'PUT', body: JSON.stringify(catalog) }); await loadPresets(); toast(`已另存为配置「${trimmed}」`); }
    catch (err) { toast('另存为失败：' + err.message); }
  };
  $('load-preset').onclick = async () => {
    const name = $('preset-select').value;
    if (!name) { toast('请先选择一个配置'); return; }
    if (dirty && !confirm('有未保存更改，确定载入所选配置并放弃这些更改吗？')) return;
    try { const data = await api('/api/presets/' + encodeURIComponent(name)); catalog = removeLegacyTargets(data.catalog); currentChapterIndex = 0; currentLevelIndex = chapters()[0]?.levels.length ? 0 : null; activeCampaignDay = 0; activeRoute = 0; activeHome = 0; activeGoal = 0; stopSimulation(false);resetHistory(`已载入配置「${name}」`);renderAll();toast(`已载入配置「${name}」`); }
    catch (err) { toast('载入失败：' + err.message); }
  };
  $('overwrite-default').onclick = async () => {
    if (!confirm('确定用当前配置覆盖默认关卡？此操作会重建 levels/ 分关数据和 built-in-levels.json 清单。')) return;
    try { await api('/api/default', { method: 'PUT', body: JSON.stringify(catalog) }); toast('已覆盖默认配置，重启游戏服务后生效'); }
    catch (err) { toast('覆盖失败：' + err.message); }
  };
  $('reload').onclick = async () => { if(dirty&&!confirm('有未保存更改，确定从磁盘重新载入并放弃这些更改吗？'))return;try { await loadLevels(); toast('已从磁盘重新载入'); } catch (err) { toast(err.message); } };
  $('new-chapter').onclick = newChapter;
  $('new-level').onclick = newLevel;
  $('duplicate').onclick = duplicateLevel;
  $('delete-level').onclick = deleteLevel;
  $('add-route').onclick = () => {
    const level = current(),routes=activeRoutes(); if (!level) return;
    const c = COLORS[routes.length % COLORS.length];
    routes.push({ name: '新路线 → 目的地', color: c.color, light: c.light, homes: [{ cell: keyCoord(3, 3), generationRate: 1, passengers: 60 }], goals: [{ cell: keyCoord(Math.max(0,mapWidth()-3),Math.max(0,mapHeight()-3)), label: '目的地' }] });
    activeRoute = routes.length - 1; activeHome = 0; activeGoal = 0; markDirty(); renderRoutes(); draw();
  };

  // Bind field inputs to current level
  $('f-campaign').onchange=()=>{
    const level=current();if(!level)return;
    if($('f-campaign').checked){
      const routes=JSON.parse(JSON.stringify(level.routes));
      level.campaign={days:Array.from({length:5},(_,index)=>({duration:level.duration,maxIncome:18+index*2,routes:JSON.parse(JSON.stringify(routes))}))};
      activeCampaignDay=0;level.routes=level.campaign.days[0].routes;
    }else{
      level.routes=JSON.parse(JSON.stringify(level.campaign.days[0].routes));level.duration=level.campaign.days[0].duration;delete level.campaign;activeCampaignDay=0;
    }
    activeRoute=0;activeHome=0;activeGoal=0;markDirty();renderEditor();
  };
  for(const id of ['f-day-duration','f-day-income'])$(id).onchange=()=>{
    const level=current(),day=level?.campaign?.days?.[activeCampaignDay];if(!day)return;
    const prop=id==='f-day-duration'?'duration':'maxIncome';day[prop]=Number($(id).value);
    if(activeCampaignDay===0)level.duration=day.duration;markDirty();
  };
  $('copy-prev-day').onclick=()=>{const level=current();if(!level?.campaign||activeCampaignDay===0)return;level.campaign.days[activeCampaignDay]=JSON.parse(JSON.stringify(level.campaign.days[activeCampaignDay-1]));activeRoute=0;activeHome=0;activeGoal=0;markDirty();renderCampaign();renderRoutes();draw();};
  $('copy-next-day').onclick=()=>{const level=current();if(!level?.campaign||activeCampaignDay===4)return;level.campaign.days[activeCampaignDay+1]=JSON.parse(JSON.stringify(level.campaign.days[activeCampaignDay]));activeCampaignDay++;activeRoute=0;activeHome=0;activeGoal=0;markDirty();renderCampaign();renderRoutes();draw();};
  $('f-chapter').onchange=()=>{
    const level=current(),targetIndex=chapters().findIndex(chapter=>chapter.id===$('f-chapter').value);if(!level||targetIndex<0||targetIndex===currentChapterIndex)return;
    currentChapter().levels.splice(currentLevelIndex,1);chapters()[targetIndex].levels.push(level);currentChapterIndex=targetIndex;currentLevelIndex=chapters()[targetIndex].levels.length-1;markDirty();renderAll();toast('关卡已移动到所选章节');
  };
  const textFields = { 'f-id': 'id', 'f-name': 'name', 'f-english': 'english', 'f-difficulty': 'difficulty', 'f-lesson': 'lesson', 'f-title': 'title', 'f-description': 'description', 'f-tip': 'tip' };
  for (const [elId, prop] of Object.entries(textFields)) {
    $(elId).onchange = () => { const l = current(); if (l) { l[prop] = $(elId).value; markDirty(); renderLevelNav(); $('editor-title').textContent = l.name; } };
  }
  for (const elId of ['f-budget', 'f-duration']) {
    $(elId).onchange = () => { const l = current(); const prop = elId.replace('f-', ''); if (l) { l[prop] = Number($(elId).value); markDirty(); } };
  }
  $('f-bus-line-limit').onchange = () => { const l = current(); if (l) { l.busLineLimit = Number($('f-bus-line-limit').value); markDirty(); } };
  $('apply-map-size').onclick=applyMapSize;
  for (const name of ['grade', 'load', 'cut', 'inspect', 'signals', 'bus']) {
    $('f-' + name).onchange = () => { const l = current(); if (l) { l.features[name] = $('f-' + name).checked; markDirty(); } };
  }

  // Tool buttons
  document.querySelectorAll('.toolbar [data-tool]').forEach(btn => {
    btn.onclick = () => {
      tool = btn.dataset.tool;
      document.querySelectorAll('.toolbar [data-tool]').forEach(b => b.classList.toggle('active', b === btn));
      $('grade-control').style.visibility = tool === 'road' ? 'visible' : 'hidden';
      canvas.classList.toggle('view-mode',tool==='view');updateToolHint();
    };
  });
  $('road-grade').onchange = () => { roadGrade = Number($('road-grade').value); };

  // Canvas interaction
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('wheel',e=>{if(!e.ctrlKey)return;e.preventDefault();const p=eventPoint(e);setZoom(viewZoom*Math.exp(-e.deltaY*.004),p.x,p.y);draw();},{passive:false});
  canvas.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;e.preventDefault();canvas.setPointerCapture(e.pointerId);
    const p=eventPoint(e);pointers.set(e.pointerId,p);
    if(pointers.size===2){dragging=false;lastCell=null;panLast=null;const[a,b]=[...pointers.values()],center={x:(a.x+b.x)/2,y:(a.y+b.y)/2};pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),zoom:viewZoom,worldX:(center.x-viewX)/cellSize,worldY:(center.y-viewY)/cellSize};return;}
    if(tool==='view'){panLast=p;hover=null;return;}
    dragging=true;historyBatching=true;hover=cellFromEvent(e);lastCell=hover;dragAnchor=hover;
    if(tool!=='road'&&hover!==null)applyTool(hover);
  });
  canvas.addEventListener('pointermove',e=>{
    const previous=pointers.get(e.pointerId),p=eventPoint(e);if(previous)pointers.set(e.pointerId,p);
    if(pinch&&pointers.size>=2){const[a,b]=[...pointers.values()],center={x:(a.x+b.x)/2,y:(a.y+b.y)/2},distance=Math.hypot(a.x-b.x,a.y-b.y);viewZoom=Math.max(1,Math.min(5,pinch.zoom*distance/Math.max(1,pinch.distance)));cellSize=Math.min(viewportWidth/mapWidth(),viewportHeight/mapHeight())*viewZoom;viewX=center.x-pinch.worldX*cellSize;viewY=center.y-pinch.worldY*cellSize;draw();return;}
    if(tool==='view'&&panLast&&previous){moveView(p.x-previous.x,p.y-previous.y);panLast=p;draw();return;}
    hover=cellFromEvent(e);
    if(hover!==null&&!dragging){const{x,y}=cellToXY(hover);$('map-status').textContent=`悬停：(${x}, ${y})`;}
    if(dragging&&tool==='road'&&hover!==null&&lastCell!==null)lastCell=connectPath(lastCell,hover);
    else if(dragging&&tool!=='road'&&hover!==null&&hover!==lastCell){lastCell=hover;applyTool(hover);}
    if(!dragging)draw();
  });
  const endDrag=e=>{pointers.delete(e.pointerId);if(pinch){if(pointers.size<2){pinch=null;panLast=null;if(historyBatching){historyBatching=false;commitHistory();updateDirtyStatus();}snapView();}draw();return;}dragging=false;panLast=null;lastCell=null;dragAnchor=null;if(historyBatching){historyBatching=false;commitHistory();updateDirtyStatus();}snapView();draw();};
  canvas.addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',endDrag);
  canvas.addEventListener('pointerleave',()=>{hover=null;updateToolHint();if(!dragging)draw();});
  // Keyboard: 1-8 tools
  const toolOrder=['view','water','bridge','tree','home','goal','road','erase'];
  document.addEventListener('keydown',e=>{
    const inputFocused=['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName),modifier=e.ctrlKey||e.metaKey;
    if(modifier&&e.key.toLowerCase()==='s'){e.preventDefault();save().catch(err=>toast('保存失败：'+err.message));return;}
    if(!inputFocused&&modifier&&e.key.toLowerCase()==='z'){e.preventDefault();restoreHistory(historyIndex+(e.shiftKey?1:-1));return;}
    if(!inputFocused&&modifier&&e.key.toLowerCase()==='y'){e.preventDefault();restoreHistory(historyIndex+1);return;}
    if(modifier||e.altKey||inputFocused)return;
    const idx=parseInt(e.key,10)-1;if(idx>=0&&idx<toolOrder.length){const btn=document.querySelector(`.toolbar [data-tool="${toolOrder[idx]}"]`);if(btn)btn.click();}
    if(e.key.toLowerCase()==='s')save().catch(err=>toast('保存失败：'+err.message));
  });

  // Detect unsaved changes before leaving
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  $('grade-control').style.visibility = 'hidden';
  new ResizeObserver(resize).observe(canvas);
  resize();
})();
