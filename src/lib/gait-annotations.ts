export const GAIT_EVENT_TOLERANCE_MS = 100;
export type AnnotationSide = "left" | "right" | "unknown";
export type AnnotationConfidence = "high" | "medium" | "low";
export type GaitAnnotationEvent = { id: string; timeMs: number; side: AnnotationSide; confidence: AnnotationConfidence; kind: "initial_contact" | "ambiguous"; note?: string; uncertaintyMs?: { startMs: number; endMs: number } };
export type GaitInterval = { id: string; startMs: number; endMs: number | null; kind: "pause" | "occlusion" };
export type GaitAnnotationDocument = { version: 1; videoId: string; walkingStartMs: number | null; walkingEndMs: number | null; events: GaitAnnotationEvent[]; intervals: GaitInterval[]; updatedAt: string; reviewerId?: string };
export type EventComparison = { matched: number; missed: number; extra: number; meanAbsoluteErrorMs: number | null; matchRate: number | null };

export function emptyAnnotation(videoId = "local-video"): GaitAnnotationDocument {
  return { version: 1, videoId, walkingStartMs: null, walkingEndMs: null, events: [], intervals: [], updatedAt: new Date(0).toISOString() };
}

export function normalizeAnnotation(value: unknown): GaitAnnotationDocument | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<GaitAnnotationDocument>;
  if (item.version !== 1 || typeof item.videoId !== "string" || !Array.isArray(item.events) || !Array.isArray(item.intervals)) return null;
  if (item.reviewerId !== undefined && !validReviewerId(item.reviewerId)) return null;
  if (item.events.some(event => event?.uncertaintyMs !== undefined && !validUncertainty(event.timeMs, event.uncertaintyMs))) return null;
  const walkingStartMs = finiteOrNull(item.walkingStartMs);
  const walkingEndMs = finiteOrNull(item.walkingEndMs);
  if (walkingStartMs !== null && walkingEndMs !== null && walkingStartMs > walkingEndMs) return null;
  const validEvents = item.events
    .filter((event): event is GaitAnnotationEvent => Boolean(event && typeof event.id === "string" && Number.isFinite(event.timeMs) && ["left", "right", "unknown"].includes(event.side) && ["high", "medium", "low"].includes(event.confidence) && ["initial_contact", "ambiguous"].includes(event.kind)))
    .map((event) => ({ ...event, timeMs: Math.max(0, Math.round(event.timeMs)) }))
    .sort((a, b) => a.timeMs - b.timeMs);
  const validIntervals = item.intervals
    .filter((interval): interval is GaitInterval => Boolean(interval && typeof interval.id === "string" && Number.isFinite(interval.startMs) && (interval.endMs === null || Number.isFinite(interval.endMs)) && ["pause", "occlusion"].includes(interval.kind)))
    .map((interval) => ({ ...interval, startMs: Math.max(0, Math.round(interval.startMs)), endMs: interval.endMs === null ? null : Math.max(0, Math.round(interval.endMs)) }));
  return { version: 1, videoId: item.videoId, walkingStartMs, walkingEndMs, events: validEvents, intervals: validIntervals, updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date(0).toISOString(), ...(item.reviewerId ? { reviewerId: item.reviewerId } : {}) };
}

export function validReviewerId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(value); }
export function validUncertainty(timeMs: number, value: unknown): value is { startMs: number; endMs: number } {
  if (!value || typeof value !== "object") return false;
  const bounds = value as { startMs?: number; endMs?: number };
  return Number.isFinite(timeMs) && Number.isInteger(bounds.startMs) && Number.isInteger(bounds.endMs)
    && bounds.startMs! >= 0 && bounds.startMs! <= timeMs && bounds.endMs! >= timeMs;
}
export function annotationDraftKey(videoId: string, reviewerId?: string) { return `mova:gait-annotation:${videoId}${reviewerId ? `:review:${reviewerId}` : ""}`; }

export function annotationCsv(document: GaitAnnotationDocument) {
  const lines = ["type,id,start_ms,end_ms,side,confidence,note,reviewer_id,uncertainty_start_ms,uncertainty_end_ms"];
  document.events.forEach((event) => lines.push([event.kind, event.id, event.timeMs, "", event.side, event.confidence, csvCell(event.note ?? ""), csvCell(document.reviewerId ?? ""), event.uncertaintyMs?.startMs ?? "", event.uncertaintyMs?.endMs ?? ""].join(",")));
  document.intervals.forEach((interval) => lines.push([interval.kind, interval.id, interval.startMs, interval.endMs ?? "", "", "", "", csvCell(document.reviewerId ?? ""), "", ""].join(",")));
  return `${lines.join("\n")}\n`;
}

/** Compares already-frozen human events with algorithm events using a pre-specified tolerance. */
export function compareEvents(reference: GaitAnnotationEvent[], estimatedTimesMs: number[], toleranceMs = GAIT_EVENT_TOLERANCE_MS): EventComparison {
  const referenceTimes = reference.filter((event) => event.kind === "initial_contact" && event.confidence !== "low").map((event) => event.timeMs).sort((a, b) => a - b);
  const candidates = [...estimatedTimesMs].filter(Number.isFinite).sort((a, b) => a - b);
  const unused = new Set(candidates.map((_, index) => index));
  const errors: number[] = [];
  referenceTimes.forEach((time) => {
    let best: number | null = null;
    let error = Infinity;
    unused.forEach((index) => { const candidateError = Math.abs(candidates[index] - time); if (candidateError <= toleranceMs && candidateError < error) { best = index; error = candidateError; } });
    if (best !== null) { unused.delete(best); errors.push(error); }
  });
  const matched = errors.length;
  return { matched, missed: referenceTimes.length - matched, extra: unused.size, meanAbsoluteErrorMs: matched ? Number((errors.reduce((sum, value) => sum + value, 0) / matched).toFixed(1)) : null, matchRate: referenceTimes.length ? Number((matched / referenceTimes.length).toFixed(4)) : null };
}

function finiteOrNull(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null; }
function csvCell(value: string) { return `"${value.replaceAll('"', '""')}"`; }
