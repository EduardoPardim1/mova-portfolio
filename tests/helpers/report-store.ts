import {vi,expect} from "vitest";
import type {SupabaseClient} from "@supabase/supabase-js";
import type {ReportContext} from "@/lib/reports/service";
import {reportFixture} from "./report-fixture";
export function fakeReports(){
 const row=structuredClone(reportFixture),objects=new Map<string,Uint8Array>();
 const flags={uploadFail:false,completeFail:false,missingParent:false,missingPatient:false,readFail:false};
 const rpc=vi.fn(async(name:string,args:Record<string,unknown>)=>{
  if(name==="prepare_assessment_report")return{data:structuredClone(row),error:null};
  if(flags.completeFail)return{data:null,error:{code:"database_error",message:"sensitive detail"}};
  row.status="ready";row.pdf_bytes=args.p_bytes as number;row.pdf_sha256=args.p_hash as string;row.completed_at="2026-10-27T12:00:01Z";
  return{data:structuredClone(row),error:null};
 });
 const upload=vi.fn(async(path:string,bytes:Uint8Array,opts:{upsert:boolean})=>{expect(opts.upsert).toBe(false);if(flags.uploadFail||objects.has(path))return{data:null,error:{message:"upload failed"}};objects.set(path,new Uint8Array(bytes));return{data:{path},error:null}});
 const client={rpc,storage:{from:()=>({upload,download:async(path:string)=>{const b=objects.get(path);return b&&!flags.readFail?{data:new Blob([new Uint8Array(b)]),error:null}:{data:null,error:{message:"missing"}}}})},from:(table:string)=>{
  const filters:Record<string,unknown>={};const builder={select:()=>builder,eq:(k:string,v:unknown)=>{filters[k]=v;return builder},in:()=>builder,order:()=>builder,range:async()=>({data:filters.organization_id===row.organization_id?[structuredClone(row)]:[],error:null}),maybeSingle:async()=>{
   if(filters.organization_id!==row.organization_id)return{data:null,error:null};
   return{error:null,data:table==="reports"?(filters.id===row.id?structuredClone(row):null):table==="patients"?(flags.missingPatient?null:{id:row.patient_id}):(flags.missingParent?null:{id:row.assessment_id,patient_id:row.patient_id})};
  }};return builder;
 }} as unknown as SupabaseClient;
 return{row,objects,flags,rpc,upload,ctx:{client,organizationId:row.organization_id,user:{id:row.generated_by}} satisfies ReportContext};
}
