import type {PoseSample} from '../pose-analysis';
type Side='left'|'right';
const other=(s:Side):Side=>s==='left'?'right':'left';
function point(s:PoseSample,side:Side,swap:number){const k=swap?other(side):side;return [s[k==='left'?'leftAnkleX':'rightAnkleX']!,s[k==='left'?'leftAnkleY':'rightAnkleY']!];}
function valid(s:PoseSample){return [s.leftAnkleX,s.rightAnkleX,s.leftAnkleY,s.rightAnkleY,s.visibility].every(x=>typeof x==='number'&&Number.isFinite(x))&&s.visibility>=.5;}
/** Two-state second-order path. Initial anatomical assignment remains a hypothesis, never a validated side. */
export function stabilizeFootTracks(input:PoseSample[]){
 const output=input.map(s=>({...s}));let swaps=0,segments=0;
 for(let start=0;start<input.length;){if(!valid(input[start])){start++;continue;}let end=start+1;
 while(end<input.length&&valid(input[end])&&input[end].timeMs>input[end-1].timeMs&&input[end].timeMs-input[end-1].timeMs<=100)end++;
 const g=input.slice(start,end);segments++;if(g.length<3){start=end;continue;}
 // Four states store assignments at the previous two frames. Anchor only the first frame.
 let costs=[0,0,Infinity,Infinity];const back:number[][]=[];
 for(let i=2;i<g.length;i++){
  const next=Array(4).fill(Infinity),parents=Array(4).fill(-1);
  const dt0=(g[i-1].timeMs-g[i-2].timeMs)/1000,dt1=(g[i].timeMs-g[i-1].timeMs)/1000;
  for(let a=0;a<2;a++)for(let b=0;b<2;b++)for(let c=0;c<2;c++){
   let energy=0;for(const side of ['left','right'] as const){const p0=point(g[i-2],side,a),p1=point(g[i-1],side,b),p2=point(g[i],side,c);for(let d=0;d<2;d++){const dv=(p2[d]-p1[d])/dt1-(p1[d]-p0[d])/dt0;energy+=dv*dv;}}
   const value=costs[a*2+b]+energy;if(value<next[b*2+c]){next[b*2+c]=value;parents[b*2+c]=a*2+b;}
  }costs=next;back.push(parents);
 }
 let state=costs.indexOf(Math.min(...costs));const states=Array(g.length).fill(0);
 states[g.length-1]=state%2;states[g.length-2]=Math.floor(state/2);
 for(let i=g.length-1;i>=2;i--){state=back[i-2][state];states[i-2]=Math.floor(state/2);}
 for(let i=0;i<g.length;i++)if(states[i]){swaps++;const s=g[i],t=output[start+i];
 for(const [l,r] of [['leftAnkleX','rightAnkleX'],['leftAnkleY','rightAnkleY'],['leftAnkleVisibility','rightAnkleVisibility'],['leftHeelX','rightHeelX'],['leftHeelY','rightHeelY'],['leftHeelVisibility','rightHeelVisibility'],['leftFootIndexX','rightFootIndexX'],['leftFootIndexY','rightFootIndexY']] as const){t[l]=s[r]??null;t[r]=s[l]??null;}
 }start=end;
 }
 return {samples:output,swaps,segments,anatomicalSideValidated:false as const};
}
