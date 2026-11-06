import type { PoseSample } from "../pose-analysis";
import { analyseScientificInitialContactCandidates, type ScientificEventAnalysis } from "./gait-scientific-event-detector";
import type { VideoPerspective } from "./gait-ap-event-detector";

export type HighFrequencyTargetHz = 25 | 30;
export type PresentedFrameMetadata = { mediaTime: number; presentedFrames?: number };
export type HighFrequencyStatistics = {
  targetHz: HighFrequencyTargetHz;
  declaredFps: number | null;
  durationMs: number | null;
  callbacksObserved: number;
  samplesRequested: number;
  samplesAccepted: number;
  duplicateMediaTimestamps: number;
  presentationCounterTransitions: number | null;
  frameDistinctness: "not_verifiable";
  poseSamples: number;
  poseCoverage: number | null;
  extractionFailures: number;
  poseFailures: number;
  gaps: Array<{ fromMs: number; toMs: number; durationMs: number }>;
  effectiveSampleHz: number | null;
  cancelled: boolean;
};
export type HighFrequencyResult = { statistics: HighFrequencyStatistics; samples: PoseSample[]; scientific: ScientificEventAnalysis; limitations: string[] };

export function supportsPresentedFrameCallbacks(video: { requestVideoFrameCallback?: unknown } | null | undefined) { return typeof video?.requestVideoFrameCallback === "function"; }

/**
 * Alguns navegadores não emitem outro requestVideoFrameCallback depois do
 * último quadro apresentado. A interface também escuta `ended`, mas este
 * guard evita agendar trabalho inútil quando o último callback está no fim.
 */
export function hasVideoSamplingEnded(video: { ended: boolean; currentTime: number; duration: number }) {
  if (video.ended) return true;
  if (!Number.isFinite(video.duration) || video.duration <= 0 || !Number.isFinite(video.currentTime)) return false;
  return video.currentTime >= video.duration - .05;
}

/**
 * Sessão local para callbacks de frames apresentados. Ela não assume FPS nativo
 * e nunca declara que frames são visualmente distintos: o navegador não expõe
 * uma prova de conteúdo distinto para cada callback.
 */
export function createHighFrequencySamplingSession(options: { targetHz: HighFrequencyTargetHz; perspective: VideoPerspective; declaredFps?: number | null; durationMs?: number | null }) {
  const intervalMs = 1000 / options.targetHz;
  const samples: PoseSample[] = [];
  let callbacksObserved = 0, samplesRequested = 0, extractionFailures = 0, poseFailures = 0, duplicateMediaTimestamps = 0;
  let previousMediaTime: number | null = null, previousAcceptedTime: number | null = null, previousPresentedFrames: number | null = null, presentationCounterTransitions = 0, nextTargetMs = 0, cancelled = false;
  const gaps: HighFrequencyStatistics["gaps"] = [];
  function observe(metadata: PresentedFrameMetadata, extract: () => PoseSample | null) {
    callbacksObserved += 1;
    const timeMs = Math.round(metadata.mediaTime * 1000);
    if (!Number.isFinite(timeMs) || timeMs < 0) { extractionFailures += 1; return false; }
    if (previousMediaTime === timeMs) duplicateMediaTimestamps += 1;
    previousMediaTime = timeMs;
    if (metadata.presentedFrames !== undefined) {
      if (previousPresentedFrames !== null && metadata.presentedFrames > previousPresentedFrames) presentationCounterTransitions += 1;
      previousPresentedFrames = metadata.presentedFrames;
    }
    if (timeMs + .5 < nextTargetMs) return false;
    samplesRequested += 1;
    nextTargetMs = timeMs + intervalMs;
    let sample: PoseSample | null;
    try { sample = extract(); } catch { extractionFailures += 1; return false; }
    if (!sample) { poseFailures += 1; return false; }
    const normalized = { ...sample, timeMs };
    if (previousAcceptedTime !== null && timeMs - previousAcceptedTime > intervalMs * 2.5) gaps.push({ fromMs: previousAcceptedTime, toMs: timeMs, durationMs: timeMs - previousAcceptedTime });
    previousAcceptedTime = timeMs;
    samples.push(normalized);
    return true;
  }
  function cancel() { cancelled = true; }
  function finalize(): HighFrequencyResult {
    const effectiveSampleHz = medianHz(samples.map((sample) => sample.timeMs));
    const poseCoverage = samplesRequested ? samples.length / samplesRequested : null;
    const scientific = analyseScientificInitialContactCandidates(samples, options.perspective);
    return {
      statistics: { targetHz: options.targetHz, declaredFps: options.declaredFps ?? null, durationMs: options.durationMs ?? null, callbacksObserved, samplesRequested, samplesAccepted: samples.length, duplicateMediaTimestamps, presentationCounterTransitions: previousPresentedFrames === null ? null : presentationCounterTransitions, frameDistinctness: "not_verifiable", poseSamples: samples.length, poseCoverage, extractionFailures, poseFailures, gaps, effectiveSampleHz, cancelled },
      samples: [...samples], scientific,
      limitations: ["A contagem de apresentações do navegador não prova que o conteúdo visual de cada quadro seja distinto.", "FPS declarado não é disponibilizado de forma portável por HTMLVideoElement; permanece nulo sem metadado externo confiável.", "Nenhum vídeo, frame ou landmark é persistido ou enviado pelo pipeline."],
    };
  }
  return { observe, cancel, finalize };
}

function medianHz(times: number[]) {
  const intervals = times.slice(1).map((time, index) => time - times[index]).filter((value) => value > 0).sort((a, b) => a - b);
  if (!intervals.length) return null;
  return Number((1000 / intervals[Math.floor(intervals.length / 2)]).toFixed(2));
}
