import { z } from "zod";
import { assessmentSaveSchema } from "@/lib/validation";
import { persistedQuality } from "@/lib/assessment-metrics";

export function assessmentRpcPayload(input: z.infer<typeof assessmentSaveSchema>) {
  return {
    patient_id: input.patientId, protocol: input.protocol,
    capture_conditions: { ...input.conditions, distance_meters: input.distanceMeters ?? null },
    manual_duration_seconds: input.manualDurationSeconds ?? null,
    algorithm_version: input.algorithmVersion, notes: input.notes ?? null,
    duration_seconds: input.durationSeconds, estimated_steps: input.estimatedSteps,
    cadence_spm: input.cadenceSpm, speed_mps: input.speedMps,
    quality: persistedQuality(input), limitations: input.limitations.join(" "),
  };
}

export const assessmentReceiptSchema = z.object({
  assessment: z.object({ id: z.string().uuid(), organization_id: z.string().uuid(),
    professional_id: z.string().uuid(), patient_id: z.string().uuid() }).passthrough(),
  request_id: z.string().uuid(), metrics_saved: z.literal(true), replayed: z.boolean(),
});
