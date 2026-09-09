'use strict';
// Administrator panel server. Password-protected; binds to all interfaces by
// default (override with ADMIN_HOST) and reads/writes levels.json.
// Serves the admin UI and reads/writes levels.json, the player-visible level set.
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { WIDTH, HEIGHT, MIN_MAP_SIZE, MAX_MAP_SIZE, neighbors, ROAD_TYPES, setLevels } = require('./core.js');

const HOST = process.env.ADMIN_HOST || '::';
const PORT = Number(process.env.ADMIN_PORT || process.env.PORT || 8080);
const LEVELS_PATH = path.join(__dirname, 'levels.json');
const BUILT_IN_LEVELS_PATH = path.join(__dirname, 'built-in-levels.json');
// Listening beyond loopback exposes this panel to the network. The admin
// password (and a future TLS layer) is then the only barrier; keep it strong.
const isLoopback = host => host === '127.0.0.1' || host === 'localhost' || host === '::1';
// Refuse to start without an explicitly configured password. The panel binds to
// all interfaces by default, so a built-in credential would make it unsafe.
function getPassword() { return process.env.ADMIN_PASSWORD || process.env.PI_ADMIN_PASSWORD || ''; }
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

const ADMIN_FILES = {
  '/core.js': 'text/javascript; charset=utf-8',
  '/admin.html': 'text/html; charset=utf-8',
  '/admin-manual.html': 'text/html; charset=utf-8',
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

// ── levels.json storage ─────────────────────────────────────────────────────
function normalizeCatalog(data) {
  if (!Array.isArray(data)) return data;
  if (data.length === 8 || data.length === 9 || data.length === 10) { const split = data.length - 4; return { version: 1, chapters: [
    { id: 'road-basics', name: '道路入门', english: 'ROAD BASICS', levels: data.slice(0,split) },
    { id: 'city-control', name: '城市调度', english: 'CITY CONTROL', levels: data.slice(split) }
  ] }; }
  return { version: 1, chapters: [{ id: 'custom-levels', name: '自定义关卡', english: 'CUSTOM LEVELS', levels: data }] };
}
function defaultLevels() {
  return normalizeCatalog(JSON.parse(fs.readFileSync(BUILT_IN_LEVELS_PATH, 'utf8')));
}
function readLevels() {
  try { return normalizeCatalog(JSON.parse(fs.readFileSync(LEVELS_PATH, 'utf8'))); }
  catch (error) { if (error.code === 'ENOENT') return defaultLevels(); throw error; }
}
async function writeLevels(catalog) {
  const payload = JSON.stringify(catalog, null, 2) + '\n';
  const tmp = LEVELS_PATH + '.tmp-' + process.pid;
  await fsp.writeFile(tmp, payload, 'utf8');
  await fsp.rename(tmp, LEVELS_PATH);
}

// ── Named presets & default override ─────────────────────────────────────
const PRESETS_DIR = path.join(__dirname, 'level-presets');
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
  const payload = JSON.stringify(catalog, null, 2) + '\n';
  const tmp = BUILT_IN_LEVELS_PATH + '.tmp-' + process.pid;
  await fsp.writeFile(tmp, payload, 'utf8');
  await fsp.rename(tmp, BUILT_IN_LEVELS_PATH);
}

