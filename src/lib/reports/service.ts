import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { scopedAssessment } from "@/lib/auth/tenant";
import { REPORT_BUCKET, MAX_PDF_BYTES, reportSchema, type SavedReport } from "./model";
import { renderReportV1 } from "./pdf";
export class ReportError extends Error { constructor(message:string,public status:number){super(message)} }
export type ReportContext={client:SupabaseClient;organizationId:string;user:{id:string}};
const hash=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
function readReport(data:unknown,org:string):SavedReport {const result=reportSchema.safeParse(data);if(!result.success||result.data.organization_id!==org)throw new ReportError("Relatório sem confirmação íntegra. Operação interrompida.",502);return result.data}
function databaseError(code?:string):never {
 if(code==="PT404")throw new ReportError("Avaliação revisada com métricas não encontrada ou sem acesso.",404);
 if(code==="PT401")throw new ReportError("Sessão inválida ou expirada.",401);
 if(code==="42501")throw new ReportError("Sem permissão para gerar este relatório.",403);
 if(code==="PT409")throw new ReportError("Relatório em conflito. Atualize e tente novamente.",409);
 throw new ReportError("Relatórios temporariamente indisponíveis. A preparação pode ser retomada; nenhum sucesso foi confirmado.",503);
}
async function storedBytes(ctx:ReportContext,r:SavedReport):Promise<Uint8Array>{
 const {data,error}=await ctx.client.storage.from(REPORT_BUCKET).download(r.storage_path);
 if(error||!data)throw new ReportError("Arquivo indisponível. O relatório não pôde ser recuperado.",404);
 if(data.size>MAX_PDF_BYTES)throw new ReportError("Arquivo com integridade inválida.",409);
 return new Uint8Array(await data.arrayBuffer());
}
export async function loadReport(ctx:ReportContext,id:string){
 const {data,error}=await ctx.client.from("reports").select("*").eq("id",id).eq("organization_id",ctx.organizationId).maybeSingle();
 if(error)databaseError(error.code);if(!data)throw new ReportError("Relatório não encontrado ou sem acesso.",404);
 const report=readReport(data,ctx.organizationId);
 const parent=await scopedAssessment(ctx.client,ctx.organizationId,report.assessment_id);
 if(parent.error)throw new ReportError("Não foi possível verificar o acesso à avaliação.",503);
 if(!parent.data||parent.data.patient_id!==report.patient_id)throw new ReportError("Relatório não encontrado ou sem acesso.",404);
 return report;
}
export async function downloadReport(ctx:ReportContext,id:string){
 const report=await loadReport(ctx,id);
 if(report.status!=="ready")throw new ReportError("O relatório ainda não foi concluído. Retome sua geração.",409);
 const bytes=await storedBytes(ctx,report);
 if(bytes.byteLength!==report.pdf_bytes||hash(bytes)!==report.pdf_sha256||hash(renderReportV1(report))!==report.pdf_sha256)throw new ReportError("A integridade do arquivo não foi confirmada. Download bloqueado.",409);
 return {report,bytes};
}
export async function saveReport(ctx:ReportContext,assessmentId:string,resumeId?:string){
 const parent=await scopedAssessment(ctx.client,ctx.organizationId,assessmentId);
 if(parent.error)throw new ReportError("Não foi possível verificar a avaliação.",503);
 if(!parent.data)throw new ReportError("Registro não encontrado ou sem acesso",404);
 let report:SavedReport;
 if(resumeId){report=await loadReport(ctx,resumeId);if(report.assessment_id!==assessmentId)throw new ReportError("Relatório não encontrado ou sem acesso.",404)}
 else {const {data,error}=await ctx.client.rpc("prepare_assessment_report",{p_assessment:assessmentId,p_org:ctx.organizationId});if(error)databaseError(error.code);report=readReport(data,ctx.organizationId)}
 if(report.generated_by!==ctx.user.id||report.assessment_id!==assessmentId)throw new ReportError("Sem permissão para concluir este relatório.",403);
 if(report.status==="ready"){await downloadReport(ctx,report.id);return report}
 const bytes=renderReportV1(report),digest=hash(bytes);
 if(bytes.byteLength>MAX_PDF_BYTES)throw new ReportError("Relatório excedeu o tamanho permitido.",422);
 // Upsert is deliberately forbidden. A retry checks bytes already uploaded.
 await ctx.client.storage.from(REPORT_BUCKET).upload(report.storage_path,bytes,{contentType:"application/pdf",upsert:false,cacheControl:"0"});
 let actual:Uint8Array;
 try{actual=await storedBytes(ctx,report)}catch{throw new ReportError("Upload não confirmado. A preparação foi preservada; atualize a lista e retome o relatório.",503)}
 if(actual.byteLength!==bytes.byteLength||hash(actual)!==digest)throw new ReportError("Arquivo divergente. Preparação preservada para investigação; nada foi concluído.",409);
 const {data,error}=await ctx.client.rpc("complete_assessment_report",{p_id:report.id,p_org:ctx.organizationId,p_hash:digest,p_bytes:bytes.byteLength});
 if(error)databaseError(error.code);
 const completed=readReport(data,ctx.organizationId);
 if(completed.id!==report.id||completed.status!=="ready"||completed.pdf_sha256!==digest||completed.pdf_bytes!==bytes.byteLength||completed.snapshot_hash!==report.snapshot_hash)throw new ReportError("O banco não confirmou a conclusão do relatório.",502);
 return completed;
}
