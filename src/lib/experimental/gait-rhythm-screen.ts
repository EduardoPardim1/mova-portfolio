import type { PoseSample } from "../pose-analysis";

export type RhythmPerspective = "frontal" | "posterior" | "lateral" | "oblique" | "indeterminate";

export type RhythmSegment = {
  sampleCount: number;
  durationMs: number;
  amplitude: number | null;
  medianIntervalMs: number | null;
  intervalVariation: number | null;
  bestLagMs: number | null;
  periodicityScore: number | null;
  repeatedPattern: boolean;
  reason: "ok" | "insufficient_samples" | "flat_signal" | "irregular_timestamps";
};

export type RhythmScreenAnalysis = {
  method: "foot-separation-rhythm-v1";
  perspective: RhythmPerspective;
  eligible: boolean;
  input: {
    totalSamples: number;
    usableSamples: number;
    rejectedMissingLandmarks: number;
    rejectedLowVisibility: number;
    duplicateOrNonMonotonicTimestamps: number;
  };
  segments: RhythmSegment[];
  limitations: string[];
};

type Point = { timeMs: number; value: number };

const MINIMUM_VISIBILITY = 0.35;
const MINIMUM_SAMPLES = 12;

/**
 * Triagem experimental de repetição no sinal de separação 2D entre tornozelos.
 * É destinada somente a vistas frontal/posterior e nunca nomeia passos, cadência,
 * contato inicial ou retirada do pé.
 */
export function analyseFootSeparationRhythm(samples: PoseSample[], perspective: RhythmPerspective): RhythmScreenAnalysis {
  const prepared = prepare(samples);
  const limitations = [
    "Periodicidade de separação 2D não confirma contato com o solo, passo, cadência ou fase da marcha.",
    "O sinal depende dos mesmos landmarks MediaPipe e varia com perspectiva, escala, oclusão, troca de lado e movimento de câmera.",
    "A triagem não produz eventos, não persiste métricas e não altera o motor 0.3.",
  ];
  if (perspective !== "frontal" && perspective !== "posterior") {
    limitations.push("Triagem de ritmo recusada: o método foi delimitado a perspectiva frontal ou posterior declarada.");
    return {
      method: "foot-separation-rhythm-v1", perspective, eligible: false, input: prepared.input, segments: [], limitations,
    };
  }

  const points = prepared.samples.map((sample) => ({
    timeMs: sample.timeMs,
    value: Math.hypot(sample.leftAnkleX! - sample.rightAnkleX!, sample.leftAnkleY - sample.rightAnkleY),
  }));
  const segments = split(points).map(analyseSegment);
  if (!segments.some((segment) => segment.repeatedPattern)) {
    limitations.push("Nenhum segmento apresentou repetição temporal sob os critérios técnicos desta triagem; isto não demonstra ausência de marcha.");
  }
  return { method: "foot-separation-rhythm-v1", perspective, eligible: true, input: prepared.input, segments, limitations };
}

function prepare(samples: PoseSample[]) {
  const chronological = samples
    .filter((sample) => Number.isFinite(sample.timeMs))
    .map((sample, index) => ({ sample, index }))
    .sort((left, right) => left.sample.timeMs - right.sample.timeMs || left.index - right.index);
  let rejectedMissingLandmarks = 0;
  let rejectedLowVisibility = 0;
  let duplicateOrNonMonotonicTimestamps = samples.reduce((count, sample, index) => count + (index > 0 && Number.isFinite(sample.timeMs) && Number.isFinite(samples[index - 1].timeMs) && sample.timeMs <= samples[index - 1].timeMs ? 1 : 0), 0);
  const seen = new Set<number>();
  const usable: Array<PoseSample & { leftAnkleX: number; rightAnkleX: number; leftAnkleY: number; rightAnkleY: number }> = [];
  for (const { sample } of chronological) {
    if (seen.has(sample.timeMs)) { duplicateOrNonMonotonicTimestamps += 1; continue; }
    seen.add(sample.timeMs);
    if (sample.visibility < MINIMUM_VISIBILITY) { rejectedLowVisibility += 1; continue; }
    if (!finite(sample.leftAnkleX) || !finite(sample.rightAnkleX) || !finite(sample.leftAnkleY) || !finite(sample.rightAnkleY)) { rejectedMissingLandmarks += 1; continue; }
    usable.push(sample as PoseSample & { leftAnkleX: number; rightAnkleX: number; leftAnkleY: number; rightAnkleY: number });
  }
  return {
    samples: usable,
    input: {
      totalSamples: chronological.length,
      usableSamples: usable.length,
      rejectedMissingLandmarks,
      rejectedLowVisibility,
      duplicateOrNonMonotonicTimestamps,
    },
  };
}

