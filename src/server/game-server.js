'use strict';
// Public, read-only asset server. Never exposes the repository or home directory.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const GAME_ROOT = path.join(PROJECT_ROOT, 'src/game');
const SHARED_ROOT = path.join(PROJECT_ROOT, 'src/shared');
const asset = (root, filename, type) => ({ filename: path.join(root, filename), type });
const PUBLIC_FILES = {
  '/index.html': asset(GAME_ROOT, 'index.html', 'text/html; charset=utf-8'),
  '/manual.html': asset(GAME_ROOT, 'manual.html', 'text/html; charset=utf-8'),
  '/style.css': asset(GAME_ROOT, 'style.css', 'text/css; charset=utf-8'),
  '/built-in-levels.json': asset(PROJECT_ROOT, 'built-in-levels.json', 'application/json; charset=utf-8'),
  '/levels.json': asset(PROJECT_ROOT, 'levels.json', 'application/json; charset=utf-8'),
  '/level-catalog.js': asset(SHARED_ROOT, 'level-catalog.js', 'text/javascript; charset=utf-8'),
  '/core-geometry.js': asset(SHARED_ROOT, 'core-geometry.js', 'text/javascript; charset=utf-8'),
  '/core-bus.js': asset(SHARED_ROOT, 'core-bus.js', 'text/javascript; charset=utf-8'),
  '/core.js': asset(SHARED_ROOT, 'core.js', 'text/javascript; charset=utf-8'),
  '/core-campaign.js': asset(SHARED_ROOT, 'core-campaign.js', 'text/javascript; charset=utf-8'),
  '/level-validation.js': asset(SHARED_ROOT, 'level-validation.js', 'text/javascript; charset=utf-8'),
  '/game-results.js': asset(GAME_ROOT, 'game-results.js', 'text/javascript; charset=utf-8'),
  '/game-effects.js': asset(GAME_ROOT, 'game-effects.js', 'text/javascript; charset=utf-8'),
  '/game-canvas.js': asset(GAME_ROOT, 'game-canvas.js', 'text/javascript; charset=utf-8'),
  '/game-bootstrap.js': asset(GAME_ROOT, 'game-bootstrap.js', 'text/javascript; charset=utf-8'),
  '/game-storage.js': asset(GAME_ROOT, 'game-storage.js', 'text/javascript; charset=utf-8'),
  '/game-tutorial.js': asset(GAME_ROOT, 'game-tutorial.js', 'text/javascript; charset=utf-8'),
  '/game-navigation.js': asset(GAME_ROOT, 'game-navigation.js', 'text/javascript; charset=utf-8'),
  '/game.js': asset(GAME_ROOT, 'game.js', 'text/javascript; charset=utf-8')
};
const OPTIONAL_FILES = new Set(['/levels.json']);

async function discoverLevelFiles(directory, urlPrefix) {
  const files = {};
  async function visit(current, prefix) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name), url = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await visit(filename, url);
      else if (entry.isFile() && entry.name.endsWith('.json')) files[url] = asset(PROJECT_ROOT, path.relative(PROJECT_ROOT, filename), 'application/json; charset=utf-8');
    }
  }
  try { await visit(path.join(PROJECT_ROOT, directory), urlPrefix); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return files;
}
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

async function createGameServer() {
  // Snapshot only named assets and JSON files below the two level-data roots.
  const levelFiles = {
    ...await discoverLevelFiles('levels', '/levels'),
    ...await discoverLevelFiles('levels.local', '/levels.local')
  };
  const publicFiles = { ...PUBLIC_FILES, ...levelFiles };
  const assets = new Map(await Promise.all(Object.entries(publicFiles).map(async ([url, descriptor]) => {
    let body;
    try { body = await fs.readFile(descriptor.filename); }
    catch (error) { if (OPTIONAL_FILES.has(url) && error.code === 'ENOENT') return [url, null]; throw error; }
    const etag = '"' + createHash('sha256').update(body).digest('hex') + '"';
    return [url, { body, type: descriptor.type, etag }];
  })));
  const server = http.createServer({ maxHeaderSize: 8192 }, (req, res) => {
    const finish = (status, body, headers = {}) => {
      const data = Buffer.isBuffer(body) ? body : Buffer.from(body);
      res.writeHead(status, {
        ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store', 'Content-Length': data.length, ...headers
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    };
    // Do not buffer request bodies; this application has no write endpoints.
    req.resume();
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      finish(405, 'Method not allowed\n', { Allow: 'GET, HEAD' }); return;
    }
    let pathname;
    try { pathname = decodeURIComponent(req.url.split('?')[0]); }
    catch { finish(400, 'Bad request\n'); return; }
    if (pathname === '/healthz') {
      finish(200, '{"status":"ok"}\n', { 'Content-Type': 'application/json; charset=utf-8' }); return;
    }
    if (pathname === '/') pathname = '/index.html';
    const asset = assets.get(pathname);
    if (!asset) { finish(404, 'Not found\n'); return; }
    if (asset === null) { finish(404, 'Not found\n'); return; }
    const headers = { 'Content-Type': asset.type, ETag: asset.etag, 'Cache-Control': 'no-cache' };
    if (req.headers['if-none-match']?.split(',').some(tag => tag.trim() === asset.etag || tag.trim() === '*')) {
      res.writeHead(304, { ...SECURITY_HEADERS, ...headers }); res.end(); return;
    }
    finish(200, asset.body, headers);
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 100;
  server.maxConnections = 256;
  return server;
}

async function main() {
  const rawPort = process.env.PORT || '8180';
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) throw new Error('PORT must be an integer between 1 and 65535');
  const port = Number(rawPort), host = process.env.HOST || '::';
  const server = await createGameServer();
  server.on('error', error => { console.error(`Server error: ${error.message}`); process.exitCode = 1; });
  server.listen({ port, host, ipv6Only: false }, () => {
    console.log(`Traffic game listening on ${host === '::' ? '[::] (IPv4 + IPv6)' : host}:${port}`);
  });
  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { createGameServer, main };
