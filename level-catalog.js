(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TrafficLevelCatalog = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const isManifest = data => data && data.version === 2 && Array.isArray(data.chapters) && data.chapters.every(item => typeof item === 'string');
  function normalizeCatalog(data) {
    if (!Array.isArray(data)) return data;
    if (data.length === 8 || data.length === 9 || data.length === 10) {
      const split = data.length - 4;
      return { version: 1, chapters: [
        { id: 'road-basics', name: '道路入门', english: 'ROAD BASICS', levels: data.slice(0, split) },
        { id: 'city-control', name: '城市调度', english: 'CITY CONTROL', levels: data.slice(split) }
      ] };
    }
    return { version: 1, chapters: [{ id: 'custom-levels', name: '自定义关卡', english: 'CUSTOM LEVELS', levels: data }] };
  }
  const resolveUrl = (base, reference) => new URL(reference, new URL(base, location.href)).href;

  async function loadCatalog(url, options = {}) {
    const fetchJson = options.fetchJson || (async target => {
      const response = await fetch(target, { cache: 'no-store' });
      if (!response.ok) throw Object.assign(new Error(`请求失败（${response.status}）：${target}`), { status: response.status });
      return response.json();
    });
    const rootUrl = resolveUrl(location.href, url), rootData = await fetchJson(rootUrl);
    if (!isManifest(rootData)) return rootData;
    const chapters = await Promise.all(rootData.chapters.map(async chapterRef => {
      const chapterUrl = resolveUrl(rootUrl, chapterRef), chapter = await fetchJson(chapterUrl);
      if (!chapter || !Array.isArray(chapter.levels) || chapter.levels.some(item => typeof item !== 'string')) throw new Error(`章节清单无效：${chapterRef}`);
      const levels = await Promise.all(chapter.levels.map(levelRef => fetchJson(resolveUrl(chapterUrl, levelRef))));
      return { id: chapter.id, name: chapter.name, english: chapter.english, levels };
    }));
    return { version: 1, chapters };
  }

  function loadCatalogSync(filename) {
    const fs = require('node:fs'), path = require('node:path');
    const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
    const rootData = readJson(filename);
    if (!isManifest(rootData)) return rootData;
    const rootDir = path.dirname(path.resolve(filename));
    const resolveSafe = (base, reference) => {
      if (typeof reference !== 'string' || path.isAbsolute(reference)) throw new Error(`关卡路径必须是相对路径：${reference}`);
      const resolved = path.resolve(base, reference);
      if (resolved !== rootDir && !resolved.startsWith(rootDir + path.sep)) throw new Error(`关卡路径越界：${reference}`);
      return resolved;
    };
    const chapters = rootData.chapters.map(chapterRef => {
      const chapterFile = resolveSafe(rootDir, chapterRef), chapter = readJson(chapterFile);
      if (!chapter || !Array.isArray(chapter.levels) || chapter.levels.some(item => typeof item !== 'string')) throw new Error(`章节清单无效：${chapterRef}`);
      const levels = chapter.levels.map(levelRef => readJson(resolveSafe(path.dirname(chapterFile), levelRef)));
      return { id: chapter.id, name: chapter.name, english: chapter.english, levels };
    });
    return { version: 1, chapters };
  }

  async function writeCatalog(catalog, manifestFile, dataDirectory) {
    const fs = require('node:fs/promises'), path = require('node:path');
    const safeId = value => typeof value === 'string' && /^[a-z0-9-]+$/.test(value);
    if (!catalog || !Array.isArray(catalog.chapters) || catalog.chapters.some(chapter => !safeId(chapter.id) || !Array.isArray(chapter.levels) || chapter.levels.some(level => !safeId(level.id)))) throw new Error('章节和关卡 id 只能包含小写字母、数字和连字符');
    const absoluteManifest = path.resolve(manifestFile), absoluteData = path.resolve(dataDirectory);
    const temporary = `${absoluteData}.tmp-${process.pid}`, backup = `${absoluteData}.old-${process.pid}`;
    await fs.rm(temporary, { recursive: true, force: true });
    await fs.mkdir(temporary, { recursive: true });
    const chapterRefs = [];
    for (const chapter of catalog.chapters) {
      const chapterDir = path.join(temporary, chapter.id);await fs.mkdir(chapterDir, { recursive: true });
      const levelRefs = [];
      for (const level of chapter.levels) {
        const filename = `${level.id}.json`;levelRefs.push(filename);
        await fs.writeFile(path.join(chapterDir, filename), JSON.stringify(level, null, 2) + '\n', 'utf8');
      }
      await fs.writeFile(path.join(chapterDir, 'chapter.json'), JSON.stringify({ version: 1, id: chapter.id, name: chapter.name, english: chapter.english, levels: levelRefs }, null, 2) + '\n', 'utf8');
      chapterRefs.push(path.relative(path.dirname(absoluteManifest), path.join(absoluteData, chapter.id, 'chapter.json')).split(path.sep).join('/'));
    }
    await fs.rm(backup, { recursive: true, force: true });
    try { await fs.rename(absoluteData, backup); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try {
      await fs.rename(temporary, absoluteData);
      const manifestTmp = `${absoluteManifest}.tmp-${process.pid}`;
      await fs.writeFile(manifestTmp, JSON.stringify({ version: 2, chapters: chapterRefs }, null, 2) + '\n', 'utf8');
      await fs.rename(manifestTmp, absoluteManifest);
      await fs.rm(backup, { recursive: true, force: true });
    } catch (error) {
      await fs.rm(absoluteData, { recursive: true, force: true });
      try { await fs.rename(backup, absoluteData); } catch { /* best-effort rollback */ }
      throw error;
    }
  }

  return { isManifest, normalizeCatalog, loadCatalog, loadCatalogSync, writeCatalog };
});
