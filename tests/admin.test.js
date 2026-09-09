'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { validateLevels, normalizeCatalog, defaultLevels, createAdminServer } = require('../admin-server.js');
const { setLevels, City, WIDTH, HEIGHT } = require('../core.js');

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
  assert.deepEqual(catalog.chapters.map(chapter=>[chapter.name,chapter.levels.length]),[['道路入门',6],['城市调度',4]]);
  const flat=catalog.chapters.flatMap(chapter=>chapter.levels),migrated=normalizeCatalog(flat);
  assert.deepEqual(migrated.chapters.map(chapter=>chapter.levels.length),[6,4]);assert.equal(validateLevels(flat),'');
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
  const impossible=JSON.parse(JSON.stringify(good));first(impossible).target=999999;
  assert.match(validateLevels(impossible),/最多可送达/);
  const fractional=JSON.parse(JSON.stringify(good));first(fractional).routes[0].homes[0].passengers=1.5;
  assert.match(validateLevels(fractional),/passengers/);
  const roadOnTree=JSON.parse(JSON.stringify(good)),roadLevel=first(roadOnTree),roadCell=roadLevel.trees[0];roadLevel.initialEdges=[[roadCell,roadCell+1,0]];
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
  const badDays=JSON.parse(JSON.stringify(good)),campaignLevel=badDays.chapters[0].levels.find(level=>level.id==='growing-city');campaignLevel.campaign.days.pop();
  assert.match(validateLevels(badDays),/正好包含 5 天/);
  const impossibleDay=JSON.parse(JSON.stringify(good)),dayLevel=impossibleDay.chapters[0].levels.find(level=>level.id==='growing-city');dayLevel.campaign.days[2].target=999999;
  assert.match(validateLevels(impossibleDay),/第 3 天.*最多可送达/);
  const mismatchedFirst=JSON.parse(JSON.stringify(good)),mismatch=mismatchedFirst.chapters[0].levels.find(level=>level.id==='growing-city');mismatch.campaign.days[0].target++;
  assert.match(validateLevels(mismatchedFirst),/必须与第 1 天一致/);
});

test('validateLevels accepts per-level map sizes and rejects invalid dimensions', () => {
  const custom=JSON.parse(JSON.stringify(defaultLevels())),level=custom.chapters[0].levels[0];
  level.width=20;level.height=12;
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
  assert.throws(() => { require('../core.js').LEVELS[0].budget = 999; }, TypeError);
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
  const server = await createAdminServer({ port: 0, host: '127.0.0.1' });
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;

  // Unauthenticated access is rejected.
  const unauth = await request(port, '/api/levels');
  assert.equal(unauth.status, 401);

  // Wrong password is rejected.
  const badLogin = await request(port, '/api/login', 'POST', JSON.stringify({ password: 'nope' }));
  assert.equal(badLogin.status, 401);

  // Correct password issues a session cookie.
  const goodLogin = await request(port, '/api/login', 'POST', JSON.stringify({ password: 'test-secret' }));
  assert.equal(goodLogin.status, 200);
  const cookie = (goodLogin.headers['set-cookie'] || []).find(c => c.startsWith('traffic_admin='));
  assert.ok(cookie);

  // Authenticated GET returns the default level set.
  const list = await request(port, '/api/levels', 'GET', null, { Cookie: cookie.split(';')[0] });
  assert.equal(list.status, 200);
  const catalog=JSON.parse(list.body).catalog;
  assert.equal(catalog.chapters.length,2);
  assert.ok(catalog.chapters.flatMap(chapter=>chapter.levels).length>=6);

  // Static assets are served.
  const page = await request(port, '/', 'GET', null, { Cookie: cookie.split(';')[0] });
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  assert.match(page.body,/id="new-chapter"/);assert.match(page.body,/id="f-chapter"/);
  assert.match(page.body,/id="f-campaign"/);assert.match(page.body,/id="campaign-days"/);assert.match(page.body,/id="f-day-income"/);
  assert.match(page.body,/id="f-map-width"/);assert.match(page.body,/id="f-map-height"/);assert.match(page.body,/data-tool="view"/);
  assert.match(page.body,/id="save-preset"/);assert.match(page.body,/id="load-preset"/);assert.match(page.body,/id="preset-select"/);assert.match(page.body,/id="overwrite-default"/);
  assert.match(page.body,/坐标系：地图中心为原点/);

  const logout=await request(port,'/api/logout','POST',null,{Cookie:cookie.split(';')[0]});
  assert.equal(logout.status,200);
  assert.equal((await request(port,'/api/levels','GET',null,{Cookie:cookie.split(';')[0]})).status,401,'logout must revoke the server-side session');
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
  assert.equal(JSON.parse(loaded.body).catalog.chapters.length, 2);
  assert.equal((await request(port, '/api/presets/bad%2Fname', 'PUT', body, auth)).status, 400);

  try { assert.equal((await request(port, '/api/default', 'PUT', body, auth)).status, 200); }
  finally { fs.writeFileSync(BUILT_IN, backup); }
});
