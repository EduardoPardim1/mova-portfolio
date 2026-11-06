import { calculateGaitMetrics } from "./gait";

export type Point2D = { x: number; y: number; visibility?: number };
export type PoseSample = {
  timeMs: number;
  leftAnkleY: number | null;
  rightAnkleY: number | null;
  visibility: number;
  /** Coordenadas locais opcionais; não são persistidas nem enviadas a servidores. */
  leftAnkleX?: number | null;
  rightAnkleX?: number | null;
  hipCenterX?: number | null;
  hipCenterY?: number | null;
  leftHeelX?: number | null;
  rightHeelX?: number | null;
  leftHeelY?: number | null;
  rightHeelY?: number | null;
  leftFootIndexX?: number | null;
  rightFootIndexX?: number | null;
  leftFootIndexY?: number | null;
  rightFootIndexY?: number | null;
  /** Visibilidades locais para auditoria técnica; não são persistidas nem enviadas. */
  leftAnkleVisibility?: number | null;
  rightAnkleVisibility?: number | null;
  leftHeelVisibility?: number | null;
  rightHeelVisibility?: number | null;
  leftHipVisibility?: number | null;
  rightHipVisibility?: number | null;
  leftKneeAngle?: number | null;
  rightKneeAngle?: number | null;
};
type SeriesPoint = { time: number; confidence: number; leftKneeAngle: number | null; rightKneeAngle: number | null; leftAnkleRelativeY: number | null; rightAnkleRelativeY: number | null; leftAnkleX: number | null; rightAnkleX: number | null };
export type GaitEvent = { side: "left" | "right"; timeSeconds: number };
export type SignalDiagnostic = {
  signal: "left_ankle_relative_y" | "right_ankle_relative_y";
  contiguousSegments: number;
  candidates: number;
  accepted: number;
  rejectedByProminence: number;
  rejectedBySpacing: number;
  rejectedByBoundary: number;
};
export type VideoAnalysis = {
  durationSeconds: number;
  estimatedSteps: number | null;
  cadenceSpm: number | null;
  speedMps: number | null;
  meanVisibility: number | null;
  usableFrames: number;
  totalFrames: number;
  detectionRate: number | null;
  quality: "adequada" | "limitada" | "insuficiente";
  /** Confiabilidade dos eventos, separada da qualidade da pose. */
  gaitEstimateReliability: "experimental" | "insuficiente";
  limitations: string[];
  stepRegularity: number | null;
  temporalSymmetry: number | null;
  events: GaitEvent[];
  signalDiagnostics: SignalDiagnostic[];
  series: SeriesPoint[];
};

/** Retorna o ângulo 2D no plano da imagem; não é goniometria clínica. */
export function calculateJointAngle(first: Point2D | undefined, middle: Point2D | undefined, last: Point2D | undefined): number | null {
  if (!first || !middle || !last) return null;
  const ax = first.x - middle.x;
  const ay = first.y - middle.y;
  const bx = last.x - middle.x;
  const by = last.y - middle.y;
  const magnitudeA = Math.hypot(ax, ay);
  const magnitudeB = Math.hypot(bx, by);
  if (!magnitudeA || !magnitudeB) return null;
  const cosine = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (magnitudeA * magnitudeB)));
  return Number((Math.acos(cosine) * 180 / Math.PI).toFixed(1));
}

export function calculateKneeAngles(landmarks: Point2D[]): { left: number | null; right: number | null } {
  return {
    left: calculateJointAngle(landmarks[23], landmarks[25], landmarks[27]),
    right: calculateJointAngle(landmarks[24], landmarks[26], landmarks[28]),
  };
}

/**
 * Extrai proxies temporais dos landmarks. Um pico não é interpretado como contato inicial.
 * Lacunas de pose não entram na suavização, para não criar movimento entre segmentos distintos.
 */
