'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { isManifest, migrateLevelRoads, loadCatalogSync, writeCatalog } = require('../src/shared/level-catalog.js');

const builtInManifest = path.join(__dirname, '..', 'built-in-levels.json');

test('split catalog loads chapter manifests and one file per level', () => {
  const manifest = JSON.parse(fs.readFileSync(builtInManifest, 'utf8'));
  assert.equal(isManifest(manifest), true);
  assert.deepEqual(manifest.chapters, ['levels/road-basics/chapter.json', 'levels/city-control/chapter.json']);
  const catalog = loadCatalogSync(builtInManifest);
  assert.deepEqual(catalog.chapters.map(chapter => chapter.levels.length), [5, 6]);
  for (const chapter of catalog.chapters) {
    const chapterManifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'levels', chapter.id, 'chapter.json'), 'utf8'));
    assert.ok(chapterManifest.levels.every(reference => /^[a-z0-9-]+\.json$/.test(reference)));
    assert.deepEqual(chapterManifest.levels.map(reference => path.basename(reference, '.json')), chapter.levels.map(level => level.id));
  }
});

test('legacy initial edges migrate to order-independent road format v2', () => {
  const migrated=migrateLevelRoads({id:'legacy',routes:[{homes:[{cell:1}],goals:[{cell:4}]}],initialEdges:[[1,2,0],[2,3,2],[3,4,1]]});
  assert.equal(migrated.version,2);
  assert.deepEqual(migrated.initialEdges,[[1,2],[2,3],[3,4]]);
  assert.deepEqual(migrated.initialRoads,[{cell:2,grade:2},{cell:3,grade:1}]);
});

test('catalog writer creates a path-only manifest and round-trips data', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'traffic-levels-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = loadCatalogSync(builtInManifest), manifest = path.join(directory, 'levels.json');
  await writeCatalog(source, manifest, path.join(directory, 'levels.local'));
  const storedManifest = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  assert.equal(isManifest(storedManifest), true);
  assert.ok(storedManifest.chapters.every(reference => reference.startsWith('levels.local/')));
  assert.deepEqual(loadCatalogSync(manifest), source);
});

test('browser core modules compose through globals in documented order', () => {
  const context = vm.createContext({ console, URL, location: { href: 'http://example.test/' } });
  for (const filename of ['level-catalog.js','core-geometry.js','core-bus.js','core.js','core-campaign.js','level-validation.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', filename), 'utf8'), context, { filename });
  }
  assert.equal(typeof context.TrafficCore.City, 'function');
  assert.equal(typeof context.TrafficCore.CampaignSession, 'function');
  assert.equal(typeof context.TrafficCore.City.prototype.createBusLine, 'function');
  assert.equal(context.TrafficLevelValidation.validateLevelCatalog({}).ok, false);
  assert.ok(Array.isArray(context.TrafficLevelValidation.validateLevelCatalog({}).errors));
});

test('sync loader rejects manifest paths outside the catalog root', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'traffic-levels-'));
  try {
    const manifest = path.join(directory, 'levels.json');
    fs.writeFileSync(manifest, JSON.stringify({ version: 2, chapters: ['../secret.json'] }));
    assert.throws(() => loadCatalogSync(manifest), /路径越界/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
