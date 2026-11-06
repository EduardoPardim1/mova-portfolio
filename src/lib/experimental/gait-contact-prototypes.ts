/** Laboratório local. Nenhuma importação deste módulo pelo produto clínico. */
export type ContactSide = "left" | "right";
export type FootPoint = { x: number; y: number; visibility: number; presence?: number };
export type FootFrame = {
  timeMs: number;
  hip: FootPoint;
  left: { ankle: FootPoint; heel: FootPoint; toe: FootPoint };
  right: { ankle: FootPoint; heel: FootPoint; toe: FootPoint };
};
export const CONTACT_PROTOCOL = Object.freeze({
  version: "contact-lab-v1", minimumQuality: .5, minimumHz: 20,
  maximumGapMs: 100, minimumSegmentMs: 1000,
  sigmaMs: 50, smoothRadiusMs: 100, extremumRadiusMs: 150,
  prominenceHeight: .05, prominenceRange: .1, sameSideSpacingMs: 300,
  restFraction: .2, minimumSwingSpeed: .3, swingMs: 100,
  swingExcursion: .05, restMs: 100, consensusMs: 150,
  verticalLiftRadiusMs: 400, verticalLandingRadiusMs: 40, heelGroundRangeFraction: .35,
});
export type ContactCandidate = { timeMs: number; side: ContactSide; accepted: boolean; reason: string | null; segment: number };
export type ContactExperiment = { id: string; eligible: boolean; unavailableReason: string | null; candidates: ContactCandidate[] };
const sides = ["left", "right"] as const;
const p = CONTACT_PROTOCOL;
const quantile = (values: number[], q: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * q)];
};
const quality = (a: FootPoint | undefined) => !!a && Number.isFinite(a.x) && Number.isFinite(a.y)
  && Number.isFinite(a.visibility) && a.visibility >= p.minimumQuality
  && (a.presence === undefined || Number.isFinite(a.presence) && a.presence >= p.minimumQuality);

/** Sem interpolação através de pose ausente, baixa confiança ou lacunas. */
function segments(frames: FootFrame[], side: ContactSide | "both") {
  const result: FootFrame[][] = [];
  let current: FootFrame[] = [];
  for (const f of frames) {
    const valid = quality(f.hip) && (side === "both" ? sides : [side]).every((s) =>
      quality(f[s]?.ankle) && quality(f[s]?.heel) && quality(f[s]?.toe));
    if (!valid || current.length && f.timeMs - current.at(-1)!.timeMs > p.maximumGapMs) {
      if (current.length) result.push(current);
      current = [];
    }
    if (valid) current.push(f);
  }
  if (current.length) result.push(current);
  return result.filter((s) => s.at(-1)!.timeMs - s[0].timeMs >= p.minimumSegmentMs);
}

/** Kernel simétrico em milissegundos; não é Butterworth e não presume FPS fixo. */
export function smoothContactSignal(times: number[], values: number[]) {
  return times.map((time, i) => {
    let weighted = 0, weight = 0;
    for (let j = 0; j < times.length; j++) {
      const distance = Math.abs(times[j] - time);
      if (distance > p.smoothRadiusMs) continue;
      const w = Math.exp(-.5 * (distance / p.sigmaMs) ** 2);
      weighted += w * values[j]; weight += w;
    }
    return weight ? weighted / weight : values[i];
  });
}

function derivative(times: number[], values: number[]) {
  return values.map((_, i) => {
    const before = Math.max(0, i - 1), after = Math.min(values.length - 1, i + 1);
    return (values[after] - values[before]) / ((times[after] - times[before]) / 1000);
  });
}

function extrema(times: number[], values: number[], sideAt: (index: number) => ContactSide, segment: number) {
  const candidates: ContactCandidate[] = [];
  const threshold = Math.max(p.prominenceHeight, (Math.max(...values) - Math.min(...values)) * p.prominenceRange);
  const accepted: Partial<Record<ContactSide, number>> = {};
  for (let i = 1; i < values.length - 1; i++) {
    if (!(values[i] > values[i - 1] && values[i] >= values[i + 1])) continue;
    const timeMs = times[i], side = sideAt(i);
    const before = values.filter((_, j) => times[j] >= timeMs - p.extremumRadiusMs && times[j] < timeMs);
    const after = values.filter((_, j) => times[j] <= timeMs + p.extremumRadiusMs && times[j] > timeMs);
    let reason: string | null = null;
    if (timeMs - times[0] < p.extremumRadiusMs || times.at(-1)! - timeMs < p.extremumRadiusMs) reason = "segment_boundary";
    else if (values[i] < Math.max(...before, ...after)) reason = "not_dominant_extremum";
    else if (Math.min(values[i] - Math.min(...before), values[i] - Math.min(...after)) < threshold) reason = "insufficient_prominence";
    else if (timeMs - (accepted[side] ?? -Infinity) < p.sameSideSpacingMs) reason = "minimum_spacing";
    if (!reason) accepted[side] = timeMs;
    candidates.push({ timeMs, side, accepted: reason === null, reason, segment });
  }
  return candidates;
}