export function analysePoseSamples(samples: PoseSample[], durationSeconds: number, distanceMeters?: number): VideoAnalysis {
  const chronological = [...samples].filter((sample) => Number.isFinite(sample.timeMs)).sort((a, b) => a.timeMs - b.timeMs);
  const usable = chronological.filter(hasUsableAnkles);
  const meanVisibility = usable.length ? usable.reduce((sum, sample) => sum + sample.visibility, 0) / usable.length : null;
  const detectionRate = chronological.length ? usable.length / chronological.length : null;
  const leftDetection = detectRelativeAnklePeaks(usable, "left");
  const rightDetection = detectRelativeAnklePeaks(usable, "right");
  const candidates = [...leftDetection.events, ...rightDetection.events];
  const events = deduplicateEvents(candidates);
  const ambiguousSides = candidates.some(a => candidates.some(b => a.side !== b.side && Math.abs(a.timeSeconds-b.timeSeconds) < 0.18));
  const invalidTiming = hasDuplicateOrNonMonotonicTimestamps(samples);
  const poseGaps = usable.some((sample,index) => index > 0 && sample.timeMs-usable[index-1].timeMs > 350);
  const repeatedSide = events.some((event,index) => index > 0 && event.side === events[index-1].side);
  const cadenceWindowSeconds = continuousObservedWindow(events);
  const isEstimateInsufficient = ambiguousSides || invalidTiming || poseGaps || repeatedSide || !cadenceWindowSeconds || events.length < 4 || detectionRate === null || detectionRate < 0.8 || meanVisibility === null || meanVisibility < 0.7;
  // The first-to-last event window contains N-1 intervals, not N complete steps.
  const cadenceMetrics = calculateGaitMetrics({ durationSeconds: cadenceWindowSeconds ?? undefined, stepCount: isEstimateInsufficient ? undefined : events.length - 1 });
  const speedMetrics = calculateGaitMetrics({ durationSeconds, distanceMeters });
  const limitations: string[] = [];
  if (ambiguousSides) limitations.push("Eventos próximos de pés opostos foram excluídos por lateralidade ambígua; não se escolhe um lado arbitrariamente.");
  if (poseGaps || repeatedSide || invalidTiming) limitations.push("Cadência indisponível: lacunas, timestamps inválidos ou sequência sem alternância confiável.");
  limitations.push("Cadência calculada pelos N−1 intervalos entre N eventos heurísticos; não comprova contatos reais.");
  if (!durationSeconds) limitations.push("Duração do vídeo indisponível.");
  if (chronological.length < 12) limitations.push("Poucos quadros analisados para estimar eventos temporais.");
  if (usable.length < 12) limitations.push("Poucos quadros com ambos os tornozelos identificáveis.");
  if (hasDuplicateOrNonMonotonicTimestamps(samples)) limitations.push("Timestamps repetidos ou fora de ordem foram ordenados para análise; a qualidade temporal foi reduzida.");
  if (detectionRate !== null && detectionRate < 0.8) limitations.push("Taxa de detecção abaixo de 80%; a estimativa de marcha não é confiável.");
  if (meanVisibility !== null && meanVisibility < 0.7) limitations.push("Visibilidade média dos tornozelos abaixo de 0,70; reveja enquadramento, luz e oclusões.");
  if (!events.length) limitations.push("Nenhum pico temporal de tornozelo foi detectado.");
  if (events.length && !cadenceWindowSeconds) limitations.push("Os eventos não formaram uma janela temporal analisável.");
  if (isEstimateInsufficient) limitations.push("Estimativa de passos e cadência indisponível ou não confiável; os picos exibidos não são contatos de solo validados.");
  if (!distanceMeters) limitations.push("Velocidade não calculada: distância real não informada.");
  if (!usable.some((sample) => sample.leftKneeAngle !== undefined || sample.rightKneeAngle !== undefined)) limitations.push("Ângulos de joelho indisponíveis: landmarks de quadril, joelho e tornozelo não foram suficientes.");
  else limitations.push("Ângulos são estimativas 2D na imagem e não equivalem à goniometria clínica validada.");
  const quality = usable.length < 12 || detectionRate === null || detectionRate < 0.45 || meanVisibility === null
    ? "insuficiente"
    : detectionRate < 0.8 || meanVisibility < 0.7
      ? "limitada"
      : "adequada";

  return {
    durationSeconds,
    estimatedSteps: isEstimateInsufficient ? null : events.length,
    cadenceSpm: isEstimateInsufficient ? null : cadenceMetrics.cadenceSpm,
    speedMps: speedMetrics.speedMps,
    meanVisibility,
    usableFrames: usable.length,
    totalFrames: chronological.length,
    detectionRate,
    quality,
    gaitEstimateReliability: isEstimateInsufficient ? "insuficiente" : "experimental",
    limitations,
    stepRegularity: isEstimateInsufficient ? null : intervalRegularity(events.map((event) => event.timeSeconds * 1000)),
    temporalSymmetry: isEstimateInsufficient ? null : temporalSymmetry(leftDetection.events.map((event) => event.timeSeconds * 1000), rightDetection.events.map((event) => event.timeSeconds * 1000)),
    events,
    signalDiagnostics: [leftDetection.diagnostic, rightDetection.diagnostic],
    series: chronological.map((sample) => ({
      time: Number((sample.timeMs / 1000).toFixed(3)),
      confidence: Number(sample.visibility.toFixed(3)),
      leftKneeAngle: sample.leftKneeAngle ?? null,
      rightKneeAngle: sample.rightKneeAngle ?? null,
      leftAnkleRelativeY: relativeAnkleY(sample.leftAnkleY, sample.hipCenterY),
      rightAnkleRelativeY: relativeAnkleY(sample.rightAnkleY, sample.hipCenterY),
      leftAnkleX: sample.leftAnkleX ?? null,
      rightAnkleX: sample.rightAnkleX ?? null,
    })),
  };
}

