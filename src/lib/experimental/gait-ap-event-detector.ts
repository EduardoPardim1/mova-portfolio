import { analysePoseSamples, type PoseSample } from "../pose-analysis";

export type VideoPerspective = "lateral" | "frontal" | "posterior" | "oblique" | "indeterminate";
export type ApSide = "left" | "right";
export type ApCandidateKind = "temporal_extremum" | "pelvis_crossing";
export type ApCandidateStatus = "accepted" | "rejected";

export type ApCandidate = {
  timeMs: number;
  side: ApSide;
  kind: ApCandidateKind;
  signalValue: number;
  prominence: number | null;
  intervalSincePreviousMs: number | null;
  status: ApCandidateStatus;
  rejectionReason: "insufficient_prominence" | "minimum_spacing" | "insufficient_crossing_excursion" | null;
  landmarkQuality: number;
  segmentIndex: number;
};

export type ApEvent = Pick<ApCandidate, "timeMs" | "side" | "kind" | "signalValue" | "prominence" | "landmarkQuality" | "segmentIndex">;

export type ApSignalDiagnostic = {
  side: ApSide;
  contiguousSegments: number;
  extremaCandidates: number;
  crossingCandidates: number;
  accepted: number;
  rejectedByProminence: number;
  rejectedBySpacing: number;
  rejectedByCrossingExcursion: number;
};

export type ApEventAnalysis = {
  method: "pelvis-relative-horizontal-v1";
  perspective: VideoPerspective;
  eligible: boolean;
  footDefinition: "ankle";
  motionDirectionInImage: "positive-x" | "negative-x" | "indeterminate";
  input: {
    totalSamples: number;
    usableSamples: number;
    detectionRate: number | null;
    duplicateOrNonMonotonicTimestamps: number;
    rejectedLowConfidence: number;
    rejectedMissingLandmarks: number;
  };
  events: ApEvent[];
  candidates: ApCandidate[];
  diagnostics: ApSignalDiagnostic[];
  limitations: string[];
};

export type GaitMethodComparison = {
  perspective: VideoPerspective;
  comparable: boolean;
  verticalV03: {
    acceptedEvents: Array<{ timeMs: number; side: ApSide }>;
    signalDiagnostics: ReturnType<typeof analysePoseSamples>["signalDiagnostics"];
  };
  apExperimental: ApEventAnalysis;
  limitations: string[];
};

type SignalPoint = { timeMs: number; value: number; visibility: number };
type SignalSegment = SignalPoint[];

const MINIMUM_VISIBILITY = 0.35;
const MINIMUM_SAMPLES_PER_SEGMENT = 3;
const MINIMUM_SPACING_MS = 280;

/**
 * Detecta somente candidatos temporais num eixo horizontal relativo à pelve.
 * O eixo da imagem é chamado de "AP" apenas se o chamador já classificou a
 * aquisição como lateral; esta função não confirma contato inicial ou toe-off.
 */
export function analysePelvisRelativeApCandidates(samples: PoseSample[], perspective: VideoPerspective = "indeterminate"): ApEventAnalysis {
  const prepared = prepareSamples(samples);
  const input = {
    totalSamples: samples.filter((sample) => Number.isFinite(sample.timeMs)).length,
    usableSamples: prepared.usable.length,
    detectionRate: samples.filter((sample) => Number.isFinite(sample.timeMs)).length ? prepared.usable.length / samples.filter((sample) => Number.isFinite(sample.timeMs)).length : null,
    duplicateOrNonMonotonicTimestamps: prepared.duplicateOrNonMonotonicTimestamps,
    rejectedLowConfidence: prepared.rejectedLowConfidence,
    rejectedMissingLandmarks: prepared.rejectedMissingLandmarks,
  };
  const limitations = [
    "Os eventos são candidatos baseados em landmarks 2D e não confirmam contato inicial, heel strike ou toe-off.",
    "O sinal usa tornozelo relativo ao centro da pelve; calcanhar e ponta são preservados na amostra, mas não são substituídos silenciosamente.",
    "O eixo horizontal da imagem só é um proxy AP em aquisição lateral adequada; não corrige perspectiva, profundidade, oclusão ou rotação corporal.",
  ];

  if (perspective !== "lateral") {
    limitations.push("Comparação AP não executada: a perspectiva não foi classificada como lateral com evidência disponível.");
    return {
      method: "pelvis-relative-horizontal-v1", perspective, eligible: false, footDefinition: "ankle",
      motionDirectionInImage: "indeterminate", input, events: [], candidates: [],
      diagnostics: [emptyDiagnostic("left"), emptyDiagnostic("right")], limitations,
    };
  }

  const candidates: ApCandidate[] = [];
  const diagnostics: ApSignalDiagnostic[] = [];
  for (const side of ["left", "right"] as const) {
    const points = prepared.usable.map((sample) => ({
      timeMs: sample.timeMs,
      value: (side === "left" ? sample.leftAnkleX! : sample.rightAnkleX!) - sample.hipCenterX!,
      visibility: sample.visibility,
    }));
    const result = analyseSide(points, side);
    candidates.push(...result.candidates);
    diagnostics.push(result.diagnostic);
  }
  const events = candidates.filter((candidate) => candidate.status === "accepted").map(({ timeMs, side, kind, signalValue, prominence, landmarkQuality, segmentIndex }) => ({ timeMs, side, kind, signalValue, prominence, landmarkQuality, segmentIndex }));
  const motionDirectionInImage = inferImageDirection(prepared.usable.map((sample) => sample.hipCenterX!));
  if (motionDirectionInImage === "indeterminate") limitations.push("Direção de progressão na imagem indeterminada; os candidatos não recebem rótulo biomecânico.");
  if (!events.length) limitations.push("Nenhum candidato AP foi aceito sob os critérios temporais experimentais.");

  return { method: "pelvis-relative-horizontal-v1", perspective, eligible: true, footDefinition: "ankle", motionDirectionInImage, input, events, candidates, diagnostics, limitations };
}

