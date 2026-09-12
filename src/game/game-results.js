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
  function bottleneckAdvice({ routes=[],homes=[],roads=[],junctions=[] }={}) {
    const advice=[];
    const route=[...routes].filter(item=>item&&item.total>0&&item.delivered<item.total).sort((a,b)=>(a.delivered/a.total)-(b.delivered/b.total)||a.index-b.index)[0];
    if(route)advice.push({kind:'route',cell:route.cell,text:`${route.name}仅送达 ${route.delivered}/${route.total} 人；先检查该路线排队最久住宅的出口与下游是否连通。`});
    const home=[...homes].filter(item=>item&&item.waitingSeconds>0).sort((a,b)=>b.waitingSeconds-a.waitingSeconds||b.maxQueue-a.maxQueue||a.cell-b.cell)[0];
    if(home&&advice.length<2)advice.push({kind:'home',cell:home.cell,text:`该住宅累计等待 ${home.waitingSeconds.toFixed(1)} 人秒、峰值 ${home.maxQueue} 人；优先检查门口道路容量与合流。`});
    const road=[...roads].filter(item=>item&&item.blockedSeconds>0).sort((a,b)=>b.blockedSeconds-a.blockedSeconds||b.occupancySeconds-a.occupancySeconds||a.cell-b.cell)[0];
    if(road&&advice.length<2)advice.push({kind:'road',cell:road.cell,text:`该路段累计受阻 ${road.blockedSeconds.toFixed(1)} 车秒；可比较升级瓶颈段、减少合流或提供绕行。`});
    const junction=[...junctions].filter(item=>item&&item.queueSeconds>0).sort((a,b)=>b.queueSeconds-a.queueSeconds||b.maxQueue-a.maxQueue||a.cell-b.cell)[0];
    if(junction&&advice.length<2)advice.push({kind:'junction',cell:junction.cell,text:`该路口累计排队 ${junction.queueSeconds.toFixed(1)} 车秒、峰值 ${junction.maxQueue} 辆；检查入口优先级或信号阶段。`});
    return advice.slice(0,2);
  }
  const api = { BANDS, satisfactionBand, commuteReport, liveCommuteReport, starReport, bottleneckAdvice };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TrafficResults = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
