import type { PoseSample } from '../pose-analysis';
export type Contact = {timeMs:number;side:'left'|'right';prominence:number};
export const SAGITTAL_PROTOCOL=Object.freeze({version:'sagittal-cycle-v1',minimumHz:20,maximumGapMs:100,minimumVisibility:.5,minimumExcursion:.02,prominenceFraction:.2,sameSideSpacingMs:300,smoothingRadiusMs:50});
const p=SAGITTAL_PROTOCOL;
const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);
const median=(xs:number[])=>{const a=[...xs].sort((a,b)=>a-b);return a.length?a[Math.floor(a.length/2)]:0;};
/** Topographic prominence, bounded by higher peaks; never estimates anatomy from screen order. */
export function cycleMaxima(times:number[],values:number[],threshold:number){
 const peaks:{timeMs:number;prominence:number;value:number}[]=[];
 for(let i=1;i<values.length-1;i++){
  const start=i;while(i+1<values.length&&values[i+1]===values[start])i++;
  if(i===values.length-1||values[start]<=values[start-1]||values[i]<=values[i+1])continue;
  let lowLeft=values[start],lowRight=values[i];
  for(let j=start-1;j>=0&&values[j]<values[start];j--)lowLeft=Math.min(lowLeft,values[j]);
  for(let j=i+1;j<values.length&&values[j]<=values[i];j++)lowRight=Math.min(lowRight,values[j]);
  const prominence=values[start]-Math.max(lowLeft,lowRight);
  if(prominence>=threshold)peaks.push({timeMs:(times[start]+times[i])/2,prominence,value:values[start]});
 }
 // Select stronger peaks first; chronological greedy suppression favours early noise.
 const kept:typeof peaks=[];
 for(const peak of peaks.sort((a,b)=>b.prominence-a.prominence||a.timeMs-b.timeMs))if(!kept.some(k=>Math.abs(k.timeMs-peak.timeMs)<p.sameSideSpacingMs))kept.push(peak);
 return kept.sort((a,b)=>a.timeMs-b.timeMs);
}
export function analyseSagittalCycles(samples:PoseSample[],perspective:'lateral'|'unknown'='unknown'){
 const empty=(reason:string)=>({method:p.version,eligible:false,reason,events:[] as Contact[],cadenceSpm:null as number|null});
 if(perspective!=='lateral')return empty('lateral_view_required');
 if(samples.some((s,i)=>!finite(s.timeMs)||(i>0&&s.timeMs<=samples[i-1].timeMs)))return empty('invalid_timestamps');
 const intervals=samples.slice(1).map((s,i)=>s.timeMs-samples[i].timeMs);
 if(!intervals.length||1000/median(intervals)<p.minimumHz)return empty('insufficient_sampling');
 const hips=samples.filter(s=>finite(s.hipCenterX)&&s.visibility>=p.minimumVisibility);
 if(hips.length<7)return empty('missing_pose');
 const n=Math.max(1,Math.floor(hips.length/10));
 const displacement=median(hips.slice(-n).map(s=>s.hipCenterX!))-median(hips.slice(0,n).map(s=>s.hipCenterX!));
 if(Math.abs(displacement)<p.minimumExcursion)return empty('unknown_progression');
 const direction=Math.sign(displacement),events:Contact[]=[];
 let gap=false;
 for(const side of ['left','right'] as const){
  const x=side==='left'?'leftAnkleX':'rightAnkleX',q=side==='left'?'leftAnkleVisibility':'rightAnkleVisibility';
  const groups:PoseSample[][]=[];let group:PoseSample[]=[];
  for(const sample of samples){
   const valid=finite(sample[x])&&finite(sample.hipCenterX)&&finite(sample.visibility)&&Math.min(sample.visibility,sample[q]??sample.visibility)>=p.minimumVisibility;
   if(!valid||group.length&&sample.timeMs-group.at(-1)!.timeMs>p.maximumGapMs){if(group.length)groups.push(group);group=[];gap=true;}
   if(valid)group.push(sample);
  }if(group.length)groups.push(group);
  for(const g of groups){if(g.length<7)continue;
   const times=g.map(s=>s.timeMs),raw=g.map(s=>direction*(s[x]!-s.hipCenterX!));
   const smoothed=raw.map((_,i)=>Number((raw.filter((_,j)=>Math.abs(times[j]-times[i])<=p.smoothingRadiusMs).reduce((a,b)=>a+b,0)/times.filter(t=>Math.abs(t-times[i])<=p.smoothingRadiusMs).length).toFixed(10)));
   const range=Math.max(...smoothed)-Math.min(...smoothed);if(range<p.minimumExcursion)continue;
   for(const peak of cycleMaxima(times,smoothed,range*p.prominenceFraction))events.push({timeMs:peak.timeMs,side,prominence:peak.prominence});
  }
 }
 events.sort((a,b)=>a.timeMs-b.timeMs);
 const alternating=events.every((e,i)=>!i||e.side!==events[i-1].side&&e.timeMs-events[i-1].timeMs>=180);
 const cadenceSpm=!gap&&alternating&&events.length>=4?60000*(events.length-1)/(events.at(-1)!.timeMs-events[0].timeMs):null;
 return {method:p.version,eligible:true,reason:gap?'pose_gaps':!alternating?'ambiguous_sequence':null,events,cadenceSpm};
}
