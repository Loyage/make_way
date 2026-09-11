/* Lightweight arrival celebrations, isolated from simulation and input. */
(function (root) {
  'use strict';
  const MOODS = Object.freeze([
    Object.freeze({ symbol: '☺', color: '#317a57' }),
    Object.freeze({ symbol: '☺', color: '#79924f' }),
    Object.freeze({ symbol: '—', color: '#c38a51' }),
    Object.freeze({ symbol: '☹', color: '#b9574d' })
  ]);
  function drawResidentMood(ctx, x, y, size, bandIndex, count = 1, bob = 0) {
    const mood=MOODS[Math.max(0,Math.min(MOODS.length-1,bandIndex))]||MOODS[0],radius=Math.max(7,size*.16),cy=y+bob;
    ctx.save();ctx.globalAlpha=.96;ctx.fillStyle='#fffef9';ctx.strokeStyle=mood.color;ctx.lineWidth=Math.max(1.5,size*.028);
    ctx.beginPath();ctx.arc(x,cy,radius,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.fillStyle=mood.color;ctx.font=`700 ${Math.max(10,size*.21)}px system-ui, sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(mood.symbol,x,cy-size*.006);
    if(count>1){const text=count>99?'99+':String(count),badgeRadius=Math.max(5,size*.095);ctx.fillStyle=mood.color;ctx.beginPath();ctx.arc(x+radius*.78,cy-radius*.76,badgeRadius,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fffef9';ctx.font=`700 ${Math.max(7,size*.105)}px system-ui, sans-serif`;ctx.fillText(text,x+radius*.78,cy-radius*.76);}
    ctx.restore();
  }
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
  const api = { MOODS, drawResidentMood, createArrivalEffects };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TrafficEffects = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