function split(points: Point[]) {
  if (!points.length) return [] as Point[][];
  const intervals = points.slice(1).map((point, index) => point.timeMs - points[index].timeMs).filter((value) => value > 0).sort((left, right) => left - right);
  const median = intervals.length ? intervals[Math.floor(intervals.length / 2)] : 100;
  const maximumGap = Math.max(350, median * 2.5);
  return points.reduce<Point[][]>((all, point) => {
    const current = all.at(-1); const previous = current?.at(-1);
    if (!current || !previous || point.timeMs - previous.timeMs > maximumGap) all.push([point]); else current.push(point);
    return all;
  }, []);
}

function analyseSegment(points: Point[]): RhythmSegment {
  if (points.length < MINIMUM_SAMPLES) return empty(points, "insufficient_samples");
  const intervals = points.slice(1).map((point, index) => point.timeMs - points[index].timeMs);
  const medianIntervalMs = median(intervals);
  const intervalVariation = coefficientOfVariation(intervals);
  if (!medianIntervalMs || intervalVariation === null || intervalVariation > 0.35) return { ...empty(points, "irregular_timestamps"), medianIntervalMs, intervalVariation };
  const values = points.map((point) => point.value);
  const amplitude = Math.max(...values) - Math.min(...values);
  if (amplitude < 0.02) return { ...empty(points, "flat_signal"), amplitude, medianIntervalMs, intervalVariation };
  const minLag = Math.max(2, Math.ceil(400 / medianIntervalMs));
  const maxLag = Math.min(values.length - 3, Math.floor(2200 / medianIntervalMs));
  let bestLag = -1;
  let periodicityScore = -1;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const score = normalizedAutocorrelation(values, lag);
    if (score > periodicityScore) { bestLag = lag; periodicityScore = score; }
  }
  const repeatedPattern = bestLag > 0 && periodicityScore >= 0.6 && values.length >= bestLag * 2 + 2;
  return {
    sampleCount: points.length,
    durationMs: points.at(-1)!.timeMs - points[0].timeMs,
    amplitude: round(amplitude),
    medianIntervalMs: round(medianIntervalMs),
    intervalVariation: round(intervalVariation),
    bestLagMs: bestLag > 0 ? Math.round(bestLag * medianIntervalMs) : null,
    periodicityScore: bestLag > 0 ? round(periodicityScore) : null,
    repeatedPattern,
    reason: "ok",
  };
}

function empty(points: Point[], reason: RhythmSegment["reason"]): RhythmSegment {
  return { sampleCount: points.length, durationMs: points.length > 1 ? points.at(-1)!.timeMs - points[0].timeMs : 0, amplitude: null, medianIntervalMs: null, intervalVariation: null, bestLagMs: null, periodicityScore: null, repeatedPattern: false, reason };
}

function normalizedAutocorrelation(values: number[], lag: number) {
  const left = values.slice(0, values.length - lag);
  const right = values.slice(lag);
  const leftMean = mean(left); const rightMean = mean(right);
  let numerator = 0; let leftMagnitude = 0; let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] - leftMean; const b = right[index] - rightMean;
    numerator += a * b; leftMagnitude += a * a; rightMagnitude += b * b;
  }
  return leftMagnitude && rightMagnitude ? numerator / Math.sqrt(leftMagnitude * rightMagnitude) : -1;
}

function median(values: number[]) { const sorted = [...values].sort((left, right) => left - right); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; }
function mean(values: number[]) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function coefficientOfVariation(values: number[]) { if (!values.length) return null; const average = mean(values); if (!average) return null; return Math.sqrt(mean(values.map((value) => (value - average) ** 2))) / average; }
function round(value: number) { return Number(value.toFixed(3)); }
function finite(value: number | null | undefined): value is number { return typeof value === "number" && Number.isFinite(value); }
