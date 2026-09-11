(function (root, factory) {
  'use strict';
  if (typeof module !== 'undefined' && module.exports) module.exports = factory;
  else Object.assign(root.TrafficCore, factory(root.TrafficCore));
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';
  const { City } = core;
  const routeHomes = core.routeHomes;
  const routeGoals = core.routeGoals;
  const levels = () => core.LEVELS;
  const clone = value => JSON.parse(JSON.stringify(value));

  function campaignIncome(delivered, population, satisfaction, maxIncome) {
    const deliveryRatio = Math.min(1, Math.max(0, delivered) / Math.max(1, population));
    const satisfactionRatio = Math.min(1, Math.max(0, satisfaction) / 100);
    return Math.round(Math.max(0, maxIncome) * (deliveryRatio * 0.7 + satisfactionRatio * 0.3));
  }

  function conditionMet(condition = {}, dayNumber = 1, results = []) {
    const delivered = results.reduce((sum, result) => sum + result.delivered, 0);
    const income = results.reduce((sum, result) => sum + result.income, 0);
    const satisfaction = results.length ? results[results.length - 1].satisfaction : 0;
    return dayNumber >= (condition.day || 1)
      && delivered >= (condition.delivered || 0)
      && income >= (condition.income || 0)
      && satisfaction >= (condition.satisfaction || 0);
  }

  function commuteSatisfaction(times, unarrived = 0) {
    const scores=(Array.isArray(times)?times:[]).filter(time=>Number.isFinite(time)&&time>=0).map(time=>time<=8?100:time<=15?80:time<=25?60:30);
    for(let i=0;i<Math.max(0,unarrived);i++)scores.push(30);
    return scores.length?Math.round(scores.reduce((sum,score)=>sum+score,0)/scores.length):0;
  }
  function designFingerprint(design) { return JSON.stringify(design); }

  function migrateCampaignLevel(level) {
    if (!level?.campaign?.days?.some(day => Array.isArray(day.routes))) return level;
    const potential = [], routeByIndex = new Map();
    level.campaign.days.forEach((day, dayIndex) => {
      (day.routes || []).forEach((route, routeIndex) => {
        let target = routeByIndex.get(routeIndex);
        if (!target) {
          target = { name: route.name, color: route.color, light: route.light, homes: [], goals: [] };
          routeByIndex.set(routeIndex, target);potential.push(target);
        }
        for (const [kind, buildings] of [['homes', routeHomes(route)], ['goals', routeGoals(route)]]) for (const source of buildings) {
          let building = target[kind].find(item => item.cell === source.cell);
          const fields = kind === 'homes' ? ['generationRate','passengers'] : ['input'];
          if (!building) {
            building = clone(source);building.unlock = { day: dayIndex + 1 };building.upgrades = [];
            target[kind].push(building);continue;
          }
          const changes = {};
          for (const field of fields) {
            const sourceValue = source[field] ?? (field === 'generationRate' ? source.rate : undefined);
            const currentValue = building.upgrades.length && building.upgrades.at(-1)[field] !== undefined ? building.upgrades.at(-1)[field] : building[field];
            if (sourceValue !== currentValue) changes[field] = sourceValue;
          }
          if (Object.keys(changes).length) building.upgrades.push({ condition: { day: dayIndex + 1 }, ...changes });
        }
      });
    });
    level.campaign.routes = potential;
    level.campaign.days = level.campaign.days.map(day => { const copy=clone(day);delete copy.routes;return copy; });
    level.routes = materializeCampaignRoutes(level, 0, []);
    return level;
  }

  function materializeCampaignRoutes(level, dayIndex, results = []) {
    const source = clone(level.campaign?.routes || level.routes || []), dayNumber = dayIndex + 1;
    return source.map(route => ({
      ...route,
      homes: routeHomes(route).filter(home => conditionMet(home.unlock, dayNumber, results)).map(home => {
        const copy = { ...home };delete copy.unlock;delete copy.upgrades;
        for (const upgrade of home.upgrades || []) if (conditionMet(upgrade.condition, dayNumber, results)) {
          if (upgrade.generationRate !== undefined) copy.generationRate = upgrade.generationRate;
          if (upgrade.passengers !== undefined) copy.passengers = upgrade.passengers;
        }
        return copy;
      }),
      goals: routeGoals(route).filter(goal => conditionMet(goal.unlock, dayNumber, results)).map(goal => {
        const copy = { ...goal };delete copy.unlock;delete copy.upgrades;
        for (const upgrade of goal.upgrades || []) if (conditionMet(upgrade.condition, dayNumber, results)) {
          if (upgrade.input === null) delete copy.input;
          else if (upgrade.input !== undefined) copy.input = upgrade.input;
        }
        return copy;
      })
    })).filter(route => route.homes.length && route.goals.length);
  }

  class CampaignSession {
    constructor(levelId) {
      const source = levels().find(level => level.id === levelId);
      if (!source?.campaign || !Array.isArray(source.campaign.days) || source.campaign.days.length < 2) throw new RangeError(`Level is not a multi-day campaign: ${levelId}`);
      this.level = migrateCampaignLevel(clone(source));
      this.days = this.level.campaign.days;
      if (this.days.some(day => !day || !Number.isFinite(day.duration) || day.duration <= 0
        || !Number.isInteger(day.maxIncome) || day.maxIncome < 0)) throw new RangeError(`Invalid campaign day: ${levelId}`);
      this.dayIndex = 0;
      this.results = [];
      this.checkpoints = [];
      this.referenceDivergenceDay = null;
      this.city = this.createCity(0, this.level.budget);
    }
    routes(dayIndex = this.dayIndex) { return materializeCampaignRoutes(this.level, dayIndex, this.results.slice(0, dayIndex)); }
    pendingBuildings(dayIndex = this.dayIndex) {
      const activeRoutes = this.routes(dayIndex), active = new Set(activeRoutes.flatMap(route => [...route.homes, ...route.goals].map(building => building.cell)));
      const sites = [];
      for (const route of this.level.campaign.routes) for (const [kind, buildings] of [['home', routeHomes(route)], ['goal', routeGoals(route)]]) for (const building of buildings) {
        if (active.has(building.cell)) continue;
        const condition = clone(building.unlock || {}), unlockDay = condition.day || 1;
        sites.push({ cell: building.cell, kind, daysUntil: Math.max(0, unlockDay - dayIndex - 1), conditional: Boolean(condition.delivered || condition.income || condition.satisfaction), condition });
      }
      return sites;
    }
    createCity(dayIndex, budget, design = null) {
      const day = this.days[dayIndex], routes = this.routes(dayIndex);
      if (!routes.length) throw new RangeError(`Campaign day has no active route: ${this.level.id}`);
      const city = new City(this.level.id, { routes, budget, duration: day.duration, pendingBuildings: this.pendingBuildings(dayIndex) });
      if (design) { const message = city.loadDesign(design); if (message) throw new Error(message); }
      return city;
    }
    reference(dayIndex = this.dayIndex) { return this.days[dayIndex]?.referenceDesign || null; }
    loadReference(dayIndex = this.dayIndex, ignoreDivergence = false) {
      if(dayIndex!==this.dayIndex)return '只能加载当前日期的参考答案';
      const reference=this.reference(dayIndex);if(!reference)return `第 ${dayIndex+1} 天尚未设置参考答案`;
      if(!ignoreDivergence&&this.referenceDivergenceDay!==null&&this.referenceDivergenceDay<dayIndex)return `当前进度从第 ${this.referenceDivergenceDay+1} 天起已偏离参考方案`;
      const message=this.city.loadDesign(reference);if(!message&&this.referenceDivergenceDay===dayIndex)this.referenceDivergenceDay=null;
      return message;
    }
    beginDay() {
      if (this.city.state !== 'planning') return this.city.toggle();
      const design = this.city.serializeDesign(), reference=this.reference();
      if(this.referenceDivergenceDay===null&&reference&&designFingerprint(design)!==designFingerprint(reference))this.referenceDivergenceDay=this.dayIndex;
      const message = this.city.toggle();
      if (!message) this.checkpoints[this.dayIndex] = { budget: this.city.budget, design: clone(design), results: clone(this.results), referenceDivergenceDay: this.referenceDivergenceDay };
      return message;
    }
    runReferenceDay(step = 0.05) {
      const day=this.dayIndex,message=this.loadReference(day,true);if(message)return {ok:false,day:day+1,error:message};
      const begin=this.beginDay();if(begin)return {ok:false,day:day+1,error:begin};
      const limit=Math.ceil(this.city.duration/step)+4;let count=0;
      while(this.city.state==='running'&&count++<limit)this.city.step(step);
      if(this.city.state!=='won')return {ok:false,day:day+1,error:`仅送达 ${this.city.delivered} / ${this.city.target} 人`};
      const generated=this.city.generated.reduce((sum,value)=>sum+value,0),satisfaction=commuteSatisfaction(this.city.commuteTimes,Math.max(0,generated-this.city.delivered));
      const result=this.advance(satisfaction);return {ok:true,day:day+1,result,complete:day===this.days.length-1};
    }
    settlement(satisfaction) {
      const day = this.days[this.dayIndex], population = this.city.homes.reduce((sum, home) => sum + home.passengers, 0);
      return { day: this.dayIndex + 1, delivered: this.city.delivered, population, target: this.city.target, satisfaction, income: campaignIncome(this.city.delivered, population, satisfaction, day.maxIncome) };
    }
    advance(satisfaction) {
      if (!['won','lost'].includes(this.city.state)) throw new Error('当天运营尚未结束');
      const result = this.settlement(satisfaction);
      this.results[this.dayIndex] = result;
      if (this.dayIndex === this.days.length - 1) return result;
      const design = this.city.serializeDesign(), budget = this.city.budget + result.income;
      this.dayIndex++;
      this.city = this.createCity(this.dayIndex, budget, design);
      return result;
    }
    replay(dayIndex) {
      if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= this.checkpoints.length || !this.checkpoints[dayIndex]) return '这一天还没有可回溯的运营前存档';
      const checkpoint = this.checkpoints[dayIndex];
      this.dayIndex = dayIndex;
      this.results = clone(checkpoint.results || this.results.slice(0, dayIndex));
      this.checkpoints = this.checkpoints.slice(0, dayIndex + 1);
      this.referenceDivergenceDay = checkpoint.referenceDivergenceDay ?? null;
      this.city = this.createCity(dayIndex, checkpoint.budget, checkpoint.design);
      return '';
    }
  }

  function verifyCampaignReferenceChain(levelId, step = 0.05) {
    let session;try{session=new CampaignSession(levelId);}catch(error){return {ok:false,day:1,error:error.message,results:[]};}
    const results=[];
    for(let day=0;day<session.days.length;day++){
      const outcome=session.runReferenceDay(step);if(!outcome.ok)return {...outcome,results};results.push(outcome.result);
    }
    return {ok:true,days:session.days.length,results};
  }

  return { CampaignSession, campaignIncome, commuteSatisfaction, conditionMet, migrateCampaignLevel, materializeCampaignRoutes, verifyCampaignReferenceChain };
});
