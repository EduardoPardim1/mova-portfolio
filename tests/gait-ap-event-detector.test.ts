import { describe, expect, it } from "vitest";
import { analysePelvisRelativeApCandidates, compareVerticalV03WithAp, type VideoPerspective } from "@/lib/experimental/gait-ap-event-detector";
import type { PoseSample } from "@/lib/pose-analysis";

const wave = [-0.12, -0.06, 0, 0.1, 0.18, 0.1, 0, -0.08, -0.16, -0.08, 0];

function samplesFromWave({ mirror = false, perspective = "lateral" as VideoPerspective, gapAt }: { mirror?: boolean; perspective?: VideoPerspective; gapAt?: number } = {}) {
  const samples: PoseSample[] = Array.from({ length: 44 }, (_, index) => {
    const value = wave[index % wave.length];
    const offset = gapAt !== undefined && index >= gapAt ? 1200 : 0;
    const hip = 0.4 + index * 0.004;
    const sign = mirror ? -1 : 1;
    return {
      timeMs: index * 100 + offset,
      hipCenterX: mirror ? 1 - hip : hip,
      leftAnkleX: (mirror ? 1 - hip : hip) + sign * value,
      rightAnkleX: (mirror ? 1 - hip : hip) - sign * value,
      leftAnkleY: 0.7 + value * 0.1,
      rightAnkleY: 0.7 - value * 0.1,
      visibility: 0.92,
    };
  });
  return { samples, perspective };
}

describe("detector experimental AP relativo à pelve", () => {
  it("produz candidatos temporais por lado com telemetria, sem chamá-los de contato", () => {
    const { samples, perspective } = samplesFromWave();
    const result = analysePelvisRelativeApCandidates(samples, perspective);
    expect(result.eligible).toBe(true);
    expect(result.footDefinition).toBe("ankle");
    expect(result.events.length).toBeGreaterThan(2);
    expect(result.events.every((event) => event.side === "left" || event.side === "right")).toBe(true);
    expect(result.candidates.some((candidate) => candidate.kind === "temporal_extremum")).toBe(true);
    expect(result.candidates.some((candidate) => candidate.kind === "pelvis_crossing")).toBe(true);
    expect(result.candidates.every((candidate) => candidate.status === "accepted" || candidate.rejectionReason !== null)).toBe(true);
    expect(result.limitations.join(" ")).toContain("não confirmam contato inicial");
  });

  it("mantém o método bloqueado para vídeo frontal, posterior ou indeterminado", () => {
    const { samples } = samplesFromWave();
    for (const perspective of ["frontal", "posterior", "oblique", "indeterminate"] as const) {
      const result = analysePelvisRelativeApCandidates(samples, perspective);
      expect(result.eligible).toBe(false);
      expect(result.events).toHaveLength(0);
      expect(result.candidates).toHaveLength(0);
    }
  });

  it("não produz eventos para sinal plano", () => {
    const samples = Array.from({ length: 20 }, (_, index): PoseSample => ({ timeMs: index * 100, hipCenterX: 0.5, leftAnkleX: 0.4, rightAnkleX: 0.6, leftAnkleY: 0.7, rightAnkleY: 0.7, visibility: 0.9 }));
    const result = analysePelvisRelativeApCandidates(samples, "lateral");
    expect(result.events).toHaveLength(0);
    expect(result.candidates).toHaveLength(0);
  });

  it("separa lacunas longas e não interpola eventos entre segmentos", () => {
    const { samples } = samplesFromWave({ gapAt: 22 });
    const result = analysePelvisRelativeApCandidates(samples, "lateral");
    expect(result.diagnostics.every((diagnostic) => diagnostic.contiguousSegments === 2)).toBe(true);
    expect(new Set(result.events.map((event) => event.segmentIndex))).toEqual(new Set([0, 1]));
  });

  it("rejeita baixa confiança e landmarks ausentes sem preencher lacunas", () => {
    const { samples } = samplesFromWave();
    samples[6] = { ...samples[6], visibility: 0.1 };
    samples[7] = { ...samples[7], leftAnkleX: null, rightAnkleX: null };
    const result = analysePelvisRelativeApCandidates(samples, "lateral");
    expect(result.input.rejectedLowConfidence).toBe(1);
    expect(result.input.rejectedMissingLandmarks).toBe(1);
    expect(result.input.usableSamples).toBe(samples.length - 2);
  });

  it("ordena timestamps e contabiliza duplicatas sem criar uma segunda amostra", () => {
    const { samples } = samplesFromWave();
    const duplicated = [...samples, { ...samples[10], leftAnkleX: 0.99 }];
    const result = analysePelvisRelativeApCandidates(duplicated, "lateral");
    expect(result.input.duplicateOrNonMonotonicTimestamps).toBeGreaterThan(0);
    expect(result.input.usableSamples).toBe(samples.length);
  });

  it("preserva tempos dos candidatos ao inverter horizontalmente, com direção de imagem invertida", () => {
    const normal = analysePelvisRelativeApCandidates(samplesFromWave().samples, "lateral");
    const mirrored = analysePelvisRelativeApCandidates(samplesFromWave({ mirror: true }).samples, "lateral");
    expect(normal.motionDirectionInImage).toBe("positive-x");
    expect(mirrored.motionDirectionInImage).toBe("negative-x");
    expect(mirrored.events.map((event) => event.timeMs)).toEqual(normal.events.map((event) => event.timeMs));
  });

  it("recusa segmentos curtos e dados insuficientes", () => {
    const samples: PoseSample[] = [
      { timeMs: 0, hipCenterX: 0.5, leftAnkleX: 0.4, rightAnkleX: 0.6, leftAnkleY: 0.7, rightAnkleY: 0.7, visibility: 0.9 },
      { timeMs: 100, hipCenterX: 0.5, leftAnkleX: 0.6, rightAnkleX: 0.4, leftAnkleY: 0.7, rightAnkleY: 0.7, visibility: 0.9 },
    ];
    const result = analysePelvisRelativeApCandidates(samples, "lateral");
    expect(result.events).toHaveLength(0);
    expect(result.candidates).toHaveLength(0);
  });
});

describe("comparador isolado v0.3 versus AP", () => {
  it("usa a mesma série e não transforma concordância em métrica clínica", () => {
    const { samples } = samplesFromWave();
    const comparison = compareVerticalV03WithAp(samples, 4.4, "lateral");
    expect(comparison.comparable).toBe(true);
    expect(comparison.apExperimental.events.length).toBeGreaterThan(0);
    expect(comparison.limitations.join(" ")).toContain("não comprova acurácia");
  });

  it("declara comparação não aplicável sem lateralidade confirmada", () => {
    const comparison = compareVerticalV03WithAp(samplesFromWave().samples, 4.4, "frontal");
    expect(comparison.comparable).toBe(false);
    expect(comparison.apExperimental.events).toHaveLength(0);
  });
});
