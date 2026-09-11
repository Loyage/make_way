'use strict';
// Administrator panel server. Password-protected; binds to loopback by default
// (set ADMIN_HOST explicitly for remote access). Persists a path-only levels.json manifest
// plus one JSON file per level below levels.local/.
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const TrafficCore = require('../shared/core.js');
const { setLevels, verifyCampaignReferenceChain } = TrafficCore;
const { normalizeCatalog, loadCatalogSync, writeCatalog } = require('../shared/level-catalog.js');
const { validateLevels, validateLevelCatalog } = require('../shared/level-validation.js');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const ADMIN_ROOT = path.join(PROJECT_ROOT, 'src/admin');
const SHARED_ROOT = path.join(PROJECT_ROOT, 'src/shared');
const HOST = process.env.ADMIN_HOST || '127.0.0.1';
const PORT = Number(process.env.ADMIN_PORT || process.env.PORT || 8080);
const LEVELS_PATH = path.join(PROJECT_ROOT, 'levels.json');
const LEVELS_DATA_DIR = path.join(PROJECT_ROOT, 'levels.local');
const BUILT_IN_LEVELS_PATH = path.join(PROJECT_ROOT, 'built-in-levels.json');
const BUILT_IN_LEVELS_DIR = path.join(PROJECT_ROOT, 'levels');
// Listening beyond loopback exposes this panel to the network. Keep the
// password strong and terminate HTTPS in a trusted reverse proxy.
const isLoopback = host => host === '127.0.0.1' || host === 'localhost' || host === '::1';
function getPassword() { return process.env.ADMIN_PASSWORD || process.env.PI_ADMIN_PASSWORD || ''; }
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const LOGIN_WINDOW_MS = 60 * 1000;
const LOGIN_BLOCK_MS = 5 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 5;
const execFileAsync = promisify(execFile);

