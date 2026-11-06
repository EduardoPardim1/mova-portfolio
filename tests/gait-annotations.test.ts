import { describe, expect, it } from "vitest";
import { GAIT_EVENT_TOLERANCE_MS, annotationCsv, compareEvents, emptyAnnotation, normalizeAnnotation } from "@/lib/gait-annotations";

describe("anotações humanas de marcha", () => {
  it("preserva limites no roundtrip JSON, inclusive zero e ausência em documentos antigos", () => {
    const document = { ...emptyAnnotation("synthetic"), walkingStartMs: 0, walkingEndMs: 2345 };
    expect(normalizeAnnotation(JSON.parse(JSON.stringify(document)))).toEqual(document);
    expect(normalizeAnnotation({ version: 1, videoId: "legacy", events: [], intervals: [] })).toMatchObject({ walkingStartMs: null, walkingEndMs: null });
  });
  it("recusa importação com início posterior ao fim sem trocar ou inventar horários", () => {
    expect(normalizeAnnotation({ ...emptyAnnotation(), walkingStartMs: 3000, walkingEndMs: 1000 })).toBeNull();
  });
  it("normaliza importação e mantém somente eventos válidos", () => {
    const imported = normalizeAnnotation({ ...emptyAnnotation("V01"), events: [{ id: "a", timeMs: 100.4, side: "left", confidence: "high", kind: "initial_contact" }, { id: "bad", timeMs: "x", side: "left" }], intervals: [] });
    expect(imported?.events).toEqual([{ id: "a", timeMs: 100, side: "left", confidence: "high", kind: "initial_contact" }]);
  });
  it("exporta CSV local com eventos e intervalos", () => {
    const document = { ...emptyAnnotation("V02"), events: [{ id: "a", timeMs: 200, side: "right" as const, confidence: "medium" as const, kind: "initial_contact" as const }], intervals: [{ id: "p", kind: "pause" as const, startMs: 300, endMs: 400 }] };
    expect(annotationCsv(document)).toContain("initial_contact,a,200,,right,medium");
    expect(annotationCsv(document)).toContain("pause,p,300,400");
  });
  it("compara eventos com tolerância pré-definida sem casar duplicados", () => {
    const reference = [{ id: "a", timeMs: 1000, side: "left" as const, confidence: "high" as const, kind: "initial_contact" as const }, { id: "b", timeMs: 2000, side: "right" as const, confidence: "medium" as const, kind: "initial_contact" as const }];
    expect(compareEvents(reference, [950, 1010, 2090], GAIT_EVENT_TOLERANCE_MS)).toEqual({ matched: 2, missed: 0, extra: 1, meanAbsoluteErrorMs: 50, matchRate: 1 });
  });
  it("não inclui marcações ambíguas ou de baixa confiança na referência primária", () => {
    const reference = [{ id: "a", timeMs: 1000, side: "unknown" as const, confidence: "low" as const, kind: "ambiguous" as const }];
    expect(compareEvents(reference, [1000])).toEqual({ matched: 0, missed: 0, extra: 1, meanAbsoluteErrorMs: null, matchRate: null });
  });
});
