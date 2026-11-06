import { prepareWindow, type PoseFrame } from "./data";
import { TinyContactTcn } from "./tcn";

/** Prova de transporte de dados reais, não detecção: escores não são exportados. */
export function probeUntrainedTcn(frames: PoseFrame[], width: number, height: number, endMs: number) {
  if (!frames.length || !Number.isFinite(endMs) || endMs <= 0 || endMs > 12000) throw new Error("Trecho técnico inválido.");
  const started = performance.now(), model = new TinyContactTcn(21);
  const weights = model.layers.map(l => [...l.weights, ...l.bias]);
  const windows = [];
  for (let startMs = 0; startMs + 63 * 1000 / 30 < endMs; startMs += 64 * 1000 / 30) {
    const window = prepareWindow(frames, startMs, width, height);
    const scores = model.scores(window.input);
    if (scores.length !== 64 || scores.some(row => row.length !== 2 || row.some(v => !Number.isFinite(v) || v < 0 || v > 1))) throw new Error("Saída técnica inválida.");
    windows.push({ startMs, inputShape: [64, 30], outputShape: [64, 2], finiteScores: scores.flat().length,
      validPointMasks: window.input.reduce((n, row) => n + row.filter((_, i) => i % 3 === 2).reduce((a, b) => a + b, 0), 0),
      missingFrames: window.missingFrames, eligibleOutputs: window.eligible.filter(Boolean).length,
      sourceTimesMs: window.sourceTimesMs, gridTimesMs: window.timesMs });
  }
  const weightsUnchanged = model.layers.every((l, i) => [...l.weights, ...l.bias].every((v, j) => v === weights[i][j]));
  if (!weightsUnchanged) throw new Error("Os pesos não podem mudar no ensaio técnico.");
  return { seed: 21, parameterCount: model.parameterCount, weights: "random-initialization-not-trained", weightsUnchanged,
    windows, inferenceMs: performance.now() - started, trainingPerformed: false, contactsInferred: false,
    interpretation: "Saídas finitas confirmam execução, não validade, contatos ou confiança clínica." };
}
