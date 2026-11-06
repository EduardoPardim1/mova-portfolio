import { describe, expect, it } from "vitest";
import { analyseFootSeparationCandidates } from "@/lib/gait-alternative-signals";

describe("sinal alternativo de separação dos pés", () => {
  it("produz candidatos de baixa confiança sem atribuir contato ou lado", () => {
    const samples = Array.from({ length: 40 }, (_, index) => ({ timeMs: index * 100, leftAnkleX: 0.5 - (index % 10 === 5 ? 0.2 : 0.03), rightAnkleX: 0.5 + (index % 10 === 5 ? 0.2 : 0.03), leftAnkleY: 0.7, rightAnkleY: 0.7, visibility: 0.9 }));
    const result = analyseFootSeparationCandidates(samples);
    expect(result.dependency).toBe("mediapipe-landmarks");
    expect(result.candidates.length).toBeGreaterThan(1);
    expect(result.candidates.every((event) => event.confidence === "low" && event.note.includes("não é contato"))).toBe(true);
  });

  it("não produz candidatos para sinal plano", () => {
    const samples = Array.from({ length: 20 }, (_, index) => ({ timeMs: index * 100, leftAnkleX: 0.4, rightAnkleX: 0.6, leftAnkleY: 0.7, rightAnkleY: 0.7, visibility: 0.9 }));
    expect(analyseFootSeparationCandidates(samples).candidates).toHaveLength(0);
  });
});
