import {it,expect} from 'vitest';
import {stabilizeFootTracks} from '@/lib/experimental/gait-foot-tracks';
it('recupera continuidade de trajetórias cruzadas após troca artificial',()=>{
 const truth=Array.from({length:20},(_,i)=>({timeMs:i*30,leftAnkleX:i*.02,rightAnkleX:.4-i*.02,leftAnkleY:.8,rightAnkleY:.7,visibility:.9}));
 const corrupted=truth.map((s,i)=>i>=8?{...s,leftAnkleX:s.rightAnkleX,rightAnkleX:s.leftAnkleX,leftAnkleY:s.rightAnkleY,rightAnkleY:s.leftAnkleY}:s);
 const r=stabilizeFootTracks(corrupted);expect(r.samples.map(s=>s.leftAnkleX)).toEqual(truth.map(s=>s.leftAnkleX));expect(r.swaps).toBe(12);expect(r.anatomicalSideValidated).toBe(false);
});
it('não muda trajetória consistente ou atravessa lacuna',()=>{
 const s=Array.from({length:10},(_,i)=>({timeMs:i*30,leftAnkleX:i*.02,rightAnkleX:.4-i*.02,leftAnkleY:.8,rightAnkleY:.7,visibility:.9}));
 expect(stabilizeFootTracks(s).swaps).toBe(0);expect(stabilizeFootTracks(s.map((x,i)=>({...x,timeMs:x.timeMs+(i>=5?1000:0)}))).segments).toBe(2);
});
