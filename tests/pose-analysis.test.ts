import { describe,it,expect } from "vitest"; import { analysePoseSamples,calculateJointAngle,calculateKneeAngles } from "@/lib/pose-analysis";
describe("análise experimental de pose",()=>{it("calcula indicadores a partir de quadros de tornozelos",()=>{const samples=Array.from({length:30},(_,i)=>({timeMs:i*300,leftAnkleY:i%4===1?.8:.3,rightAnkleY:i%4===3?.79:.31,visibility:.9,leftKneeAngle:170,rightKneeAngle:165}));const result=analysePoseSamples(samples,9,10);expect(result.estimatedSteps).toBeGreaterThan(0);expect(result.cadenceSpm).not.toBeNull();expect(result.speedMps).toBeCloseTo(10/9);expect(result.quality).toBe("adequada");expect(result.series[0].leftKneeAngle).toBe(170);});it("calcula ângulo de joelho em geometria sintética",()=>{expect(calculateJointAngle({x:0,y:0},{x:0,y:1},{x:1,y:1})).toBe(90);const points=Array.from({length:33},()=>({x:0,y:0}));points[23]={x:0,y:0};points[25]={x:0,y:1};points[27]={x:1,y:1};points[24]={x:1,y:0};points[26]={x:1,y:1};points[28]={x:2,y:1};expect(calculateKneeAngles(points)).toEqual({left:90,right:90});});it("declara dados indisponíveis sem amostras",()=>{const result=analysePoseSamples([],0);expect(result.estimatedSteps).toBeNull();expect(result.speedMps).toBeNull();expect(result.quality).toBe("insuficiente");});});
describe("qualidade e amostragem",()=>{it("inclui quadros sem pose no denominador e rebaixa a qualidade",()=>{const useful={leftAnkleY:.7,rightAnkleY:.68,visibility:.9};const samples=Array.from({length:20},(_,index)=>index<8?{timeMs:index*100,...useful}:{timeMs:index*100,leftAnkleY:null,rightAnkleY:null,visibility:0});const result=analysePoseSamples(samples,2);expect(result.totalFrames).toBe(20);expect(result.usableFrames).toBe(8);expect(result.detectionRate).toBeCloseTo(.4);expect(result.quality).toBe("insuficiente");});it("não conta um sinal plano como passos",()=>{const samples=Array.from({length:30},(_,index)=>({timeMs:index*100,leftAnkleY:.5,rightAnkleY:.5,visibility:.9}));const result=analysePoseSamples(samples,3);expect(result.estimatedSteps).toBeNull();expect(result.cadenceSpm).toBeNull();});it("deduplica eventos simultâneos entre os tornozelos",()=>{const samples=Array.from({length:40},(_,index)=>({timeMs:index*100,leftAnkleY:index%10===5?.9:.3,rightAnkleY:index%10===5?.88:.31,visibility:.9}));const result=analysePoseSamples(samples,4);expect(result.estimatedSteps).toBeNull();expect(result.events).toHaveLength(0);expect(result.events.every((event,index,events)=>index===0||event.timeSeconds-events[index-1].timeSeconds>=.18)).toBe(true);});});
describe("integridade temporal",()=>{it("não suaviza através de uma lacuna longa de detecção",()=>{const before=Array.from({length:8},(_,index)=>({timeMs:index*100,leftAnkleY:index===4?.9:.3,rightAnkleY:index===4?.88:.31,visibility:.9}));const after=Array.from({length:8},(_,index)=>({timeMs:3000+index*100,leftAnkleY:index===4?.9:.3,rightAnkleY:index===4?.88:.31,visibility:.9}));const result=analysePoseSamples([...before,...after],4);expect(result.signalDiagnostics.every(diagnostic=>diagnostic.contiguousSegments===2)).toBe(true);expect(result.gaitEstimateReliability).toBe("insuficiente");});it("marca a estimativa como insuficiente quando a pose é limitada",()=>{const samples=Array.from({length:30},(_,index)=>({timeMs:index*100,leftAnkleY:index%8===4?.9:.3,rightAnkleY:index%8===4?.88:.31,visibility:index<20?.9:.1}));const result=analysePoseSamples(samples,3);expect(result.quality).toBe("limitada");expect(result.gaitEstimateReliability).toBe("insuficiente");expect(result.estimatedSteps).toBeNull();});it("ordena timestamps fora de ordem sem produzir métrica confiável automaticamente",()=>{const samples=[{timeMs:200,leftAnkleY:.3,rightAnkleY:.3,visibility:.9},{timeMs:100,leftAnkleY:.9,rightAnkleY:.88,visibility:.9},{timeMs:300,leftAnkleY:.3,rightAnkleY:.3,visibility:.9}];const result=analysePoseSamples(samples,1);expect(result.limitations.some(item=>item.includes("Timestamps repetidos ou fora de ordem"))).toBe(true);expect(result.gaitEstimateReliability).toBe("insuficiente");});});

it("cadência usa intervalos entre eventos, não conta duas vezes a borda inicial",()=>{
 const samples=Array.from({length:60},(_,i)=>({timeMs:i*100,leftAnkleY:i%10===5?.9:.3,rightAnkleY:i%10===0?.88:.31,visibility:.9}));
 const result=analysePoseSamples(samples,6);
 expect(result.events.length).toBeGreaterThanOrEqual(4);
 const span=result.events.at(-1)!.timeSeconds-result.events[0].timeSeconds;
 expect(result.cadenceSpm).toBeCloseTo(60*(result.events.length-1)/span);
 expect(result.cadenceSpm).not.toBeCloseTo(60*result.events.length/span);
 expect(result.speedMps).toBeNull();
});

it("não atribui lateralidade a colisões nem depende da ordem dos pés",()=>{
 const samples=Array.from({length:50},(_,i)=>({timeMs:i*100,leftAnkleY:i%10===5?.9:.3,rightAnkleY:i%10===5?.8:.2,visibility:.95}));
 const a=analysePoseSamples(samples,5),b=analysePoseSamples(samples.map(s=>({...s,leftAnkleY:s.rightAnkleY,rightAnkleY:s.leftAnkleY})),5);
 expect(a.events).toEqual([]);expect(b.events).toEqual([]);expect(a.cadenceSpm).toBeNull();
 expect(a.limitations.some(s=>s.includes("lateralidade ambígua"))).toBe(true);
});
it("colapsa platô em um evento central, sem contar suas duas bordas",()=>{
 const samples=Array.from({length:30},(_,i)=>({timeMs:i*100,leftAnkleY:i>=8&&i<=16?.9:.3,rightAnkleY:.3,visibility:.95}));
 const result=analysePoseSamples(samples,3);
 expect(result.events).toEqual([{side:"left",timeSeconds:1.2}]);
 expect(result.cadenceSpm).toBeNull();
});
it("não calcula cadência atravessando perda de pose ou repetição de lado",()=>{
 const samples=Array.from({length:80},(_,i)=>({timeMs:i*100,leftAnkleY:i%10===5?.9:.3,rightAnkleY:.3,visibility:.95}));
 expect(analysePoseSamples(samples,8).cadenceSpm).toBeNull();
 const alternating=samples.map((s,i)=>({...s,rightAnkleY:i%10===0?.9:.3}));
 expect(analysePoseSamples(alternating.filter(s=>s.timeMs<3000||s.timeMs>3500),8).cadenceSpm).toBeNull();
 expect(analysePoseSamples([...alternating,alternating[0]],8).cadenceSpm).toBeNull();
});
