(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TrafficCanvas = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function createCanvasTools(ctx, point) {
    function rounded(x, y, w, h, r, fill, stroke) {
      ctx.beginPath();ctx.roundRect(x, y, w, h, r);
      if (fill) { ctx.fillStyle = fill;ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke;ctx.lineWidth = 1;ctx.stroke(); }
    }
    function line(x1, y1, x2, y2, color, width) {
      ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.strokeStyle = color;ctx.lineWidth = width;ctx.stroke();
    }
    function circle(x,y,r,color) { ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=color;ctx.fill(); }
    function label(text,x,y,size,color,weight='500') {
      ctx.font = `${weight} ${size}px system-ui, sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=color;ctx.fillText(text,x,y);
    }
    function buildingBubble(text,x,y,w,h,fill,color,stroke=null,tail='right') {
      rounded(x,y,w,h,h/2,fill,stroke);
      ctx.beginPath();
      const tx=tail==='right'?x+w-h*.38:x+h*.38;
      ctx.moveTo(tx-h*.13,y+h*.84);ctx.lineTo(tx+h*.13,y+h*.84);ctx.lineTo(tx+(tail==='right'?h*.12:-h*.12),y+h*1.08);ctx.closePath();
      ctx.fillStyle=stroke||fill;ctx.fill();
      label(text,x+w/2,y+h*.49,h*.52,color,'700');
    }
    function busSegment(aCell,bCell,s) {
      const a=point(aCell),b=point(bCell),dx=b.x-a.x,dy=b.y-a.y,offset=s*.13;
      return { x1:(a.x+.5)*s-dy*offset, y1:(a.y+.5)*s+dx*offset, x2:(b.x+.5)*s-dy*offset, y2:(b.y+.5)*s+dx*offset, dx, dy };
    }
    function busDirection(segment,color,s) {
      const mx=(segment.x1+segment.x2)/2,my=(segment.y1+segment.y2)/2,back=s*.085,wing=s*.052;
      const bx=mx-segment.dx*back,by=my-segment.dy*back;
      line(bx-segment.dy*wing,by+segment.dx*wing,mx,my,color,s*.023);
      line(bx+segment.dy*wing,by-segment.dx*wing,mx,my,color,s*.023);
    }
    function busTurn(ctxPath,previous,next,s) {
      if(previous.dx===next.dx&&previous.dy===next.dy){ctxPath.lineTo(previous.x2,previous.y2);return;}
      const r=s*.2;
      const incoming={x:previous.x2-previous.dx*r,y:previous.y2-previous.dy*r};
      const outgoing={x:next.x1+next.dx*r,y:next.y1+next.dy*r};
      ctxPath.lineTo(incoming.x,incoming.y);
      if(previous.dx===-next.dx&&previous.dy===-next.dy) {
        const reach=s*.18;
        ctxPath.bezierCurveTo(previous.x2+previous.dx*reach,previous.y2+previous.dy*reach,next.x1-next.dx*reach,next.y1-next.dy*reach,outgoing.x,outgoing.y);
        return;
      }
      const control={x:previous.dx?next.x1:previous.x2,y:previous.dy?next.y1:previous.y2};
      ctxPath.quadraticCurveTo(control.x,control.y,outgoing.x,outgoing.y);
    }
    function strokeBusRoute(route,color,width,s,dashed=false,joinEnds=false) {
      if(route.length<2)return;
      const segments=[];for(let i=1;i<route.length;i++)segments.push(busSegment(route[i-1],route[i],s));
      ctx.save();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.lineJoin='round';
      if(dashed)ctx.setLineDash([s*.11,s*.095]);
      ctx.beginPath();ctx.moveTo(segments[0].x1,segments[0].y1);
      for(let i=0;i<segments.length;i++) {
        const next=i+1<segments.length?segments[i+1]:joinEnds?segments[0]:null;
        if(next)busTurn(ctx,segments[i],next,s);else ctx.lineTo(segments[i].x2,segments[i].y2);
      }
      ctx.stroke();ctx.restore();
    }
    function strokeBusConnector(previous,next,color,width,s,dashed=false) {
      ctx.save();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';if(dashed)ctx.setLineDash([s*.11,s*.095]);
      ctx.beginPath();ctx.moveTo(previous.x2,previous.y2);busTurn(ctx,previous,next,s);ctx.stroke();ctx.restore();
    }
    function drawBusRoute(route,color,width,s,dashed=false,joinEnds=false) {
      strokeBusRoute(route,color,width,s,dashed,joinEnds);
      for(let i=1;i<route.length;i+=2)busDirection(busSegment(route[i-1],route[i],s),color,s);
    }
    return { rounded, line, circle, label, buildingBubble, busSegment, strokeBusConnector, drawBusRoute };
  }
  return { createCanvasTools };
});