function landingVelocity(segment: FootFrame[], side: ContactSide, scale: number, segmentIndex: number) {
  const times = segment.map((f) => f.timeMs);
  const heel = smoothContactSignal(times, segment.map((f) => f[side].heel.x / scale));
  const footY = smoothContactSignal(times, segment.map((f) => (f[side].heel.y + f[side].toe.y) / (2 * scale)));
  const speed = derivative(times, heel).map(Math.abs);
  const restThreshold = quantile(speed, .9) * p.restFraction;
  // Metade da excursão robusta, não mediana temporal: apoio prolongado pode
  // fazer a mediana coincidir com o solo e rejeitar toda transição de chegada.
  const groundProxy = (quantile(footY, .05) + quantile(footY, .95)) / 2;
  let movingStart: number | null = null, lastAccepted = -Infinity;
  const candidates: ContactCandidate[] = [];
  for (let i = 1; i < times.length - 1; i++) {
    if (speed[i] >= Math.max(restThreshold, p.minimumSwingSpeed)) movingStart ??= i;
    if (speed[i - 1] <= restThreshold || speed[i] > restThreshold || movingStart === null) continue;
    const start = movingStart;
    movingStart = null;
    const end = times.findIndex((t, j) => j >= i && t - times[i] >= p.restMs);
    let reason: string | null = null;
    if (times[i] - times[start] < p.swingMs || Math.abs(heel[i] - heel[start]) < p.swingExcursion) reason = "insufficient_prior_motion";
    else if (end < 0 || times[i] - times[0] < p.smoothRadiusMs || times.at(-1)! - times[i] < p.smoothRadiusMs) reason = "segment_boundary";
    else if (speed.slice(i, end + 1).some((s) => s > restThreshold)) reason = "no_sustained_rest";
    else if (footY[i] < groundProxy) reason = "foot_not_low";
    else if (times[i] - lastAccepted < p.sameSideSpacingMs) reason = "minimum_spacing";
    if (!reason) lastAccepted = times[i];
    candidates.push({ timeMs: times[i], side, accepted: reason === null, reason, segment: segmentIndex });
  }
  return candidates;
}

/** Hipótese FVA adaptada: Y de imagem cresce para baixo. Não replica o filtro
 * Butterworth/interpolação do artigo; só a sequência elevação → descida baixa. */
function verticalFootVelocity(segment: FootFrame[], side: ContactSide, scale: number, segmentIndex: number) {
  const times = segment.map((f) => f.timeMs);
  const y = smoothContactSignal(times, segment.map((f) => (f[side].heel.y + f[side].toe.y) / (2 * scale)));
  const heelY = smoothContactSignal(times, segment.map((f) => f[side].heel.y / scale));
  const velocity = derivative(times, y);
  const ground = Math.max(...heelY), range = ground - Math.min(...heelY);
  const candidates: ContactCandidate[] = [];
  let swing = false;
  for (let i = 1; i < times.length - 1; i++) {
    const liftWindow = velocity.filter((_, j) => Math.abs(times[j] - times[i]) <= p.verticalLiftRadiusMs && j !== i);
    if (velocity[i] < 0 && velocity[i] < velocity[i - 1] && velocity[i] <= Math.min(...liftWindow)) swing = true;
    if (!(velocity[i] > 0 && velocity[i] > velocity[i - 1] && velocity[i] >= velocity[i + 1])) continue;
    const local = velocity.filter((_, j) => Math.abs(times[j] - times[i]) <= p.verticalLandingRadiusMs && j !== i);
    let reason: string | null = null;
    if (times[i] - times[0] < p.smoothRadiusMs || times.at(-1)!.valueOf() - times[i] < p.smoothRadiusMs) reason = "segment_boundary";
    else if (range < .02) reason = "insufficient_vertical_excursion";
    else if (velocity[i] < Math.max(...local)) reason = "not_dominant_velocity";
    else if (!swing) reason = "no_preceding_lift";
    else if (heelY[i] < ground - p.heelGroundRangeFraction * range) reason = "heel_not_near_ground";
    if (!reason) swing = false;
    candidates.push({ timeMs: times[i], side, accepted: !reason, reason, segment: segmentIndex });
  }
  return candidates;
}

