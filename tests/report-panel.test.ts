import React from "react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {ReportPanel} from "@/components/reports/report-panel";
import {reportFixture} from "./helpers/report-fixture";
import {summary} from "@/lib/reports/model";
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
describe("interface de relatórios com transporte simulado",()=>{
 it("não confunde falha com histórico vazio e permite recuperar a listagem",async()=>{
  const fetcher=vi.fn().mockRejectedValueOnce(new Error("Rede indisponível")).mockResolvedValueOnce(Response.json({data:[],hasMore:false}));vi.stubGlobal("fetch",fetcher);
  render(React.createElement(ReportPanel));await screen.findByRole('alert');expect(screen.queryByText("Nenhum relatório persistido disponível.")).toBeNull();
  fireEvent.click(screen.getByText("Atualizar relatórios"));await screen.findByText("Nenhum relatório persistido disponível.");expect(screen.queryByRole('alert')).toBeNull();
 });
 it("descarta resposta atrasada ao trocar a avaliação",async()=>{
  let release!:(r:Response)=>void;const delayed=new Promise<Response>(r=>release=r);
  vi.stubGlobal('fetch',vi.fn().mockReturnValueOnce(delayed).mockResolvedValueOnce(Response.json({data:[],hasMore:false})));
  const view=render(React.createElement(ReportPanel,{assessmentId:reportFixture.assessment_id}));
  view.rerender(React.createElement(ReportPanel,{assessmentId:'40000000-0000-4000-8000-000000000002'}));
  await screen.findByText('Nenhum relatório persistido disponível.');
  await act(async()=>release(Response.json({data:[{...summary(reportFixture),patientName:'Paciente anterior sintético'}],hasMore:false})));
  expect(screen.queryByText('Paciente anterior sintético')).toBeNull();
 });
 it("listagem antiga não apaga relatório confirmado durante a geração",async()=>{
  let release!:(r:Response)=>void;const delayed=new Promise<Response>(r=>release=r);let reads=0;
  const row={...summary(reportFixture),status:'ready'};
  vi.stubGlobal('fetch',vi.fn(async(_url:unknown,init?:RequestInit)=>{
   if(init?.method)return Response.json({data:row});
   if(++reads===1)return delayed;return Response.json({data:[row],hasMore:false});
  }));
  render(React.createElement(ReportPanel,{assessmentId:reportFixture.assessment_id}));
  fireEvent.click(screen.getByText('Gerar e salvar relatório'));await screen.findByText('Baixar PDF seguro');
  await act(async()=>release(Response.json({data:[],hasMore:false})));
  expect(screen.getByText('Baixar PDF seguro')).toBeTruthy();
 });
 it("lista histórico e retoma o snapshot existente",async()=>{const row={...summary(reportFixture),canResume:true};const requests:RequestInit[]=[];
  vi.stubGlobal("fetch",vi.fn(async(_url:unknown,init?:RequestInit)=>{if(init?.method){requests.push(init);row.status="ready";return Response.json({data:row})}return Response.json({data:[row],hasMore:false})}));
  render(React.createElement(ReportPanel,{assessmentId:row.assessmentId}));await screen.findByText("Retomar preparação");fireEvent.click(screen.getByText("Retomar preparação"));await screen.findByText("Baixar PDF seguro");
  expect(JSON.parse(requests[0].body as string)).toEqual({assessmentId:row.assessmentId,resumeReportId:row.id});expect(screen.getByText(/Relatório salvo e verificado/)).toBeTruthy();
 });
 it("não anuncia sucesso para recibo pendente e permite repetir",async()=>{
  vi.stubGlobal("fetch",vi.fn(async(_u:unknown,i?:RequestInit)=>Response.json(i?.method?{data:summary(reportFixture)}:{data:[],hasMore:false})));
  render(React.createElement(ReportPanel,{assessmentId:reportFixture.assessment_id}));await screen.findByText("Nenhum relatório persistido disponível.");fireEvent.click(screen.getByText("Gerar e salvar relatório"));await screen.findByText("Relatório sem confirmação de conclusão.");expect((screen.getByText("Gerar e salvar relatório") as HTMLButtonElement).disabled).toBe(false);
 });
 it("duplo clique dispara um único pedido",async()=>{let release!:(r:Response)=>void;const waiting=new Promise<Response>(r=>release=r);let posts=0;
  vi.stubGlobal("fetch",vi.fn(async(_u:unknown,i?:RequestInit)=>{if(i?.method){posts++;return waiting}return Response.json({data:[],hasMore:false})}));
  render(React.createElement(ReportPanel,{assessmentId:reportFixture.assessment_id}));await screen.findByText("Nenhum relatório persistido disponível.");const button=screen.getByText("Gerar e salvar relatório");fireEvent.click(button);fireEvent.click(button);expect(posts).toBe(1);release(Response.json({error:"Upload indisponível"},{status:503}));await screen.findByText("Upload indisponível");
 });
 it("erro de download é exibido, sem expor URL pública",async()=>{const urls:string[]=[];
  vi.stubGlobal("fetch",vi.fn(async(url:string)=>{urls.push(url);return url.includes("/download")?Response.json({error:"Arquivo indisponível"},{status:404}):Response.json({data:[{...summary(reportFixture),status:"ready"}],hasMore:false})}));
  render(React.createElement(ReportPanel));await screen.findByText("Baixar PDF seguro");fireEvent.click(screen.getByText("Baixar PDF seguro"));await screen.findByText("Arquivo indisponível");expect(urls.at(-1)).toBe(`/api/reports/${reportFixture.id}/download`);
 });
 it("pendência de outro gerador não oferece retomada indevida",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({data:[{...summary(reportFixture),canResume:false}],hasMore:false})));render(React.createElement(ReportPanel));await screen.findByText("Preparação pelo profissional gerador");expect(screen.queryByText("Retomar preparação")).toBeNull();
 });
 it("falha de listagem mantém mensagem explícita",async()=>{vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new Error("Rede indisponível")));render(React.createElement(ReportPanel));await waitFor(()=>expect(screen.getByText("Rede indisponível")).toBeTruthy())});
});
