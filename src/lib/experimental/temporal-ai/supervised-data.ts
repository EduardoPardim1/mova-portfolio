import { z } from "zod";
import { assertDevelopmentManifest, prepareTargets, RECEPTIVE_FIELD, SAMPLE_HZ, WINDOW_FRAMES, type PreparedWindow, type Region, type Side } from "./data";

const id = z.string().regex(/^[a-z0-9_-]{1,40}$/i);
const time = z.number().finite().nonnegative();
const side = z.enum(["left", "right"]);
const region = z.object({ startMs: time, endMs: time, side }).strict().refine(r => r.endMs >= r.startMs);
const pointRow = z.array(z.number().finite().min(-5).max(5)).length(30).refine(row =>
  Array.from({ length: 10 }, (_, i) => i * 3).every(i => (row[i + 2] === 0 || row[i + 2] === 1) && (row[i + 2] !== 0 || row[i] === 0 && row[i + 1] === 0)));
export const recordingSchema = z.object({
  version: z.literal(1), participantId: id, videoId: id, sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  split: z.enum(["train", "validation", "test"]), fps: z.number().finite().positive().max(240),
  normalization: z.literal("pelvis-torso-aspect-v1"),
  provenance: z.object({ source: z.string().min(1).max(500), license: z.string().min(1).max(500),
    permissionEvidence: z.string().min(1).max(500), commercialTrainingAllowed: z.literal(true),
    imageRightsCleared: z.literal(true), synthetic: z.boolean() }).strict(),
  reviewers: z.array(id).min(2).max(10), adjudicator: id,
  frames: z.array(z.object({ timeMs: time, sourceTimeMs: time.nullable(), values: pointRow }).strict()).min(64).max(3600),
  complete: z.array(region).max(1000), excluded: z.array(region).max(1000),
  events: z.array(z.object({ timeMs: time, side: z.enum(["left", "right", "unknown"]),
    status: z.enum(["confirmed", "uncertain"]), startMs: time, endMs: time,
    reviewerIds: z.array(id).min(1).max(10) }).strict()).max(1000),
}).strict();
export type Recording = z.infer<typeof recordingSchema>;
export type TrainingWindow = PreparedWindow & { targets: number[][]; mask: number[][]; participantId: string; videoId: string; split: Recording["split"] };
const halfCell = 500 / SAMPLE_HZ;

/** Estrito e limitado. IDs/evidência são declarações auditáveis, não prova jurídica automática. */
export function validateDataset(value: unknown): Recording[] {
  const records = z.array(recordingSchema).min(3).max(256).parse(value);
  if (records.reduce((n, r) => n + r.frames.length, 0) > 8192) throw new Error("Piloto limitado a 8192 quadros normalizados.");
  assertDevelopmentManifest(records);
  const ids = new Set<string>();
  for (const r of records) {
    const key = r.videoId.toLowerCase();
    if (ids.has(key)) throw new Error("Gravação duplicada.");
    ids.add(key);
    if (new Set(r.reviewers).size !== r.reviewers.length || !r.reviewers.includes(r.adjudicator)) throw new Error("Revisores inválidos.");
    const first = r.frames[0].timeMs, last = r.frames.at(-1)!.timeMs;
    let previousSource = -1;
    r.frames.forEach((f, i) => {
      if (Math.abs(f.timeMs - (first + i * 1000 / SAMPLE_HZ)) > .001) throw new Error("Grade temporal deve ser 30 Hz, crescente e sem duplicações.");
      if (f.sourceTimeMs === null) {
        if (f.values.some(v => v !== 0)) throw new Error("Frame ausente contém valores.");
      } else {
        if (f.sourceTimeMs <= previousSource || Math.abs(f.sourceTimeMs - f.timeMs) > 15) throw new Error("PTS de origem inválido ou reutilizado.");
        previousSource = f.sourceTimeMs;
      }
    });
    for (const area of [...r.complete, ...r.excluded, ...r.events]) {
      if (area.startMs < first || area.endMs > last || area.startMs > area.endMs) throw new Error("Intervalo fora da gravação.");
    }
    const eventKeys = new Set<string>();
    for (const e of r.events) {
      if (e.timeMs < e.startMs || e.timeMs > e.endMs || e.reviewerIds.some(v => !r.reviewers.includes(v)) || new Set(e.reviewerIds).size !== e.reviewerIds.length) throw new Error("Evento/revisor inválido.");
      if (e.status === "confirmed" && (e.side === "unknown" || e.reviewerIds.length < 2)) throw new Error("Contato confirmado exige lado e revisão independente.");
      const key = `${e.side}:${Math.round((e.timeMs - first) * SAMPLE_HZ / 1000)}`;
      if (eventKeys.has(key)) throw new Error("Contatos duplicados na célula temporal.");
      eventKeys.add(key);
    }
  }
  for (const split of ["train", "validation", "test"]) if (!records.some(r => r.split === split)) throw new Error("Partição ausente.");
  return records;
}

/** Incerteza temporal ou lateral exclui células atingidas; nunca gera negativos. */
export function referenceExclusions(r: Recording): Region[] {
  const result = r.excluded.map(a => ({ ...a, startMs: a.startMs - halfCell, endMs: a.endMs + halfCell }));
  for (const e of r.events) if (e.status !== "confirmed" || e.startMs !== e.endMs) {
    for (const s of e.side === "unknown" ? ["left", "right"] as const : [e.side]) result.push({ side: s, startMs: e.startMs - halfCell, endMs: e.endMs + halfCell });
  }
  return result.map(a => ({ ...a, startMs: Math.max(0, a.startMs) }));
}

/** 30 quadros de contexto + até 34 novos; saídas nunca repetidas entre janelas. */
export function* recordingWindows(r: Recording): Generator<TrainingWindow> {
  const exclusions = referenceExclusions(r);
  const contacts = r.events.filter(e => e.status === "confirmed" && e.side !== "unknown" && e.startMs === e.endMs)
    .map(e => ({ timeMs: e.timeMs, side: e.side as Side }));
  for (let start = 0; start + RECEPTIVE_FIELD <= r.frames.length; start += WINDOW_FRAMES - RECEPTIVE_FIELD + 1) {
    const frames = r.frames.slice(start, start + WINDOW_FRAMES);
    const input = frames.map(f => f.values);
    const eligible = input.map((_, t) => t >= RECEPTIVE_FIELD - 1 && frames.slice(t - RECEPTIVE_FIELD + 1, t + 1).every(f => f.sourceTimeMs !== null && f.values.every((v, i) => i % 3 !== 2 || v === 1)));
    const window: PreparedWindow = { input, timesMs: frames.map(f => f.timeMs), sourceTimesMs: frames.map(f => f.sourceTimeMs), eligible, missingFrames: frames.filter(f => f.sourceTimeMs === null).length };
    const labeled = r.complete.map(a => ({ ...a, startMs: a.startMs + halfCell, endMs: a.endMs - halfCell })).filter(a => a.endMs >= a.startMs);
    const targets = prepareTargets(window, contacts, labeled, exclusions);
    yield { ...window, ...targets, participantId: r.participantId, videoId: r.videoId, split: r.split };
  }
}
