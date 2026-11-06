import { describe, expect, it } from "vitest";
import { analyseFootSeparationRhythm } from "@/lib/experimental/gait-rhythm-screen";
import type { PoseSample } from "@/lib/pose-analysis";

function periodicSamples({ mirror = false, gap = false, irregular = false }: { mirror?: boolean; gap?: boolean; irregular?: boolean } = {}) {
  return Array.from({ length: 48 }, (_, index): PoseSample => {
    const separation = 0.1 + 0.08 * (1 + Math.sin(index * Math.PI / 4)) / 2;
    const offset = gap && index >= 24 ? 1200 : 0;
    const jitter = irregular ? (index % 2 ? 35 : -35) : 0;
    const center = 0.5;
    const sign = mirror ? -1 : 1;
    return { timeMs: index * 100 + offset + jitter, leftAnkleX: center - sign * separation / 2, rightAnkleX: center + sign * separation / 2, leftAnkleY: 0.72, rightAnkleY: 0.72, visibility: 0.9 };
  });
}

describe("triagem experimental de ritmo por separação dos pés", () => {
  it("encontra repetição temporal em sinal frontal sintético sem gerar eventos", () => {
    const result = analyseFootSeparationRhythm(periodicSamples(), "frontal");
    expect(result.eligible).toBe(true);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].repeatedPattern).toBe(true);
    expect(result.segments[0].bestLagMs).toBeGreaterThan(600);
    expect(result.limitations.join(" ")).toContain("não confirma contato");
  });

  it("mantém o resultado ao espelhar horizontalmente", () => {
    const normal = analyseFootSeparationRhythm(periodicSamples(), "posterior");
    const mirrored = analyseFootSeparationRhythm(periodicSamples({ mirror: true }), "posterior");
    expect(mirrored.segments[0].bestLagMs).toBe(normal.segments[0].bestLagMs);
    expect(mirrored.segments[0].periodicityScore).toBe(normal.segments[0].periodicityScore);
  });

  it("separa pausa longa sem inventar repetição entre segmentos", () => {
    const result = analyseFootSeparationRhythm(periodicSamples({ gap: true }), "frontal");
    expect(result.segments).toHaveLength(2);
    expect(result.segments.every((segment) => segment.durationMs < 3000)).toBe(true);
  });

  it("recusa sinal plano, timestamps irregulares e landmarks indisponíveis", () => {
    const flat = periodicSamples().map((sample) => ({ ...sample, leftAnkleX: 0.4, rightAnkleX: 0.6 }));
    expect(analyseFootSeparationRhythm(flat, "frontal").segments[0].reason).toBe("flat_signal");
    expect(analyseFootSeparationRhythm(periodicSamples({ irregular: true }), "frontal").segments[0].reason).toBe("irregular_timestamps");
    const missing = periodicSamples().map((sample, index) => index % 3 ? sample : { ...sample, leftAnkleX: null, visibility: 0.1 });
    const result = analyseFootSeparationRhythm(missing, "frontal");
    expect(result.input.rejectedLowVisibility).toBeGreaterThan(0);
    expect(result.input.usableSamples).toBeLessThan(missing.length);
  });

  it("recusa lateral, oblíqua e indeterminada", () => {
    for (const perspective of ["lateral", "oblique", "indeterminate"] as const) {
      const result = analyseFootSeparationRhythm(periodicSamples(), perspective);
      expect(result.eligible).toBe(false);
      expect(result.segments).toHaveLength(0);
    }
  });
});
