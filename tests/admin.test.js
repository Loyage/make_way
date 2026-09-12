'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { validateLevels, validateReferenceChains, normalizeCatalog, defaultLevels, createAdminServer } = require('../admin-server.js');
const { validateLevelCatalog } = require('../src/shared/level-validation.js');
const { setLevels, City, WIDTH, HEIGHT } = require('../src/shared/core.js');

function request(port, url, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: url, method, headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('validateLevels accepts the built-in chapter catalog', () => {
  const catalog=defaultLevels();
  assert.equal(validateLevels(catalog), '');
  assert.deepEqual(catalog.chapters.map(chapter=>[chapter.name,chapter.levels.length]),[['道路入门',5],['路口调度',7],['公共交通',5],['设计素材库',5]]);
  assert.equal(catalog.chapters.at(-1).hidden,true);
  const flat=catalog.chapters.flatMap(chapter=>chapter.levels),migrated=normalizeCatalog(flat);
  assert.deepEqual(migrated.chapters.map(chapter=>chapter.levels.length),[22]);assert.equal(validateLevels(flat),'');
});

test('validateLevels rejects chapter and level structural problems', () => {
  const good=defaultLevels(),first=data=>data.chapters[0].levels[0];
  assert.notEqual(validateLevels([]), '');
  const dupChapter=JSON.parse(JSON.stringify(good));dupChapter.chapters[1].id=dupChapter.chapters[0].id;
  assert.match(validateLevels(dupChapter),/章节 id 重复/);
  const dupId=JSON.parse(JSON.stringify(good));dupId.chapters[1].levels[0].id=first(dupId).id;
  assert.match(validateLevels(dupId),/关卡 id 重复/);
  const badCoord=JSON.parse(JSON.stringify(good));first(badCoord).water.push(WIDTH*HEIGHT);
  assert.match(validateLevels(badCoord),/越界/);
  const badBridge=JSON.parse(JSON.stringify(good));first(badBridge).bridges.push(0);
  assert.match(validateLevels(badBridge),/桥梁/);
  const noRoutes=JSON.parse(JSON.stringify(good));first(noRoutes).routes=[];
  assert.match(validateLevels(noRoutes),/路线/);
  const badEdge=JSON.parse(JSON.stringify(good));first(badEdge).initialEdges=(first(badEdge).initialEdges||[]).concat([[0,0,0]]);
  assert.match(validateLevels(badEdge),/initialEdges/);
  const badBusLimit=JSON.parse(JSON.stringify(good));first(badBusLimit).busLineLimit=9;
  assert.match(validateLevels(badBusLimit),/busLineLimit/);
  const impossible=JSON.parse(JSON.stringify(good));first(impossible).routes[0].goals.forEach(goal=>goal.input=1);
  assert.match(validateLevels(impossible),/住宅总人口.*最多可接收/);
  const fractional=JSON.parse(JSON.stringify(good));first(fractional).routes[0].homes[0].passengers=1.5;
  assert.match(validateLevels(fractional),/passengers/);
  const roadOnTree=JSON.parse(JSON.stringify(good)),roadLevel=first(roadOnTree),roadCell=roadLevel.trees[0];roadLevel.initialRoads=[{cell:roadCell,grade:0}];roadLevel.initialEdges=[];
  assert.match(validateLevels(roadOnTree),/不可建设地形/);
  const dupHome=JSON.parse(JSON.stringify(good)),homeLevel=first(dupHome);
  homeLevel.routes[0].homes.push({cell:homeLevel.routes[0].homes[0].cell,rate:4,passengers:60});
  assert.match(validateLevels(dupHome),/重叠的住宅/);
  const dupGoal=JSON.parse(JSON.stringify(good)),goalLevel=first(dupGoal);
  goalLevel.routes[0].goals.push({cell:goalLevel.routes[0].goals[0].cell,label:'重复'});
  assert.match(validateLevels(dupGoal),/重叠的目的地/);
  const crossRoute=JSON.parse(JSON.stringify(good)),crossLevel=first(crossRoute);
  crossLevel.routes.push({name:'占位',color:'#638d69',light:'#dae6cb',homes:[{cell:crossLevel.routes[0].goals[0].cell,rate:1,passengers:60}],goals:[{cell:crossLevel.routes[0].homes[0].cell+1,label:'终'}]});
  assert.match(validateLevels(crossRoute),/重叠/);
  const variableDays=JSON.parse(JSON.stringify(good)),variableCampaign=variableDays.chapters[0].levels.find(level=>level.id==='growing-city');variableCampaign.campaign.days.push({duration:70,maxIncome:28});
  assert.equal(validateLevels(variableDays),'');
  const badDays=JSON.parse(JSON.stringify(good)),campaignLevel=badDays.chapters[0].levels.find(level=>level.id==='growing-city');campaignLevel.campaign.days.length=1;
  assert.match(validateLevels(badDays),/2 至 30 天/);
  const badRegion=JSON.parse(JSON.stringify(good)),regionLevel=badRegion.chapters[0].levels.find(level=>level.id==='growing-city');regionLevel.campaign.regions[1].cells.push(regionLevel.campaign.regions[0].cells[0]);
  assert.match(validateLevels(badRegion),/扩建区域.*重叠格子/);
  const impossiblePotential=JSON.parse(JSON.stringify(good)),potentialLevel=impossiblePotential.chapters[0].levels.find(level=>level.id==='growing-city');potentialLevel.campaign.routes[0].goals[0].input=1;
  assert.match(validateLevels(impossiblePotential),/潜在建筑.*住宅总人口.*最多可接收/);
  const mismatchedFirst=JSON.parse(JSON.stringify(good)),mismatch=mismatchedFirst.chapters[0].levels.find(level=>level.id==='growing-city');mismatch.campaign.days[0].duration++;
  assert.match(validateLevels(mismatchedFirst),/必须与第 1 天一致/);
});

test('shared validation collects independent problems with navigation metadata', () => {
  const catalog=JSON.parse(JSON.stringify(defaultLevels())),first=catalog.chapters[0].levels[0],second=catalog.chapters[1].levels[0];
  first.name='';first.budget=0;first.features.grade='yes';first.water.push(WIDTH*HEIGHT);
  second.duration=0;
  const result=validateLevelCatalog(catalog);
  assert.equal(result.ok,false);assert.ok(result.errors.length>=5);
  assert.ok(result.errors.some(issue=>issue.levelId===first.id&&issue.path.endsWith('.name')));
  assert.ok(result.errors.some(issue=>issue.levelId===first.id&&issue.path.endsWith('.budget')));
  assert.ok(result.errors.some(issue=>issue.levelId===first.id&&issue.path.endsWith('.features.grade')));
  assert.ok(result.errors.some(issue=>issue.levelId===first.id&&issue.cell===WIDTH*HEIGHT));
  assert.ok(result.errors.some(issue=>issue.levelId===second.id&&issue.path.endsWith('.duration')));
});

test('shared validation checks level and campaign-day star targets', () => {
  const catalog=JSON.parse(JSON.stringify(defaultLevels())),level=catalog.chapters[0].levels[0];
  level.starTargets.satisfaction=101;
  let result=validateLevelCatalog(catalog);assert.equal(result.ok,false);assert.ok(result.errors.some(issue=>issue.path.endsWith('.starTargets')));
  level.starTargets.satisfaction=90;const campaign=catalog.chapters.flatMap(chapter=>chapter.levels).find(item=>item.campaign);campaign.campaign.days[1].starTargets.efficiency.maxQueue=-1;
  result=validateLevelCatalog(catalog);assert.equal(result.ok,false);assert.ok(result.errors.some(issue=>issue.path.includes('campaign.days[1].starTargets')));
});

test('validateLevels accepts complete tutorial and per-day campaign references', () => {
  const source=defaultLevels(),levelId=source.chapters[0].levels[0].id;
  setLevels(source);
  const design=new City(levelId).serializeDesign(),good=JSON.parse(JSON.stringify(defaultLevels()));
  const level=good.chapters[0].levels[0];
  level.referenceDesign=design;
  assert.equal(validateLevels(good),'');
  level.referenceDesign.levelId='another-level';
  assert.match(validateLevels(good),/referenceDesign 格式无效/);
  const campaign=JSON.parse(JSON.stringify(defaultLevels())),campaignLevel=campaign.chapters[0].levels.find(item=>item.id==='growing-city');
  assert.ok(campaignLevel.campaign.days.every(day=>day.referenceDesign));assert.equal(validateLevels(campaign),'');
  campaignLevel.campaign.days[2].referenceDesign.levelId='another-level';
  assert.match(validateLevels(campaign),/第 3 天的参考答案.*referenceDesign 格式无效/);
});

test('campaign reference-chain validation rejects a structurally valid losing day', () => {
  const catalog=JSON.parse(JSON.stringify(defaultLevels())),campaign=catalog.chapters.flatMap(chapter=>chapter.levels).find(item=>item.id==='growing-city'),design=campaign.campaign.days[0].referenceDesign;
  Object.assign(design,{roads:[],edges:[],roadPolicies:[],signals:[],busLines:[],activeBusLineId:null});
  assert.equal(validateLevels(catalog),'');
  assert.match(validateReferenceChains(catalog),/第 1 天失败.*仅送达/);
});

test('validateLevels accepts per-level map sizes and rejects invalid dimensions', () => {
  const custom=JSON.parse(JSON.stringify(defaultLevels())),level=custom.chapters[0].levels[0];
  delete level.referenceDesign;level.width=20;level.height=12;
  assert.equal(validateLevels(custom),'');
  level.width=65;assert.match(validateLevels(custom),/地图宽高/);
  level.width=20;level.water=[20*12];assert.match(validateLevels(custom),/越界/);
});

test('setLevels rebuilds active LEVELS and freezes definitions', () => {
  setLevels(defaultLevels());
  const city = new City(defaultLevels().chapters[0].levels[0].id);
  assert.ok(city instanceof City);
  assert.match(setLevels([]), /至少需要一个关卡/);
  assert.match(setLevels([{ id: 'x' }, { id: 'x' }]), /重复/);
  assert.throws(() => { require('../src/shared/core.js').LEVELS[0].budget = 999; }, TypeError);
});

test('admin server refuses to start without an explicit password', async () => {
  const admin=process.env.ADMIN_PASSWORD,piAdmin=process.env.PI_ADMIN_PASSWORD;
  delete process.env.ADMIN_PASSWORD;delete process.env.PI_ADMIN_PASSWORD;
  try { await assert.rejects(createAdminServer({port:0,host:'127.0.0.1'}),/must be set/); }
  finally {
    if(admin===undefined)delete process.env.ADMIN_PASSWORD;else process.env.ADMIN_PASSWORD=admin;
    if(piAdmin===undefined)delete process.env.PI_ADMIN_PASSWORD;else process.env.PI_ADMIN_PASSWORD=piAdmin;
  }
});

test('admin server gates /api/levels behind login and writes levels.json', async t => {
  const { createAdminServer } = require('../admin-server.js');
  process.env.ADMIN_PASSWORD = 'test-secret';
  let restartCalls = 0;
  const server = await createAdminServer({ port: 0, host: '127.0.0.1', secureCookie: true, restartService: async () => { restartCalls++; return { service: 'traffic-game.service', state: 'active' }; } });
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;

  // Unauthenticated access is rejected.
  const unauth = await request(port, '/api/levels');
  assert.equal(unauth.status, 401);
  assert.equal((await request(port, '/api/game-service/restart', 'POST')).status, 401);
  assert.equal(restartCalls, 0);

  // Wrong password is rejected.
  const badLogin = await request(port, '/api/login', 'POST', JSON.stringify({ password: 'nope' }));
  assert.equal(badLogin.status, 401);

  // Correct password issues a session cookie.
  const goodLogin = await request(port, '/api/login', 'POST', JSON.stringify({ password: 'test-secret' }));
  assert.equal(goodLogin.status, 200);
  const cookie = (goodLogin.headers['set-cookie'] || []).find(c => c.startsWith('traffic_admin='));
  assert.ok(cookie);
  assert.match(cookie, /; Secure$/);

  // Authenticated GET returns the default level set.
  const list = await request(port, '/api/levels', 'GET', null, { Cookie: cookie.split(';')[0] });
  assert.equal(list.status, 200);
  const catalog=JSON.parse(list.body).catalog;
  assert.equal(catalog.chapters.length,4);
  assert.ok(catalog.chapters.flatMap(chapter=>chapter.levels).length>=6);
  const restarted=await request(port,'/api/game-service/restart','POST',null,{Cookie:cookie.split(';')[0]});
  assert.equal(restarted.status,200);assert.equal(JSON.parse(restarted.body).state,'active');assert.equal(restartCalls,1);
  const valid=await request(port,'/api/validate','POST',JSON.stringify(catalog),{Cookie:cookie.split(';')[0]});
  assert.equal(valid.status,200);
  const invalid=JSON.parse(JSON.stringify(catalog));invalid.chapters[0].levels[0].routes[0].goals.forEach(goal=>goal.input=1);
  const invalidResponse=await request(port,'/api/validate','POST',JSON.stringify(invalid),{Cookie:cookie.split(';')[0]});
  assert.equal(invalidResponse.status,400);
  const validationBody=JSON.parse(invalidResponse.body);assert.ok(Array.isArray(validationBody.errors));assert.equal(validationBody.errors[0].levelId,invalid.chapters[0].levels[0].id);

  // Static assets are served.
  const page = await request(port, '/', 'GET', null, { Cookie: cookie.split(';')[0] });
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  assert.match(page.body,/id="admin-inspector"/);assert.match(page.body,/id="admin-add-chapter"/);assert.match(page.body,/id="admin-chapter"/);
  assert.match(page.body,/id="admin-campaign-enabled"/);assert.match(page.body,/id="admin-campaign-day"/);assert.match(page.body,/id="admin-day-income"/);assert.match(page.body,/id="admin-star-satisfaction"/);assert.match(page.body,/id="admin-day-star-queue"/);assert.match(page.body,/id="admin-region"/);assert.match(page.body,/id="admin-region-use-selection"/);
  assert.match(page.body,/id="admin-selection"/);assert.match(page.body,/id="admin-capture-roads"/);assert.match(page.body,/data-terrain="water"/);
  assert.match(page.body,/id="admin-capture-reference"/);assert.match(page.body,/id="admin-delete-reference"/);assert.match(page.body,/id="reference-design"/);
  assert.match(page.body,/id="admin-verify-play"/);assert.match(page.body,/id="admin-trial-status"/);assert.match(page.body,/id="admin-publish"/);assert.match(page.body,/id="admin-restart-game"/);assert.match(page.body,/id="admin-undo"/);assert.match(page.body,/src="core.js"/);
  assert.match(page.body,/src="admin.js"><\/script><script src="game.js"/);assert.match(page.body,/href="admin-manual.html"/);
  assert.match(page.body,/id="start"/);assert.match(page.body,/id="road-tool"/);assert.match(page.body,/id="road-inspector"/);
  const manual=await request(port,'/admin-manual.html','GET',null,{Cookie:cookie.split(';')[0]});
  assert.equal(manual.status,200);assert.match(manual.body,/管理员操作手册/);assert.match(manual.body,/权限更高的游玩面板/);

  const logout=await request(port,'/api/logout','POST',null,{Cookie:cookie.split(';')[0]});
  assert.equal(logout.status,200);
  assert.equal((await request(port,'/api/levels','GET',null,{Cookie:cookie.split(';')[0]})).status,401,'logout must revoke the server-side session');
});

test('admin server binds to loopback by default', async t => {
  process.env.ADMIN_PASSWORD = 'test-secret';
  const server = await createAdminServer({ port: 0 });
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  assert.equal(server.address().address, '127.0.0.1');
});

test('admin server saves named presets and overwrites the default config', async t => {
  const { createAdminServer, defaultLevels } = require('../admin-server.js');
  const fs = require('node:fs'), path = require('node:path');
  const BUILT_IN = path.join(__dirname, '..', 'built-in-levels.json');
  const PRESET_DIR = path.join(__dirname, '..', 'level-presets');
  const backup = fs.readFileSync(BUILT_IN, 'utf8');
  process.env.ADMIN_PASSWORD = 'test-secret';
  const server = await createAdminServer({ port: 0, host: '127.0.0.1' });
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); try { fs.rmSync(PRESET_DIR, { recursive: true, force: true }); } catch { /* ignore */ } }));
  const port = server.address().port;
  const login = await request(port, '/api/login', 'POST', JSON.stringify({ password: 'test-secret' }));
  const cookie = (login.headers['set-cookie'] || []).find(c => c.startsWith('traffic_admin=')).split(';')[0];
  const auth = { Cookie: cookie }, body = JSON.stringify(defaultLevels());

  assert.deepEqual(JSON.parse((await request(port, '/api/presets', 'GET', null, auth)).body).presets, []);
  assert.equal((await request(port, '/api/presets/my-config', 'PUT', body, auth)).status, 200);
  assert.equal((await request(port, '/api/presets/my-config', 'PUT', body, auth)).status, 409, 'duplicate preset name must be rejected');
  assert.deepEqual(JSON.parse((await request(port, '/api/presets', 'GET', null, auth)).body).presets, ['my-config']);
  const loaded = await request(port, '/api/presets/my-config', 'GET', null, auth);
  assert.equal(loaded.status, 200);
  assert.equal(JSON.parse(loaded.body).catalog.chapters.length, 4);
  assert.equal((await request(port, '/api/presets/bad%2Fname', 'PUT', body, auth)).status, 400);

  try { assert.equal((await request(port, '/api/default', 'PUT', body, auth)).status, 200); }
  finally { fs.writeFileSync(BUILT_IN, backup); }
});

test('admin server rate-limits repeated login failures by source', async t => {
  process.env.ADMIN_PASSWORD = 'test-secret';
  const server = await createAdminServer({ port: 0, host: '127.0.0.1' });
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const response = await request(port, '/api/login', 'POST', JSON.stringify({ password: 'wrong' }));
    assert.equal(response.status, 401);
  }
  const blocked = await request(port, '/api/login', 'POST', JSON.stringify({ password: 'wrong' }));
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers['retry-after']) > 0);
  assert.equal((await request(port, '/api/login', 'POST', JSON.stringify({ password: 'test-secret' }))).status, 429);
});
