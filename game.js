(() => {
  'use strict';
  const { City, CampaignSession, ROAD_TYPES, VEHICLE_WIDTH, VEHICLE_LENGTH, BUS_WIDTH, BUS_LENGTH, BUS_CAPACITY, BUS_COST, LANE_WIDTH, SIGNAL_ACTIONS, WIDTH, HEIGHT } = TrafficCore;
  const SIGNAL_ENTRY_NAMES={north:'北侧入口',east:'东侧入口',south:'南侧入口',west:'西侧入口'};
  const SIGNAL_TURN_NAMES={straight:'直行',left:'左转'};
  const SPEED_OPTIONS=[.5,1,2,4];
  const $ = id => document.getElementById(id);
  const canvas = $('map'), ctx = canvas.getContext('2d');
  const levels = () => TrafficCore.LEVELS;
  const chapters = () => TrafficCore.CHAPTERS;
  let city = null, tool = 'view', speed = 1, hover = null, dragging = false;
  let keyboardAnchor = null;
  let lastCell = null, dragGrade = 0, dragDraft = null, selection = null, selectionAnchor = null;
  let cellSize = 40, lastFrame = 0, accumulator = 0, viewportWidth = 0, viewportHeight = 0;
  let viewZoom = 1, viewX = 0, viewY = 0, viewTarget = null, panLast = null, pinch = null, viewReady = false;
  const pointers = new Map();
  const key = (x,y) => TrafficCore.key(x,y,city?.width||WIDTH);
  const point = n => TrafficCore.point(n,city?.width||WIDTH);
  let toastTimer, resultShown = false, keyboardCell = key(1, 2), keyboardMode = false;
  let connectionRows = [], pendingLevel = null, inspectedCell = null;
  let pendingDesign = null, dimmedBusLines = new Set(), busEditMode = 'draw';
  let campaign = null, pendingCampaignScore = null;
  let designHistory = [], designHistoryIndex = -1;
  const arrivalEffects = TrafficEffects.createArrivalEffects();
  const STORAGE_PREFIX = 'traffic-game-design-v1:';
  function storedDesign(levelId = city.level.id) {
    try { return localStorage.getItem(STORAGE_PREFIX + levelId); }
    catch { return null; }
  }
  let designAvailable = false;
  function updateDesignControls() {
    designAvailable=storedDesign()!==null;
    $('load-design').disabled=city.state!=='planning'||!designAvailable;
  }
  function designSnapshot() { return JSON.stringify(city.serializeDesign()); }
  function updateHistoryControls() {
    const planning=city?.state==='planning';
    $('undo-design').disabled=!planning||designHistoryIndex<=0;
    $('redo-design').disabled=!planning||designHistoryIndex>=designHistory.length-1;
  }
  function resetDesignHistory() {
    designHistory=city?[designSnapshot()]:[];designHistoryIndex=designHistory.length-1;updateHistoryControls();
  }
  function recordDesignChange(before) {
    const after=designSnapshot();if(before===after){updateHistoryControls();return false;}
    if(designHistory[designHistoryIndex]!==before)designHistory[designHistoryIndex]=before;
    designHistory=designHistory.slice(0,designHistoryIndex+1);designHistory.push(after);
    if(designHistory.length>61)designHistory.shift();
    designHistoryIndex=designHistory.length-1;updateHistoryControls();return true;
  }
  function mutateDesign(action) { const before=designSnapshot(),message=action();recordDesignChange(before);return message; }
  function restoreDesign(index) {
    if(city.state!=='planning'){toast('运营期间不能撤销规划，请先停止运营');return;}
    if(index<0||index>=designHistory.length)return;
    const previous=designHistoryIndex,message=city.loadDesign(JSON.parse(designHistory[index]));if(message){toast(message);return;}
    designHistoryIndex=index;dragging=false;lastCell=null;dragDraft=null;keyboardAnchor=null;busEditMode='draw';inspectedCell=null;
    updateHistoryControls();updateUI();draw();toast(index<previous?'已撤销上一步规划':'已重做下一步规划');
  }
  let levelButtons = [], chapterButtons = [], visibleChapterIndex = 0;
  function showChapter(chapterIndex) {
    const chapter=chapters()[chapterIndex];if(!chapter)return;
    visibleChapterIndex=chapterIndex;
    chapterButtons.forEach((button,i)=>{button.classList.toggle('selected',i===chapterIndex);button.setAttribute('aria-pressed',String(i===chapterIndex));});
    const list=$('level-list');list.replaceChildren();levelButtons=[];
    for(const level of chapter.levels) {
      const i=levels().indexOf(level),button=document.createElement('button');button.className='level-card';button.dataset.levelId=level.id;
      const number=document.createElement('span');number.className='level-number';number.textContent=String(i+1).padStart(2,'0');
      const name=document.createElement('strong');name.textContent=level.name;
      const detail=document.createElement('small');detail.textContent=`${level.difficulty} · ${level.lesson}`;
      button.append(number,name,detail);button.onclick=()=>requestLevel(level.id);list.append(button);levelButtons.push(button);
    }
    $('level-summary').textContent=`${chapter.name} · ${chapter.levels.length} 座小城 · 切换会重置本局`;
    levelButtons.forEach(button=>{const selected=button.dataset.levelId===city.level.id;button.classList.toggle('selected',selected);button.setAttribute('aria-current',selected?'true':'false');});
  }
  function buildLevelButtons() {
    const list=$('chapter-list');list.replaceChildren();chapterButtons=[];
    for(const [chapterIndex,chapter] of chapters().entries()) {
      const button=document.createElement('button');button.className='chapter-tab';button.setAttribute('aria-pressed','false');
      const number=document.createElement('span');number.textContent=String(chapterIndex+1).padStart(2,'0');
      const name=document.createElement('strong');name.textContent=chapter.name;
      const english=document.createElement('small');english.textContent=chapter.english;
      button.append(number,name,english);button.onclick=()=>showChapter(chapterIndex);list.append(button);chapterButtons.push(button);
    }
    const current=chapters().findIndex(chapter=>chapter.levels.some(level=>level.id===city.level.id));showChapter(Math.max(0,current));
  }
  function renderCampaignProgress() {
    const panel=$('campaign-progress');panel.hidden=!campaign;$('legend-site').hidden=!campaign;
    if(!campaign)return;
    $('campaign-day-title').textContent=`第 ${campaign.dayIndex+1} 天 · ${city.state==='planning'?'改造规划':'通勤运营'}`;
    $('campaign-income').textContent=`累计收入 ${campaign.results.reduce((sum,result)=>sum+result.income,0)} 点 · 可用 ${city.remaining} 点`;
    const list=$('campaign-days'),signature=JSON.stringify([campaign.dayIndex,city.state,city.remaining,campaign.results,campaign.checkpoints.map(Boolean)]);
    if(list.dataset.signature===signature)return;
    list.dataset.signature=signature;list.replaceChildren();
    campaign.days.forEach((day,index)=>{
      const button=document.createElement('button');button.className='campaign-day';
      const title=document.createElement('strong');title.textContent=`第 ${index+1} 天`;
      const result=campaign.results[index],detail=document.createElement('span');detail.textContent=result?`+${result.income} 点`:index===campaign.dayIndex?'当前':'未到达';
      const reached=Boolean(campaign.checkpoints[index])||index===campaign.dayIndex;button.classList.toggle('reached',reached);button.classList.toggle('current',index===campaign.dayIndex);
      button.disabled=!campaign.checkpoints[index]||index===campaign.dayIndex;button.title=button.disabled?'':`回到第 ${index+1} 天运营前，并覆盖之后的记录`;
      button.onclick=()=>{
        if(!confirm(`回到第 ${index+1} 天运营前？第 ${index+1} 天及之后的运营记录会被覆盖。`))return;
        const message=campaign.replay(index);if(message){toast(message);return;}
        city=campaign.city;speed=1;accumulator=0;resultShown=false;pendingCampaignScore=null;arrivalEffects.reset();resetDesignHistory();configureLevel();setTool('view');updateUI();draw();toast(`已回到第 ${index+1} 天运营前`);
      };
      button.append(title,detail);list.append(button);
    });
  }
  function configureLevel() {
    const level = city.level, index = levels().indexOf(level);
    const chapterIndex=chapters().findIndex(chapter=>chapter.levels.some(item=>item.id===level.id)),chapter=chapters()[chapterIndex];
    const number = String(index + 1).padStart(2, '0');
    $('level-eyebrow').textContent = `城市实验室 / 第 ${chapterIndex+1} 章 · 第 ${number} 课`;
    $('chapter-number').textContent = String(chapterIndex+1).padStart(2,'0');
    $('chapter-name').textContent = chapter?.name||level.english;
    $('map-name').textContent = level.name;
    document.querySelector('.map-size').textContent = `${city.width} × ${city.height}`;
    const population=city.homes.reduce((sum,home)=>sum+home.passengers,0);
    $('target-label').textContent = `目标 ${city.target}`;
    $('target-unit').textContent = `/ ${campaign?population:city.target} 人`;
    $('mission-title').textContent = level.title;
    $('mission-description').textContent = campaign?`第 ${campaign.dayIndex+1} 天：在 ${city.duration} 秒内尽量完成 ${city.target} 人的通勤。当日总人口送达比例与满意度共同决定收入，结算后可改造路网。`:`在 ${city.duration} 秒内送达 ${city.target} 人，建设与公交预算共 ${city.budget} 点。${level.description}`;
    $('mission-tip-meta').textContent = campaign?`五日运营 · 当日最高收入 ${campaign.days[campaign.dayIndex].maxIncome} 点`:`第 ${number} 课 · ${level.lesson}`;
    $('mission-tip').textContent = level.tip;
    const demand = $('demand-list');demand.replaceChildren();
    for (const r of city.routes) {
      const row = document.createElement('li');
      const homes = r.homes.map(h => `住宅 (${point(h.cell).x + 1},${point(h.cell).y + 1}) 共 ${h.passengers} 人 · 产生 ${h.generationRate} 人/s · 汽车出口由门口道路等级决定`);
      const goals = r.goals.map(g => `目的地 (${point(g.cell).x + 1},${point(g.cell).y + 1}) · ${g.label}${g.input != null ? ` 输入 ${g.input} 人` : ''}`);
      row.textContent = `${r.name}：${[...homes, ...goals].join('；')}`;
      demand.append(row);
    }
    $('load-setting').hidden = !level.features.load;
    $('cut-tool').hidden = !level.features.cut;
    $('bus-tool').hidden = !level.features.bus;
    $('bus-controls').hidden = !level.features.bus;
    $('legend-bus').hidden = !level.features.bus;
    $('show-load').checked = level.features.load;
    if (tool === 'cut' && !level.features.cut || tool === 'bus' && !level.features.bus) setTool('view');
    if(visibleChapterIndex!==chapterIndex)showChapter(chapterIndex);
    else levelButtons.forEach(button=>{
      const selected=button.dataset.levelId===level.id;
      button.classList.toggle('selected',selected);
      button.setAttribute('aria-current',selected?'true':'false');
    });
    $('connection-list').replaceChildren();
    connectionRows = city.routes.map((route, ri) => {
      const row = document.createElement('div'); row.className = 'connection-row';
      const name = document.createElement('span'), dot = document.createElement('i');
      dot.style.background = route.color; name.append(dot, route.name);
      const status = document.createElement('span'); status.textContent = '待连接';
      row.append(name, status); $('connection-list').append(row);
      return { row, status, routeIndex: ri };
    });
    updateDesignControls();renderCampaignProgress();
  }
  function requestLevel(id) {
    if (id === city.level.id) return;
    const defaultDesign = new City(city.level.id).serializeDesign();
    const designChanged = JSON.stringify(city.serializeDesign()) !== JSON.stringify(defaultDesign);
    if (!designChanged && city.state === 'planning') {
      reset(id); return;
    }
    pendingLevel = id;
    $('level-confirm-title').textContent = `前往「${levels().find(level => level.id === id).name}」？`;
    openPausedDialog($('level-dialog'));
  }
  function openPausedDialog(dialog) {
    const resume = city.state === 'running';
    if (resume) city.toggle();
    dialog.dataset.resumeOperation = String(resume);
    accumulator = 0;updateUI();dialog.showModal();
  }
  function closePausedDialog(dialog, resume = true) {
    const shouldResume = resume && dialog.dataset.resumeOperation === 'true' && city.state === 'paused';
    delete dialog.dataset.resumeOperation;
    if (dialog.open) dialog.close();
    if (shouldResume) city.toggle();
    accumulator = 0;updateUI();
  }
  function toast(text) {
    if (!text) return;
    $('toast').textContent = text; $('toast').classList.add('visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 2200);
  }
  function setTool(value) {
    if (!['view','select'].includes(value) && city.state !== 'planning') {
      toast('运营期间只能观察或查看路况，请先停止运营再修改规划'); return;
    }
    if (value === 'cut' && !city.level.features.cut) {
      toast('剪刀工具在本关未开放'); return;
    }
    if (value === 'bus' && !city.level.features.bus) {
      toast('公交线路在本关未开放'); return;
    }
    tool = value;if(value!=='bus')busEditMode='draw';keyboardAnchor=null;dragging=false;lastCell=null;dragDraft=null;selectionAnchor=null;panLast=null;
    $('road-inspector').hidden=tool!=='select';
    for (const name of ['view', 'select', 'road', 'cut', 'bus']) {
      $(name + '-tool').classList.toggle('active', name === tool);
      $(name + '-tool').setAttribute('aria-pressed', String(name === tool));
    }
    canvas.classList.toggle('view-mode',tool==='view');
    draw();
  }
  function selectedCells() {
    if (!selection) return [];
    const a=point(selection.start),b=point(selection.end),cells=[];
    for(let y=Math.min(a.y,b.y);y<=Math.max(a.y,b.y);y++) for(let x=Math.min(a.x,b.x);x<=Math.max(a.x,b.x);x++) cells.push(key(x,y));
    return cells;
  }
  function updateBusVisibilityControls() {
    const panel=$('bus-line-visibility'), ids=new Set(city.busLines.map(line=>line.id));
    for(const id of dimmedBusLines) if(!ids.has(id)) dimmedBusLines.delete(id);
    const signature=city.busLines.map(line=>`${line.id}:${line.name}:${line.color}:${dimmedBusLines.has(line.id)}`).join('|');
    if(panel.dataset.signature===signature)return;
    panel.dataset.signature=signature;panel.replaceChildren();
    for(const line of city.busLines) {
      const dimmed=dimmedBusLines.has(line.id),button=document.createElement('button');
      button.type='button';button.className='bus-visibility-toggle';button.classList.toggle('dimmed',dimmed);button.setAttribute('aria-pressed',String(!dimmed));
      button.style.setProperty('--bus-color',line.color);button.textContent=`${dimmed?'○':'◉'} ${line.name}`;
      button.title=dimmed?'当前线路已虚化，点击突出显示':'当前线路已突出显示，点击虚化';
      button.onclick=()=>{if(dimmedBusLines.has(line.id))dimmedBusLines.delete(line.id);else dimmedBusLines.add(line.id);panel.dataset.signature='';updateUI();draw();};
      panel.append(button);
    }
  }
  function updateBusLineInspector(cell, planning) {
    const panel=$('bus-line-inspector'), lines=cell===null?[]:city.linesAtCell(cell);
    panel.replaceChildren();panel.hidden=!lines.length;
    for(const line of lines) {
      const card=document.createElement('div');card.className='bus-line-card';card.classList.toggle('active',line.id===city.activeBusLineId);card.style.borderColor=line.color;
      const title=document.createElement('strong');title.textContent=line.name;title.style.color=line.color;
      const detail=document.createElement('span');detail.textContent=`${line.count} 辆 · ${line.stops.has(cell)?'本站已启用':'本站未启用'}`;
      const choose=document.createElement('button');choose.className='tool';choose.textContent=line.id===city.activeBusLineId?'当前线路':'管理线路';
      choose.onclick=()=>{city.selectBusLine(line.id);updateUI();draw();};
      const stop=document.createElement('button');stop.className='tool';stop.textContent=line.stops.has(cell)?'取消本站':'设为本站';stop.disabled=!planning;
      stop.onclick=()=>{const enabled=!line.stops.has(cell),message=mutateDesign(()=>city.setBusStop(cell,enabled,line.id));toast(message||(enabled?'已设置公交站':'已取消公交站'));updateUI();draw();};
      card.append(title,detail,choose,stop);panel.append(card);
    }
  }
  function applySignalSettings(settings, success='路口设置已更新') {
    if (!city.level.features.signals) { toast('红绿灯在本关未开放'); updateUI(); return false; }
    const message=mutateDesign(()=>city.setSignal(inspectedCell,settings));
    if(message){$('signal-priority-list').dataset.signature='';$('signal-phase-list').dataset.signature='';}
    toast(message||success);updateUI();draw();return !message;
  }
  function updateSignalControls(signal, planning) {
    const unlocked=Boolean(signal&&city.level.features.signals),editable=unlocked&&planning;
    $('signal-enabled').disabled=!editable;$('signal-enabled').checked=Boolean(signal?.enabled);
    $('signal-off-options').hidden=Boolean(signal?.enabled);
    $('signal-on-options').hidden=!signal?.enabled;
    $('signal-yield-mode').disabled=!editable;
    $('signal-yield-mode').value=signal?.yieldMode||'arrival';
    $('signal-priority-editor').hidden=signal?.yieldMode!=='priority';
    $('signal-automatic').disabled=!editable;$('signal-automatic').checked=signal?.automatic!==false;
    $('signal-cycle').disabled=!editable||!signal?.enabled;
    if(document.activeElement!==$('signal-cycle'))$('signal-cycle').value=String(signal?.green||2);
    $('signal-custom-editor').hidden=!signal?.enabled||signal?.automatic!==false;
    if(!signal)return;
    const priorityList=$('signal-priority-list'),prioritySignature=`${editable}:${signal.priority.join(',')}`;
    if(priorityList.dataset.signature!==prioritySignature) {
      priorityList.dataset.signature=prioritySignature;priorityList.replaceChildren();
      signal.priority.forEach((entry,index)=>{
        const row=document.createElement('div');row.className='signal-order-row';
        const name=document.createElement('span');name.textContent=`${index+1}. ${SIGNAL_ENTRY_NAMES[entry]}`;
        const up=document.createElement('button'),down=document.createElement('button');
        for(const button of [up,down]){button.type='button';button.className='tool';button.disabled=!editable;}
        up.textContent='↑';up.title='提高优先级';up.disabled||=index===0;
        down.textContent='↓';down.title='降低优先级';down.disabled||=index===signal.priority.length-1;
        const move=offset=>{const priority=[...signal.priority],target=index+offset;[priority[index],priority[target]]=[priority[target],priority[index]];applySignalSettings({priority},'入口优先顺序已更新');};
        up.onclick=()=>move(-1);down.onclick=()=>move(1);row.append(name,up,down);priorityList.append(row);
      });
    }
    const phaseList=$('signal-phase-list'),phaseSignature=`${editable}:${JSON.stringify(signal.phases)}`;
    if(phaseList.dataset.signature!==phaseSignature) {
      phaseList.dataset.signature=phaseSignature;phaseList.replaceChildren();
      signal.phases.forEach((phase,index)=>{
        const card=document.createElement('section');card.className='signal-phase-card';
        const heading=document.createElement('div');heading.className='signal-phase-heading';
        const title=document.createElement('strong');title.textContent=`阶段 ${index+1}`;
        const up=document.createElement('button'),down=document.createElement('button'),remove=document.createElement('button');
        for(const button of [up,down,remove]){button.type='button';button.className='tool';button.disabled=!editable;}
        up.textContent='↑';up.title='阶段提前';up.disabled||=index===0;down.textContent='↓';down.title='阶段后移';down.disabled||=index===signal.phases.length-1;
        remove.textContent='删除';remove.classList.add('danger-button');remove.disabled||=signal.phases.length===1;
        const reorder=offset=>{const phases=signal.phases.map(actions=>[...actions]),target=index+offset;[phases[index],phases[target]]=[phases[target],phases[index]];applySignalSettings({phases},'手动灯序已更新');};
        up.onclick=()=>reorder(-1);down.onclick=()=>reorder(1);
        remove.onclick=()=>{const phases=signal.phases.filter((_,phaseIndex)=>phaseIndex!==index).map(actions=>[...actions]);applySignalSettings({phases},'已删除信号阶段');};
        heading.append(title,up,down,remove);card.append(heading);
        const actions=document.createElement('div');actions.className='signal-action-grid';
        for(const action of SIGNAL_ACTIONS) {
          const [entry,turn]=action.split('-'),label=document.createElement('label'),input=document.createElement('input');
          input.type='checkbox';input.checked=phase.includes(action);input.disabled=!editable;
          input.onchange=()=>{const phases=signal.phases.map(items=>[...items]),set=new Set(phases[index]);if(input.checked)set.add(action);else set.delete(action);phases[index]=SIGNAL_ACTIONS.filter(item=>set.has(item));applySignalSettings({phases},input.checked?'已添加放行动作':'已移除放行动作');};
          label.append(input,document.createTextNode(`${SIGNAL_ENTRY_NAMES[entry]}${SIGNAL_TURN_NAMES[turn]}`));actions.append(label);
        }
        card.append(actions);phaseList.append(card);
      });
    }
    $('add-signal-phase').disabled=!editable||signal.phases.length>=8;
  }
  function updateInspector() {
    const cells=selectedCells(), n=cells.length===1?cells[0]:null;
    const roads=cells.filter(cell=>city.roads.has(cell)), removable=roads;
    const planning=city.state==='planning', singleRoad=n!==null&&city.roads.has(n);
    inspectedCell=singleRoad?n:null;
    $('selection-title').textContent=cells.length>1?'区域信息':'格子信息';
    $('upgrade-road').disabled=!roads.some(cell=>(city.roadGrades.get(cell)||0)<ROAD_TYPES.length-1)||!city.level.features.grade||!planning;
    $('downgrade-road').disabled=!roads.some(cell=>(city.roadGrades.get(cell)||0)>0)||!city.level.features.grade||!planning;
    $('remove-road').disabled=!removable.length||!planning;
    $('build-road').disabled=!(n!==null&&!city.roads.has(n)&&!city.buildings.has(n)&&!city.pendingBuildings.has(n)&&(!city.water.has(n)||city.bridges.has(n))&&!city.trees.has(n))||!planning;
    $('upgrade-road').textContent=cells.length>1?'↑ 全部升级':'↑ 升级';
    $('downgrade-road').textContent=cells.length>1?'↓ 全部降级':'↓ 降级';
    $('remove-road').textContent=cells.length>1?'⌫ 全部拆除':'⌫ 拆除';
    const signal=singleRoad?city.signals.get(n):null;
    $('signal-controls').hidden=!signal;
    if (!cells.length) {
      $('road-detail').textContent='点击一个格子，或拖动选择矩形区域。';
      $('road-load').textContent='';$('signal-phase').textContent='';
    } else if (cells.length>1) {
      const a=point(selection.start),b=point(selection.end),width=Math.abs(a.x-b.x)+1,height=Math.abs(a.y-b.y)+1;
      const price=roads.reduce((sum,cell)=>sum+city.roadType(cell).cost,0);
      $('road-detail').textContent=`${width} × ${height} · ${cells.length} 格 · ${roads.length} 格道路 · 内部总价 ${price} 点`;
      const cars=city.cars.filter(car=>cells.includes(car.cell)||cells.includes(car.next)).length;
      const queued=city.homes.reduce((sum,home,i)=>sum+(cells.includes(home.cell)?city.queues[i]:0),0);
      $('road-load').textContent=['running','paused'].includes(city.state)?`区域车流：${cars} 辆占用或驶入 · 住宅等待 ${queued} 辆`:'可用分开的按钮批量升级、降级或拆除区域内道路。';
      $('signal-phase').textContent='多格选择不提供红绿灯调整，请单独选择一个路口。';
    } else {
      const p=point(n),homeIndex=city.homes.findIndex(home=>home.cell===n),goalIndex=city.goals.findIndex(goal=>goal.cell===n);
      if(singleRoad) {
        const type=city.roadType(n),load=city.load(n),phase=city.signalPhase(n);
        const turnLayout=['转向全部混行','左转专用，直行 / 右转混行','左转 / 直行 / 右转各用一条车道'][type.lanes-1];
        $('road-detail').textContent=`(${p.x+1}, ${p.y+1}) ${type.name}：${type.speed} 格/秒 · 每方向 ${type.lanes} 车道 × 2 辆 · ${turnLayout} · 每格 ${type.cost} 点${city.bridges.has(n)?' · 位于桥梁':''}`;
        $('road-load').textContent=city.level.features.load?(signal?(signal.enabled?`冲突区预约 ${load.used} / 4 区 · 占用/驶入 ${load.total} 辆`:`逐车通行 · 路口占用 ${load.total} / 1 辆`):`每方向 ${type.lanes} 车道 × 前后 2 辆 · 最忙方向 ${load.used} / ${load.capacity} 辆`):(['running','paused'].includes(city.state)?`当前占用或驶入 ${load.total} 辆`:'');
        const names={off:signal?.yieldMode==='priority'?`方向优先 · ${signal.priority.map(entry=>SIGNAL_ENTRY_NAMES[entry].replace('侧入口','')).join(' → ')}`:'自动让行 · 35% 速度 · 先到先行','horizontal-straight':'横向直行绿灯','horizontal-left':'横向左转绿灯','vertical-straight':'纵向直行绿灯','vertical-left':'纵向左转绿灯','main-straight':'T 形路口主路双向直行','main-turn':'T 形路口主路转入支路','branch-turn':'T 形路口支路汇入主路',clearance:'直行 / 左转全红清空'};
        const custom=phase.stage==='custom'?`手动阶段 ${phase.index+1} · ${phase.actions.map(action=>{const [entry,turn]=action.split('-');return SIGNAL_ENTRY_NAMES[entry].replace('侧入口','')+SIGNAL_TURN_NAMES[turn];}).join('、')}`:'';
        $('signal-phase').textContent=!city.level.features.inspect?`本关专注于「${city.level.lesson}」，详细路况与信号在本关未开放。`:signal?`${custom||names[phase.stage]}${phase.axis==='off'?'':` · ${phase.remaining.toFixed(1)} 秒；右转须让行`}`:'非路口，无需红绿灯';
      } else if(homeIndex>=0) {
        const home=city.homes[homeIndex];
        $('road-detail').textContent=`(${p.x+1}, ${p.y+1}) 住宅 · 总人口 ${home.passengers} 人 · 居民产生 ${home.generationRate} 人/秒 · 汽车出口由门口道路等级决定`;
        const serving=city.linesServingBuilding(n);
        $('road-load').textContent=`剩余 ${home.passengers-city.departedByHome[homeIndex]} 人 · 已离开 ${city.departedByHome[homeIndex]} 人 · 当前等待 ${city.queues[homeIndex]} 人`;
        $('signal-phase').textContent=`建筑可作为拖拽起点；向空地延伸时固定从支路开始。${serving.length?` · 相邻站点：${serving.map(line=>line.name).join('、')}`:''}`;
      } else if(goalIndex>=0) {
        const goal=city.goals[goalIndex];
        $('road-detail').textContent=`(${p.x+1}, ${p.y+1}) 接收建筑 · 容量 ${goal.input==null?'不限':goal.input+' 人'}`;
        $('road-load').textContent=`剩余容量 ${goal.input==null?'不限':Math.max(0,goal.input-city.goalAssigned[goalIndex])+' 人'} · 已接收 ${city.byGoal[goalIndex]} 人 · 已分配 ${city.goalAssigned[goalIndex]} 人`;
        const serving=city.linesServingBuilding(n);
        $('signal-phase').textContent=`建筑可作为拖拽起点；向空地延伸时固定从支路开始。${serving.length?` · 相邻站点：${serving.map(line=>line.name).join('、')}`:''}`;
      } else {
        const site=city.pendingBuildings.get(n);
        const kind=site?`${site.kind==='home'?'住宅':'目的地'}建设用地`:city.bridges.has(n)?'桥梁（空）':city.water.has(n)?'水面':city.trees.has(n)?'绿地':'空地';
        $('road-detail').textContent=`(${p.x+1}, ${p.y+1}) ${kind}${site?` · ${site.daysUntil} 天后落成`:''}`;
        $('road-load').textContent=site?'建设期间不可铺路，请为建筑和出口预留空间。':kind==='空地'||kind==='桥梁（空）'?'可在此建设一格支路；拖拽后才会建立连接。':'此处不能建设道路。';$('signal-phase').textContent='';
      }
    }
    updateSignalControls(signal,planning);
    if(signal&&city.level.features.inspect&&!city.level.features.signals)$('signal-phase').textContent+=' · 红绿灯在本关未开放';
    updateBusLineInspector(n, planning);
  }
  function viewBounds() {
    const worldWidth=city.width*cellSize,worldHeight=city.height*cellSize;
    return { minX:worldWidth<=viewportWidth?(viewportWidth-worldWidth)/2:viewportWidth-worldWidth, maxX:worldWidth<=viewportWidth?(viewportWidth-worldWidth)/2:0, minY:worldHeight<=viewportHeight?(viewportHeight-worldHeight)/2:viewportHeight-worldHeight, maxY:worldHeight<=viewportHeight?(viewportHeight-worldHeight)/2:0 };
  }
  function snapView() {
    const b=viewBounds();viewTarget={x:Math.max(b.minX,Math.min(b.maxX,viewX)),y:Math.max(b.minY,Math.min(b.maxY,viewY))};
  }
  function resetView() {
    viewZoom=1;cellSize=Math.min(viewportWidth/city.width,viewportHeight/city.height);
    viewX=(viewportWidth-city.width*cellSize)/2;viewY=(viewportHeight-city.height*cellSize)/2;viewTarget=null;
  }
  function setZoom(next,screenX=viewportWidth/2,screenY=viewportHeight/2) {
    const oldSize=cellSize,worldX=(screenX-viewX)/oldSize,worldY=(screenY-viewY)/oldSize;
    viewZoom=Math.max(1,Math.min(5,next));cellSize=Math.min(viewportWidth/city.width,viewportHeight/city.height)*viewZoom;
    viewX=screenX-worldX*cellSize;viewY=screenY-worldY*cellSize;snapView();
  }
  function resize() {
    const rect = canvas.getBoundingClientRect(), oldWidth=viewportWidth, oldHeight=viewportHeight;
    viewportWidth=rect.width;viewportHeight=rect.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(viewportWidth * dpr); canvas.height = Math.round(viewportHeight * dpr);
    if(!city){ctx.setTransform(dpr,0,0,dpr,0,0);return;}
    if(!viewReady){resetView();viewReady=true;}else{viewX+=(viewportWidth-oldWidth)/2;viewY+=(viewportHeight-oldHeight)/2;cellSize=Math.min(viewportWidth/city.width,viewportHeight/city.height)*viewZoom;snapView();}
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  function rounded(x, y, w, h, r, fill, stroke) {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }
  function line(x1, y1, x2, y2, color, width) {
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  }
  function circle(x,y,r,color) { ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=color;ctx.fill(); }
  function busSegment(aCell,bCell,s) {
    const a=point(aCell),b=point(bCell),dx=b.x-a.x,dy=b.y-a.y,offset=s*.13;
    return { x1:(a.x+.5)*s-dy*offset, y1:(a.y+.5)*s+dx*offset, x2:(b.x+.5)*s-dy*offset, y2:(b.y+.5)*s+dx*offset, dx, dy };
  }
  function busDirection(segment,color,s) {
    const mx=(segment.x1+segment.x2)/2,my=(segment.y1+segment.y2)/2,back=s*.085,wing=s*.052;
    const bx=mx-segment.dx*back,by=my-segment.dy*back;
    line(bx-segment.dy*wing,by+segment.dx*wing,mx,my,color,s*.023);
    line(bx+segment.dy*wing,by-segment.dx*wing,mx,my,color,s*.023);
  }
  function busTurn(ctxPath,previous,next,s) {
    if(previous.dx===next.dx&&previous.dy===next.dy){ctxPath.lineTo(previous.x2,previous.y2);return;}
    const r=s*.2;
    const incoming={x:previous.x2-previous.dx*r,y:previous.y2-previous.dy*r};
    const outgoing={x:next.x1+next.dx*r,y:next.y1+next.dy*r};
    ctxPath.lineTo(incoming.x,incoming.y);
    if(previous.dx===-next.dx&&previous.dy===-next.dy) {
      const reach=s*.18;
      ctxPath.bezierCurveTo(previous.x2+previous.dx*reach,previous.y2+previous.dy*reach,next.x1-next.dx*reach,next.y1-next.dy*reach,outgoing.x,outgoing.y);
      return;
    }
    const control={x:previous.dx?next.x1:previous.x2,y:previous.dy?next.y1:previous.y2};
    ctxPath.quadraticCurveTo(control.x,control.y,outgoing.x,outgoing.y);
  }
  function strokeBusRoute(route,color,width,s,dashed=false,joinEnds=false) {
    if(route.length<2)return;
    const segments=[];for(let i=1;i<route.length;i++)segments.push(busSegment(route[i-1],route[i],s));
    ctx.save();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.lineJoin='round';
    if(dashed)ctx.setLineDash([s*.11,s*.095]);
    ctx.beginPath();ctx.moveTo(segments[0].x1,segments[0].y1);
    for(let i=0;i<segments.length;i++) {
      const next=i+1<segments.length?segments[i+1]:joinEnds?segments[0]:null;
      if(next)busTurn(ctx,segments[i],next,s);else ctx.lineTo(segments[i].x2,segments[i].y2);
    }
    ctx.stroke();ctx.restore();
  }
  function strokeBusConnector(previous,next,color,width,s,dashed=false) {
    ctx.save();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';if(dashed)ctx.setLineDash([s*.11,s*.095]);
    ctx.beginPath();ctx.moveTo(previous.x2,previous.y2);busTurn(ctx,previous,next,s);ctx.stroke();ctx.restore();
  }
  function drawBusRoute(route,color,width,s,dashed=false,joinEnds=false) {
    strokeBusRoute(route,color,width,s,dashed,joinEnds);
    for(let i=1;i<route.length;i+=2)busDirection(busSegment(route[i-1],route[i],s),color,s);
  }
  function label(text,x,y,size,color,weight='500') {
    ctx.font = `${weight} ${size}px system-ui, sans-serif`; ctx.textAlign='center'; ctx.textBaseline='middle';ctx.fillStyle=color;ctx.fillText(text,x,y);
  }
  function buildingBubble(text,x,y,w,h,fill,color,stroke=null,tail='right') {
    rounded(x,y,w,h,h/2,fill,stroke);
    ctx.beginPath();
    const tx=tail==='right'?x+w-h*.38:x+h*.38;
    ctx.moveTo(tx-h*.13,y+h*.84);ctx.lineTo(tx+h*.13,y+h*.84);ctx.lineTo(tx+(tail==='right'?h*.12:-h*.12),y+h*1.08);ctx.closePath();
    ctx.fillStyle=stroke||fill;ctx.fill();
    label(text,x+w/2,y+h*.49,h*.52,color,'700');
  }
  function drawSignalMarkings(n) {
    const s=cellSize,p=point(n),signal=city.signals.get(n);
    const links=new Set(city.links(n));
    const width=city.width,rightOf={1:width,[width]:-1,[-1]:-width,[-width]:1};
    // Paint into each incoming quadrant, in driving coordinates: x is forward,
    // y is right. Only show arrows whose entry AND exit actually exist.
    for(const entry of [1,width,-1,-width]) {
      if(!links.has(n-entry)) continue;
      ctx.save();ctx.translate((p.x+.5)*s,(p.y+.5)*s);
      ctx.rotate(entry===1?0:entry===width?Math.PI/2:entry===-1?Math.PI:-Math.PI/2);
      ctx.lineCap='round';ctx.lineJoin='round';ctx.setLineDash([]);
      for(const turn of ['left','straight','right']) {
        const exit=turn==='straight'?entry:turn==='right'?rightOf[entry]:-rightOf[entry];
        if(!links.has(n+exit)) continue;
        const side=turn==='left'?.09:turn==='straight'?.23:.36;
        const endX=turn==='straight'?-.18:-.28;
        const endY=side+(turn==='left'?-.065:turn==='right'?.065:0);
        ctx.beginPath();ctx.moveTo(-.44*s,side*s);
        if(turn==='straight')ctx.lineTo(endX*s,endY*s);
        else {ctx.lineTo(-.33*s,side*s);ctx.quadraticCurveTo(endX*s,side*s,endX*s,endY*s);}
        const dx=turn==='straight'?1:0,dy=turn==='left'?-1:turn==='right'?1:0;
        for(const sign of [-1,1]) {
          ctx.moveTo((endX-dx*.05-dy*.038*sign)*s,(endY-dy*.05+dx*.038*sign)*s);
          ctx.lineTo(endX*s,endY*s);
        }
        // A subtle keyline keeps painted markings readable on grass, asphalt
        // and bridges, without floating lamp boxes or lettering over the map.
        ctx.strokeStyle='#29433580';ctx.lineWidth=Math.max(1.8,s*.065);ctx.stroke();
        ctx.strokeStyle=!signal.enabled||turn==='right'?'#f5f1d9':city.canEnter(n,entry,exit)?'#187b48':'#c33f39';
        ctx.lineWidth=Math.max(.9,s*.032);ctx.stroke();
      }
      ctx.restore();
    }
  }
  function drawBuilding(b) {
    const {x,y}=point(b.cell), s=cellSize, cx=(x+.5)*s, cy=(y+.5)*s, r=b;
    rounded(x*s+s*.1,y*s+s*.15,s*.8,s*.8,s*.16,'#8d9a7d22');
    rounded(x*s+s*.08,y*s+s*.07,s*.84,s*.84,s*.17,r.light);
    if(b.isHome) {
      if (r.generationRate === 6) {
        rounded(cx-s*.22,cy-s*.36,s*.44,s*.64,s*.025,r.color);
        for(let floor=0;floor<4;floor++) for(let col=0;col<2;col++) rounded(cx-s*.14+col*s*.17,cy-s*.28+floor*s*.13,s*.09,s*.07,0,r.light);
      } else {
        const width=r.generationRate===4?.32:.23;
        ctx.beginPath();ctx.moveTo(cx-s*width,cy-s*.03);ctx.lineTo(cx,cy-s*.29);ctx.lineTo(cx+s*width,cy-s*.03);ctx.closePath();ctx.fillStyle=r.color;ctx.fill();
        rounded(cx-s*width*.8,cy-s*.05,s*width*1.6,s*.31,s*.025,r.color);
        rounded(cx-s*.055,cy+s*.08,s*.11,s*.18,s*.01,r.light);
      }
    } else {
      rounded(cx-s*.26,cy-s*.25,s*.52,s*.49,s*.055,r.color);
      rounded(cx-s*.19,cy-s*.19,s*.38,s*.12,s*.025,r.light);
      for(let j=0;j<3;j++) rounded(cx-s*.18+j*s*.13,cy-s*.005,s*.075,s*.11,s*.01,r.light);
      rounded(cx-s*.045,cy+s*.12,s*.09,s*.12,s*.01,r.light);
    }
    if(b.isHome) {
      buildingBubble(String(Math.max(0,r.passengers-city.departedByHome[b.index])), (x+.53)*s,(y+.025)*s,s*.43,s*.27,r.color,'#fffef9');
      rounded((x+.055)*s,(y+.7)*s,s*.43,s*.235,s*.09,r.light,r.color);
      label(`+${r.generationRate}/s`,(x+.27)*s,(y+.815)*s,s*.125,r.color,'700');
      const queued=city.queues[b.index];
      if(queued) {
        const text=`待${queued}`,width=(queued>99?.43:queued>9?.37:.31)*s;
        rounded((x+.95)*s-width,(y+.705)*s,width,s*.225,s*.1,'#bd7750');
        label(text,(x+.95)*s-width/2,(y+.815)*s,s*.145,'#fffef9','700');
      }
    } else {
      buildingBubble(r.input==null?'∞':String(Math.max(0,r.input-city.goalAssigned[b.index])), (x+.53)*s,(y+.025)*s,s*.43,s*.27,'#fffef9ee',r.color,r.color);
    }
    const serving=city.linesServingBuilding(b.cell);
    if(serving.length) {
      circle((x+.1)*s,(y+.11)*s,s*.09,'#f2bd4f');
      label(serving.length>1?String(serving.length):'站',(x+.1)*s,(y+.11)*s,s*.105,'#173f49','800');
    }
  }
  function draw() {
    if(!city)return;
    const dpr=Math.min(window.devicePixelRatio||1,2),s=cellSize,w=city.width*s,h=city.height*s;
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,viewportWidth,viewportHeight);
    ctx.save();ctx.translate(viewX,viewY);ctx.fillStyle='#eaf0df';ctx.fillRect(0,0,w,h);
    // Soft grid and planted lawn patches keep the map legible at small sizes.
    for(let y=0;y<city.height;y++) for(let x=0;x<city.width;x++) {
      if((x*7+y*11)%13===0) { ctx.fillStyle='#e3ebd7';ctx.fillRect(x*s,y*s,s,s); }
      ctx.strokeStyle='#dce5d04d';ctx.lineWidth=.65;ctx.strokeRect(x*s,y*s,s,s);
      if((x*3+y*7)%9===0 && !city.water.has(key(x,y)) && !city.roads.has(key(x,y)) && !city.buildings.has(key(x,y)) && !city.pendingBuildings.has(key(x,y))) {
        line((x+.2)*s,(y+.72)*s,(x+.23)*s,(y+.64)*s,'#cedcbd',1);
        line((x+.27)*s,(y+.74)*s,(x+.3)*s,(y+.67)*s,'#cedcbd',1);
      }
    }
    for (const n of city.water) {
      const {x,y} = point(n);
      ctx.fillStyle='#bbd9d8';ctx.fillRect(x*s,y*s,s,s);
      line((x+.2)*s,(y+.28)*s,(x+.55)*s,(y+.28)*s,'#d5e9e4',1.5);
      line((x+.55)*s,(y+.68)*s,(x+.85)*s,(y+.68)*s,'#a9cece',1.5);
      if (x === 0 || !city.water.has(n-1)) line(x*s,y*s,x*s,(y+1)*s,'#d1e3cf',s*.08);
      if (x === city.width-1 || !city.water.has(n+1)) line((x+1)*s,y*s,(x+1)*s,(y+1)*s,'#d1e3cf',s*.08);
    }
    // Bridges are terrain rather than prebuilt roads: show the structure even while empty.
    for(const n of city.bridges){
      const {x,y}=point(n),horizontal=(x>0&&city.bridges.has(n-1))||(x<city.width-1&&city.bridges.has(n+1)),cx=(x+.5)*s,cy=(y+.5)*s;
      rounded(x*s+(horizontal?0:s*.15),y*s+(horizontal?s*.15:0),horizontal?s:s*.7,horizontal?s*.7:s,s*.06,'#d7d8cb');
    }
    // Render connected road arms; dotted center lines separate the two directions.
    ctx.lineCap='butt';
    for(const n of city.roads) {
      const {x,y}=point(n),cx=(x+.5)*s,cy=(y+.5)*s;
      const links=city.links(n);
      const grade = city.roadGrades.get(n) || 0, type = city.roadType(n), width = type.width;
      rounded(cx-s*width/2,cy-s*width/2,s*width,s*width,s*.12,type.color);
      for(const v of links) {
        const p=point(v);
        line(cx,cy,cx+(p.x-x)*s*.51,cy+(p.y-y)*s*.51,type.color,s*width);
      }
      ctx.setLineDash([s*.09,s*.08]);
      for(const v of links) {
        const p=point(v);line(cx,cy,cx+(p.x-x)*s*.5,cy+(p.y-y)*s*.5,'#eaf0dfb0',s*.025);
      }
      if (!city.signals.has(n)) for (const v of links) {
        const p=point(v),dx=p.x-x,dy=p.y-y;
        for (let lane=1;lane<type.lanes;lane++) for (const side of [-1,1]) {
          const offset=lane*LANE_WIDTH*side*s;
          line(cx-dy*offset,cy+dx*offset,cx+dx*s*.5-dy*offset,cy+dy*s*.5+dx*offset,'#eaf0df80',s*.012);
        }
      }
      ctx.setLineDash([]);
      if (grade && !city.signals.has(n)) label(grade === 1 ? 'Ⅱ' : 'Ⅲ', (x+.2)*s, (y+.22)*s, s*.18, '#f8fbef', '700');
      if (city.level.features.load && $('show-load').checked) {
        const load = city.load(n);
        if (load.used) rounded(x*s+2,y*s+2,s-4,s-4,s*.12,null,load.ratio >= 1 ? '#c55e4c' : load.ratio >= .66 ? '#cb9144' : '#51966c');
      }
    }
    for(const n of city.bridges){
      const {x,y}=point(n),horizontal=(x>0&&city.bridges.has(n-1))||(x<city.width-1&&city.bridges.has(n+1)),cx=(x+.5)*s,cy=(y+.5)*s;
      if(horizontal){line(x*s,cy-s*.38,(x+1)*s,cy-s*.38,'#8d9b89',s*.04);line(x*s,cy+s*.38,(x+1)*s,cy+s*.38,'#8d9b89',s*.04);}
      else{line(cx-s*.38,y*s,cx-s*.38,(y+1)*s,'#8d9b89',s*.04);line(cx+s*.38,y*s,cx+s*.38,(y+1)*s,'#8d9b89',s*.04);}
    }
    ctx.lineCap='round';
    for(const busLine of city.busLines) if(busLine.route.length) {
      const active=busLine.id===city.activeBusLineId,width=s*(active?.05:.04),closed=busLine.route.length>=3&&busLine.route[0]===busLine.route[busLine.route.length-1];
      ctx.save();ctx.globalAlpha=dimmedBusLines.has(busLine.id)?.14:1;ctx.filter=dimmedBusLines.has(busLine.id)?'saturate(25%)':'none';
      drawBusRoute(busLine.route,busLine.color,width,s,false,closed);
      if(busLine.returnTrip&&!closed) {
        const returnRoute=[...busLine.route].reverse(),outLast=busSegment(busLine.route.at(-2),busLine.route.at(-1),s),returnFirst=busSegment(returnRoute[0],returnRoute[1],s);
        const returnLast=busSegment(returnRoute.at(-2),returnRoute.at(-1),s),outFirst=busSegment(busLine.route[0],busLine.route[1],s);
        strokeBusConnector(outLast,returnFirst,busLine.color,width,s,true);
        drawBusRoute(returnRoute,busLine.color,width,s,true);
        strokeBusConnector(returnLast,outFirst,busLine.color,width,s,true);
      }
      for(const n of busLine.stops) {
        const p=point(n);circle((p.x+.5)*s,(p.y+.5)*s,s*.11,'#fffef9');circle((p.x+.5)*s,(p.y+.5)*s,s*.067,'#f0b84f');
      }
      ctx.restore();
    }
    ctx.lineCap='butt';
    for(const n of city.trees) {
      const {x,y}=point(n),cx=(x+.5)*s,cy=(y+.48)*s;
      circle(cx+s*.04,cy+s*.16,s*.25,'#cddcbc');
      line(cx,cy,cx,cy+s*.31,'#a5b18d',s*.055);
      circle(cx-s*.1,cy,s*.19,'#a9c398');circle(cx+s*.1,cy+s*.015,s*.19,'#9ab88a');circle(cx,cy-s*.13,s*.19,'#b3cba1');
    }
    for(const site of city.pendingBuildings.values()) {
      const {x,y}=point(site.cell),cx=(x+.5)*s,cy=(y+.5)*s;
      ctx.save();ctx.globalAlpha=.78;ctx.setLineDash([s*.08,s*.06]);
      rounded(x*s+s*.1,y*s+s*.1,s*.8,s*.8,s*.13,'#c7cac5aa','#747a75');ctx.setLineDash([]);
      label(site.kind==='home'?'⌂':'▣',cx,cy-s*.08,s*.34,'#6f756f','700');
      rounded(cx-s*.2,cy+s*.16,s*.4,s*.22,s*.1,'#676d68');label(String(site.daysUntil),cx,cy+s*.27,s*.14,'#fffef9','800');
      ctx.restore();
    }
    city.homes.forEach((h,i)=>drawBuilding({...h,isHome:true,index:i}));
    city.goals.forEach((g,i)=>drawBuilding({...g,isHome:false,index:i}));
    // Road paint sits below vehicles, so it reads as part of the grid.
    for(const n of city.signals.keys()) drawSignalMarkings(n);
    for(const car of city.cars) {
      const pose=city.pose(car),length=VEHICLE_LENGTH*s,width=VEHICLE_WIDTH*s;
      ctx.save();ctx.translate(pose.x*s,pose.y*s);ctx.rotate(pose.angle);
      rounded(-length/2,-width/2+s*.015,length,width,s*.025,'#344c3333');
      rounded(-length/2,-width/2,length,width,s*.025,city.routes[car.route].color);
      rounded(length*.1,-width*.36,length*.2,width*.72,s*.01,'#f5f6e9bb');
      if(car.blocked>1) circle(-length*.55,0,s*.018,'#e2a15e');
      ctx.restore();
    }
    for(const bus of city.buses) {
      const pose=city.pose(bus),length=BUS_LENGTH*s,width=BUS_WIDTH*s;
      ctx.save();ctx.translate(pose.x*s,pose.y*s);ctx.rotate(pose.angle);
      rounded(-length/2,-width/2+s*.025,length,width,s*.03,'#1f353244');
      const busColor=city.busLine(bus.lineId)?.color||'#126f89';
      rounded(-length/2,-width/2,length,width,s*.035,busColor,'#fffef9');
      rounded(-length*.31,-width*.34,length*.45,width*.68,s*.012,'#d9eef0');
      rounded(length*.18,-width*.34,length*.19,width*.68,s*.012,'#f2bd4f');
      label('BUS',0,0,s*.07,'#fffef9','800');
      if(bus.dwell>0) circle(-length*.56,0,s*.025,'#f2bd4f');
      ctx.restore();
      rounded(pose.x*s-s*.2,pose.y*s-s*.285,s*.4,s*.2,s*.1,'#f2bd4f','#173f49');
      label(`${bus.passengers.length}/${BUS_CAPACITY}`,pose.x*s,pose.y*s-s*.185,s*.115,'#173f49','800');
    }
    arrivalEffects.draw(ctx, point, s);
    if(tool==='select'&&selection) {
      const a=point(selection.start),b=point(selection.end),x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),rw=Math.abs(a.x-b.x)+1,rh=Math.abs(a.y-b.y)+1;
      rounded(x*s+1,y*s+1,rw*s-2,rh*s-2,s*.1,'#37678c12','#37678c');
    }
    if(dragDraft) {
      const color=dragDraft.kind==='erase'||dragDraft.kind==='bus-trim'?'#c8844f':dragDraft.kind==='cut'?'#a97346':dragDraft.kind==='bus'?(city.activeBusLine?.color||'#1686a0'):'#317a57';
      for(const n of dragDraft.path){const {x,y}=point(n);rounded(x*s+3,y*s+3,s-6,s-6,s*.09,color+'20',color);}
      if(dragDraft.path.length>1) for(let i=1;i<dragDraft.path.length;i++){
        const a=point(dragDraft.path[i-1]),b=point(dragDraft.path[i]);line((a.x+.5)*s,(a.y+.5)*s,(b.x+.5)*s,(b.y+.5)*s,color,s*.08);
      }
    }
    const selected=keyboardMode?keyboardCell:hover;
    if(selected!==null) {
      const {x,y}=point(selected),retracting=dragDraft?.kind==='erase';
      rounded(x*s+1,y*s+1,s-2,s-2,s*.1,retracting?'#d18d4f22':'#317a5719',retracting?'#c68b56':'#6d936b');
      if(tool==='cut')label('✂',(x+.5)*s,(y+.5)*s,s*.42,'#a97346');
      if(tool==='bus')label(busEditMode==='trim'?'−':'▰',(x+.5)*s,(y+.5)*s,s*.34,busEditMode==='trim'?'#c8844f':city.activeBusLine?.color||'#1686a0','800');
      if(tool==='road'&&!city.buildings.has(selected)&&!city.pendingBuildings.has(selected)&&!city.roads.has(selected))label(retracting?'−':'+',(x+.5)*s,(y+.5)*s,s*.42,retracting?'#bd8253':'#82a277');
    }
    if(city.state==='paused') {
      rounded(w/2-52,14,104,27,14,'#fffef9e8');label('Ⅱ  规划暂停中',w/2,28,11,'#63715b');
    }
    ctx.restore();
  }
  function updateUI() {
    updateHistoryControls();
    $('delivered').textContent=city.delivered;$('budget').textContent=city.remaining;
    const deliveryTotal=campaign?city.homes.reduce((sum,home)=>sum+home.passengers,0):city.target;
    $('progress').style.width=Math.min(100,city.delivered/deliveryTotal*100)+'%';
    const seconds=Math.ceil(Math.max(0,city.duration-city.elapsed));
    $('timer').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
    const waiting=city.queues.reduce((a,b)=>a+b,0),blocked=[...city.cars,...city.buses].filter(c=>c.blocked>1.5).length;
    const heavy=blocked>3||waiting>18, neutral=['planning','paused','lost'].includes(city.state);
    $('traffic').textContent=city.state==='planning'?'等待出发':city.state==='paused'?'运营已暂停':city.state==='won'?'目标已达成':city.state==='lost'?'本轮已结束':heavy?'有些拥堵':waiting>6?'等待接通':'畅通无阻';
    $('traffic').style.color=neutral?'#7c877e':heavy?'#c38a51':'#317a57';$('traffic-dot').style.background=neutral?'#aab3a5':heavy?'#c38a51':'#73a780';
    const onboard=city.buses.reduce((sum,bus)=>sum+bus.passengers.length,0);
    $('waiting').textContent=`${waiting} 人在住宅等待 · ${city.cars.length} 辆小汽车${city.buses.length?` · ${city.buses.length} 辆公交载客 ${onboard} 人`:''}`;
    const states={planning:'规划中',running:'运营中',paused:'已暂停',won:'目标达成',lost:'运营结束'};
    $('phase-label').textContent=states[city.state];
    $('board-status').textContent=city.state==='planning'?'先规划，再出发':`${states[city.state]} · ${speed}× 速度`;
    $('start').textContent=city.state==='running'?'Ⅱ 暂停运营':city.state==='paused'?'▶ 继续运营':city.state==='planning'?'▶ 开始运营':'本局已结束';
    $('start').disabled=['won','lost'].includes(city.state);
    $('stop').disabled=!['running','paused'].includes(city.state);
    $('road-tool').disabled=city.state!=='planning';
    $('cut-tool').disabled=city.state!=='planning';
    $('bus-tool').disabled=city.state!=='planning';
    const busLine=city.activeBusLine, planningBus=city.state==='planning';
    const busClosed=Boolean(busLine?.route.length>=3&&busLine.route[0]===busLine.route[busLine.route.length-1]);
    const lineSelect=$('bus-line-select'), selectedId=lineSelect.value;
    const lineSignature=city.busLines.map(line=>`${line.id}:${line.name}`).join('|');
    if(lineSelect.dataset.signature!==lineSignature) {
      lineSelect.replaceChildren(...city.busLines.map(line=>{const option=document.createElement('option');option.value=line.id;option.textContent=line.name;return option;}));
      lineSelect.dataset.signature=lineSignature;
    }
    lineSelect.value=busLine?.id||selectedId;
    lineSelect.disabled=!city.busLines.length;
    $('new-bus-line').disabled=!planningBus||city.busLines.length>=city.busLineLimit;
    $('bus-line-name').disabled=!planningBus||!busLine;
    $('bus-line-color').disabled=!planningBus||!busLine;
    $('bus-count').disabled=!planningBus||!busLine;
    $('bus-return-trip').disabled=!planningBus||!busLine||busClosed;
    $('trim-bus').disabled=!planningBus||!busLine||busLine.route.length<2;
    const trimming=tool==='bus'&&busEditMode==='trim';
    $('trim-bus').classList.toggle('active',trimming);
    $('trim-bus').textContent=trimming?'取消擦除':'反向擦除';
    $('trim-bus').setAttribute('aria-pressed',String(trimming));
    $('redraw-bus').disabled=!planningBus||!busLine;
    $('delete-bus').disabled=!planningBus||!busLine;
    if(document.activeElement!==$('bus-line-name')) $('bus-line-name').value=busLine?.name||'';
    if(document.activeElement!==$('bus-line-color')) $('bus-line-color').value=busLine?.color||'#1686a0';
    if(document.activeElement!==$('bus-count')) $('bus-count').value=String(busLine?.count||1);
    $('bus-return-trip').checked=Boolean(busLine?.returnTrip);
    const busPassengers=city.buses.reduce((sum,bus)=>sum+bus.passengers.length,0), planned=city.busLines.filter(line=>line.route.length);
    if(busLine?.route.length) {
      const routeState=busClosed?`${busLine.route.length-1} 段闭环`:busLine.returnTrip?`${busLine.route.length-1} 段往返 · 返程不停站`:`${busLine.route.length-1} 段 · 待闭环`;
      $('bus-status').textContent=`${routeState} · ${busLine.count} 辆 · ${busLine.count*BUS_COST} 点${city.buses.length?` · 全网载客 ${busPassengers}/${city.buses.length*BUS_CAPACITY}`:''}`;
    } else $('bus-status').textContent=busLine?'当前线路尚未绘制':`尚无线路 · 本关上限 ${city.busLineLimit} 条`;
    if(planned.length>1) $('bus-status').textContent+=` · 已规划 ${planned.length}/${city.busLineLimit} 条`;
    updateBusVisibilityControls();
    $('load-design').disabled=city.state!=='planning'||!designAvailable;
    $('speed').textContent=speed+'×';
    $('speed').setAttribute('aria-label',`切换运营倍速，当前 ${speed} 倍`);
    $('speed').title=`当前 ${speed}×；点击切换为 ${SPEED_OPTIONS[(SPEED_OPTIONS.indexOf(speed)+1)%SPEED_OPTIONS.length]}×`;
    $('connection-count').textContent=city.routes.filter((r,i)=>city.routeConnected(i)).length+' / '+city.routes.length;
    connectionRows.forEach(({row,status},i)=>{
      row.classList.toggle('connected',city.routeConnected(i));status.textContent=city.routeConnected(i)?'已连接 ✓':'待连接';
    });
    updateInspector();
    renderCampaignProgress();
    if(['won','lost'].includes(city.state)&&!resultShown) showResult();
  }
  function showResult() {
    resultShown=true;
    const won=city.state==='won', generated=city.generated.reduce((sum,count)=>sum+count,0);
    const report=TrafficResults.commuteReport(city.commuteTimes,Math.max(0,generated-city.delivered));
    pendingCampaignScore=report.score;
    const settlement=campaign?campaign.settlement(report.score):null,finalDay=campaign&&campaign.dayIndex===campaign.days.length-1;
    $('result-icon').textContent=won?'✳':'⌁';
    $('result-title').textContent=campaign?finalDay?'五天运营，城市因你而成长。':`第 ${campaign.dayIndex+1} 天运营结算`:won?'这座小城，因你而畅通。':'再给小城一个好计划。';
    $('result-description').textContent=campaign?`${won?'完成':'未完成'}当日目标；本日收入 ${settlement.income} 点，由当日总人口送达比例与通勤满意度共同计算。${finalDay?'你仍可关闭报告，从进度条回到任一天重新运营。':'进入下一天后，新建筑可能落成，请先用收入改造交通。'}`:won?'目标达成！每一段精心规划的道路，都让生活更近了一点。':'时间到了。'+city.level.tip;
    const summary=document.createElement('strong');summary.textContent=`已产生居民满意度 ${report.score}%`;
    const meta=document.createElement('div');meta.textContent=`抵达 ${city.delivered} / ${campaign?settlement.population:city.target} 人${campaign?` · 当日目标 ${city.target} 人`:''} · 平均通勤 ${city.delivered?report.average.toFixed(1)+' 秒':'暂无'} · 建设及公交 ${city.budget-city.remaining} 点${campaign?` · 收入 +${settlement.income} 点`:''}`;
    const distribution=document.createElement('div');distribution.className='commute-distribution';
    for(const band of report.bands){const item=document.createElement('span');item.textContent=`${band.label} ${band.count} 人`;distribution.append(item);}
    $('result-stats').replaceChildren(summary,meta,distribution);
    $('next-level').hidden = campaign?finalDay:!won||levels().indexOf(city.level)===levels().length-1;
    $('next-level').textContent=campaign?'进入下一天规划 ↗':'下一座小城 ↗';
    $('view-city').hidden=Boolean(campaign&&!finalDay);
    $('play-again').textContent=campaign?'重新开始五天':'再规划一次';
    if(finalDay&&!campaign.results[campaign.dayIndex])campaign.advance(report.score);
    for(const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    $('result-dialog').showModal();
  }
  function reset(levelId = city.level.id) {
    const switching=Boolean(city&&levelId!==city.level.id);
    for(const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    const level=levels().find(item=>item.id===levelId);campaign=level?.campaign?new CampaignSession(levelId):null;city=campaign?campaign.city:new City(levelId);
    resetDesignHistory();
    speed=1;accumulator=0;resultShown=false;pendingCampaignScore=null;dragging=false;lastCell=null;dragDraft=null;selection=null;selectionAnchor=null;dimmedBusLines.clear();busEditMode='draw';
    arrivalEffects.reset();
    pendingLevel=null;hover=null;keyboardMode=false;keyboardCell=key(1,2);inspectedCell=null;
    resetView();configureLevel();setTool('view');updateUI();draw();toast(switching?city.level.description:`已重新规划「${city.level.name}」`);
  }
  function eventPoint(event) { const rect=canvas.getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top}; }
  function eventCell(event) {
    const p=eventPoint(event),x=Math.floor((p.x-viewX)/cellSize),y=Math.floor((p.y-viewY)/cellSize);
    return x>=0&&x<city.width&&y>=0&&y<city.height?key(x,y):null;
  }
  function moveView(dx,dy) {
    const b=viewBounds(),rubber=(value,min,max)=>value<min?min+(value-min)*.32:value>max?max+(value-max)*.32:value;
    viewTarget=null;viewX=rubber(viewX+dx,b.minX,b.maxX);viewY=rubber(viewY+dy,b.minY,b.maxY);
  }
  function busDraftProblem(start) {
    const line=city.activeBusLine;
    if(busEditMode==='trim') {
      if(!line||line.route.length<2)return '当前线路没有可擦除的路段';
      return start===line.route[line.route.length-1]?'':'请从当前线路末端开始反向擦除';
    }
    if(!city.roads.has(start))return '请从已有道路开始绘制公交线路';
    if(!line?.route.length)return '';
    if(line.route[0]===line.route[line.route.length-1])return '当前线路已经闭环；如需续画，请先反向擦除尾段';
    if(start!==line.route[line.route.length-1])return '请从当前公交线路的末端继续绘制';
    return '';
  }
  function extendDraft(next) {
    if(!dragDraft||next===lastCell)return;
    const path=dragDraft.path;
    if(dragDraft.kind==='bus-trim') {
      if(path.length>1&&next===path[path.length-2]){path.pop();lastCell=next;return;}
      const expected=city.activeBusLine?.route[city.activeBusLine.route.length-path.length-1];
      if(next!==expected){toast('请严格沿公交线路，从末端逐格反向擦除');return;}
      path.push(next);lastCell=next;return;
    }
    if(dragDraft.kind==='bus') {
      const line=city.activeBusLine,origin=line?.route.length?line.route[0]:path[0];
      if(path.length>1&&origin===path[path.length-1])return;
      const current=path[path.length-1];
      if(!city.roads.has(next)||!city.edges.get(current)?.has(next)){toast('公交线路只能沿已有且明确连通的道路绘制');return;}
      path.push(next);lastCell=next;return;
    }
    if(path.length>1&&next===path[path.length-2]){path.pop();lastCell=next;return;}
    if(dragDraft.kind===null) {
      const start=path[0],edge=city.edges.get(start)?.has(next),startRoad=city.roads.has(start),nextRoad=city.roads.has(next);
      const roadEndpoint=startRoad&&city.links(start).length<=1;
      const sameGrade=nextRoad&&(city.roadGrades.get(next)||0)===(city.roadGrades.get(start)||0);
      const buildingErase=city.buildings.has(start)&&city.links(start).length<=1&&edge&&nextRoad;
      dragDraft.kind=buildingErase||(roadEndpoint&&edge&&sameGrade)?'erase':'build';
      if(buildingErase)dragGrade=city.roadGrades.get(next)||0;
    }
    if(dragDraft.kind==='erase') {
      const current=path[path.length-1],edge=city.edges.get(current)?.has(next);
      const nextAllowed=city.buildings.has(next)||(city.roads.has(next)&&(city.roadGrades.get(next)||0)===dragGrade);
      if(!edge||!nextAllowed){toast('拆除必须从端点沿同等级的既有道路拖动');return;}
    }
    path.push(next);lastCell=next;
  }
  function paint(n) {
    if(n===null||lastCell===null)return;
    let {x,y}=point(lastCell);const target=point(n),dx=Math.abs(target.x-x),dy=Math.abs(target.y-y);let ix=0,iy=0;
    while(x!==target.x||y!==target.y){
      if(x!==target.x&&(y===target.y||(ix+.5)/(dx||1)<=(iy+.5)/(dy||1))){x+=Math.sign(target.x-x);ix++;}
      else{y+=Math.sign(target.y-y);iy++;}
      extendDraft(key(x,y));
    }
    draw();
  }
  function commitDrag() {
    if(!dragDraft||dragDraft.path.length<2)return;
    const before=designSnapshot(),{path,kind}=dragDraft;let actions=[];
    if(kind==='bus-trim') {
      const message=city.trimBusRoute(path),line=city.activeBusLine;
      if(message){toast(message);return;}
      recordDesignChange(before);toast(`已擦除尾部 ${path.length-1} 段${line.route.length?'，可继续反向擦除或接着绘制':'，线路已清空并返还车辆预算'}`);
      return;
    }
    if(kind==='bus') {
      const message=city.appendBusRoute(path),line=city.activeBusLine;
      if(message){toast(message);return;}
      recordDesignChange(before);
      const closed=line.route.length>=3&&line.route[0]===line.route[line.route.length-1];
      toast(closed?`公交闭环已完成 · ${line.route.length-1} 段`:line.returnTrip?`已追加线路 · ${line.route.length-1} 段，原路返回可运营`:`已追加线路 · ${line.route.length-1} 段，请从末端继续直至闭环`);
      return;
    }
    if(kind==='build') {
      actions.push(...[...new Set(path)].filter(n=>city.roads.has(n)&&(city.roadGrades.get(n)||0)>dragGrade).map(cell=>({type:'edit',cell,erase:false,grade:dragGrade})));
      for(let i=1;i<path.length;i++) actions.push({type:'connect',a:path[i-1],b:path[i],grade:dragGrade});
    } else if(kind==='cut') for(let i=1;i<path.length;i++) actions.push({type:'cut',a:path[i-1],b:path[i]});
    else if(kind==='erase') {
      const cells=path.filter(n=>city.roads.has(n));
      actions=[...new Set(cells)].map(cell=>({type:'edit',cell,erase:true,grade:0}));
    }
    const message=city.transact(actions);recordDesignChange(before);
    toast(message||(kind==='erase'?'已拆除所经道路，预算已返还':kind==='cut'?'已剪断所经连接':'规划已一次性应用'));
  }
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('wheel',e=>{
    e.preventDefault();const p=eventPoint(e),factor=Math.exp(-e.deltaY*.0015);setZoom(viewZoom*factor,p.x,p.y);draw();
  },{passive:false});
  canvas.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;
    e.preventDefault();canvas.focus({preventScroll:true});canvas.setPointerCapture(e.pointerId);
    const p=eventPoint(e);pointers.set(e.pointerId,p);
    if(pointers.size===2){
      dragging=false;dragDraft=null;lastCell=null;selectionAnchor=null;panLast=null;
      const [a,b]=[...pointers.values()],center={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
      pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),zoom:viewZoom,worldX:(center.x-viewX)/cellSize,worldY:(center.y-viewY)/cellSize};return;
    }
    if(tool==='view'){panLast=p;hover=null;return;}
    keyboardAnchor=null;keyboardMode=false;dragging=true;hover=eventCell(e);if(hover===null)return;
    if(tool==='select'){selectionAnchor=hover;selection={start:hover,end:hover};updateUI();draw();return;}
    if(tool==='bus'){const problem=busDraftProblem(hover);if(problem){dragging=false;toast(problem);return;}}
    lastCell=hover;dragGrade=city.roads.has(hover)?city.roadGrades.get(hover)||0:0;
    dragDraft={kind:tool==='cut'?'cut':tool==='bus'?(busEditMode==='trim'?'bus-trim':'bus'):null,path:[hover]};draw();
  });
  canvas.addEventListener('pointermove',e=>{
    const previous=pointers.get(e.pointerId),p=eventPoint(e);if(previous)pointers.set(e.pointerId,p);
    if(pinch&&pointers.size>=2){
      const [a,b]=[...pointers.values()],center={x:(a.x+b.x)/2,y:(a.y+b.y)/2},distance=Math.hypot(a.x-b.x,a.y-b.y);
      viewZoom=Math.max(1,Math.min(5,pinch.zoom*distance/Math.max(1,pinch.distance)));cellSize=Math.min(viewportWidth/city.width,viewportHeight/city.height)*viewZoom;
      viewX=center.x-pinch.worldX*cellSize;viewY=center.y-pinch.worldY*cellSize;draw();return;
    }
    if(tool==='view'&&panLast&&previous){moveView(p.x-previous.x,p.y-previous.y);panLast=p;draw();return;}
    keyboardMode=false;hover=eventCell(e);if(!dragging||hover===null)return;
    if(tool==='select'){selection={start:selectionAnchor,end:hover};updateUI();draw();}else paint(hover);
  });
  const endPointer=e=>{
    pointers.delete(e.pointerId);
    if(pinch){if(pointers.size<2){pinch=null;panLast=null;snapView();}draw();return;}
    if(tool==='view'){panLast=null;snapView();draw();return;}
    if(dragging&&tool!=='select')commitDrag();
    dragging=false;lastCell=null;dragDraft=null;selectionAnchor=null;updateUI();draw();
  };
  canvas.addEventListener('pointerup',endPointer);canvas.addEventListener('pointercancel',endPointer);canvas.addEventListener('lostpointercapture',e=>{if(pointers.has(e.pointerId))endPointer(e);});
  canvas.addEventListener('pointerleave',()=>{if(!dragging&&tool!=='view')hover=null;});
  $('view-tool').onclick=()=>setTool('view');
  $('select-tool').onclick=()=>setTool('select');
  $('road-tool').onclick=()=>setTool('road');
  $('cut-tool').onclick=()=>setTool('cut');
  $('bus-tool').onclick=()=>{busEditMode='draw';setTool('bus');};
  $('zoom-in').onclick=()=>{setZoom(viewZoom*1.25);draw();};
  $('zoom-out').onclick=()=>{setZoom(viewZoom/1.25);draw();};
  $('zoom-reset').onclick=()=>{resetView();draw();};
  $('bus-line-select').onchange=()=>{busEditMode='draw';toast(city.selectBusLine($('bus-line-select').value));updateUI();draw();};
  $('new-bus-line').onclick=()=>{busEditMode='draw';const message=mutateDesign(()=>city.createBusLine());toast(message||'已新建公交线路，可以分段绘制');updateUI();draw();};
  $('bus-line-name').onchange=()=>{const message=mutateDesign(()=>city.updateBusLine(city.activeBusLineId,{name:$('bus-line-name').value}));toast(message||'线路名称已更新');updateUI();draw();};
  $('bus-line-color').onchange=()=>{const message=mutateDesign(()=>city.updateBusLine(city.activeBusLineId,{color:$('bus-line-color').value}));toast(message||'线路颜色已更新');updateUI();draw();};
  $('bus-count').onchange=()=>{const message=mutateDesign(()=>city.setBusCount(Number($('bus-count').value)));toast(message||`已配置 ${city.busCount} 辆公交车`);updateUI();draw();};
  $('trim-bus').onclick=()=>{
    if(tool==='bus'&&busEditMode==='trim') {
      busEditMode='draw';dragging=false;dragDraft=null;lastCell=null;toast('已取消反向擦除，可以继续绘制线路');
    } else {
      busEditMode='trim';setTool('bus');toast('请从当前线路末端开始，沿线路反向拖动擦除；再次点击或按 Esc 取消');
    }
    updateUI();draw();
  };
  $('bus-return-trip').onchange=()=>{const enabled=$('bus-return-trip').checked,message=mutateDesign(()=>city.updateBusLine(city.activeBusLineId,{returnTrip:enabled}));toast(message||(enabled?'已开启原路返回；返程默认不停站':'已关闭原路返回；运营前须完成闭环'));updateUI();draw();};
  $('redraw-bus').onclick=()=>{const message=mutateDesign(()=>city.setBusRoute([]));if(message){toast(message);return;}busEditMode='draw';setTool('bus');toast('当前线路已清空，请从起点分段绘制');updateUI();draw();};
  $('delete-bus').onclick=()=>{const name=city.activeBusLine?.name,message=mutateDesign(()=>city.deleteBusLine());toast(message||`已删除${name?'「'+name+'」':''}并返还车辆预算`);updateUI();draw();};
  $('signal-enabled').onchange=()=>applySignalSettings({enabled:$('signal-enabled').checked},$('signal-enabled').checked?'已开启红绿灯':'已关闭红绿灯');
  $('signal-yield-mode').onchange=()=>applySignalSettings({yieldMode:$('signal-yield-mode').value},$('signal-yield-mode').value==='priority'?'已启用入口方向优先':'已启用自动让行');
  $('signal-automatic').onchange=()=>applySignalSettings({automatic:$('signal-automatic').checked},$('signal-automatic').checked?'已启用自动信号调度':'已启用手动信号调度');
  $('signal-cycle').onchange=()=>applySignalSettings({green:Number($('signal-cycle').value)},'绿灯周期已更新');
  $('add-signal-phase').onclick=()=>{
    const signal=city.signals.get(inspectedCell);if(!signal)return;
    applySignalSettings({phases:[...signal.phases.map(actions=>[...actions]),['north-straight']]},'已添加信号阶段');
  };
  $('build-road').onclick=()=>{
    const cells=selectedCells();if(cells.length!==1)return;
    const message=mutateDesign(()=>city.transact([{type:'edit',cell:cells[0],erase:false,grade:0}]));
    toast(message||'已建设一格支路；拖拽可建立连接');updateUI();draw();
  };
  $('upgrade-road').onclick=()=>{
    const roads=selectedCells().filter(n=>city.roads.has(n)&&(city.roadGrades.get(n)||0)<ROAD_TYPES.length-1);if(!roads.length)return;
    const message=mutateDesign(()=>city.transact(roads.map(cell=>({type:'edit',cell,erase:false,grade:(city.roadGrades.get(cell)||0)+1}))));
    toast(message||`已升级 ${roads.length} 格道路`);updateUI();draw();
  };
  $('downgrade-road').onclick=()=>{
    const roads=selectedCells().filter(n=>city.roads.has(n)&&(city.roadGrades.get(n)||0)>0);if(!roads.length)return;
    const message=mutateDesign(()=>city.transact(roads.map(cell=>({type:'edit',cell,erase:false,grade:(city.roadGrades.get(cell)||0)-1}))));
    toast(message||`已降级 ${roads.length} 格道路`);updateUI();draw();
  };
  $('remove-road').onclick=()=>{
    const roads=selectedCells().filter(n=>city.roads.has(n));if(!roads.length)return;
    const message=mutateDesign(()=>city.transact(roads.map(cell=>({type:'edit',cell,erase:true,grade:0}))));
    toast(message||`已拆除 ${roads.length} 格道路，建设预算已返还`);updateUI();draw();
  };
  $('undo-design').onclick=()=>restoreDesign(designHistoryIndex-1);
  $('redo-design').onclick=()=>restoreDesign(designHistoryIndex+1);
  $('save-design').onclick=()=>{
    try {
      localStorage.setItem(STORAGE_PREFIX+city.level.id,JSON.stringify(city.serializeDesign()));
      updateDesignControls();toast(`已保存「${city.level.name}」的设计`);
    } catch { toast('无法保存设计，请检查浏览器存储权限'); }
  };
  $('load-design').onclick=()=>{
    if(city.state!=='planning'){toast('请先停止运营，再读取设计');return;}
    const saved=storedDesign();
    if(saved===null){updateDesignControls();toast('当前关卡还没有保存的设计');return;}
    try { pendingDesign=JSON.parse(saved); }
    catch { pendingDesign=null;toast('保存的设计已损坏，无法读取');return; }
    if(city.state==='running')city.toggle();
    updateUI();$('load-dialog').showModal();
  };
  $('cancel-load').onclick=()=>{pendingDesign=null;$('load-dialog').close();};
  $('confirm-load').onclick=()=>{
    const message=city.loadDesign(pendingDesign);pendingDesign=null;$('load-dialog').close();
    if(message){toast(message);return;}
    speed=1;accumulator=0;resultShown=false;inspectedCell=null;resetDesignHistory();updateUI();draw();toast('已读取设计，可以重新规划或开始运营');
  };
  function toggleOperation() {
    const planning=city.state==='planning',message=campaign?campaign.beginDay():city.toggle();
    if(message){toast(message);updateUI();return;}
    if(planning)setTool('view');
    accumulator=0;updateUI();
  }
  $('start').onclick=toggleOperation;
  $('stop').onclick=()=>openPausedDialog($('stop-dialog'));
  $('cancel-stop').onclick=()=>closePausedDialog($('stop-dialog'));
  $('confirm-stop').onclick=()=>{delete $('stop-dialog').dataset.resumeOperation;city.stop();speed=1;accumulator=0;$('stop-dialog').close();updateUI();draw();toast('已停止运营，设计已保留');};
  $('speed').onclick=()=>{speed=SPEED_OPTIONS[(SPEED_OPTIONS.indexOf(speed)+1)%SPEED_OPTIONS.length];updateUI();};
  $('help').onclick=()=>openPausedDialog($('help-dialog'));
  document.querySelector('.dialog-close').onclick=()=>closePausedDialog($('help-dialog'));
  document.querySelector('.dialog-done').onclick=()=>closePausedDialog($('help-dialog'));
  $('reset').onclick=()=>openPausedDialog($('reset-dialog'));
  $('cancel-reset').onclick=()=>closePausedDialog($('reset-dialog'));
  $('confirm-reset').onclick=()=>{delete $('reset-dialog').dataset.resumeOperation;reset();};
  $('play-again').onclick=()=>reset();$('view-city').onclick=()=> $('result-dialog').close();
  $('cancel-level').onclick=()=>{pendingLevel=null;closePausedDialog($('level-dialog'));};
  $('confirm-level').onclick=()=>{delete $('level-dialog').dataset.resumeOperation;if(pendingLevel)reset(pendingLevel);};
  for(const id of ['help-dialog','reset-dialog','level-dialog','stop-dialog']) $(id).addEventListener('cancel',event=>{event.preventDefault();if(id==='level-dialog')pendingLevel=null;closePausedDialog($(id));});
  $('result-dialog').addEventListener('cancel',event=>{if(campaign&&campaign.dayIndex<campaign.days.length-1)event.preventDefault();});
  $('next-level').onclick=()=>{
    if(campaign){campaign.advance(pendingCampaignScore);city=campaign.city;pendingCampaignScore=null;$('result-dialog').close();speed=1;accumulator=0;resultShown=false;arrivalEffects.reset();resetDesignHistory();resetView();configureLevel();setTool('view');updateUI();draw();toast(`第 ${campaign.dayIndex+1} 天已开始规划，昨日收入已到账`);return;}
    const next=levels()[levels().indexOf(city.level)+1];if(next)reset(next.id);
  };
  document.addEventListener('keydown',e=>{
    if(document.querySelector('dialog[open]'))return;
    if (['SELECT', 'INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    const modifier=e.ctrlKey||e.metaKey,keyName=e.key.toLowerCase();
    if(modifier&&keyName==='z'){e.preventDefault();restoreDesign(designHistoryIndex+(e.shiftKey?1:-1));return;}
    if(modifier&&keyName==='y'){e.preventDefault();restoreDesign(designHistoryIndex+1);return;}
    if(modifier||e.altKey)return;
    if(e.key==='1')setTool('view');if(e.key==='2')setTool('select');if(e.key==='3')setTool('road');if(e.key==='4')setTool('cut');if(e.key==='5'){busEditMode='draw';setTool('bus');}
    if(e.key==='Escape'){
      const wasTrimming=tool==='bus'&&busEditMode==='trim',hadDraft=Boolean(dragDraft);
      keyboardAnchor=null;dragging=false;dragDraft=null;lastCell=null;
      if(wasTrimming)busEditMode='draw';
      if(wasTrimming)toast('已取消反向擦除，可以继续绘制线路');
      else if(hadDraft)toast('已取消本次键盘规划');
      updateUI();draw();
    }
    if(e.key.toLowerCase()==='p'){toggleOperation();e.preventDefault();}
    if(document.activeElement!==canvas)return;
    if(tool==='view'){
      if(e.key.startsWith('Arrow')){e.preventDefault();const step=48;moveView(e.key==='ArrowLeft'?step:e.key==='ArrowRight'?-step:0,e.key==='ArrowUp'?step:e.key==='ArrowDown'?-step:0);snapView();draw();}
      if(e.key==='+'||e.key==='='){e.preventDefault();setZoom(viewZoom*1.25);draw();}
      if(e.key==='-'){e.preventDefault();setZoom(viewZoom/1.25);draw();}
      if(e.key==='0'){e.preventDefault();resetView();draw();}
      return;
    }
    let {x,y}=point(keyboardCell);
    if(e.key.startsWith('Arrow')){
      e.preventDefault();keyboardMode=true;
      if(e.key==='ArrowLeft')x--;if(e.key==='ArrowRight')x++;if(e.key==='ArrowUp')y--;if(e.key==='ArrowDown')y++;
      keyboardCell=key(Math.max(0,Math.min(city.width-1,x)),Math.max(0,Math.min(city.height-1,y)));
      if(keyboardAnchor!==null&&keyboardAnchor!==keyboardCell) {
        extendDraft(keyboardCell);keyboardAnchor=lastCell;keyboardCell=lastCell;updateUI();draw();
      }
    }
    if(e.code==='Space'){
      e.preventDefault();if(e.repeat)return;keyboardMode=true;
      if(tool==='road'||tool==='cut'||tool==='bus'){
        if(!dragDraft) {
          if(tool==='bus') {
            const problem=busDraftProblem(keyboardCell);
            if(problem){toast(problem);return;}
          }
          keyboardAnchor=keyboardCell;lastCell=keyboardCell;dragGrade=city.roads.has(keyboardCell)?city.roadGrades.get(keyboardCell)||0:0;
          dragDraft={kind:tool==='cut'?'cut':tool==='bus'?(busEditMode==='trim'?'bus-trim':'bus'):null,path:[keyboardCell]};
          toast(tool==='bus'?(busEditMode==='trim'?'用方向键沿线路反向擦除，空格提交':'用方向键从末端续画，空格提交本段'):'用方向键预览路径，空格一次性提交，Esc 取消');
        } else {
          commitDrag();keyboardAnchor=null;lastCell=null;dragDraft=null;
        }
      } else {
        selection={start:keyboardCell,end:keyboardCell};toast('已选择当前格子，请使用下方区域操作区');
      }
      updateUI();draw();
    }
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&city.state==='running'){city.toggle();accumulator=0;updateUI();}});
  function frame(now) {
    const delta=lastFrame?Math.min((now-lastFrame)/1000,.25):0;lastFrame=now;
    if(viewTarget){const amount=Math.min(1,delta*14);viewX+=(viewTarget.x-viewX)*amount;viewY+=(viewTarget.y-viewY)*amount;if(Math.hypot(viewTarget.x-viewX,viewTarget.y-viewY)<.25){viewX=viewTarget.x;viewY=viewTarget.y;viewTarget=null;}}
    if(city.state==='running') {
      accumulator+=delta*speed;
      while(accumulator>=.05){city.step(.05);accumulator-=.05;}
    } else accumulator=0;
    arrivalEffects.sync(city);arrivalEffects.step(delta);
    updateUI();draw();requestAnimationFrame(frame);
  }
  new ResizeObserver(resize).observe(canvas);
  // Load versioned defaults first, then prefer a valid administrator override.
  async function bootstrap() {
    try {
      const builtInResponse = await fetch('built-in-levels.json', { cache: 'no-store' });
      if (!builtInResponse.ok) throw new Error(`默认关卡请求失败（${builtInResponse.status}）`);
      const builtInCatalog = await builtInResponse.json();
      const builtInMessage = TrafficCore.setLevels(builtInCatalog);
      if (builtInMessage) throw new Error(`默认关卡数据无效：${builtInMessage}`);
      try {
        const overrideResponse = await fetch('levels.json', { cache: 'no-store' });
        if (overrideResponse.ok) {
          const overrideMessage = TrafficCore.setLevels(await overrideResponse.json());
          if (overrideMessage) console.warn('忽略 levels.json：' + overrideMessage);
          else {
            try {
              for(const level of levels()) {
                for(const field of ['name','english','difficulty','title','description','tip','lesson']) if(typeof level[field]!=='string'||!level[field].trim()) throw new Error(`关卡 ${level.id} 缺少 ${field}`);
                if(!level.features||!Array.isArray(level.routes)||!Number.isFinite(level.budget)||!Number.isFinite(level.duration)||!Number.isFinite(level.target)) throw new Error(`关卡 ${level.id} 缺少运行参数`);
                new City(level.id);if(level.campaign)new CampaignSession(level.id);
              }
            } catch(error) {
              TrafficCore.setLevels(builtInCatalog);
              console.warn('忽略 levels.json：' + error.message);
            }
          }
        } else if (overrideResponse.status !== 404) console.warn(`忽略 levels.json：请求失败（${overrideResponse.status}）`);
      } catch (error) { TrafficCore.setLevels(builtInCatalog);console.warn('忽略 levels.json：' + error.message); }
      city = new City(TrafficCore.LEVELS[0].id);
      resetDesignHistory();
      buildLevelButtons();
      configureLevel();resize();setTool('view');updateUI();requestAnimationFrame(frame);
    } catch (error) {
      console.error(error);
      $('toast').textContent = '关卡数据加载失败，请确认游戏服务正常运行后刷新页面。';
      $('toast').classList.add('visible');
    }
  }
  bootstrap();
})();
