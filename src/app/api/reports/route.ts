import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenant, jsonBody } from "@/lib/auth/tenant";
import { ReportError, saveReport } from "@/lib/reports/service";
import { reportSchema, summary } from "@/lib/reports/model";
export const runtime="nodejs";
const headers={"Cache-Control":"private, no-store"};
const schema=z.object({assessmentId:z.string().uuid(),resumeReportId:z.string().uuid().optional()}).strict();
export async function POST(request:Request){
 const auth=await requireTenant();if(auth.response)return auth.response;
 const input=schema.safeParse(await jsonBody(request));if(!input.success)return NextResponse.json({error:"Solicitação inválida ou campos protegidos"},{status:400,headers});
 try{return NextResponse.json({data:summary(await saveReport(auth,input.data.assessmentId,input.data.resumeReportId))},{status:200,headers})}
 catch(error){return NextResponse.json({error:error instanceof ReportError?error.message:"Falha de comunicação. Preparação preservada; tente novamente."},{status:error instanceof ReportError?error.status:503,headers})}
}
export async function GET(request:Request){
 const auth=await requireTenant();if(auth.response)return auth.response;
 const params=new URL(request.url).searchParams;
 const input=z.object({assessmentId:z.string().uuid().optional(),offset:z.coerce.number().int().min(0).max(10000).default(0)}).safeParse({assessmentId:params.get("assessmentId")??undefined,offset:params.get("offset")??0});
 if(!input.success)return NextResponse.json({error:"Filtro inválido"},{status:400,headers});
 try{
  let query=auth.client.from("reports").select("*").eq("organization_id",auth.organizationId).in("status",["pending","ready"]);
  if(input.data.assessmentId)query=query.eq("assessment_id",input.data.assessmentId);
  const {data,error}=await query.order("generated_at",{ascending:false}).order("id",{ascending:false}).range(input.data.offset,input.data.offset+49);
  if(error)throw new Error("unavailable");
  const rows=reportSchema.array().safeParse(data??[]);
  if(!rows.success||rows.data.some(r=>r.organization_id!==auth.organizationId))throw new Error("invalid receipt");
  return NextResponse.json({data:rows.data.map(r=>({...summary(r),canResume:r.generated_by===auth.user.id})),hasMore:rows.data.length===50},{headers});
 }catch{return NextResponse.json({error:"Não foi possível carregar os relatórios."},{status:503,headers})}
}
