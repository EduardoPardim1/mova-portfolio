// @vitest-environment node
import { describe,it,expect } from "vitest";
import {createHash} from "node:crypto";
import {mkdirSync,writeFileSync,readFileSync} from "node:fs";
import {saveReport,downloadReport,ReportError} from "@/lib/reports/service";
import {renderReportV1} from "@/lib/reports/pdf";
import {reportSchema} from "@/lib/reports/model";
import {reportFixture} from "./helpers/report-fixture";
import {fakeReports as fake} from "./helpers/report-store";
describe("relatório persistido - transporte simulado, sem Supabase",()=>{
 it("upload, releitura, hash e confirmação; download em nova sessão",async()=>{const f=fake();const ready=await saveReport(f.ctx,f.row.assessment_id);expect(ready.status).toBe("ready");const fresh={...f.ctx,user:{id:f.row.generated_by}};const result=await downloadReport(fresh,ready.id);expect(createHash("sha256").update(result.bytes).digest("hex")).toBe(ready.pdf_sha256);expect(result.bytes.slice(0,5)).toEqual(new TextEncoder().encode("%PDF-"))});
 it("falha de upload mantém preparação e não finaliza",async()=>{const f=fake();f.flags.uploadFail=true;await expect(saveReport(f.ctx,f.row.assessment_id)).rejects.toBeInstanceOf(ReportError);expect(f.row.status).toBe("pending");expect(f.rpc.mock.calls.map(c=>c[0])).toEqual(["prepare_assessment_report"])});
 it("upload concluído e falha no banco podem ser retomados sem sobrescrever",async()=>{const f=fake();f.flags.completeFail=true;await expect(saveReport(f.ctx,f.row.assessment_id)).rejects.toMatchObject({status:503});expect(f.objects.size).toBe(1);expect(f.row.status).toBe("pending");f.flags.completeFail=false;expect((await saveReport(f.ctx,f.row.assessment_id,f.row.id)).status).toBe("ready");expect(f.objects.size).toBe(1)});
 it("cliques duplicados concorrentes reutilizam bytes determinísticos e relatório",async()=>{const f=fake();const [a,b]=await Promise.all([saveReport(f.ctx,f.row.assessment_id),saveReport(f.ctx,f.row.assessment_id)]);expect(a.id).toBe(b.id);expect(f.objects.size).toBe(1)});
 it("relatório pronto não gera outro upload",async()=>{const f=fake();await saveReport(f.ctx,f.row.assessment_id);await saveReport(f.ctx,f.row.assessment_id);expect(f.upload).toHaveBeenCalledTimes(1)});
 it("arquivo divergente não conclui nem é apagado",async()=>{const f=fake();f.objects.set(f.row.storage_path,new Uint8Array([1,2]));await expect(saveReport(f.ctx,f.row.assessment_id)).rejects.toMatchObject({status:409});expect(f.row.status).toBe("pending");expect(f.objects.size).toBe(1)});
 it.each(["missingParent","missingPatient"] as const)("%s bloqueia arquivo e RPC",async field=>{const f=fake();f.flags[field]=true;await expect(saveReport(f.ctx,f.row.assessment_id)).rejects.toMatchObject({status:404});expect(f.upload).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled()});
 it("UUID conhecido de outra organização não permite download",async()=>{const f=fake();await expect(downloadReport({...f.ctx,organizationId:"10000000-0000-4000-8000-000000000002"},f.row.id)).rejects.toMatchObject({status:404})});
 it("outro gerador não pode retomar pendência",async()=>{const f=fake();await expect(saveReport({...f.ctx,user:{id:"20000000-0000-4000-8000-000000000002"}},f.row.assessment_id,f.row.id)).rejects.toMatchObject({status:403})});
 it("pendente, ausente e corrompido são tratados",async()=>{const f=fake();await expect(downloadReport(f.ctx,f.row.id)).rejects.toMatchObject({status:409});await saveReport(f.ctx,f.row.assessment_id);f.flags.readFail=true;await expect(downloadReport(f.ctx,f.row.id)).rejects.toMatchObject({status:404});f.flags.readFail=false;f.objects.set(f.row.storage_path,new Uint8Array([7]));await expect(downloadReport(f.ctx,f.row.id)).rejects.toMatchObject({status:409})});
 it("hash declarado pelo cliente não legitima PDF diferente do snapshot",async()=>{const f=fake();await saveReport(f.ctx,f.row.assessment_id);const bytes=new TextEncoder().encode("%PDF-conteudo divergente");f.objects.set(f.row.storage_path,bytes);f.row.pdf_bytes=bytes.length;f.row.pdf_sha256=createHash("sha256").update(bytes).digest("hex");await expect(downloadReport(f.ctx,f.row.id)).rejects.toMatchObject({status:409})});
 it("recibo sem conclusão não vira sucesso",async()=>{const f=fake();f.rpc.mockImplementation(async()=>({data:structuredClone(f.row),error:null}));await expect(saveReport(f.ctx,f.row.assessment_id)).rejects.toMatchObject({status:502})});
 it("snapshot e bytes são determinísticos, preservam nulos e suportam paginação",()=>{const before=structuredClone(reportFixture);const a=renderReportV1(before),b=renderReportV1(structuredClone(before));expect(a).toEqual(b);expect(before).toEqual(reportFixture);expect(reportSchema.safeParse(before).success).toBe(true);before.snapshot.assessment.notes="Texto de teste longo. ".repeat(90);const long=renderReportV1(before);expect(long.byteLength).toBeGreaterThan(a.byteLength);expect(createHash("sha256").update(long).digest("hex")).toBe("47ecf2d7d6e9c2e61be6280edb5697408dbf3cb72293a846b0f053e488a15e60");if(process.env.MOVA_REPORT_QA==="1"){mkdirSync("artifacts/db-stage11/report-qa",{recursive:true});writeFileSync("artifacts/db-stage11/report-qa/synthetic-report.pdf",long)}});
 it("identidade divergente do snapshot é recusada",()=>{const row=structuredClone(reportFixture);row.snapshot.patient.id="30000000-0000-4000-8000-000000000002";expect(reportSchema.safeParse(row).success).toBe(false)});
});

if(process.env.MOVA_REPORT_SQL_FIXTURE){
 it("contrato do recibo PostgreSQL local sintético com renderer real",()=>{
  const path=process.env.MOVA_REPORT_SQL_FIXTURE!;
  if(!/^artifacts[\\/]db-stage11[\\/](?:reports-[0-9]+|candidate-[0-9]+-[a-f0-9]+)[\\/]synthetic-report\.json$/.test(path))throw new Error("Somente fixture local explícita");
  const sample=JSON.parse(readFileSync(path,"utf8"));expect(sample.synthetic).toBe(true);
  const report=reportSchema.parse(sample.report);
  expect(report.snapshot.patient.name).toMatch(/^Synthetic Patient(?: A)?$/);
  const bytes=renderReportV1(report);
  expect(bytes.slice(0,5)).toEqual(new TextEncoder().encode("%PDF-"));expect(bytes.length).toBeGreaterThan(1000);
 });
}
