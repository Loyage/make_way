(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const clone = value => JSON.parse(JSON.stringify(value));
  let resolveReady;
  window.TrafficAdminReady = new Promise(resolve => { resolveReady = resolve; });
  window.TrafficAdminCatalog = null;

  async function api(path, options = {}) {
    const response = await fetch(path, { headers: options.body ? { 'Content-Type': 'application/json' } : {}, ...options });
    let data = {};
    try { data = await response.json(); } catch { /* ignore */ }
    if (!response.ok) {
      const error=new Error(data.error || `请求失败（${response.status}）`);error.errors=Array.isArray(data.errors)?data.errors:[];throw error;
    }
    return data;
  }
  function reveal(catalog) {
    window.TrafficAdminCatalog = clone(catalog);
    $('admin-login').hidden = true;
    $('admin-inspector').hidden = false;
    resolveReady(clone(catalog));
  }
  async function trySession() {
    try { reveal((await api('/api/levels')).catalog); }
    catch { $('admin-login').hidden = false; }
  }
  $('admin-login-form').addEventListener('submit', async event => {
    event.preventDefault();const error=$('admin-login-error');error.textContent='';
    try { await api('/api/login',{method:'POST',body:JSON.stringify({password:$('admin-password').value})});reveal((await api('/api/levels')).catalog); }
    catch (problem) { error.textContent='登录失败：'+problem.message; }
  });
  trySession();

  let catalog = null, chapterIndex = 0, levelIndex = 0, routeIndex = 0, dayIndex = 0;
  let savedSnapshot = '', history = [], historyIndex = -1, validationTimer = 0, trial = null;
  const verifiedLevels = new Map();
  const chapters = () => catalog?.chapters || [];
  const chapter = () => chapters()[chapterIndex] || null;
  const level = () => chapter()?.levels[levelIndex] || null;
  const routes = () => level()?.campaign?.routes || level()?.routes || [];
  const route = () => routes()[routeIndex] || null;
  const snapshot = () => JSON.stringify(catalog);
  const selectedCells = () => window.TrafficGameAdmin?.selectedCells() || [];
  const allLevels = () => chapters().flatMap(item => item.levels);
  const levelFingerprint = target => JSON.stringify(target);
  function trustCurrentCatalog(){verifiedLevels.clear();for(const item of allLevels())verifiedLevels.set(item.id,levelFingerprint(item));}
  function unverifiedLevels(){return allLevels().filter(item=>verifiedLevels.get(item.id)!==levelFingerprint(item));}
  function updateTrialStatus(){
    const target=level(),el=$('admin-trial-status');if(!target||!el)return;
    const fingerprint=levelFingerprint(target),active=trial?.levelId===target.id&&trial.fingerprint===fingerprint,verified=verifiedLevels.get(target.id)===fingerprint;
    el.className='admin-trial-status '+(verified?'verified':'pending');
    el.textContent=verified?'✓ 当前关卡版本已通过试玩门禁':active?'试玩进行中：请使用玩家工具实际通关；失败后可重新验证试玩。':'当前关卡已修改：发布前须点击“验证并试玩”并实际通关。';
  }
  function syncCampaign(target = level()) {
    if (target?.campaign?.routes) target.routes = TrafficCore.materializeCampaignRoutes(target,0,[]);
  }
  function dirtyLabel(text) {
    const dirty=snapshot()!==savedSnapshot,el=$('admin-dirty');el.classList.toggle('dirty',dirty);el.innerHTML=`<i></i>${text||(dirty?'草稿未发布':'已发布')}`;
  }
  function updateHistory() { $('admin-undo').disabled=historyIndex<=0;$('admin-redo').disabled=historyIndex>=history.length-1; }
  function pushHistory() {
    const value=snapshot();if(history[historyIndex]===value)return;
    history=history.slice(0,historyIndex+1);history.push(value);if(history.length>61)history.shift();historyIndex=history.length-1;updateHistory();
  }
  function goToIssue(issue) {
    const ci=chapters().findIndex(item=>item.id===issue.chapterId);if(ci>=0){chapterIndex=ci;const li=chapters()[ci].levels.findIndex(item=>item.id===issue.levelId);if(li>=0)levelIndex=li;}
    routeIndex=dayIndex=0;render();preview();
    if(Number.isInteger(issue.cell))window.TrafficGameAdmin?.selectCell(issue.cell);
  }
  function setStatus(text, kind = '', errors = []) {
    const el=$('admin-validation');el.className='admin-validation '+kind;el.replaceChildren();
    const summary=document.createElement('div');summary.textContent=text;el.append(summary);
    if(errors.length){const list=document.createElement('ol');for(const issue of errors){const item=document.createElement('li'),button=document.createElement('button');button.type='button';button.textContent=issue.message;button.title=issue.path?`定位到 ${issue.path}`:'定位到问题关卡';button.onclick=()=>goToIssue(issue);item.append(button);list.append(item);}el.append(list);}
  }
  async function validate() {
    setStatus('正在校验草稿…');
    try { await api('/api/validate',{method:'POST',body:JSON.stringify(catalog)});setStatus('✓ 草稿有效，可以发布','valid');return true; }
    catch(error){setStatus(`✕ 发现 ${error.errors.length||1} 个问题`,'invalid',error.errors);return false;}
  }
  function scheduleValidation(){clearTimeout(validationTimer);validationTimer=setTimeout(validate,350);}
  function preview(levelId = level()?.id) {
    if (!levelId || !window.TrafficGameAdmin) return;
    try { window.TrafficGameAdmin.applyCatalog(clone(catalog),levelId);dirtyLabel('草稿已同步预览'); }
    catch(error){setStatus('预览失败：'+error.message,'invalid');}
  }
  function commit(action, options = {}) {
    action();trial=null;syncCampaign();pushHistory();dirtyLabel();render();
    if(options.preview!==false)preview(options.levelId || level()?.id);
    scheduleValidation();
  }
  function restore(index) {
    if(index<0||index>=history.length)return;historyIndex=index;catalog=JSON.parse(history[index]);trial=null;
    chapterIndex=Math.min(chapterIndex,chapters().length-1);levelIndex=Math.min(levelIndex,(chapter()?.levels.length||1)-1);routeIndex=0;dayIndex=0;
    updateHistory();dirtyLabel();render();preview();scheduleValidation();
  }
  function option(value,text){const item=document.createElement('option');item.value=String(value);item.textContent=text;return item;}
  function fillSelect(select,items,value){select.replaceChildren(...items);select.value=String(value);}
  function uniqueId(prefix, values) { let n=values.length+1,id=`${prefix}-${n}`;while(values.some(item=>item.id===id))id=`${prefix}-${++n}`;return id; }
  function currentCellFallback(offset=0){const target=level();return Math.min((target.width||16)*(target.height||12)-1,2*(target.width||16)+2+offset);}

  function renderBuildings(kind) {
    const list=$(kind==='home'?'admin-homes':'admin-goals'),items=route()?.[kind==='home'?'homes':'goals']||[];list.replaceChildren();
    items.forEach((building,index)=>{
      const card=document.createElement('div');card.className='admin-building-card';
      const head=document.createElement('div');head.className='admin-card-title';head.innerHTML=`<strong>${kind==='home'?'住宅':'目的地'} ${index+1}</strong><span>格 ${building.cell}</span>`;
      const remove=document.createElement('button');remove.type='button';remove.className='tool admin-danger';remove.textContent='删除';remove.disabled=items.length<=1;remove.onclick=()=>commit(()=>items.splice(index,1));head.append(remove);card.append(head);
      const make=(labelText,type,value,onchange)=>{const label=document.createElement('label');label.textContent=labelText;const input=document.createElement('input');input.type=type;input.value=value??'';input.onchange=()=>commit(()=>onchange(input.value));label.append(input);return label;};
      card.append(make('格子索引','number',building.cell,value=>building.cell=Number(value)));
      if(kind==='home')card.append(make('产生率（人/秒）','number',building.generationRate??building.rate,value=>{building.generationRate=Number(value);delete building.rate;}),make('总人口','number',building.passengers,value=>building.passengers=Number(value)));
      else card.append(make('标签','text',building.label,value=>building.label=value),make('输入上限（空为不限）','number',building.input,value=>{if(value==='')delete building.input;else building.input=Number(value);}));
      if(level().campaign){
        const growth=document.createElement('details');growth.className='admin-growth';const summary=document.createElement('summary');summary.textContent='解锁与升级';growth.append(summary);
        const conditionFields=(condition,prefix)=>{const box=document.createElement('div');box.className='admin-condition';for(const [field,labelText,fallback] of [['day','日期',1],['delivered','累计送达',0],['income','累计收入',0],['satisfaction','上日满意度',0]])box.append(make(prefix+labelText,'number',condition?.[field]??fallback,value=>{condition[field]=Number(value);}));return box;};
        building.unlock||={day:1};building.upgrades||=[];growth.append(conditionFields(building.unlock,'解锁·'));
        building.upgrades.forEach((upgrade,ui)=>{upgrade.condition||={day:1};const stage=document.createElement('div');stage.className='admin-upgrade';const stageHead=document.createElement('div');stageHead.textContent=`升级 ${ui+1}`;const del=document.createElement('button');del.type='button';del.className='tool admin-danger';del.textContent='删除';del.onclick=()=>commit(()=>building.upgrades.splice(ui,1));stageHead.append(del);stage.append(stageHead,conditionFields(upgrade.condition,''));if(kind==='home'){stage.append(make('产生率（空为不变）','number',upgrade.generationRate,value=>{if(value==='')delete upgrade.generationRate;else upgrade.generationRate=Number(value);}),make('人口（空为不变）','number',upgrade.passengers,value=>{if(value==='')delete upgrade.passengers;else upgrade.passengers=Number(value);}));}else stage.append(make('输入上限（空为无限）','number',upgrade.input,value=>upgrade.input=value===''?null:Number(value)));growth.append(stage);});
        const add=document.createElement('button');add.type='button';add.className='tool';add.textContent='＋升级阶段';add.onclick=()=>commit(()=>{const upgrade={condition:{day:Math.min(2,level().campaign.days.length)}};if(kind==='home')upgrade.passengers=building.passengers;else upgrade.input=building.input??null;building.upgrades.push(upgrade);});growth.append(add);card.append(growth);
      }
      const locate=document.createElement('button');locate.type='button';locate.className='tool';locate.textContent='移动到地图所选首格';locate.onclick=()=>{const cells=selectedCells();if(!cells.length)return setStatus('请先在地图中选择一个格子','invalid');commit(()=>building.cell=cells[0]);};card.append(locate);list.append(card);
    });
  }
  function render() {
    if(!catalog)return;
    fillSelect($('admin-chapter'),chapters().map((item,index)=>option(index,`${index+1}. ${item.name}`)),chapterIndex);
    fillSelect($('admin-level'),(chapter()?.levels||[]).map((item,index)=>option(index,`${index+1}. ${item.name}`)),levelIndex);
    const target=level();if(!target)return;
    const fields={id:'id',name:'name',english:'english',difficulty:'difficulty',lesson:'lesson',budget:'budget',duration:'duration','bus-limit':'busLineLimit',title:'title',description:'description',tip:'tip'};
    for(const [suffix,property] of Object.entries(fields))$('admin-'+suffix).value=target[property]??(property==='busLineLimit'?1:'');
    $('admin-width').value=target.width||16;$('admin-height').value=target.height||12;
    for(const input of $('admin-features').querySelectorAll('[data-feature]'))input.checked=Boolean(target.features?.[input.dataset.feature]);
    routeIndex=Math.min(routeIndex,Math.max(0,routes().length-1));fillSelect($('admin-route'),routes().map((item,index)=>option(index,`${index+1}. ${item.name}`)),routeIndex);
    const currentRoute=route();$('admin-route-name').value=currentRoute?.name||'';$('admin-route-color').value=currentRoute?.color||'#638d69';$('admin-route-light').value=currentRoute?.light||'#dae6cb';
    renderBuildings('home');renderBuildings('goal');
    $('admin-campaign-enabled').checked=Boolean(target.campaign);$('admin-campaign-fields').hidden=!target.campaign;
    $('admin-reference-status').textContent=target.referenceDesign?'✓ 已设置完整参考答案；玩家首次失败后可载入。':'本关尚未设置参考答案。';
    $('admin-delete-reference').disabled=!target.referenceDesign;
    $('admin-capture-reference').disabled=Boolean(target.campaign);
    if(target.campaign){dayIndex=Math.min(dayIndex,target.campaign.days.length-1);fillSelect($('admin-campaign-day'),target.campaign.days.map((_,index)=>option(index,`第 ${index+1} 天`)),dayIndex);$('admin-day-duration').value=target.campaign.days[dayIndex].duration;$('admin-day-income').value=target.campaign.days[dayIndex].maxIncome;}
    const cells=selectedCells();$('admin-selection').textContent=cells.length?`已选择 ${cells.length} 格：${cells.slice(0,8).join('、')}${cells.length>8?'…':''}`:'请在上方切换到“选择”，然后点击或框选地图。';
    const buildingOptions=[];routes().forEach((item,ri)=>{item.homes.forEach((_,bi)=>buildingOptions.push(option(`h:${ri}:${bi}`,`${item.name} · 住宅 ${bi+1}`)));item.goals.forEach((_,bi)=>buildingOptions.push(option(`g:${ri}:${bi}`,`${item.name} · 目的地 ${bi+1}`)));});fillSelect($('admin-building-target'),buildingOptions,$('admin-building-target').value||buildingOptions[0]?.value||'');
    $('admin-move-up').disabled=levelIndex===0;$('admin-move-down').disabled=levelIndex===(chapter()?.levels.length||1)-1;$('admin-delete-level').disabled=allLevels().length<=1;updateTrialStatus();
  }
  function bindField(id,property,numeric=false){$(id).onchange=()=>commit(()=>{const target=level(),value=numeric?Number($(id).value):$(id).value;target[property]=value;if(property==='id'&&target.referenceDesign)target.referenceDesign.levelId=value;});}

  function startEditor() {
    catalog=window.TrafficAdminCatalog;savedSnapshot=snapshot();history=[savedSnapshot];historyIndex=0;trustCurrentCatalog();updateHistory();dirtyLabel();render();scheduleValidation();
    $('admin-chapter').onchange=()=>{chapterIndex=Number($('admin-chapter').value);levelIndex=0;routeIndex=0;dayIndex=0;render();window.TrafficGameAdmin.selectLevel(level().id);};
    $('admin-level').onchange=()=>{levelIndex=Number($('admin-level').value);routeIndex=0;dayIndex=0;render();window.TrafficGameAdmin.selectLevel(level().id);};
    for(const [id,property,numeric] of [['admin-id','id'],['admin-name','name'],['admin-english','english'],['admin-difficulty','difficulty'],['admin-lesson','lesson'],['admin-budget','budget',true],['admin-duration','duration',true],['admin-bus-limit','busLineLimit',true],['admin-title','title'],['admin-description','description'],['admin-tip','tip']])bindField(id,property,numeric);
    for(const input of $('admin-features').querySelectorAll('[data-feature]'))input.onchange=()=>commit(()=>{level().features||={};level().features[input.dataset.feature]=input.checked;});
    $('admin-route').onchange=()=>{routeIndex=Number($('admin-route').value);render();};
    for(const [id,property] of [['admin-route-name','name'],['admin-route-color','color'],['admin-route-light','light']])$(id).onchange=()=>commit(()=>route()[property]=$(id).value);
    $('admin-add-route').onclick=()=>commit(()=>{const width=level().width||16;routes().push({name:'新路线 → 目的地',color:'#638d69',light:'#dae6cb',homes:[{cell:currentCellFallback(),generationRate:1,passengers:60}],goals:[{cell:currentCellFallback(width+5),label:'目的地'}]});routeIndex=routes().length-1;});
    $('admin-delete-route').onclick=()=>{if(routes().length<=1)return setStatus('每关至少保留一条路线','invalid');if(confirm(`删除路线「${route().name}」？`))commit(()=>{routes().splice(routeIndex,1);routeIndex=Math.max(0,routeIndex-1);});};
    $('admin-add-home').onclick=()=>commit(()=>route().homes.push({cell:currentCellFallback(route().homes.length),generationRate:1,passengers:60}));
    $('admin-add-goal').onclick=()=>commit(()=>route().goals.push({cell:currentCellFallback((level().width||16)+route().goals.length+4),label:'目的地'}));
    $('admin-add-chapter').onclick=()=>commit(()=>{const id=uniqueId('chapter',chapters());chapters().push({id,name:'新章节',english:'NEW CHAPTER',levels:[]});chapterIndex=chapters().length-1;levelIndex=0;},{preview:false});
    $('admin-edit-chapter').onclick=()=>{const item=chapter(),name=prompt('章节名称',item.name);if(name===null)return;const english=prompt('章节英文名',item.english);if(english===null)return;const id=prompt('章节 ID',item.id);if(id===null)return;commit(()=>Object.assign(item,{name:name.trim(),english:english.trim(),id:id.trim()}));};
    $('admin-delete-chapter').onclick=()=>{if(chapter().levels.length)return setStatus('请先删除或移动章节内的关卡','invalid');if(chapters().length<=1)return;if(confirm(`删除空章节「${chapter().name}」？`))commit(()=>{chapters().splice(chapterIndex,1);chapterIndex=Math.max(0,chapterIndex-1);levelIndex=0;},{preview:false});};
    $('admin-add-level').onclick=()=>commit(()=>{const id=uniqueId('level',allLevels()),width=16;chapter().levels.push({id,name:'新关卡',english:'NEW LEVEL',difficulty:'自定义',lesson:'自定义',title:'未命名关卡',description:'请填写任务说明。',tip:'请填写规划提示。',features:{grade:true,load:true,cut:true,inspect:true,signals:true,bus:true},busLineLimit:3,budget:100,duration:90,width:16,height:12,water:[],bridges:[],trees:[],version:2,initialRoads:[],initialEdges:[],routes:[{name:'路线一 → 目的地',color:'#638d69',light:'#dae6cb',homes:[{cell:2*width+2,generationRate:1,passengers:60}],goals:[{cell:8*width+12,label:'目的地'}]}]});levelIndex=chapter().levels.length-1;routeIndex=0;},{levelId:null});
    $('admin-duplicate-level').onclick=()=>commit(()=>{const copy=clone(level()),base=copy.id+'-copy';let id=base,n=2;while(allLevels().some(item=>item.id===id))id=`${base}-${n++}`;copy.id=id;if(copy.referenceDesign)copy.referenceDesign.levelId=id;copy.name+='（副本）';chapter().levels.splice(levelIndex+1,0,copy);levelIndex++;},{levelId:null});
    $('admin-delete-level').onclick=()=>{if(allLevels().length<=1)return;if(confirm(`删除关卡「${level().name}」？`))commit(()=>{chapter().levels.splice(levelIndex,1);levelIndex=Math.min(levelIndex,chapter().levels.length-1);if(levelIndex<0){const ci=chapters().findIndex(item=>item.levels.length);chapterIndex=ci;levelIndex=0;}routeIndex=0;},{levelId:null});};
    $('admin-move-level').onclick=()=>{if(chapters().length<2)return setStatus('当前只有一个章节','invalid');const choices=chapters().map((item,index)=>`${index+1}. ${item.name}`).join('\n'),answer=prompt(`移动到哪个章节？\n${choices}`,String(chapterIndex+1));if(answer===null)return;const target=Number(answer)-1;if(!Number.isInteger(target)||!chapters()[target]||target===chapterIndex)return setStatus('请输入其他章节的序号','invalid');commit(()=>{const moving=chapter().levels.splice(levelIndex,1)[0];chapters()[target].levels.push(moving);chapterIndex=target;levelIndex=chapters()[target].levels.length-1;routeIndex=0;});};
    const move=delta=>commit(()=>{const list=chapter().levels,target=levelIndex+delta;if(target<0||target>=list.length)return;[list[levelIndex],list[target]]=[list[target],list[levelIndex]];levelIndex=target;});$('admin-move-up').onclick=()=>move(-1);$('admin-move-down').onclick=()=>move(1);
    $('admin-apply-size').onclick=()=>{const target=level(),oldWidth=target.width||16,oldHeight=target.height||12,width=Number($('admin-width').value),height=Number($('admin-height').value);if(!Number.isInteger(width)||!Number.isInteger(height)||width<8||width>64||height<8||height>64)return setStatus('地图宽高必须是 8 至 64 的整数','invalid');if(width===oldWidth&&height===oldHeight)return;const dx=Math.floor(width/2)-Math.floor(oldWidth/2),dy=Math.floor((height-1)/2)-Math.floor((oldHeight-1)/2),translate=cell=>{const x=cell%oldWidth+dx,y=Math.floor(cell/oldWidth)+dy;return x>=0&&x<width&&y>=0&&y<height?y*width+x:null;};const routeSets=[target.routes,...(target.campaign?.routes?[target.campaign.routes]:[])],buildings=routeSets.flatMap(items=>items.flatMap(item=>[...item.homes,...item.goals]));if(buildings.some(item=>translate(item.cell)===null))return setStatus('新边界会裁掉建筑，请先移动建筑','invalid');if(!confirm(`将地图从 ${oldWidth} × ${oldHeight} 调整为 ${width} × ${height}？边界外地形和道路会被裁掉。`))return;commit(()=>{const mapCells=values=>values.map(translate).filter(cell=>cell!==null);target.water=mapCells(target.water);target.bridges=mapCells(target.bridges);target.trees=mapCells(target.trees);target.initialRoads=(target.initialRoads||[]).map(road=>({...road,cell:translate(road.cell)})).filter(road=>road.cell!==null);target.initialEdges=(target.initialEdges||[]).map(([a,b])=>[translate(a),translate(b)]).filter(([a,b])=>a!==null&&b!==null);for(const building of buildings)building.cell=translate(building.cell);target.width=width;target.height=height;});};
    $('admin-campaign-enabled').onchange=()=>commit(()=>{const target=level();if($('admin-campaign-enabled').checked){delete target.referenceDesign;target.campaign={days:Array.from({length:5},(_,i)=>({duration:target.duration,maxIncome:18+i*2})),routes:clone(target.routes)};for(const item of target.campaign.routes)for(const building of [...item.homes,...item.goals]){building.unlock={day:1};building.upgrades=[];}}else{target.routes=clone(target.campaign.routes);delete target.campaign;}dayIndex=0;routeIndex=0;});
    $('admin-campaign-day').onchange=()=>{dayIndex=Number($('admin-campaign-day').value);render();};
    $('admin-day-duration').onchange=()=>commit(()=>{level().campaign.days[dayIndex].duration=Number($('admin-day-duration').value);if(dayIndex===0)level().duration=Number($('admin-day-duration').value);});
    $('admin-day-income').onchange=()=>commit(()=>level().campaign.days[dayIndex].maxIncome=Number($('admin-day-income').value));
    $('admin-add-day').onclick=()=>commit(()=>{const days=level().campaign.days;if(days.length>=30)return;days.push(clone(days.at(-1)));dayIndex=days.length-1;});
    $('admin-delete-day').onclick=()=>{if(level().campaign.days.length<=2)return setStatus('多日任务至少保留两天','invalid');commit(()=>{level().campaign.days.pop();dayIndex=Math.min(dayIndex,level().campaign.days.length-1);});};
    for(const button of document.querySelectorAll('[data-terrain]'))button.onclick=()=>{const cells=selectedCells();if(!cells.length)return setStatus('请先选择地图格子','invalid');const occupied=new Set(routes().flatMap(item=>[...item.homes,...item.goals].map(building=>building.cell)));if(cells.some(cell=>occupied.has(cell)))return setStatus('建筑所在格不能修改地形','invalid');commit(()=>{const target=level(),chosen=new Set(cells),remove=name=>target[name]=target[name].filter(cell=>!chosen.has(cell));remove('water');remove('bridges');remove('trees');if(button.dataset.terrain==='water')target.water.push(...cells);if(button.dataset.terrain==='bridge'){target.water.push(...cells);target.bridges.push(...cells);}if(button.dataset.terrain==='tree')target.trees.push(...cells);target.water=[...new Set(target.water)];target.bridges=[...new Set(target.bridges)];target.trees=[...new Set(target.trees)];if(button.dataset.terrain!=='bridge'){target.initialRoads=(target.initialRoads||[]).filter(road=>!chosen.has(road.cell));target.initialEdges=(target.initialEdges||[]).filter(([a,b])=>!chosen.has(a)&&!chosen.has(b));}});};
    $('admin-place-building').onclick=()=>{const cells=selectedCells(),parts=$('admin-building-target').value.split(':');if(!cells.length||parts.length!==3)return setStatus('请先选择地图格子和建筑','invalid');commit(()=>{const [kind,ri,bi]=parts,building=routes()[Number(ri)][kind==='h'?'homes':'goals'][Number(bi)];building.cell=cells[0];level().water=level().water.filter(cell=>cell!==cells[0]);level().bridges=level().bridges.filter(cell=>cell!==cells[0]);level().trees=level().trees.filter(cell=>cell!==cells[0]);});};
    $('admin-capture-roads').onclick=()=>{const design=window.TrafficGameAdmin.captureDesign();commit(()=>{level().version=2;level().initialRoads=design.roads.map(road=>({cell:road.cell,grade:road.grade}));level().initialEdges=design.edges.map(([a,b])=>[a,b]);});setStatus('已将当前道路、等级和显式连接写入关卡草稿；道路引导、信号和公交不属于初始关卡定义','valid');};
    $('admin-capture-reference').onclick=()=>{if(level().campaign)return setStatus('多日任务暂不支持单一参考答案','invalid');const design=window.TrafficGameAdmin.captureDesign();commit(()=>level().referenceDesign=clone(design));setStatus('已将当前完整设计保存为参考答案草稿','valid');};
    $('admin-delete-reference').onclick=()=>{if(!level().referenceDesign)return;if(confirm('删除本关参考答案？'))commit(()=>delete level().referenceDesign);};
    $('admin-undo').onclick=()=>restore(historyIndex-1);$('admin-redo').onclick=()=>restore(historyIndex+1);
    $('admin-verify-play').onclick=async()=>{if(!await validate())return;preview();trial={levelId:level().id,fingerprint:levelFingerprint(level())};updateTrialStatus();document.body.classList.add('admin-collapsed');$('admin-expand').hidden=false;$('map').scrollIntoView({block:'center'});};
    $('admin-publish').onclick=async()=>{if(!await validate())return;const pending=unverifiedLevels();if(pending.length){setStatus(`✕ ${pending.length} 个修改后的关卡尚未通关`,'invalid',pending.map(item=>({message:`关卡「${item.id}」须先验证并试玩通关`,chapterId:chapters().find(chapter=>chapter.levels.includes(item))?.id||null,levelId:item.id,path:null,cell:null})));return;}try{await api('/api/levels',{method:'PUT',body:JSON.stringify(catalog)});savedSnapshot=snapshot();history=[savedSnapshot];historyIndex=0;trial=null;trustCurrentCatalog();updateHistory();dirtyLabel('已发布到关卡文件');render();setStatus('✓ 发布成功；管理员预览已是最新草稿，公开游戏服务重启后生效','valid');}catch(error){setStatus('发布失败：'+error.message,'invalid');}};
    $('admin-reload').onclick=async()=>{if(snapshot()!==savedSnapshot&&!confirm('放弃所有未发布草稿并重新载入？'))return;try{catalog=clone((await api('/api/levels')).catalog);savedSnapshot=snapshot();history=[savedSnapshot];historyIndex=0;trial=null;trustCurrentCatalog();chapterIndex=levelIndex=routeIndex=dayIndex=0;render();preview();dirtyLabel();updateHistory();scheduleValidation();}catch(error){setStatus(error.message,'invalid');}};
    $('admin-logout').onclick=async()=>{if(snapshot()!==savedSnapshot&&!confirm('仍有未发布草稿，确定退出？'))return;await api('/api/logout',{method:'POST'});location.reload();};
    $('admin-collapse').onclick=()=>{document.body.classList.add('admin-collapsed');$('admin-expand').hidden=false;};$('admin-expand').onclick=()=>{document.body.classList.remove('admin-collapsed');$('admin-expand').hidden=true;};
    $('map').addEventListener('pointerup',()=>setTimeout(render,0));document.addEventListener('keyup',event=>{if(event.key===' '||event.key.startsWith('Arrow'))setTimeout(render,0);});
    window.addEventListener('traffic-game-levelchange',event=>{const id=event.detail?.levelId;for(let ci=0;ci<chapters().length;ci++){const li=chapters()[ci].levels.findIndex(item=>item.id===id);if(li>=0){chapterIndex=ci;levelIndex=li;routeIndex=0;dayIndex=0;render();break;}}});
    window.addEventListener('traffic-game-result',event=>{const detail=event.detail||{},target=allLevels().find(item=>item.id===detail.levelId);if(!detail.won||!detail.complete||!target||trial?.levelId!==target.id||trial.fingerprint!==levelFingerprint(target))return;verifiedLevels.set(target.id,trial.fingerprint);trial=null;render();setStatus(`✓ 「${target.name}」已实际通关，可以发布当前版本`,'valid');document.body.classList.remove('admin-collapsed');$('admin-expand').hidden=true;});
    window.addEventListener('beforeunload',event=>{if(snapshot()!==savedSnapshot){event.preventDefault();event.returnValue='';}});
  }
  window.addEventListener('traffic-game-ready',startEditor,{once:true});
})();
