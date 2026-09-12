(function (root, factory) {
  'use strict';
  const installBusMethods = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = installBusMethods;
  else root.TrafficBus = { installBusMethods };
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  return function installBusMethods(City, constants) {
    const { BUS_CAPACITY, BUS_SPEED_MULTIPLIER, BUS_BOARDING_RATE, BUS_COST, BUS_LINE_COLORS } = constants;
    class BusMethods {
    get busLineLimit() { return Number.isInteger(this.level.busLineLimit) ? this.level.busLineLimit : 1; }
    busLine(lineId = this.activeBusLineId) { return this.busLines.find(line => line.id === lineId) || null; }
    get activeBusLine() { return this.busLine(); }
    busRouteCells(line) {
      if (!line?.route.length) return [];
      return line.route[0] === line.route[line.route.length - 1] ? line.route.slice(0, -1) : [...line.route];
    }
    busOperatingRoute(line) {
      if (!line?.route.length) return [];
      const closed = line.route.length >= 3 && line.route[0] === line.route[line.route.length - 1];
      return line.returnTrip && !closed ? [...line.route, ...line.route.slice(0, -1).reverse()] : [...line.route];
    }
    busLineIssue(line) {
      if (!line.route.length) return `「${line.name}」尚未绘制线路`;
      const closed = line.route.length >= 3 && line.route[0] === line.route[line.route.length - 1];
      if (!line.returnTrip && !closed) return `「${line.name}」尚未闭环，请从线路末端继续绘制`;
      if (line.route.length < 2) return `「${line.name}」至少需要经过两格道路`;
      if (new Set(this.busRouteCells(line)).size < line.count) return `「${line.name}」经过的不同道路格不能少于公交车数量`;
      return '';
    }
    busLineProblem() {
      for (const line of this.busLines) {
        const problem = this.busLineIssue(line);
        if (problem) return problem;
      }
      return '';
    }
    busLineOperational(line) { return Boolean(line && !this.busLineIssue(line)); }
    busServicePositions(buildingCell, lineId = this.activeBusLineId) {
      const line = this.busLine(lineId);
      if (!line || !this.buildings.has(buildingCell)) return [];
      const route = this.busOperatingRoute(line), outboundLimit = line.route[0] === line.route[line.route.length - 1] ? route.length - 1 : line.route.length;
      const positions = [];
      for (let i = 0; i < route.length - 1; i++) if (line.stops.has(route[i]) && this.neighbors(buildingCell).includes(route[i]) && (i < outboundLimit || line.returnStops)) positions.push(i);
      return positions;
    }
    busCanServe(homeCell, goalCell, line) {
      if (!this.busLineOperational(line)) return false;
      const homePositions = this.busServicePositions(homeCell, line.id), goalPositions = this.busServicePositions(goalCell, line.id), segments = this.busOperatingRoute(line).length - 1;
      if (!homePositions.length || !goalPositions.length || segments < 1) return false;
      return homePositions.some(homePosition => goalPositions.some(goalPosition => (goalPosition - homePosition + segments) % segments > 0));
    }
    busStopServicePositions(cell, lineId) {
      const line=this.busLine(lineId);if(!this.busLineOperational(line)||!line.stops.has(cell))return [];
      const route=this.busOperatingRoute(line),outboundLimit=line.route[0]===line.route[line.route.length-1]?route.length-1:line.route.length,positions=[];
      for(let i=0;i<route.length-1;i++)if(route[i]===cell&&(i<outboundLimit||line.returnStops))positions.push(i);
      return positions;
    }
    busForwardSegments(line,from,to) { const segments=this.busOperatingRoute(line).length-1;return segments>0?(to-from+segments)%segments:0; }
    busRideTime(line,from,to) {
      const route=this.busOperatingRoute(line),segments=route.length-1,distance=this.busForwardSegments(line,from,to);let total=0;
      for(let offset=0;offset<distance;offset++){const a=route[(from+offset)%segments],b=route[(from+offset+1)%segments],speeds=[a,b].filter(cell=>this.roads.has(cell)).map(cell=>this.roadType(cell).speed);total+=1/(Math.min(...speeds)*BUS_SPEED_MULTIPLIER);}
      return total;
    }
    busStopDwellEstimate(line,position) {
      const route=this.busOperatingRoute(line),cell=route[position];
      if(!line.stops.has(cell))return 0;
      const homeWaiting=this.homes.reduce((sum,home,index)=>sum+(this.neighbors(home.cell).includes(cell)?this.queues[index]||0:0),0);
      const transferWaiting=(this.transferQueues?.get(cell)||[]).filter(passenger=>passenger.legs?.[passenger.legIndex]?.lineId===line.id).length;
      return Math.min(BUS_CAPACITY,homeWaiting+transferWaiting)/BUS_BOARDING_RATE;
    }
    busDynamicRideTime(line,from,to,self=null,fullCycle=false) {
      const route=this.busOperatingRoute(line),segments=route.length-1,distance=fullCycle?segments:this.busForwardSegments(line,from,to);let total=0;
      for(let offset=0;offset<distance;offset++){
        const position=(from+offset)%segments,a=route[position],b=route[(position+1)%segments],speeds=[a,b].filter(cell=>this.roads.has(cell)).map(cell=>this.roadType(cell).speed);
        const free=1/(Math.min(...speeds)*BUS_SPEED_MULTIPLIER),roadBase=this.roadTravelCost(a,b),dynamic=this.dynamicRoadTravelCost(a,b,self);
        total+=free+Math.max(0,dynamic-roadBase)/BUS_SPEED_MULTIPLIER;
        const arrival=(position+1)%segments;if(offset<distance-1&&line.stops.has(route[arrival]))total+=this.busStopDwellEstimate(line,arrival);
      }
      return total;
    }
    busHasSpaceAt(bus,line,boardPosition) {
      if(bus.passengers.length<BUS_CAPACITY)return true;
      const boardDistance=this.busForwardSegments(line,bus.routePosition,boardPosition)||this.busOperatingRoute(line).length-1;
      return bus.passengers.some(passenger=>{const leg=passenger.legs?.[passenger.legIndex];if(!leg||leg.lineId!==line.id)return false;const alightDistance=this.busForwardSegments(line,bus.routePosition,leg.alightPosition);return alightDistance<=boardDistance;});
    }
    busArrivalEstimate(line,position,notBefore=0) {
      const route=this.busOperatingRoute(line),segments=route.length-1,cycle=Math.max(.001,this.busDynamicRideTime(line,0,0,null,true));let best=Infinity;
      for(const bus of this.buses.filter(item=>item.lineId===line.id)){
        let eta;
        if(!bus.active)eta=Math.max(0,bus.launchAt-this.elapsed)+this.busDynamicRideTime(line,0,position,bus);
        else if(bus.routePosition===position&&bus.needsStop)eta=0;
        else if(bus.routePosition===position)eta=(bus.dwell||0)+cycle;
        else {
          eta=(bus.dwell||0)+this.busDynamicRideTime(line,bus.routePosition,position,bus);
          if(bus.next!==null&&bus.advancingRoute!==false)eta=Math.max(0,eta-(bus.progress||0)*this.busDynamicRideTime(line,bus.routePosition,(bus.routePosition+1)%segments,bus));
          if(!eta)eta=cycle;
        }
        if(!this.busHasSpaceAt(bus,line,position))eta+=cycle;
        if(eta<notBefore)eta+=Math.ceil((notBefore-eta)/cycle)*cycle;
        best=Math.min(best,eta);
      }
      return Number.isFinite(best)?best:line.headway/2;
    }
    busDynamicItinerary(candidate) {
      let elapsed=0;
      for(const leg of candidate.legs){const line=this.busLine(leg.lineId),arrival=this.busArrivalEstimate(line,leg.boardPosition,elapsed);elapsed=arrival+this.busDynamicRideTime(line,leg.boardPosition,leg.alightPosition);}
      return {...candidate,expectedTime:elapsed,staticExpectedTime:candidate.expectedTime};
    }
    busCandidateKey(candidate) { return `${candidate.goalIndex}|${candidate.legs.map(leg=>`${leg.lineId}:${leg.boardPosition}:${leg.alightPosition}`).join('|')}`; }
    invalidateBusItineraries() { this._busItineraryCache=null;this._busItineraryChoices=null; }
    busTopologySignature() {
      const cells=new Set();
      const lines=this.busLines.map(line=>{for(const cell of line.route)cells.add(cell);return [line.id,line.count,line.returnTrip,line.returnStops,line.headway,line.route,[...line.stops].sort((a,b)=>a-b)];});
      const grades=[...cells].sort((a,b)=>a-b).map(cell=>[cell,this.roadGrades.get(cell)||0]);
      return JSON.stringify([lines,grades]);
    }
    rebuildBusItineraryCache(signature) {
      const lineData=this.busLines.filter(line=>this.busLineOperational(line)).map(line=>{
        const route=this.busOperatingRoute(line),segments=route.length-1,stopPositions=new Map(),buildingPositions=new Map(),rideTimes=new Map();
        const outboundLimit=line.route[0]===line.route[line.route.length-1]?segments:line.route.length;
        for(let position=0;position<segments;position++){
          const cell=route[position];if(!line.stops.has(cell)||position>=outboundLimit&&!line.returnStops)continue;
          const positions=stopPositions.get(cell)||[];positions.push(position);stopPositions.set(cell,positions);
          for(const building of this.neighbors(cell))if(this.buildings.has(building)){const served=buildingPositions.get(building)||[];served.push(position);buildingPositions.set(building,served);}
        }
        const rideTime=(from,to)=>{const key=`${from}:${to}`;if(rideTimes.has(key))return rideTimes.get(key);const value=this.busRideTime(line,from,to);rideTimes.set(key,value);return value;};
        return {line,route,segments,stopPositions,buildingPositions,rideTime};
      });
      const transfers=new Map();
      for(const first of lineData)for(const second of lineData)if(first!==second){
        const options=[];for(const [cell,firstPositions] of first.stopPositions){const secondPositions=second.stopPositions.get(cell);if(secondPositions)options.push({cell,firstPositions,secondPositions});}
        transfers.set(`${first.line.id}:${second.line.id}`,options);
      }
      const candidatesByHome=this.homes.map(home=>{
        const candidates=[],goals=this.goals.map((goal,index)=>({goal,index})).filter(item=>item.goal.route===home.route);
        const add=(goal,legs,expectedTime)=>candidates.push({goalIndex:goal.index,legs,expectedTime,transferCell:legs.length>1?legs[0].alightCell:null});
        for(const first of lineData)for(const boardPosition of first.buildingPositions.get(home.cell)||[]){
          for(const goal of goals)for(const alightPosition of first.buildingPositions.get(goal.goal.cell)||[]){
            const distance=(alightPosition-boardPosition+first.segments)%first.segments;if(distance)add(goal,[{lineId:first.line.id,boardPosition,boardCell:first.route[boardPosition],alightPosition,alightCell:first.route[alightPosition]}],first.line.headway/2+first.rideTime(boardPosition,alightPosition));
          }
          for(const second of lineData)if(second!==first)for(const transfer of transfers.get(`${first.line.id}:${second.line.id}`))for(const transferPosition of transfer.firstPositions){
            const firstDistance=(transferPosition-boardPosition+first.segments)%first.segments;if(!firstDistance)continue;
            for(const secondBoard of transfer.secondPositions)for(const goal of goals)for(const alightPosition of second.buildingPositions.get(goal.goal.cell)||[]){
              const secondDistance=(alightPosition-secondBoard+second.segments)%second.segments;if(!secondDistance)continue;
              add(goal,[{lineId:first.line.id,boardPosition,boardCell:first.route[boardPosition],alightPosition:transferPosition,alightCell:transfer.cell},{lineId:second.line.id,boardPosition:secondBoard,boardCell:transfer.cell,alightPosition,alightCell:second.route[alightPosition]}],first.line.headway/2+first.rideTime(boardPosition,transferPosition)+second.line.headway/2+second.rideTime(secondBoard,alightPosition));
            }
          }
        }
        return candidates.sort((a,b)=>a.expectedTime-b.expectedTime||a.legs.length-b.legs.length||a.goalIndex-b.goalIndex||a.legs.map(leg=>`${leg.lineId}:${leg.boardPosition}:${leg.alightPosition}`).join('|').localeCompare(b.legs.map(leg=>`${leg.lineId}:${leg.boardPosition}:${leg.alightPosition}`).join('|')));
      });
      return this._busItineraryCache={signature,candidatesByHome};
    }
    busItineraryFor(homeIndex,goalIndex=null) {
      if(!this.homes[homeIndex])return null;
      const signature=this.busTopologySignature(),cache=this._busItineraryCache?.signature===signature?this._busItineraryCache:this.rebuildBusItineraryCache(signature);
      const available=cache.candidatesByHome[homeIndex].filter(item=>(goalIndex===null||item.goalIndex===goalIndex)&&(this.goals[item.goalIndex].input==null||this.goalAssigned[item.goalIndex]<this.goals[item.goalIndex].input));
      let candidate=available[0];
      if(candidate&&['running','paused'].includes(this.state)){
        const ranked=available.map(item=>this.busDynamicItinerary(item)).sort((a,b)=>a.expectedTime-b.expectedTime||this.busCandidateKey(a).localeCompare(this.busCandidateKey(b)));
        this._busItineraryChoices||=new Map();const choiceKey=`${homeIndex}:${goalIndex??'*'}`,previousKey=this._busItineraryChoices.get(choiceKey),previous=ranked.find(item=>this.busCandidateKey(item)===previousKey);
        candidate=previous&&ranked[0].expectedTime>previous.expectedTime*.82?previous:ranked[0];
        this._busItineraryChoices.set(choiceKey,this.busCandidateKey(candidate));
      }
      return candidate?{...candidate,legs:candidate.legs.map(leg=>({...leg}))}:null;
    }
    busCanReach(homeCell,goalCell) { const homeIndex=this.homes.findIndex(home=>home.cell===homeCell),goalIndex=this.goals.findIndex(goal=>goal.cell===goalCell);return homeIndex>=0&&goalIndex>=0&&Boolean(this.busItineraryFor(homeIndex,goalIndex)); }
    // Compatibility aliases keep older integrations focused on the selected line.
    get busRoute() { return this.activeBusLine?.route || []; }
    get busCount() { return this.activeBusLine?.count || 1; }
    createBusLine(name, color) {
      if (this.state !== 'planning') return ['won','lost'].includes(this.state) ? '本局已结束' : '运营期间不能修改规划，请先停止运营';
      if (!this.level.features.bus) return '公交线路在本关未开放';
      if (this.busLines.length >= this.busLineLimit) return `本关最多可规划 ${this.busLineLimit} 条公交线路`;
      const number = this.busLines.length + 1, lineName = name === undefined ? `公交 ${number} 号线` : typeof name === 'string' ? name.trim() : '';
      const lineColor = color === undefined ? BUS_LINE_COLORS[(number - 1) % BUS_LINE_COLORS.length] : color;
      if (!lineName || lineName.length > 20) return '线路名称须为 1 至 20 个字符';
      if (typeof lineColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(lineColor)) return '线路颜色无效';
      const id = `line-${this.nextBusLineId++}`;
      this.busLines.push({ id, name: lineName, color: lineColor.toLowerCase(), route: [], count: 1, stops: new Set(), returnTrip: false, returnStops: false, headway: 4, stats: null });
      this.invalidateBusItineraries();
      this.activeBusLineId = id;
      return '';
    }
    ensureBusLine() {
      if (this.activeBusLine) return '';
      return this.createBusLine();
    }
    selectBusLine(lineId) {
      if (!this.busLine(lineId)) return '公交线路不存在';
      this.activeBusLineId = lineId;
      return '';
    }
    updateBusLine(lineId, settings) {
      if (this.state !== 'planning') return ['won','lost'].includes(this.state) ? '本局已结束' : '运营期间不能修改规划，请先停止运营';
      const line = this.busLine(lineId);
      if (!line || !settings || typeof settings !== 'object') return '公交线路不存在';
      const candidate = { name: line.name, color: line.color, returnTrip: line.returnTrip, returnStops: line.returnStops, headway: line.headway };
      if (settings.name !== undefined) {
        const name = typeof settings.name === 'string' ? settings.name.trim() : '';
        if (!name || name.length > 20) return '线路名称须为 1 至 20 个字符';
        candidate.name = name;
      }
      if (settings.color !== undefined) {
        if (typeof settings.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(settings.color)) return '线路颜色无效';
        candidate.color = settings.color.toLowerCase();
      }
      if (settings.returnTrip !== undefined) {
        if (typeof settings.returnTrip !== 'boolean') return '原路返回设置无效';
        if (settings.returnTrip && line.route.length >= 3 && line.route[0] === line.route[line.route.length - 1]) return '线路已经闭环，无需开启原路返回';
        candidate.returnTrip = settings.returnTrip;
        if (!settings.returnTrip) candidate.returnStops = false;
      }
      if (settings.returnStops !== undefined) {
        if (typeof settings.returnStops !== 'boolean' || settings.returnStops && !(settings.returnTrip ?? line.returnTrip)) return '返程停站只能用于原路返回线路';
        candidate.returnStops = settings.returnStops;
      }
      if (settings.headway !== undefined) {
        if (![2,4,6,8].includes(settings.headway)) return '发车间隔须为 2、4、6 或 8 秒';
        candidate.headway = settings.headway;
      }
      const topologyChanged=['returnTrip','returnStops','headway'].some(key=>candidate[key]!==line[key]);
      Object.assign(line, candidate);
      if(topologyChanged)this.invalidateBusItineraries();
      return '';
    }
    deleteBusLine(lineId = this.activeBusLineId) {
      if (this.state !== 'planning') return ['won','lost'].includes(this.state) ? '本局已结束' : '运营期间不能修改规划，请先停止运营';
      const index = this.busLines.findIndex(line => line.id === lineId);
      if (index < 0) return '公交线路不存在';
      this.busLines.splice(index, 1);
      this.invalidateBusItineraries();
      this.activeBusLineId = this.busLines[index]?.id || this.busLines[index - 1]?.id || null;
      return '';
    }
    setBusRoute(path, lineId = this.activeBusLineId) {
      if (this.state !== 'planning') return ['won','lost'].includes(this.state) ? '本局已结束' : '运营期间不能修改规划，请先停止运营';
      if (!this.level.features.bus) return '公交线路在本关未开放';
      if (!Array.isArray(path)) return '公交线路无效';
      if (!lineId) { const message = this.ensureBusLine(); if (message) return message; lineId = this.activeBusLineId; }
      const line = this.busLine(lineId);
      if (!line) return '公交线路不存在';
      if (!path.length) { line.route = []; line.stops.clear(); this.invalidateBusItineraries(); return ''; }
      if (path.length < 2) return '公交线路每段至少需要经过两格道路';
      if (path.some(n => !Number.isInteger(n) || !this.roads.has(n))) return '公交线路只能经过已有道路';
      for (let i = 1; i < path.length; i++) if (!this.edges.get(path[i - 1])?.has(path[i])) return '公交线路必须沿已经连通的道路绘制';
      if (!line.route.length && this.remaining < line.count * BUS_COST) return `公交车辆需要 ${line.count * BUS_COST} 点预算`;
      line.route = [...path];
      if (line.route.length >= 3 && line.route[0] === line.route[line.route.length - 1]) line.returnTrip = false;
      line.stops = new Set(this.busRouteCells(line).filter(cell => this.neighbors(cell).some(n => this.buildings.has(n))));
      this.invalidateBusItineraries();
      return '';
    }
    appendBusRoute(path, lineId = this.activeBusLineId) {
      if (this.state !== 'planning') return ['won','lost'].includes(this.state) ? '本局已结束' : '运营期间不能修改规划，请先停止运营';
      if (!this.level.features.bus) return '公交线路在本关未开放';
      if (!Array.isArray(path) || path.length < 2) return '本段公交线路至少需要经过两格道路';
      const line = this.busLine(lineId);
      if (!line?.route.length) return this.setBusRoute(path, lineId);
      if (line.route[0] === line.route[line.route.length - 1]) return '线路已经闭环；如需修改，请先反向擦除尾段';
      if (path[0] !== line.route[line.route.length - 1]) return '请从当前线路末端继续绘制';
      const previousStops = new Set(line.stops), previousCells = new Set(this.busRouteCells(line));
      const message = this.setBusRoute([...line.route, ...path.slice(1)], lineId);
      if (message) return message;
      for (const cell of previousCells) if (!previousStops.has(cell)) line.stops.delete(cell);
      return '';
    }
    trimBusRoute(path, lineId = this.activeBusLineId) {
      if (this.state !== 'planning') return ['won','lost'].includes(this.state) ? '本局已结束' : '运营期间不能修改规划，请先停止运营';
      if (!this.level.features.bus) return '公交线路在本关未开放';
      if (!Array.isArray(path) || path.length < 2) return '请从线路末端反向擦除至少一段';
      const line = this.busLine(lineId);
      if (!line?.route.length) return '当前线路尚未绘制';
      const reversed = line.route.slice().reverse();
      if (path.some((cell, index) => cell !== reversed[index])) return '只能从线路末端沿原路径反向擦除';
      const previousStops = new Set(line.stops), remaining = line.route.slice(0, line.route.length - path.length + 1);
      const message = this.setBusRoute(remaining.length >= 2 ? remaining : [], lineId);
      if (message) return message;
      for (const cell of this.busRouteCells(line)) if (!previousStops.has(cell)) line.stops.delete(cell);
      return '';
    }
    setBusCount(count, lineId = this.activeBusLineId) {
      if (this.state !== 'planning') return ['won','lost'].includes(this.state) ? '本局已结束' : '运营期间不能修改规划，请先停止运营';
      if (!this.level.features.bus) return '公交线路在本关未开放';
      if (!Number.isInteger(count) || count < 1 || count > 3) return '每条线路可配置 1 至 3 辆公交车';
      if (!lineId) { const message = this.ensureBusLine(); if (message) return message; lineId = this.activeBusLineId; }
      const line = this.busLine(lineId);
      if (!line) return '公交线路不存在';
      if (line.route.length && this.remaining < (count - line.count) * BUS_COST) return `增加公交车辆需要 ${(count - line.count) * BUS_COST} 点预算`;
      if(line.count!==count){line.count=count;this.invalidateBusItineraries();}
      return '';
    }
    busStopPositions(buildingCell, lineId = this.activeBusLineId) {
      const line = this.busLine(lineId);
      if (!line || !this.buildings.has(buildingCell)) return [];
      const positions = [];
      const limit = line.route[0] === line.route[line.route.length - 1] ? line.route.length - 1 : line.route.length;
      for (let i = 0; i < limit; i++) if (line.stops.has(line.route[i]) && this.neighbors(buildingCell).includes(line.route[i])) positions.push(i);
      return positions;
    }
    linesAtCell(cell) { return this.busLines.filter(line => this.busRouteCells(line).includes(cell)); }
    linesServingBuilding(cell) { return this.busLines.filter(line => this.busServicePositions(cell, line.id).length); }
    transferPassengers() { return [...(this.transferQueues?.values()||[])].flat(); }
    transferReport() { const waiting=this.transferPassengers().length,times=this.transferWaitTimes||[];return { transfers:this.transferCount||0,waiting,maxWaiting:this.maxTransferWaiting||0,averageWait:times.length?times.reduce((sum,value)=>sum+value,0)/times.length:0 }; }
    resetBusStats() {
      this.transferQueues=new Map();this.transferCount=0;this.transferWaitTimes=[];this.maxTransferWaiting=0;this._busItineraryChoices=new Map();
      for (const line of this.busLines) line.stats = { boarded: 0, alighted: 0, transfersIn:0, transfersOut:0, rejectedFull: 0, passengerSeconds: 0, vehicleSeconds: 0, cycles: 0, stops: {} };
    }
    busStopDemand(cell, lineId = this.activeBusLineId) {
      const line = this.busLine(lineId);if(!line?.stops.has(cell))return 0;
      const homes=this.homes.reduce((sum,home,index)=>{const itinerary=this.busItineraryFor(index),leg=itinerary?.legs[0];return sum+(leg?.lineId===lineId&&leg.boardCell===cell?this.queues[index]:0);},0);
      return homes+(this.transferQueues?.get(cell)||[]).filter(passenger=>{const leg=passenger.legs?.[passenger.legIndex];return leg?.lineId===lineId&&leg.boardCell===cell;}).length;
    }
    busStopForecast(cell,lineId=this.activeBusLineId) { return this.homes.reduce((sum,home,index)=>{const leg=this.busItineraryFor(index)?.legs[0];return sum+(leg?.lineId===lineId&&leg.boardCell===cell?home.passengers:0);},0); }
    busReports() {
      return this.busLines.map(line=>{
        const stats=line.stats||{boarded:0,alighted:0,transfersIn:0,transfersOut:0,rejectedFull:0,passengerSeconds:0,vehicleSeconds:0,cycles:0,stops:{}};
        return { id:line.id,name:line.name,boarded:stats.boarded,alighted:stats.alighted,transfersIn:stats.transfersIn||0,transfersOut:stats.transfersOut||0,rejectedFull:stats.rejectedFull,cycles:stats.cycles,
          averageLoad:stats.vehicleSeconds?stats.passengerSeconds/stats.vehicleSeconds:0,averageLoadRate:stats.vehicleSeconds?stats.passengerSeconds/(stats.vehicleSeconds*BUS_CAPACITY):0,stops:stats.stops };
      });
    }
    isBusStop(cell, lineId = this.activeBusLineId) { return Boolean(this.busLine(lineId)?.stops.has(cell)); }
    canSetBusStop(cell, lineId = this.activeBusLineId) { return this.busRouteCells(this.busLine(lineId)).includes(cell); }
    setBusStop(cell, enabled, lineId = this.activeBusLineId) {
      if (this.state !== 'planning') return ['won','lost'].includes(this.state) ? '本局已结束' : '运营期间不能修改规划，请先停止运营';
      const line = this.busLine(lineId);
      if (!this.level.features.bus || !line?.route.length) return '请先规划公交线路';
      if (!this.canSetBusStop(cell, lineId) || typeof enabled !== 'boolean') return '公交站只能设置在线路经过的道路格';
      if (line.stops.has(cell)===enabled) return '';
      if (enabled) line.stops.add(cell); else line.stops.delete(cell);
      this.invalidateBusItineraries();
      return '';
    }
    busGoalFor(home, routePosition, lineId) {
      const line = this.busLine(lineId), segments = this.busOperatingRoute(line).length - 1;
      let selected = null, distance = Infinity;
      for (let gi = 0; gi < this.goals.length; gi++) {
        const goal = this.goals[gi];
        if (goal.route !== home.route || goal.input != null && this.goalAssigned[gi] >= goal.input) continue;
        for (const position of this.busServicePositions(goal.cell, lineId)) {
          const forward = (position - routePosition + segments) % segments || segments;
          if (forward > 0 && forward < distance) { selected = gi; distance = forward; }
        }
      }
      return selected;
    }
    finishBusPassenger(passenger) {
      const goal = this.goals[passenger.goalIndex];
      this.delivered++;
      this.byRoute[passenger.route]++;
      this.byGoal[passenger.goalIndex]++;
      const commuteTime = Math.max(0, this.elapsed - passenger.commuteStarted);
      this.commuteTimes.push(commuteTime);
      this.arrivals.push({ route: passenger.route, goal: goal.cell, goalIndex: passenger.goalIndex, time: this.elapsed, commuteTime, vehicle: 'bus' });
    }
    serviceBusStop(bus) {
      const line = this.busLine(bus.lineId), route = this.busOperatingRoute(line), outboundLimit = line?.route[0] === line?.route[line.route.length - 1] ? route.length - 1 : line?.route.length;
      let moved = 0;this.transferQueues||=new Map();this.transferWaitTimes||=[];
      if (!line?.stops.has(bus.cell) || bus.routePosition >= outboundLimit && !line.returnStops) { bus.needsStop = false; return; }
      const stats=line.stats||(line.stats={boarded:0,alighted:0,transfersIn:0,transfersOut:0,rejectedFull:0,passengerSeconds:0,vehicleSeconds:0,cycles:0,stops:{}}),stopStats=stats.stops[bus.cell]||(stats.stops[bus.cell]={boarded:0,alighted:0,transfersIn:0,transfersOut:0,maxWaiting:0});
      stopStats.maxWaiting=Math.max(stopStats.maxWaiting,this.busStopDemand(bus.cell,line.id));
      const leaving = bus.passengers.filter(passenger=>passenger.legs?passenger.legs[passenger.legIndex]?.lineId===bus.lineId&&passenger.legs[passenger.legIndex].alightCell===bus.cell:this.neighbors(passenger.goal).includes(bus.cell));
      if (leaving.length) {
        bus.passengers = bus.passengers.filter(passenger => !leaving.includes(passenger));
        for (const passenger of leaving) {
          if(passenger.legs&&passenger.legIndex<passenger.legs.length-1){passenger.legIndex++;passenger.transferQueuedAt=this.elapsed;const waiting=this.transferQueues.get(bus.cell)||[];waiting.push(passenger);this.transferQueues.set(bus.cell,waiting);this.maxTransferWaiting=Math.max(this.maxTransferWaiting||0,this.transferPassengers().length);stats.transfersOut++;stopStats.transfersOut++;}
          else this.finishBusPassenger(passenger);
        }
        moved += leaving.length;stats.alighted+=leaving.length;stopStats.alighted+=leaving.length;
      }
      const transfers=this.transferQueues.get(bus.cell)||[];
      for(let index=0;index<transfers.length&&bus.passengers.length<BUS_CAPACITY;){const passenger=transfers[index],leg=passenger.legs?.[passenger.legIndex];if(leg?.lineId!==bus.lineId||leg.boardPosition!==bus.routePosition){index++;continue;}transfers.splice(index,1);const wait=Math.max(0,this.elapsed-(passenger.transferQueuedAt??this.elapsed));delete passenger.transferQueuedAt;this.transferCount++;this.transferWaitTimes.push(wait);bus.passengers.push(passenger);moved++;stats.boarded++;stats.transfersIn++;stopStats.boarded++;stopStats.transfersIn++;}
      if(!transfers.length)this.transferQueues.delete(bus.cell);
      for (let hi = 0; hi < this.homes.length && bus.passengers.length < BUS_CAPACITY; hi++) {
        const home = this.homes[hi];
        if (!this.neighbors(home.cell).includes(bus.cell)) continue;
        while (bus.passengers.length < BUS_CAPACITY && this.queues[hi] > 0) {
          const itinerary=this.busItineraryFor(hi),leg=itinerary?.legs[0];
          if (!itinerary||leg.lineId!==bus.lineId||leg.boardPosition!==bus.routePosition) break;
          this.queues[hi]--;
          const commuteStarted = this.queueTimes[hi]?.shift() ?? this.elapsed,goalIndex=itinerary.goalIndex;
          this.goalAssigned[goalIndex]++;
          this.departedByHome[hi]++;
          bus.passengers.push({ route: home.route, homeIndex: hi, goal: this.goals[goalIndex].cell, goalIndex, commuteStarted, legs:itinerary.legs, legIndex:0 });
          moved++;stats.boarded++;stopStats.boarded++;
        }
      }
      if(bus.passengers.length>=BUS_CAPACITY)stats.rejectedFull+=this.busStopDemand(bus.cell,line.id);
      bus.dwell = moved / BUS_BOARDING_RATE;
      bus.needsStop = false;
    }
    spawnBuses() {
      this.buses = [];this.resetBusStats();
      for (const line of this.busLines) {
        if (!this.busLineOperational(line)) continue;
        const route = this.busOperatingRoute(line);
        if (route.length < 3) continue;
        for (let i = 0; i < line.count; i++) {
          const cell = route[0], heading = route[1] - cell;
          this.buses.push({ id: `${line.id}-bus-${i + 1}`, lineId: line.id, type: 'bus', routePosition: 0, cell, next: null, heading, cellHeading: heading, active:i===0, launchAt:i*line.headway,
            lane: 0, cellLane: 0, cellSlot: 1, progress: 0, blocked: 0, dwell: 0, needsStop: true, passengers: [] });
        }
      }
    }
    stepBus(bus, dt) {
      const line = this.busLine(bus.lineId), route = this.busOperatingRoute(line);
      if (route.length < 3) return;
      if(!bus.active){if(this.elapsed+1e-9<bus.launchAt||this.occupants(route[0],bus).length)return;bus.active=true;bus.cell=route[0];bus.routePosition=0;bus.heading=route[1]-route[0];bus.cellHeading=bus.heading;bus.needsStop=true;}
      const stats=line.stats;if(stats){stats.passengerSeconds+=bus.passengers.length*dt;stats.vehicleSeconds+=dt;}
      if (bus.needsStop) this.serviceBusStop(bus);
      if (bus.dwell > 0) { bus.dwell = Math.max(0, bus.dwell - dt); return; }
      const segments = route.length - 1;
      if (bus.next === null) {
        const nextPosition = bus.routePosition + 1, nextRoad = route[nextPosition];
        const routeAt = offset => {
          const position = nextPosition + offset;
          return position <= segments ? route[position] : route[1 + (position - segments - 1) % segments];
        };
        const heading = nextRoad - bus.cell;
        const internal = !this.signals.has(bus.cell) && bus.cellSlot === 0;
        const target = internal ? bus.cell : nextRoad;
        const slot = internal || this.signals.has(target) ? 1 : 0;
        const followingPosition = nextPosition >= segments ? 1 : nextPosition + 1;
        const exitHeading = route[followingPosition] - nextRoad;
        const junction = internal ? nextRoad : routeAt(1), junctionExit = internal ? routeAt(1) : routeAt(2);
        const turn = this.signals.has(junction) ? this.movement(junction - target, junctionExit - junction).turn : null;
        const preferred = turn ? this.turnLane(target, turn) : bus.cellLane || 0;
        const lane = this.laneFor(target, heading, bus, slot, exitHeading, preferred, turn !== null);
        if (lane < 0 || !internal && !this.canEnter(target, heading, exitHeading)) { bus.blocked += dt; return; }
        if (!internal && this.signals.has(target)) {
          const afterTarget = route[followingPosition];
          const afterExit = followingPosition >= segments ? route[1] - afterTarget : route[followingPosition + 1] - afterTarget;
          if (this.laneFor(afterTarget, exitHeading, bus, 0, afterExit) < 0) { bus.blocked += dt; return; }
        }
        bus.next = target;
        bus.nextSlot = slot;
        bus.nextMovement = this.signals.has(target) ? { ...this.movement(heading, exitHeading), exitCell: route[followingPosition] } : null;
        bus.heading = heading;
        bus.lane = lane;
        bus.blocked = 0;
        bus.advancingRoute = !internal;
        bus.distance = internal ? .5 : this.signals.has(bus.cell) || this.signals.has(target) ? .75 : .5;
      }
      const speeds = [bus.cell,bus.next].filter(n => this.roads.has(n)).map(n => this.roadType(n).speed);
      const yielding = [bus.cell,bus.next].some(n => this.signals.has(n) && !this.signals.get(n).enabled);
      bus.progress += dt * Math.min(...speeds) * BUS_SPEED_MULTIPLIER * (yielding ? .35 : 1) / (bus.distance || 1);
      if (bus.progress < 1) return;
      bus.cell = bus.next;
      bus.cellHeading = bus.heading;
      bus.cellLane = bus.lane;
      bus.cellSlot = bus.nextSlot ?? 0;
      bus.cellMovement = bus.nextMovement;
      bus.nextMovement = null;
      bus.next = null;
      bus.progress = 0;
      if (bus.advancingRoute) {
        bus.routePosition++;
        if (bus.routePosition >= segments) {bus.routePosition = 0;if(line.stats)line.stats.cycles++;}
        bus.needsStop = true;
      }
    }
    }
    const descriptors = Object.getOwnPropertyDescriptors(BusMethods.prototype);
    delete descriptors.constructor;
    Object.defineProperties(City.prototype, descriptors);
  };
});