/** Nenhuma referência humana entra nesta API. Lado nunca é corrigido automaticamente. */
export function runContactExperiments(input: FootFrame[], perspective: string) {
  const ids = ["E01-ankle-ap", "E02-heel-ap", "E03-heel-rest", "E04-heel-separation", "E05-position-rest", "E08-vertical-foot-velocity"];
  const experiments: ContactExperiment[] = ids.map((id) => ({ id, eligible: false, unavailableReason: null, candidates: [] }));
  const timesValid = input.every((f, i) => Number.isFinite(f.timeMs) && f.timeMs >= 0 && (i === 0 || f.timeMs > input[i - 1].timeMs));
  const intervals = input.slice(1).map((f, i) => f.timeMs - input[i].timeMs);
  // Mesma mediana superior conservadora do pipeline/baseline para N par.
  const interval = [...intervals].sort((a, b) => a - b)[Math.floor(intervals.length / 2)];
  const hz = interval > 0 ? 1000 / interval : null;
  const goodHips = input.filter((f) => quality(f.hip));
  const scale = quantile(input.flatMap((f) => sides.flatMap((side) => quality(f.hip) && quality(f[side]?.heel) ? [Math.abs(f[side].heel.y - f.hip.y)] : [])), .5);
  const displacement = goodHips.length > 5 ? quantile(goodHips.slice(-5).map((f) => f.hip.x), .5) - quantile(goodHips.slice(0, 5).map((f) => f.hip.x), .5) : 0;
  const direction = Math.abs(displacement) >= .02 ? Math.sign(displacement) : 0;
  const sideSegments = { left: segments(input, "left"), right: segments(input, "right") };
  const bilateral = segments(input, "both");
  const usable = (side: ContactSide) => input.filter((f) => quality(f.hip) && quality(f[side]?.ankle) && quality(f[side]?.heel) && quality(f[side]?.toe)).length;
  const qc = {
    samples: input.length, effectiveHz: hz, direction, normalizedScaleAvailable: scale > .02,
    leftUsable: usable("left"), rightUsable: usable("right"),
    leftSegments: sideSegments.left.map((s) => ({ startMs: s[0].timeMs, endMs: s.at(-1)!.timeMs, samples: s.length })),
    rightSegments: sideSegments.right.map((s) => ({ startMs: s[0].timeMs, endMs: s.at(-1)!.timeMs, samples: s.length })),
    gaps: intervals.flatMap((dt, i) => dt > p.maximumGapMs ? [{ startMs: input[i].timeMs, endMs: input[i + 1].timeMs, durationMs: dt }] : []),
    // Alerta geométrico, nunca evidência visual nem permissão para trocar rótulos.
    suspectedSideDiscontinuities: input.slice(1).filter((f, i) => {
      const a = input[i];
      if (![a.left.heel, a.right.heel, f.left.heel, f.right.heel].every(quality) || intervals[i] > p.maximumGapMs || scale <= .02) return false;
      const same = Math.abs(f.left.heel.x - a.left.heel.x) + Math.abs(f.right.heel.x - a.right.heel.x);
      const swap = Math.abs(f.left.heel.x - a.right.heel.x) + Math.abs(f.right.heel.x - a.left.heel.x);
      return same > .25 * scale && swap < same * .25;
    }).length,
  };
  const failure = !timesValid ? "invalid_timestamps" : perspective !== "lateral" ? "not_lateral" : !hz || hz < p.minimumHz ? "insufficient_sampling" : scale <= .02 ? "missing_scale" : direction === 0 ? "indeterminate_direction" : null;
  if (failure) {
    for (const e of experiments) e.unavailableReason = failure;
    return { protocol: p, qc, experiments };
  }
  for (const side of sides) {
    sideSegments[side].forEach((segment, segmentIndex) => {
      const times = segment.map((f) => f.timeMs);
      for (const [index, point] of [[0, "ankle"], [1, "heel"]] as const) {
        const signal = smoothContactSignal(times, segment.map((f) => direction * (f[side][point].x - f.hip.x) / scale));
        experiments[index].candidates.push(...extrema(times, signal, () => side, segmentIndex));
      }
      experiments[2].candidates.push(...landingVelocity(segment, side, scale, segmentIndex));
      experiments[5].candidates.push(...verticalFootVelocity(segment, side, scale, segmentIndex));
    });
  }
  bilateral.forEach((segment, segmentIndex) => {
    const times = segment.map((f) => f.timeMs);
    const separation = smoothContactSignal(times, segment.map((f) => Math.abs(f.left.heel.x - f.right.heel.x) / scale));
    experiments[3].candidates.push(...extrema(times, separation, (i) => direction * (segment[i].left.heel.x - segment[i].right.heel.x) >= 0 ? "left" : "right", segmentIndex));
  });
  const position = experiments[1].candidates.filter((c) => c.accepted);
  const used = new Set<number>();
  experiments[4].candidates = experiments[2].candidates.filter((c) => c.accepted).map((c) => {
    const match = position.map((a, i) => ({ a, i })).filter(({ a, i }) => !used.has(i) && a.side === c.side && a.segment === c.segment && Math.abs(a.timeMs - c.timeMs) <= p.consensusMs)
      .sort((a, b) => Math.abs(a.a.timeMs - c.timeMs) - Math.abs(b.a.timeMs - c.timeMs))[0];
    if (match) used.add(match.i);
    return { ...c, accepted: !!match, reason: match ? null : "no_position_agreement" };
  });
  for (const e of experiments) {
    e.eligible = e.id === ids[3] ? bilateral.length > 0 : sideSegments.left.length + sideSegments.right.length > 0;
    e.unavailableReason = e.eligible ? null : "no_contiguous_quality_segment";
    e.candidates.sort((a, b) => a.timeMs - b.timeMs || a.side.localeCompare(b.side));
  }
  return { protocol: p, qc, experiments };
}
