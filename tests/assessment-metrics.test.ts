import { describe, expect, it } from "vitest";
import { normalizeMetricsRelation, persistedQuality } from "@/lib/assessment-metrics";

const metric = { duration_seconds: 15, estimated_steps: 19, cadence_spm: 76.24, speed_mps: null, quality: { level: "adequada" }, limitations: null };

describe("métricas persistidas de avaliação", () => {
  it("normaliza a relação 1:1 retornada pelo Supabase para a lista consumida pelo histórico", () => {
    expect(normalizeMetricsRelation(metric)).toEqual([metric]);
    expect(normalizeMetricsRelation([metric])).toEqual([metric]);
    expect(normalizeMetricsRelation(null)).toEqual([]);
  });

  it("preserva os indicadores calculados no JSON de qualidade para novas avaliações", () => {
    expect(persistedQuality({ quality: "adequada", meanVisibility: 0.82, usableFrames: 98, totalFrames: 98, detectionRate: 0.91, stepRegularity: 71.3, temporalSymmetry: null })).toEqual({ level: "adequada", mean_visibility: 0.82, usable_frames: 98, total_frames: 98, detection_rate: 0.91, step_regularity: 71.3, temporal_symmetry: null });
  });
});