/** Comparação reprodutível: o motor 0.3 não é alterado e recebe a mesma série local. */
export function compareVerticalV03WithAp(samples: PoseSample[], durationSeconds: number, perspective: VideoPerspective): GaitMethodComparison {
  const vertical = analysePoseSamples(samples, durationSeconds);
  const apExperimental = analysePelvisRelativeApCandidates(samples, perspective);
  const limitations = [
    "Concordância entre sinais compartilhando landmarks MediaPipe não comprova acurácia ou validação clínica.",
    "A comparação não altera o motor 0.3, não calcula passos/cadência e não persiste landmarks ou resultados.",
  ];
  if (!apExperimental.eligible) limitations.push("Método AP recusado para a perspectiva declarada; não há comparação de desempenho em vídeo não lateral.");
  return {
    perspective,
    comparable: apExperimental.eligible,
    verticalV03: {
      acceptedEvents: vertical.events.map((event) => ({ timeMs: Math.round(event.timeSeconds * 1000), side: event.side })),
      signalDiagnostics: vertical.signalDiagnostics,
    },
    apExperimental,
    limitations,
  };
}

function prepareSamples(samples: PoseSample[]) {
  const originalTimestampIssues = samples.reduce((count, sample, index) => count + (index > 0 && Number.isFinite(sample.timeMs) && Number.isFinite(samples[index - 1].timeMs) && sample.timeMs <= samples[index - 1].timeMs ? 1 : 0), 0);
  const chronological = samples.filter((sample) => Number.isFinite(sample.timeMs)).map((sample, index) => ({ sample, index })).sort((left, right) => left.sample.timeMs - right.sample.timeMs || left.index - right.index);
  let duplicateOrNonMonotonicTimestamps = originalTimestampIssues;
  let rejectedLowConfidence = 0;
  let rejectedMissingLandmarks = 0;
  const seenTimes = new Set<number>();
  const usable: Array<PoseSample & { leftAnkleX: number; rightAnkleX: number; hipCenterX: number }> = [];
  for (const { sample } of chronological) {
    if (seenTimes.has(sample.timeMs)) { duplicateOrNonMonotonicTimestamps += 1; continue; }
    seenTimes.add(sample.timeMs);
    if (sample.visibility < MINIMUM_VISIBILITY) { rejectedLowConfidence += 1; continue; }
    if (!finite(sample.leftAnkleX) || !finite(sample.rightAnkleX) || !finite(sample.hipCenterX)) { rejectedMissingLandmarks += 1; continue; }
    usable.push(sample as PoseSample & { leftAnkleX: number; rightAnkleX: number; hipCenterX: number });
  }
  return { usable, duplicateOrNonMonotonicTimestamps, rejectedLowConfidence, rejectedMissingLandmarks };
}

