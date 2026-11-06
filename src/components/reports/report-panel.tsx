"use client";
import Link from "next/link";
import { useCallback,useEffect,useRef,useState } from "react";
import type { ReportSummary } from "@/lib/reports/model";
async function body(response:Response){const result=await response.json().catch(()=>null);if(!response.ok)throw new Error(result?.error??"Operação indisponível.");return result}
export function ReportPanel({assessmentId}:{assessmentId?:string}){
 return <ScopedReportPanel key={assessmentId??"all"} assessmentId={assessmentId}/>;
}
function ScopedReportPanel({assessmentId}:{assessmentId?:string}){
 const [reports,setReports]=useState<ReportSummary[]>([]),[message,setMessage]=useState(""),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[more,setMore]=useState(false);
 const inFlight=useRef(false);
 const request=useRef(0);
 const [loadError,setLoadError]=useState("");
 const load=useCallback(async(offset=0)=>{const currentRequest=++request.current;setLoading(true);setLoadError("");try{const q=new URLSearchParams({offset:String(offset)});if(assessmentId)q.set("assessmentId",assessmentId);const result=await body(await fetch(`/api/reports?${q}`,{cache:"no-store"}));if(currentRequest!==request.current)return;if(!Array.isArray(result?.data)||typeof result?.hasMore!=="boolean")throw new Error("Resposta inválida ao carregar relatórios.");setReports(current=>offset?[...current,...result.data]:result.data);setMore(result.hasMore)}catch(error){if(currentRequest===request.current)setLoadError(error instanceof Error?error.message:"Falha ao carregar relatórios.")}finally{if(currentRequest===request.current)setLoading(false)}},[assessmentId]);
 useEffect(()=>{void load();return()=>{request.current++}},[load]);
 async function generate(resume?:ReportSummary){if(inFlight.current)return;inFlight.current=true;setBusy(true);setMessage("Gerando e verificando o PDF…");try{
  const result=await body(await fetch("/api/reports",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({assessmentId:resume?.assessmentId??assessmentId,...(resume?{resumeReportId:resume.id}:{})})}));
  if(result?.data?.status!=="ready"||!result.data.id)throw new Error("Relatório sem confirmação de conclusão.");setMessage("Relatório salvo e verificado. O snapshot histórico foi preservado.");await load();
 }catch(error){setMessage(error instanceof Error?error.message:"Falha ao gerar. Atualize a lista e retome a preparação.");await load()}finally{inFlight.current=false;setBusy(false)}}
 async function download(report:ReportSummary){if(inFlight.current)return;inFlight.current=true;setBusy(true);setMessage("Verificando acesso e integridade do arquivo…");try{
  const response=await fetch(`/api/reports/${report.id}/download`,{cache:"no-store"});if(!response.ok){await body(response);return}
  if(!response.headers.get("content-type")?.includes("application/pdf"))throw new Error("Resposta sem PDF válido.");
  const url=URL.createObjectURL(await response.blob()),link=document.createElement("a");link.href=url;link.download=`mova-relatorio-${report.id}.pdf`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage("Download autorizado e arquivo verificado.");
 }catch(error){setMessage(error instanceof Error?error.message:"Falha no download.")}finally{inFlight.current=false;setBusy(false)}}
 return <section aria-label="Relatórios da avaliação" style={{marginTop:16}}><div className="actions" style={{flexWrap:"wrap"}}>{assessmentId&&<button className="button primary" type="button" disabled={busy} onClick={()=>void generate()}>Gerar e salvar relatório</button>}<button className="button secondary" type="button" disabled={loading||busy} onClick={()=>void load()}>Atualizar relatórios</button></div>
 <p className="muted">PDF privado com dados registrados e limitações do método. Dados iguais reutilizam o relatório; alterações geram outro snapshot.</p>
 {message&&<p className="notice" role="status">{message}</p>}{loading&&<p role="status">Carregando relatórios…</p>}
 {loadError&&<p className="notice" role="alert">{loadError}</p>}
 {!loading&&!loadError&&!reports.length&&<p className="muted">Nenhum relatório persistido disponível.</p>}
 <div style={{display:"grid",gap:12}}>{reports.map(r=><article className="card" key={r.id} style={{minWidth:0,overflowWrap:"anywhere"}}><b>{r.patientName}</b><p className="muted">{new Date(r.generatedAt).toLocaleString("pt-BR")} · {r.version} · {r.status==="ready"?"Salvo":"Preparação pendente"}</p><div className="actions" style={{flexWrap:"wrap"}}>{r.status==="ready"?<button className="button secondary" disabled={busy} onClick={()=>void download(r)}>Baixar PDF seguro</button>:r.canResume!==false?<button className="button secondary" disabled={busy} onClick={()=>void generate(r)}>Retomar preparação</button>:<span className="muted">Preparação pelo profissional gerador</span>}<Link className="button secondary" href={`/patients/${r.patientId}`}>Abrir prontuário</Link></div></article>)}</div>
 {more&&<button className="button secondary" disabled={loading||busy} onClick={()=>void load(reports.length)}>Carregar mais</button>}</section>;
}
