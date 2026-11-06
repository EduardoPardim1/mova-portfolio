/** Contrato experimental v1. Não importa nem modifica o pipeline clínico. */
export const INPUT_POINTS = [23, 24, 25, 26, 27, 28, 29, 30, 31, 32] as const;
export const INPUT_CHANNELS = INPUT_POINTS.length * 3;
export const SAMPLE_HZ = 30;
export const WINDOW_FRAMES = 64;
export const RECEPTIVE_FIELD = 31;
export type Side = "left" | "right";
export type Landmark = { x: number; y: number; visibility?: number; presence?: number };
export type PoseFrame = { timeMs: number; landmarks: readonly Landmark[] };
export type Region = { startMs: number; endMs: number; side: Side };
export type Contact = { timeMs: number; side: Side };
export type Tensor = number[][];
export type PreparedWindow = {
  input: Tensor;
  timesMs: number[];
  sourceTimesMs: (number | null)[];
  eligible: boolean[];
  missingFrames: number;
};

function visible(point: Landmark | undefined): point is Landmark {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
    && Number.isFinite(point.visibility) && point.visibility! >= .5 && point.visibility! <= 1
    && (point.presence === undefined || (Number.isFinite(point.presence) && point.presence >= .5 && point.presence <= 1));
}

/** x/y em alturas de tronco, origem na pelve; máscara 0 não significa apoio/balanço. */
export function normalizePose(points: readonly Landmark[], width: number, height: number): number[] {
  if (![width, height].every((v) => Number.isFinite(v) && v > 0)) throw new Error("Dimensões inválidas.");
  const empty = () => Array<number>(INPUT_CHANNELS).fill(0);
  const anchors = [points[11], points[12], points[23], points[24]];
  if (!anchors.every(visible)) return empty();
  const hipX = (points[23].x + points[24].x) * width / 2;
  const hipY = (points[23].y + points[24].y) * height / 2;
  const shoulderX = (points[11].x + points[12].x) * width / 2;
  const shoulderY = (points[11].y + points[12].y) * height / 2;
  const scale = Math.hypot(hipX - shoulderX, hipY - shoulderY);
  if (scale < Math.min(width, height) * .02) return empty();
  return INPUT_POINTS.flatMap((index) => {
    const point = points[index];
    if (!visible(point)) return [0, 0, 0];
    const x = (point.x * width - hipX) / scale, y = (point.y * height - hipY) / scale;
    // Recusa geometria extrema; não satura valores para parecerem válidos.
    return Math.abs(x) <= 5 && Math.abs(y) <= 5 ? [x, y, 1] : [0, 0, 0];
  });
}

/** Grade 30 Hz por vizinho mais próximo, sem interpolar ou reutilizar uma amostra. */
export function prepareWindow(frames: readonly PoseFrame[], startMs: number, width: number, height: number): PreparedWindow {
  if (!Number.isFinite(startMs) || startMs < 0 || frames.length > 3600) throw new Error("Janela inválida ou limite de memória excedido.");
  normalizePose([], width, height);
  frames.forEach((frame, i) => {
    if (!Number.isFinite(frame.timeMs) || frame.timeMs < 0 || (i > 0 && frame.timeMs <= frames[i - 1].timeMs)) throw new Error("Timestamps devem ser finitos, únicos e crescentes.");
  });
  const timesMs = Array.from({ length: WINDOW_FRAMES }, (_, i) => startMs + i * 1000 / SAMPLE_HZ);
  const sourceTimesMs: (number | null)[] = [];
  const used = new Set<number>();
  let cursor = 0;
  const input = timesMs.map((time) => {
    while (cursor + 1 < frames.length && Math.abs(frames[cursor + 1].timeMs - time) < Math.abs(frames[cursor].timeMs - time)) cursor++;
    if (!frames[cursor] || used.has(cursor) || Math.abs(frames[cursor].timeMs - time) > .45 * 1000 / SAMPLE_HZ) {
      sourceTimesMs.push(null);
      return Array<number>(INPUT_CHANNELS).fill(0);
    }
    used.add(cursor);
    sourceTimesMs.push(frames[cursor].timeMs);
    return normalizePose(frames[cursor].landmarks, width, height);
  });
  const complete = input.map((row) => INPUT_POINTS.every((_, i) => row[i * 3 + 2] === 1));
  const eligible = input.map((_, t) => t >= RECEPTIVE_FIELD - 1 && complete.slice(t - RECEPTIVE_FIELD + 1, t + 1).every(Boolean));
  return { input, timesMs, sourceTimesMs, eligible, missingFrames: sourceTimesMs.filter((t) => t === null).length };
}