function analyseSide(points: SignalPoint[], side: ApSide) {
  const segments = segment(points);
  const diagnostic = emptyDiagnostic(side);
  diagnostic.contiguousSegments = segments.length;
  const candidates: ApCandidate[] = [];
  for (const [segmentIndex, currentSegment] of segments.entries()) {
    if (currentSegment.length < MINIMUM_SAMPLES_PER_SEGMENT) continue;
    const smoothed = smooth(currentSegment);
    const range = Math.max(...smoothed.map((point) => point.value)) - Math.min(...smoothed.map((point) => point.value));
    const minimumProminence = Math.max(0.004, range * 0.05);
    const minimumCrossingExcursion = Math.max(0.004, range * 0.1);
    let lastAcceptedTime = -Infinity;
    const pushCandidate = (candidate: Omit<ApCandidate, "intervalSincePreviousMs" | "status" | "rejectionReason">, requiredMagnitude: number, rejectionReason: "insufficient_prominence" | "insufficient_crossing_excursion") => {
      const intervalSincePreviousMs = Number.isFinite(lastAcceptedTime) ? candidate.timeMs - lastAcceptedTime : null;
      if (candidate.prominence !== null && candidate.prominence < requiredMagnitude) {
        candidates.push({ ...candidate, intervalSincePreviousMs, status: "rejected", rejectionReason });
        if (rejectionReason === "insufficient_prominence") diagnostic.rejectedByProminence += 1;
        else diagnostic.rejectedByCrossingExcursion += 1;
        return;
      }
      if (intervalSincePreviousMs !== null && intervalSincePreviousMs < MINIMUM_SPACING_MS) {
        candidates.push({ ...candidate, intervalSincePreviousMs, status: "rejected", rejectionReason: "minimum_spacing" });
        diagnostic.rejectedBySpacing += 1;
        return;
      }
      candidates.push({ ...candidate, intervalSincePreviousMs, status: "accepted", rejectionReason: null });
      diagnostic.accepted += 1;
      lastAcceptedTime = candidate.timeMs;
    };

    for (let index = 1; index < smoothed.length - 1; index += 1) {
      const previous = smoothed[index - 1]; const current = smoothed[index]; const next = smoothed[index + 1];
      const maximum = current.value >= previous.value && current.value >= next.value && (current.value > previous.value || current.value > next.value);
      const minimum = current.value <= previous.value && current.value <= next.value && (current.value < previous.value || current.value < next.value);
      if (maximum || minimum) {
        diagnostic.extremaCandidates += 1;
        pushCandidate({ timeMs: current.timeMs, side, kind: "temporal_extremum", signalValue: current.value, prominence: Math.abs(current.value - (maximum ? Math.min(previous.value, next.value) : Math.max(previous.value, next.value))), landmarkQuality: current.visibility, segmentIndex }, minimumProminence, "insufficient_prominence");
      }
      const crossesPelvis = (previous.value < 0 && current.value >= 0) || (previous.value > 0 && current.value <= 0);
      if (crossesPelvis) {
        diagnostic.crossingCandidates += 1;
        const excursion = Math.abs(previous.value) + Math.abs(current.value);
        pushCandidate({ timeMs: current.timeMs, side, kind: "pelvis_crossing", signalValue: current.value, prominence: excursion, landmarkQuality: current.visibility, segmentIndex }, minimumCrossingExcursion, "insufficient_crossing_excursion");
      }
    }
  }
  return { candidates, diagnostic };
}

function segment(points: SignalPoint[]): SignalSegment[] {
  if (!points.length) return [];
  const intervals = points.slice(1).map((point, index) => point.timeMs - points[index].timeMs).filter((interval) => interval > 0).sort((a, b) => a - b);
  const median = intervals.length ? intervals[Math.floor(intervals.length / 2)] : 100;
  const maximumGap = Math.max(350, median * 2.5);
  return points.reduce<SignalSegment[]>((all, point) => {
    const current = all.at(-1); const previous = current?.at(-1);
    if (!current || !previous || point.timeMs - previous.timeMs > maximumGap) all.push([point]); else current.push(point);
    return all;
  }, []);
}

function smooth(points: SignalPoint[]) {
  return points.map((point, index) => ({ ...point, value: (points[Math.max(0, index - 1)].value + point.value * 2 + points[Math.min(points.length - 1, index + 1)].value) / 4 }));
}

function inferImageDirection(hips: number[]): "positive-x" | "negative-x" | "indeterminate" {
  if (hips.length < 2) return "indeterminate";
  const displacement = hips.at(-1)! - hips[0];
  return Math.abs(displacement) < 0.02 ? "indeterminate" : displacement > 0 ? "positive-x" : "negative-x";
}

function emptyDiagnostic(side: ApSide): ApSignalDiagnostic {
  return { side, contiguousSegments: 0, extremaCandidates: 0, crossingCandidates: 0, accepted: 0, rejectedByProminence: 0, rejectedBySpacing: 0, rejectedByCrossingExcursion: 0 };
}

function finite(value: number | null | undefined): value is number { return typeof value === "number" && Number.isFinite(value); }
