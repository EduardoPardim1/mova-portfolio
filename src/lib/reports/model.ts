import { z } from "zod";
const id=z.string().uuid(), text=z.string().max(120), number=z.number().finite().nullable();
export const REPORT_BUCKET="assessment-reports";
export const MAX_PDF_BYTES=5242880;
export const snapshotSchema=z.object({
 schema_version:z.literal("mova-report-1"),
 organization:z.object({id,name:text}),
 patient:z.object({id,name:text,birth_date:z.string().nullable(),sex:z.string().nullable()}),
 assessment:z.object({id,professional_id:id,protocol:z.enum(["gait_video","walk_10m"]),created_at:z.string().datetime({offset:true}),algorithm_version:z.string().max(80).nullable(),notes:z.string().max(2000).nullable(),status:z.enum(["reviewed","final"])}),
 generator:z.object({id,name:text}),
 metrics:z.object({duration_seconds:number,estimated_steps:number,cadence_spm:number,speed_mps:number,limitations:z.string().max(12000).nullable(),quality:z.object({level:z.string().max(40).nullable(),mean_visibility:number,usable_frames:number,total_frames:number,detection_rate:number,step_regularity:number,temporal_symmetry:number})}),
});
export const reportSchema=z.object({id,assessment_id:id,generated_by:id,organization_id:id,patient_id:id,
 storage_path:z.string(),generated_at:z.string().datetime({offset:true}),report_version:z.literal("mova-report-1"),snapshot:snapshotSchema,snapshot_hash:z.string().regex(/^[a-f0-9]{64}$/),status:z.enum(["pending","ready"]),pdf_sha256:z.string().regex(/^[a-f0-9]{64}$/).nullable(),pdf_bytes:z.number().int().positive().max(MAX_PDF_BYTES).nullable(),completed_at:z.string().nullable(),
}).superRefine((r,ctx)=>{
 if(r.storage_path!==`${r.organization_id}/${r.id}.pdf`||r.snapshot.organization.id!==r.organization_id||r.snapshot.patient.id!==r.patient_id||r.snapshot.assessment.id!==r.assessment_id||r.snapshot.generator.id!==r.generated_by
 ||(r.status==="ready"&&(!r.pdf_sha256||!r.pdf_bytes||!r.completed_at)))ctx.addIssue({code:"custom",message:"Report identity mismatch"});
});
export type SavedReport=z.infer<typeof reportSchema>;
export type ReportSummary={id:string;assessmentId:string;patientId:string;patientName:string;generatedAt:string;version:string;status:"pending"|"ready";generatedBy:string;canResume?:boolean};
export function summary(r:SavedReport):ReportSummary{return{id:r.id,assessmentId:r.assessment_id,patientId:r.patient_id,patientName:r.snapshot.patient.name,generatedAt:r.generated_at,version:r.report_version,status:r.status,generatedBy:r.generated_by}}
