'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createGameServer } = require('../server.js');
const { loadCatalogSync } = require('../src/shared/level-catalog.js');
const BUILT_IN_CATALOG = loadCatalogSync(require('node:path').join(__dirname, '..', 'built-in-levels.json'));
const BUILT_IN_LEVELS = BUILT_IN_CATALOG.chapters.flatMap(chapter => chapter.levels);

async function setup(t) {
  const server = await createGameServer();
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return server.address().port;
}
function request(port, url, method='GET', headers={}) {
  return new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,path:url,method,headers},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));
    });
    req.on('error',reject);req.end();
  });
}
test('serves only game assets with appropriate MIME types and security headers', async t => {
  const port=await setup(t);
  for(const [url,type] of [['/','text/html'],['/index.html','text/html'],['/manual.html','text/html'],['/style.css','text/css'],['/built-in-levels.json','application/json'],['/levels/road-basics/chapter.json','application/json'],['/levels/junction-control/signal-cross.json','application/json'],['/levels/public-transit/bridge-transfer.json','application/json'],['/levels/design-archive/bus-school.json','application/json'],['/level-catalog.js','text/javascript'],['/core-geometry.js','text/javascript'],['/core-bus.js','text/javascript'],['/core.js','text/javascript'],['/core-campaign.js','text/javascript'],['/level-validation.js','text/javascript'],['/game-results.js','text/javascript'],['/game-effects.js','text/javascript'],['/game-canvas.js','text/javascript'],['/game-bootstrap.js','text/javascript'],['/game-storage.js','text/javascript'],['/game-design-sharing.js','text/javascript'],['/game-tutorial.js','text/javascript'],['/game-navigation.js','text/javascript'],['/game.js?v=2','text/javascript']]) {
    const res=await request(port,url);assert.equal(res.status,200);assert.ok(res.headers['content-type'].startsWith(type));
    assert.equal(res.headers['x-content-type-options'],'nosniff');assert.ok(res.headers['content-security-policy']);assert.ok(res.body.length>100);
  }
});
test('index contains no embedded level metadata', async t => {
  const port=await setup(t);
  const html=(await request(port,'/')).body;
  for (const level of BUILT_IN_LEVELS) {
    for (const value of [level.name,level.english,level.title,level.description,level.tip]) {
      assert.equal(html.includes(value),false,`${level.id} metadata must come from JSON`);
    }
  }
  assert.match(html,/id="level-summary"><\/small>/);
  assert.match(html,/id="mission-title"><\/h2>/);
  assert.match(html,/id="undo-design"/);assert.match(html,/id="redo-design"/);
  assert.match(html,/id="continue-game"/);assert.match(html,/id="clear-progress"/);assert.match(html,/id="share-design"/);assert.match(html,/id="import-design"/);assert.match(html,/src="game-storage.js"/);assert.match(html,/src="game-design-sharing.js"/);assert.match(html,/src="game-tutorial.js"/);assert.match(html,/src="game-navigation.js"/);
  const manual=(await request(port,'/manual.html')).body;
  assert.match(manual,/慢行小城游戏指南/);
  assert.match(manual,/拖拽模式：智能建设、连接与改造/);
  assert.match(manual,/选中整段道路/);
  assert.match(manual,/一辆车怎样完成出行/);
  assert.match(manual,/汽车驶出速度只由门口道路等级决定/);
});
test('health, HEAD and conditional caching work', async t => {
  const port=await setup(t);
  assert.deepEqual(JSON.parse((await request(port,'/healthz')).body),{status:'ok'});
  const get=await request(port,'/core.js'),head=await request(port,'/core.js','HEAD');
  assert.equal(head.body,'');assert.equal(head.headers['content-length'],get.headers['content-length']);
  const cached=await request(port,'/core.js','GET',{'If-None-Match':get.headers.etag});
  assert.equal(cached.status,304);assert.equal(cached.body,'');
});
test('rejects writes, malformed paths, traversal and private project files', async t => {
  const port=await setup(t);
  for(const url of ['/levels.js','/server.js','/README.md','/tests/core.test.js','/.git/config','/deploy/','/../README.md','/%2e%2e/%2e%2e/etc/passwd','/index.html/extra','//etc/passwd']) {
    assert.equal((await request(port,url)).status,404,url);
  }
  assert.equal((await request(port,'/%ZZ')).status,400);
  const post=await request(port,'/','POST');assert.equal(post.status,405);assert.equal(post.headers.allow,'GET, HEAD');
});
test('parallel visitors receive independent static pages without sessions', async t => {
  const port=await setup(t);
  const responses=await Promise.all(Array.from({length:30},()=>request(port,'/')));
  for(const res of responses) {assert.equal(res.status,200);assert.equal(res.body,responses[0].body);assert.equal(res.headers['set-cookie'],undefined);}
});
