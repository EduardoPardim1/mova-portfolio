import type { PoseSample } from "../pose-analysis";
import type { ApSide, VideoPerspective } from "./gait-ap-event-detector";

type SignalPoint = { timeMs: number; value: number; visibility: number };
type RejectionReason = "insufficient_prominence" | "minimum_spacing" | "not_lateral" | "insufficient_sampling" | "indeterminate_direction" | "missing_landmarks" | "low_visibility";

export type ScientificEventCandidate = {
  timeMs: number;
  side: ApSide;
  signalValue: number;
  prominence: number;
  status: "accepted" | "rejected";
  rejectionReason: RejectionReason | null;
  landmarkQuality: number;
};

export type ScientificEventAnalysis = {
  method: "pelvis-relative-leading-extremum-v1";
  perspective: VideoPerspective;
  eligible: boolean;
  unavailableReason: RejectionReason | null;
  samplingHz: number | null;
  motionDirectionInImage: "positive-x" | "negative-x" | "indeterminate";
  input: { totalSamples: number; usableSamples: number; rejectedMissingLandmarks: number; rejectedLowConfidence: number; medianIntervalMs: number | null };
  events: Array<Omit<ScientificEventCandidate, "status" | "rejectionReason">>;
  candidates: ScientificEventCandidate[];
  limitations: string[];
};

const MINIMUM_VISIBILITY = 0.35;
const MINIMUM_SAMPLING_HZ = 20;
const MINIMUM_SPACING_MS = 300;

/**
 * POC inspirada no princípio de Stenum et al.: extremo do tornozelo no eixo AP
 * relativo à pelve, somente em vista lateral. Diferentemente do AP v1, não
 * mistura extremos de ambas as polaridades e crossings como contatos.
 * Não reproduz o pipeline OpenPose/MATLAB ou a validação clínica do artigo.
 */
export function analyseScientificInitialContactCandidates(samples: PoseSample[], perspective: VideoPerspective = "indeterminate"): ScientificEventAnalysis {
  const prepared = prepare(samples);
  const medianIntervalMs = median(prepared.usable.slice(1).map((point, index) => point.timeMs - prepared.usable[index].timeMs).filter((interval) => interval > 0));
  const samplingHz = medianIntervalMs ? 1000 / medianIntervalMs : null;
  const direction = inferDirection(prepared.usable.map((point) => point.hipCenterX));
  const base = {
    method: "pelvis-relative-leading-extremum-v1" as const,
    perspective,
    samplingHz,
    motionDirectionInImage: direction,
    input: { totalSamples: samples.filter((sample) => Number.isFinite(sample.timeMs)).length, usableSamples: prepared.usable.length, rejectedMissingLandmarks: prepared.rejectedMissingLandmarks, rejectedLowConfidence: prepared.rejectedLowConfidence, medianIntervalMs },
  };
  const limitations = [
    "POC técnica: eventos aceitos são candidatos a contato inicial e não contatos confirmados, heel strikes clínicos ou passos.",
    "O método exige vista lateral declarada, trajetória de tornozelo relativa à pelve, direção de imagem identificável e resolução temporal suficiente.",
    "A suavização local sem atraso desta POC não é a filtragem Butterworth de 4ª ordem usada por Stenum et al.; não reproduz a validação OpenPose/MoCap do estudo.",
  ];
  if (perspective !== "lateral") return unavailable(base, limitations, "not_lateral", "Perspectiva inelegível: o método não opera em vista frontal, posterior, oblíqua ou indeterminada.");
  if (!samplingHz || samplingHz < MINIMUM_SAMPLING_HZ) return unavailable(base, limitations, "insufficient_sampling", `Resolução temporal insuficiente: ${samplingHz ? samplingHz.toFixed(1) : "indisponível"} Hz; a POC exige ao menos ${MINIMUM_SAMPLING_HZ} Hz e não interpola lacunas.`);
  if (direction === "indeterminate") return unavailable(base, limitations, "indeterminate_direction", "Direção de progressão na imagem indeterminada; não é possível escolher a polaridade do extremo líder.");
  if (prepared.usable.length < 7) return unavailable(base, limitations, "missing_landmarks", "Poucas amostras elegíveis para analisar extremos temporais.");

  const candidates = (["left", "right"] as const).flatMap((side) => detectLeadingExtrema(prepared.usable, side, direction));
  const events = candidates.filter((candidate) => candidate.status === "accepted").map(({ timeMs, side, signalValue, prominence, landmarkQuality }) => ({ timeMs, side, signalValue, prominence, landmarkQuality }));
  if (!events.length) limitations.push("Nenhum candidato a contato inicial foi aceito; o resultado indisponível é preferível a inferir eventos de oscilação insuficiente.");
  return { ...base, eligible: true, unavailableReason: null, events, candidates, limitations };
}

