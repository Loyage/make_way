(function(root,factory){
  'use strict';
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TrafficGameNavigation=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const FEATURE_LABELS={grade:'道路升级与负荷',cut:'剪断连接',inspect:'道路检查',signals:'路口控制',bus:'公交规划'};
  function levelProgress(level,started,starsByDay){
    const days=level.campaign?.days?.length||1,rows=Array.from({length:days},(_,index)=>Array.isArray(starsByDay?.[index])?starsByDay[index]:[]);
    const stars=rows.reduce((sum,row)=>sum+new Set(row).size,0),completed=rows.every(row=>row.includes('completion'));
    return{status:completed?'completed':started||stars>0?'in-progress':'not-started',stars,totalStars:days*3,completed};
  }
  function recommendedLevel(levels,progressById,recentId){
    const recent=levels.find(level=>level.id===recentId);
    if(recent&&progressById[recent.id]?.status==='in-progress')return recent;
    return levels.find(level=>!progressById[level.id]?.completed)||levels[levels.length-1]||null;
  }
  function lessonSummary(current,next){
    if(!next)return'';
    const opened=Object.keys(FEATURE_LABELS).filter(feature=>next.features?.[feature]&&!current?.features?.[feature]).map(feature=>FEATURE_LABELS[feature]);
    if(next.campaign&&!current?.campaign)opened.push('连续多日运营');
    return opened.length?`将学习：${opened.join('、')}`:`练习重点：${next.lesson}`;
  }
  function chapterProgress(chapter,progressById){
    const rows=chapter.levels.map(level=>progressById[level.id]||{stars:0,totalStars:level.campaign?.days?.length*3||3,completed:false});
    return{completed:rows.filter(row=>row.completed).length,total:rows.length,stars:rows.reduce((sum,row)=>sum+row.stars,0),totalStars:rows.reduce((sum,row)=>sum+row.totalStars,0)};
  }
  return{FEATURE_LABELS,levelProgress,recommendedLevel,lessonSummary,chapterProgress};
});
