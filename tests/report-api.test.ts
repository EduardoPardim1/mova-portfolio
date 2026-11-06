// @vitest-environment node
import {beforeEach,describe,it,expect,vi} from "vitest";
const auth=vi.hoisted(()=>({tenant:vi.fn()}));
vi.mock("@/lib/auth/tenant",async importOriginal=>({...await importOriginal<typeof import("@/lib/auth/tenant")>(),requireTenant:auth.tenant}));
import {POST,GET} from "@/app/api/reports/route";
import {GET as download} from "@/app/api/reports/[id]/download/route";
import {fakeReports} from "./helpers/report-store";
let f:ReturnType<typeof fakeReports>;
beforeEach(()=>{f=fakeReports();auth.tenant.mockResolvedValue({...f.ctx,response:null})});
const request=(body:unknown)=>new Request("http://mova.invalid/api/reports",{method:"POST",body:JSON.stringify(body)});
describe("API de relatórios offline",()=>{
 it("gera, lista e baixa PDF via rota autenticada sem URL Storage",async()=>{const response=await POST(request({assessmentId:f.row.assessment_id}));expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toContain("no-store");const data=await response.json();expect(data.data.status).toBe("ready");expect(JSON.stringify(data)).not.toContain("storage_path");expect(JSON.stringify(data)).not.toContain("snapshot");
 const list=await GET(new Request("http://mova.invalid/api/reports"));expect((await list.json()).data).toHaveLength(1);
 const file=await download(new Request("http://mova.invalid"),{params:Promise.resolve({id:f.row.id})});expect(file.status).toBe(200);expect(file.headers.get("content-type")).toBe("application/pdf");expect(file.headers.get("content-disposition")).toContain("attachment");expect(file.headers.get("cache-control")).toContain("no-store");expect(file.headers.get("x-content-type-options")).toBe("nosniff");
 });
 it.each([401,403,409])("acesso recusado %s antes do serviço",async status=>{auth.tenant.mockResolvedValue({response:Response.json({error:"negado"},{status})});expect((await POST(request({assessmentId:f.row.assessment_id}))).status).toBe(status);expect((await GET(new Request("http://mova.invalid"))).status).toBe(status);expect((await download(new Request("http://mova.invalid"),{params:Promise.resolve({id:f.row.id})})).status).toBe(status);expect(f.rpc).not.toHaveBeenCalled()});
 it("campos protegidos e filtros inválidos não chegam ao banco",async()=>{expect((await POST(request({assessmentId:f.row.assessment_id,snapshot:{}}))).status).toBe(400);expect((await GET(new Request("http://mova.invalid/api/reports?offset=-1"))).status).toBe(400);expect(f.rpc).not.toHaveBeenCalled()});
 it("identificador inexistente tem 404 sem SQL interno",async()=>{const res=await download(new Request("http://mova.invalid"),{params:Promise.resolve({id:"60000000-0000-4000-8000-000000000009"})});expect(res.status).toBe(404);expect(await res.text()).not.toContain("storage_path")});
 it("falha no banco permanece 503 sem sucesso ou detalhe interno",async()=>{f.flags.completeFail=true;const res=await POST(request({assessmentId:f.row.assessment_id}));expect(res.status).toBe(503);expect(await res.text()).not.toContain("sensitive detail");expect(f.row.status).toBe("pending")});
});