/** Negativos só existem em regiões cuja anotação bilateral/lateral está completa. */
export function prepareTargets(window: PreparedWindow, contacts: readonly Contact[], labeled: readonly Region[], excluded: readonly Region[] = []) {
  const sides: Side[] = ["left", "right"];
  [...labeled, ...excluded].forEach((region) => {
    if (!sides.includes(region.side) || !Number.isFinite(region.startMs) || !Number.isFinite(region.endMs) || region.startMs < 0 || region.endMs < region.startMs) throw new Error("Região de referência inválida.");
  });
  const contains = (regions: readonly Region[], time: number, side: Side) => regions.some((r) => r.side === side && r.startMs <= time && r.endMs >= time);
  const targets = window.timesMs.map(() => [0, 0]);
  const mask = window.timesMs.map((time, t) => sides.map((side) => Number(window.eligible[t] && contains(labeled, time, side) && !contains(excluded, time, side))));
  let outside = 0, unavailable = 0;
  const occupied = new Set<string>();
  for (const contact of contacts) {
    if (!sides.includes(contact.side) || !Number.isFinite(contact.timeMs) || contact.timeMs < 0) throw new Error("Contato de referência inválido.");
    if (contact.timeMs < window.timesMs[0] || contact.timeMs > window.timesMs.at(-1)!) { outside++; continue; }
    const index = Math.round((contact.timeMs - window.timesMs[0]) * SAMPLE_HZ / 1000);
    const side = sides.indexOf(contact.side), key = `${index}:${side}`;
    if (occupied.has(key)) throw new Error("Dois contatos do mesmo pé na mesma célula temporal.");
    occupied.add(key);
    targets[index][side] = 1;
    if (!contains(labeled, contact.timeMs, contact.side) || contains(excluded, contact.timeMs, contact.side)) mask[index][side] = 0;
    if (!mask[index][side]) unavailable++;
  }
  return { targets, mask, outside, unavailable };
}

export type SplitEntry = { participantId: string; videoId: string; sha256: string; split: "train" | "validation" | "test" };
/** Deve preceder qualquer extração futura. IDs não devem ser nomes de pessoas. */
export function assertDevelopmentManifest(entries: readonly SplitEntry[]) {
  const owners = new Map<string, string>();
  for (const entry of entries) {
    const id = entry.videoId.toUpperCase().replace(/\.MP4(\.MP4)?$/, "");
    if (/^(V0?7|V0?8|V10|P19-01|P23-01)$/.test(id)) throw new Error("Vídeo reservado ou previamente examinado: proibido neste dataset.");
    if (!/^[a-z0-9_-]{1,40}$/i.test(entry.videoId) || !/^[a-z0-9_-]{1,40}$/i.test(entry.participantId) || !/^[a-f0-9]{64}$/i.test(entry.sha256)
      || !["train", "validation", "test"].includes(entry.split)) throw new Error("Manifesto inválido; use IDs pseudônimos e SHA-256.");
    for (const key of [`participant:${entry.participantId.toLowerCase()}`, `video:${id}`, `hash:${entry.sha256.toLowerCase()}`]) {
      if (owners.has(key) && owners.get(key) !== entry.split) throw new Error("Vazamento entre partições por participante, vídeo ou hash.");
      owners.set(key, entry.split);
    }
  }
}
