(() => {
  'use strict';
  const { City, LEVELS, WIDTH, HEIGHT, key, point, neighbors } = TrafficCore;
  const $ = id => document.getElementById(id);
  const canvas = $('map'), ctx = canvas.getContext('2d');
  let city = new City(LEVELS[0].id), tool = 'road', speed = 1, hover = null, dragging = false;
  let lastCell = null, dragErase = false, cellSize = 40, lastFrame = 0, accumulator = 0;
  let toastTimer, resultShown = false, keyboardCell = key(1, 2), keyboardMode = false;
  let connectionRows = [], pendingLevel = null;
  const levelButtons = LEVELS.map((level, i) => {
    const button = document.createElement('button');
    button.className = 'level-card';
    const number = document.createElement('span'); number.className = 'level-number'; number.textContent = String(i + 1).padStart(2, '0');
    const name = document.createElement('strong'); name.textContent = level.name;
    const detail = document.createElement('small'); detail.textContent = `${level.difficulty} · ${level.routes.length} 组出行`;
    button.append(number, name, detail); button.onclick = () => requestLevel(level.id);
    $('level-list').append(button);
    return button;
  });
  function configureLevel() {
    const level = city.level, index = LEVELS.indexOf(level);
    const number = String(index + 1).padStart(2, '0');
    $('level-eyebrow').textContent = `城市实验室 / ${number} · ${level.name}`;
    $('chapter-number').textContent = number;
    $('chapter-name').textContent = level.english;
    $('map-name').textContent = level.name;
    $('target-label').textContent = `目标 ${level.target}`;
    $('target-unit').textContent = `/ ${level.target} 辆`;
    $('mission-title').textContent = level.title;
    $('mission-description').textContent = `在 ${level.duration} 秒内送达 ${level.target} 辆车，可用道路 ${level.budget} 格。${level.description}`;
    $('mission-tip').textContent = `↗ ${level.tip}`;
    levelButtons.forEach((button, i) => {
      button.classList.toggle('selected', i === index);
      button.setAttribute('aria-current', i === index ? 'true' : 'false');
    });
    $('connection-list').replaceChildren();
    connectionRows = city.routes.map(route => {
      const row = document.createElement('div'); row.className = 'connection-row';
      const name = document.createElement('span'), dot = document.createElement('i');
      dot.style.background = route.color; name.append(dot, route.name);
      const status = document.createElement('span'); status.textContent = '待连接';
      row.append(name, status); $('connection-list').append(row);
      return { row, status };
    });
  }
  function requestLevel(id) {
    if (id === city.level.id) return;
    if (city.state === 'planning' && city.remaining === city.level.budget || ['won', 'lost'].includes(city.state)) {
      reset(id); return;
    }
    if (city.state === 'running') city.toggle();
    pendingLevel = id;
    $('level-confirm-title').textContent = `前往「${LEVELS.find(level => level.id === id).name}」？`;
    updateUI(); $('level-dialog').showModal();
  }
  function toast(text) {
    if (!text) return;
    $('toast').textContent = text; $('toast').classList.add('visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 2200);
  }
  function setTool(value) {
    tool = value;
    for (const name of ['road', 'erase']) {
      $(name + '-tool').classList.toggle('active', name === tool);
      $(name + '-tool').setAttribute('aria-pressed', String(name === tool));
    }
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
  function drawBuilding(n, r, home, routeIndex) {
    const {x,y}=point(n), s=cellSize, cx=(x+.5)*s, cy=(y+.5)*s;
    rounded(x*s+s*.1,y*s+s*.15,s*.8,s*.8,s*.16,'#8d9a7d22');
    rounded(x*s+s*.08,y*s+s*.07,s*.84,s*.84,s*.17,r.light);
    if(home) {
      ctx.beginPath(); ctx.moveTo(cx-s*.27,cy-s*.03);ctx.lineTo(cx,cy-s*.29);ctx.lineTo(cx+s*.27,cy-s*.03);ctx.closePath();ctx.fillStyle=r.color;ctx.fill();
      rounded(cx-s*.2,cy-s*.05,s*.4,s*.31,s*.025,r.color);
      rounded(cx-s*.055,cy+s*.08,s*.11,s*.18,s*.01,r.light);
    } else {
      rounded(cx-s*.26,cy-s*.25,s*.52,s*.49,s*.055,r.color);
      rounded(cx-s*.19,cy-s*.19,s*.38,s*.12,s*.025,r.light);
      for(let j=0;j<3;j++) rounded(cx-s*.18+j*s*.13,cy-s*.005,s*.075,s*.11,s*.01,r.light);
      rounded(cx-s*.045,cy+s*.12,s*.09,s*.12,s*.01,r.light);
    }
    label(home?'住宅':r.label,cx,(y+1.1)*s,s*.20,r.color,'600');
    if(home && city.queues[routeIndex]) {
      const bx=(x+.86)*s,by=(y+.14)*s;
      circle(bx,by,s*.19,city.queues[routeIndex]>7?'#bd7750':r.color);
      label(String(city.queues[routeIndex]),bx,by,s*.2,'#fff','700');
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
      const links=neighbors(n).filter(v=>city.roads.has(v)||city.buildings.has(v));
      rounded(cx-s*.31,cy-s*.31,s*.62,s*.62,s*.12,'#b3bfa7');
      for(const v of links) {
        const p=point(v);
        line(cx,cy,cx+(p.x-x)*s*.51,cy+(p.y-y)*s*.51,'#b3bfa7',s*.62);
      }
      ctx.setLineDash([s*.09,s*.08]);
      for(const v of links) {
        const p=point(v);line(cx,cy,cx+(p.x-x)*s*.5,cy+(p.y-y)*s*.5,'#eaf0dfb0',s*.025);
      }
      ctx.setLineDash([]);
      if(city.bridges.has(n)) {
        line(x*s,(y+.14)*s,(x+1)*s,(y+.14)*s,'#8d9b89',s*.055);
        line(x*s,(y+.86)*s,(x+1)*s,(y+.86)*s,'#8d9b89',s*.055);
      }
    }
    for(const n of city.trees) {
      const {x,y}=point(n),cx=(x+.5)*s,cy=(y+.48)*s;
      circle(cx+s*.04,cy+s*.16,s*.25,'#cddcbc');
      line(cx,cy,cx,cy+s*.31,'#a5b18d',s*.055);
      circle(cx-s*.1,cy,s*.19,'#a9c398');circle(cx+s*.1,cy+s*.015,s*.19,'#9ab88a');circle(cx,cy-s*.13,s*.19,'#b3cba1');
    }
    city.routes.forEach((r,i)=>{drawBuilding(r.home,r,true,i);drawBuilding(r.goal,r,false,i);});
    for(const car of city.cars) {
      const p=point(car.cell),q=car.next===null?p:point(car.next),t=car.progress;
      let dx=0,dy=0;
      if(Math.abs(car.heading)===1) dx=Math.sign(car.heading);else dy=Math.sign(car.heading);
      const cx=(p.x+.5+(q.x-p.x)*t-dy*.15)*s,cy=(p.y+.5+(q.y-p.y)*t+dx*.15)*s;
      ctx.save();ctx.translate(cx,cy);ctx.rotate(Math.atan2(dy,dx));
      rounded(-s*.17,-s*.085+s*.025,s*.34,s*.17,s*.05,'#344c3333');
      rounded(-s*.17,-s*.085,s*.34,s*.17,s*.045,city.routes[car.route].color);
      rounded(s*.025,-s*.062,s*.065,s*.124,s*.012,'#f5f6e9bb');
      if(car.blocked>1) circle(-s*.19,0,s*.025,'#e2a15e');
      ctx.restore();
    }
    const selected=keyboardMode?keyboardCell:hover;
    if(selected!==null) {
      const {x,y}=point(selected),erase=dragging?dragErase:tool==='erase';
      rounded(x*s+1,y*s+1,s-2,s-2,s*.1,erase?'#d18d4f22':'#317a5719',erase?'#c68b56':'#6d936b');
      if(!city.buildings.has(selected)&&!city.roads.has(selected))label(erase?'−':'+',(x+.5)*s,(y+.5)*s,s*.42,erase?'#bd8253':'#82a277');
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
    $('speed').textContent=speed+'×';
    $('connection-count').textContent=city.paths.filter(Boolean).length+' / '+city.routes.length;
    connectionRows.forEach(({row,status},i)=>{
      row.classList.toggle('connected',!!city.paths[i]);status.textContent=city.paths[i]?'已连接 ✓':'待连接';
    });
    if(['won','lost'].includes(city.state)&&!resultShown) showResult();
  }
  function showResult() {
    resultShown=true;
    const won=city.state==='won';
    $('result-icon').textContent=won?'✳':'⌁';
    $('result-title').textContent=won?'这座小城，因你而畅通。':'再给小城一个好计划。';
    $('result-description').textContent=won?'目标达成！每一段精心规划的道路，都让生活更近了一点。':'时间到了。'+city.level.tip;
    $('result-stats').textContent=`${city.level.name} · 抵达 ${city.delivered} / ${city.level.target} 辆 · 用时 ${Math.ceil(city.elapsed)} 秒 · 修路 ${city.level.budget-city.remaining} 格`;
    $('next-level').hidden = !won || LEVELS.indexOf(city.level) === LEVELS.length - 1;
    for(const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    $('result-dialog').showModal();
  }
  function reset(levelId = city.level.id) {
    for(const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    city=new City(levelId);speed=1;accumulator=0;resultShown=false;dragging=false;lastCell=null;
    pendingLevel=null;hover=null;keyboardMode=false;keyboardCell=key(1,2);
    configureLevel();setTool('road');updateUI();draw();toast(`欢迎来到${city.level.name}！${city.level.tip}`);
  }
  function eventCell(event) {
    const rect=canvas.getBoundingClientRect(),x=Math.floor((event.clientX-rect.left)/rect.width*WIDTH),y=Math.floor((event.clientY-rect.top)/rect.height*HEIGHT);
    return x>=0&&x<WIDTH&&y>=0&&y<HEIGHT?key(x,y):null;
  }
  function paint(n) {
    if(n===null) {lastCell=null;return;}
    let message='';
    if(lastCell!==null) {
      // Fill skipped cells along a four-connected staircase, even on fast drags.
      let {x,y}=point(lastCell);const target=point(n);
      const dx=Math.abs(target.x-x),dy=Math.abs(target.y-y);let ix=0,iy=0;
      while(x!==target.x||y!==target.y) {
        if(x!==target.x&&(y===target.y||(ix+.5)/(dx||1)<=(iy+.5)/(dy||1))) {x+=Math.sign(target.x-x);ix++;}
        else {y+=Math.sign(target.y-y);iy++;}
        message=city.edit(key(x,y),dragErase)||message;
      }
    } else message=city.edit(n,dragErase);
    lastCell=n;toast(message);updateUI();draw();
  }
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('pointerdown',e=>{
    if(e.button!==0&&e.button!==2)return;
    e.preventDefault();canvas.focus({preventScroll:true});keyboardMode=false;dragging=true;dragErase=e.button===2||tool==='erase';lastCell=null;
    canvas.setPointerCapture(e.pointerId);hover=eventCell(e);paint(hover);
  });
  canvas.addEventListener('pointermove',e=>{keyboardMode=false;hover=eventCell(e);if(dragging)paint(hover);});
  const endDrag=()=>{dragging=false;lastCell=null;};
  canvas.addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',endDrag);canvas.addEventListener('lostpointercapture',endDrag);
  canvas.addEventListener('pointerleave',()=>{hover=null;});
  $('road-tool').onclick=()=>setTool('road');$('erase-tool').onclick=()=>setTool('erase');
  $('start').onclick=()=>{city.toggle();accumulator=0;updateUI();};
  $('speed').onclick=()=>{speed=speed===1?2:1;updateUI();};
  $('help').onclick=()=>{if(city.state==='running')city.toggle();updateUI();$('help-dialog').showModal();};
  document.querySelector('.dialog-close').onclick=()=> $('help-dialog').close();
  document.querySelector('.dialog-done').onclick=()=> $('help-dialog').close();
  $('reset').onclick=()=>{if(city.state==='running')city.toggle();updateUI();$('reset-dialog').showModal();};
  $('cancel-reset').onclick=()=> $('reset-dialog').close();$('confirm-reset').onclick=()=>reset();
  $('play-again').onclick=()=>reset();$('view-city').onclick=()=> $('result-dialog').close();
  $('cancel-level').onclick=()=>{$('level-dialog').close();pendingLevel=null;};
  $('confirm-level').onclick=()=>{if(pendingLevel)reset(pendingLevel);};
  $('next-level').onclick=()=>{const next=LEVELS[LEVELS.indexOf(city.level)+1];if(next)reset(next.id);};
  document.addEventListener('keydown',e=>{
    if(document.querySelector('dialog[open]')||e.ctrlKey||e.metaKey||e.altKey)return;
    if(e.key==='1')setTool('road');if(e.key==='2')setTool('erase');
    if(e.key.toLowerCase()==='p'){city.toggle();updateUI();e.preventDefault();}
    if(document.activeElement!==canvas)return;
    let {x,y}=point(keyboardCell);
    if(e.key.startsWith('Arrow')){
      e.preventDefault();keyboardMode=true;
      if(e.key==='ArrowLeft')x--;if(e.key==='ArrowRight')x++;if(e.key==='ArrowUp')y--;if(e.key==='ArrowDown')y++;
      keyboardCell=key(Math.max(0,Math.min(WIDTH-1,x)),Math.max(0,Math.min(HEIGHT-1,y)));
    }
    if(e.code==='Space'){e.preventDefault();keyboardMode=true;toast(city.edit(keyboardCell,tool==='erase'));updateUI();}
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&city.state==='running'){city.toggle();accumulator=0;updateUI();}});
  function frame(now) {
    const delta=lastFrame?Math.min((now-lastFrame)/1000,.25):0;lastFrame=now;
    if(city.state==='running') {
      accumulator+=delta*speed;
      while(accumulator>=.05){city.step(.05);accumulator-=.05;}
    } else accumulator=0;
    updateUI();draw();requestAnimationFrame(frame);
  }
  new ResizeObserver(resize).observe(canvas);
  configureLevel();resize();updateUI();requestAnimationFrame(frame);
})();