// ── Validation ──────────────────────────────────────────────────────────────
function isCoord(n, width = WIDTH, height = HEIGHT) { return Number.isInteger(n) && n >= 0 && n < width * height; }
function validateLevels(data) {
  const catalog = normalizeCatalog(data);
  if (!catalog || catalog.version !== 1 || !Array.isArray(catalog.chapters) || !catalog.chapters.length) return '章节数据必须包含非空 chapters 数组';
  const chapterIds = new Set();
  for (const chapter of catalog.chapters) {
    if (!chapter || typeof chapter.id !== 'string' || !/^[a-z0-9-]+$/.test(chapter.id)) return '章节 id 只能包含小写字母、数字和连字符';
    if (chapterIds.has(chapter.id)) return `章节 id 重复：${chapter.id}`;
    chapterIds.add(chapter.id);
    if (typeof chapter.name !== 'string' || !chapter.name.trim()) return `章节「${chapter.id}」缺少名称`;
    if (typeof chapter.english !== 'string' || !chapter.english.trim()) return `章节「${chapter.id}」缺少英文名`;
    if (!Array.isArray(chapter.levels)) return `章节「${chapter.id}」的 levels 必须是数组`;
  }
  const list = catalog.chapters.flatMap(chapter => chapter.levels);
  if (!list.length) return '至少需要一个关卡';
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
    // map and scalar parameters. Missing dimensions retain legacy 16 × 12 behavior.
    const width = level.width ?? WIDTH, height = level.height ?? HEIGHT;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < MIN_MAP_SIZE || width > MAX_MAP_SIZE || height < MIN_MAP_SIZE || height > MAX_MAP_SIZE) return `关卡「${level.id}」的地图宽高必须是 ${MIN_MAP_SIZE} 至 ${MAX_MAP_SIZE} 的整数`;
    if (!Number.isInteger(level.budget) || level.budget < 1) return `关卡「${level.id}」的预算无效`;
    if (!Number.isFinite(level.duration) || level.duration < 1) return `关卡「${level.id}」的时长无效`;
    if (!Number.isInteger(level.target) || level.target < 1) return `关卡「${level.id}」的目标无效`;
    // features
    const features = level.features || {};
    for (const name of ['grade', 'load', 'cut', 'inspect', 'signals']) {
      if (typeof features[name] !== 'boolean') return `关卡「${level.id}」的 features.${name} 必须是布尔值`;
    }
    if (features.bus !== undefined && typeof features.bus !== 'boolean') return `关卡「${level.id}」的 features.bus 必须是布尔值`;
    if (level.busLineLimit !== undefined && (!Number.isInteger(level.busLineLimit) || level.busLineLimit < 1 || level.busLineLimit > 6)) return `关卡「${level.id}」的 busLineLimit 必须是 1 至 6 的整数`;
    // terrain sets
    for (const field of ['water', 'bridges', 'trees']) {
      if (!Array.isArray(level[field])) return `关卡「${level.id}」的 ${field} 必须是数组`;
      const set = new Set();
      for (const n of level[field]) {
        if (!isCoord(n, width, height)) return `关卡「${level.id}」的 ${field} 包含越界坐标 ${n}`;
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
      if (typeof route.name !== 'string' || !route.name.trim()) return `关卡「${level.id}」的路线缺少 name`;
      if (typeof route.color !== 'string' || typeof route.light !== 'string') return `关卡「${level.id}」的路线缺少 color/light`;
      if (!Array.isArray(route.homes) || route.homes.length === 0) return `关卡「${level.id}」的路线至少需要一个住宅 (homes)`;
      if (!Array.isArray(route.goals) || route.goals.length === 0) return `关卡「${level.id}」的路线至少需要一个目的地 (goals)`;
      for (const h of route.homes) {
        if (!h || typeof h !== 'object' || !isCoord(h.cell, width, height)) return `关卡「${level.id}」的路线 homes 坐标越界`;
        const generationRate = h.generationRate ?? h.rate;
        if (!Number.isFinite(generationRate) || generationRate <= 0) return `关卡「${level.id}」的路线 homes.generationRate 无效`;
        if (!Number.isInteger(h.passengers) || h.passengers <= 0) return `关卡「${level.id}」的路线 homes.passengers 无效`;
      }
      for (const g of route.goals) {
        if (!g || typeof g !== 'object' || !isCoord(g.cell, width, height)) return `关卡「${level.id}」的路线 goals 坐标越界`;
        if (typeof g.label !== 'string' || !g.label.trim()) return `关卡「${level.id}」的路线 goals.label 无效`;
        if (g.input != null && (!Number.isInteger(g.input) || g.input <= 0)) return `关卡「${level.id}」的路线 goals.input 无效`;
      }
      if (route.homes.some(h => route.goals.some(g => h.cell === g.cell))) return `关卡「${level.id}」的路线住宅与目的地位于同一格`;
      const homeCells = route.homes.map(h => h.cell);
      const goalCells = route.goals.map(g => g.cell);
      if (new Set(homeCells).size !== homeCells.length) return `关卡「${level.id}」的路线存在重叠的住宅`;
      if (new Set(goalCells).size !== goalCells.length) return `关卡「${level.id}」的路线存在重叠的目的地`;
    }
    // Buildings of different routes must not share a cell (a cell hosts one building).
    const buildingRoute = new Map();
    for (let ri = 0; ri < level.routes.length; ri++) {
      for (const h of level.routes[ri].homes) {
        if (buildingRoute.has(h.cell)) return `关卡「${level.id}」的住宅 ${h.cell} 与其他路线建筑重叠`;
        buildingRoute.set(h.cell, ri);
      }
      for (const g of level.routes[ri].goals) {
        if (buildingRoute.has(g.cell)) return `关卡「${level.id}」的目的地 ${g.cell} 与其他路线建筑重叠`;
        buildingRoute.set(g.cell, ri);
      }
    }
    const deliverable = level.routes.reduce((sum, route) => {
      const passengers = route.homes.reduce((total, home) => total + home.passengers, 0);
      const capacity = route.goals.some(goal => goal.input == null) ? Infinity : route.goals.reduce((total, goal) => total + goal.input, 0);
      return sum + Math.min(passengers, capacity);
    }, 0);
    if (level.target > deliverable) return `关卡「${level.id}」的目标 ${level.target} 超过最多可送达人数 ${deliverable}`;
    // homes/goals must not sit on water or trees
    const forbidden = new Set([...level.water, ...level.trees]);
    for (const route of level.routes) {
      for (const h of route.homes) if (forbidden.has(h.cell)) return `关卡「${level.id}」的住宅 ${h.cell} 位于水面或树木上`;
      for (const g of route.goals) if (forbidden.has(g.cell)) return `关卡「${level.id}」的目的地 ${g.cell} 位于水面或树木上`;
    }
    // initialEdges
    if (level.initialEdges !== undefined && level.initialEdges !== null) {
      if (!Array.isArray(level.initialEdges)) return `关卡「${level.id}」的 initialEdges 必须是数组`;
      const seen = new Set(), roadGrades = new Map();
      for (const edge of level.initialEdges) {
        if (!Array.isArray(edge) || edge.length !== 3) return `关卡「${level.id}」的 initialEdges 每项须为 [a,b,grade]`;
        const [a, b, grade] = edge;
        if (!isCoord(a, width, height) || !isCoord(b, width, height) || !neighbors(a, width, height).includes(b)) return `关卡「${level.id}」的 initialEdges 包含非相邻连接`;
        if (!Number.isInteger(grade) || !ROAD_TYPES[grade]) return `关卡「${level.id}」的 initialEdges 道路等级无效`;
        const id = `${Math.min(a, b)}:${Math.max(a, b)}`;
        if (seen.has(id)) return `关卡「${level.id}」的 initialEdges 包含重复连接`;
        if (buildingRoute.has(a) && buildingRoute.has(b)) return `关卡「${level.id}」的 initialEdges 不能直接连接两座建筑`;
        for (const cell of [a,b]) if (!buildingRoute.has(cell)) {
          if (level.trees.includes(cell) || level.water.includes(cell) && !level.bridges.includes(cell)) return `关卡「${level.id}」的初始道路 ${cell} 位于不可建设地形`;
          // Initial edges are applied in order; later edges may repaint a shared
          // road cell, matching City.connect() during level construction.
          roadGrades.set(cell, grade);
        }
        seen.add(id);
      }
      const initialCost = [...roadGrades].reduce((sum, [,grade]) => sum + ROAD_TYPES[grade].cost, 0);
      if (initialCost > level.budget) return `关卡「${level.id}」的初始道路需要 ${initialCost} 点，超过预算 ${level.budget}`;
    }
    if (level.campaign !== undefined) {
      if (!level.campaign || !Array.isArray(level.campaign.days) || level.campaign.days.length !== 5) return `关卡「${level.id}」的多日任务必须正好包含 5 天`;
      for (let dayIndex = 0; dayIndex < level.campaign.days.length; dayIndex++) {
        const day = level.campaign.days[dayIndex];
        if (!day || !Number.isFinite(day.duration) || day.duration < 1) return `关卡「${level.id}」第 ${dayIndex + 1} 天的时长无效`;
        if (!Number.isInteger(day.target) || day.target < 1) return `关卡「${level.id}」第 ${dayIndex + 1} 天的目标无效`;
        if (!Number.isInteger(day.maxIncome) || day.maxIncome < 0) return `关卡「${level.id}」第 ${dayIndex + 1} 天的最高收入无效`;
        const dayLevel = { ...level, duration: day.duration, target: day.target, routes: day.routes };
        delete dayLevel.campaign;
        const dayError = validateLevels({ version: 1, chapters: [{ id: 'campaign-check', name: '多日任务校验', english: 'CAMPAIGN CHECK', levels: [dayLevel] }] });
        if (dayError) return `关卡「${level.id}」第 ${dayIndex + 1} 天：${dayError}`;
      }
      const firstDay = level.campaign.days[0];
      if (level.duration !== firstDay.duration || level.target !== firstDay.target || JSON.stringify(level.routes) !== JSON.stringify(firstDay.routes)) return `关卡「${level.id}」的基础路线、时长和目标必须与第 1 天一致`;
      const firstCells = new Set(firstDay.routes.flatMap(route => [...route.homes, ...route.goals].map(building => building.cell)));
      const futureCells = new Set(level.campaign.days.slice(1).flatMap(day => day.routes).flatMap(route => [...route.homes, ...route.goals].map(building => building.cell)).filter(cell => !firstCells.has(cell)));
      for (const edge of level.initialEdges || []) if (futureCells.has(edge[0]) || futureCells.has(edge[1])) return `关卡「${level.id}」的初始道路占用了未来建筑工地`;
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

async function handleApi(req, res, pathname, adminPassword) {
  pruneSessions();
  if (pathname === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      let password = '';
      try { password = JSON.parse(body || '{}').password || ''; } catch { /* ignore */ }
      if (!timingSafeEqual(password, adminPassword)) return send(res, 401, { error: '密码错误' });
      const token = issueSession();
      send(res, 200, { ok: true }, {
        'Set-Cookie': `traffic_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`
      });
    });
    return true;
  }
  if (pathname === '/api/logout' && req.method === 'POST') {
    sessions.delete(sessionToken(req));
    send(res, 200, { ok: true }, { 'Set-Cookie': 'traffic_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    return true;
  }
  if (!authenticated(req)) { send(res, 401, { error: '未登录' }); return true; }

  if (pathname === '/api/levels' && req.method === 'GET') {
    send(res, 200, { catalog: readLevels(), hasOverride: fs.existsSync(LEVELS_PATH) });
    return true;
  }
  if (pathname === '/api/validate' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      let catalog;
      try { catalog = normalizeCatalog(JSON.parse(body || '{}')); } catch { return send(res, 400, { error: '请求体不是合法 JSON' }); }
      const error = validateLevels(catalog);
      if(error)return send(res,400,{error});
      send(res, 200, { ok: true });
    });
    return true;
  }
  if (pathname === '/api/levels' && req.method === 'PUT') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1024 * 1024) req.destroy(); });
    req.on('end', async () => {
      let catalog;
      try { catalog = normalizeCatalog(JSON.parse(body || '{}')); } catch { return send(res, 400, { error: '请求体不是合法 JSON' }); }
      const error = validateLevels(catalog) || setLevels(catalog);
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
      const error = validateLevels(catalog);
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
      const error = validateLevels(catalog);
      if (error) return send(res, 400, { error });
      try { await writeDefault(catalog); send(res, 200, { ok: true }); }
      catch (writeError) { send(res, 500, { error: '写入失败：' + writeError.message }); }
    });
    return true;
  }
  return false;
}

async function createAdminServer({ port = PORT, host = HOST } = {}) {
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
      try { if (await handleApi(req, res, pathname, adminPassword)) return; }
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
module.exports = { validateLevels, normalizeCatalog, readLevels, writeLevels, defaultLevels, createAdminServer };