const asset = (root, filename, type) => ({ filename: path.join(root, filename), type });
const GAME_ROOT = path.join(PROJECT_ROOT, 'src/game');
const ADMIN_FILES = {
  '/level-catalog.js': asset(SHARED_ROOT, 'level-catalog.js', 'text/javascript; charset=utf-8'),
  '/core-geometry.js': asset(SHARED_ROOT, 'core-geometry.js', 'text/javascript; charset=utf-8'),
  '/core-bus.js': asset(SHARED_ROOT, 'core-bus.js', 'text/javascript; charset=utf-8'),
  '/core.js': asset(SHARED_ROOT, 'core.js', 'text/javascript; charset=utf-8'),
  '/core-campaign.js': asset(SHARED_ROOT, 'core-campaign.js', 'text/javascript; charset=utf-8'),
  '/level-validation.js': asset(SHARED_ROOT, 'level-validation.js', 'text/javascript; charset=utf-8'),
  '/manual.html': asset(GAME_ROOT, 'manual.html', 'text/html; charset=utf-8'),
  '/style.css': asset(GAME_ROOT, 'style.css', 'text/css; charset=utf-8'),
  '/game-results.js': asset(GAME_ROOT, 'game-results.js', 'text/javascript; charset=utf-8'),
  '/game-effects.js': asset(GAME_ROOT, 'game-effects.js', 'text/javascript; charset=utf-8'),
  '/game-canvas.js': asset(GAME_ROOT, 'game-canvas.js', 'text/javascript; charset=utf-8'),
  '/game-bootstrap.js': asset(GAME_ROOT, 'game-bootstrap.js', 'text/javascript; charset=utf-8'),
  '/game.js': asset(GAME_ROOT, 'game.js', 'text/javascript; charset=utf-8'),
  '/admin-manual.html': asset(ADMIN_ROOT, 'admin-manual.html', 'text/html; charset=utf-8'),
  '/admin.css': asset(ADMIN_ROOT, 'admin.css', 'text/css; charset=utf-8'),
  '/admin.js': asset(ADMIN_ROOT, 'admin.js', 'text/javascript; charset=utf-8')
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
const loginAttempts = new Map(); // source -> { failures, windowStarted, blockedUntil }
function pruneSessions() {
  const now = Date.now();
  for (const [token, session] of sessions) if (session.expires <= now) sessions.delete(token);
}
function issueSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { expires: Date.now() + SESSION_TTL_MS });
  return token;
}
function sessionToken(req) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === 'traffic_admin') return value || '';
  }
  return '';
}
function authenticated(req) {
  const session = sessions.get(sessionToken(req));
  return Boolean(session && session.expires > Date.now());
}
function timingSafeEqual(a, b) {
  const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
function loginSource(req) { return req.socket.remoteAddress || 'unknown'; }
function loginBlock(source, now = Date.now()) {
  const attempt = loginAttempts.get(source);
  if (!attempt || attempt.blockedUntil <= now) return 0;
  return attempt.blockedUntil - now;
}
function recordLoginFailure(source, now = Date.now()) {
  let attempt = loginAttempts.get(source);
  if (!attempt || now - attempt.windowStarted >= LOGIN_WINDOW_MS) attempt = { failures: 0, windowStarted: now, blockedUntil: 0 };
  attempt.failures++;
  if (attempt.failures >= LOGIN_FAILURE_LIMIT) attempt.blockedUntil = now + LOGIN_BLOCK_MS;
  loginAttempts.set(source, attempt);
  return loginBlock(source, now);
}
function clearLoginFailures(source) { loginAttempts.delete(source); }
function pruneLoginAttempts(now = Date.now()) {
  for (const [source, attempt] of loginAttempts) if (attempt.blockedUntil <= now && now - attempt.windowStarted >= LOGIN_WINDOW_MS) loginAttempts.delete(source);
}
function sessionCookie(token, secureCookie, maxAge = SESSION_TTL_MS / 1000) {
  return `traffic_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secureCookie ? '; Secure' : ''}`;
}

// ── Split level-catalog storage ─────────────────────────────────────────────
function defaultLevels() {
  return normalizeCatalog(loadCatalogSync(BUILT_IN_LEVELS_PATH));
}
function readLevels() {
  try { return normalizeCatalog(loadCatalogSync(LEVELS_PATH)); }
  catch (error) { if (error.code === 'ENOENT') return defaultLevels(); throw error; }
}
async function writeLevels(catalog) {
  await writeCatalog(catalog, LEVELS_PATH, LEVELS_DATA_DIR);
}

// ── Named presets & default override ─────────────────────────────────────
const PRESETS_DIR = path.join(PROJECT_ROOT, 'level-presets');
function safePresetName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9_\-\u4e00-\u9fa5]{1,40}$/.test(name) && name !== '.' && name !== '..';
}
function presetPath(name) { return path.join(PRESETS_DIR, name + '.json'); }
async function listPresets() {
  try {
    const entries = await fsp.readdir(PRESETS_DIR);
    return entries.filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)).sort();
  } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
