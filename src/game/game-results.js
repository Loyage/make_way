/* Result-only commute satisfaction reporting. */
(function (root) {
  'use strict';
  const BANDS = Object.freeze([
    Object.freeze({ max: 8, label: '轻松通勤', satisfaction: 100 }),
    Object.freeze({ max: 15, label: '舒适通勤', satisfaction: 80 }),
    Object.freeze({ max: 25, label: '尚可接受', satisfaction: 60 }),
    Object.freeze({ max: Infinity, label: '漫长等待', satisfaction: 30 })
  ]);
  function commuteReport(times, unarrived = 0) {
    const valid = Array.isArray(times) ? times.filter(n => Number.isFinite(n) && n >= 0) : [];
    const pending = Number.isInteger(unarrived) && unarrived > 0 ? unarrived : 0;
    const bands = BANDS.map(band => ({ ...band, count: valid.filter(time => time <= band.max && (BANDS.indexOf(band) === 0 || time > BANDS[BANDS.indexOf(band) - 1].max)).length }));
    bands[bands.length - 1].count += pending;
    const count = valid.length + pending;
    const score = count ? Math.round(bands.reduce((sum, band) => sum + band.count * band.satisfaction, 0) / count) : 0;
    const average = valid.length ? valid.reduce((sum, time) => sum + time, 0) / valid.length : 0;
    return { count, score, average, bands };
  }
  const api = { BANDS, commuteReport };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TrafficResults = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
