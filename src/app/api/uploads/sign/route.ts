import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenant, apiError, missingResource, jsonBody, scopedAssessment } from "@/lib/auth/tenant";
const schema = z.object({ assessmentId: z.string().uuid(), filename: z.string().min(1).max(120).regex(/^[a-zA-Z0-9._-]+$/), contentType: z.enum(["video/mp4", "video/webm", "video/quicktime"]) }).strict();
export async function POST(request: Request) {
  const auth = await requireTenant();
  if (auth.response) return auth.response;
  const input = schema.safeParse(await jsonBody(request));
  if (!input.success) return apiError("Upload inválido ou campos protegidos", 400);
  const assessment = await scopedAssessment(auth.client, auth.organizationId, input.data.assessmentId);
  if (assessment.error) return apiError("Não foi possível verificar a avaliação", 500);
  if (!assessment.data) return missingResource();
  const path = `${auth.organizationId}/${assessment.data.id}/${crypto.randomUUID()}-${input.data.filename}`;
  const { data, error } = await auth.client.storage.from("assessment-videos").createSignedUploadUrl(path);
  return error || !data ? apiError("Não foi possível preparar o upload", 500) : NextResponse.json({ path, token: data.token, signedUrl: data.signedUrl });
}