async function readPreset(name) {
  if (!safePresetName(name)) throw new Error('配置文件名只能包含字母、数字、下划线、连字符或中文');
  try { return normalizeCatalog(JSON.parse(await fsp.readFile(presetPath(name), 'utf8'))); }
  catch (error) { if (error.code === 'ENOENT') throw new Error(`配置「${name}」不存在`); throw error; }
}
async function writePreset(name, catalog) {
  if (!safePresetName(name)) throw new Error('配置文件名只能包含字母、数字、下划线、连字符或中文');
  await fsp.mkdir(PRESETS_DIR, { recursive: true });
  const file = presetPath(name);
  let exists = false;
  try { await fsp.access(file); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (exists) throw new Error(`配置「${name}」已存在，请换一个文件名`);
  const payload = JSON.stringify(catalog, null, 2) + '\n';
  await fsp.writeFile(file, payload, 'utf8');
}
async function writeDefault(catalog) {
  await writeCatalog(catalog, BUILT_IN_LEVELS_PATH, BUILT_IN_LEVELS_DIR);
}
function validateReferenceChains(catalog) {
  const setup=setLevels(catalog);if(setup)return setup;
  for(const level of catalog.chapters.flatMap(chapter=>chapter.levels)){
    if(!level.campaign?.days?.some(day=>day.referenceDesign))continue;
    const result=verifyCampaignReferenceChain(level.id);
    if(!result.ok)return `关卡「${level.id}」的参考答案链在第 ${result.day} 天失败：${result.error}`;
  }
  return '';
}

async function restartGameService() {
  const systemctl = process.env.SYSTEMCTL_PATH || 'systemctl';
  const options = { timeout: 15000, maxBuffer: 64 * 1024, windowsHide: true };
  await execFileAsync(systemctl, ['--user', 'restart', 'traffic-game.service'], options);
  const { stdout } = await execFileAsync(systemctl, ['--user', 'is-active', 'traffic-game.service'], options);
  const state = stdout.trim();
  if (state !== 'active') throw new Error(`traffic-game.service 当前状态为 ${state || '未知'}`);
  return { service: 'traffic-game.service', state };
}

// ── Validation ──────────────────────────────────────────────────────────────
// ── HTTP server ─────────────────────────────────────────────────────────────
async function loadAssets() {
  const assets = new Map();
  for (const [url, descriptor] of Object.entries(ADMIN_FILES)) {
    assets.set(url, { body: await fsp.readFile(descriptor.filename), type: descriptor.type });
  }
  const gamePage=await fsp.readFile(path.join(GAME_ROOT,'index.html'),'utf8');
  const panel=await fsp.readFile(path.join(ADMIN_ROOT,'admin-panel.html'),'utf8');
  const adminPage=gamePage
    .replace('<title>慢行小城 · Make Way · 交通规划小游戏</title>','<title>慢行小城 · Make Way · 管理员城市控制台</title>')
    .replace('<link rel="stylesheet" href="style.css">','<link rel="stylesheet" href="style.css"><link rel="stylesheet" href="admin.css">')
    .replace('<body class="game-page">','<body class="game-page admin-page">')
    .replace('</aside>\n      </div>\n      <section id="accessible-map"',`</aside>\n${panel}\n      </div>\n      <section id="accessible-map"`)
    .replace('<script src="game.js"></script>','<script src="admin.js"></script><script src="game.js"></script>');
  if(!adminPage.includes('id="admin-inspector"'))throw new Error('Unable to compose unified administrator page');
  assets.set('/admin.html',{body:Buffer.from(adminPage),type:'text/html; charset=utf-8'});
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

async function handleApi(req, res, pathname, adminPassword, secureCookie, restartService) {
  pruneSessions();
  pruneLoginAttempts();
  if (pathname === '/api/login' && req.method === 'POST') {
    const source = loginSource(req), blockedFor = loginBlock(source);
    if (blockedFor) {
      send(res, 429, { error: '登录失败次数过多，请稍后再试' }, { 'Retry-After': Math.ceil(blockedFor / 1000) });
      return true;
    }
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      let password = '';
      try { password = JSON.parse(body || '{}').password || ''; } catch { /* ignore */ }
      if (!timingSafeEqual(password, adminPassword)) {
        const blocked = recordLoginFailure(source);
        return send(res, blocked ? 429 : 401, { error: blocked ? '登录失败次数过多，请稍后再试' : '密码错误' }, blocked ? { 'Retry-After': Math.ceil(blocked / 1000) } : {});
      }
      clearLoginFailures(source);
      const token = issueSession();
      send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(token, secureCookie) });
    });
    return true;
  }
  if (pathname === '/api/logout' && req.method === 'POST') {
    sessions.delete(sessionToken(req));
    send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', secureCookie, 0) });
    return true;
  }
  if (!authenticated(req)) { send(res, 401, { error: '未登录' }); return true; }

  if (pathname === '/api/levels' && req.method === 'GET') {
    send(res, 200, { catalog: readLevels(), hasOverride: fs.existsSync(LEVELS_PATH) });
    return true;
  }
  if (pathname === '/api/game-service/restart' && req.method === 'POST') {
    try { send(res, 200, { ok: true, ...(await restartService()) }); }
    catch (error) { send(res, 500, { error: '游戏服务重启失败：' + error.message }); }
    return true;
  }
  if (pathname === '/api/validate' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      let catalog;
      try { catalog = normalizeCatalog(JSON.parse(body || '{}')); } catch { return send(res, 400, { error: '请求体不是合法 JSON' }); }
      const validation = validateLevelCatalog(catalog);
      if (!validation.ok) return send(res, 400, { error: validation.errors[0].message, errors: validation.errors });
      send(res, 200, validation);
    });
    return true;
  }
  if (pathname === '/api/levels' && req.method === 'PUT') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1024 * 1024) req.destroy(); });
    req.on('end', async () => {
      let catalog;
      try { catalog = normalizeCatalog(JSON.parse(body || '{}')); } catch { return send(res, 400, { error: '请求体不是合法 JSON' }); }
      const error = validateLevels(catalog) || validateReferenceChains(catalog);
      if (error) return send(res, 400, { error });
      try {
        await writeLevels(catalog);
        send(res, 200, { ok: true, chapters: catalog.chapters.length, count: catalog.chapters.reduce((sum,chapter)=>sum+chapter.levels.length,0) });
      } catch (writeError) {
        send(res, 500, { error: '写入失败：' + writeError.message });
      }
    });
    return true;
  }
  if (pathname === '/api/presets' && req.method === 'GET') {
    try { send(res, 200, { presets: await listPresets() }); }
    catch (error) { send(res, 500, { error: error.message }); }
    return true;
  }
  if (pathname.startsWith('/api/presets/') && req.method === 'GET') {
    try { send(res, 200, { catalog: await readPreset(pathname.slice('/api/presets/'.length)) }); }
    catch (error) { send(res, 404, { error: error.message }); }
    return true;
  }
  if (pathname.startsWith('/api/presets/') && req.method === 'PUT') {
    const name = pathname.slice('/api/presets/'.length);
    if (!safePresetName(name)) { send(res, 400, { error: '配置文件名只能包含字母、数字、下划线、连字符或中文' }); return true; }
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1024 * 1024) req.destroy(); });
    req.on('end', async () => {
      let catalog;
      try { catalog = normalizeCatalog(JSON.parse(body || '{}')); } catch { return send(res, 400, { error: '请求体不是合法 JSON' }); }
      const error = validateLevels(catalog) || validateReferenceChains(catalog);
      if (error) return send(res, 400, { error });
      try { await writePreset(name, catalog); send(res, 200, { ok: true, name }); }
      catch (writeError) { send(res, 409, { error: writeError.message }); }
    });
    return true;
  }
  if (pathname === '/api/default' && req.method === 'PUT') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1024 * 1024) req.destroy(); });
    req.on('end', async () => {
      let catalog;
      try { catalog = normalizeCatalog(JSON.parse(body || '{}')); } catch { return send(res, 400, { error: '请求体不是合法 JSON' }); }
      const error = validateLevels(catalog) || validateReferenceChains(catalog);
      if (error) return send(res, 400, { error });
      try { await writeDefault(catalog); send(res, 200, { ok: true }); }
      catch (writeError) { send(res, 500, { error: '写入失败：' + writeError.message }); }
    });
    return true;
  }
  return false;
}

async function createAdminServer({ port = PORT, host = HOST, secureCookie = process.env.ADMIN_SECURE_COOKIE === '1', restartService = restartGameService } = {}) {
  if (!/^\d+$/.test(String(port)) || port < 0 || port > 65535) throw new Error('ADMIN_PORT/PORT must be an integer between 0 and 65535');
  const adminPassword = getPassword();
  if (!adminPassword) throw new Error('ADMIN_PASSWORD or PI_ADMIN_PASSWORD must be set');
  if (!isLoopback(host)) console.warn('ADMIN_HOST is not a loopback address: the admin panel is reachable from the network and is only protected by the password.');
  const assets = await loadAssets();
  const server = http.createServer({ maxHeaderSize: 8192 }, async (req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(req.url.split('?')[0]); }
    catch { return send(res, 400, { error: 'Bad request' }); }
    if (pathname.startsWith('/api/')) {
      try { if (await handleApi(req, res, pathname, adminPassword, secureCookie, restartService)) return; }
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
module.exports = { validateLevels, validateReferenceChains, normalizeCatalog, readLevels, writeLevels, defaultLevels, restartGameService, createAdminServer, main };
