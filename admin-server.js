'use strict';
// Administrator panel server. Password-protected; binds to all interfaces by
// default (override with ADMIN_HOST) and reads/writes levels.json.
// Serves the admin UI and reads/writes levels.json, the player-visible level set.
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { WIDTH, HEIGHT, key, neighbors, ROAD_TYPES, setLevels } = require('./core.js');

const HOST = process.env.ADMIN_HOST || '::';
const PORT = Number(process.env.ADMIN_PORT || process.env.PORT || 8080);
const LEVELS_PATH = path.join(__dirname, 'levels.json');
// Listening beyond loopback exposes this panel to the network. The admin
// password (and a future TLS layer) is then the only barrier; keep it strong.
const isLoopback = host => host === '127.0.0.1' || host === 'localhost' || host === '::1';
if (!isLoopback(HOST)) {
  console.warn('ADMIN_HOST is not a loopback address: the admin panel is reachable from the network and is only protected by the password.');
}
// Simple password gate. Prefer ADMIN_PASSWORD (or a .env) over the built-in default.
function getPassword() { return process.env.ADMIN_PASSWORD || process.env.PI_ADMIN_PASSWORD || 'admin'; }
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

const ADMIN_FILES = {
  '/admin.html': 'text/html; charset=utf-8',
  '/admin.css': 'text/css; charset=utf-8',
  '/admin.js': 'text/javascript; charset=utf-8'
};
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

