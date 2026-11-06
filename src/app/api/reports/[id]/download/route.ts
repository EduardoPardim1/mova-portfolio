import { NextResponse } from "next/server";
import { requireTenant, uuid } from "@/lib/auth/tenant";
import { downloadReport, ReportError } from "@/lib/reports/service";
export const runtime="nodejs";
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){
 const auth=await requireTenant();if(auth.response)return auth.response;
 const {id}=await params;const headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
 if(!uuid.safeParse(id).success)return NextResponse.json({error:"Relatório não encontrado ou sem acesso."},{status:404,headers});
 try{const {bytes}=await downloadReport(auth,id);return new Response(new Uint8Array(bytes),{headers:{...headers,"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="mova-relatorio-${id}.pdf"`}})}
 catch(error){return NextResponse.json({error:error instanceof ReportError?error.message:"Não foi possível recuperar o relatório."},{status:error instanceof ReportError?error.status:503,headers})}
}
