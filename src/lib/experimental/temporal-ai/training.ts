// Exclusivamente Node/CPU de desenvolvimento, nunca importado pelo produto clínico.
import { createHash } from "node:crypto";
import { z } from "zod";
import { TinyContactTcn } from "./tcn";
import { recordingWindows, validateDataset, type Recording } from "./supervised-data";

const configSchema = z.object({ seed: z.number().int().min(0).max(4294967295), epochs: z.number().int().min(1).max(200),
  learningRate: z.number().positive().max(.1), positiveWeight: z.number().min(1).max(100),
  patience: z.number().int().min(1).max(200), minDelta: z.number().finite().nonnegative(),
  maxMs: z.number().int().min(1).max(600000) }).strict();
export type TrainingConfig = z.infer<typeof configSchema>;
type Weights = { weights: number[]; bias: number[] }[];
type Epoch = { epoch: number; trainLoss: number; validationLoss: number };
export type Checkpoint = { version: 1; architecture: "mova-tcn-1066-v1"; datasetHash: string; config: TrainingConfig;
  epoch: number; bestEpoch: number; bestLoss: number; stale: number; weights: Weights; bestWeights: Weights; history: Epoch[] };
export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const snapshot = (model: TinyContactTcn): Weights => model.layers.map(l => ({ weights: [...l.weights], bias: [...l.bias] }));
function restore(model: TinyContactTcn, weights: Weights) {
  if (!Array.isArray(weights) || weights.length !== model.layers.length) throw new Error("Checkpoint incompatível.");
  weights.forEach((l, i) => {
    if (!l || !Array.isArray(l.weights) || !Array.isArray(l.bias) || l.weights.length !== model.layers[i].weights.length || l.bias.length !== model.layers[i].bias.length || [...l.weights, ...l.bias].some(v => typeof v !== "number" || !Number.isFinite(v))) throw new Error("Pesos inválidos.");
  });
  weights.forEach((l, i) => { model.layers[i].weights.set(l.weights); model.layers[i].bias.set(l.bias); });
}
export function encodeCheckpoint(payload: Checkpoint) { return JSON.stringify({ payload, sha256: digest(payload) }); }
export function decodeCheckpoint(text: string): Checkpoint {
  if (text.length > 1_000_000) throw new Error("Checkpoint acima do limite.");
  const envelope = JSON.parse(text);
  const p = envelope.payload as Checkpoint;
  if (!p || envelope.sha256 !== digest(p) || p.version !== 1 || p.architecture !== "mova-tcn-1066-v1" || !/^[a-f0-9]{64}$/.test(p.datasetHash)) throw new Error("Integridade/versão do checkpoint inválida.");
  configSchema.parse(p.config);
  if (!Number.isInteger(p.epoch) || p.epoch < 0 || p.epoch > p.config.epochs || !Number.isInteger(p.bestEpoch) || p.bestEpoch < 0 || p.bestEpoch > p.epoch || !Number.isFinite(p.bestLoss) || p.bestLoss < 0 || !Number.isInteger(p.stale) || p.stale < 0 || p.stale > p.epoch || !Array.isArray(p.history) || p.history.length !== p.epoch + 1 || p.history.some((e, i) => e.epoch !== i || !Number.isFinite(e.trainLoss) || e.trainLoss < 0 || !Number.isFinite(e.validationLoss) || e.validationLoss < 0)) throw new Error("Estado do checkpoint inválido.");
  restore(new TinyContactTcn(), p.weights); restore(new TinyContactTcn(), p.bestWeights);
  return p;
}

function loss(model: TinyContactTcn, records: Recording[], split: "train" | "validation", positiveWeight: number) {
  let sum = 0, count = 0;
  for (const r of records.filter(r => r.split === split)) for (const w of recordingWindows(r)) {
    const n = w.mask.flat().reduce((a, b) => a + b, 0);
    if (!n) continue;
    sum += model.lossAndGradients(w.input, w.targets, w.mask, positiveWeight).loss * n; count += n;
  }
  if (!count) throw new Error(`Sem rótulos elegíveis em ${split}.`);
  return sum / count;
}

/** SGD existente, ordem estável, uma janela por vez. Teste jamais seleciona pesos. */
export function trainDataset(value: unknown, configValue: TrainingConfig, options: { resume?: string; stopAtEpoch?: number; checkpoint?: (text: string) => void } = {}) {
  const records = validateDataset(value).sort((a, b) => a.videoId < b.videoId ? -1 : a.videoId > b.videoId ? 1 : 0);
  const config = configSchema.parse(configValue), datasetHash = digest(records), model = new TinyContactTcn(config.seed);
  const started = performance.now();
  if (options.stopAtEpoch !== undefined && (!Number.isInteger(options.stopAtEpoch) || options.stopAtEpoch < 0 || options.stopAtEpoch > config.epochs)) throw new Error("Época de interrupção inválida.");
  let state: Checkpoint;
  if (options.resume) {
    state = decodeCheckpoint(options.resume);
    if (state.datasetHash !== datasetHash || digest(state.config) !== digest(config)) throw new Error("Dataset/configuração divergem do checkpoint.");
    restore(model, state.weights);
  } else {
    const trainLoss = loss(model, records, "train", config.positiveWeight), validationLoss = loss(model, records, "validation", config.positiveWeight);
    state = { version: 1, architecture: "mova-tcn-1066-v1", datasetHash, config, epoch: 0, bestEpoch: 0, bestLoss: validationLoss, stale: 0,
      weights: snapshot(model), bestWeights: snapshot(model), history: [{ epoch: 0, trainLoss, validationLoss }] };
  }
  let reason = "epochs";
  while (state.epoch < config.epochs) {
    if (state.stale >= config.patience) { reason = "patience"; break; }
    if (performance.now() - started >= config.maxMs) { reason = "time"; break; }
    if (options.stopAtEpoch !== undefined && state.epoch >= options.stopAtEpoch) { reason = "checkpoint"; break; }
    for (const r of records.filter(r => r.split === "train")) for (const w of recordingWindows(r)) {
      if (performance.now() - started >= config.maxMs) { reason = "time"; break; }
      if (w.mask.some(row => row.some(Boolean))) model.trainSyntheticStep(w.input, w.targets, w.mask, config.learningRate, config.positiveWeight);
    }
    if (reason === "time") { restore(model, state.weights); break; } // descarta somente época incompleta em memória
    const epoch = state.epoch + 1, trainLoss = loss(model, records, "train", config.positiveWeight), validationLoss = loss(model, records, "validation", config.positiveWeight);
    state.epoch = epoch; state.weights = snapshot(model); state.history.push({ epoch, trainLoss, validationLoss });
    if (validationLoss < state.bestLoss - config.minDelta) { state.bestLoss = validationLoss; state.bestEpoch = epoch; state.bestWeights = snapshot(model); state.stale = 0; }
    else state.stale++;
    options.checkpoint?.(encodeCheckpoint(state));
  }
  const checkpoint = encodeCheckpoint(state);
  restore(model, state.bestWeights);
  return { model, checkpoint, history: state.history, bestEpoch: state.bestEpoch, reason, elapsedMs: performance.now() - started, datasetHash };
}