// ── Minimal session store (single user, single device) ──────────────────────
const sessions = new Map(); // token -> { expires }
function pruneSessions() {
  const now = Date.now();
  for (const [token, session] of sessions) if (session.expires <= now) sessions.delete(token);
}
function issueSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { expires: Date.now() + SESSION_TTL_MS });
  return token;
}
function authenticated(req) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === 'traffic_admin') {
      const session = sessions.get(value);
      if (session && session.expires > Date.now()) return true;
    }
  }
  return false;
}
function timingSafeEqual(a, b) {
  const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// ── levels.json storage ─────────────────────────────────────────────────────
function defaultLevels() {
  return JSON.parse(JSON.stringify(require('./levels.js')));
}
function readLevels() {
  try { return JSON.parse(fs.readFileSync(LEVELS_PATH, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return defaultLevels(); throw error; }
}
async function writeLevels(levels) {
  const payload = JSON.stringify(levels, null, 2) + '\n';
  const tmp = LEVELS_PATH + '.tmp-' + process.pid;
  await fsp.writeFile(tmp, payload, 'utf8');
  await fsp.rename(tmp, LEVELS_PATH);
}

// ── Validation ──────────────────────────────────────────────────────────────
function isCoord(n) { return Number.isInteger(n) && n >= 0 && n < WIDTH * HEIGHT; }
function validateLevels(list) {
  if (!Array.isArray(list) || list.length === 0) return '关卡数据必须是非空数组';
  const ids = new Set();
  for (const level of list) {
    if (!level || typeof level !== 'object') return '每个关卡都必须是对象';
    // id / names
    if (typeof level.id !== 'string' || !/^[a-z0-9-]+$/.test(level.id)) return '关卡 id 只能包含小写字母、数字和连字符';
    if (ids.has(level.id)) return `关卡 id 重复：${level.id}`;
    ids.add(level.id);
    for (const field of ['name', 'english', 'difficulty', 'title', 'description', 'tip', 'lesson']) {
      if (typeof level[field] !== 'string' || !level[field].trim()) return `关卡「${level.id}」缺少 ${field}`;
    }
    // scalar parameters
    if (!Number.isFinite(level.budget) || level.budget < 1) return `关卡「${level.id}」的预算无效`;
    if (!Number.isFinite(level.duration) || level.duration < 1) return `关卡「${level.id}」的时长无效`;
    if (!Number.isFinite(level.target) || level.target < 1) return `关卡「${level.id}」的目标无效`;
    // features
    const features = level.features || {};
    for (const name of ['grade', 'load', 'cut', 'inspect', 'signals']) {
      if (typeof features[name] !== 'boolean') return `关卡「${level.id}」的 features.${name} 必须是布尔值`;
    }
    // terrain sets
    for (const field of ['water', 'bridges', 'trees']) {
      if (!Array.isArray(level[field])) return `关卡「${level.id}」的 ${field} 必须是数组`;
      const set = new Set();
      for (const n of level[field]) {
        if (!isCoord(n)) return `关卡「${level.id}」的 ${field} 包含越界坐标 ${n}`;
        if (set.has(n)) return `关卡「${level.id}」的 ${field} 包含重复坐标 ${n}`;
        set.add(n);
      }
    }
    for (const n of level.bridges) if (!level.water.includes(n)) return `关卡「${level.id}」的桥梁 ${n} 必须位于水面上`;
    for (const n of level.trees) if (level.water.includes(n)) return `关卡「${level.id}」的树木与水体重叠于 ${n}`;
    // routes
    if (!Array.isArray(level.routes) || level.routes.length === 0) return `关卡「${level.id}」至少需要一条路线`;
    for (const route of level.routes) {
      if (!route || typeof route !== 'object') return `关卡「${level.id}」的路线必须是对象`;
      if (!isCoord(route.home) || !isCoord(route.goal)) return `关卡「${level.id}」的路线起终点坐标越界`;
      if (route.home === route.goal) return `关卡「${level.id}」的路线上 home 与 goal 相同`;
      if (!Number.isFinite(route.rate) || route.rate <= 0) return `关卡「${level.id}」的路线 rate 无效`;
      if (!Number.isFinite(route.passengers) || route.passengers <= 0) return `关卡「${level.id}」的路线 passengers 无效`;
      if (typeof route.name !== 'string' || typeof route.label !== 'string') return `关卡「${level.id}」的路线缺少 name/label`;
    }
    // home/goal must not sit on water or trees
    const forbidden = new Set([...level.water, ...level.trees]);
    for (const route of level.routes) {
      if (forbidden.has(route.home)) return `关卡「${level.id}」的住宅 ${route.home} 位于水面或树木上`;
      if (forbidden.has(route.goal)) return `关卡「${level.id}」的目的地 ${route.goal} 位于水面或树木上`;
    }
    // initialEdges
    if (level.initialEdges !== undefined && level.initialEdges !== null) {
      if (!Array.isArray(level.initialEdges)) return `关卡「${level.id}」的 initialEdges 必须是数组`;
      const seen = new Set();
      for (const edge of level.initialEdges) {
        if (!Array.isArray(edge) || edge.length !== 3) return `关卡「${level.id}」的 initialEdges 每项须为 [a,b,grade]`;
        const [a, b, grade] = edge;
        if (!isCoord(a) || !isCoord(b) || !neighbors(a).includes(b)) return `关卡「${level.id}」的 initialEdges 包含非相邻连接`;
        if (!Number.isInteger(grade) || !ROAD_TYPES[grade]) return `关卡「${level.id}」的 initialEdges 道路等级无效`;
        const id = `${Math.min(a, b)}:${Math.max(a, b)}`;
        if (seen.has(id)) return `关卡「${level.id}」的 initialEdges 包含重复连接`;
        seen.add(id);
      }
    }
  }
  return '';
}

// ── HTTP server ─────────────────────────────────────────────────────────────
async function loadAssets() {
  const assets = new Map();
  for (const [url, type] of Object.entries(ADMIN_FILES)) {
    assets.set(url, { body: await fsp.readFile(path.join(__dirname, url.slice(1))), type });
  }
  return assets;
}

function send(res, status, body, headers = {}) {
  if (typeof body === 'object' && body !== null && !Buffer.isBuffer(body)) body = JSON.stringify(body);
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': data.length,
    ...headers
  });
  res.end(data);
}

async function handleApi(req, res, pathname) {
  pruneSessions();
  if (pathname === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      let password = '';
      try { password = JSON.parse(body || '{}').password || ''; } catch { /* ignore */ }
      if (!timingSafeEqual(password, getPassword())) return send(res, 401, { error: '密码错误' });
      const token = issueSession();
      send(res, 200, { ok: true }, {
        'Set-Cookie': `traffic_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`
      });
    });
    return true;
  }
  if (pathname === '/api/logout' && req.method === 'POST') {
    send(res, 200, { ok: true }, { 'Set-Cookie': 'traffic_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    return true;
  }
  if (!authenticated(req)) { send(res, 401, { error: '未登录' }); return true; }

  if (pathname === '/api/levels' && req.method === 'GET') {
    send(res, 200, { levels: readLevels(), hasOverride: fs.existsSync(LEVELS_PATH) });
    return true;
  }
  if (pathname === '/api/levels' && req.method === 'PUT') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1024 * 1024) req.destroy(); });
    req.on('end', async () => {
      let levels;
      try { levels = JSON.parse(body || '[]'); } catch { return send(res, 400, { error: '请求体不是合法 JSON' }); }
      const error = validateLevels(levels) || setLevels(levels);
      if (error) return send(res, 400, { error });
      try {
        await writeLevels(levels);
        send(res, 200, { ok: true, count: levels.length });
      } catch (writeError) {
        send(res, 500, { error: '写入失败：' + writeError.message });
      }
    });
    return true;
  }
  return false;
}

async function createAdminServer({ port = PORT, host = HOST } = {}) {
  if (!/^\d+$/.test(String(port)) || port < 0 || port > 65535) throw new Error('ADMIN_PORT/PORT must be an integer between 0 and 65535');
  const assets = await loadAssets();
  const server = http.createServer({ maxHeaderSize: 8192 }, async (req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(req.url.split('?')[0]); }
    catch { return send(res, 400, { error: 'Bad request' }); }
    if (pathname.startsWith('/api/')) {
      try { if (await handleApi(req, res, pathname)) return; }
      catch (error) { return send(res, 500, { error: error.message }); }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
    if (pathname === '/') pathname = '/admin.html';
    const asset = assets.get(pathname);
    if (!asset) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': asset.type,
      'Cache-Control': 'no-cache',
      'Content-Length': asset.body.length
    });
    res.end(req.method === 'HEAD' ? undefined : asset.body);
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.listen({ port, host, ipv6Only: false }, () => {
    console.log(`Admin panel listening on http://${host === '::' ? '[::] (IPv4 + IPv6)' : host}:${port} (password required)`);
  });
  return server;
}

function main() {
  return createAdminServer().then(server => {
    const shutdown = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 5000).unref(); };
    process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
  });
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { validateLevels, readLevels, writeLevels, defaultLevels, createAdminServer };
