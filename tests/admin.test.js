'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { validateLevels, defaultLevels, createAdminServer } = require('../admin-server.js');
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

test('validateLevels accepts the built-in levels', () => {
  assert.equal(validateLevels(defaultLevels()), '');
});

test('validateLevels rejects structural problems', () => {
  const good = defaultLevels();
  assert.notEqual(validateLevels([]), '');
  const dupId = JSON.parse(JSON.stringify(good)); dupId[1].id = dupId[0].id;
  assert.match(validateLevels(dupId), /重复/);
  const badCoord = JSON.parse(JSON.stringify(good)); badCoord[0].water.push(WIDTH * HEIGHT);
  assert.match(validateLevels(badCoord), /越界/);
  const badBridge = JSON.parse(JSON.stringify(good)); badBridge[0].bridges.push(0);
  assert.match(validateLevels(badBridge), /桥梁/);
  const noRoutes = JSON.parse(JSON.stringify(good)); noRoutes[0].routes = [];
  assert.match(validateLevels(noRoutes), /路线/);
  const badEdge = JSON.parse(JSON.stringify(good));
  badEdge[0].initialEdges = (badEdge[0].initialEdges || []).concat([[0, 0, 0]]);
  assert.match(validateLevels(badEdge), /initialEdges/);
});

test('setLevels rebuilds active LEVELS and freezes definitions', () => {
  setLevels(defaultLevels());
  const city = new City(defaultLevels()[0].id);
  assert.ok(city instanceof City);
  assert.match(setLevels([]), /非空数组/);
  assert.match(setLevels([{ id: 'x' }, { id: 'x' }]), /重复/);
  assert.throws(() => { require('../core.js').LEVELS[0].budget = 999; }, TypeError);
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
  const levels = JSON.parse(list.body).levels;
  assert.ok(levels.length >= 6);

  // Static assets are served.
  const page = await request(port, '/', 'GET', null, { Cookie: cookie.split(';')[0] });
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
});
