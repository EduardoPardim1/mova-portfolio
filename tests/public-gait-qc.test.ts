import { describe, expect, it } from "vitest";
import { summarizePublicSample } from "../src/lib/experimental/temporal-ai/public-sample-qc";
describe("QC público sem contatos ou coordenadas exportadas", () => {
  const frames = Array.from({ length: 360 }, (_, i) => ({ timeMs: i * 1000 / 30, landmarks: [] }));
  it("preserva timestamps e não inventa pose, rótulos ou treino", () => {
    const qc = summarizePublicSample(frames, 1920, 1080, 12000);
    expect(qc.sourceTimesMs).toEqual(frames.map(f => f.timeMs)); expect(qc.poseDetected).toBe(0);
    expect(qc.fullFeatureFrames).toBe(0); expect(qc.windows).toHaveLength(5);
    expect(qc.windows.every(w => w.eligibleOutputs === 0 && w.missingFrames === 0)).toBe(true);
    expect(qc.referenceContacts).toBeNull(); expect(qc.trainingPerformed).toBe(false);
    expect(JSON.stringify(qc)).not.toContain('"landmarks"');
  });
  it("registra lacunas e rejeita tempos repetidos", () => {
    const qc = summarizePublicSample(frames.filter((_, i) => i !== 10), 640, 480, 12000);
    expect(qc.gapsOver50Ms).toHaveLength(1); expect(qc.observedMedianHz).toBeCloseTo(30);
    expect(() => summarizePublicSample([frames[0], frames[0]], 640, 480, 12000)).toThrow();
  });
});
