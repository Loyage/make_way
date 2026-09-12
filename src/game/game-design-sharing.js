(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TrafficGameDesignSharing = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const FORMAT = 'traffic-game-design';
  const VERSION = 1;
  const CODE_PREFIX = 'MWD1.';
  const MAX_INPUT_LENGTH = 2000000;

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function envelope(design) {
    if (!design || typeof design !== 'object' || Array.isArray(design) || typeof design.levelId !== 'string') throw new Error('设计数据无效');
    return { format: FORMAT, version: VERSION, design: clone(design) };
  }
  function json(design) { return JSON.stringify(envelope(design), null, 2); }
  function encodeBase64Url(text) {
    if (typeof Buffer !== 'undefined') return Buffer.from(text, 'utf8').toString('base64url');
    const bytes=new TextEncoder().encode(text);let binary='';
    for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
    return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  function decodeBase64Url(value) {
    if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('分享码格式无效');
    try {
      if (typeof Buffer !== 'undefined') return Buffer.from(value,'base64url').toString('utf8');
      const base64=value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4),binary=atob(base64),bytes=Uint8Array.from(binary,char=>char.charCodeAt(0));
      return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    } catch { throw new Error('分享码已损坏'); }
  }
  function code(design) { return CODE_PREFIX+encodeBase64Url(JSON.stringify(envelope(design))); }
  function parse(input) {
    if (typeof input !== 'string') throw new Error('请输入 JSON 或分享码');
    const text=input.trim();
    if (!text) throw new Error('请输入 JSON 或分享码');
    if (text.length>MAX_INPUT_LENGTH) throw new Error('设计内容过大，无法导入');
    let saved;
    try { saved=JSON.parse(text.startsWith(CODE_PREFIX)?decodeBase64Url(text.slice(CODE_PREFIX.length)):text); }
    catch (error) { if(error.message?.includes('分享码'))throw error;throw new Error('JSON 或分享码无法解析'); }
    if (!saved || typeof saved!=='object' || Array.isArray(saved)
      || Object.keys(saved).sort().join(',')!=='design,format,version'
      || saved.format!==FORMAT || saved.version!==VERSION
      || !saved.design || typeof saved.design!=='object' || Array.isArray(saved.design)
      || typeof saved.design.levelId!=='string' || !saved.design.levelId) throw new Error('设计文件格式或版本无效');
    return clone(saved);
  }
  function inspect(input, verifier) {
    const saved=parse(input);
    if (!verifier || verifier.level?.id!==saved.design.levelId || typeof verifier.loadDesign!=='function') throw new Error('找不到设计所属关卡');
    const message=verifier.loadDesign(saved.design);
    if(message)throw new Error(message);
    const design=verifier.serializeDesign(),cost=verifier.budget-verifier.fixedCost-verifier.remaining;
    return {
      envelope: envelope(design),
      summary: { levelId:design.levelId, roadCount:design.roads.length, busLineCount:design.busLines?.length||0, cost }
    };
  }

  return { FORMAT, VERSION, CODE_PREFIX, MAX_INPUT_LENGTH, envelope, json, code, parse, inspect };
});
