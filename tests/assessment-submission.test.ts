// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { createAssessmentSubmission } from "@/lib/assessment-submission";
const id="40000000-0000-4000-8000-000000000001";
const ok=(_url: unknown,init?:RequestInit)=>Promise.resolve(Response.json({data:{id},requestId:(init?.headers as Record<string,string>)["Idempotency-Key"],replayed:false},{status:201}));
describe("intenção de salvamento no navegador (sem rede real)",()=>{
 it("compartilha requisição concorrente e não envia novamente após confirmação",async()=>{
  let finish!:()=>void;const gate=new Promise<void>(resolve=>{finish=resolve});
  const fetcher=vi.fn(async (u:unknown,i?:RequestInit)=>{await gate;return ok(u,i)});
  const intent=createAssessmentSubmission(fetcher);const a=intent.save({a:1}),b=intent.save({a:1});expect(a).toBe(b);
  await expect(intent.save({a:2})).rejects.toThrow("Aguarde");finish();expect(await a).toEqual({assessmentId:id,replayed:false});
  await intent.save({a:1});expect(fetcher).toHaveBeenCalledTimes(1);await expect(intent.save({a:2})).rejects.toThrow("já foi salva");
 });
 it("retém chave após resposta perdida, sem assumir rollback nem inventar sucesso",async()=>{
  const fetcher=vi.fn(ok).mockRejectedValueOnce(new Error("network"));const intent=createAssessmentSubmission(fetcher);
  await expect(intent.save({a:1})).rejects.toThrow("Falha de rede");await intent.save({a:1});
  expect(fetcher.mock.calls[0][1]?.headers).toEqual(fetcher.mock.calls[1][1]?.headers);
 });
 it.each([400,409,500,503])("erro %s permite repetir com mesma chave",async status=>{
  const fetcher=vi.fn(ok).mockResolvedValueOnce(Response.json({error:"Falha confirmada"},{status}));const intent=createAssessmentSubmission(fetcher);
  await expect(intent.save({a:1})).rejects.toThrow("Falha confirmada");await intent.save({a:1});expect(fetcher.mock.calls[0][1]?.headers).toEqual(fetcher.mock.calls[1][1]?.headers);
 });
 it.each([{}, {data:{id},requestId:"outro",replayed:false}])("HTTP 2xx sem recibo correspondente não confirma",async body=>{
  const fetcher=vi.fn(ok).mockResolvedValueOnce(Response.json(body));const intent=createAssessmentSubmission(fetcher);
  await expect(intent.save({a:1})).rejects.toThrow("sem confirmação");await intent.save({a:1});expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it("nova análise tem nova intenção, sem deduplicar métricas iguais de avaliações distintas",async()=>{
  const fetcher=vi.fn(ok);await createAssessmentSubmission(fetcher).save({a:1});await createAssessmentSubmission(fetcher).save({a:1});
  expect(fetcher.mock.calls[0][1]?.headers).not.toEqual(fetcher.mock.calls[1][1]?.headers);
 });
});
