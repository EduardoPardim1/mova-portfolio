import { INPUT_POINTS, normalizePose, prepareWindow, type PoseFrame } from "./data";

/** Somente QC: não detecta contatos, não treina e não exporta coordenadas. */
export function summarizePublicSample(frames: PoseFrame[], width: number, height: number, endMs: number) {
  if (!frames.length || frames.some((f, i) => !Number.isFinite(f.timeMs) || f.timeMs < 0 || f.timeMs >= endMs || (i > 0 && f.timeMs <= frames[i - 1].timeMs))) throw new Error("Timestamps ausentes, repetidos ou fora do trecho.");
  const rows = frames.map(frame => normalizePose(frame.landmarks, width, height));
  const intervals = frames.slice(1).map((frame, i) => frame.timeMs - frames[i].timeMs);
  const ordered = [...intervals].sort((a, b) => a - b), mid = Math.floor(ordered.length / 2);
  const median = ordered.length ? (ordered.length % 2 ? ordered[mid] : (ordered[mid - 1] + ordered[mid]) / 2) : null;
  const windows = [];
  for (let startMs = 0; startMs + 63 * 1000 / 30 < endMs; startMs += 64 * 1000 / 30) {
    const window = prepareWindow(frames, startMs, width, height);
    windows.push({ startMs, shape: [64, 30], missingFrames: window.missingFrames, eligibleOutputs: window.eligible.filter(Boolean).length });
  }
  return {
    frameCount: frames.length, poseDetected: frames.filter(f => f.landmarks.length === 33).length,
    fullFeatureFrames: rows.filter(row => INPUT_POINTS.every((_, i) => row[i * 3 + 2] === 1)).length,
    pointValidFrames: Object.fromEntries(INPUT_POINTS.map((id, i) => [id, rows.filter(row => row[i * 3 + 2] === 1).length])),
    visibility: Object.fromEntries([11, 12, ...INPUT_POINTS].map(id => {
      const values = frames.map(f => f.landmarks[id]?.visibility).filter((v): v is number => v !== undefined && Number.isFinite(v) && v >= 0 && v <= 1);
      return [id, { observed: values.length, atLeastHalf: values.filter(v => v >= .5).length,
        min: values.length ? Math.min(...values) : null, mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null }];
    })),
    noPoseTimesMs: frames.filter(f => f.landmarks.length !== 33).map(f => f.timeMs),
    sourceTimesMs: frames.map(f => f.timeMs), intervalsMs: intervals,
    observedMedianHz: median === null ? null : 1000 / median,
    firstMs: frames[0].timeMs, lastMs: frames.at(-1)!.timeMs,
    gapsOver50Ms: intervals.flatMap((gap, i) => gap > 50 ? [{ startMs: frames[i].timeMs, endMs: frames[i + 1].timeMs, gapMs: gap }] : []),
    windows, trainingPerformed: false, referenceContacts: null,
    laterality: "Índices esquerdo/direito do MediaPipe, sem verificação anatômica independente.",
  };
}
