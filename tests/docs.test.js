'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const shortcuts = [
  { key: '1', id: 'view-tool', label: '观察', heading: '观察模式', mode: 'view' },
  { key: '2', id: 'select-tool', label: '选择', heading: '选择模式', mode: 'select' },
  { key: '3', id: 'road-tool', label: '拖拽', heading: '拖拽模式', mode: 'road' },
  { key: '4', id: 'cut-tool', label: '剪刀', heading: '剪刀模式', mode: 'cut' },
  { key: '5', id: 'bus-tool', label: '公交线', heading: '公交线路', mode: 'bus' }
];

test('tool shortcuts stay consistent across UI, help, guide and README', () => {
  const index = read('src/game/index.html');
  const manual = read('src/game/manual.html');
  const readme = read('README.md');
  const game = read('src/game/game.js');

  for (const shortcut of shortcuts) {
    const key = escape(shortcut.key), label = escape(shortcut.label), heading = escape(shortcut.heading), id = escape(shortcut.id);
    assert.match(index, new RegExp(`id="${id}"[^>]*aria-label="${label}模式，快捷键 ${key}"[^>]*>[\\s\\S]*?<kbd>${key}</kbd>`));
    assert.match(index, new RegExp(`<b>${label}模式（${key}[^<]*</b>`));
    assert.match(manual, new RegExp(`MODE 0${key}[\\s\\S]*?<h2>${heading}`));
    assert.match(manual, new RegExp(`按 <kbd>${key}</kbd>`));
    assert.match(readme, new RegExp(`\\*\\*${label}模式（${key}）\\*\\*`));
    assert.ok(game.includes(`if(e.key==='${shortcut.key}')setTool('${shortcut.mode}')`) ||
      game.includes(`if(e.key==='${shortcut.key}'){busEditMode='draw';setTool('${shortcut.mode}');}`));
  }

  const summary = '1 / 2 / 3 / 4 / 5 切换观察、选择、拖拽、剪刀、公交线';
  assert.ok(index.includes(summary));
  assert.ok(manual.includes('切换观察 / 选择 / 拖拽 / 剪刀 / 公交线模式'));
  assert.ok(readme.includes('| `1` / `2` / `3` / `4` / `5` | 观察 / 选择 / 拖拽 / 剪刀 / 公交线 |'));
});
