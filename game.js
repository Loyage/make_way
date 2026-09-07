(() => {
  'use strict';
  const { City, ROAD_TYPES, VEHICLE_WIDTH, VEHICLE_LENGTH, LANE_WIDTH, WIDTH, HEIGHT, key, point, neighbors } = TrafficCore;
  const $ = id => document.getElementById(id);
  const canvas = $('map'), ctx = canvas.getContext('2d');
  const levels = () => TrafficCore.LEVELS;
  let city = null, tool = 'road', speed = 1, hover = null, dragging = false;
  let keyboardAnchor = null;
  let lastCell = null, dragGrade = 0, dragPath = [], dragChanges = [], dragRetract = false, dragRetractOrigin = false, retractLinks = [];
  let cellSize = 40, lastFrame = 0, accumulator = 0;
  let toastTimer, resultShown = false, keyboardCell = key(1, 2), keyboardMode = false;
  let connectionRows = [], pendingLevel = null, roadGrade = 0, inspectedCell = null, inspectorGradeCell = null;
  let pendingDesign = null;
  const arrivalEffects = TrafficEffects.createArrivalEffects();
  const STORAGE_PREFIX = 'traffic-game-design-v1:';
  function storedDesign(levelId = city.level.id) {
    try { return localStorage.getItem(STORAGE_PREFIX + levelId); }
    catch { return null; }
  }
  function updateDesignControls() { $('load-design').disabled = storedDesign() === null; }
  let levelButtons = [];
  function buildLevelButtons() {
    $('level-summary').textContent = `${levels().length} 座小城 · 功能逐步解锁 · 切换会重置本局`;
    levelButtons = levels().map((level, i) => {
      const button = document.createElement('button');
      button.className = 'level-card';
      const number = document.createElement('span'); number.className = 'level-number'; number.textContent = String(i + 1).padStart(2, '0');
      const name = document.createElement('strong'); name.textContent = level.name;
      const detail = document.createElement('small'); detail.textContent = `${level.difficulty} · ${level.lesson}`;
      button.append(number, name, detail); button.onclick = () => requestLevel(level.id);
      $('level-list').append(button);
      return button;
    });
  }
  function configureLevel() {
    const level = city.level, index = levels().indexOf(level);
    const number = String(index + 1).padStart(2, '0');
    $('level-eyebrow').textContent = `城市实验室 / ${number} · ${level.name}`;
    $('chapter-number').textContent = number;
    $('chapter-name').textContent = level.english;
    $('map-name').textContent = level.name;
    $('target-label').textContent = `目标 ${level.target}`;
    $('target-unit').textContent = `/ ${level.target} 辆`;
    $('mission-title').textContent = level.title;
    $('mission-description').textContent = `在 ${level.duration} 秒内送达 ${level.target} 辆车，建设预算 ${level.budget} 点。${level.description}`;
    $('mission-tip').textContent = `第 ${number} 课 · ${level.lesson}　↗ ${level.tip}`;
    const demand = $('demand-list');demand.replaceChildren();
    for (const r of city.routes) {
      const row = document.createElement('li');
      const homes = r.homes.map(h => `住宅 (${point(h.cell).x + 1},${point(h.cell).y + 1}) 输出 ${h.passengers} 人 · ${h.rate} 人/s`);
      const goals = r.goals.map(g => `目的地 (${point(g.cell).x + 1},${point(g.cell).y + 1}) · ${g.label}${g.input != null ? ` 输入 ${g.input} 人` : ''}`);
      row.textContent = `${r.name}：${[...homes, ...goals].join('；')}`;
      demand.append(row);
    }
    $('grade-setting').hidden = !level.features.grade;
    $('load-setting').hidden = !level.features.load;
    $('cut-tool').hidden = !level.features.cut;
    $('inspect-tool').hidden = !level.features.inspect;
    $('grade-description').hidden = !level.features.grade;
    $('road-inspector').classList.toggle('locked', !level.features.inspect);
    $('show-load').checked = level.features.load;
    if (tool === 'cut' && !level.features.cut || tool === 'inspect' && !level.features.inspect) setTool('road');
    levelButtons.forEach((button, i) => {
      button.classList.toggle('selected', i === index);
      button.setAttribute('aria-current', i === index ? 'true' : 'false');
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
    updateDesignControls();
  }
  function requestLevel(id) {
    if (id === city.level.id) return;
    const defaultDesign = new City(city.level.id).serializeDesign();
    const designChanged = JSON.stringify(city.serializeDesign()) !== JSON.stringify(defaultDesign);
    if (!designChanged) {
      reset(id); return;
    }
    if (city.state === 'running') city.toggle();
    pendingLevel = id;
    $('level-confirm-title').textContent = `前往「${levels().find(level => level.id === id).name}」？`;
    updateUI(); $('level-dialog').showModal();
  }
  function toast(text) {
    if (!text) return;
    $('toast').textContent = text; $('toast').classList.add('visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 2200);
  }
  function setTool(value) {
    if (value === 'cut' && !city.level.features.cut || value === 'inspect' && !city.level.features.inspect) {
      toast(`完成前面的教学关卡后解锁${value === 'cut' ? '剪刀' : '路况与信号'}`); return;
    }
    tool = value;keyboardAnchor=null;dragging=false;lastCell=null;dragRetract=false;dragRetractOrigin=false;retractLinks=[];
    for (const name of ['road', 'inspect', 'cut']) {
      $(name + '-tool').classList.toggle('active', name === tool);
      $(name + '-tool').setAttribute('aria-pressed', String(name === tool));
    }
  }
  function updateInspector() {
    const n = inspectedCell, selected = n !== null && city.roads.has(n);
    $('selected-road-grade').disabled = !selected || !city.level.features.grade || ['won', 'lost'].includes(city.state);
    $('apply-road-grade').disabled = $('selected-road-grade').disabled;
    $('remove-road').disabled = !selected || city.bridges.has(n) || ['won', 'lost'].includes(city.state);
    if (!selected) {
      inspectorGradeCell = null;
      $('road-detail').textContent = '点击一条道路进行升级、设置红绿灯或拆除。';
      $('road-load').textContent = ''; $('signal-phase').textContent = '';
      $('signal-enabled').disabled = true; $('signal-enabled').checked = false; $('signal-cycle').disabled = true;
      return;
    }
    const p = point(n), type = city.roadType(n), load = city.load(n), signal = city.signals.get(n);
    $('road-detail').textContent = `(${p.x + 1}, ${p.y + 1}) ${type.name}${city.bridges.has(n) ? ' · 桥梁（不可拆除）' : ''} · ${type.speed} 格/秒`;
    $('road-load').textContent = city.level.features.load ? (signal
      ? (signal.enabled ? `冲突区预约 ${load.used} / 4 区 · 占用/驶入 ${load.total} 辆` : `逐车通行 · 路口占用 ${load.total} / 1 辆`)
      : `每方向 ${type.lanes} 车道 × 前后 2 辆 · 最忙方向 ${load.used} / ${load.capacity} 辆`) : '';
    if (inspectorGradeCell !== n) {
      $('selected-road-grade').value = String(city.roadGrades.get(n) || 0);
      inspectorGradeCell = n;
    }
    const phase = city.signalPhase(n), names = { off: '自动避让 · 35% 速度 · 先到先行', 'horizontal-straight': '横向直行绿灯', 'horizontal-left': '横向左转绿灯', 'vertical-straight': '纵向直行绿灯', 'vertical-left': '纵向左转绿灯', clearance: '直行 / 左转全红清空' };
    $('signal-phase').textContent = !city.level.features.inspect ? `本关专注于「${city.level.lesson}」，路况与信号将在后续教学解锁。` : signal ? `${names[phase.stage]}${phase.axis === 'off' ? '' : ` · ${phase.remaining.toFixed(1)} 秒；放行不额外减速，右转须让行`}` : '非路口，无需红绿灯';
    $('signal-enabled').disabled = !signal || !city.level.features.signals || ['won', 'lost'].includes(city.state);
    $('signal-cycle').disabled = $('signal-enabled').disabled;
    $('signal-enabled').checked = Boolean(signal?.enabled);
    if (signal && city.level.features.inspect && !city.level.features.signals) $('signal-phase').textContent += ' · 红绿灯将在下一课解锁';
    if (document.activeElement !== $('signal-cycle')) $('signal-cycle').value = String(signal?.green || 2);
  }
  function updateGrade() {
    roadGrade = Number($('road-grade').value);
    const type = ROAD_TYPES[roadGrade];
    $('grade-description').textContent = `${type.name}：${type.speed} 格/秒 · 每方向 ${type.lanes} 车道 × 2 辆 · 每格 ${type.cost} 点`;
  }
  function resize() {
    const width = canvas.getBoundingClientRect().width;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(width * HEIGHT / WIDTH * dpr);
    cellSize = width / WIDTH;
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
  function label(text,x,y,size,color,weight='500') {
    ctx.font = `${weight} ${size}px system-ui, sans-serif`; ctx.textAlign='center'; ctx.textBaseline='middle';ctx.fillStyle=color;ctx.fillText(text,x,y);
  }
  function drawSignalMarkings(n) {
    const s=cellSize,p=point(n),signal=city.signals.get(n);
    const links=new Set(city.links(n));
    const rightOf={1:WIDTH,[WIDTH]:-1,[-1]:-WIDTH,[-WIDTH]:1};
    // Paint into each incoming quadrant, in driving coordinates: x is forward,
    // y is right. Only show arrows whose entry AND exit actually exist.
    for(const entry of [1,WIDTH,-1,-WIDTH]) {
      if(!links.has(n-entry)) continue;
      ctx.save();ctx.translate((p.x+.5)*s,(p.y+.5)*s);
      ctx.rotate(entry===1?0:entry===WIDTH?Math.PI/2:entry===-1?Math.PI:-Math.PI/2);
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
      if (r.rate === 6) {
        rounded(cx-s*.22,cy-s*.36,s*.44,s*.64,s*.025,r.color);
        for(let floor=0;floor<4;floor++) for(let col=0;col<2;col++) rounded(cx-s*.14+col*s*.17,cy-s*.28+floor*s*.13,s*.09,s*.07,0,r.light);
      } else {
        const width=r.rate===4?.32:.23;
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
    label(b.isHome?`${r.passengers}人 · ${r.rate}/s`:(r.input!=null?`${r.label} · 输入 ${r.input}`:r.label),cx,(y+1.1)*s,s*.22,r.color,'700');
    if(b.isHome && city.queues[b.index]) {
      const bx=(x+.86)*s,by=(y+.14)*s;
      circle(bx,by,s*.19,city.queues[b.index]>7?'#bd7750':r.color);
      label(String(city.queues[b.index]),bx,by,s*.2,'#fff','700');
    }
  }
  function draw() {
    const s=cellSize,w=WIDTH*s,h=HEIGHT*s;
    ctx.clearRect(0,0,w,h);ctx.fillStyle='#eaf0df';ctx.fillRect(0,0,w,h);
    // Soft grid and planted lawn patches keep the map legible at small sizes.
    for(let y=0;y<HEIGHT;y++) for(let x=0;x<WIDTH;x++) {
      if((x*7+y*11)%13===0) { ctx.fillStyle='#e3ebd7';ctx.fillRect(x*s,y*s,s,s); }
      ctx.strokeStyle='#dce5d04d';ctx.lineWidth=.65;ctx.strokeRect(x*s,y*s,s,s);
      if((x*3+y*7)%9===0 && !city.water.has(key(x,y)) && !city.roads.has(key(x,y)) && !city.buildings.has(key(x,y))) {
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
      if (x === WIDTH-1 || !city.water.has(n+1)) line((x+1)*s,y*s,(x+1)*s,(y+1)*s,'#d1e3cf',s*.08);
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
      if(city.bridges.has(n)) {
        line(x*s,cy-s*(width/2+.035),(x+1)*s,cy-s*(width/2+.035),'#8d9b89',s*.035);
        line(x*s,cy+s*(width/2+.035),(x+1)*s,cy+s*(width/2+.035),'#8d9b89',s*.035);
      }
    }
    for(const n of city.trees) {
      const {x,y}=point(n),cx=(x+.5)*s,cy=(y+.48)*s;
      circle(cx+s*.04,cy+s*.16,s*.25,'#cddcbc');
      line(cx,cy,cx,cy+s*.31,'#a5b18d',s*.055);
      circle(cx-s*.1,cy,s*.19,'#a9c398');circle(cx+s*.1,cy+s*.015,s*.19,'#9ab88a');circle(cx,cy-s*.13,s*.19,'#b3cba1');
    }
    city.homes.forEach((h,i)=>drawBuilding({...h,isHome:true,index:i}));
    city.goals.forEach((g,i)=>drawBuilding({...g,isHome:false}));
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
    arrivalEffects.draw(ctx, point, s);
    if (inspectedCell !== null && city.roads.has(inspectedCell)) {
      const {x,y} = point(inspectedCell);rounded(x*s+1,y*s+1,s-2,s-2,s*.1,null,'#37678c');
    }
    const selected=keyboardMode?keyboardCell:hover;
    if(selected!==null) {
      const {x,y}=point(selected),retracting=dragging&&Boolean(dragRetract);
      rounded(x*s+1,y*s+1,s-2,s-2,s*.1,retracting?'#d18d4f22':'#317a5719',retracting?'#c68b56':'#6d936b');
      if(tool==='cut')label('✂',(x+.5)*s,(y+.5)*s,s*.42,'#a97346');
      if(tool !== 'inspect'&&tool !== 'cut'&&!city.buildings.has(selected)&&!city.roads.has(selected))label(retracting?'−':'+',(x+.5)*s,(y+.5)*s,s*.42,retracting?'#bd8253':'#82a277');
    }
    if(city.state==='paused') {
      rounded(w/2-52,14,104,27,14,'#fffef9e8');label('Ⅱ  规划暂停中',w/2,28,11,'#63715b');
    }
  }
  function updateUI() {
    $('delivered').textContent=city.delivered;$('budget').textContent=city.remaining;
    $('progress').style.width=Math.min(100,city.delivered/city.level.target*100)+'%';
    const seconds=Math.ceil(Math.max(0,city.level.duration-city.elapsed));
    $('timer').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
    const waiting=city.queues.reduce((a,b)=>a+b,0),blocked=city.cars.filter(c=>c.blocked>1.5).length;
    const heavy=blocked>3||waiting>18;
    $('traffic').textContent=city.state==='planning'?'等待出发':heavy?'有些拥堵':waiting>6?'等待接通':'畅通无阻';
    $('traffic').style.color=heavy?'#c38a51':'#317a57';$('traffic-dot').style.background=heavy?'#c38a51':'#73a780';
    $('waiting').textContent=`${waiting} 辆在住宅等待 · ${city.cars.length} 辆在途`;
    const states={planning:'规划中',running:'运营中',paused:'已暂停',won:'目标达成',lost:'运营结束'};
    $('phase-label').textContent=states[city.state];
    $('board-status').textContent=city.state==='planning'?'先规划，再出发':`${states[city.state]} · ${speed}× 速度`;
    $('start').textContent=city.state==='running'?'Ⅱ 暂停规划':city.state==='paused'?'▶ 继续运营':city.state==='planning'?'▶ 开始运营':'本局已结束';
    $('start').disabled=['won','lost'].includes(city.state);
    $('stop').disabled=!['running','paused'].includes(city.state);
    $('speed').textContent=speed+'×';
    $('connection-count').textContent=city.routes.filter((r,i)=>city.routeConnected(i)).length+' / '+city.routes.length;
    connectionRows.forEach(({row,status},i)=>{
      row.classList.toggle('connected',city.routeConnected(i));status.textContent=city.routeConnected(i)?'已连接 ✓':'待连接';
    });
    updateInspector();
    if(['won','lost'].includes(city.state)&&!resultShown) showResult();
  }
  function showResult() {
    resultShown=true;
    const won=city.state==='won', report=TrafficResults.commuteReport(city.commuteTimes);
    $('result-icon').textContent=won?'✳':'⌁';
    $('result-title').textContent=won?'这座小城，因你而畅通。':'再给小城一个好计划。';
    $('result-description').textContent=won?'目标达成！每一段精心规划的道路，都让生活更近了一点。':'时间到了。'+city.level.tip;
    const summary=document.createElement('strong');summary.textContent=`居民满意度 ${report.score}%`;
    const meta=document.createElement('div');meta.textContent=`抵达 ${city.delivered} / ${city.level.target} 辆 · 平均通勤 ${report.average.toFixed(1)} 秒 · 建设 ${city.level.budget-city.remaining} 点`;
    const distribution=document.createElement('div');distribution.className='commute-distribution';
    for(const band of report.bands){const item=document.createElement('span');item.textContent=`${band.label} ${band.count} 人`;distribution.append(item);}
    $('result-stats').replaceChildren(summary,meta,distribution);
    $('next-level').hidden = !won || levels().indexOf(city.level) === levels().length - 1;
    for(const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    $('result-dialog').showModal();
  }
  function reset(levelId = city.level.id) {
    for(const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    city=new City(levelId);speed=1;accumulator=0;resultShown=false;dragging=false;lastCell=null;dragRetract=false;dragRetractOrigin=false;retractLinks=[];
    arrivalEffects.reset();
    pendingLevel=null;hover=null;keyboardMode=false;keyboardCell=key(1,2);inspectedCell=null;
    $('road-grade').value='0';updateGrade();
    configureLevel();setTool('road');updateUI();draw();toast(`欢迎来到${city.level.name}！${city.level.tip}`);
  }
  function eventCell(event) {
    const rect=canvas.getBoundingClientRect(),x=Math.floor((event.clientX-rect.left)/rect.width*WIDTH),y=Math.floor((event.clientY-rect.top)/rect.height*HEIGHT);
    return x>=0&&x<WIDTH&&y>=0&&y<HEIGHT?key(x,y):null;
  }
  function roadChange(a, b) {
    return {
      a, b, edgeExisted: city.edges.get(a)?.has(b) || false,
      cells: [a, b].filter(n => !city.buildings.has(n)).map(n => ({ n, existed: city.roads.has(n), grade: city.roadGrades.get(n) || 0 }))
    };
  }
  function undoRoadChange(change) {
    let message = '';
    if (!change.edgeExisted && city.edges.get(change.a)?.has(change.b)) message = city.cut(change.a, change.b);
    if (message) return message;
    for (const cell of [...change.cells].reverse()) {
      if (!cell.existed && city.roads.has(cell.n)) message = city.edit(cell.n, true, 0);
      else if (cell.existed && city.roads.has(cell.n) && (city.roadGrades.get(cell.n) || 0) !== cell.grade) message = city.edit(cell.n, false, cell.grade);
      if (message) return message;
    }
    return '';
  }
  function paint(n) {
    if(n===null) return;
    let message='';
    if (tool === 'inspect') {
      inspectedCell = city.roads.has(n) ? n : null; updateUI(); draw(); return;
    }
    if(lastCell!==null) {
      // Fill skipped cells along a four-connected staircase, even on fast drags.
      let {x,y}=point(lastCell);const target=point(n);
      const dx=Math.abs(target.x-x),dy=Math.abs(target.y-y);let ix=0,iy=0;
      while(x!==target.x||y!==target.y) {
        if(x!==target.x&&(y===target.y||(ix+.5)/(dx||1)<=(iy+.5)/(dy||1))) {x+=Math.sign(target.x-x);ix++;}
        else {y+=Math.sign(target.y-y);iy++;}
        const next=key(x,y);
        if (dragRetract) {
          const fromBuilding=dragRetract==='building'||dragRetract==='building-active';
          const followsRoad=city.roads.has(next)&&(dragRetract==='building-active'?retractLinks.includes(next):city.links(lastCell).includes(next));
          if (followsRoad) {
            if (fromBuilding) {
              retractLinks=city.links(next).filter(v=>city.roads.has(v));
              message=city.edit(next,true,dragGrade);
              if (!message) {dragRetract='building-active';lastCell=next;}
            } else {
              message=city.edit(lastCell,true,dragGrade);
              if (!message) {dragRetract='road-active';lastCell=next;}
            }
          } else if (dragRetract==='building-active'||dragRetract==='road-active') message='请沿已有道路从起点往回拖动';
          else dragRetract=false;
        }
        if (!message && !dragRetract) {
          if (tool === 'road' && dragPath.length > 1 && next === dragPath[dragPath.length - 2]) {
            message = undoRoadChange(dragChanges[dragChanges.length - 1]);
            if (!message) {
              dragPath.pop();dragChanges.pop();lastCell=next;
              if (dragPath.length===1&&dragRetractOrigin) dragRetract=dragRetractOrigin;
            }
          } else {
            const change = tool === 'road' ? roadChange(lastCell, next) : null;
            message = tool==='cut' ? city.cut(lastCell,next) : city.connect(lastCell,next,dragGrade);
            if (!message) {
              lastCell=next;
              if (tool === 'road') { dragPath.push(next); dragChanges.push(change); }
            }
          }
        }
        inspectedCell=city.roads.has(next)?next:null;
        if(message) {dragging=false;lastCell=null;dragRetract=false;dragRetractOrigin=false;retractLinks=[];toast(message);updateUI();draw();return;}
      }
    } else {
      inspectedCell=city.roads.has(n)?n:null;lastCell=n;dragPath=[n];
    }
    toast(message);updateUI();draw();
  }
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;
    e.preventDefault();canvas.focus({preventScroll:true});keyboardAnchor=null;keyboardMode=false;dragging=true;lastCell=null;dragPath=[];dragChanges=[];
    canvas.setPointerCapture(e.pointerId);hover=eventCell(e);
    dragGrade=hover!==null&&city.roads.has(hover)?city.roadGrades.get(hover)||0:roadGrade;
    const links=hover===null?[]:city.links(hover),roadNeighbors=links.filter(n=>city.roads.has(n));
    const roadAtBuilding=city.roads.has(hover)&&links.some(n=>city.buildings.has(n));
    dragRetract=tool!=='road'?false:city.buildings.has(hover)&&roadNeighbors.length?'building'
      :city.roads.has(hover)&&!city.bridges.has(hover)&&!roadAtBuilding&&roadNeighbors.length<=1?'road':false;
    dragRetractOrigin=dragRetract;retractLinks=[];paint(hover);
  });
  canvas.addEventListener('pointermove',e=>{keyboardMode=false;hover=eventCell(e);if(dragging)paint(hover);});
  const endDrag=()=>{dragging=false;lastCell=null;dragPath=[];dragChanges=[];dragRetract=false;dragRetractOrigin=false;retractLinks=[];updateUI();draw();};
  canvas.addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',endDrag);canvas.addEventListener('lostpointercapture',endDrag);
  canvas.addEventListener('pointerleave',()=>{hover=null;});
  $('road-tool').onclick=()=>setTool('road');
  $('inspect-tool').onclick=()=>setTool('inspect');
  $('cut-tool').onclick=()=>setTool('cut');
  $('road-grade').onchange=()=>{
    if (!city.level.features.grade) { $('road-grade').value='0'; toast('道路等级将在后续教学关卡解锁'); }
    updateGrade();setTool('road');
  };
  const changeSignal=()=>{
    if (!city.level.features.signals) { toast('红绿灯将在下一课解锁'); updateUI(); return; }
    toast(city.setSignal(inspectedCell,$('signal-enabled').checked,Number($('signal-cycle').value)));updateUI();
  };
  $('signal-enabled').onchange=changeSignal;$('signal-cycle').onchange=changeSignal;
  $('apply-road-grade').onclick=()=>{
    if (inspectedCell === null || !city.roads.has(inspectedCell)) return;
    const grade = Number($('selected-road-grade').value), message = city.edit(inspectedCell, false, grade);
    if (message) inspectorGradeCell=null;
    toast(message || `已调整为${ROAD_TYPES[grade].name}`);updateUI();draw();
  };
  $('remove-road').onclick=()=>{
    if (inspectedCell === null || !city.roads.has(inspectedCell)) return;
    const message=city.edit(inspectedCell,true,0);
    if (!message) inspectedCell=null;
    toast(message || '道路已拆除，建设预算已返还');updateUI();draw();
  };
  $('save-design').onclick=()=>{
    try {
      localStorage.setItem(STORAGE_PREFIX+city.level.id,JSON.stringify(city.serializeDesign()));
      updateDesignControls();toast(`已保存「${city.level.name}」的设计`);
    } catch { toast('无法保存设计，请检查浏览器存储权限'); }
  };
  $('load-design').onclick=()=>{
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
    speed=1;accumulator=0;resultShown=false;inspectedCell=null;updateUI();draw();toast('已读取设计，可以重新规划或开始运营');
  };
  $('start').onclick=()=>{city.toggle();accumulator=0;updateUI();};
  $('stop').onclick=()=>{if(city.state==='running')city.toggle();updateUI();$('stop-dialog').showModal();};
  $('cancel-stop').onclick=()=> $('stop-dialog').close();
  $('confirm-stop').onclick=()=>{city.stop();speed=1;accumulator=0;$('stop-dialog').close();updateUI();draw();toast('已停止运营，设计已保留');};
  $('speed').onclick=()=>{speed=speed===1?2:1;updateUI();};
  $('help').onclick=()=>{if(city.state==='running')city.toggle();updateUI();$('help-dialog').showModal();};
  document.querySelector('.dialog-close').onclick=()=> $('help-dialog').close();
  document.querySelector('.dialog-done').onclick=()=> $('help-dialog').close();
  $('reset').onclick=()=>{if(city.state==='running')city.toggle();updateUI();$('reset-dialog').showModal();};
  $('cancel-reset').onclick=()=> $('reset-dialog').close();$('confirm-reset').onclick=()=>reset();
  $('play-again').onclick=()=>reset();$('view-city').onclick=()=> $('result-dialog').close();
  $('cancel-level').onclick=()=>{$('level-dialog').close();pendingLevel=null;};
  $('confirm-level').onclick=()=>{if(pendingLevel)reset(pendingLevel);};
  $('next-level').onclick=()=>{const next=levels()[levels().indexOf(city.level)+1];if(next)reset(next.id);};
  document.addEventListener('keydown',e=>{
    if(document.querySelector('dialog[open]')||e.ctrlKey||e.metaKey||e.altKey)return;
    if (['SELECT', 'INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    if(e.key==='1')setTool('road');if(e.key==='3')setTool('inspect');if(e.key==='4')setTool('cut');
    if(e.key==='Escape')keyboardAnchor=null;
    if(e.key.toLowerCase()==='p'){city.toggle();updateUI();e.preventDefault();}
    if(document.activeElement!==canvas)return;
    let {x,y}=point(keyboardCell);
    if(e.key.startsWith('Arrow')){
      e.preventDefault();keyboardMode=true;
      if(e.key==='ArrowLeft')x--;if(e.key==='ArrowRight')x++;if(e.key==='ArrowUp')y--;if(e.key==='ArrowDown')y++;
      keyboardCell=key(Math.max(0,Math.min(WIDTH-1,x)),Math.max(0,Math.min(HEIGHT-1,y)));
      if(keyboardAnchor!==null && keyboardAnchor!==keyboardCell) {
        const message=tool==='cut'?city.cut(keyboardAnchor,keyboardCell):city.connect(keyboardAnchor,keyboardCell,roadGrade);
        toast(message);keyboardAnchor=message?null:keyboardCell;inspectedCell=keyboardCell;updateUI();
      }
    }
    if(e.code==='Space'){
      e.preventDefault();if(e.repeat)return;keyboardMode=true;
      if(tool==='road'||tool==='cut') {keyboardAnchor=keyboardAnchor===null?keyboardCell:null;toast(keyboardAnchor===null?'本段结束':'用方向键延伸，空格或 Esc 结束');}
      else {
        inspectedCell=city.roads.has(keyboardCell)?keyboardCell:null;
        toast(inspectedCell===null?'这里没有道路':'已选择道路，请使用下方道路操作区');
      }
      updateUI();
    }
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&city.state==='running'){city.toggle();accumulator=0;updateUI();}});
  function frame(now) {
    const delta=lastFrame?Math.min((now-lastFrame)/1000,.25):0;lastFrame=now;
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
      const builtInMessage = TrafficCore.setLevels(await builtInResponse.json());
      if (builtInMessage) throw new Error(`默认关卡数据无效：${builtInMessage}`);
      try {
        const overrideResponse = await fetch('levels.json', { cache: 'no-store' });
        if (overrideResponse.ok) {
          const overrideMessage = TrafficCore.setLevels(await overrideResponse.json());
          if (overrideMessage) console.warn('忽略 levels.json：' + overrideMessage);
        } else if (overrideResponse.status !== 404) console.warn(`忽略 levels.json：请求失败（${overrideResponse.status}）`);
      } catch (error) { console.warn('忽略 levels.json：' + error.message); }
      city = new City(TrafficCore.LEVELS[0].id);
      buildLevelButtons();
      configureLevel();updateGrade();resize();updateUI();requestAnimationFrame(frame);
    } catch (error) {
      console.error(error);
      $('toast').textContent = '关卡数据加载失败，请确认游戏服务正常运行后刷新页面。';
      $('toast').classList.add('visible');
    }
  }
  bootstrap();
})();
