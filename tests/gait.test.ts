import { describe,it,expect } from "vitest"; import { calculateGaitMetrics,estimateStepsFromHeelPeaks } from "@/lib/gait";
describe("métricas de marcha",()=>{it("calcula cadência e velocidade somente com dados válidos",()=>{expect(calculateGaitMetrics({durationSeconds:10,stepCount:20,distanceMeters:10})).toEqual({analysisDurationSeconds:10,cadenceSpm:120,speedMps:1});});it("não inventa métricas quando falta duração",()=>expect(calculateGaitMetrics({distanceMeters:10}).speedMps).toBeNull());it("conta picos sintéticos",()=>expect(estimateStepsFromHeelPeaks([0, .8,.1,.9,.2])).toBe(2));});

it.each([NaN,Infinity,-Infinity,0,-1])("não cria velocidade com duração inválida %s",durationSeconds=>{expect(calculateGaitMetrics({durationSeconds,distanceMeters:10,stepCount:10}).speedMps).toBeNull();});
it.each([NaN,Infinity,-Infinity,0,-1])("não cria velocidade com distância inválida %s",distanceMeters=>{expect(calculateGaitMetrics({durationSeconds:10,distanceMeters}).speedMps).toBeNull();});
