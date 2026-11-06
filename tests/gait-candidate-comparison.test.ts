import { describe, expect, it } from "vitest";
import { compareCandidateTimes, exportCandidateRun } from "@/lib/experimental/gait-candidate-comparison";
import { createHighFrequencySamplingSession } from "@/lib/experimental/gait-high-frequency-pipeline";

const event = (timeMs: number, side: "left" | "right" | "unknown" = "left") => ({ timeMs, side });
const window = { startMs: 1000, endMs: 2000 };

describe("comparação temporal exploratória isolada", () => {
  it("inclui a tolerância de ±100 ms e não reutiliza contato", () => {
    const result = compareCandidateTimes([event(1200)], [event(1100), event(1300)], window);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({ candidateTimeMs: 1100, errorMs: -100 });
    expect(result.unmatchedCandidates).toHaveLength(1);
  });
  it("maximiza pares em vez de usar o candidato mais próximo de maneira gulosa", () => {
    const result = compareCandidateTimes([event(1100), event(1200)], [event(1001), event(1110)], window);
    expect(result.matches.map((m) => m.candidateTimeMs)).toEqual([1001, 1110]);
  });
  it("minimiza o erro total entre soluções de mesma cardinalidade", () => {
    const result = compareCandidateTimes([event(1200)], [event(1150), event(1210)], window);
    expect(result.matches[0].errorMs).toBe(10);
  });
  it("exclui candidatos fora da janela inclusive quando próximos a contato da borda", () => {
    const result = compareCandidateTimes([event(1000), event(2000)], [event(999), event(1000), event(2000), event(2001)], window);
    expect(result.matches).toHaveLength(2);
    expect(result.outsideCandidates.map((c) => c.timeMs)).toEqual([999, 2001]);
    expect(result.unmatchedCandidates).toEqual([]);
  });
  it("audita o lado sem usá-lo para favorecer correspondências", () => {
    const result = compareCandidateTimes([event(1200, "right"), event(1600, "unknown")], [event(1210, "left"), event(1600)], window);
    expect(result.matches.map((m) => m.sideAgreement)).toEqual([false, null]);
  });
  it("não inventa pares para eventos distantes ou listas vazias", () => {
    const result = compareCandidateTimes([event(1200)], [event(1500)], window);
    expect(result.matches).toEqual([]);
    expect(result.unmatchedHuman).toHaveLength(1);
    expect(compareCandidateTimes([], [], window).matches).toEqual([]);
  });
  it("preserva duplicatas como eventos diferentes e relata proximidade sem removê-las", () => {
    const result = compareCandidateTimes([event(1200)], [event(1200), event(1200, "right")], window);
    expect(result.matches).toHaveLength(1);
    expect(result.unmatchedCandidates).toHaveLength(1);
    expect(result.nearCandidatePairs).toEqual([{ firstIndex: 0, secondIndex: 1, intervalMs: 0, sameSide: false }]);
  });
  it("recusa dados inválidos e contatos humanos fora da janela", () => {
    expect(() => compareCandidateTimes([event(500)], [], window)).toThrow();
    expect(() => compareCandidateTimes([], [event(NaN)], window)).toThrow();
    expect(() => compareCandidateTimes([], [], { startMs: 2000, endMs: 1000 })).toThrow();
  });
});

describe("exportação de candidatos sem landmarks", () => {
  it("seleciona somente campos permitidos, inclusive recusas e cancelamento", () => {
    const session = createHighFrequencySamplingSession({ targetHz: 30, perspective: "lateral" });
    session.observe({ mediaTime: 0 }, () => ({ timeMs: 0, leftAnkleX: .1, rightAnkleX: .2, leftAnkleY: .8, rightAnkleY: .8, visibility: .9 }));
    session.cancel();
    const result = session.finalize();
    result.scientific.candidates.push({ timeMs: 100, side: "left", status: "rejected", rejectionReason: "minimum_spacing", landmarkQuality: .8, signalValue: .25, prominence: .05 });
    const exported = exportCandidateRun(result, { videoId: "synthetic", runId: "test", exportedAt: "2026-10-21T00:00:00Z", processingMs: 100 });
    const json = JSON.stringify(exported);
    for (const forbidden of ["leftAnkle", "samples\"", "landmarkQuality", "signalValue", "prominence", "hipCenter"]) expect(json).not.toContain(forbidden);
    expect(exported.candidates).toEqual([{ timeMs: 100, side: "left", status: "rejected", rejectionReason: "minimum_spacing" }]);
    expect(exported.statistics.cancelled).toBe(true);
    expect(exported.eligible).toBe(false);
    const candidateWithSignal = { timeMs: 1500, side: "left" as const, signalValue: .25, leftAnkleX: .1 };
    const comparison = JSON.stringify(compareCandidateTimes([], [candidateWithSignal], window));
    expect(comparison).not.toContain("signalValue");
    expect(comparison).not.toContain("leftAnkleX");
  });
  it("recusa ID que poderia carregar um nome de arquivo ou caminho pessoal", () => {
    const result = createHighFrequencySamplingSession({ targetHz: 30, perspective: "lateral" }).finalize();
    expect(() => exportCandidateRun(result, { videoId: "C:/video.mp4", runId: "test", exportedAt: "test", processingMs: null })).toThrow();
  });
});
