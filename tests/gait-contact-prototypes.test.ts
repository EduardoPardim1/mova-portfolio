import { describe, expect, it } from "vitest";
import { CONTACT_PROTOCOL, runContactExperiments, smoothContactSignal, type FootFrame, type FootPoint } from "../src/lib/experimental/gait-contact-prototypes";

// Trajetórias matemáticas, não extraídas de vídeo ou usadas como evidência clínica.
function fixture(hz = 30): FootFrame[] {
  const point = (x: number, y: number): FootPoint => ({ x, y, visibility: .99, presence: .99 });
  const foot = (t: number, offset: number) => {
    const cycle = Math.floor((t + offset) / 1.4), phase = (t + offset) / 1.4 - cycle;
    const swing = Math.max(0, (phase - .55) / .45);
    const x = .1 + .112 * (cycle + (1 - Math.cos(Math.PI * swing)) / 2);
    const y = .8 - .06 * Math.sin(Math.PI * swing);
    return { heel: point(x, y), toe: point(x + .04, y), ankle: point(x + .01, y - .025) };
  };
  return Array.from({ length: 8 * hz + 1 }, (_, i) => ({ timeMs: Math.round(i / hz * 1000), hip: point(.13 + .08 * i / hz, .45), left: foot(i / hz, 0), right: foot(i / hz, .7) }));
}
describe("protótipos isolados de contato", () => {
  it("executa seis hipóteses sobre a mesma trajetória sem mutar a entrada", () => {
    const data = fixture(), original = JSON.stringify(data);
    const result = runContactExperiments(data, "lateral");
    expect(result.experiments).toHaveLength(6);
    expect(result.experiments.every((e) => e.eligible)).toBe(true);
    expect(result.experiments[2].candidates.filter((c) => c.accepted).length).toBeGreaterThan(4);
    expect(JSON.stringify(data)).toBe(original);
    expect(Object.isFrozen(CONTACT_PROTOCOL)).toBe(true);
  });
  it("velocidade vertical exige elevação prévia e rejeita oscilações fora do solo", () => {
    const raised = runContactExperiments(fixture(50), "lateral").experiments[5];
    // Pé rígido em meia senoide: pico de velocidade ainda acima do limiar de
    // solo. O oráculo inicial que esperava aceitação aqui era incorreto.
    expect(raised.candidates.some((c) => c.reason === "heel_not_near_ground")).toBe(true);
    expect(raised.candidates.some((c) => c.accepted)).toBe(false);
    const heelFirst = fixture(50);
    for (const f of heelFirst) for (const side of ["left", "right"] as const) {
      // Sinais analíticos com pico descendente do ponto médio quando o
      // calcanhar está baixo. Testa a regra, não simula referência clínica.
      const phase = 2 * Math.PI * (f.timeMs / 1000 + (side === "left" ? 0 : .7)) / 1.4;
      const centreY = .75 - .05 * Math.sin(phase);
      f[side].heel.y = .75 - .05 * Math.cos(phase);
      f[side].toe.y = 2 * centreY - f[side].heel.y;
    }
    const r = runContactExperiments(heelFirst, "lateral");
    const e = r.experiments.find((e) => e.id === "E08-vertical-foot-velocity")!;
    expect(e.candidates.filter((c) => c.accepted).length, JSON.stringify(e.candidates)).toBeGreaterThan(3);
    const flat = fixture(50).map((f) => ({ ...f, left: { ...f.left, heel: { ...f.left.heel, y: .8 }, toe: { ...f.left.toe, y: .8 } }, right: { ...f.right, heel: { ...f.right.heel, y: .8 }, toe: { ...f.right.toe, y: .8 } } }));
    expect(runContactExperiments(flat, "lateral").experiments[5].candidates.some((c) => c.accepted)).toBe(false);
  });
  it("detecta término do swing sintético perto dos tempos definidos pela função", () => {
    const result = runContactExperiments(fixture(50), "lateral");
    const left = result.experiments[2].candidates.filter((c) => c.accepted && c.side === "left");
    expect(left.length).toBeGreaterThan(3);
    for (const c of left) expect(Math.abs(c.timeMs - Math.round(c.timeMs / 1400) * 1400)).toBeLessThanOrEqual(100);
  });
  it("espelhar o eixo horizontal preserva os lados e os eventos", () => {
    const data = fixture();
    const mirror = (a: FootPoint) => ({ ...a, x: 1 - a.x });
    const reflected = data.map((f) => ({ ...f, hip: mirror(f.hip), left: { ankle: mirror(f.left.ankle), heel: mirror(f.left.heel), toe: mirror(f.left.toe) }, right: { ankle: mirror(f.right.ankle), heel: mirror(f.right.heel), toe: mirror(f.right.toe) } }));
    expect(runContactExperiments(reflected, "lateral").experiments).toEqual(runContactExperiments(data, "lateral").experiments);
  });
  it("recusa 10 Hz, vista frontal, sequência vazia e timestamps repetidos", () => {
    expect(runContactExperiments(fixture(10), "lateral").experiments[0].unavailableReason).toBe("insufficient_sampling");
    expect(runContactExperiments(fixture(), "frontal").experiments.every((e) => !e.eligible)).toBe(true);
    expect(runContactExperiments([], "lateral").experiments.every((e) => !e.eligible)).toBe(true);
    const repeated = fixture(); repeated[1].timeMs = 0;
    expect(runContactExperiments(repeated, "lateral").experiments[0].unavailableReason).toBe("invalid_timestamps");
  });
  it("usa a mediana superior do baseline quando intervalos alternam 33/66 ms", () => {
    const data = fixture().slice(0, 101);
    let time = 0;
    data.forEach((f, i) => { if (i) time += i % 2 ? 33 : 66; f.timeMs = time; });
    const r = runContactExperiments(data, "lateral");
    expect(r.qc.effectiveHz).toBeCloseTo(1000 / 66);
    expect(r.experiments.every((e) => e.unavailableReason === "insufficient_sampling")).toBe(true);
  });
  it("segmenta lacunas sem produzir eventos nas bordas artificiais", () => {
    const result = runContactExperiments(fixture().filter((f) => f.timeMs < 2500 || f.timeMs > 3500), "lateral");
    expect(result.qc.gaps).toHaveLength(1);
    expect(result.qc.leftSegments).toHaveLength(2);
    for (const e of result.experiments) expect(e.candidates.filter((c) => c.accepted && c.timeMs >= 2400 && c.timeMs <= 3600)).toEqual([]);
  });
  it("qualidade/presença insuficiente de um pé não invalida silenciosamente o outro", () => {
    const data = fixture();
    data.forEach((f) => { f.left.toe.presence = .1; });
    const result = runContactExperiments(data, "lateral");
    expect(result.qc.leftUsable).toBe(0);
    expect(result.experiments[3].eligible).toBe(false);
    expect(result.experiments[2].candidates.some((c) => c.accepted && c.side === "right")).toBe(true);
    expect(result.experiments.flatMap((e) => e.candidates).some((c) => c.side === "left")).toBe(false);
  });
  it("recusa coordenadas/visibilidade não finitas", () => {
    const data = fixture();
    data.forEach((f) => { f.left.heel.x = NaN; f.right.toe.visibility = NaN; });
    const r = runContactExperiments(data, "lateral");
    expect(r.experiments.every((e) => !e.eligible)).toBe(true);
    expect(r.qc.leftUsable + r.qc.rightUsable).toBe(0);
  });
  it("não transforma vídeo estático em contatos", () => {
    const still = fixture().map((f) => ({ ...fixture()[0], timeMs: f.timeMs }));
    expect(runContactExperiments(still, "lateral").experiments.every((e) => !e.eligible && !e.candidates.length)).toBe(true);
  });
  it("consenso só mantém eventos realmente emitidos pela velocidade no mesmo lado", () => {
    const result = runContactExperiments(fixture(), "lateral");
    for (const c of result.experiments[4].candidates.filter((c) => c.accepted)) {
      expect(result.experiments[2].candidates.some((v) => v.accepted && v.timeMs === c.timeMs && v.side === c.side)).toBe(true);
      expect(result.experiments[1].candidates.some((v) => v.accepted && Math.abs(v.timeMs - c.timeMs) <= 150 && v.side === c.side)).toBe(true);
    }
  });
  it("suavização preserva constante e simetria sem deslocar impulso central", () => {
    const t = Array.from({ length: 21 }, (_, i) => i * 33);
    expect(smoothContactSignal(t, t.map(() => 3)).every((x) => Math.abs(x - 3) < 1e-12)).toBe(true);
    const filtered = smoothContactSignal(t, t.map((_, i) => i === 10 ? 1 : 0));
    expect(filtered.indexOf(Math.max(...filtered))).toBe(10);
    expect(filtered[9]).toBeCloseTo(filtered[11]);
  });
  it("saída serializada não contém coordenadas nem séries de landmarks", () => {
    const output = JSON.stringify(runContactExperiments(fixture(), "lateral"));
    for (const key of ['"x":', '"y":', '"heel":', '"toe":', '"hip":', '"visibility":']) expect(output).not.toContain(key);
  });
});