function hasUsableAnkles(sample: PoseSample): sample is PoseSample & { leftAnkleY: number; rightAnkleY: number } {
  return Number.isFinite(sample.leftAnkleY) && Number.isFinite(sample.rightAnkleY) && sample.visibility >= 0.35;
}

function hasDuplicateOrNonMonotonicTimestamps(samples: PoseSample[]) {
  return samples.some((sample, index) => index > 0 && sample.timeMs <= samples[index - 1].timeMs);
}

function relativeAnkleY(ankleY: number | null, hipCenterY: number | null | undefined) {
  if (ankleY === null || !Number.isFinite(ankleY)) return null;
  return hipCenterY !== null && hipCenterY !== undefined && Number.isFinite(hipCenterY)
    ? Number((ankleY - hipCenterY).toFixed(4))
    : Number(ankleY.toFixed(4));
}

function detectRelativeAnklePeaks(samples: Array<PoseSample & { leftAnkleY: number; rightAnkleY: number }>, side: "left" | "right") {
  const coordinate = side === "left" ? "leftAnkleY" : "rightAnkleY";
  const signal = samples.map((sample) => ({
    timeMs: sample.timeMs,
    value: relativeAnkleY(sample[coordinate], sample.hipCenterY) ?? sample[coordinate],
  }));
  const segments = segmentSignal(signal);
  const diagnostic: SignalDiagnostic = {
    signal: side === "left" ? "left_ankle_relative_y" : "right_ankle_relative_y",
    contiguousSegments: segments.length,
    candidates: 0,
    accepted: 0,
    rejectedByProminence: 0,
    rejectedBySpacing: 0,
    rejectedByBoundary: 0,
  };
  const events: GaitEvent[] = [];
  for (const segment of segments) {
    if (segment.length < 3) { diagnostic.rejectedByBoundary += segment.length; continue; }
    const smoothed = smoothSignal(segment);
    const range = Math.max(...smoothed.map((point) => point.value)) - Math.min(...smoothed.map((point) => point.value));
    if (range < 0.02) { diagnostic.rejectedByProminence += Math.max(0, segment.length - 2); continue; }
    const minimumProminence = Math.max(0.004, range * 0.05);
    let lastTime = -Infinity;
    for (let index = 1; index < smoothed.length - 1; index += 1) {
      const previous = smoothed[index - 1];
      const start = index;
      while (index + 1 < smoothed.length && smoothed[index + 1].value === smoothed[start].value) index++;
      if (index === smoothed.length - 1) continue;
      const current = { value: smoothed[start].value, timeMs: (smoothed[start].timeMs + smoothed[index].timeMs) / 2 };
      const next = smoothed[index + 1];
      const isLocalMaximum = current.value >= previous.value && current.value >= next.value && (current.value > previous.value || current.value > next.value);
      if (!isLocalMaximum) continue;
      diagnostic.candidates += 1;
      const prominence = current.value - Math.min(previous.value, next.value);
      if (prominence < minimumProminence) { diagnostic.rejectedByProminence += 1; continue; }
      if (current.timeMs - lastTime < 280) { diagnostic.rejectedBySpacing += 1; continue; }
      events.push({ side, timeSeconds: Number((current.timeMs / 1000).toFixed(3)) });
      diagnostic.accepted += 1;
      lastTime = current.timeMs;
    }
  }
  return { events, diagnostic };
}

