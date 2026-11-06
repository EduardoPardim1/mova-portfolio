import { NextResponse } from "next/server";
import { patientSchema } from "@/lib/validation";
import { requireTenant, apiError, missingResource, uuid, jsonBody } from "@/lib/auth/tenant";
type Context = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Context) {
  const auth = await requireTenant();
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!uuid.safeParse(id).success) return missingResource();
  const { data, error } = await auth.client.from("patients").select("id,full_name,birth_date,sex,phone,notes,created_at")
    .eq("id", id).eq("organization_id", auth.organizationId).is("archived_at", null).maybeSingle();
  if (error) return apiError("Não foi possível carregar o prontuário", 500);
  return data ? NextResponse.json({ data }) : missingResource();
}
export async function PATCH(request: Request, { params }: Context) {
  const auth = await requireTenant();
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!uuid.safeParse(id).success) return missingResource();
  const body = patientSchema.partial().strict().safeParse(await jsonBody(request));
  if (!body.success || !Object.keys(body.data).length) return apiError("Dados do paciente inválidos ou campos protegidos", 400);
  const update = {
    ...(body.data.name !== undefined ? { full_name: body.data.name } : {}),
    ...(body.data.birthDate !== undefined ? { birth_date: body.data.birthDate || null } : {}),
    ...(body.data.sex !== undefined ? { sex: body.data.sex } : {}),
    ...(body.data.phone !== undefined ? { phone: body.data.phone || null } : {}),
    ...(body.data.notes !== undefined ? { notes: body.data.notes || null } : {}),
  };
  const { data, error } = await auth.client.from("patients").update(update).eq("id", id)
    .eq("organization_id", auth.organizationId).is("archived_at", null).select().maybeSingle();
  if (error) return apiError("Não foi possível atualizar o paciente", 500);
  return data ? NextResponse.json({ data }) : missingResource();
}
export async function DELETE(_: Request, { params }: Context) {
  const auth = await requireTenant();
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!uuid.safeParse(id).success) return missingResource();
  const { data, error } = await auth.client.from("patients").update({ archived_at: new Date().toISOString() })
    .eq("id", id).eq("organization_id", auth.organizationId).is("archived_at", null).select("id").maybeSingle();
  if (error) return apiError("Não foi possível arquivar paciente", 500);
  return data ? new NextResponse(null, { status: 204 }) : missingResource();
}
