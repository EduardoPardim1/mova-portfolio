import { describe, it, expect, vi } from "vitest";
import { informativeDataset, auditScores, selectValidationThreshold } from "../src/lib/experimental/temporal-ai/learning-validation";
import { syntheticTrainingDataset } from "../src/lib/experimental/temporal-ai/synthetic-training";
import { recordingWindows } from "../src/lib/experimental/temporal-ai/supervised-data";
import { TinyContactTcn } from "../src/lib/experimental/temporal-ai/tcn";
import { evaluateRecording } from "../src/lib/experimental/temporal-ai/evaluation";
import { trainDataset, decodeCheckpoint } from "../src/lib/experimental/temporal-ai/training";

describe("aprendizado artificial isolado — etapa 8", () => {
  it("audita cinco positivos, 125 negativos e nenhum contato perdido na etapa 7", () => {
    for (const row of auditScores(new TinyContactTcn(), syntheticTrainingDataset())) {
      expect(row.positiveCount).toBe(5); expect(row.negativeCount).toBe(125);
      expect(row.maskedTargets).toBe(0); expect(row.maskedCells + row.warmupCells).toBe(62);
      expect(row.positive.filter(p => p.side === "left")).toHaveLength(3);
    }
  });
  it("separa participantes antes das janelas, sem cópias e com geração reproduzível", () => {
    const data = informativeDataset("generalization");
    expect(data).toEqual(informativeDataset("generalization"));
    expect(new Set(data.map(r => r.sha256)).size).toBe(8);
    expect(new Set(data.map(r => r.participantId)).size).toBe(8);
    for (const r of data) for (const w of recordingWindows(r)) expect(w.split).toBe(r.split);
    expect(data.filter(r => !r.events.length)).toHaveLength(3);
  });
  it("mantém o impulso dois quadros antes do alvo e alinha o alvo ao PTS", () => {
    const r = informativeDataset("memorization")[0];
    for (const e of r.events) {
      const t = Math.round(e.timeMs * 30 / 1000), c = e.side === "left" ? 24 : 27;
      expect(r.frames[t - 2].values[c]).toBeGreaterThan(1.99);
      expect(Math.abs(r.frames[t].values[c])).toBeLessThan(.002);
      const outputs = [...recordingWindows(r)].flatMap(w => w.timesMs.map((time, i) => ({ time, i, target: w.targets[i] })).slice(30));
      expect(outputs.find(o => o.time === e.timeMs)!.target[e.side === "left" ? 0 : 1]).toBe(1);
    }
  });
  it("lacuna mascara 31 quadros e incerteza bilateral nunca vira negativo", () => {
    const data = informativeDataset("generalization"), r = data[2];
    const rows = [...recordingWindows(r)].flatMap(w => w.timesMs.map((time, i) => ({ frame: Math.round(time * 30 / 1000), mask: w.mask[i] })).slice(30));
    expect(rows.filter(c => c.frame >= 66 && c.frame <= 96).every(c => c.mask.every(v => v === 0))).toBe(true);
    expect(rows.filter(c => c.frame >= 99 && c.frame <= 101).every(c => c.mask.every(v => v === 0))).toBe(true);
    expect(auditScores(new TinyContactTcn(), [r])[0].positiveCount).toBe(3);
  });
  it("seleção rejeita treino/teste e é determinística sem acessar teste", () => {
    const data = informativeDataset("generalization"), model = new TinyContactTcn();
    expect(() => selectValidationThreshold(model, data)).toThrow(/validação/);
    expect(() => selectValidationThreshold(model, [])).toThrow();
    const validation = data.filter(r => r.split === "validation"), a = selectValidationThreshold(model, validation);
    data.filter(r => r.split === "test").forEach(r => { r.events = []; });
    expect(selectValidationThreshold(model, validation)).toEqual(a);
    expect(a.candidates.map(c => c.threshold)).toEqual([.2, .3, .4, .5, .6]);
  });
  it("picos próximos, empate, lados e fronteira entre janelas não duplicam", () => {
    const r = syntheticTrainingDataset()[0], model = new TinyContactTcn();
    // Canal auxiliar exclusivamente no mock para identificar o índice global.
    r.frames.forEach((f, i) => { f.values[0] = i; });
    vi.spyOn(model, "scores").mockImplementation(input => input.map(row => {
      const t = row[0]; return [t === 63 ? .7 : t === 64 ? .9 : t === 67 || t === 68 ? .8 : .1, t === 64 ? .9 : .1];
    }));
    const p = evaluateRecording(model, r).predicted;
    expect(p.map(e => [Math.round(e.timeMs * 30 / 1000), e.side])).toEqual([[64, "left"], [67, "left"], [64, "right"]]);
  });
  it("referência no meio da célula usa arredondamento igual ao alvo, após lacuna", () => {
    const r = syntheticTrainingDataset()[0];
    r.frames[15].sourceTimeMs = null; r.frames[15].values.fill(0);
    const timeMs = 45.5 * 1000 / 30;
    r.events = [{ ...r.events[0], timeMs, startMs: timeMs, endMs: timeMs }];
    const w = [...recordingWindows(r)][0];
    expect(w.mask[45][0]).toBe(0); expect(w.mask[46][0]).toBe(1); expect(w.targets[46][0]).toBe(1);
    expect(evaluateRecording(new TinyContactTcn(), r).reference).toHaveLength(1);
  });
  it("SGD segue gradiente analítico com clipping global, sem alterar arquitetura", () => {
    const model = new TinyContactTcn(), w = [...recordingWindows(informativeDataset("memorization")[0])][0];
    const before = model.layers.map(l => [...l.weights]);
    const g = model.lossAndGradients(w.input, w.targets, w.mask, 12);
    const step = model.trainSyntheticStep(w.input, w.targets, w.mask, .08, 12);
    expect(step.loss).toBe(g.loss); expect(model.parameterCount).toBe(1066);
    model.layers.forEach((l, i) => l.weights.forEach((v, j) => {
      expect(v).toBeCloseTo(before[i][j] - .08 / Math.max(1, step.gradientNorm) * g.gradients[i].weights[j], 12);
    }));
    expect(model.layers.some((l, i) => [...l.weights].some((v, j) => v !== before[i][j]))).toBe(true);
  });
  it("memoriza sinais, retoma exatamente e não modifica fixtures", () => {
    const data = informativeDataset("memorization"), copy = structuredClone(data);
    const config = { seed: 21, epochs: 200, learningRate: .08, positiveWeight: 12, patience: 200, minDelta: 1e-6, maxMs: 60000 };
    const result = trainDataset(data, config), partial = trainDataset(data, config, { stopAtEpoch: 5 });
    expect(trainDataset(data, config, { resume: partial.checkpoint }).checkpoint).toBe(result.checkpoint);
    expect(decodeCheckpoint(result.checkpoint).epoch).toBe(200);
    expect(result.history.at(-1)!.trainLoss).toBeLessThan(.01);
    for (const r of data.filter(r => r.split === "train")) {
      const evaluation = evaluateRecording(result.model, r, .5);
      expect(evaluation.metrics.tp).toBe(r.events.length); expect(evaluation.metrics.fp).toBe(0); expect(evaluation.metrics.fn).toBe(0);
    }
    expect(data).toEqual(copy);
  }, 60000);
  it("recupera os alvos elegíveis de participantes separados após congelar threshold", () => {
    const data = informativeDataset("generalization");
    const result = trainDataset(data, { seed: 21, epochs: 200, learningRate: .08, positiveWeight: 12, patience: 200, minDelta: 1e-6, maxMs: 60000 });
    const selection = selectValidationThreshold(result.model, data.filter(r => r.split === "validation"));
    expect(selection.threshold).toBe(.6);
    const active = evaluateRecording(result.model, data[6], selection.threshold);
    expect([active.metrics.tp, active.metrics.fp, active.metrics.fn]).toEqual([3, 0, 0]);
    expect(active.unscoredReferenceEvents).toBe(1);
    expect(active.metrics.bySide.map(s => s.tp)).toEqual([1, 2]);
    expect(active.metrics.meanAbsoluteErrorMs).toBe(0);
    expect(evaluateRecording(result.model, data[7], selection.threshold).predicted).toEqual([]);
  }, 60000);
});
