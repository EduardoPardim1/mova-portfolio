import React from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { VideoAnalysis } from "@/lib/pose-analysis";
const fixture=vi.hoisted(()=>({durationSeconds:2,estimatedSteps:3,cadenceSpm:90,speedMps:null,meanVisibility:0.7,usableFrames:10,totalFrames:20,detectionRate:0.5,quality:"limitada",gaitEstimateReliability:"experimental",limitations:[],stepRegularity:null,temporalSymmetry:null,events:[],signalDiagnostics:[],series:[]}));
vi.mock("@/components/analysis/video-analyzer",()=>({VideoAnalyzer:({onComplete}:{onComplete:(v:VideoAnalysis)=>void})=>React.createElement("button",{onClick:()=>onComplete(fixture as VideoAnalysis)},"Concluir análise sintética")}));
vi.mock("@/components/analysis/analysis-results",()=>({AnalysisResults:()=>React.createElement("p",null,"Resultados sintéticos")}));
import Page from "@/app/(app)/assessments/new/page";
const patient="30000000-0000-4000-8000-000000000001",id="40000000-0000-4000-8000-000000000001";
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
async function ready(){render(React.createElement(Page));await screen.findByText("Paciente Sintético");fireEvent.change(screen.getAllByRole("combobox")[0],{target:{value:patient}});fireEvent.click(screen.getByText("Concluir análise sintética"))}
describe("tela de avaliação com transporte e análise simulados",()=>{
 it("só confirma recibo válido, retém chave no retry e bloqueia segundo salvamento",async()=>{
  const requests:RequestInit[]=[];
  const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{
   if(String(_url).startsWith('/api/reports'))return Response.json({data:[],hasMore:false});
   if(!init?.method)return Response.json({data:[{id:patient,full_name:"Paciente Sintético"}]});
   requests.push(init);if(requests.length===1)return Response.json({error:"Falha sintética"},{status:500});
   return Response.json({data:{id},requestId:(init.headers as Record<string,string>)["Idempotency-Key"],replayed:true});
  });vi.stubGlobal("fetch",fetcher);await ready();
  expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('');
  fireEvent.click(screen.getByText("Salvar avaliação revisada"));await screen.findByText("Falha sintética");
  fireEvent.click(screen.getByText("Salvar avaliação revisada"));await screen.findByText("Avaliação e métricas confirmadas pelo banco e salvas com sucesso.");
  expect((screen.getByText("Avaliação salva") as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Abrir prontuário e histórico").getAttribute('href')).toBe(`/patients/${patient}`);
  expect(screen.getByText("Gerar e salvar relatório")).toBeTruthy();
  await waitFor(()=>expect(fetcher.mock.calls.some(([url])=>String(url).includes(`/api/reports?offset=0&assessmentId=${id}`))).toBe(true));
  expect(requests[0].headers).toEqual(requests[1].headers);expect(JSON.parse(requests[1].body as string)).toMatchObject({patientId:patient,estimatedSteps:3,detectionRate:0.5});
  expect(JSON.parse(requests[1].body as string)).not.toHaveProperty("series");
  expect(JSON.parse(requests[1].body as string)).not.toHaveProperty("distanceMeters");
  fireEvent.click(screen.getByText("Concluir análise sintética"));fireEvent.click(screen.getByText("Salvar avaliação revisada"));
  await waitFor(()=>expect(requests).toHaveLength(3));expect(requests[2].headers).not.toEqual(requests[1].headers);
 });
 it("HTTP 201 sem confirmação não mostra sucesso",async()=>{
  vi.stubGlobal("fetch",vi.fn(async(_u:unknown,init?:RequestInit)=>init?.method?Response.json({data:{id}},{status:201}):Response.json({data:[{id:patient,full_name:"Paciente Sintético"}]})));
  await ready();fireEvent.click(screen.getByText("Salvar avaliação revisada"));await screen.findByText(/Resposta sem confirmação válida/);
  expect(screen.queryByText("Avaliação salva")).toBeNull();expect((screen.getByText("Salvar avaliação revisada") as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByText("Gerar e salvar relatório")).toBeNull();
 });
});
