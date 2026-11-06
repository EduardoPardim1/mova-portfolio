// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.create }));
import { GET as list, POST as createPatient } from "@/app/api/patients/route";
import { GET as detail, PATCH as edit, DELETE as archive } from "@/app/api/patients/[id]/route";
import { GET as history } from "@/app/api/patients/[id]/assessments/route";
import { POST as assess } from "@/app/api/assessments/route";
import { POST as upload } from "@/app/api/uploads/sign/route";
import { POST as report } from "@/app/api/reports/route";
const A = "10000000-0000-4000-8000-000000000001", B = "10000000-0000-4000-8000-000000000002";
const UA = "20000000-0000-4000-8000-000000000001", UB = "20000000-0000-4000-8000-000000000002";
const PA = "30000000-0000-4000-8000-000000000001", PB = "30000000-0000-4000-8000-000000000002";
const EA = "40000000-0000-4000-8000-000000000001", EB = "40000000-0000-4000-8000-000000000002";
type Row = Record<string, unknown>;
let rows: Record<string, Row[]>;
let failTable: string | undefined;
let noUser: boolean;
let actor: string;
let queries: { table: string; filters: [string, unknown][]; operation: string; payload?: Row }[];
let rpc: ReturnType<typeof vi.fn>;
let signed: ReturnType<typeof vi.fn>;
// Intencionalmente SEM emulação de RLS: prova filtros/autorizações da aplicação,
// inclusive quando o mock tem todos os tenants. Não prova isolamento PostgreSQL.
function client() {
  return {
    rpc: (...args: unknown[]) => rpc(...args),
    auth: { getUser: async () => ({ data: { user: noUser ? null : { id: actor } }, error: null }) },
    storage: { from: () => ({ createSignedUploadUrl: signed }) },
    from(table: string) {
      const q: typeof queries[number] = { table, filters: [], operation: "select" }; queries.push(q);
      let single = false, limit = Infinity;
      const builder = {
        select: () => builder, eq: (k: string, v: unknown) => { q.filters.push([k, v]); return builder; },
        is: (k: string, v: unknown) => { q.filters.push([k, v]); return builder; }, order: () => builder,
        limit: (n: number) => { limit = n; return builder; },
        single: () => { single = true; return builder; }, maybeSingle: () => { single = true; return builder; },
        insert: (payload: Row) => { q.operation = "insert"; q.payload = payload; return builder; },
        update: (payload: Row) => { q.operation = "update"; q.payload = payload; return builder; },
        then(resolve: (value: unknown) => unknown) {
          if (failTable === table) return Promise.resolve({ data: null, error: { code: "fixture_sql", message: "private SQL detail" } }).then(resolve);
          let result = (rows[table] ?? []).filter(r => q.filters.every(([k, v]) => r[k] === v)).slice(0, limit);
          if (q.operation === "insert") { const r = { id: EA, ...q.payload }; rows[table].push(r); result = [r]; }
          if (q.operation === "update") result.forEach(r => Object.assign(r, q.payload));
          return Promise.resolve({ data: single ? result[0] ?? null : result, error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
}
beforeEach(() => {
  actor = UA; noUser = false; failTable = undefined; queries = [];
  signed = vi.fn().mockResolvedValue({ data: { token: "synthetic", signedUrl: "https://example.invalid" }, error: null });
  rows = {
    organization_members: [{ user_id: UA, organization_id: A, role: "professional" }, { user_id: UB, organization_id: B, role: "owner" }],
    patients: [{ id: PA, organization_id: A, archived_at: null }, { id: PB, organization_id: B, archived_at: null }],
    assessments: [{ id: EA, patient_id: PA, organization_id: A, gait_metrics: { estimated_steps: 5 } }, { id: EB, patient_id: PB, organization_id: B }],
    gait_metrics: [],
  };
  rpc = vi.fn(async (_name: string, args: {p_request_id:string;p_organization_id:string;p_payload:Row}) => {
    if (_name!=="save_gait_assessment") return {data:null,error:{code:"PGRST202"}};
    if (failTable) return {data:null,error:{code:"fixture_sql"}};
    if (!rows.patients.some(p=>p.id===args.p_payload.patient_id && p.organization_id===args.p_organization_id && p.archived_at===null)) return {data:null,error:{code:"PT404"}};
    return {error:null,data:{assessment:{id:EA,organization_id:args.p_organization_id,professional_id:actor,patient_id:args.p_payload.patient_id},request_id:args.p_request_id,metrics_saved:true,replayed:false}};
  });
  mocks.create.mockResolvedValue(client());
});
const req = (body?: unknown) => new Request("http://mova.invalid/api", { method: body ? "POST" : "GET", ...(body ? { body: JSON.stringify(body) } : {}) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const input = (patientId = PA) => ({ patientId, protocol: "gait_video", algorithmVersion: "synthetic-test", quality: "limitada", estimatedSteps: null, cadenceSpm: null, speedMps: null, durationSeconds: 2, meanVisibility: null, usableFrames: 0, totalFrames: 1, limitations: [] });

describe("escopo organizacional nas APIs reais com transporte mockado", () => {
  it.each([[UA, PA], [UB, PB]])("lista apenas organização autorizada de %s", async (user, patient) => {
    actor = user; const response = await list(); expect(response.status).toBe(200);
    expect((await response.json()).data.map((r: Row) => r.id)).toEqual([patient]);
  });
  it("cadastro deriva organization/responsible no servidor", async () => {
    const response = await createPatient(req({ name: "Paciente Sintético" })); expect(response.status).toBe(201);
    expect(queries.find(q => q.operation === "insert")?.payload).toMatchObject({ organization_id: A, responsible_user_id: UA });
  });
  it.each([detail, edit, archive, history])("UUID conhecido externo não permite ler, editar, arquivar ou histórico", async handler => {
    const response = await handler(req({ notes: "fixture" }), ctx(PB)); expect(response.status).toBe(404);
    expect(rows.patients[1]).toEqual({ id: PB, organization_id: B, archived_at: null });
    expect(queries.filter(q => q.table === "assessments")).toHaveLength(0);
  });
  it("inexistente e externo têm resposta indistinguível", async () => {
    expect(await (await detail(req(), ctx(PB))).json()).toEqual(await (await detail(req(), ctx(EA))).json());
    expect((await detail(req(), ctx("invalid"))).status).toBe(404);
  });
  it("edição e arquivamento próprios preservados", async () => {
    expect((await edit(req({ notes: "Nota sintética" }), ctx(PA))).status).toBe(200);
    expect(rows.patients[0].notes).toBe("Nota sintética");
    expect((await archive(req(), ctx(PA))).status).toBe(204);
    expect((await list()).status).toBe(200); expect((await (await list()).json()).data).toEqual([]);
  });
  it.each(["organization_id", "responsible_user_id", "id"])("recusa campo protegido %s, não o descarta silenciosamente", async field => {
    expect((await edit(req({ name: "Sintético", [field]: B }), ctx(PA))).status).toBe(400);
    expect((await createPatient(req({ name: "Sintético", [field]: B }))).status).toBe(400);
    expect(queries.some(q => q.operation !== "select")).toBe(false);
  });
  it("rejeita associação cruzada antes de inserir avaliação/métrica", async () => {
    expect((await assess(req(input(PB)))).status).toBe(404);
    expect(queries.some(q => q.operation === "insert")).toBe(false);
  });
  it("envia avaliação e métricas numa única RPC com organização do servidor", async () => {
    expect((await assess(req(input()))).status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("save_gait_assessment", expect.objectContaining({p_organization_id:A,p_payload:expect.objectContaining({patient_id:PA,duration_seconds:2})}));
    expect(queries.some(q=>q.operation!=="select")).toBe(false);
  });
  it.each(["organization_id", "professional_id", "assessment_id"])("avaliação rejeita override %s", async field => {
    expect((await assess(req({ ...input(), [field]: B }))).status).toBe(400);
  });
  it("histórico filtra paciente E organização, mantém normalização das métricas", async () => {
    rows.assessments.push({ id: "fixture-inconsistent", organization_id: B, patient_id: PA });
    const response = await history(req(), ctx(PA)); const data = (await response.json()).data;
    expect(data).toHaveLength(1); expect(data[0].gait_metrics).toEqual([{ estimated_steps: 5 }]);
  });
  it.each([upload, report])("recurso filho externo não autoriza arquivo/relatório", async handler => {
    expect((await handler(req(handler === upload ? { assessmentId: EB, filename: "fixture.mp4", contentType: "video/mp4" } : { assessmentId: EB }))).status).toBe(404);
    expect(signed).not.toHaveBeenCalled();
  });
  it("assinatura própria usa path derivado e RPC de relatório ausente falha fechado", async () => {
    const response = await upload(req({ assessmentId: EA, filename: "fixture.mp4", contentType: "video/mp4" }));
    expect(response.status).toBe(200); expect(signed.mock.calls[0][0]).toMatch(new RegExp(`^${A}/${EA}/`));
    expect((await report(req({ assessmentId: EA }))).status).toBe(503);
  });
  it.each([upload, report])("rejeita pai legado inconsistente mesmo com assessment no tenant", async handler => {
    rows.assessments[0].patient_id = PB;
    const body = handler === upload ? { assessmentId: EA, filename: "fixture.mp4", contentType: "video/mp4" } : { assessmentId: EA };
    expect((await handler(req(body))).status).toBe(404);
    expect(signed).not.toHaveBeenCalled();
  });
  it("duplo membership é bloqueado sem escolher primeiro nem aceitar seleção pelo cliente", async () => {
    rows.organization_members.push({ user_id: UA, organization_id: B, role: "owner" });
    expect((await list()).status).toBe(409);
    expect((await createPatient(req({ name: "Sintético", organization_id: A }))).status).toBe(409);
    expect((await assess(req(input()))).status).toBe(409);
    expect(queries.every(q => q.table === "organization_members")).toBe(true);
  });
  it("sem membership ou role reconhecida não há fallback", async () => {
    rows.organization_members = []; expect((await list()).status).toBe(403);
    rows.organization_members = [{ user_id: UA, organization_id: A, role: "superuser" }]; expect((await list()).status).toBe(403);
  });
  it("sem sessão, configuração, ou erro de consulta falha fechado sem detalhes SQL", async () => {
    noUser = true; expect((await list()).status).toBe(401);
    noUser = false; failTable = "organization_members"; const res = await list(); expect(res.status).toBe(503); expect(await res.text()).not.toContain("private SQL");
    mocks.create.mockResolvedValue(null); expect((await list()).status).toBe(503);
  });
  it("JSON malformado e erro do banco não vazam detalhes nem indicam sucesso", async () => {
    expect((await createPatient(new Request("http://mova.invalid", { method: "POST", body: "{" }))).status).toBe(400);
    failTable = "patients"; const res = await createPatient(req({ name: "Sintético" })); expect(res.status).toBe(500); expect(await res.text()).not.toContain("fixture_sql");
  });
  it("falha da RPC não vira sucesso nem causa escrita alternativa", async () => {
    failTable = "gait_metrics"; expect((await assess(req(input()))).status).toBe(500);
  });
  it("recusa insert quando banco rejeita membership removido entre check e escrita", async () => {
    failTable = "assessments"; expect((await assess(req(input()))).status).toBe(500);
    expect(rows.gait_metrics).toEqual([]); // Mock de rejeição; não é teste real de concorrência SQL.
  });
});

describe("recibo transacional da API (transporte simulado)",()=>{
 const key="50000000-0000-4000-8000-000000000001";
 const request=(id=key)=>new Request("http://mova.invalid/api/assessments",{method:"POST",headers:{"Idempotency-Key":id},body:JSON.stringify(input())});
 it("preserva chave recebida e aceita replay confirmado",async()=>{
   const first=await assess(request());expect(first.status).toBe(201);
   const receipt=await first.json();expect(receipt.requestId).toBe(key);
   rpc.mockResolvedValue({error:null,data:{assessment:receipt.data,request_id:key,metrics_saved:true,replayed:true}});
   expect((await assess(request())).status).toBe(200);expect(rpc.mock.calls[1][1].p_request_id).toBe(key);
 });
 it("recusa chave inválida sem chamar RPC",async()=>{expect((await assess(request("invalid"))).status).toBe(400);expect(rpc).not.toHaveBeenCalled()});
 it.each(["PGRST202","42883","55P03","40001"])("%s não usa fallback de dois inserts",async code=>{
   rpc.mockResolvedValue({data:null,error:{code,message:"private SQL detail"}});
   const res=await assess(request());expect(res.status).toBe(503);expect(await res.text()).not.toContain("private SQL");expect(queries.every(q=>q.operation==="select")).toBe(true);
 });
 it.each([null,{metrics_saved:false},{assessment:{id:EB,organization_id:B,professional_id:UB,patient_id:PB},request_id:key,metrics_saved:true,replayed:false}])("não aceita confirmação ausente ou de outro contexto",async data=>{
   rpc.mockResolvedValue({data,error:null});expect((await assess(request())).status).toBe(502);
 });
 it("exceção de transporte não expõe detalhes",async()=>{rpc.mockRejectedValue(new Error("private SQL detail"));const res=await assess(request());expect(res.status).toBe(503);expect(await res.text()).not.toContain("private SQL")});
});
