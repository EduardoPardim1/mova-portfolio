import type { HighFrequencyResult, HighFrequencyStatistics } from "./gait-high-frequency-pipeline";

type Side = "left" | "right" | "unknown";
export type TimedContact = { timeMs: number; side: Side };
export type CandidateRunExport = {
  version: 1;
  videoId: string;
  runId: string;
  exportedAt: string;
  method: string;
  eligible: boolean;
  unavailableReason: string | null;
  motionDirectionInImage: string;
  processingMs: number | null;
  statistics: HighFrequencyStatistics;
  candidates: Array<TimedContact & { status: "accepted" | "rejected"; rejectionReason: string | null }>;
};

/** Whitelist: não serializa samples, coordenadas, sinais ou landmarks. */
export function exportCandidateRun(result: HighFrequencyResult, metadata: { videoId: string; runId: string; exportedAt: string; processingMs: number | null }): CandidateRunExport {
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(metadata.videoId)) throw new Error("Defina um ID anônimo válido para o vídeo.");
  const s = result.statistics;
  return {
    version: 1, videoId: metadata.videoId, runId: metadata.runId, exportedAt: metadata.exportedAt,
    method: result.scientific.method, eligible: result.scientific.eligible,
    unavailableReason: result.scientific.unavailableReason, motionDirectionInImage: result.scientific.motionDirectionInImage,
    processingMs: metadata.processingMs,
    statistics: {
      targetHz: s.targetHz, declaredFps: s.declaredFps, durationMs: s.durationMs, callbacksObserved: s.callbacksObserved,
      samplesRequested: s.samplesRequested, samplesAccepted: s.samplesAccepted, duplicateMediaTimestamps: s.duplicateMediaTimestamps,
      presentationCounterTransitions: s.presentationCounterTransitions, frameDistinctness: s.frameDistinctness,
      poseSamples: s.poseSamples, poseCoverage: s.poseCoverage, extractionFailures: s.extractionFailures,
      poseFailures: s.poseFailures, gaps: s.gaps.map(({ fromMs, toMs, durationMs }) => ({ fromMs, toMs, durationMs })),
      effectiveSampleHz: s.effectiveSampleHz, cancelled: s.cancelled,
    },
    candidates: result.scientific.candidates.map(({ timeMs, side, status, rejectionReason }) => ({ timeMs, side, status, rejectionReason })),
  };
}

/** Comparação exploratória temporal; lado é auditado após o pareamento. */
export function compareCandidateTimes(human: TimedContact[], candidates: TimedContact[], window: { startMs: number; endMs: number }, toleranceMs = 100) {
  if (!Number.isFinite(window.startMs) || !Number.isFinite(window.endMs) || window.startMs < 0 || window.startMs > window.endMs || !Number.isFinite(toleranceMs) || toleranceMs < 0) throw new Error("Janela ou tolerância inválida.");
  for (const event of [...human, ...candidates]) {
    if (!Number.isFinite(event.timeMs) || event.timeMs < 0 || !["left", "right", "unknown"].includes(event.side)) throw new Error("Evento temporal inválido.");
  }
  if (human.some((h) => h.timeMs < window.startMs || h.timeMs > window.endMs)) throw new Error("Contato humano fora do trecho anotado.");
  const inside = (c: TimedContact) => c.timeMs >= window.startMs && c.timeMs <= window.endMs;
  const refs = human.map(({ timeMs, side }, index) => ({ timeMs, side, index })).sort((a, b) => a.timeMs - b.timeMs || a.index - b.index);
  const all = candidates.map(({ timeMs, side }, index) => ({ timeMs, side, index })).sort((a, b) => a.timeMs - b.timeMs || a.index - b.index);
  const autos = all.filter(inside);
  // DP ordenada: maximiza pares e depois minimiza soma do erro absoluto.
  // Em caso de empate completo, prefere o par mais cedo. Sem uso do lado.
  type Cell = { count: number; error: number; action: "match" | "human" | "candidate" | "end" };
  const dp: Cell[][] = Array.from({ length: refs.length + 1 }, () => Array.from({ length: autos.length + 1 }, () => ({ count: 0, error: 0, action: "end" })));
  const better = (a: Cell, b: Cell) => a.count > b.count || a.count === b.count && a.error < b.error;
  for (let i = refs.length - 1; i >= 0; i--) {
    for (let j = autos.length - 1; j >= 0; j--) {
      let best: Cell = { ...dp[i + 1][j], action: "human" };
      const skip: Cell = { ...dp[i][j + 1], action: "candidate" };
      if (better(skip, best)) best = skip;
      const error = Math.abs(refs[i].timeMs - autos[j].timeMs);
      if (error <= toleranceMs) {
        const next = dp[i + 1][j + 1];
        const pair: Cell = { count: next.count + 1, error: next.error + error, action: "match" };
        if (better(pair, best) || pair.count === best.count && pair.error === best.error) best = pair;
      }
      dp[i][j] = best;
    }
  }
  const matches: Array<{ humanIndex: number; candidateIndex: number; humanTimeMs: number; candidateTimeMs: number; errorMs: number; absoluteErrorMs: number; humanSide: Side; candidateSide: Side; sideAgreement: boolean | null }> = [];
  let i = 0, j = 0;
  while (i < refs.length && j < autos.length) {
    const action = dp[i][j].action;
    if (action === "match") {
      const h = refs[i++], a = autos[j++], errorMs = a.timeMs - h.timeMs;
      matches.push({ humanIndex: h.index, candidateIndex: a.index, humanTimeMs: h.timeMs, candidateTimeMs: a.timeMs, errorMs, absoluteErrorMs: Math.abs(errorMs), humanSide: h.side, candidateSide: a.side, sideAgreement: h.side === "unknown" || a.side === "unknown" ? null : h.side === a.side });
    } else if (action === "human") i++;
    else if (action === "candidate") j++;
    else break;
  }
  const matchedHuman = new Set(matches.map((m) => m.humanIndex));
  const matchedAuto = new Set(matches.map((m) => m.candidateIndex));
  return {
    toleranceMs, window, matches,
    unmatchedHuman: refs.filter((h) => !matchedHuman.has(h.index)),
    unmatchedCandidates: autos.filter((a) => !matchedAuto.has(a.index)),
    outsideCandidates: all.filter((a) => !inside(a)),
    insideCandidates: autos,
    candidateIntervals: all.slice(1).map((a, index) => ({ fromIndex: all[index].index, toIndex: a.index, intervalMs: a.timeMs - all[index].timeMs })),
    nearCandidatePairs: all.flatMap((a, index) => all.slice(index + 1).filter((b) => b.timeMs - a.timeMs <= toleranceMs).map((b) => ({ firstIndex: a.index, secondIndex: b.index, intervalMs: b.timeMs - a.timeMs, sameSide: a.side === b.side }))),
  };
}
