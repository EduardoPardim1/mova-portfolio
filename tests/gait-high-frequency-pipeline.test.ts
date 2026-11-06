import { describe, expect, it } from "vitest";
import { createHighFrequencySamplingSession, hasVideoSamplingEnded, supportsPresentedFrameCallbacks } from "@/lib/experimental/gait-high-frequency-pipeline";
import type { PoseSample } from "@/lib/pose-analysis";

function sample(timeMs: number, visibility = .9): PoseSample { return { timeMs, leftAnkleX: .6, rightAnkleX: .4, leftAnkleY: .7, rightAnkleY: .7, hipCenterX: .2 + timeMs / 10000, hipCenterY: .4, visibility }; }
function session(targetHz: 25 | 30 = 25) { return createHighFrequencySamplingSession({ targetHz, perspective: "lateral", durationMs: 1000 }); }

describe("pipeline de alta frequência", () => {
  it("aceita timestamps de 25 Hz e envia a sequência ao detector", () => { const current = session(25); for (let time = 0; time <= 400; time += 40) current.observe({ mediaTime: time / 1000, presentedFrames: time / 40 }, () => sample(time)); const result = current.finalize(); expect(result.statistics.effectiveSampleHz).toBe(25); expect(result.statistics.samplesAccepted).toBeGreaterThan(5); expect(result.scientific.eligible).toBe(true); });
  it("suporta alvo de 30 Hz sem declarar frames visualmente distintos", () => { const current = session(30); for (let time = 0; time <= 300; time += 33) current.observe({ mediaTime: time / 1000, presentedFrames: time }, () => sample(time)); const result = current.finalize(); expect(result.statistics.targetHz).toBe(30); expect(result.statistics.frameDistinctness).toBe("not_verifiable"); });
  it("não assume FPS declarado quando não há metadado", () => expect(session().finalize().statistics.declaredFps).toBeNull());
  it("registra timestamps duplicados sem promover nova amostra", () => { const current = session(); current.observe({ mediaTime: 0, presentedFrames: 1 }, () => sample(0)); current.observe({ mediaTime: 0, presentedFrames: 1 }, () => sample(0)); expect(current.finalize().statistics.duplicateMediaTimestamps).toBe(1); });
  it("registra falha de extração", () => { const current = session(); current.observe({ mediaTime: 0 }, () => { throw new Error("falha"); }); expect(current.finalize().statistics.extractionFailures).toBe(1); });
  it("registra ausência de pose", () => { const current = session(); current.observe({ mediaTime: 0 }, () => null); expect(current.finalize().statistics.poseFailures).toBe(1); });
  it("registra lacuna temporal", () => { const current = session(); current.observe({ mediaTime: 0 }, () => sample(0)); current.observe({ mediaTime: .2 }, () => sample(200)); expect(current.finalize().statistics.gaps).toHaveLength(1); });
  it("mantém resultado parcial cancelado", () => { const current = session(); current.observe({ mediaTime: 0 }, () => sample(0)); current.cancel(); expect(current.finalize().statistics.cancelled).toBe(true); });
  it("marca apresentação como indisponível sem contador", () => { const current = session(); current.observe({ mediaTime: 0 }, () => sample(0)); expect(current.finalize().statistics.presentationCounterTransitions).toBeNull(); });
  it("detecta indisponibilidade da API de callbacks", () => expect(supportsPresentedFrameCallbacks({})).toBe(false));
  it("considera encerrado o último callback que chega muito próximo do fim", () => {
    expect(hasVideoSamplingEnded({ ended: false, currentTime: 9.96, duration: 10 })).toBe(true);
    expect(hasVideoSamplingEnded({ ended: false, currentTime: 9.9, duration: 10 })).toBe(false);
  });
  it("não presume fim quando a duração ainda está indisponível", () => {
    expect(hasVideoSamplingEnded({ ended: false, currentTime: 0, duration: Number.NaN })).toBe(false);
    expect(hasVideoSamplingEnded({ ended: true, currentTime: 0, duration: Number.NaN })).toBe(true);
  });
});