function segmentSignal(points: Array<{ timeMs: number; value: number }>) {
  if (!points.length) return [] as Array<Array<{ timeMs: number; value: number }>>;
  const positiveIntervals = points.slice(1).map((point, index) => point.timeMs - points[index].timeMs).filter((interval) => interval > 0);
  const sorted = [...positiveIntervals].sort((a, b) => a - b);
  const medianInterval = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 100;
  const maxGap = Math.max(350, medianInterval * 2.5);
  return points.reduce<Array<Array<{ timeMs: number; value: number }>>>((segments, point) => {
    const current = segments.at(-1);
    const previous = current?.at(-1);
    if (!current || !previous || point.timeMs - previous.timeMs > maxGap) segments.push([point]);
    else current.push(point);
    return segments;
  }, []);
}

function smoothSignal(points: Array<{ timeMs: number; value: number }>) {
  return points.map((point, index) => {
    const previous = points[Math.max(0, index - 1)].value;
    const next = points[Math.min(points.length - 1, index + 1)].value;
    return { timeMs: point.timeMs, value: previous * 0.25 + point.value * 0.5 + next * 0.25 };
  });
}

function deduplicateEvents(events: GaitEvent[]) {
  // Reject cross-foot collisions symmetrically; input order must not select anatomy.
  const unambiguous = events.filter(event => !events.some(other => other.side !== event.side && Math.abs(event.timeSeconds-other.timeSeconds) < 0.18));
  return [...unambiguous].sort((left, right) => left.timeSeconds - right.timeSeconds).reduce<GaitEvent[]>((result, event) => {
    const previous = result.at(-1);
    if (!previous || event.timeSeconds - previous.timeSeconds >= 0.18) result.push(event);
    return result;
  }, []);
}

function continuousObservedWindow(events: GaitEvent[]) {
  if (events.length < 2) return null;
  const span = events.at(-1)!.timeSeconds - events[0].timeSeconds;
  return span > 0 ? span : null;
}

function intervalRegularity(times: number[]) {
  if (times.length < 3) return null;
  const intervals = times.slice(1).map((time, index) => time - times[index]);
  const mean = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
  if (!mean) return null;
  const deviation = Math.sqrt(intervals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / intervals.length);
  return Number((Math.max(0, 1 - deviation / mean) * 100).toFixed(1));
}

function temporalSymmetry(left: number[], right: number[]) {
  if (left.length < 2 || right.length < 2) return null;
  const meanInterval = (values: number[]) => values.slice(1).reduce((sum, time, index) => sum + time - values[index], 0) / (values.length - 1);
  const leftMean = meanInterval(left);
  const rightMean = meanInterval(right);
  if (!leftMean || !rightMean) return null;
  return Number((Math.min(leftMean, rightMean) / Math.max(leftMean, rightMean) * 100).toFixed(1));
}