function unavailable(base: Omit<ScientificEventAnalysis, "eligible" | "unavailableReason" | "events" | "candidates" | "limitations">, limitations: string[], reason: RejectionReason, message: string): ScientificEventAnalysis {
  return {
    ...base,
    eligible: false,
    unavailableReason: reason,
    events: [],
    candidates: [],
    limitations: [...limitations, message],
  };
}

function prepare(samples: PoseSample[]) {
  let rejectedMissingLandmarks = 0;
  let rejectedLowConfidence = 0;
  const seen = new Set<number>();
  const usable: Array<{ timeMs: number; leftX: number; rightX: number; hipCenterX: number; visibility: number }> = [];
  for (const sample of [...samples].filter((sample) => Number.isFinite(sample.timeMs)).sort((a, b) => a.timeMs - b.timeMs)) {
    if (seen.has(sample.timeMs)) continue;
    seen.add(sample.timeMs);
    if (sample.visibility < MINIMUM_VISIBILITY) { rejectedLowConfidence += 1; continue; }
    if (!finite(sample.leftAnkleX) || !finite(sample.rightAnkleX) || !finite(sample.hipCenterX)) { rejectedMissingLandmarks += 1; continue; }
    usable.push({ timeMs: sample.timeMs, leftX: sample.leftAnkleX, rightX: sample.rightAnkleX, hipCenterX: sample.hipCenterX, visibility: sample.visibility });
  }
  return { usable, rejectedMissingLandmarks, rejectedLowConfidence };
}

function detectLeadingExtrema(samples: Array<{ timeMs: number; leftX: number; rightX: number; hipCenterX: number; visibility: number }>, side: ApSide, direction: "positive-x" | "negative-x") {
  const raw = samples.map((sample) => ({ timeMs: sample.timeMs, value: (side === "left" ? sample.leftX : sample.rightX) - sample.hipCenterX, visibility: sample.visibility }));
  const smoothed = zeroPhaseLocalSmooth(raw);
  const range = Math.max(...smoothed.map((point) => point.value)) - Math.min(...smoothed.map((point) => point.value));
  const minimumProminence = Math.max(0.004, range * 0.1);
  const candidates: ScientificEventCandidate[] = [];
  let lastAccepted = -Infinity;
  for (let index = 4; index < smoothed.length - 4; index += 1) {
    const current = smoothed[index];
    const before = smoothed.slice(index - 4, index).map((point) => point.value);
    const after = smoothed.slice(index + 1, index + 5).map((point) => point.value);
    const surroundingMaximum = Math.max(...before, ...after);
    const surroundingMinimum = Math.min(...before, ...after);
    const isLeadingExtreme = direction === "positive-x"
      ? current.value >= surroundingMaximum && (current.value > before.at(-1)! || current.value > after[0])
      : current.value <= surroundingMinimum && (current.value < before.at(-1)! || current.value < after[0]);
    if (!isLeadingExtreme) continue;
    const nearbyOpposite = direction === "positive-x" ? surroundingMinimum : surroundingMaximum;
    const prominence = Math.abs(current.value - nearbyOpposite);
    if (prominence < minimumProminence) {
      candidates.push({ timeMs: current.timeMs, side, signalValue: current.value, prominence, status: "rejected", rejectionReason: "insufficient_prominence", landmarkQuality: current.visibility });
      continue;
    }
    if (current.timeMs - lastAccepted < MINIMUM_SPACING_MS) {
      candidates.push({ timeMs: current.timeMs, side, signalValue: current.value, prominence, status: "rejected", rejectionReason: "minimum_spacing", landmarkQuality: current.visibility });
      continue;
    }
    candidates.push({ timeMs: current.timeMs, side, signalValue: current.value, prominence, status: "accepted", rejectionReason: null, landmarkQuality: current.visibility });
    lastAccepted = current.timeMs;
  }
  return candidates;
}

function zeroPhaseLocalSmooth(points: SignalPoint[]): SignalPoint[] {
  return points.map((point, index) => {
    const values = [-2, -1, 0, 1, 2].map((offset) => points[Math.max(0, Math.min(points.length - 1, index + offset))].value);
    return { ...point, value: (values[0] + 4 * values[1] + 6 * values[2] + 4 * values[3] + values[4]) / 16 };
  });
}

function inferDirection(hips: number[]): "positive-x" | "negative-x" | "indeterminate" {
  if (hips.length < 2) return "indeterminate";
  const displacement = hips.at(-1)! - hips[0];
  return Math.abs(displacement) < 0.02 ? "indeterminate" : displacement > 0 ? "positive-x" : "negative-x";
}

function median(values: number[]) { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; }
function finite(value: number | null | undefined): value is number { return typeof value === "number" && Number.isFinite(value); }
