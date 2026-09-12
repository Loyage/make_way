(() => {
  'use strict';
  const { City, CampaignSession, ROAD_TYPES, VEHICLE_WIDTH, VEHICLE_LENGTH, BUS_WIDTH, BUS_LENGTH, BUS_CAPACITY, BUS_COST, LANE_WIDTH, SIGNAL_ACTIONS, WIDTH, HEIGHT } = TrafficCore;
  const ProgressStorage = TrafficGameStorage, Tutorial = TrafficGameTutorial, Navigation = TrafficGameNavigation;
  const SIGNAL_ENTRY_NAMES={north:'北侧入口',east:'东侧入口',south:'南侧入口',west:'西侧入口'};
  const SIGNAL_TURN_NAMES={straight:'直行',left:'左转'};
  const PLAYER_SPEED_OPTIONS=[.5,1,2,4],ADMIN_SPEED_OPTIONS=[.5,1,2,4,Infinity],ROUTE_SYMBOLS=['●','◆','▲','■','✦','⬟'];
  const $ = id => document.getElementById(id);
  const canvas = $('map'), ctx = canvas.getContext('2d');
  const adminMode=document.body.classList.contains('admin-page');
  const chapters=()=>TrafficCore.CHAPTERS.filter(chapter=>adminMode||!chapter.hidden);
  const levels=()=>chapters().flatMap(chapter=>chapter.levels);
  let city = null, tool = 'view', speed = 1, hover = null, dragging = false, gameMode = 'challenge';
  let keyboardAnchor = null;
  let lastCell = null, dragGrade = 0, dragDraft = null, selection = null, routeSelection = null, selectionAnchor = null;
  let pendingRoadOperation = null;
  let cellSize = 40, lastFrame = 0, accumulator = 0, viewportWidth = 0, viewportHeight = 0;
  let viewZoom = 1, viewX = 0, viewY = 0, viewTarget = null, panLast = null, pinch = null, viewReady = false;
  const pointers = new Map();
  const key = (x,y) => TrafficCore.key(x,y,city?.width||WIDTH);
  const point = n => TrafficCore.point(n,city?.width||WIDTH);
  const { rounded, line, circle, label, buildingBubble, busSegment, strokeBusConnector, drawBusRoute } = TrafficCanvas.createCanvasTools(ctx, point);
  let toastTimer, resultShown = false, keyboardCell = key(1, 2), keyboardMode = false;
  let connectionRows = [], pendingLevel = null, pendingMode = null, inspectedCell = null;
  let pendingDesign = null, dimmedBusLines = new Set(), busEditMode = 'draw', challengeReturn = null;
  let campaign = null, pendingCampaignScore = null, pendingRegionId = null;
  let pendingRestore = null, autoSaveSuspended = true, lastAutoSaveSignature = '';
  let tutorialUsedRoad = false, tutorialInspected = false, tutorialStarted = false, tutorialForced = false, activeGuide = null, activeGuideLevelId = null, tutorialCompleted = false, tutorialSeenIds = [];
  let designHistory = [], designHistoryIndex = -1, previewSignalPhaseIndex = 0, startedLevelIds = new Set(), recentLevelId = null;
  let celebratedDelivered = 0, connectedRoutes = new Set();
  let hintCity = null, hintSignature = '', planningHints = [], resultReplay = null;
  const arrivalEffects = TrafficEffects.createArrivalEffects(),drawResidentMood=TrafficEffects.drawResidentMood;
  const STORAGE_PREFIX = 'traffic-game-design-v1:';
  const REFERENCE_UNLOCK_PREFIX = 'traffic-game-reference-unlocked-v1:';
  const PERSONAL_BEST_PREFIX = 'traffic-game-personal-best-v1:';
  const STAR_PREFIX = 'traffic-game-stars-v1:';
  const TUTORIAL_DONE_KEY='traffic-game-tutorial-v1',TUTORIAL_SEEN_KEY='traffic-game-tutorial-seen-v1',STARTED_LEVELS_KEY='traffic-game-started-v1';
  const failedLevels = new Set();
  const speedOptions=()=>adminMode&&!city?.sandbox?ADMIN_SPEED_OPTIONS:PLAYER_SPEED_OPTIONS;
  const speedLabel=value=>value===Infinity?'∞':String(value);
  function storedDesign(levelId = city.level.id) {
    try { return localStorage.getItem(STORAGE_PREFIX + levelId); }
    catch { return null; }
  }
  function loadStartedLevels(){try{const ids=JSON.parse(localStorage.getItem(STARTED_LEVELS_KEY)||'[]');startedLevelIds=new Set(Array.isArray(ids)?ids.filter(id=>levels().some(level=>level.id===id)):[]);}catch{startedLevelIds=new Set();}}
  function markLevelStarted(levelId=city.level.id){recentLevelId=levelId;if(adminMode||startedLevelIds.has(levelId))return;startedLevelIds.add(levelId);try{localStorage.setItem(STARTED_LEVELS_KEY,JSON.stringify([...startedLevelIds]));}catch{/* progress labels remain optional */}if(levelButtons.length)showChapter(visibleChapterIndex);}
  function dismissPendingRestore() {
    pendingRestore=null;$('continue-game').hidden=true;autoSaveSuspended=false;
  }
  function autoSaveSignature() {
    return JSON.stringify([gameMode,city.level.id,campaign?.dayIndex??null,city.unlimitedBudget?'unlimited':city.budget,city.demandMultiplier,city.continuousDemand,campaign?.results||[],campaign?.checkpoints||[],campaign?[...campaign.unlockedRegionIds]:[],campaign?.regionSpent||0,designHistory[designHistoryIndex]||designSnapshot()]);
  }
  function saveAutoProgress() {
    if(adminMode||autoSaveSuspended||city?.state!=='planning'||gameMode==='sandbox'&&challengeReturn)return;
    const signature=autoSaveSignature();if(signature===lastAutoSaveSignature)return;
    const snapshot=ProgressStorage.createSnapshot(city,campaign,gameMode),message=ProgressStorage.write(localStorage,snapshot);
    lastAutoSaveSignature=signature;if(message)toast(message);
  }
  function loadTutorialState(){
    try{tutorialCompleted=localStorage.getItem(TUTORIAL_DONE_KEY)==='1';const seen=JSON.parse(localStorage.getItem(TUTORIAL_SEEN_KEY)||'[]');tutorialSeenIds=Array.isArray(seen)?[...new Set(seen.filter(id=>Tutorial.mechanic(id)))]:[];}
    catch{tutorialCompleted=false;tutorialSeenIds=[];}
  }
  function tutorialDone(){return tutorialCompleted;}
  function tutorialSeen(){return tutorialSeenIds;}
  function storeTutorialDone(){tutorialCompleted=true;try{localStorage.setItem(TUTORIAL_DONE_KEY,'1');}catch{/* onboarding remains optional */}}
  function storeMechanicSeen(id){tutorialSeenIds=[...new Set([...tutorialSeenIds,id])];try{localStorage.setItem(TUTORIAL_SEEN_KEY,JSON.stringify(tutorialSeenIds));}catch{/* onboarding remains optional */}}
  function renderContextGuide(){
    const panel=$('context-guide');if(adminMode||!city){panel.hidden=true;return;}
    let guide=!tutorialForced&&!activeGuide?.number&&activeGuideLevelId===city.level.id?activeGuide:null;
    if(!guide&&(tutorialForced||!tutorialDone())&&city.level.id===Tutorial.FIRST_LEVEL_ID){
      guide=Tutorial.firstStep({levelId:city.level.id,usedRoad:tutorialUsedRoad,connected:city.routes.every((route,index)=>city.routeConnected(index)),inspected:tutorialInspected,started:tutorialStarted});
      if(!guide){storeTutorialDone();tutorialForced=false;}
    }
    if(!guide){
      const mechanic=tutorialForced?Tutorial.currentMechanic(city.level):Tutorial.unseenMechanic(city.level,tutorialSeen());
      if(mechanic){if(!tutorialForced)storeMechanicSeen(mechanic.id);guide={...mechanic,number:null,total:null,action:mechanic.id,actionLabel:mechanic.id==='bus'?'定位公交工具':mechanic.id==='cut'?'定位剪刀工具':'定位选择工具'};}
    }
    activeGuide=guide;activeGuideLevelId=guide?city.level.id:null;panel.hidden=!guide;if(!guide)return;
    $('context-guide-step').textContent=guide.number?`操作引导 ${guide.number} / ${guide.total}`:'新机制提示';
    $('context-guide-title').textContent=guide.title;$('context-guide-text').textContent=guide.text;$('context-guide-action').textContent=guide.actionLabel;
  }
  function referenceKey(levelId=city.level.id,dayIndex=campaign?.dayIndex??null){return levelId+(dayIndex===null?'':`:day-${dayIndex+1}`);}
  function currentReference(){return campaign?campaign.days[campaign.dayIndex]?.referenceDesign:city.level.referenceDesign;}
  function referenceUnlocked(levelId=city.level.id,dayIndex=campaign?.dayIndex??null) {
    const keyName=referenceKey(levelId,dayIndex);
    if(failedLevels.has(keyName))return true;
    try { return localStorage.getItem(REFERENCE_UNLOCK_PREFIX+keyName)==='1'; }
    catch { return false; }
  }
  function unlockReference(levelId=city.level.id,dayIndex=campaign?.dayIndex??null) {
    const keyName=referenceKey(levelId,dayIndex);failedLevels.add(keyName);
    try { localStorage.setItem(REFERENCE_UNLOCK_PREFIX+keyName,'1'); } catch { /* session unlock still works */ }
  }
  let designAvailable = false;
  function updateDesignControls() {
    designAvailable=storedDesign()!==null;
    $('load-design').disabled=city.state!=='planning'||!designAvailable;
    const available=Boolean(currentReference())&&referenceUnlocked();
    $('reference-design').hidden=!available;
    $('reference-design').disabled=city.state!=='planning';
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
    dismissPendingRestore();
    if(designHistory[designHistoryIndex]!==before)designHistory[designHistoryIndex]=before;
    designHistory=designHistory.slice(0,designHistoryIndex+1);designHistory.push(after);
    if(designHistory.length>61)designHistory.shift();
    designHistoryIndex=designHistory.length-1;markLevelStarted();updateHistoryControls();return true;
  }
  function mutateDesign(action) { const before=designSnapshot(),message=action();recordDesignChange(before);return message; }
  function replayAnimation(element,className) {
    element.classList.remove(className);void element.offsetWidth;element.classList.add(className);
    setTimeout(()=>element.classList.remove(className),900);
  }
  function celebrateProgress() {
    const milestones=TrafficEffects.crossedProgressMilestones(celebratedDelivered,city.delivered,city.target);celebratedDelivered=city.delivered;
    if(!milestones.length||!['running','won'].includes(city.state))return;
    const percent=milestones[milestones.length-1],messages={25:'首批居民顺利抵达！',50:'已送达过半，路网运转得不错！',75:'只差最后一段，坚持住！'};
    replayAnimation($('delivered').closest('.stat'),'reward-pulse');replayAnimation($('progress'),'reward-pulse');toast(`${messages[percent]} · ${percent}%`);
  }
  function restoreDesign(index) {
    if(city.state!=='planning'){toast('运营期间不能撤销规划，请先停止运营');return;}
    if(index<0||index>=designHistory.length)return;
    const previous=designHistoryIndex,message=city.loadDesign(JSON.parse(designHistory[index]));if(message){toast(message);return;}
    designHistoryIndex=index;dragging=false;lastCell=null;dragDraft=null;routeSelection=null;keyboardAnchor=null;busEditMode='draw';inspectedCell=null;
    updateHistoryControls();updateUI();draw();toast(index<previous?'已撤销上一步规划':'已重做下一步规划');
  }
  function storedStars(level, dayIndex=null) {
    const keyName=STAR_PREFIX+level.id+(dayIndex===null?'':`:day-${dayIndex+1}`);
    try { const earned=JSON.parse(localStorage.getItem(keyName)||'[]');if(Array.isArray(earned))return [...new Set(earned.filter(id=>['completion','satisfaction','efficiency'].includes(id)))];localStorage.removeItem(keyName);return []; }
    catch { try{localStorage.removeItem(keyName);}catch{/* storage remains optional */}return []; }
  }
  function starTargetsFor(level, dayIndex=null) {
    const configured=dayIndex===null?level.starTargets:level.campaign?.days[dayIndex]?.starTargets||level.starTargets;
    if(configured)return configured;
    const routes=level.campaign?.routes||level.routes||[],population=routes.reduce((sum,route)=>sum+(route.homes||[]).reduce((total,home)=>total+(home.passengers||0),0),0);
    return {satisfaction:80,efficiency:{maxCost:level.budget,maxQueue:population}};
  }
  function levelProgress(level){
    const rows=level.campaign?level.campaign.days.map((_,index)=>storedStars(level,index)):[storedStars(level)];
    return Navigation.levelProgress(level,startedLevelIds.has(level.id)||storedDesign(level.id)!==null||pendingRestore?.city.level.id===level.id,rows);
  }
  function allLevelProgress(){return Object.fromEntries(levels().map(level=>[level.id,levelProgress(level)]));}
  function recommendedLevel(){return Navigation.recommendedLevel(levels(),allLevelProgress(),recentLevelId||pendingRestore?.city.level.id||city?.level.id);}
  let levelButtons = [], chapterButtons = [], visibleChapterIndex = 0;
  function showChapter(chapterIndex) {
    const chapter=chapters()[chapterIndex];if(!chapter)return;
    visibleChapterIndex=chapterIndex;
    chapterButtons.forEach((button,i)=>{const item=chapters()[i],summary=Navigation.chapterProgress(item,allLevelProgress());button.querySelector('small').textContent=`${item.english} · ${summary.completed}/${summary.total} 关 · ★ ${summary.stars}/${summary.totalStars}`;button.setAttribute('aria-label',`${item.name}，已通关 ${summary.completed} / ${summary.total} 关，获得 ${summary.stars} / ${summary.totalStars} 星`);button.classList.toggle('selected',i===chapterIndex);button.setAttribute('aria-pressed',String(i===chapterIndex));});
    const list=$('level-list');list.replaceChildren();levelButtons=[];
    for(const level of chapter.levels) {
      const i=levels().indexOf(level),button=document.createElement('button');button.className='level-card';button.dataset.levelId=level.id;
      const number=document.createElement('span');number.className='level-number';number.textContent=String(i+1).padStart(2,'0');
      const name=document.createElement('strong');name.textContent=level.name;
      const detail=document.createElement('small');detail.textContent=`${level.difficulty} · ${level.lesson}`;
      const progress=levelProgress(level),status=document.createElement('span');status.className=`level-status ${progress.status}`;status.textContent=progress.status==='completed'?'已通关':progress.status==='in-progress'?'进行中':'未开始';
      const stars=document.createElement('span');stars.className='level-stars';stars.setAttribute('aria-label',`已获得 ${progress.stars} / ${progress.totalStars} 星`);stars.textContent=`★ ${progress.stars}/${progress.totalStars}`;
      button.classList.toggle('recommended',recommendedLevel()?.id===level.id);button.append(number,name,detail,status,stars);button.onclick=()=>requestLevel(level.id);list.append(button);levelButtons.push(button);
    }
    $('level-summary').textContent=`当前：${city.level.name}`;
    levelButtons.forEach(button=>{const selected=button.dataset.levelId===city.level.id;button.classList.toggle('selected',selected);button.setAttribute('aria-current',selected?'true':'false');});
  }
  function buildLevelButtons() {
    const list=$('chapter-list');list.replaceChildren();chapterButtons=[];
    for(const [chapterIndex,chapter] of chapters().entries()) {
      const button=document.createElement('button');button.className='chapter-tab';button.setAttribute('aria-pressed','false');
      const number=document.createElement('span');number.textContent=String(chapterIndex+1).padStart(2,'0');
      const name=document.createElement('strong');name.textContent=chapter.name;
      const summary=Navigation.chapterProgress(chapter,allLevelProgress()),english=document.createElement('small');english.textContent=`${chapter.english} · ${summary.completed}/${summary.total} 关 · ★ ${summary.stars}/${summary.totalStars}`;
      button.append(number,name,english);button.setAttribute('aria-label',`${chapter.name}，已通关 ${summary.completed} / ${summary.total} 关，获得 ${summary.stars} / ${summary.totalStars} 星`);button.onclick=()=>showChapter(chapterIndex);list.append(button);chapterButtons.push(button);
    }
    const focusId=pendingRestore?.city.level.id||city.level.id,current=chapters().findIndex(chapter=>chapter.levels.some(level=>level.id===focusId));showChapter(Math.max(0,current));
  }
  function renderCampaignProgress() {
    const panel=$('campaign-progress');panel.hidden=!campaign;$('legend-site').hidden=!campaign;$('legend-region').hidden=!campaign||!city.lockedRegions.size;
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
        city=campaign.city;speed=1;accumulator=0;resultShown=false;pendingCampaignScore=null;arrivalEffects.reset();resetDesignHistory();focusInitialView();configureLevel();setTool('view');updateUI();draw();toast(`已回到第 ${index+1} 天运营前`);
      };
      button.append(title,detail);list.append(button);
    });
  }
  function configureLevel() {
    const level = city.level, index = levels().indexOf(level);
    const sandbox=gameMode==='sandbox';
    $('challenge-mode').classList.toggle('active',!sandbox);$('challenge-mode').setAttribute('aria-pressed',String(!sandbox));
    $('sandbox-mode').classList.toggle('active',sandbox);$('sandbox-mode').setAttribute('aria-pressed',String(sandbox));
    document.body.classList.toggle('sandbox-mode',sandbox);
    const chapterIndex=chapters().findIndex(chapter=>chapter.levels.some(item=>item.id===level.id)),chapter=chapters()[chapterIndex];
    const number = String(index + 1).padStart(2, '0');
    $('level-eyebrow').textContent = `城市实验室 / 第 ${chapterIndex+1} 章 · 第 ${number} 课`;
    $('chapter-number').textContent = String(chapterIndex+1).padStart(2,'0');
    $('chapter-name').textContent = chapter?.name||level.english;
    $('map-name').textContent = level.name;
    $('level-summary').textContent = `当前：${level.name}`;
    if ($('level-picker').contains(document.activeElement)) $('level-picker').querySelector('summary').focus();
    $('level-picker').open = false;
    document.querySelector('.map-size').textContent = `${city.width} × ${city.height}`;
    const population=city.target;
    $('target-label').textContent = '全部居民';
    $('target-unit').textContent = `/ ${population} 人`;
    $('mission-title').textContent = level.title;
    $('mission-description').textContent = sandbox?`沙盒模式不限时间。开始运营后仍可建设、连接、剪断、调整道路等级、道路引导和信号灯，方便观察路网变化；公交规划须停止运营后修改。`:campaign?`第 ${campaign.dayIndex+1} 天：在 ${city.duration} 秒内将全部 ${population} 位居民运抵目的地。当日总人口送达比例与满意度共同决定收入，结算后可改造路网。`:`在 ${city.duration} 秒内将全部 ${population} 位居民运抵目的地，建设与公交预算共 ${city.budget} 点。${level.description}`;
    $('mission-tip-meta').textContent = sandbox?`沙盒实验 · 沿用本关 ${city.budget} 点预算`:campaign?`${campaign.days.length} 日运营 · 当日最高收入 ${campaign.days[campaign.dayIndex].maxIncome} 点`:`第 ${number} 课 · ${level.lesson}`;
    $('mission-tip').textContent = sandbox?'已占用或被车辆预约的道路仍受拆除与降级保护；停止运营会保留设计并清空本轮交通。':level.tip;
    const starGoals=$('star-goals'),starTargets=starTargetsFor(level,campaign?campaign.dayIndex:null),earned=storedStars(level,campaign?campaign.dayIndex:null);starGoals.replaceChildren();starGoals.hidden=sandbox||!starTargets;
    if(!starGoals.hidden)for(const goal of TrafficResults.starReport(starTargets,{}).goals){const row=document.createElement('p');row.className=earned.includes(goal.id)?'earned':'';row.textContent=`${earned.includes(goal.id)?'★':'☆'} ${goal.label}`;starGoals.append(row);}
    const demand = $('demand-list');demand.replaceChildren();
    for (const [routeIndex,r] of city.routes.entries()) {
      const row = document.createElement('li'),routeHomes=city.homes.filter(home=>home.route===routeIndex);
      const homes = r.homes.map((h,index) => `住宅 (${point(h.cell).x + 1},${point(h.cell).y + 1}) 共 ${h.passengers} 人 · 产生 ${routeHomes[index].generationRate} 人/s · 汽车出口由门口道路等级决定`);
      const goals = r.goals.map(g => `目的地 (${point(g.cell).x + 1},${point(g.cell).y + 1}) · ${g.label}${g.input != null ? ` 输入 ${g.input} 人` : ''}`);
      row.textContent = `${r.name}：${[...homes, ...goals].join('；')}`;
      demand.append(row);
    }
    $('sandbox-controls').hidden=!sandbox;
    if(sandbox){$('sandbox-budget').value=city.unlimitedBudget?'unlimited':'level';$('sandbox-demand').value=String(city.demandMultiplier);$('sandbox-speed').value=String(speed);$('sandbox-continuous').checked=city.continuousDemand;}
    $('load-setting').hidden = !level.features.load;
    $('cut-tool').hidden = !level.features.cut;
    $('bus-tool').hidden = !level.features.bus;
    $('bus-controls').hidden = !level.features.bus;
    $('legend-bus').hidden = !level.features.bus;
    $('show-load').checked = false;
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
    celebratedDelivered=city.delivered;connectedRoutes=new Set(city.routes.map((route,index)=>city.routeConnected(index)?index:null).filter(index=>index!==null));
    updateDesignControls();renderCampaignProgress();buildAccessibleMap();renderContextGuide();
  }
  function accessibleCellLabel(cell) {
    const p=point(cell),homeIndex=city.homes.findIndex(home=>home.cell===cell),goalIndex=city.goals.findIndex(goal=>goal.cell===cell),site=city.pendingBuildings.get(cell),dormant=city.dormantBuildings.get(cell),region=city.lockedRegions.get(cell),directions={[-city.width]:'北',[1]:'东',[city.width]:'南',[-1]:'西'};
    let content=region?`待开放区域「${region.name}」，${region.available?`可支付 ${region.cost} 点开放`:'开放任务尚未完成'}`:city.roads.has(cell)?`${city.roadType(cell).name}，连接 ${city.links(cell).map(next=>directions[next-cell]).filter(Boolean).join('、')||'无'}`:homeIndex>=0?`住宅，总人口 ${city.homes[homeIndex].passengers}，等待 ${city.queues[homeIndex]}`:goalIndex>=0?`目的地，已抵达 ${city.byGoal[goalIndex]}`:dormant?`${dormant.kind==='home'?'住宅人口':'目的地容量'}锁定，等待同色建筑启用`:site?`${site.kind==='home'?'住宅':'目的地'}建设用地，${campaignConditionText(site)}`:city.water.has(cell)?'水面':city.trees.has(cell)?'绿地':city.bridges.has(cell)?'空桥':'空地';
    if(city.roads.has(cell)){const policy=city.roadPolicies.get(cell);if(policy)content+=policy==='prefer'?'，汽车偏好':'，汽车禁行';content+=`，占用或驶入 ${city.load(cell).total} 辆`;}
    return `第 ${p.y+1} 行第 ${p.x+1} 列，${content}${planningHints.filter(issue=>issue.cells?.includes(cell)).map(issue=>`，提示：${issue.title}`).join('')}${routeSelection?.includes(cell)||selection?.start===cell&&selection?.end===cell?'，已选择':''}`;
  }
  function buildAccessibleMap(){
    const grid=$('accessible-map');if(!city||grid.dataset.level===`${city.level.id}:${city.width}:${city.height}`)return;
    grid.dataset.level=`${city.level.id}:${city.width}:${city.height}`;grid.replaceChildren();grid.setAttribute('aria-rowcount',String(city.height));grid.setAttribute('aria-colcount',String(city.width));
    for(let cell=0;cell<city.width*city.height;cell++){const button=document.createElement('button');button.type='button';button.setAttribute('role','gridcell');button.dataset.cell=String(cell);button.onclick=()=>{setTool('select');selectSingleCell(cell);keyboardCell=cell;keyboardMode=true;updateUI();draw();};button.onkeydown=event=>{if(!event.key.startsWith('Arrow'))return;event.preventDefault();const p=point(cell),x=Math.max(0,Math.min(city.width-1,p.x+(event.key==='ArrowLeft'?-1:event.key==='ArrowRight'?1:0))),y=Math.max(0,Math.min(city.height-1,p.y+(event.key==='ArrowUp'?-1:event.key==='ArrowDown'?1:0))),next=grid.querySelector(`[data-cell="${key(x,y)}"]`);next?.focus();next?.click();};grid.append(button);}
  }
  function updateAccessibleMap(){
    const grid=$('accessible-map'),signature=`${city.state}:${Math.floor(city.elapsed*2)}:${city.cars.length}:${city.buses.reduce((sum,bus)=>sum+bus.passengers.length,0)}:${city.queues.join(',')}:${designHistory[designHistoryIndex]||''}:${selection?.start}:${selection?.end}:${routeSelection?.join(',')||''}`;
    if(grid.dataset.signature===signature)return;grid.dataset.signature=signature;
    for(const button of grid.children){const cell=Number(button.dataset.cell);button.setAttribute('aria-label',accessibleCellLabel(cell));button.tabIndex=-1;}
  }
  function requestLevel(id) {
    if (id === city.level.id) {
      $('level-picker').querySelector('summary').focus();
      $('level-picker').open = false;
      return;
    }
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
  function announceCell(cell){if(cell!==null)$('map-accessible-status').textContent=accessibleCellLabel(cell);}
  function showTouchCoordinate(cell,visible){const badge=$('touch-coordinate');badge.hidden=!visible||cell===null;if(!badge.hidden){const p=point(cell);badge.textContent=`${p.x+1}, ${p.y+1}`;}}
  function toast(text) {
    if (!text) return;
    $('toast').textContent = text; $('toast').classList.add('visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 2200);
  }
  function setTool(value) {
    if (!['view','select'].includes(value) && (value==='bus'?city.state!=='planning':!city.canEditDesign())) {
      toast(city.sandbox&&value==='bus'?'沙盒运营时可实时改路和信号；公交规划请先停止运营':'运营期间只能观察或查看路况，请先停止运营再修改规划'); return;
    }
    if (value === 'cut' && !city.level.features.cut) {
      toast('剪刀工具在本关未开放'); return;
    }
    if (value === 'bus' && !city.level.features.bus) {
      toast('公交线路在本关未开放'); return;
    }
    tool = value;if(value==='road')tutorialUsedRoad=true;if(value!=='bus')busEditMode='draw';if(value!=='select')routeSelection=null;keyboardAnchor=null;dragging=false;lastCell=null;dragDraft=null;selectionAnchor=null;panLast=null;
    $('road-inspector').hidden=tool!=='select';$('bus-controls').classList.toggle('drawer-open',tool==='bus');
    for (const name of ['view', 'select', 'road', 'cut', 'bus']) {
      $(name + '-tool').classList.toggle('active', name === tool);
      $(name + '-tool').setAttribute('aria-pressed', String(name === tool));
    }
    canvas.classList.toggle('view-mode',tool==='view');renderContextGuide();
    draw();
  }
  function selectedCells() {
    if(routeSelection)return [...routeSelection];
    if (!selection) return [];
    const a=point(selection.start),b=point(selection.end),cells=[];
    for(let y=Math.min(a.y,b.y);y<=Math.max(a.y,b.y);y++) for(let x=Math.min(a.x,b.x);x<=Math.max(a.x,b.x);x++) cells.push(key(x,y));
    return cells;
  }
  function roadNeighbors(cell) { return city.links(cell).filter(next=>city.roads.has(next)); }
  function roadSegment(cell) {
    if(!city.roads.has(cell)||roadNeighbors(cell).length>=3)return [];
    const segment=new Set([cell]);
    for(const first of roadNeighbors(cell)) {
      let previous=cell,current=first;
      while(!segment.has(current)) {
        const neighbors=roadNeighbors(current);
        if(neighbors.length>=3)break;
        segment.add(current);
        const next=neighbors.find(item=>item!==previous);
        if(next===undefined)break;
        previous=current;current=next;
      }
    }
    return [...segment];
  }
  function selectSingleCell(cell) { routeSelection=null;selection={start:cell,end:cell};if(city.level.id===Tutorial.FIRST_LEVEL_ID&&city.homes.some(home=>home.cell===cell)){tutorialInspected=true;renderContextGuide();} }
  function operationRoads(kind,cells=selectedCells()) {
    return cells.filter(cell=>city.roads.has(cell)&&(kind==='upgrade'?(city.roadGrades.get(cell)||0)<ROAD_TYPES.length-1:kind==='downgrade'?(city.roadGrades.get(cell)||0)>0:true));
  }
  function operationSummary(kind,cells) {
    const roads=operationRoads(kind,cells),amount=roads.reduce((sum,cell)=>sum+(kind==='remove'?city.roadType(cell).cost:1),0);
    if(kind==='upgrade')return `将整段道路中的 ${roads.length} 格各升级一级，预计消耗 ${amount} 点建设预算。`;
    if(kind==='downgrade')return `将整段道路中的 ${roads.length} 格各降级一级，预计返还 ${amount} 点建设预算。`;
    return `将拆除整段道路中的 ${roads.length} 格，预计返还 ${amount} 点建设预算。此操作会删除这些格的全部连接。`;
  }
  function applyRoadOperation(kind,cells=selectedCells()) {
    const roads=operationRoads(kind,cells);if(!roads.length)return;
    const actions=roads.map(cell=>kind==='remove'?{type:'edit',cell,erase:true,grade:0}:{type:'edit',cell,erase:false,grade:(city.roadGrades.get(cell)||0)+(kind==='upgrade'?1:-1)});
    const message=mutateDesign(()=>city.transact(actions));
    toast(message||(kind==='upgrade'?`已升级 ${roads.length} 格道路`:kind==='downgrade'?`已降级 ${roads.length} 格道路`:`已拆除 ${roads.length} 格道路，建设预算已返还`));updateUI();draw();
  }
  function requestRoadOperation(kind) {
    const cells=selectedCells(),roads=operationRoads(kind,cells);if(!roads.length)return;
    if(!routeSelection){applyRoadOperation(kind,cells);return;}
    pendingRoadOperation={kind,cells:[...cells]};
    $('road-operation-title').textContent={upgrade:'确认升级整段道路？',downgrade:'确认降级整段道路？',remove:'确认拆除整段道路？'}[kind];
    $('road-operation-description').textContent=operationSummary(kind,cells);
    $('confirm-road-operation').textContent=kind==='remove'?'确认拆除':'确认施工';
    $('road-operation-dialog').showModal();
  }
  function dragGradeChanges() {
    if(dragDraft?.kind!=='build'||dragDraft.sourceGrade===null)return [];
    return [...new Set(dragDraft.path)].filter((cell,index)=>index>0&&city.roads.has(cell)&&(city.roadGrades.get(cell)||0)!==dragDraft.sourceGrade).map(cell=>({cell,from:city.roadGrades.get(cell)||0,to:dragDraft.sourceGrade}));
  }
  function dragNewRoads() {
    if(dragDraft?.kind!=='build'||dragDraft.sourceGrade===null)return [];
    return [...new Set(dragDraft.path)].filter((cell,index)=>index>0&&!city.roads.has(cell)&&!city.buildings.has(cell)&&!city.pendingBuildings.has(cell)&&!city.dormantBuildings.has(cell)&&!city.lockedRegions.has(cell)&&!city.trees.has(cell)&&(!city.water.has(cell)||city.bridges.has(cell)));
  }
  function updateDragIntent() {
    const panel=$('drag-intent'),changes=dragGradeChanges(),newRoads=dragNewRoads();panel.hidden=!changes.length&&!newRoads.length;
    panel.className='drag-intent';if(panel.hidden)return;
    const upgrades=changes.filter(change=>change.to>change.from).length,downgrades=changes.length-upgrades,parts=[];
    if(newRoads.length)parts.push(`新建 ${newRoads.length} 格`);if(upgrades)parts.push(`升级 ${upgrades} 格`);if(downgrades)parts.push(`降级 ${downgrades} 格`);
    panel.classList.add(downgrades&&(upgrades||newRoads.length)?'mixed':downgrades?'downgrade':'upgrade');
    panel.textContent=`松手后${parts.join('，')}，统一为${ROAD_TYPES[dragDraft.sourceGrade].name}`;
  }
  function selectedHomeTravelInfo() {
    const cells=selectedCells();if(tool!=='select'||cells.length!==1)return null;
    const homeIndex=city.homes.findIndex(home=>home.cell===cells[0]);
    return homeIndex<0?null:city.homeTravelInfo(homeIndex);
  }
  function openRegionDialog(region) {
    if(!campaign||!region||city.state!=='planning')return;
    pendingRegionId=region.id;
    $('region-dialog-title').textContent=`开放「${region.name}」？`;
    $('region-dialog-description').textContent=region.available
      ? `将支付 ${region.cost} 点建设点，开放 ${region.cells.length} 格地图。区域开放后，已满足自身条件的住宅和目的地才会启用；缺少同色对应建筑时，其人口或容量继续锁定且不计入满意度。`
      : `开放任务尚未完成。${campaignConditionText({condition:region.unlock})}`;
    $('confirm-region').disabled=!region.available||city.remaining<region.cost;
    $('confirm-region').textContent=region.available&&city.remaining<region.cost?`还差 ${region.cost-city.remaining} 点`:`支付 ${region.cost} 点并开放`;
    $('region-dialog').showModal();
  }
  function campaignConditionText(site) {
    const condition=site.condition||{},results=campaign?.results||[],day=campaign?campaign.dayIndex+1:1;
    const delivered=results.reduce((sum,result)=>sum+result.delivered,0),income=results.reduce((sum,result)=>sum+result.income,0),satisfaction=results.length?results.at(-1).satisfaction:null,parts=[];
    if(condition.day)parts.push(`日期达到第 ${condition.day} 天（当前第 ${day} 天）`);
    if(condition.delivered)parts.push(`累计送达 ${delivered} / ${condition.delivered} 人`);
    if(condition.income)parts.push(`累计收入 ${income} / ${condition.income} 点`);
    if(condition.satisfaction)parts.push(`上一日满意度 ${satisfaction===null?'尚无':satisfaction+'%'} / ${condition.satisfaction}%`);
    return `解锁条件${parts.length>1?'（需全部满足）':''}：${parts.join(' · ')||'下一日结算后确认'}`;
  }
  function removeSelectedRoads() { requestRoadOperation('remove'); }
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
      const stopStats=line.stats?.stops?.[cell],waiting=city.busStopDemand(cell,line.id),forecast=city.busStopForecast(cell,line.id),transferLines=line.stops.has(cell)?city.busLines.filter(other=>other.id!==line.id&&other.stops.has(cell)):[];const detail=document.createElement('span');detail.textContent=`${line.count} 辆 · ${line.stops.has(cell)?'本站已启用':'本站未启用'}${transferLines.length?` · 可换乘 ${transferLines.map(other=>other.name).join('、')}`:''} · ${planning?'预计客流 '+forecast:'候车 '+waiting} 人${stopStats?` · 上 ${stopStats.boarded} / 下 ${stopStats.alighted}${stopStats.transfersIn||stopStats.transfersOut?` / 换乘 ${stopStats.transfersIn||0}`:''} / 最大候车 ${stopStats.maxWaiting}`:''}`;
      const choose=document.createElement('button');choose.className='tool';choose.textContent=line.id===city.activeBusLineId?'当前线路':'管理线路';
      choose.onclick=()=>{city.selectBusLine(line.id);updateUI();draw();};
      const stop=document.createElement('button');stop.className='tool';stop.textContent=line.stops.has(cell)?'取消本站':'设为本站';stop.disabled=!planning;
      stop.onclick=()=>{const enabled=!line.stops.has(cell),message=mutateDesign(()=>city.setBusStop(cell,enabled,line.id));toast(message||(enabled?'已设置公交站':'已取消公交站'));updateUI();draw();};
      card.append(title,detail,choose,stop);panel.append(card);
    }
  }
  function signalActionName(action){const [entry,turn]=action.split('-');return `${SIGNAL_ENTRY_NAMES[entry]}${SIGNAL_TURN_NAMES[turn]}`;}
  function applySignalSettings(settings, success='路口设置已更新') {
    if (!city.level.features.signals) { toast('红绿灯在本关未开放'); updateUI(); return false; }
    const message=mutateDesign(()=>city.setSignal(inspectedCell,settings));
    if(message){$('signal-priority-list').dataset.signature='';$('signal-phase-list').dataset.signature='';}
    const signal=city.signals.get(inspectedCell),hasConflict=signal?.phases.some(actions=>city.signalConflicts(actions).length);
    toast(message||(hasConflict?'已保留设置，但冲突灯序必须在运营前修正':success));updateUI();draw();return !message;
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
    $('signal-cycle').disabled=!editable||!signal?.enabled||signal?.automatic===false;
    if(document.activeElement!==$('signal-cycle'))$('signal-cycle').value=String(signal?.green||2);
    $('signal-custom-editor').hidden=!signal?.enabled||signal?.automatic!==false;
    if(!signal){$('signal-conflict').textContent='';return;}
    const phaseConflicts=signal.phases.map(actions=>city.signalConflicts(actions));
    $('signal-conflict').textContent=phaseConflicts.flatMap((conflicts,index)=>conflicts.map(conflict=>`阶段 ${index+1}：${signalActionName(conflict[0])}与${signalActionName(conflict[1])}会穿过同一冲突区。`)).join(' ');
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
    const phaseList=$('signal-phase-list'),phaseSignature=`${editable}:${JSON.stringify(signal.phases)}:${signal.phaseGreens.join(',')}`;
    if(phaseList.dataset.signature!==phaseSignature) {
      phaseList.dataset.signature=phaseSignature;phaseList.replaceChildren();
      signal.phases.forEach((phase,index)=>{
        const card=document.createElement('section');card.className='signal-phase-card';card.classList.toggle('previewing',index===previewSignalPhaseIndex);card.classList.toggle('conflicted',Boolean(phaseConflicts[index].length));card.setAttribute('aria-invalid',String(Boolean(phaseConflicts[index].length)));card.onclick=event=>{if(event.target.closest('button,input'))return;previewSignalPhaseIndex=index;phaseList.dataset.signature='';updateUI();draw();};
        const heading=document.createElement('div');heading.className='signal-phase-heading';
        const title=document.createElement('strong');title.textContent=`阶段 ${index+1}${phaseConflicts[index].length?' · 动作冲突':''}`;
        const duration=document.createElement('select');duration.setAttribute('aria-label',`阶段 ${index+1} 绿灯时长`);duration.disabled=!editable;
        for(const seconds of [2,4,6]){const option=document.createElement('option');option.value=String(seconds);option.textContent=`${seconds} 秒`;duration.append(option);}duration.value=String(signal.phaseGreens[index]);
        duration.onchange=()=>{const phaseGreens=[...signal.phaseGreens];phaseGreens[index]=Number(duration.value);applySignalSettings({phaseGreens},'阶段绿灯时长已更新');};
        const up=document.createElement('button'),down=document.createElement('button'),remove=document.createElement('button');
        for(const button of [up,down,remove]){button.type='button';button.className='tool';button.disabled=!editable;}
        up.textContent='↑';up.title='阶段提前';up.disabled||=index===0;down.textContent='↓';down.title='阶段后移';down.disabled||=index===signal.phases.length-1;
        remove.textContent='删除';remove.classList.add('danger-button');remove.disabled||=signal.phases.length===1;
        const reorder=offset=>{const phases=signal.phases.map(actions=>[...actions]),phaseGreens=[...signal.phaseGreens],target=index+offset;[phases[index],phases[target]]=[phases[target],phases[index]];[phaseGreens[index],phaseGreens[target]]=[phaseGreens[target],phaseGreens[index]];applySignalSettings({phases,phaseGreens},'手动灯序已更新');};
        up.onclick=()=>reorder(-1);down.onclick=()=>reorder(1);
        remove.onclick=()=>{const phases=signal.phases.filter((_,phaseIndex)=>phaseIndex!==index).map(actions=>[...actions]),phaseGreens=signal.phaseGreens.filter((_,phaseIndex)=>phaseIndex!==index);applySignalSettings({phases,phaseGreens},'已删除信号阶段');};
        heading.append(title,duration,up,down,remove);card.append(heading);
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
    $('add-signal-phase').disabled=!editable||signal.phases.length>=8;$('suggest-signal-phases').disabled=!editable;
  }
  function updateInspector() {
    const cells=selectedCells(), isRoute=Boolean(routeSelection), n=!isRoute&&cells.length===1?cells[0]:null;
    const roads=cells.filter(cell=>city.roads.has(cell)), removable=roads;
    const planning=city.canEditDesign(), singleRoad=n!==null&&city.roads.has(n),segment=singleRoad?roadSegment(n):[];
    inspectedCell=singleRoad?n:null;
    $('selection-title').textContent=isRoute?'路线信息':cells.length>1?'区域信息':'格子信息';
    const canUpgrade=city.level.features.grade&&planning&&operationRoads('upgrade',cells).length>0;
    const canDowngrade=city.level.features.grade&&planning&&operationRoads('downgrade',cells).length>0;
    $('upgrade-road').disabled=!canUpgrade;
    $('downgrade-road').disabled=!canDowngrade;
    $('remove-road').disabled=!removable.length||!planning;
    $('quick-road-actions').hidden=tool!=='select'||dragging||!removable.length||!planning;
    $('quick-upgrade-road').disabled=!canUpgrade;$('quick-downgrade-road').disabled=!canDowngrade;
    $('quick-remove-road').disabled=!removable.length||!planning;
    $('prefer-road').disabled=!roads.length||!planning;
    $('avoid-road').disabled=!roads.length||!planning;
    $('clear-road-policy').disabled=!roads.some(cell=>city.roadPolicies.has(cell))||!planning;
    const selectedRegion=n===null?null:city.lockedRegions.get(n);
    $('unlock-region').hidden=!selectedRegion;$('unlock-region').disabled=!planning||!selectedRegion?.available||city.remaining<(selectedRegion?.cost||0);
    $('build-road').disabled=!(n!==null&&!city.roads.has(n)&&!city.buildings.has(n)&&!city.pendingBuildings.has(n)&&!city.dormantBuildings.has(n)&&!city.lockedRegions.has(n)&&(!city.water.has(n)||city.bridges.has(n))&&!city.trees.has(n))||!planning;
    $('select-road-route').hidden=!singleRoad||!segment.length;
    $('select-road-route').disabled=!planning;
    $('upgrade-road').textContent=isRoute?'↑ 升级整段':cells.length>1?'↑ 全部升级':'↑ 升级';
    $('downgrade-road').textContent=isRoute?'↓ 降级整段':cells.length>1?'↓ 全部降级':'↓ 降级';
    $('remove-road').textContent=isRoute?'⌫ 拆除整段':cells.length>1?'⌫ 全部拆除':'⌫ 拆除';
    const signal=singleRoad?city.signals.get(n):null;
    $('signal-controls').hidden=!signal;
    if (!cells.length) {
      $('road-detail').textContent='点击一个格子，或拖动选择矩形区域。';
      $('road-load').textContent='';$('signal-phase').textContent='';
    } else if (isRoute||cells.length>1) {
      const price=roads.reduce((sum,cell)=>sum+city.roadType(cell).cost,0);
      if(isRoute) $('road-detail').textContent=`路口之间的连续路段 · ${roads.length} 格道路 · 当前总价 ${price} 点（两端路口格不包含在内）`;
      else {const a=point(selection.start),b=point(selection.end),width=Math.abs(a.x-b.x)+1,height=Math.abs(a.y-b.y)+1;$('road-detail').textContent=`${width} × ${height} · ${cells.length} 格 · ${roads.length} 格道路 · 内部总价 ${price} 点`;}
      const cars=city.cars.filter(car=>cells.includes(car.cell)||cells.includes(car.next)).length;
      const queued=city.homes.reduce((sum,home,i)=>sum+(cells.includes(home.cell)?city.queues[i]:0),0);
      $('road-load').textContent=['running','paused'].includes(city.state)?`${isRoute?'路线':'区域'}车流：${cars} 辆占用或驶入 · 住宅等待 ${queued} 辆`:isRoute?'整段升级、降级或拆除会先显示预计结果，确认后才施工。':'可用分开的按钮批量升级、降级或拆除区域内道路。';
      $('signal-phase').textContent=`${isRoute?'路线':'多格选择'}不提供红绿灯调整，请单独选择一个路口。`;
    } else {
      const p=point(n),homeIndex=city.homes.findIndex(home=>home.cell===n),goalIndex=city.goals.findIndex(goal=>goal.cell===n);
      if(singleRoad) {
        const type=city.roadType(n),load=city.load(n),phase=city.signalPhase(n);
        const turnLayout=['转向全部混行','左转专用，直行 / 右转混行','左转 / 直行 / 右转各用一条车道'][type.lanes-1];
        const policy=city.roadPolicies.get(n),policyText=policy==='prefer'?' · 汽车优先选择':policy==='avoid'?' · 汽车禁行':'';
        $('road-detail').textContent=`(${p.x+1}, ${p.y+1}) ${type.name}：${type.speed} 格/秒 · 每方向 ${type.lanes} 车道 × 2 辆 · ${turnLayout} · 每格 ${type.cost} 点${city.bridges.has(n)?' · 位于桥梁':''}${policyText}`;
        $('road-load').textContent=city.level.features.load?(signal?(signal.enabled?`冲突区预约 ${load.used} / 4 区 · 占用/驶入 ${load.total} 辆`:`逐车通行 · 路口占用 ${load.total} / 1 辆`):`每方向 ${type.lanes} 车道 × 前后 2 辆 · 最忙方向 ${load.used} / ${load.capacity} 辆`):(['running','paused'].includes(city.state)?`当前占用或驶入 ${load.total} 辆`:'');
        const names={off:signal?.yieldMode==='priority'?`方向优先 · ${signal.priority.map(entry=>SIGNAL_ENTRY_NAMES[entry].replace('侧入口','')).join(' → ')}`:'自动让行 · 35% 速度 · 先到先行','horizontal-straight':'横向直行绿灯','horizontal-left':'横向左转绿灯','vertical-straight':'纵向直行绿灯','vertical-left':'纵向左转绿灯','main-straight':'T 形路口主路双向直行','main-turn':'T 形路口主路转入支路','branch-turn':'T 形路口支路汇入主路',clearance:'直行 / 左转全红清空'};
        const custom=phase.stage==='custom'?`手动阶段 ${phase.index+1} · ${phase.actions.map(action=>{const [entry,turn]=action.split('-');return SIGNAL_ENTRY_NAMES[entry].replace('侧入口','')+SIGNAL_TURN_NAMES[turn];}).join('、')}`:'';
        $('signal-phase').textContent=!city.level.features.inspect?`本关专注于「${city.level.lesson}」，详细路况与信号在本关未开放。`:signal?`${custom||names[phase.stage]}${phase.axis==='off'?'':` · ${phase.remaining.toFixed(1)} 秒；右转须让行`}`:'非路口，无需红绿灯';
      } else if(homeIndex>=0) {
        const home=city.homes[homeIndex],travel=city.homeTravelInfo(homeIndex),counts=city.passengerBreakdown(homeIndex);
        $('road-detail').textContent=`(${p.x+1}, ${p.y+1}) 住宅 · 总人口 ${home.passengers} 人 · 居民产生 ${home.generationRate} 人/秒 · 汽车出口由门口道路等级决定`;
        const serving=city.linesServingBuilding(n);
        $('road-load').textContent=`人口守恒：${counts.total} = 未产生 ${counts.ungenerated} + 等待 ${counts.waiting} + 汽车在途 ${counts.carTransit} + 公交在途 ${counts.busTransit} + 已抵达 ${counts.arrived}`;
        const goalIndex=travel.carGoalIndex??travel.busGoalIndex,goal=goalIndex==null?null:city.goals[goalIndex],goalPoint=goal?point(goal.cell):null;
        const assigned=travel.assignedGoalIndices.map(index=>{const assignedGoal=city.goals[index],assignedPoint=point(assignedGoal.cell);return `${assignedGoal.label} (${assignedPoint.x+1},${assignedPoint.y+1})`;}).join('、');
        const bottleneck=travel.bottlenecks.length?`主要瓶颈：${city.roadType(travel.bottlenecks[0]).name} ${travel.bottlenecks.slice(0,3).map(cell=>{const position=point(cell);return `(${position.x+1},${position.y+1})`;}).join('、')}`:'';
        const busPlan=travel.busItinerary,busDescription=busPlan?busPlan.legs.map(leg=>city.busLine(leg.lineId).name).join(' → '):'';
        $('signal-phase').textContent=travel.path?`${assigned?'当前已分配：'+assigned:`${travel.dynamic?'当前路况建议':'汽车预计'}目的地：${goal.label} (${goalPoint.x+1},${goalPoint.y+1})`} · ${travel.dynamic?'动态':'规划'}路径 ${travel.distance} 格 · 自由流约 ${travel.freeFlowTime.toFixed(1)} 秒${bottleneck?' · '+bottleneck:''}${travel.reason?' · '+travel.reason:''}`:`${travel.reason||'当前没有可用的小汽车路径'}${travel.busGoalIndex!=null?`；可乘「${busDescription}」送往 ${goal.label} (${goalPoint.x+1},${goalPoint.y+1})${busPlan.transferCell!=null?`，在 (${point(busPlan.transferCell).x+1},${point(busPlan.transferCell).y+1}) 同站换乘`:''}`:''}${serving.length?` · 相邻站点：${serving.map(line=>line.name).join('、')}`:''}`;
      } else if(goalIndex>=0) {
        const goal=city.goals[goalIndex],counts=city.goalBreakdown(goalIndex);
        $('road-detail').textContent=`(${p.x+1}, ${p.y+1}) 接收建筑 · 容量 ${goal.input==null?'不限':goal.input+' 人'}`;
        $('road-load').textContent=`剩余容量 ${counts.remaining==null?'不限':counts.remaining+' 人'} · 已预约 ${counts.reserved} 人 · 已抵达 ${counts.arrived} 人`;
        const serving=city.linesServingBuilding(n);
        $('signal-phase').textContent=`建筑可作为拖拽起点；向空地延伸时固定从支路开始。${serving.length?` · 相邻站点：${serving.map(line=>line.name).join('、')}`:''}`;
      } else {
        const site=city.pendingBuildings.get(n),dormant=city.dormantBuildings.get(n),region=city.lockedRegions.get(n);
        const kind=region?`待开放区域「${region.name}」`:dormant?`${dormant.kind==='home'?'住宅':'目的地'}（数值锁定）`:site?`${site.kind==='home'?'住宅':'目的地'}建设用地`:city.bridges.has(n)?'桥梁（空）':city.water.has(n)?'水面':city.trees.has(n)?'绿地':'空地';
        $('road-detail').textContent=`(${p.x+1}, ${p.y+1}) ${kind}${site?site.conditional?' · 达成条件后落成':` · ${site.daysUntil} 天后落成`:''}`;
        $('road-load').textContent=region?(region.available?`开放任务已完成，可支付 ${region.cost} 点建设点开放全部 ${region.cells.length} 格。`:`开放任务尚未完成。${campaignConditionText({condition:region.unlock})}`):dormant?'同色路线尚缺住宅或目的地；人口或容量不产生需求，也不计入满意度。':site?'建设期间不可铺路，请为建筑和出口预留空间。':kind==='空地'||kind==='桥梁（空）'?'可在此建设一格支路；拖拽后才会建立连接。':'此处不能建设道路。';
        $('signal-phase').textContent=site?campaignConditionText(site):region&&region.available?(city.remaining>=region.cost?'点击“开放区域”确认支付。':`建设点不足，还差 ${region.cost-city.remaining} 点。`):'';
      }
    }
    updateSignalControls(signal,planning);
    if(signal&&city.level.features.inspect&&!city.level.features.signals)$('signal-phase').textContent+=' · 红绿灯在本关未开放';
    updateBusLineInspector(n, city.state==='planning');
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
  function focusInitialView() {
    resetView();
    if(!campaign||adminMode)return;
    const cells=[...new Set([...city.roads,...city.buildings])].filter(cell=>!city.lockedRegions.has(cell));
    const focus=TrafficCanvas.calculateFocusView({mapWidth:city.width,mapHeight:city.height,viewportWidth,viewportHeight,cells});
    viewZoom=focus.zoom;cellSize=focus.cellSize;viewX=focus.x;viewY=focus.y;viewTarget=null;
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
  function drawSignalMarkings(n) {
    const s=cellSize,p=point(n),signal=city.signals.get(n),previewActions=city.canEditDesign()&&n===inspectedCell&&signal.enabled&&signal.automatic===false?signal.phases[Math.min(previewSignalPhaseIndex,signal.phases.length-1)]:null;
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
        const action=city.movementAction(city.movement(entry,exit)),allowed=previewActions?previewActions.includes(action):city.canEnter(n,entry,exit);
        ctx.strokeStyle=!signal.enabled||turn==='right'?'#f5f1d9':allowed?'#187b48':'#c33f39';
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
        const ages=(city.queueTimes[b.index]||[]).map(started=>Math.max(0,city.elapsed-started)),age=ages.length?Math.max(...ages):0,band=TrafficResults.satisfactionBand(age),affected=ages.filter(value=>TrafficResults.satisfactionBand(value)===band).length;
        if(age>8)drawResidentMood(ctx,(x+.18)*s,(y+.55)*s,s,band,affected,Math.sin(city.elapsed*3+b.index)*s*.025);
      }
    } else {
      buildingBubble(r.input==null?'∞':String(Math.max(0,r.input-city.goalAssigned[b.index])), (x+.53)*s,(y+.025)*s,s*.43,s*.27,'#fffef9ee',r.color,r.color);
    }
    label(ROUTE_SYMBOLS[b.route%ROUTE_SYMBOLS.length],(x+.84)*s,(y+.82)*s,s*.16,r.color,'800');
    const serving=city.linesServingBuilding(b.cell);
    if(serving.length) {
      circle((x+.1)*s,(y+.11)*s,s*.09,'#f2bd4f');
      label(serving.length>1?String(serving.length):'站',(x+.1)*s,(y+.11)*s,s*.105,'#173f49','800');
    }
  }
  function draw() {
    if(!city)return;updateDragIntent();
    const dpr=Math.min(window.devicePixelRatio||1,2),s=cellSize,w=city.width*s,h=city.height*s;
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,viewportWidth,viewportHeight);
    ctx.save();ctx.translate(viewX,viewY);ctx.fillStyle='#eaf0df';ctx.fillRect(0,0,w,h);
    // Soft grid and planted lawn patches keep the map legible at small sizes.
    for(let y=0;y<city.height;y++) for(let x=0;x<city.width;x++) {
      if((x*7+y*11)%13===0) { ctx.fillStyle='#e3ebd7';ctx.fillRect(x*s,y*s,s,s); }
      ctx.strokeStyle='#dce5d04d';ctx.lineWidth=.65;ctx.strokeRect(x*s,y*s,s,s);
      if((x*3+y*7)%9===0 && !city.water.has(key(x,y)) && !city.roads.has(key(x,y)) && !city.buildings.has(key(x,y)) && !city.pendingBuildings.has(key(x,y)) && !city.dormantBuildings.has(key(x,y))) {
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
      const policy=city.roadPolicies.get(n);if(policy)label(policy==='prefer'?'★':'⊘',(x+.8)*s,(y+.2)*s,s*.18,policy==='prefer'?'#f4c04f':'#a4443f','800');
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
    const selectedTravel=selectedHomeTravelInfo();
    if(selectedTravel?.path) {
      const routeColor=city.routes[city.homes[selectedTravel.homeIndex].route].color;
      ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.globalAlpha=.9;
      for(let i=1;i<selectedTravel.path.length;i++) {
        const a=point(selectedTravel.path[i-1]),b=point(selectedTravel.path[i]);
        line((a.x+.5)*s,(a.y+.5)*s,(b.x+.5)*s,(b.y+.5)*s,'#fffef9',s*.16);
        line((a.x+.5)*s,(a.y+.5)*s,(b.x+.5)*s,(b.y+.5)*s,routeColor,s*.075);
      }
      for(const cell of selectedTravel.bottlenecks) { const p=point(cell);circle((p.x+.5)*s,(p.y+.5)*s,s*.105,'#e0a24d');circle((p.x+.5)*s,(p.y+.5)*s,s*.055,'#fffef9'); }
      ctx.restore();
    }
    ctx.lineCap='butt';
    for(const n of city.trees) {
      const {x,y}=point(n),cx=(x+.5)*s,cy=(y+.48)*s;
      circle(cx+s*.04,cy+s*.16,s*.25,'#cddcbc');
      line(cx,cy,cx,cy+s*.31,'#a5b18d',s*.055);
      circle(cx-s*.1,cy,s*.19,'#a9c398');circle(cx+s*.1,cy+s*.015,s*.19,'#9ab88a');circle(cx,cy-s*.13,s*.19,'#b3cba1');
    }
    for(const region of lockedRegionList()) {
      const cells=new Set(region.cells),path=new Path2D();
      for(const cell of cells){const {x,y}=point(cell);path.rect(x*s,y*s,s,s);}
      ctx.save();ctx.clip(path);
      ctx.fillStyle=region.available?'#7d878164':'#7b817e82';ctx.fill(path);
      for(const [index,cell] of region.cells.entries()) {
        if(index%2)continue;
        const {x,y}=point(cell),gradient=ctx.createRadialGradient((x+.25)*s,(y+.3)*s,0,(x+.5)*s,(y+.5)*s,s*.82);
        gradient.addColorStop(0,region.available?'#e7ece58a':'#d9ddda99');gradient.addColorStop(1,'#79817d08');ctx.fillStyle=gradient;ctx.fillRect(x*s,y*s,s,s);
      }
      ctx.restore();
      ctx.save();ctx.strokeStyle=region.available?'#596a608f':'#555c5899';ctx.lineWidth=Math.max(1.2,s*.035);ctx.lineCap='round';
      for(const cell of cells){const {x,y}=point(cell);if(!cells.has(cell-city.width))line(x*s,y*s,(x+1)*s,y*s,ctx.strokeStyle,ctx.lineWidth);if(!cells.has(cell+city.width))line(x*s,(y+1)*s,(x+1)*s,(y+1)*s,ctx.strokeStyle,ctx.lineWidth);if(x===0||!cells.has(cell-1))line(x*s,y*s,x*s,(y+1)*s,ctx.strokeStyle,ctx.lineWidth);if(x===city.width-1||!cells.has(cell+1))line((x+1)*s,y*s,(x+1)*s,(y+1)*s,ctx.strokeStyle,ctx.lineWidth);}
      const lock=regionLockPosition(region),cx=lock.x*s,cy=lock.y*s,accent=region.available?'#d3a84b':'#59605c';
      circle(cx,cy,s*.27,'#f4f5f0dc');circle(cx,cy,s*.22,accent);
      ctx.beginPath();ctx.arc(cx,cy-s*.035,s*.095,Math.PI,0);ctx.strokeStyle='#f7f5e9';ctx.lineWidth=Math.max(2,s*.045);ctx.stroke();
      rounded(cx-s*.14,cy-s*.035,s*.28,s*.22,s*.045,'#f7f5e9');circle(cx,cy+s*.055,s*.025,accent);
      ctx.restore();
    }
    for(const site of city.pendingBuildings.values()) {
      const {x,y}=point(site.cell),cx=(x+.5)*s,cy=(y+.5)*s;
      ctx.save();ctx.globalAlpha=.78;ctx.setLineDash([s*.08,s*.06]);
      rounded(x*s+s*.1,y*s+s*.1,s*.8,s*.8,s*.13,'#c7cac5aa','#747a75');ctx.setLineDash([]);
      label(site.kind==='home'?'⌂':'▣',cx,cy-s*.08,s*.34,'#6f756f','700');
      rounded(cx-s*.2,cy+s*.16,s*.4,s*.22,s*.1,'#676d68');label(site.conditional?'✓':String(site.daysUntil),cx,cy+s*.27,s*.14,'#fffef9','800');
      ctx.restore();
    }
    for(const building of city.dormantBuildings.values()) {
      const {x,y}=point(building.cell),cx=(x+.5)*s,cy=(y+.5)*s;ctx.save();ctx.globalAlpha=.72;rounded(x*s+s*.08,y*s+s*.07,s*.84,s*.84,s*.17,'#b8bcb7','#6e746f');label(building.kind==='home'?'⌂':'▣',cx,cy-s*.06,s*.34,'#626863','700');rounded(cx-s*.2,cy+s*.16,s*.4,s*.22,s*.1,'#656b67');label('锁',cx,cy+s*.27,s*.14,'#fffef9','800');ctx.restore();
    }
    city.homes.forEach((h,i)=>drawBuilding({...h,isHome:true,index:i}));
    city.goals.forEach((g,i)=>drawBuilding({...g,isHome:false,index:i}));
    if(resultReplay&&$('replay-toolbar')&&!$('replay-toolbar').hidden){
      ctx.save();
      for(const item of resultReplay.roads){const p=point(item.cell),strength=resultReplay.maxRoad?Math.min(1,(item.occupancySeconds+item.blockedSeconds)/resultReplay.maxRoad):0;if(!strength)continue;rounded(p.x*s+s*.08,p.y*s+s*.08,s*.84,s*.84,s*.14,`rgba(202,86,50,${(.18+strength*.57).toFixed(3)})`);}
      for(const item of resultReplay.homes){const p=point(item.cell),strength=resultReplay.maxHome?Math.min(1,item.waitingSeconds/resultReplay.maxHome):0;if(!strength)continue;circle((p.x+.5)*s,(p.y+.5)*s,s*(.22+strength*.18),`rgba(112,69,151,${(.25+strength*.55).toFixed(3)})`);label(`${Math.round(item.waitingSeconds)}`,(p.x+.5)*s,(p.y+.5)*s,s*.17,'#fff','800');}
      ctx.restore();
    }
    // Road paint sits below vehicles, so it reads as part of the grid.
    for(const n of city.signals.keys()) drawSignalMarkings(n);
    let carMoodCount=0;
    for(const car of city.cars) {
      const pose=city.pose(car),length=VEHICLE_LENGTH*s,width=VEHICLE_WIDTH*s;
      ctx.save();ctx.translate(pose.x*s,pose.y*s);ctx.rotate(pose.angle);
      rounded(-length/2,-width/2+s*.015,length,width,s*.025,'#344c3333');
      rounded(-length/2,-width/2,length,width,s*.025,city.routes[car.route].color);
      rounded(length*.1,-width*.36,length*.2,width*.72,s*.01,'#f5f6e9bb');
      if(car.blocked>1) circle(-length*.55,0,s*.018,'#e2a15e');
      ctx.restore();
      const age=Math.max(0,city.elapsed-(car.commuteStarted??city.elapsed));
      if(age>8&&carMoodCount<18){drawResidentMood(ctx,pose.x*s,pose.y*s-s*.24,s,TrafficResults.satisfactionBand(age),1,Math.sin(city.elapsed*3+car.id)*s*.025);carMoodCount++;}
    }
    for(const bus of city.buses) {
      if(bus.active===false)continue;
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
      const ages=bus.passengers.map(passenger=>Math.max(0,city.elapsed-passenger.commuteStarted)),age=ages.length?Math.max(...ages):0,band=TrafficResults.satisfactionBand(age),affected=ages.filter(value=>TrafficResults.satisfactionBand(value)===band).length;
      if(age>8)drawResidentMood(ctx,pose.x*s,pose.y*s-s*.48,s,band,affected,Math.sin(city.elapsed*3+(bus.id||0))*s*.025);
    }
    for(const [cell,passengers] of city.transferQueues||[])if(passengers.length){const ages=passengers.map(passenger=>Math.max(0,city.elapsed-passenger.commuteStarted)),age=Math.max(...ages),band=TrafficResults.satisfactionBand(age),affected=ages.filter(value=>TrafficResults.satisfactionBand(value)===band).length;if(age>8){const p=point(cell);drawResidentMood(ctx,(p.x+.5)*s,(p.y+.2)*s,s,band,affected,Math.sin(city.elapsed*3+cell)*s*.025);}}
    arrivalEffects.draw(ctx, point, s);
    const marked = new Set();
    for(const issue of planningHints)for(const cell of issue.cells || []) {
      if(marked.has(cell))continue;marked.add(cell);
      const p=point(cell),x=(p.x+.83)*s,y=(p.y+.17)*s;
      circle(x,y,s*.13,'#a65b22');label('!',x,y,s*.19,'#fffef9','800');
      if(cell===hover||cell===selection?.start){
        const text=issue.title,width=text.length*s*.21+20;
        rounded(x-width/2,y-s*.65,width,s*.36,s*.08,'#fff4df');label(text,x,y-s*.47,s*.21,'#81451b','700');
      }
    }
    if(tool==='select'&&selection) {
      if(routeSelection)for(const cell of routeSelection){const {x,y}=point(cell);rounded(x*s+2,y*s+2,s-4,s-4,s*.1,'#37678c18','#37678c');}
      else {const a=point(selection.start),b=point(selection.end),x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),rw=Math.abs(a.x-b.x)+1,rh=Math.abs(a.y-b.y)+1;rounded(x*s+1,y*s+1,rw*s-2,rh*s-2,s*.1,'#37678c12','#37678c');}
    }
    if(dragDraft) {
      const color=dragDraft.kind==='erase'||dragDraft.kind==='bus-trim'?'#c8844f':dragDraft.kind==='cut'?'#a97346':dragDraft.kind==='bus'?(city.activeBusLine?.color||'#1686a0'):'#317a57';
      const gradeChanges=new Map(dragGradeChanges().map(change=>[change.cell,change])),newRoads=new Set(dragNewRoads());
      for(const n of dragDraft.path){const {x,y}=point(n),change=gradeChanges.get(n),isNew=newRoads.has(n),previewColor=change?(change.to>change.from?'#258255':'#c47a3d'):isNew?'#258255':color;rounded(x*s+3,y*s+3,s-6,s-6,s*.09,previewColor+'20',previewColor);if(change||isNew)label(change?(change.to>change.from?'↑':'↓'):'＋',(x+.5)*s,(y+.5)*s,s*.42,previewColor,'800');}
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
      if(tool==='road'&&!city.buildings.has(selected)&&!city.pendingBuildings.has(selected)&&!city.dormantBuildings.has(selected)&&!city.lockedRegions.has(selected)&&!city.roads.has(selected))label(retracting?'−':'+',(x+.5)*s,(y+.5)*s,s*.42,retracting?'#bd8253':'#82a277');
    }
    if(city.state==='paused') {
      rounded(w/2-52,14,104,27,14,'#fffef9e8');label('Ⅱ  规划暂停中',w/2,28,11,'#63715b');
    }
    ctx.restore();
  }
  function liveSatisfactionReport() {
    const active=[];
    for(const times of city.queueTimes)for(const started of times)active.push(Math.max(0,city.elapsed-started));
    for(const car of city.cars)active.push(Math.max(0,city.elapsed-(car.commuteStarted??city.elapsed)));
    for(const bus of city.buses)for(const passenger of bus.passengers)active.push(Math.max(0,city.elapsed-passenger.commuteStarted));
    for(const passenger of city.transferPassengers())active.push(Math.max(0,city.elapsed-passenger.commuteStarted));
    if(city.state==='lost')return TrafficResults.commuteReport(city.commuteTimes,Math.max(0,city.generated.reduce((sum,count)=>sum+count,0)-city.delivered));
    return TrafficResults.liveCommuteReport(city.commuteTimes,active);
  }
  function updatePlanningHints() {
    const targets=starTargetsFor(city.level,campaign?campaign.dayIndex:null);
    const signature=`${designHistory[designHistoryIndex]}:${city.target}:${city.budget}:${campaign?.dayIndex}:${city.sandbox}`;
    if(hintCity===city&&hintSignature===signature)return;
    hintCity=city;hintSignature=signature;
    planningHints=city.planningHints({maxCost:targets?.efficiency?.maxCost});
    const budgetHint=$('budget-hint'),costIssue=planningHints.find(issue=>issue.code==='star-cost');
    budgetHint.hidden=!costIssue;budgetHint.textContent=costIssue?`⚠ 超出省钱星 ${city.budget-city.remaining-targets.efficiency.maxCost} 点`:'';
    budgetHint.title=costIssue?.detail||'';
    $('planning-hints-summary').textContent=planningHints.length?`规划提示 · ${planningHints.length} 项（地图 !）`:'规划提示 · 暂未发现问题（不保证通关）';
    $('planning-hints-list').replaceChildren(...planningHints.map(issue=>{
      const row=document.createElement('li'),title=document.createElement('strong'),detail=document.createElement('p');
      title.textContent=issue.title;detail.textContent=issue.detail;row.append(title,detail);
      if(issue.cells?.length){const locate=document.createElement('button');locate.type='button';locate.className='tool';locate.textContent='定位问题';locate.onclick=()=>{
        const cell=issue.cells[0],p=point(cell);setTool('select');selectSingleCell(cell);keyboardCell=cell;
        viewTarget=null;viewX=viewportWidth/2-(p.x+.5)*cellSize;viewY=viewportHeight/2-(p.y+.5)*cellSize;snapView();
        updateUI();draw();canvas.scrollIntoView({block:'center'});toast(issue.detail);
      };row.append(locate);}
      return row;
    }));
  }
  function updateUI() {
    updateHistoryControls();updatePlanningHints();
    $('delivered').textContent=city.delivered;$('budget').textContent=city.unlimitedBudget?'∞':city.remaining;
    const deliveryTotal=city.target;
    $('progress').style.width=Math.min(100,city.delivered/deliveryTotal*100)+'%';celebrateProgress();
    const seconds=Math.ceil(Math.max(0,city.duration-city.elapsed));
    $('timer').textContent=city.sandbox?'∞':String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
    const homeWaiting=city.queues.reduce((a,b)=>a+b,0),transferWaiting=city.transferPassengers().length,waiting=homeWaiting+transferWaiting,blocked=[...city.cars,...city.buses].filter(c=>c.blocked>1.5).length;
    const satisfaction=liveSatisfactionReport(),dominant=satisfaction.count?satisfaction.bands.reduce((worst,band,index)=>band.count?index:worst,0):null,mood=dominant===null?null:TrafficEffects.MOODS[dominant];
    $('satisfaction').textContent=satisfaction.count?satisfaction.score:'--';$('satisfaction').style.color=mood?.color||'#7c877e';
    $('satisfaction-label').textContent=satisfaction.count?`${mood.symbol} ${dominant?'有人'+satisfaction.bands[dominant].label:satisfaction.bands[dominant].label}`:'尚未出发';
    $('satisfaction-note').textContent=satisfaction.count?`正在统计 ${satisfaction.count} 位已产生居民`:'通勤越久，满意度越低';
    const heavy=blocked>3||waiting>18, neutral=['planning','paused','lost'].includes(city.state);
    $('traffic').textContent=city.state==='planning'?'等待出发':city.state==='paused'?'运营已暂停':city.state==='won'?'目标已达成':city.state==='lost'?'本轮已结束':heavy?'有些拥堵':waiting>6?'等待接通':'畅通无阻';
    $('traffic').style.color=neutral?'#7c877e':heavy?'#c38a51':'#317a57';$('traffic-dot').style.background=neutral?'#aab3a5':heavy?'#c38a51':'#73a780';
    const onboard=city.buses.reduce((sum,bus)=>sum+bus.passengers.length,0);
    $('waiting').textContent=`${homeWaiting} 人在住宅等待${transferWaiting?` · ${transferWaiting} 人在换乘站等待`:''} · ${city.cars.length} 辆小汽车${city.buses.length?` · ${city.buses.length} 辆公交载客 ${onboard} 人`:''}`;
    const states={planning:'规划中',running:'运营中',paused:'已暂停',won:'目标达成',lost:'运营结束'};
    $('phase-label').textContent=city.sandbox?`${states[city.state]} · 沙盒`:states[city.state];
    $('board-status').textContent=city.state==='planning'?(city.sandbox?'沙盒规划，可随时开跑':'先规划，再出发'):`${states[city.state]} · ${speedLabel(speed)}× 速度${city.sandbox?' · 可实时修改':''}`;
    $('start').textContent=city.state==='running'?'Ⅱ 暂停运营':city.state==='paused'?'▶ 继续运营':city.state==='planning'?'▶ 开始运营':'本局已结束';
    $('start').disabled=['won','lost'].includes(city.state);
    $('stop').disabled=!['running','paused'].includes(city.state);
    $('stop').textContent=city.sandbox?'↻ 重置交通':'■ 停止运营';
    $('reset-traffic').disabled=!['running','paused'].includes(city.state);
    const liveEditable=city.canEditDesign();
    $('road-tool').disabled=!liveEditable;
    $('cut-tool').disabled=!liveEditable;
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
    $('bus-return-stops').disabled=!planningBus||!busLine||!busLine.returnTrip;
    $('bus-headway').disabled=!planningBus||!busLine||busLine.count<2;
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
    if(document.activeElement!==$('bus-headway')) $('bus-headway').value=String(busLine?.headway||4);
    $('bus-return-trip').checked=Boolean(busLine?.returnTrip);$('bus-return-stops').checked=Boolean(busLine?.returnStops);
    const busPassengers=city.buses.reduce((sum,bus)=>sum+bus.passengers.length,0), planned=city.busLines.filter(line=>line.route.length);
    if(busLine?.route.length) {
      const routeState=busClosed?`${busLine.route.length-1} 段闭环`:busLine.returnTrip?`${busLine.route.length-1} 段往返 · 返程不停站`:`${busLine.route.length-1} 段 · 待闭环`;
      const activeBuses=city.buses.filter(bus=>bus.active!==false).length,report=city.busReports().find(item=>item.id===busLine.id);
      $('bus-status').textContent=`${routeState}${busLine.returnStops?' · 双向停站':''} · ${busLine.count} 辆 / ${busLine.headway} 秒间隔 · ${busLine.count*BUS_COST} 点${city.buses.length?` · 已发 ${activeBuses} 辆 · 全网载客 ${busPassengers}/${activeBuses*BUS_CAPACITY||BUS_CAPACITY}`:''}${report&&city.state!=='planning'?` · 上车 ${report.boarded} / 下车 ${report.alighted} / 拒载 ${report.rejectedFull}`:''}`;
    } else $('bus-status').textContent=busLine?'当前线路尚未绘制':`尚无线路 · 本关上限 ${city.busLineLimit} 条`;
    if(planned.length>1) $('bus-status').textContent+=` · 已规划 ${planned.length}/${city.busLineLimit} 条`;
    updateBusVisibilityControls();
    $('load-design').disabled=city.state!=='planning'||!designAvailable;
    const availableSpeeds=speedOptions(),nextSpeed=availableSpeeds[(availableSpeeds.indexOf(speed)+1)%availableSpeeds.length];
    $('speed').textContent=speedLabel(speed)+'×';
    $('speed').setAttribute('aria-label',speed===Infinity?'切换运营倍速，当前无限速':`切换运营倍速，当前 ${speed} 倍`);
    $('speed').title=`当前 ${speedLabel(speed)}×；点击切换为 ${speedLabel(nextSpeed)}×${nextSpeed===Infinity?'（立即完成模拟）':''}`;
    $('connection-count').textContent=city.routes.filter((r,i)=>city.routeConnected(i)).length+' / '+city.routes.length;
    connectionRows.forEach(({row,status},i)=>{
      const connected=city.routeConnected(i),wasConnected=connectedRoutes.has(i);row.classList.toggle('connected',connected);status.textContent=connected?'已连接 ✓':'待连接';
      if(connected&&!wasConnected&&city.state==='planning'){connectedRoutes.add(i);replayAnimation(row,'connection-reward');toast(`${city.routes[i].name}已贯通 ✓`);}
      else if(!connected&&wasConnected)connectedRoutes.delete(i);
    });
    updateInspector();
    updateAccessibleMap();
    renderCampaignProgress();renderContextGuide();saveAutoProgress();
    if(['won','lost'].includes(city.state)&&!resultShown) showResult();
  }
  function openResultReplay(cell=null,message='累计瓶颈热力图已开启') {
    if(!resultReplay)return;
    if($('result-dialog').open)$('result-dialog').close();
    $('replay-toolbar').hidden=false;
    if(Number.isInteger(cell)){const p=point(cell);setTool('select');selectSingleCell(cell);keyboardCell=cell;viewTarget=null;viewX=viewportWidth/2-(p.x+.5)*cellSize;viewY=viewportHeight/2-(p.y+.5)*cellSize;snapView();}
    updateUI();draw();canvas.scrollIntoView({block:'center'});toast(message);
  }
  function reviseResultDesign() {
    if(!['won','lost'].includes(city.state))return;
    if(campaign&&campaign.results[campaign.dayIndex])campaign.results.splice(campaign.dayIndex);
    city.resetOperation();pendingCampaignScore=null;resultShown=false;resultReplay=null;$('replay-toolbar').hidden=true;
    if($('result-dialog').open)$('result-dialog').close();
    setTool('select');updateUI();draw();toast('已保留原设计并回到规划，可直接修改瓶颈后重试');
  }
  function showResult() {
    resultShown=true;
    const won=city.state==='won', generated=city.generated.reduce((sum,count)=>sum+count,0);
    if(!won&&currentReference())unlockReference();
    const report=TrafficResults.commuteReport(city.commuteTimes,Math.max(0,generated-city.delivered));
    pendingCampaignScore=report.score;
    const settlement=campaign?campaign.settlement(report.score):null,finalDay=campaign&&campaign.dayIndex===campaign.days.length-1;
    const resultCost=city.budget-city.remaining,resultPeak=Math.max(0,...city.maxHomeQueues),starTargets=starTargetsFor(city.level,campaign?campaign.dayIndex:null);
    const stars=TrafficResults.starReport(starTargets,{won,score:report.score,cost:resultCost,maxQueue:resultPeak}),starDay=campaign?campaign.dayIndex:null,starKey=STAR_PREFIX+city.level.id+(starDay===null?'':`:day-${starDay+1}`),previousStars=storedStars(city.level,starDay),earnedStars=[...new Set([...previousStars,...stars.earned])];
    if(earnedStars.length!==previousStars.length)try{localStorage.setItem(starKey,JSON.stringify(earnedStars));}catch{/* stars remain optional */}
    const bestKey=`${PERSONAL_BEST_PREFIX}${city.level.id}${campaign?`:day-${campaign.dayIndex+1}`:''}`,currentResult={score:report.score,average:report.average,p95:report.p95,cost:resultCost,maxQueue:resultPeak};
    let previousBest=null;try{previousBest=JSON.parse(localStorage.getItem(bestKey)||'null');}catch{/* keep session playable without storage */}
    if(!previousBest||![previousBest.score,previousBest.average,previousBest.p95,previousBest.cost].every(Number.isFinite))previousBest=null;
    resultReplay=city.operationHeatmap();$('replay-toolbar').hidden=true;
    const isBetter=won&&(!previousBest||currentResult.score>previousBest.score||currentResult.score===previousBest.score&&(currentResult.p95<previousBest.p95||currentResult.p95===previousBest.p95&&currentResult.cost<previousBest.cost));
    if(isBetter)try{localStorage.setItem(bestKey,JSON.stringify(currentResult));}catch{/* best comparison remains optional */}
    const personalBest=isBetter?currentResult:previousBest;
    $('result-icon').textContent=won?'✳':'⌁';
    $('result-title').textContent=campaign?finalDay?`${campaign.days.length} 天运营完成，城市因你而成长。`:`第 ${campaign.dayIndex+1} 天运营结算`:won?'这座小城，因你而畅通。':'再给小城一个好计划。';
    $('result-description').textContent=campaign?`${won?'全部居民均已抵达':'仍有居民未抵达'}；本日收入 ${settlement.income} 点，由当日总人口送达比例与通勤满意度共同计算。${finalDay?'你仍可关闭报告，从进度条回到任一天重新运营。':'进入下一天后，新建筑可能落成，请先用收入改造交通。'}`:won?'所有居民均已抵达！每一段精心规划的道路，都让生活更近了一点。':'时间到了。'+city.level.tip;
    const summary=document.createElement('strong');summary.textContent=`已产生居民满意度 ${report.score}%`;
    const meta=document.createElement('div');meta.textContent=`抵达 ${city.delivered} / ${city.target} 人 · 平均通勤 ${city.delivered?report.average.toFixed(1)+' 秒':'暂无'} · P95 ${city.delivered?report.p95.toFixed(1)+' 秒':'暂无'} · 动态改道 ${city.rerouteCount} 次 · 建设及公交 ${city.budget-city.remaining} 点${campaign?` · 收入 +${settlement.income} 点`:''}`;
    const population=city.passengerBreakdown(),conservation=document.createElement('div');conservation.className='population-conservation';
    conservation.textContent=`总人口 ${population.total} = 未产生 ${population.ungenerated} + 住宅等待 ${population.waiting} + 汽车在途 ${population.carTransit} + 公交在途 ${population.busTransit} + 已抵达 ${population.arrived}`;
    const distribution=document.createElement('div');distribution.className='commute-distribution';
    for(const band of report.bands){const item=document.createElement('span');item.textContent=`${band.label} ${band.count} 人`;distribution.append(item);}
    const newlyEarned=stars.earned.filter(id=>!previousStars.includes(id)),starPanel=document.createElement('div');starPanel.className='star-report';starPanel.setAttribute('aria-label',`本次达成 ${stars.count} 项星级目标，新获得 ${newlyEarned.length} 星，累计 ${earnedStars.length} 星`);
    stars.goals.forEach((goal,index)=>{const obtained=earnedStars.includes(goal.id),item=document.createElement('p'),glyph=document.createElement('span'),text=document.createElement('span'),badge=document.createElement('small');item.classList.toggle('earned',obtained);item.classList.toggle('new-earned',newlyEarned.includes(goal.id));item.style.setProperty('--reward-delay',`${180+index*180}ms`);glyph.className='star-glyph';glyph.textContent=obtained?'★ ':'☆ ';text.textContent=goal.label;badge.textContent=newlyEarned.includes(goal.id)?'新获得':goal.earned?'本次达成':obtained?'已获得':'未达成';item.append(glyph,text,badge);starPanel.append(item);});
    const operations=document.createElement('div');operations.className='operation-report';
    const locateRow=(text,cell,detail=text)=>{const row=document.createElement('button');row.type='button';row.className='result-locate';row.textContent=text;row.setAttribute('aria-label',`${text}，在地图中查看`);row.onclick=()=>openResultReplay(cell,detail);operations.append(row);};
    const routeMetrics=city.routes.map((route,index)=>{const total=route.homes.reduce((sum,home)=>sum+home.passengers,0),delivered=city.byRoute[index]||0,homeIndices=city.homes.map((home,hi)=>home.route===index?hi:-1).filter(hi=>hi>=0),worst=homeIndices.sort((a,b)=>(city.homeQueueSeconds[b]||0)-(city.homeQueueSeconds[a]||0)||a-b)[0];return {index,name:route.name,total,delivered,cell:city.homes[worst]?.cell??route.homes[0]?.cell};});
    for(const route of routeMetrics)locateRow(`${route.name}：送达 ${route.delivered} / ${route.total} 人（${route.total?Math.round(route.delivered/route.total*100):0}%） ↗`,route.cell,`${route.name}送达率 ${route.total?Math.round(route.delivered/route.total*100):0}%`);
    const peak=resultPeak,peakIndex=city.maxHomeQueues.indexOf(peak);if(peakIndex>=0){const home=city.homes[peakIndex],p=point(home.cell);locateRow(`住宅最大排队：${peak} 人 · ${city.routes[home.route]?.name||'路线'} (${p.x+1},${p.y+1}) ↗`,home.cell,`本轮最大排队 ${peak} 人`);}
    const roadHotspots=city.roadHotspots();for(const hotspot of roadHotspots){const p=point(hotspot.cell);locateRow(`道路热点 (${p.x+1},${p.y+1})：受阻 ${hotspot.blockedSeconds.toFixed(1)} 车秒 · 占用 ${hotspot.occupancySeconds.toFixed(1)} 车秒 ↗`,hotspot.cell,'本轮累计道路热点');}
    for(const bus of city.busReports().filter(item=>item.boarded||item.alighted||item.rejectedFull)){const row=document.createElement('p');row.textContent=`${bus.name}：上车 ${bus.boarded} · 下车 ${bus.alighted}${bus.transfersIn||bus.transfersOut?` · 换入 ${bus.transfersIn} / 换出 ${bus.transfersOut}`:''} · 平均载客率 ${Math.round(bus.averageLoadRate*100)}% · 满载拒载 ${bus.rejectedFull} · 周转 ${bus.cycles} 圈`;operations.append(row);}
    const transfer=city.transferReport();if(transfer.transfers||transfer.waiting){const row=document.createElement('p');row.textContent=`公交换乘：完成 ${transfer.transfers} 人次 · 仍候车 ${transfer.waiting} 人 · 平均等待 ${transfer.averageWait.toFixed(1)} 秒 · 最大同时候车 ${transfer.maxWaiting} 人`;operations.append(row);}
    const junctionMetrics=[];for(const junction of city.junctionReports()){let queueSeconds=0,maxQueue=0;for(const [entry,data] of Object.entries(junction.entries))if(data.maxQueue){const p=point(junction.cell);queueSeconds+=data.averageWait*data.passed;maxQueue=Math.max(maxQueue,data.maxQueue);locateRow(`路口 (${p.x+1},${p.y+1}) ${SIGNAL_ENTRY_NAMES[entry]}：平均等待 ${data.averageWait.toFixed(1)} 秒 · 最大队列 ${data.maxQueue} 辆 ↗`,junction.cell,'本轮路口排队报告');}junctionMetrics.push({cell:junction.cell,queueSeconds,maxQueue});}
    const comparison=document.createElement('div');comparison.className='personal-best comparison-grid';comparison.classList.toggle('new-best',isBetter);const comparisonTitle=document.createElement('strong');comparisonTitle.textContent=isBetter&&!previousBest?'✦ 首次通关，已记录为个人最佳':isBetter?'✦ 刷新个人最佳！':'本次与个人最佳';const comparisonTable=document.createElement('div');comparisonTable.className='comparison-table';comparisonTable.innerHTML=`<b>指标</b><b>本次</b><b>个人最佳</b><span>满意度</span><span>${currentResult.score}%</span><span>${personalBest?personalBest.score+'%':'—'}</span><span>P95</span><span>${currentResult.p95.toFixed(1)} 秒</span><span>${personalBest?personalBest.p95.toFixed(1)+' 秒':'—'}</span><span>建设点</span><span>${currentResult.cost}</span><span>${personalBest?personalBest.cost:'—'}</span><span>最大排队</span><span>${currentResult.maxQueue} 人</span><span>${personalBest&&Number.isFinite(personalBest.maxQueue)?personalBest.maxQueue+' 人':'—'}</span>`;comparison.append(comparisonTitle,comparisonTable);
    $('result-stats').replaceChildren(summary,meta,starPanel,conservation,distribution,comparison,...(operations.childNodes.length?[operations]:[]));
    showChapter(visibleChapterIndex);
    const nextLesson=levels()[levels().indexOf(city.level)+1]||null,recommendation=$('result-recommendation');
    recommendation.hidden=false;
    if(campaign&&!finalDay){$('result-recommendation-title').textContent=`推荐下一步：第 ${campaign.dayIndex+2} 天`;$('result-recommendation-text').textContent='结算收入到账后，保留路网并应对新建筑与新区域。';}
    else if(won&&nextLesson){$('result-recommendation-title').textContent=`推荐下一课：${nextLesson.name}`;$('result-recommendation-text').textContent=Navigation.lessonSummary(city.level,nextLesson);}
    else if(won){$('result-recommendation-title').textContent='所有课程已完成';$('result-recommendation-text').textContent='可自由重玩关卡，继续补齐星级或尝试不同规划。';}
    else{const advice=TrafficResults.bottleneckAdvice({routes:routeMetrics,homes:resultReplay.homes,roads:resultReplay.roads,junctions:junctionMetrics});$('result-recommendation-title').textContent='根据本轮数据，先尝试这些小调整';$('result-recommendation-text').textContent=advice.length?advice.map((item,index)=>`${index+1}. ${item.text}`).join(' '):'本轮没有形成明显热点；先定位未完成路线，检查道路是否显式连通及目的地容量。';}
    $('next-level').hidden = campaign?!finalDay?false:!won||!nextLesson:!won||!nextLesson;
    $('next-level').textContent=campaign&&!finalDay?'进入下一天规划 ↗':nextLesson?`推荐下一课：${nextLesson.name} ↗`:'下一座小城 ↗';
    $('view-city').hidden=Boolean(campaign&&!finalDay);
    $('result-revise').hidden=won;
    $('play-again').textContent=campaign?'重新开始五天':'再规划一次';
    $('result-reference').hidden=won||!currentReference();
    updateDesignControls();
    if(finalDay&&!campaign.results[campaign.dayIndex])campaign.advance(report.score);
    window.dispatchEvent(new CustomEvent('traffic-game-result',{detail:{levelId:city.level.id,dayIndex:campaign?.dayIndex??null,won,complete:!campaign||Boolean(finalDay),stars:stars.count,totalStars:earnedStars.length}}));
    for(const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    const resultDialog=$('result-dialog'),celebration=$('result-celebration');resultDialog.classList.toggle('result-won',won);resultDialog.classList.remove('rewards-visible');celebration.replaceChildren();
    if(won)for(let index=0;index<18;index++){const piece=document.createElement('i');piece.style.setProperty('--piece-left',`${3+index*5.4}%`);piece.style.setProperty('--piece-drift',`${(index-9)*3}px`);piece.style.setProperty('--piece-rotation',`${index*29}deg`);piece.style.setProperty('--piece-delay',`${index*32}ms`);celebration.append(piece);}
    resultDialog.showModal();requestAnimationFrame(()=>resultDialog.classList.add('rewards-visible'));
  }
  function reset(levelId = city.level.id) {
    const switching=Boolean(city&&levelId!==city.level.id);dismissPendingRestore();lastAutoSaveSignature='';recentLevelId=levelId;
    for(const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    const level=levels().find(item=>item.id===levelId);campaign=gameMode==='challenge'&&level?.campaign?new CampaignSession(levelId):null;city=campaign?campaign.city:new City(levelId,{sandbox:gameMode==='sandbox'});
    resetDesignHistory();
    speed=1;accumulator=0;resultShown=false;resultReplay=null;$('replay-toolbar').hidden=true;pendingCampaignScore=null;pendingRoadOperation=null;dragging=false;lastCell=null;dragDraft=null;selection=null;routeSelection=null;selectionAnchor=null;dimmedBusLines.clear();busEditMode='draw';tutorialUsedRoad=false;tutorialInspected=false;tutorialStarted=false;tutorialForced=false;
    arrivalEffects.reset();
    pendingLevel=null;pendingMode=null;hover=null;keyboardMode=false;keyboardCell=key(1,2);inspectedCell=null;
    focusInitialView();configureLevel();setTool('view');updateUI();draw();toast(switching?city.level.description:`已重新规划「${city.level.name}」`);
    window.dispatchEvent(new CustomEvent('traffic-game-levelchange',{detail:{levelId:city.level.id}}));
  }
  function switchGameMode(mode) {
    if(mode===gameMode||!['challenge','sandbox'].includes(mode))return;
    pendingMode=mode;const entering=mode==='sandbox';
    $('mode-confirm-title').textContent=entering?'把当前方案带入沙盒？':'返回挑战模式？';
    $('mode-confirm-description').textContent=entering?'沙盒副本不会改写当前挑战方案；可复制道路、连接、等级、信号和公交设置后继续实验。':'将恢复进入沙盒前的挑战方案；沙盒中的改动不会覆盖它。';
    $('sandbox-entry-options').hidden=!entering;
    $('confirm-mode').textContent=entering?'进入沙盒':'返回挑战';
    openPausedDialog($('mode-dialog'));
  }
  function activateModeCity(message) {
    resetDesignHistory();speed=1;accumulator=0;resultShown=false;pendingCampaignScore=null;pendingRoadOperation=null;dragging=false;lastCell=null;dragDraft=null;selection=null;routeSelection=null;selectionAnchor=null;dimmedBusLines.clear();busEditMode='draw';arrivalEffects.reset();pendingMode=null;hover=null;keyboardMode=false;keyboardCell=key(1,2);inspectedCell=null;
    focusInitialView();configureLevel();setTool('view');updateUI();draw();toast(message);
  }
  function confirmModeSwitch() {
    if(pendingMode==='sandbox') {
      const source=city,copy=$('copy-to-sandbox').checked,unlimited=$('sandbox-entry-budget').value==='unlimited';
      challengeReturn={city:source,campaign};
      const options={sandbox:true,unlimitedBudget:unlimited,budget:source.budget,fixedCost:copy?source.fixedCost:0,routes:copy?source.routes:undefined};
      if(copy&&campaign)Object.assign(options,{pendingBuildings:[...source.pendingBuildings.values()],dormantBuildings:[...source.dormantBuildings.values()],lockedRegions:[...new Map([...source.lockedRegions.values()].map(region=>[region.id,region])).values()]});
      const sandboxCity=new City(source.level.id,options),message=copy?sandboxCity.loadDesign(source.serializeDesign()):'';
      if(message){challengeReturn=null;toast(message);closePausedDialog($('mode-dialog'));return;}
      delete $('mode-dialog').dataset.resumeOperation;$('mode-dialog').close();city=sandboxCity;campaign=null;gameMode='sandbox';activateModeCity(copy?'已复制当前挑战方案，可在沙盒中放心改造':'已进入空白沙盒');
      return;
    }
    if(pendingMode==='challenge') {
      delete $('mode-dialog').dataset.resumeOperation;$('mode-dialog').close();gameMode='challenge';
      if(challengeReturn){({city,campaign}=challengeReturn);challengeReturn=null;activateModeCity('已恢复进入沙盒前的挑战方案');}
      else reset(city.level.id);
    }
  }
  function lockedRegionList(){return [...new Map([...city.lockedRegions.values()].map(region=>[region.id,region])).values()];}
  function regionLockPosition(region) {
    const points=region.cells.map(point),top=Math.min(...points.map(item=>item.y)),topCells=points.filter(item=>item.y===top).sort((a,b)=>a.x-b.x),anchor=topCells[Math.floor((topCells.length-1)/2)];
    return {x:anchor.x+.5,y:anchor.y+.18};
  }
  function eventPoint(event) { const rect=canvas.getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top}; }
  function eventCell(event) {
    const p=eventPoint(event),x=Math.floor((p.x-viewX)/cellSize),y=Math.floor((p.y-viewY)/cellSize);
    return x>=0&&x<city.width&&y>=0&&y<city.height?key(x,y):null;
  }
  function eventRegion(event) {
    const p=eventPoint(event);
    for(const region of lockedRegionList()){const lock=regionLockPosition(region),x=viewX+lock.x*cellSize,y=viewY+lock.y*cellSize;if(Math.hypot(p.x-x,p.y-y)<=Math.max(18,cellSize*.34))return region;}
    const cell=eventCell(event);return cell===null?null:city.lockedRegions.get(cell)||null;
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
    if(dragDraft.kind===null) dragDraft.kind='build';
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
    if(!dragDraft)return;
    if(dragDraft.path.length<2){if(tool==='road')toast('请按住并拖到相邻格；单击不会铺路或建立连接');return;}
    const before=designSnapshot(),{path,kind}=dragDraft,gradeChanges=dragGradeChanges(),newRoads=dragNewRoads();let actions=[];
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
      for(let i=1;i<path.length;i++) actions.push({type:'connect',a:path[i-1],b:path[i],grade:dragDraft.sourceGrade});
    } else if(kind==='cut') for(let i=1;i<path.length;i++) actions.push({type:'cut',a:path[i-1],b:path[i]});
    else if(kind==='erase') {
      const cells=path.filter(n=>city.roads.has(n));
      actions=[...new Set(cells)].map(cell=>({type:'edit',cell,erase:true,grade:0}));
    }
    const message=city.transact(actions);recordDesignChange(before);
    toast(message||(kind==='erase'?'已拆除所经道路，预算已返还':kind==='cut'?'已剪断所经连接':dragDraft.sourceGrade!==null?`规划已应用：新建 ${newRoads.length} 格、改造 ${gradeChanges.length} 格${ROAD_TYPES[dragDraft.sourceGrade].name}`:'规划已一次性应用'));
  }
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('wheel',e=>{
    if(!e.ctrlKey)return;
    e.preventDefault();const p=eventPoint(e),factor=Math.exp(-e.deltaY*.004);setZoom(viewZoom*factor,p.x,p.y);draw();
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
    const pressedCell=eventCell(e),pressedRegion=eventRegion(e);
    if(!adminMode&&pressedRegion){dragging=false;hover=pressedCell;openRegionDialog(pressedRegion);return;}
    if(tool==='view'){panLast=p;hover=null;return;}
    keyboardAnchor=null;keyboardMode=false;dragging=true;hover=eventCell(e);showTouchCoordinate(hover,e.pointerType==='touch');if(hover===null)return;
    if(tool==='select'){routeSelection=null;selectionAnchor=hover;selection={start:hover,end:hover};updateUI();draw();return;}
    if(tool==='bus'){const problem=busDraftProblem(hover);if(problem){dragging=false;toast(problem);return;}}
    lastCell=hover;dragGrade=city.roads.has(hover)?city.roadGrades.get(hover)||0:0;
    dragDraft={kind:tool==='cut'?'cut':tool==='bus'?(busEditMode==='trim'?'bus-trim':'bus'):null,path:[hover],sourceGrade:tool==='road'&&city.level.features.grade&&city.roads.has(hover)?dragGrade:null};draw();
  });
  canvas.addEventListener('pointermove',e=>{
    const previous=pointers.get(e.pointerId),p=eventPoint(e);if(previous)pointers.set(e.pointerId,p);
    if(pinch&&pointers.size>=2){
      const [a,b]=[...pointers.values()],center={x:(a.x+b.x)/2,y:(a.y+b.y)/2},distance=Math.hypot(a.x-b.x,a.y-b.y);
      viewZoom=Math.max(1,Math.min(5,pinch.zoom*distance/Math.max(1,pinch.distance)));cellSize=Math.min(viewportWidth/city.width,viewportHeight/city.height)*viewZoom;
      viewX=center.x-pinch.worldX*cellSize;viewY=center.y-pinch.worldY*cellSize;draw();return;
    }
    if(tool==='view'&&panLast&&previous){moveView(p.x-previous.x,p.y-previous.y);panLast=p;draw();return;}
    keyboardMode=false;hover=eventCell(e);announceCell(hover);showTouchCoordinate(hover,e.pointerType==='touch'&&dragging);if(!dragging||hover===null)return;
    if(tool==='select'){routeSelection=null;selection={start:selectionAnchor,end:hover};updateUI();draw();}else paint(hover);
  });
  const endPointer=e=>{
    pointers.delete(e.pointerId);if(!pointers.size)showTouchCoordinate(null,false);
    if(pinch){if(pointers.size<2){pinch=null;panLast=null;snapView();}draw();return;}
    if(tool==='view'){panLast=null;snapView();draw();return;}
    if(dragging&&tool!=='select')commitDrag();
    dragging=false;lastCell=null;dragDraft=null;selectionAnchor=null;updateUI();draw();
  };
  canvas.addEventListener('pointerup',endPointer);canvas.addEventListener('pointercancel',endPointer);canvas.addEventListener('lostpointercapture',e=>{if(pointers.has(e.pointerId))endPointer(e);});
  canvas.addEventListener('pointerleave',()=>{if(!dragging&&tool!=='view')hover=null;});
  $('view-tool').onclick=()=>setTool('view');$('close-inspector').onclick=()=>setTool('view');$('close-bus-drawer').onclick=()=>setTool('view');
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
  $('bus-headway').onchange=()=>{const headway=Number($('bus-headway').value),message=mutateDesign(()=>city.updateBusLine(city.activeBusLineId,{headway}));toast(message||`已设置 ${headway} 秒发车间隔`);updateUI();};
  $('trim-bus').onclick=()=>{
    if(tool==='bus'&&busEditMode==='trim') {
      busEditMode='draw';dragging=false;dragDraft=null;lastCell=null;toast('已取消反向擦除，可以继续绘制线路');
    } else {
      busEditMode='trim';setTool('bus');toast('请从当前线路末端开始，沿线路反向拖动擦除；再次点击或按 Esc 取消');
    }
    updateUI();draw();
  };
  $('bus-return-trip').onchange=()=>{const enabled=$('bus-return-trip').checked,message=mutateDesign(()=>city.updateBusLine(city.activeBusLineId,{returnTrip:enabled}));toast(message||(enabled?'已开启原路返回；可另行启用返程停站':'已关闭原路返回；运营前须完成闭环'));updateUI();draw();};
  $('bus-return-stops').onchange=()=>{const enabled=$('bus-return-stops').checked,message=mutateDesign(()=>city.updateBusLine(city.activeBusLineId,{returnStops:enabled}));toast(message||(enabled?'返程现在也会上下客':'返程已恢复不停站'));updateUI();draw();};
  $('redraw-bus').onclick=()=>{const message=mutateDesign(()=>city.setBusRoute([]));if(message){toast(message);return;}busEditMode='draw';setTool('bus');toast('当前线路已清空，请从起点分段绘制');updateUI();draw();};
  $('delete-bus').onclick=()=>{const name=city.activeBusLine?.name,message=mutateDesign(()=>city.deleteBusLine());toast(message||`已删除${name?'「'+name+'」':''}并返还车辆预算`);updateUI();draw();};
  $('signal-enabled').onchange=()=>applySignalSettings({enabled:$('signal-enabled').checked},$('signal-enabled').checked?'已开启红绿灯':'已关闭红绿灯');
  $('signal-yield-mode').onchange=()=>applySignalSettings({yieldMode:$('signal-yield-mode').value},$('signal-yield-mode').value==='priority'?'已启用入口方向优先':'已启用自动让行');
  $('signal-automatic').onchange=()=>applySignalSettings({automatic:$('signal-automatic').checked},$('signal-automatic').checked?'已启用自动信号调度':'已启用手动信号调度');
  $('signal-cycle').onchange=()=>applySignalSettings({green:Number($('signal-cycle').value)},'绿灯周期已更新');
  $('suggest-signal-phases').onclick=()=>{const phases=city.suggestSignalPhases(inspectedCell);previewSignalPhaseIndex=0;applySignalSettings({enabled:true,automatic:false,phases,phaseGreens:phases.map(()=>2)},'已按当前预计车流生成无冲突灯序');};
  $('add-signal-phase').onclick=()=>{
    const signal=city.signals.get(inspectedCell);if(!signal)return;
    applySignalSettings({phases:[...signal.phases.map(actions=>[...actions]),['north-straight']],phaseGreens:[...signal.phaseGreens,2]},'已添加信号阶段');
  };
  $('unlock-region').onclick=()=>{const cell=selectedCells()[0],region=cell===undefined?null:city.lockedRegions.get(cell);if(region)openRegionDialog(region);};
  $('cancel-region').onclick=()=>{pendingRegionId=null;$('region-dialog').close();};
  $('confirm-region').onclick=()=>{
    const id=pendingRegionId;pendingRegionId=null;$('region-dialog').close();if(!id)return;
    const region=(campaign.level.campaign.regions||[]).find(item=>item.id===id),message=campaign.unlockRegion(id);if(message){toast(message);return;}
    city=campaign.city;selection=null;routeSelection=null;inspectedCell=null;resetDesignHistory();configureLevel();updateUI();draw();toast(`已开放「${region.name}」，支出 ${region.cost} 点建设点`);
  };
  $('region-dialog').addEventListener('cancel',event=>{event.preventDefault();pendingRegionId=null;$('region-dialog').close();});
  $('build-road').onclick=()=>{
    const cells=selectedCells();if(cells.length!==1)return;
    const message=mutateDesign(()=>city.transact([{type:'edit',cell:cells[0],erase:false,grade:0}]));
    toast(message||'已建设一格支路；拖拽可建立连接');updateUI();draw();
  };
  $('select-road-route').onclick=()=>{const cells=roadSegment(selectedCells()[0]);if(!cells.length)return;routeSelection=cells;updateUI();draw();toast(`已选中路口之间的 ${cells.length} 格道路`);};
  $('upgrade-road').onclick=()=>requestRoadOperation('upgrade');
  $('downgrade-road').onclick=()=>requestRoadOperation('downgrade');
  $('prefer-road').onclick=()=>{const roads=selectedCells().filter(cell=>city.roads.has(cell)),message=mutateDesign(()=>city.setRoadPolicy(roads,'prefer'));toast(message||`已将 ${roads.length} 格设为汽车偏好道路`);updateUI();draw();};
  $('avoid-road').onclick=()=>{const roads=selectedCells().filter(cell=>city.roads.has(cell)),message=mutateDesign(()=>city.setRoadPolicy(roads,'avoid'));toast(message||`已将 ${roads.length} 格设为小汽车禁行，公交仍可通行`);updateUI();draw();};
  $('clear-road-policy').onclick=()=>{const roads=selectedCells().filter(cell=>city.roads.has(cell)),message=mutateDesign(()=>city.setRoadPolicy(roads,null));toast(message||'已清除选区道路引导');updateUI();draw();};
  $('remove-road').onclick=removeSelectedRoads;
  $('quick-upgrade-road').onclick=()=>requestRoadOperation('upgrade');
  $('quick-downgrade-road').onclick=()=>requestRoadOperation('downgrade');
  $('quick-remove-road').onclick=removeSelectedRoads;
  $('cancel-road-operation').onclick=()=>{pendingRoadOperation=null;$('road-operation-dialog').close();};
  $('confirm-road-operation').onclick=()=>{const operation=pendingRoadOperation;pendingRoadOperation=null;$('road-operation-dialog').close();if(operation)applyRoadOperation(operation.kind,operation.cells);};
  $('road-operation-dialog').addEventListener('cancel',event=>{event.preventDefault();pendingRoadOperation=null;$('road-operation-dialog').close();});
  $('undo-design').onclick=()=>restoreDesign(designHistoryIndex-1);
  $('redo-design').onclick=()=>restoreDesign(designHistoryIndex+1);
  $('context-guide-action').onclick=()=>{
    if(!activeGuide)return;let target=canvas;
    if(activeGuide.action==='road')target=$('road-tool');
    else if(activeGuide.action==='select'||activeGuide.action==='grade'||activeGuide.action==='signals')target=$('select-tool');
    else if(activeGuide.action==='cut')target=$('cut-tool');
    else if(activeGuide.action==='bus')target=$('bus-tool');
    else if(activeGuide.action==='start')target=$('start');
    target.scrollIntoView({block:'center'});target.focus();
  };
  $('skip-context-guide').onclick=()=>{if(activeGuide?.number)storeTutorialDone();else if(activeGuide?.id)storeMechanicSeen(activeGuide.id);tutorialForced=false;activeGuide=null;activeGuideLevelId=null;renderContextGuide();};
  $('reopen-tutorial').onclick=()=>{if(city.state!=='planning'){closePausedDialog($('help-dialog'));toast('请先停止运营，再重新打开操作引导');return;}closePausedDialog($('help-dialog'),false);tutorialForced=true;tutorialUsedRoad=false;tutorialStarted=false;tutorialInspected=false;renderContextGuide();$('context-guide').scrollIntoView({block:'center'});};
  $('continue-game').onclick=()=>{
    if(!pendingRestore)return;
    ({city,campaign}=pendingRestore);gameMode=pendingRestore.mode;pendingRestore=null;$('continue-game').hidden=true;autoSaveSuspended=false;lastAutoSaveSignature='';
    speed=1;accumulator=0;resultShown=false;pendingCampaignScore=null;arrivalEffects.reset();resetDesignHistory();buildLevelButtons();focusInitialView();configureLevel();setTool('view');updateUI();draw();
    toast(`已继续「${city.level.name}」${campaign?`第 ${campaign.dayIndex+1} 天`:''}的规划`);
  };
  $('clear-progress').onclick=()=>openPausedDialog($('clear-progress-dialog'));
  $('cancel-clear-progress').onclick=()=>closePausedDialog($('clear-progress-dialog'));
  $('confirm-clear-progress').onclick=()=>{
    const message=ProgressStorage.clear(localStorage);closePausedDialog($('clear-progress-dialog'));
    if(message){toast(message);return;}pendingRestore=null;$('continue-game').hidden=true;autoSaveSuspended=false;lastAutoSaveSignature=autoSaveSignature();toast('已清除自动进度；手动设计和成绩仍保留');
  };
  $('clear-progress-dialog').addEventListener('cancel',event=>{event.preventDefault();closePausedDialog($('clear-progress-dialog'));});
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
    speed=1;accumulator=0;resultShown=false;inspectedCell=null;routeSelection=null;resetDesignHistory();updateUI();draw();toast('已读取设计，可以重新规划或开始运营');
  };
  let resetBeforeReference=false,referenceReturnDay=null;
  function openReference() {
    if(!currentReference()||!referenceUnlocked())return;
    resetBeforeReference=city.state!=='planning';referenceReturnDay=campaign?.referenceDivergenceDay!==null&&campaign.referenceDivergenceDay<campaign.dayIndex?campaign.referenceDivergenceDay:null;
    if(referenceReturnDay!==null){$('reference-dialog-title').textContent=`回到第 ${referenceReturnDay+1} 天使用参考答案？`;$('reference-dialog-description').textContent=`当前进度从第 ${referenceReturnDay+1} 天起偏离了参考方案，后续答案无法安全套用。将回到该日运营前、载入该日答案，并清除该日及之后的运营与收入记录。`;$('confirm-reference').textContent=`回到第 ${referenceReturnDay+1} 天并载入`;}
    else{$('reference-dialog-title').textContent='载入当前参考答案？';$('reference-dialog-description').textContent='当前规划会被完整参考设计替换，包括道路、连接、等级、引导、信号灯和公交线路。多日任务会保留已完成日期、累计收入和实际预算；资金不足时不会载入。载入后仍由你决定何时开始运营，也可以继续修改。';$('confirm-reference').textContent='载入参考答案';}
    if($('result-dialog').open)$('result-dialog').close();
    $('reference-dialog').showModal();
  }
  $('reference-design').onclick=openReference;
  $('result-reference').onclick=openReference;
  $('cancel-reference').onclick=()=>{resetBeforeReference=false;referenceReturnDay=null;$('reference-dialog').close();};
  $('confirm-reference').onclick=()=>{
    const levelId=city.level.id,shouldReset=resetBeforeReference;resetBeforeReference=false;$('reference-dialog').close();
    if(campaign&&referenceReturnDay!==null){
      const returnDay=referenceReturnDay;referenceReturnDay=null;const replayMessage=campaign.replay(returnDay);if(replayMessage){toast('参考答案无法载入：'+replayMessage);return;}
      const message=campaign.loadReference(returnDay);if(message){toast('参考答案无法载入：'+message);return;}unlockReference(levelId,returnDay);city=campaign.city;
      speed=1;accumulator=0;resultShown=false;pendingCampaignScore=null;arrivalEffects.reset();resetDesignHistory();configureLevel();setTool('view');updateUI();draw();toast(`已回到第 ${returnDay+1} 天并载入参考答案，请从这里重新推进`);return;
    }
    const referenceDay=campaign?.dayIndex??null;
    if(shouldReset&&campaign){
      const replayMessage=campaign.replay(referenceDay);if(replayMessage){toast('参考答案无法载入：'+replayMessage);$('result-dialog').showModal();return;}
      city=campaign.city;speed=1;accumulator=0;resultShown=false;pendingCampaignScore=null;arrivalEffects.reset();resetDesignHistory();configureLevel();setTool('view');
    }else if(shouldReset)reset(levelId);
    const message=campaign?campaign.loadReference(referenceDay):city.loadDesign(currentReference());
    if(message){toast('参考答案无法载入：'+message);return;}
    speed=1;accumulator=0;resultShown=false;inspectedCell=null;resetDesignHistory();updateUI();draw();toast(`已载入${referenceDay===null?'':`第 ${referenceDay+1} 天`}参考答案，可以继续修改或开始运营`);
  };
  function beginOperation() {
    dismissPendingRestore();saveAutoProgress();
    const planning=city.state==='planning',message=campaign?campaign.beginDay():city.toggle();
    if(message){toast(message);updateUI();return;}
    if(planning){markLevelStarted();tutorialStarted=true;storeTutorialDone();setTool('view');}
    accumulator=0;updateUI();
  }
  function toggleOperation() {
    if(city.state!=='planning'){beginOperation();return;}
    const report=city.preflightCheck();
    if(!report.issues.length){toast(`运营前检查通过 · 理论可送达 ${report.maxDeliverable} / ${report.target} 人`);beginOperation();return;}
    $('preflight-title').textContent=report.blocking?'地图设计有问题':'运营前发现需要确认的问题';
    $('preflight-summary').textContent=report.blocking?`发现 ${report.issues.filter(issue=>issue.blocking).length} 项必须修正的问题；问题位置已在下方列出。`:`发现 ${report.issues.length} 项提示；当前理论最多可送达 ${report.maxDeliverable} / ${report.target} 人。`;
    const rows=report.issues.map(issue=>{
      const row=document.createElement('li');row.classList.toggle('preflight-target',issue.code==='target-impossible');row.classList.toggle('preflight-blocking',Boolean(issue.blocking));
      const title=document.createElement('strong');title.textContent=issue.title;
      const detail=document.createElement('span');detail.textContent=issue.detail;row.append(title,detail);
      if(issue.cells?.length){const locate=document.createElement('button');locate.type='button';locate.className='tool';locate.textContent='在地图中查看';locate.onclick=()=>{$('preflight-dialog').close();setTool('select');selectSingleCell(issue.cells[0]);updateUI();draw();canvas.scrollIntoView({block:'center'});};row.append(locate);}
      return row;
    });
    $('preflight-note').textContent=report.blocking?'存在冲突的手动灯序时不能开始运营。请定位问题路口并修改，或改用自动信号灯。':'检查只提供规划提示，不会阻止开始。无效公交线路将不发车，其余交通按当前设计运行。';
    $('confirm-preflight').hidden=report.blocking;
    $('preflight-list').replaceChildren(...rows);$('preflight-dialog').showModal();
  }
  $('start').onclick=toggleOperation;
  $('cancel-preflight').onclick=()=>$('preflight-dialog').close();
  $('confirm-preflight').onclick=()=>{$('preflight-dialog').close();beginOperation();};
  $('stop').onclick=()=>{$('stop-dialog').querySelector('h2').textContent=city.sandbox?'只重置沙盒交通？':'停止运营并重新规划？';$('stop-dialog').querySelector('p').textContent=city.sandbox?'道路、连接、等级、信号和公交方案会完整保留；只清空车辆、乘客、排队、统计和计时。':'当前道路、道路等级、信号和公交线路会保留；车辆、车上乘客、成绩、排队和计时会被清空。';$('confirm-stop').textContent=city.sandbox?'重置交通':'停止并规划';openPausedDialog($('stop-dialog'));};
  $('cancel-stop').onclick=()=>closePausedDialog($('stop-dialog'));
  $('confirm-stop').onclick=()=>{delete $('stop-dialog').dataset.resumeOperation;city.stop();speed=1;accumulator=0;$('stop-dialog').close();updateUI();draw();toast(city.sandbox?'已重置交通，沙盒设计保持不变':'已停止运营，设计已保留');};
  $('speed').onclick=()=>{const options=speedOptions();speed=options[(options.indexOf(speed)+1)%options.length];if(city.sandbox)$('sandbox-speed').value=String(speed);updateUI();};
  $('sandbox-budget').onchange=()=>{const message=city.setSandboxSettings({unlimitedBudget:$('sandbox-budget').value==='unlimited'});if(message){$('sandbox-budget').value=city.unlimitedBudget?'unlimited':'level';toast(message);}else{dismissPendingRestore();toast(city.unlimitedBudget?'已启用无限预算':'已恢复本关预算');}updateUI();};
  $('sandbox-demand').onchange=()=>{const message=city.setSandboxSettings({demandMultiplier:Number($('sandbox-demand').value)});if(message)toast(message);else{dismissPendingRestore();configureLevel();toast(`需求倍率已调整为 ${city.demandMultiplier}×`);}updateUI();draw();};
  $('sandbox-speed').onchange=()=>{speed=Number($('sandbox-speed').value);accumulator=0;updateUI();toast(`运营速度已调整为 ${speed}×`);};
  $('sandbox-continuous').onchange=()=>{city.setSandboxSettings({continuousDemand:$('sandbox-continuous').checked});dismissPendingRestore();updateUI();toast(city.continuousDemand?'已开启持续饱和流量':'已恢复关卡总需求上限');};
  $('reset-traffic').onclick=()=>{if(city.stop()){speed=1;accumulator=0;$('sandbox-speed').value='1';updateUI();draw();toast('已重置交通，所有设计保持不变');}};
  $('challenge-mode').onclick=()=>switchGameMode('challenge');
  $('sandbox-mode').onclick=()=>switchGameMode('sandbox');
  $('help').onclick=()=>openPausedDialog($('help-dialog'));
  document.querySelector('.dialog-close').onclick=()=>closePausedDialog($('help-dialog'));
  document.querySelector('.dialog-done').onclick=()=>closePausedDialog($('help-dialog'));
  $('reset').onclick=()=>openPausedDialog($('reset-dialog'));
  $('cancel-reset').onclick=()=>closePausedDialog($('reset-dialog'));
  $('confirm-reset').onclick=()=>{delete $('reset-dialog').dataset.resumeOperation;reset();};
  $('play-again').onclick=()=>reset();$('view-city').onclick=()=>openResultReplay();
  $('result-revise').onclick=reviseResultDesign;$('replay-revise').onclick=reviseResultDesign;
  $('replay-report').onclick=()=>{$('replay-toolbar').hidden=true;draw();$('result-dialog').showModal();};
  for(const button of document.querySelectorAll('.mobile-info-tabs button')) {
    button.setAttribute('aria-pressed', String(button.classList.contains('active')));
    button.onclick=()=>{
      for(const item of document.querySelectorAll('.mobile-info-tabs button')) {
        item.classList.toggle('active',item===button);
        item.setAttribute('aria-pressed',String(item===button));
      }
      for(const panel of document.querySelectorAll('[data-info-panel]'))panel.classList.toggle('mobile-active',panel.dataset.infoPanel===button.dataset.mobilePanel);
    };
  }
  document.querySelector('[data-info-panel="mission"]').classList.add('mobile-active');
  $('cancel-level').onclick=()=>{pendingLevel=null;closePausedDialog($('level-dialog'));};
  $('confirm-level').onclick=()=>{delete $('level-dialog').dataset.resumeOperation;if(pendingLevel)reset(pendingLevel);};
  $('cancel-mode').onclick=()=>{pendingMode=null;closePausedDialog($('mode-dialog'));};
  $('confirm-mode').onclick=confirmModeSwitch;
  for(const id of ['help-dialog','reset-dialog','level-dialog','mode-dialog','stop-dialog']) $(id).addEventListener('cancel',event=>{event.preventDefault();if(id==='level-dialog')pendingLevel=null;if(id==='mode-dialog')pendingMode=null;closePausedDialog($(id));});
  $('preflight-dialog').addEventListener('cancel',event=>{event.preventDefault();$('preflight-dialog').close();});
  $('result-dialog').addEventListener('cancel',event=>{if(campaign&&campaign.dayIndex<campaign.days.length-1)event.preventDefault();});
  $('next-level').onclick=()=>{
    if(campaign&&campaign.dayIndex<campaign.days.length-1){campaign.advance(pendingCampaignScore);city=campaign.city;pendingCampaignScore=null;resultReplay=null;$('replay-toolbar').hidden=true;$('result-dialog').close();speed=1;accumulator=0;resultShown=false;arrivalEffects.reset();resetDesignHistory();focusInitialView();configureLevel();setTool('view');updateUI();draw();toast(`第 ${campaign.dayIndex+1} 天已开始规划，昨日收入已到账`);return;}
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
      keyboardCell=key(Math.max(0,Math.min(city.width-1,x)),Math.max(0,Math.min(city.height-1,y)));announceCell(keyboardCell);
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
          dragDraft={kind:tool==='cut'?'cut':tool==='bus'?(busEditMode==='trim'?'bus-trim':'bus'):null,path:[keyboardCell],sourceGrade:tool==='road'&&city.level.features.grade&&city.roads.has(keyboardCell)?dragGrade:null};
          toast(tool==='bus'?(busEditMode==='trim'?'用方向键沿线路反向擦除，空格提交':'用方向键从末端续画，空格提交本段'):'用方向键预览路径，空格一次性提交，Esc 取消');
        } else {
          commitDrag();keyboardAnchor=null;lastCell=null;dragDraft=null;
        }
      } else {
        selectSingleCell(keyboardCell);toast('已选择当前格子，请使用下方区域操作区');
      }
      updateUI();draw();
    }
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&city.state==='running'){city.toggle();accumulator=0;updateUI();}});
  function frame(now) {
    const delta=lastFrame?Math.min((now-lastFrame)/1000,.25):0;lastFrame=now;
    if(viewTarget){const amount=Math.min(1,delta*14);viewX+=(viewTarget.x-viewX)*amount;viewY+=(viewTarget.y-viewY)*amount;if(Math.hypot(viewTarget.x-viewX,viewTarget.y-viewY)<.25){viewX=viewTarget.x;viewY=viewTarget.y;viewTarget=null;}}
    if(city.state==='running') {
      if(speed===Infinity) {
        const maxSteps=Math.ceil(Math.max(0,city.duration-city.elapsed)/.05)+2;
        for(let step=0;step<maxSteps&&city.state==='running';step++)city.step(.05);
        accumulator=0;
      } else {
        accumulator+=delta*speed;
        while(accumulator>=.05){city.step(.05);accumulator-=.05;}
      }
    } else accumulator=0;
    arrivalEffects.sync(city);arrivalEffects.step(delta);
    updateUI();draw();requestAnimationFrame(frame);
  }
  new ResizeObserver(resize).observe(canvas);
  window.TrafficGameAdmin = {
    applyCatalog(catalog, levelId) {
      const message=TrafficCore.setLevels(catalog);if(message)throw new Error(message);
      TrafficGameBootstrap.validateRuntimeCatalog(TrafficCore);
      const requested=TrafficCore.LEVELS.some(item=>item.id===levelId)?levelId:TrafficCore.LEVELS[0].id;
      buildLevelButtons();reset(requested);
    },
    selectLevel(levelId) { if(TrafficCore.LEVELS.some(item=>item.id===levelId))reset(levelId); },
    currentLevelId() { return city?.level.id||null; },
    campaignDayIndex() { return campaign?.dayIndex??null; },
    selectedCells() { return city?selectedCells():[]; },
    selectCell(cell) { if(city&&Number.isInteger(cell)&&cell>=0&&cell<city.width*city.height){setTool('select');selectSingleCell(cell);keyboardCell=cell;updateUI();draw();} },
    applyDesign(design) { if(!city||city.state!=='planning')return '请先停止运营';const message=city.loadDesign(design);if(!message){routeSelection=null;resetDesignHistory();updateUI();draw();}return message; },
    prepareCampaignReferenceDay(dayIndex) {
      const levelId=city?.level.id,target=levels().find(item=>item.id===levelId);if(!target?.campaign)return '当前关卡不是多日任务';
      if(!Number.isInteger(dayIndex)||dayIndex<0||dayIndex>=target.campaign.days.length)return '参考答案日期无效';
      const prepared=new CampaignSession(levelId);
      for(let index=0;index<dayIndex;index++){const outcome=prepared.runReferenceDay();if(!outcome.ok)return `第 ${outcome.day} 天参考答案运行失败：${outcome.error}`;}
      for(const region of prepared.availableRegions()){const message=prepared.unlockRegion(region.id);if(message)return `第 ${dayIndex+1} 天扩建区域开放失败：${message}`;}
      if(prepared.reference()){const message=prepared.loadReference(dayIndex,true);if(message)return `第 ${dayIndex+1} 天参考答案加载失败：${message}`;}
      campaign=prepared;city=campaign.city;speed=1;accumulator=0;resultShown=false;pendingCampaignScore=null;arrivalEffects.reset();resetDesignHistory();configureLevel();setTool('view');updateUI();draw();return '';
    },
    captureDesign() { return city?city.serializeDesign():null; }
  };
  async function bootstrap() {
    try {
      if(window.TrafficAdminReady) {
        const catalog=await window.TrafficAdminReady,message=TrafficCore.setLevels(catalog);
        if(message)throw new Error(message);
        TrafficGameBootstrap.validateRuntimeCatalog(TrafficCore);
      } else await TrafficGameBootstrap.loadActiveCatalog({ core: TrafficCore, catalogLoader: TrafficLevelCatalog });
      city = new City(TrafficCore.LEVELS[0].id);loadTutorialState();loadStartedLevels();
      let restoreProblem='';
      if(!adminMode){
        const stored=ProgressStorage.read(localStorage);restoreProblem=stored.error;
        if(stored.snapshot)try{pendingRestore=ProgressStorage.restoreSnapshot(stored.snapshot,TrafficCore);recentLevelId=pendingRestore.city.level.id;}
        catch(error){restoreProblem=error.message;ProgressStorage.clear(localStorage);}
      }
      resetDesignHistory();
      buildLevelButtons();
      configureLevel();resize();setTool('view');updateUI();
      if(pendingRestore){const day=pendingRestore.campaign?` · 第 ${pendingRestore.campaign.dayIndex+1} 天`:'';$('continue-game').textContent=`继续「${pendingRestore.city.level.name}」${day}`;$('continue-game').hidden=false;}
      else{autoSaveSuspended=false;lastAutoSaveSignature=autoSaveSignature();}
      if(restoreProblem)toast(`${restoreProblem}，已安全回到新游戏`);
      requestAnimationFrame(frame);
      window.dispatchEvent(new CustomEvent('traffic-game-ready',{detail:{levelId:city.level.id}}));
    } catch (error) {
      console.error(error);
      $('toast').textContent = '关卡数据加载失败，请确认游戏服务正常运行后刷新页面。';
      $('toast').classList.add('visible');
    }
  }
  bootstrap();
})();
