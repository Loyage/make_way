/* Result-only commute satisfaction reporting. */
(function (root) {
  'use strict';
  const BANDS = Object.freeze([
    Object.freeze({ max: 8, label: '轻松通勤', satisfaction: 100 }),
    Object.freeze({ max: 15, label: '舒适通勤', satisfaction: 80 }),
    Object.freeze({ max: 25, label: '尚可接受', satisfaction: 60 }),
    Object.freeze({ max: Infinity, label: '漫长等待', satisfaction: 30 })
  ]);
  function satisfactionBand(time) {
    if (!Number.isFinite(time) || time < 0) return null;
    return BANDS.findIndex(band => time <= band.max);
  }
  function commuteReport(times, unarrived = 0) {
    const valid = Array.isArray(times) ? times.filter(n => Number.isFinite(n) && n >= 0) : [];
    const pending = Number.isInteger(unarrived) && unarrived > 0 ? unarrived : 0;
    const bands = BANDS.map((band,index) => ({ ...band, count: valid.filter(time => satisfactionBand(time) === index).length }));
    bands[bands.length - 1].count += pending;
    const count = valid.length + pending;
    const score = count ? Math.round(bands.reduce((sum, band) => sum + band.count * band.satisfaction, 0) / count) : 0;
    const average = valid.length ? valid.reduce((sum, time) => sum + time, 0) / valid.length : 0;
    const sorted=[...valid].sort((a,b)=>a-b),p95=sorted.length?sorted[Math.max(0,Math.ceil(sorted.length*.95)-1)]:0;
    return { count, score, average, p95, bands };
  }
  function liveCommuteReport(completedTimes, activeTimes) {
    const completed=Array.isArray(completedTimes)?completedTimes:[],active=Array.isArray(activeTimes)?activeTimes:[];
    return commuteReport([...completed,...active]);
  }
  function starReport(targets, metrics) {
    if (!targets || typeof targets !== 'object') return { count: 0, earned: [], goals: [] };
    const efficiency=targets.efficiency||{},score=Number(metrics?.score)||0,cost=Number(metrics?.cost)||0,maxQueue=Number(metrics?.maxQueue)||0;
    const goals=[
      { id:'completion',label:'完成运输目标',earned:Boolean(metrics?.won) },
      { id:'satisfaction',label:`满意度达到 ${targets.satisfaction}%`,earned:score>=targets.satisfaction },
      { id:'efficiency',label:`建设不超过 ${efficiency.maxCost} 点，最大住宅排队不超过 ${efficiency.maxQueue} 人`,earned:cost<=efficiency.maxCost&&maxQueue<=efficiency.maxQueue }
    ];
    return { count:goals.filter(goal=>goal.earned).length,earned:goals.filter(goal=>goal.earned).map(goal=>goal.id),goals };
  }
  const api = { BANDS, satisfactionBand, commuteReport, liveCommuteReport, starReport };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TrafficResults = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
