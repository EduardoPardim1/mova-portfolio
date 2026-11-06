import {describe,it,expect} from 'vitest';
import {cycleMaxima,analyseSagittalCycles} from '@/lib/experimental/gait-sagittal-cycles';
import type {PoseSample} from '@/lib/pose-analysis';
const walking=():PoseSample[]=>Array.from({length:181},(_,i)=>{const t=i/30,hip=.1+t*.05;return {timeMs:t*1000,hipCenterX:hip,leftAnkleX:hip+.12*Math.cos(2*Math.PI*t),rightAnkleX:hip-.12*Math.cos(2*Math.PI*t),leftAnkleY:.8,rightAnkleY:.8,visibility:.95};});
describe('ciclos sagitais - contrato independente de vídeo',()=>{
 it('consolida platô, mede proeminência bilateral e não promove ondulação',()=>{expect(cycleMaxima([0,100,200,300,400,500,600],[0,2,2,2,1.8,2,0],1)).toEqual([{timeMs:200,prominence:2,value:2}]);});
 it('produz alternância com cadência temporal conhecida',()=>{const r=analyseSagittalCycles(walking(),'lateral');expect(r.eligible).toBe(true);expect(r.events.length).toBeGreaterThan(8);expect(r.cadenceSpm).toBeCloseTo(120);});
 it('é invariante à reflexão espacial, sem trocar anatomia',()=>{const s=walking();expect(analyseSagittalCycles(s.map(p=>({...p,hipCenterX:1-p.hipCenterX!,leftAnkleX:1-p.leftAnkleX!,rightAnkleX:1-p.rightAnkleX!})),'lateral').events.map(e=>[e.timeMs,e.side])).toEqual(analyseSagittalCycles(s,'lateral').events.map(e=>[e.timeMs,e.side]));});
 it('recusa vista, timestamps e amostragem inadequados',()=>{expect(analyseSagittalCycles(walking()).eligible).toBe(false);const s=walking();expect(analyseSagittalCycles([...s,s[0]],'lateral').reason).toBe('invalid_timestamps');expect(analyseSagittalCycles(s.filter((_,i)=>i%3===0),'lateral').eligible).toBe(false);});
 it('não interpola pose perdida nem emite cadência atravessando lacuna',()=>{const s=walking().map((p,i)=>i>80&&i<90?{...p,visibility:0}:p);expect(analyseSagittalCycles(s,'lateral').cadenceSpm).toBeNull();});
});
