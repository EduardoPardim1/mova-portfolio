import type { PoseSample } from "./pose-analysis";

export type FootSeparationCandidate = { timeMs: number; confidence: "low"; note: string };
export type FootSeparationAnalysis = {
  method: "foot-separation-2d-v1";
  dependency: "mediapipe-landmarks";
  candidates: FootSeparationCandidate[];
  usableSamples: number;
  contiguousSegments: number;
  limitations: string[];
};

/**
 * Método B exploratório: máximos locais de separação 2D dos tornozelos.
 * Não identifica contato inicial e não deve ser usado como referência humana.
 */
export function analyseFootSeparationCandidates(samples: PoseSample[]): FootSeparationAnalysis {
  const points = samples
    .filter((sample) => sample.visibility >= 0.35 && finite(sample.leftAnkleX) && finite(sample.rightAnkleX) && finite(sample.leftAnkleY) && finite(sample.rightAnkleY))
    .sort((a, b) => a.timeMs - b.timeMs)
    .map((sample) => ({ timeMs: sample.timeMs, value: Math.hypot(sample.leftAnkleX! - sample.rightAnkleX!, sample.leftAnkleY! - sample.rightAnkleY!) }));
  const segments = split(points);
  const candidates: FootSeparationCandidate[] = [];
  for (const segment of segments) {
    if (segment.length < 3) continue;
    const smoothed = segment.map((point, index) => ({ ...point, value: (segment[Math.max(0, index - 1)].value + point.value * 2 + segment[Math.min(segment.length - 1, index + 1)].value) / 4 }));
    const range = Math.max(...smoothed.map((point) => point.value)) - Math.min(...smoothed.map((point) => point.value));
    if (range < 0.02) continue;
    let lastTime = -Infinity;
    for (let index = 1; index < smoothed.length - 1; index += 1) {
      const previous = smoothed[index - 1]; const current = smoothed[index]; const next = smoothed[index + 1];
      const prominence = current.value - Math.min(previous.value, next.value);
      if (current.value >= previous.value && current.value >= next.value && prominence >= Math.max(0.004, range * 0.05) && current.timeMs - lastTime >= 280) {
        candidates.push({ timeMs: current.timeMs, confidence: "low", note: "Método automático alternativo B: máximo de separação 2D entre tornozelos; não é contato de solo e requer revisão humana." });
        lastTime = current.timeMs;
      }
    }
  }
  return {
    method: "foot-separation-2d-v1", dependency: "mediapipe-landmarks", candidates, usableSamples: points.length, contiguousSegments: segments.length,
    limitations: ["Depende dos mesmos landmarks MediaPipe do MOVA; não é independente.", "Separação 2D varia com perspectiva, escala e oclusão.", "Os candidatos não recebem lado nem são tratados como contato inicial."],
  };
}

function finite(value: number | null | undefined): value is number { return typeof value === "number" && Number.isFinite(value); }
function split(points: Array<{ timeMs: number; value: number }>) {
  const intervals = points.slice(1).map((point, index) => point.timeMs - points[index].timeMs).filter((value) => value > 0).sort((a, b) => a - b);
  const maxGap = Math.max(350, (intervals[Math.floor(intervals.length / 2)] ?? 100) * 2.5);
  return points.reduce<Array<Array<{ timeMs: number; value: number }>>>((all, point) => { const current = all.at(-1); const previous = current?.at(-1); if (!current || !previous || point.timeMs - previous.timeMs > maxGap) all.push([point]); else current.push(point); return all; }, []);
}
