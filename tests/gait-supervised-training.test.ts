import { describe, it, expect, vi } from "vitest";
import { syntheticTrainingDataset } from "../src/lib/experimental/temporal-ai/synthetic-training";
import { validateDataset, recordingWindows } from "../src/lib/experimental/temporal-ai/supervised-data";
import { trainDataset, decodeCheckpoint, encodeCheckpoint } from "../src/lib/experimental/temporal-ai/training";
import { evaluateDataset, evaluateRecording, eventMetrics } from "../src/lib/experimental/temporal-ai/evaluation";
import { TinyContactTcn } from "../src/lib/experimental/temporal-ai/tcn";
const config = { seed: 21, epochs: 6, learningRate: .02, positiveWeight: 3, patience: 6, minDelta: 1e-6, maxMs: 30000 };

describe("contrato supervisionado isolado", () => {
  it("valida normalização, grade, PTS e permissões declaradas", () => {
    expect(validateDataset(syntheticTrainingDataset())).toHaveLength(3);
    for (const mutate of [
      (d: ReturnType<typeof syntheticTrainingDataset>) => { d[0].frames[1].timeMs = 0; },
      (d: ReturnType<typeof syntheticTrainingDataset>) => { d[0].frames[1].sourceTimeMs = 0; },
      (d: ReturnType<typeof syntheticTrainingDataset>) => { d[0].frames[1].values[2] = .5; },
      (d: ReturnType<typeof syntheticTrainingDataset>) => { d[0].frames[1].values[0] = NaN; },
      (d: ReturnType<typeof syntheticTrainingDataset>) => { d[0].provenance.permissionEvidence = ""; },
      (d: ReturnType<typeof syntheticTrainingDataset>) => { d[0].reviewers = ["R1", "R1"]; },
    ]) { const d = syntheticTrainingDataset(); mutate(d); expect(() => validateDataset(d)).toThrow(); }
  });
  it("recusa vazamento por participante/hash e reservados", () => {
    for (const field of ["participantId", "sha256"] as const) { const d = syntheticTrainingDataset(); d[1][field] = d[0][field]; expect(() => validateDataset(d)).toThrow(/Vazamento/); }
    const d = syntheticTrainingDataset(); d[0].videoId = "P23-01"; expect(() => validateDataset(d)).toThrow(/reservado/);
  });
  it("mascara indeterminados nos dois lados inclusive entre células", () => {
    const d = syntheticTrainingDataset(), r = d[0];
    r.events.push({ timeMs: 1510, startMs: 1505, endMs: 1515, side: "unknown", status: "uncertain", reviewerIds: ["SYN-R1"] });
    const windows = [...recordingWindows(validateDataset(d)[0])];
    expect(windows[0].mask[45]).toEqual([0, 0]);
    expect(windows[0].targets[45]).toEqual([0, 0]);
  });
  it("incerteza confirmada não vira alvo nem negativo", () => {
    const d = syntheticTrainingDataset(); d[0].events[0].startMs -= 10; d[0].events[0].endMs += 10;
    const w = [...recordingWindows(validateDataset(d)[0])][0];
    expect(w.mask[36][0]).toBe(0); expect(w.targets[36][0]).toBe(0);
  });
  it("não duplica saídas e reinicia contexto após frame ausente", () => {
    const d = syntheticTrainingDataset(), r = d[0]; r.frames[40].sourceTimeMs = null; r.frames[40].values.fill(0);
    const windows = [...recordingWindows(validateDataset(d)[0])];
    const times = windows.flatMap(w => w.timesMs.slice(30)); expect(new Set(times).size).toBe(times.length); expect(times).toHaveLength(66);
    const eligible = windows.flatMap(w => w.timesMs.map((t, i) => ({ t, valid: w.eligible[i] })).slice(30));
    expect(eligible.filter(e => e.t >= 40 * 1000 / 30 && e.t <= 70 * 1000 / 30).every(e => !e.valid)).toBe(true);
    expect(eligible.at(-1)!.valid).toBe(true);
  });
  it("sem referência completa recusa treino", () => {
    const d = syntheticTrainingDataset(); d[0].complete = [];
    expect(() => trainDataset(d, config)).toThrow(/Sem rótulos/);
  });
});
describe("treinador e checkpoints", () => {
  it("para por orçamento de tempo antes de atualizar pesos", () => {
    const clock = vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(10);
    try {
      const result = trainDataset(syntheticTrainingDataset(), { ...config, maxMs: 1 });
      expect(result.reason).toBe("time"); expect(result.history).toHaveLength(1);
      expect(result.model.layers).toEqual(new TinyContactTcn(config.seed).layers);
    } finally { clock.mockRestore(); }
  });
  it("reproduz pesos e histórico com seed e retomada, sem mutar dataset", () => {
    const d = syntheticTrainingDataset(), original = structuredClone(d);
    const full = trainDataset(d, config), interrupted = trainDataset(d, config, { stopAtEpoch: 2 });
    const resumed = trainDataset(d, config, { resume: interrupted.checkpoint });
    expect(resumed.checkpoint).toBe(full.checkpoint);
    expect(trainDataset(d, config).checkpoint).toBe(full.checkpoint);
    expect(full.history.at(-1)!.trainLoss).toBeLessThan(full.history[0].trainLoss);
    expect(d).toEqual(original); expect(full.model.parameterCount).toBe(1066);
  });
  it("rejeita adulteração, configuração/dados divergentes e shape inválido", () => {
    const d = syntheticTrainingDataset(), run = trainDataset(d, config, { stopAtEpoch: 1 });
    expect(() => decodeCheckpoint(run.checkpoint.replace('"epoch":1', '"epoch":2'))).toThrow();
    expect(() => trainDataset(d, { ...config, seed: 2 }, { resume: run.checkpoint })).toThrow(/divergem/);
    d[0].frames[0].values[0] += .01;
    expect(() => trainDataset(d, config, { resume: run.checkpoint })).toThrow(/divergem/);
    const payload = decodeCheckpoint(run.checkpoint); payload.weights[0].weights.pop();
    expect(() => decodeCheckpoint(encodeCheckpoint(payload))).toThrow(/Pesos/);
  });
  it("para por paciência e não usa teste para selecionar pesos", () => {
    const d = syntheticTrainingDataset(), c = { ...config, minDelta: 100, patience: 2 };
    const a = trainDataset(d, c); expect(a.reason).toBe("patience"); expect(a.bestEpoch).toBe(0); expect(a.history).toHaveLength(3);
    d[2].events = [];
    const b = trainDataset(d, c); expect(b.history).toEqual(a.history); expect(b.model.layers).toEqual(a.model.layers);
  });
});
describe("avaliação de contatos", () => {
  it("retorna um pico por sequência, conserva resultados por participante e lado", () => {
    const model = new TinyContactTcn();
    for (const l of model.layers) { l.weights.fill(0); l.bias.fill(0); }
    model.layers.at(-1)!.bias.fill(2);
    const r = syntheticTrainingDataset()[2];
    const result = evaluateDataset(model, [r]);
    expect(result.recordings[0].predicted).toHaveLength(2);
    expect(result.participants[0].bySide).toHaveLength(2);
    expect(result.participants[0].tp).toBe(result.recordings[0].metrics.tp);
  });
  it("pareia um-a-um por pé e calcula TP/FP/FN/erro", () => {
    const m = eventMetrics([{ timeMs: 1000, side: "left" }, { timeMs: 2000, side: "right" }], [{ timeMs: 1050, side: "left" }, { timeMs: 1080, side: "left" }, { timeMs: 2500, side: "right" }], 100);
    expect([m.tp, m.fp, m.fn]).toEqual([1, 2, 1]); expect(m.precision).toBeCloseTo(1 / 3); expect(m.recall).toBe(.5); expect(m.f1).toBe(.4); expect(m.meanAbsoluteErrorMs).toBe(50);
    expect(m.bySide[1].fn).toBe(1);
  });
  it("limite inclusivo e lado divergente não contam como acerto", () => {
    expect(eventMetrics([{ timeMs: 1000, side: "left" }], [{ timeMs: 1100, side: "left" }], 100).tp).toBe(1);
    expect(eventMetrics([{ timeMs: 1000, side: "left" }], [{ timeMs: 1000, side: "right" }], 100).tp).toBe(0);
    expect(eventMetrics([], []).precision).toBeNull(); expect(eventMetrics([], []).f1).toBeNull();
  });
  it("dados incompletos ficam fora das métricas com cobertura explícita", () => {
    const r = syntheticTrainingDataset()[0]; r.complete = [];
    const result = evaluateRecording(new TinyContactTcn(), r);
    expect(result.labelCoverage).toBe(0); expect(result.metrics.tp).toBe(0); expect(result.metrics.fp).toBe(0); expect(result.metrics.fn).toBe(0); expect(result.unscoredReferenceEvents).toBe(5);
  });
});
