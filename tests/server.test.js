'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createGameServer } = require('../server.js');

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
  for(const [url,type] of [['/','text/html'],['/index.html','text/html'],['/style.css','text/css'],['/levels.js','text/javascript'],['/core.js','text/javascript'],['/game-results.js','text/javascript'],['/game-effects.js','text/javascript'],['/game.js?v=2','text/javascript']]) {
    const res=await request(port,url);assert.equal(res.status,200);assert.ok(res.headers['content-type'].startsWith(type));
    assert.equal(res.headers['x-content-type-options'],'nosniff');assert.ok(res.headers['content-security-policy']);assert.ok(res.body.length>100);
  }
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
  for(const url of ['/server.js','/README.md','/tests/core.test.js','/.git/config','/deploy/','/../README.md','/%2e%2e/%2e%2e/etc/passwd','/index.html/extra','//etc/passwd']) {
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
