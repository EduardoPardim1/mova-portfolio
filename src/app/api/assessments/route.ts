import { NextResponse } from "next/server";
import { z } from "zod";
import { assessmentSaveSchema } from "@/lib/validation";
import { assessmentRpcPayload, assessmentReceiptSchema } from "@/lib/assessment-save";
import { requireTenant, apiError, jsonBody } from "@/lib/auth/tenant";

export async function POST(request: Request) {
  const auth = await requireTenant();
  if (auth.response) return auth.response;
  const parsed = assessmentSaveSchema.strict().safeParse(await jsonBody(request));
  if (!parsed.success) return apiError("Dados da avaliação inválidos ou campos protegidos", 400);
  const requestId = request.headers.get("Idempotency-Key") ?? crypto.randomUUID();
  if (!z.string().uuid().safeParse(requestId).success) return apiError("Chave de envio inválida", 400);
  const headers = { "Idempotency-Key": requestId, "Cache-Control": "no-store" };
  try {
    const { data, error } = await auth.client.rpc("save_gait_assessment", {
      p_request_id: requestId, p_organization_id: auth.organizationId, p_payload: assessmentRpcPayload(parsed.data),
    });
    if (error) {
      const code = error.code;
      let status = 500, message = "Não foi possível confirmar o salvamento. Tente novamente com o mesmo envio.";
      if (code === "PT401") { status = 401; message = "Entre novamente para salvar a avaliação."; }
      if (["PT403", "42501"].includes(code)) { status = 403; message = "Sem permissão para salvar nesta organização."; }
      if (code === "PT404") { status = 404; message = "Paciente não disponível para esta avaliação."; }
      if (["PT409", "23505"].includes(code)) { status = 409; message = "Envio em conflito. Consulte o histórico antes de iniciar outra avaliação."; }
      if (code === "23503") { status = 409; message = "Os vínculos do paciente ou profissional mudaram. Atualize a página."; }
      if (["PT400", "22P02", "22003", "22023", "23502", "23514"].includes(code)) { status = 400; message = "O banco recusou os dados da avaliação. Revise os campos."; }
      if (["PGRST202", "42883", "42703", "55P03", "57014", "40001", "40P01"].includes(code)) {
        status = 503; message = "Salvamento transacional indisponível. Tente novamente mais tarde com o mesmo envio.";
      }
      return NextResponse.json({ error: message }, { status, headers });
    }
    const receipt = assessmentReceiptSchema.safeParse(data);
    if (!receipt.success || receipt.data.request_id !== requestId.toLowerCase()
      || receipt.data.assessment.organization_id !== auth.organizationId
      || receipt.data.assessment.professional_id !== auth.user.id
      || receipt.data.assessment.patient_id !== parsed.data.patientId.toLowerCase()) {
      return NextResponse.json({ error: "O banco não confirmou a avaliação e suas métricas. Repita o mesmo envio." }, { status: 502, headers });
    }
    return NextResponse.json({ data: receipt.data.assessment, requestId: receipt.data.request_id, replayed: receipt.data.replayed },
      { status: receipt.data.replayed ? 200 : 201, headers });
  } catch {
    return NextResponse.json({ error: "Falha de comunicação ao confirmar o salvamento. Repita o mesmo envio." }, { status: 503, headers });
  }
}
