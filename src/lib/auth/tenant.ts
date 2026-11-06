import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export const uuid = z.string().uuid();
export const apiError = (error: string, status: number) => NextResponse.json({ error }, { status });
export const missingResource = () => apiError("Registro não encontrado ou sem acesso", 404);

/** Sem seletor de organização, somente um membership é um contexto não ambíguo.
 * IDs de tenant enviados pelo cliente nunca selecionam o escopo implicitamente.
 */
export async function requireTenant() {
  try {
    const client = await createServerSupabaseClient();
    if (!client) return { response: apiError("Supabase não configurado", 503) } as const;
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return { response: apiError("Sessão inválida ou expirada", 401) } as const;
    const members = await client.from("organization_members").select("organization_id,user_id,role").eq("user_id", user.id).limit(2);
    if (members.error) return { response: apiError("Não foi possível verificar sua organização", 503) } as const;
    if (!members.data?.length) return { response: apiError("Sua conta não possui organização ativa", 403) } as const;
    if (members.data.length !== 1) return { response: apiError("Sua conta possui múltiplas organizações. A seleção de organização ainda não está disponível; operação bloqueada para evitar mistura de dados.", 409) } as const;
    const member = members.data[0];
    if (member.user_id !== user.id || !uuid.safeParse(member.organization_id).success || !["owner", "admin", "professional"].includes(member.role)) return { response: apiError("Vínculo organizacional inválido", 403) } as const;
    return { client, user, organizationId: member.organization_id as string, role: member.role as string, response: null } as const;
  } catch { return { response: apiError("Não foi possível verificar o acesso", 503) } as const; }
}

export async function jsonBody(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { return undefined; }
}

/** Também recusa relações legadas inconsistentes antes de emitir acesso a arquivo. */
export async function scopedAssessment(client: SupabaseClient, organizationId: string, id: string) {
  const assessment = await client.from("assessments").select("id,patient_id")
    .eq("id", id).eq("organization_id", organizationId).maybeSingle();
  if (assessment.error || !assessment.data) return assessment;
  const patient = await client.from("patients").select("id").eq("id", assessment.data.patient_id)
    .eq("organization_id", organizationId).maybeSingle();
  return { data: patient.data ? assessment.data : null, error: patient.error };
}
