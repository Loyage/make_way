/* Lightweight arrival celebrations, isolated from simulation and input. */
(function (root) {
  'use strict';
  function createArrivalEffects() {
    const effects = [];
    let seen = 0;
    function reset(delivered = 0) { effects.length = 0; seen = delivered; }
    function sync(city) {
      if (city.delivered < seen) reset(city.delivered);
      while (seen < city.delivered) {
        const event = city.arrivals[seen] || { route: 0 };
        const route = city.routes[event.route] || city.routes[0];
        const goal = Number.isInteger(event.goal) ? event.goal
          : city.goals?.[event.goalIndex]?.cell ?? route?.goals?.[0]?.cell ?? route?.goal;
        if (Number.isInteger(goal)) for (let i = 0; i < 7; i++) effects.push({ goal, age: 0, angle: i * Math.PI * 2 / 7, color: route?.color || '#708b9b' });
        seen++;
      }
    }
    function step(dt) {
      for (const effect of effects) effect.age += dt;
      while (effects[0]?.age > 1.1) effects.shift();
    }
    function draw(ctx, point, cellSize) {
      for (const effect of effects) {
        const p = point(effect.goal), distance = cellSize * (.12 + effect.age * .5);
        const x = (p.x + .5) * cellSize + Math.cos(effect.angle) * distance;
        const y = (p.y + .5) * cellSize + Math.sin(effect.angle) * distance - effect.age * cellSize * .15;
        ctx.globalAlpha = Math.max(0, 1 - effect.age / 1.1);
        ctx.fillStyle = effect.color;
        ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, cellSize * .045), 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    return { reset, sync, step, draw };
  }
  const api = { createArrivalEffects };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TrafficEffects = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
