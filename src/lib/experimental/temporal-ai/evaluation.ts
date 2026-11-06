import { compareCandidateTimes } from "../gait-candidate-comparison";
import { type Side } from "./data";
import { recordingWindows, type Recording } from "./supervised-data";
import { TinyContactTcn } from "./tcn";

export type Event = { timeMs: number; side: Side };
export function eventMetrics(reference: Event[], predicted: Event[], toleranceMs = 100) {
  if (!Number.isFinite(toleranceMs) || toleranceMs < 0 || toleranceMs > 1000 || reference.length > 1000 || predicted.length > 1000) throw new Error("Limite de avaliação inválido.");
  for (const e of [...reference, ...predicted]) if (!Number.isFinite(e.timeMs) || e.timeMs < 0 || !["left", "right"].includes(e.side)) throw new Error("Evento inválido.");
  const bySide = (["left", "right"] as const).map(side => {
    const refs = reference.filter(e => e.side === side), autos = predicted.filter(e => e.side === side);
    const endMs = Math.max(0, ...refs.map(e => e.timeMs), ...autos.map(e => e.timeMs));
    const match = compareCandidateTimes(refs, autos, { startMs: 0, endMs }, toleranceMs);
    return { side, tp: match.matches.length, fp: match.unmatchedCandidates.length, fn: match.unmatchedHuman.length, errorsMs: match.matches.map(m => m.errorMs), matches: match.matches };
  });
  const summarize = (tp: number, fp: number, fn: number, errorsMs: number[]) => ({ tp, fp, fn,
    precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null,
    f1: 2 * tp + fp + fn ? 2 * tp / (2 * tp + fp + fn) : null,
    meanAbsoluteErrorMs: errorsMs.length ? errorsMs.reduce((a, b) => a + Math.abs(b), 0) / errorsMs.length : null,
    meanSignedErrorMs: errorsMs.length ? errorsMs.reduce((a, b) => a + b, 0) / errorsMs.length : null, errorsMs });
  return { ...summarize(bySide.reduce((n, s) => n + s.tp, 0), bySide.reduce((n, s) => n + s.fp, 0), bySide.reduce((n, s) => n + s.fn, 0), bySide.flatMap(s => s.errorsMs)),
    bySide: bySide.map(s => ({ ...s, ...summarize(s.tp, s.fp, s.fn, s.errorsMs) })) };
}

/** Um máximo por sequência contígua acima do threshold; parâmetros fixados antes do teste. */
export function evaluateRecording(model: TinyContactTcn, r: Recording, threshold = .5, toleranceMs = 100) {
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold >= 1) throw new Error("Threshold inválido.");
  const cells: { timeMs: number; scores: number[]; mask: number[]; pose: boolean }[] = [];
  for (const w of recordingWindows(r)) {
    const scores = model.scores(w.input);
    for (let t = 30; t < w.input.length; t++) cells.push({ timeMs: w.timesMs[t], scores: scores[t], mask: w.mask[t], pose: w.eligible[t] });
  }
  const predicted: Event[] = [];
  (["left", "right"] as const).forEach((side, s) => {
    let peak: { timeMs: number; score: number } | undefined;
    const flush = () => { if (peak) predicted.push({ timeMs: peak.timeMs, side }); peak = undefined; };
    for (const cell of cells) {
      if (!cell.mask[s] || cell.scores[s] < threshold) { flush(); continue; }
      if (!peak || cell.scores[s] > peak.score) peak = { timeMs: cell.timeMs, score: cell.scores[s] };
    }
    flush();
  });
  const reference: Event[] = [];
  for (const e of r.events) {
    if (e.status !== "confirmed" || e.side === "unknown" || e.startMs !== e.endMs) continue;
    // Mesmo arredondamento da criação dos alvos. No ponto médio, procurar a
    // primeira célula dentro de meia amostra escolhia erroneamente a anterior.
    const frame = Math.round((e.timeMs - r.frames[0].timeMs) * 30 / 1000);
    const cell = cells.find(c => c.timeMs === r.frames[frame]?.timeMs);
    if (cell?.mask[e.side === "left" ? 0 : 1]) reference.push({ timeMs: e.timeMs, side: e.side });
  }
  return { participantId: r.participantId, videoId: r.videoId, split: r.split, threshold, toleranceMs,
    totalFrames: r.frames.length, poseEligibleFrames: cells.filter(c => c.pose).length,
    poseCoverage: cells.filter(c => c.pose).length / r.frames.length,
    labeledSideCells: cells.reduce((n, c) => n + c.mask[0] + c.mask[1], 0),
    labelCoverage: cells.reduce((n, c) => n + c.mask[0] + c.mask[1], 0) / (r.frames.length * 2),
    indeterminateEvents: r.events.filter(e => e.status !== "confirmed" || e.side === "unknown" || e.startMs !== e.endMs).length,
    unscoredReferenceEvents: r.events.length - reference.length,
    metrics: eventMetrics(reference, predicted, toleranceMs), reference, predicted };
}

export function evaluateDataset(model: TinyContactTcn, records: Recording[], threshold = .5, toleranceMs = 100) {
  const recordings = records.map(r => evaluateRecording(model, r, threshold, toleranceMs));
  const participants = [...new Set(records.map(r => r.participantId))].map(participantId => {
    const rows = recordings.filter(r => r.participantId === participantId);
    // Agregação de contagens, jamais pareamento entre gravações.
    const tp = rows.reduce((n, r) => n + r.metrics.tp, 0), fp = rows.reduce((n, r) => n + r.metrics.fp, 0), fn = rows.reduce((n, r) => n + r.metrics.fn, 0);
    const errorsMs = rows.flatMap(r => r.metrics.errorsMs);
    return { participantId, tp, fp, fn, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null,
      f1: 2 * tp + fp + fn ? 2 * tp / (2 * tp + fp + fn) : null, errorsMs,
      meanAbsoluteErrorMs: errorsMs.length ? errorsMs.reduce((a, b) => a + Math.abs(b), 0) / errorsMs.length : null,
      totalFrames: rows.reduce((n, r) => n + r.totalFrames, 0),
      poseEligibleFrames: rows.reduce((n, r) => n + r.poseEligibleFrames, 0),
      indeterminateEvents: rows.reduce((n, r) => n + r.indeterminateEvents, 0),
      bySide: (["left", "right"] as const).map(side => {
        const metrics = rows.flatMap(r => r.metrics.bySide.filter(s => s.side === side));
        const tp = metrics.reduce((n, m) => n + m.tp, 0), fp = metrics.reduce((n, m) => n + m.fp, 0), fn = metrics.reduce((n, m) => n + m.fn, 0);
        return { side, tp, fp, fn, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null,
          f1: 2 * tp + fp + fn ? 2 * tp / (2 * tp + fp + fn) : null, errorsMs: metrics.flatMap(m => m.errorsMs) };
      }) };
  });
  return { recordings, participants };
}
