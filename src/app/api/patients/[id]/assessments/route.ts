import { NextResponse } from "next/server";
import { normalizeMetricsRelation } from "@/lib/assessment-metrics";
import { requireTenant, apiError, missingResource, uuid } from "@/lib/auth/tenant";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTenant();
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!uuid.safeParse(id).success) return missingResource();
  const patient = await auth.client.from("patients").select("id").eq("id", id)
    .eq("organization_id", auth.organizationId).is("archived_at", null).maybeSingle();
  if (patient.error) return apiError("Não foi possível verificar o paciente", 500);
  if (!patient.data) return missingResource();
  const { data, error } = await auth.client.from("assessments")
    .select("id,protocol,created_at,algorithm_version,capture_conditions,notes,status,gait_metrics(duration_seconds,estimated_steps,cadence_spm,speed_mps,quality,limitations)")
    .eq("patient_id", id).eq("organization_id", auth.organizationId).order("created_at", { ascending: false });
  if (error) return apiError("Não foi possível carregar histórico", 500);
  return NextResponse.json({ data: (data ?? []).map(assessment => ({ ...assessment, gait_metrics: normalizeMetricsRelation(assessment.gait_metrics) })) });
}
