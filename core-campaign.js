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

  function campaignIncome(delivered, population, satisfaction, maxIncome) {
    const deliveryRatio = Math.min(1, Math.max(0, delivered) / Math.max(1, population));
    const satisfactionRatio = Math.min(1, Math.max(0, satisfaction) / 100);
    return Math.round(Math.max(0, maxIncome) * (deliveryRatio * 0.7 + satisfactionRatio * 0.3));
  }

  class CampaignSession {
    constructor(levelId) {
      this.level = levels().find(level => level.id === levelId);
      if (!this.level?.campaign || !Array.isArray(this.level.campaign.days) || this.level.campaign.days.length !== 5) throw new RangeError(`Level is not a five-day campaign: ${levelId}`);
      this.days = this.level.campaign.days;
      if (this.days.some(day => !day || !Number.isFinite(day.duration) || day.duration <= 0
        || !Number.isInteger(day.maxIncome) || day.maxIncome < 0 || !Array.isArray(day.routes) || !day.routes.length)) throw new RangeError(`Invalid campaign day: ${levelId}`);
      this.dayIndex = 0;
      this.results = [];
      this.checkpoints = [];
      this.city = this.createCity(0, this.level.budget);
    }
    pendingBuildings(dayIndex = this.dayIndex) {
      const active = new Set(this.days[dayIndex].routes.flatMap(route => [...routeHomes(route).map(home => home.cell), ...routeGoals(route).map(goal => goal.cell)]));
      const sites = new Map();
      for (let future = dayIndex + 1; future < this.days.length; future++) {
        for (const route of this.days[future].routes) {
          for (const [kind, buildings] of [['home', routeHomes(route)], ['goal', routeGoals(route)]]) for (const building of buildings) {
            if (!active.has(building.cell) && !sites.has(building.cell)) sites.set(building.cell, { cell: building.cell, kind, daysUntil: future - dayIndex });
          }
        }
      }
      return [...sites.values()];
    }
    createCity(dayIndex, budget, design = null) {
      const day = this.days[dayIndex];
      const city = new City(this.level.id, { routes: day.routes, budget, duration: day.duration, deadlineMode: true, pendingBuildings: this.pendingBuildings(dayIndex) });
      if (design) { const message = city.loadDesign(design); if (message) throw new Error(message); }
      return city;
    }
    beginDay() {
      if (this.city.state !== 'planning') return this.city.toggle();
      const design = this.city.serializeDesign(), message = this.city.toggle();
      if (!message) this.checkpoints[this.dayIndex] = { budget: this.city.budget, design: JSON.parse(JSON.stringify(design)) };
      return message;
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
      this.results = this.results.slice(0, dayIndex);
      this.checkpoints = this.checkpoints.slice(0, dayIndex + 1);
      this.city = this.createCity(dayIndex, checkpoint.budget, checkpoint.design);
      return '';
    }
  }

  return { CampaignSession, campaignIncome };
});
