import { describe, expect, it } from "vitest";
import { analyseScientificInitialContactCandidates } from "@/lib/experimental/gait-scientific-event-detector";
import type { PoseSample } from "@/lib/pose-analysis";

function lateralSamples(options: { interval?: number; duration?: number; period?: number; variableSpeed?: boolean; lowVisibility?: boolean; gap?: boolean; flat?: boolean } = {}): PoseSample[] {
  const interval = options.interval ?? 40;
  const duration = options.duration ?? 2400;
  return Array.from({ length: Math.floor(duration / interval) + 1 }, (_, index): PoseSample => {
    const timeMs = index * interval;
    const defaultPeriod = options.period ?? 480;
    const halfDuration = duration / 2;
    const cycles = options.variableSpeed && timeMs > halfDuration
      ? halfDuration / (defaultPeriod * 1.5) + (timeMs - halfDuration) / (defaultPeriod * .75)
      : timeMs / (options.variableSpeed ? defaultPeriod * 1.5 : defaultPeriod);
    const phase = cycles * Math.PI * 2;
    const wave = options.flat ? 0 : Math.sin(phase) * 0.13;
    const missing = options.gap && timeMs >= 1000 && timeMs <= 1200;
    return { timeMs, hipCenterX: 0.2 + timeMs / duration * 0.3, leftAnkleX: missing ? null : 0.5 + wave, rightAnkleX: missing ? null : 0.5 - wave, leftAnkleY: .7, rightAnkleY: .7, visibility: options.lowVisibility ? .2 : .9 };
  });
}

describe("POC científica de extremos AP", () => {
  it("aceita candidatos líderes em sequência lateral de 25 Hz", () => {
    const result = analyseScientificInitialContactCandidates(lateralSamples(), "lateral");
    expect(result.eligible).toBe(true);
    expect(result.samplingHz).toBe(25);
    expect(result.events.length).toBeGreaterThan(1);
    expect(result.events.every((event) => event.timeMs >= 80 && event.timeMs <= 2320)).toBe(true);
  });
  it("recusa a resolução de 10 Hz do pipeline de arquivos atual", () => {
    const result = analyseScientificInitialContactCandidates(lateralSamples({ interval: 100 }), "lateral");
    expect(result.eligible).toBe(false);
    expect(result.unavailableReason).toBe("insufficient_sampling");
    expect(result.candidates).toEqual([]);
  });
  it("mantém candidatos técnicos em marcha sintética lenta", () => {
    const result = analyseScientificInitialContactCandidates(lateralSamples({ period: 800, duration: 4000 }), "lateral");
    expect(result.eligible).toBe(true);
    expect(result.events.length).toBeGreaterThan(1);
  });
  it("permanece estável com variação sintética de velocidade", () => {
    const result = analyseScientificInitialContactCandidates(lateralSamples({ duration: 3600, variableSpeed: true }), "lateral");
    expect(result.eligible).toBe(true);
    expect(result.events.length).toBeGreaterThan(1);
  });
  it("não promove toda oscilação artificial a evento", () => {
    const result = analyseScientificInitialContactCandidates(lateralSamples({ period: 160, duration: 1600 }), "lateral");
    expect(result.events.length).toBeLessThan(10);
  });
  it("recusa vista frontal", () => expect(analyseScientificInitialContactCandidates(lateralSamples(), "frontal").eligible).toBe(false));
  it("recusa sequência curta", () => expect(analyseScientificInitialContactCandidates(lateralSamples({ duration: 160 }), "lateral").eligible).toBe(false));
  it("recusa baixa visibilidade", () => expect(analyseScientificInitialContactCandidates(lateralSamples({ lowVisibility: true }), "lateral").eligible).toBe(false));
  it("não cria candidatos para sinal plano", () => {
    const result = analyseScientificInitialContactCandidates(lateralSamples({ flat: true }), "lateral");
    expect(result.eligible).toBe(true);
    expect(result.events).toEqual([]);
  });
  it("não interpola lacunas de landmarks", () => {
    const result = analyseScientificInitialContactCandidates(lateralSamples({ gap: true }), "lateral");
    expect(result.input.rejectedMissingLandmarks).toBeGreaterThan(0);
  });
  it("tolera timestamps irregulares e calcula frequência mediana", () => {
    const samples = lateralSamples(); samples[8].timeMs += 20; samples[9].timeMs += 20;
    const result = analyseScientificInitialContactCandidates(samples, "lateral");
    expect(result.samplingHz).not.toBeNull();
  });
});
