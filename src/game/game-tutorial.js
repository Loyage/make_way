(function (root, factory) {
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.TrafficGameTutorial=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const FIRST_LEVEL_ID='neighborhood';
  const MECHANICS=[
    {id:'grade',feature:'grade',title:'道路等级与负荷',text:'选择道路可按差价升级；“显示道路负荷”会标出接近满载和已满路段。'},
    {id:'cut',feature:'cut',title:'剪刀只断连接',text:'剪刀沿拖动路径剪断明确连接，但保留路面和等级，也不会返还预算。'},
    {id:'signals',feature:'signals',title:'路口控制开放',text:'在选择模式点三岔或十字路口，可设置自动让行、入口优先级或红绿灯阶段。'},
    {id:'bus',feature:'bus',title:'公交线工具开放',text:'切换公交线模式，沿已有且明确连通的道路分段绘制；闭环或开启原路返回后才能发车。'}
  ];
  function firstStep(state){
    if(state.levelId!==FIRST_LEVEL_ID||state.started)return null;
    if(!state.usedRoad)return{id:'tool',number:1,total:4,title:'先切换拖拽模式',text:'点击“拖拽”或按 3。拖拽会预览整段施工，松手时才统一应用。',action:'road',actionLabel:'定位拖拽工具'};
    if(!state.connected)return{id:'connect',number:2,total:4,title:'连接同色建筑',text:'从住宅按住并拖到同色目的地。道路必须沿拖动方向明确连接，相邻路面不会自动连通。',action:'map',actionLabel:'前往地图'};
    if(!state.inspected)return{id:'inspect',number:3,total:4,title:'检查居民路线',text:'切换选择模式，再点任意住宅；详情会显示预计目的地、路径和最低速度瓶颈。',action:'select',actionLabel:'定位选择工具'};
    return{id:'start',number:4,total:4,title:'开始第一次运营',text:'确认路线和预算后点击“开始运营”。系统会先给出可达性和容量检查。',action:'start',actionLabel:'定位开始按钮'};
  }
  function unseenMechanic(level,seen=[]){return MECHANICS.find(item=>level?.features?.[item.feature]&&!seen.includes(item.id))||null;}
  function mechanic(id){return MECHANICS.find(item=>item.id===id)||null;}
  function currentMechanic(level){return [...MECHANICS].reverse().find(item=>level?.features?.[item.feature])||null;}
  return{FIRST_LEVEL_ID,MECHANICS,firstStep,unseenMechanic,mechanic,currentMechanic};
});
