// Ensaio matemático isolado: estes sinais não representam marcha ou pessoas.
import { syntheticTrainingDataset } from "./synthetic-training";
import { recordingWindows, validateDataset, type Recording } from "./supervised-data";
import { TinyContactTcn } from "./tcn";
import { evaluateDataset } from "./evaluation";
import { digest } from "./training";

export function informativeDataset(mode: "memorization" | "generalization"): Recording[] {
  const base = syntheticTrainingDataset()[0];
  // A partição pertence ao participante ANTES da extração de qualquer janela.
  const splits = ["train", "train", "train", "train", "validation", "validation", "test", "test"] as const;
  const records = splits.map((split, subject): Recording => {
    let seed = 700 + subject;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const empty = [3, 5, 7].includes(subject);
    const times = empty ? [] : [40, 60, 85, 110].map((t, i) => t + (mode === "generalization" ? (subject * 3 + i * 2) % 7 - 3 : 0));
    const sides = times.map((_, i) => (i + subject) % 2 ? "right" as const : "left" as const);
    const frames = Array.from({ length: 128 }, (_, t) => {
      const values = Array.from({ length: 30 }, (_, c) => c % 3 === 2 ? 1 : (random() - .5) * (mode === "generalization" ? .08 : .002));
      // Impulso dois quadros ANTES do alvo: o quadro do contato não contém o impulso.
      times.forEach((event, i) => { if (t === event - 2) values[sides[i] === "left" ? 24 : 27] += 2; });
      const missing = mode === "generalization" && subject % 2 === 0 && t === 66;
      return { timeMs: t * 1000 / 30, sourceTimeMs: missing ? null : t * 1000 / 30, values: missing ? Array(30).fill(0) as number[] : values };
    });
    const events: Recording["events"] = times.map((t, i) => ({ timeMs: frames[t].timeMs, startMs: frames[t].timeMs, endMs: frames[t].timeMs,
      side: sides[i], status: "confirmed", reviewerIds: ["SYN-R1", "SYN-R2"] }));
    if (mode === "generalization" && subject === 2) events.push({ timeMs: frames[100].timeMs, startMs: frames[99].timeMs, endMs: frames[101].timeMs, side: "unknown", status: "uncertain", reviewerIds: ["SYN-R1"] });
    return { ...base, participantId: `S8-${subject}`, videoId: `S8-${mode}-${subject}`, split,
      sha256: digest(frames), frames, events, complete: (["left", "right"] as const).map(side => ({ side, startMs: 0, endMs: frames.at(-1)!.timeMs })),
      provenance: { ...base.provenance, source: `sinais matemáticos stage8-${mode}-v1` } };
  });
  return validateDataset(records);
}

export function auditScores(model: TinyContactTcn, records: Recording[]) {
  return records.map(r => {
    const positive: { timeMs: number; side: string; probability: number }[] = [], negative: number[] = [];
    let maskedCells = 0, maskedTargets = 0;
    for (const w of recordingWindows(r)) {
      const scores = model.scores(w.input);
      for (let t = 30; t < w.input.length; t++) for (let s = 0; s < 2; s++) {
        if (!w.mask[t][s]) { maskedCells++; maskedTargets += w.targets[t][s]; continue; }
        if (w.targets[t][s]) positive.push({ timeMs: w.timesMs[t], side: s ? "right" : "left", probability: scores[t][s] });
        else negative.push(scores[t][s]);
      }
    }
    return { participantId: r.participantId, split: r.split, positive, positiveCount: positive.length, negativeCount: negative.length,
      maskedCells, warmupCells: 60, maskedTargets, negativeMean: negative.reduce((a, b) => a + b, 0) / negative.length, negativeMax: Math.max(...negative) };
  });
}

export const THRESHOLDS = [.2, .3, .4, .5, .6] as const;
export function selectValidationThreshold(model: TinyContactTcn, validation: Recording[]) {
  if (!validation.length || validation.some(r => r.split !== "validation")) throw new Error("Seleção aceita exclusivamente validação.");
  const candidates = THRESHOLDS.map(threshold => {
    const rows = evaluateDataset(model, validation, threshold, 100).recordings;
    const tp = rows.reduce((n, r) => n + r.metrics.tp, 0), fp = rows.reduce((n, r) => n + r.metrics.fp, 0), fn = rows.reduce((n, r) => n + r.metrics.fn, 0);
    return { threshold, tp, fp, fn, f1: 2 * tp + fp + fn ? 2 * tp / (2 * tp + fp + fn) : 0 };
  });
  // Critério pré-definido: F1, menos FP, depois threshold maior. Nunca consulta teste.
  const selected = [...candidates].sort((a, b) => b.f1 - a.f1 || a.fp - b.fp || b.threshold - a.threshold)[0];
  return { threshold: selected.threshold, candidates, validationHash: digest(validation) };
}
