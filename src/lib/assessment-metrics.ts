export type StoredMetric = {
  duration_seconds: number | null;
  estimated_steps: number | null;
  cadence_spm: number | null;
  speed_mps: number | null;
  quality: Record<string, unknown> | null;
  limitations: string | null;
};

export function normalizeMetricsRelation(value: StoredMetric | StoredMetric[] | null | undefined): StoredMetric[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function persistedQuality(input: {
  quality: "adequada" | "limitada" | "insuficiente";
  meanVisibility: number | null;
  usableFrames: number;
  totalFrames: number;
  detectionRate?: number | null;
  stepRegularity?: number | null;
  temporalSymmetry?: number | null;
}) {
  return {
    level: input.quality,
    mean_visibility: input.meanVisibility,
    usable_frames: input.usableFrames,
    total_frames: input.totalFrames,
    detection_rate: input.detectionRate ?? null,
    step_regularity: input.stepRegularity ?? null,
    temporal_symmetry: input.temporalSymmetry ?? null,
  };
}
