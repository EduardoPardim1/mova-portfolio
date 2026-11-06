import { NextResponse } from "next/server";
import { patientSchema } from "@/lib/validation";
import { requireTenant, apiError, jsonBody } from "@/lib/auth/tenant";

export async function GET() {
  const auth = await requireTenant();
  if (auth.response) return auth.response;
  const { data, error } = await auth.client.from("patients").select("id,full_name,birth_date,sex,phone,notes,created_at")
    .eq("organization_id", auth.organizationId).is("archived_at", null).order("created_at", { ascending: false });
  return error ? apiError("Não foi possível listar pacientes", 500) : NextResponse.json({ data });
}
export async function POST(request: Request) {
  const auth = await requireTenant();
  if (auth.response) return auth.response;
  const body = patientSchema.strict().safeParse(await jsonBody(request));
  if (!body.success) return apiError("Dados do paciente inválidos ou campos protegidos", 400);
  const { data, error } = await auth.client.from("patients").insert({
    organization_id: auth.organizationId, responsible_user_id: auth.user.id,
    full_name: body.data.name, birth_date: body.data.birthDate || null, sex: body.data.sex || "not_informed",
    phone: body.data.phone || null, notes: body.data.notes || null,
  }).select().single();
  return error || !data ? apiError("O banco recusou o cadastro do paciente", 500) : NextResponse.json({ data }, { status: 201 });
}
