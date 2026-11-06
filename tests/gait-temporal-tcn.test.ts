import { describe, expect, it } from "vitest";
import { assertDevelopmentManifest, INPUT_CHANNELS, INPUT_POINTS, normalizePose, prepareTargets, prepareWindow, RECEPTIVE_FIELD, type Landmark, type PoseFrame, type SplitEntry } from "../src/lib/experimental/temporal-ai/data";
import { TinyContactTcn } from "../src/lib/experimental/temporal-ai/tcn";

// Geometria inteiramente artificial; nenhum vídeo, pessoa ou landmark real.
function pose(): Landmark[] {
  const points = Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: 1 }));
  points[11] = { x: .4, y: .2, visibility: 1 };
  points[12] = { x: .6, y: .2, visibility: 1 };
  INPUT_POINTS.forEach((index, i) => { points[index] = { x: i % 2 ? .55 : .45, y: .5 + Math.floor(i / 2) * .07, visibility: 1 }; });
  return points;
}
function frames(): PoseFrame[] {
  return Array.from({ length: 64 }, (_, i) => ({ timeMs: i * 1000 / 30, landmarks: pose() }));
}
function synthetic() {
  const input = Array.from({ length: 64 }, (_, t) => Array.from({ length: INPUT_CHANNELS }, (_, i) => .2 + .1 * Math.sin(t / 4 + i)));
  const targets = input.map((_, t) => [Number(t % 16 === 8), Number(t % 16 === 0)]);
  const mask = input.map((_, t) => [Number(t >= 30), Number(t >= 30)]);
  return { input, targets, mask };
}

describe("contrato isolado de dados temporais", () => {
  it("preserva origem/escala e corrige proporção da imagem, sem mutar a pose", () => {
    const original = pose(), snapshot = structuredClone(original);
    const output = normalizePose(original, 1920, 1080);
    const shifted = original.map((p) => ({ ...p, x: .5 + (p.x - .5) * .5, y: .1 + p.y * .5 }));
    const transformed = normalizePose(shifted, 1920, 1080);
    output.forEach((value, i) => expect(transformed[i]).toBeCloseTo(value, 10));
    expect(output[0]).toBeCloseTo((.45 - .5) * 1920 / (.3 * 1080));
    expect(output).toHaveLength(30);
    expect(original).toEqual(snapshot);
  });

  it("mascara ausências/NaN e recusa escala inválida sem inventar coordenadas", () => {
    const points = pose();
    points[31].x = NaN;
    points[32].visibility = .1;
    expect(normalizePose(points, 640, 480).slice(-6)).toEqual([0, 0, 0, 0, 0, 0]);
    points[11].visibility = 0;
    expect(normalizePose(points, 640, 480).every((v) => v === 0)).toBe(true);
    expect(() => normalizePose(points, 0, 480)).toThrow();
  });

  it("não reutiliza frames, não inventa 30 Hz a partir de 10 Hz e preserva timestamps", () => {
    const source = frames(), before = structuredClone(source);
    const good = prepareWindow(source, 0, 640, 480);
    expect(good.missingFrames).toBe(0);
    expect(good.eligible.filter(Boolean)).toHaveLength(34);
    expect(good.sourceTimesMs).toEqual(source.map((f) => f.timeMs));
    const sparse = prepareWindow(source.filter((_, i) => i % 3 === 0), 0, 640, 480);
    expect(sparse.missingFrames).toBeGreaterThan(40);
    expect(sparse.eligible.some(Boolean)).toBe(false);
    expect(source).toEqual(before);
    expect(() => prepareWindow([source[0], source[0]], 0, 640, 480)).toThrow(/únicos/);
  });

  it("ausência reinicia contexto elegível e labels incompletos não viram negativos", () => {
    const source = frames();
    source[32].landmarks = [];
    const window = prepareWindow(source, 0, 640, 480);
    expect(window.eligible[31]).toBe(true);
    expect(window.eligible[32]).toBe(false);
    expect(window.eligible[61]).toBe(false);
    expect(window.eligible[63]).toBe(true);
    expect(prepareTargets(window, [], []).mask.flat().every((v) => v === 0)).toBe(true);
  });

  it("rotula esquerdo/direito, exclusões, bordas e colisões de forma explícita", () => {
    const window = prepareWindow(frames(), 0, 640, 480);
    const labeled = [{ startMs: 0, endMs: 2100, side: "left" as const }, { startMs: 0, endMs: 2100, side: "right" as const }];
    const result = prepareTargets(window, [{ timeMs: 1200, side: "left" }, { timeMs: 1500, side: "right" }, { timeMs: 2200, side: "left" }], labeled, [{ startMs: 1490, endMs: 1510, side: "right" }]);
    expect(result.targets[36]).toEqual([1, 0]);
    expect(result.targets[45]).toEqual([0, 1]);
    expect(result.mask[45]).toEqual([1, 0]);
    expect(result.unavailable).toBe(1);
    expect(result.outside).toBe(1);
    expect(() => prepareTargets(window, [{ timeMs: 1200, side: "left" }, { timeMs: 1201, side: "left" }], labeled)).toThrow(/mesma célula/);
  });

  it("bloqueia reservados e vazamento por pessoa, arquivo ou hash", () => {
    const base: SplitEntry = { participantId: "S001", videoId: "NEW-001", sha256: "a".repeat(64), split: "train" };
    expect(() => assertDevelopmentManifest([base])).not.toThrow();
    for (const videoId of ["V07", "V08", "V10", "P19-01", "P23-01", "p23-01.mp4.mp4"]) expect(() => assertDevelopmentManifest([{ ...base, videoId }])).toThrow();
    expect(() => assertDevelopmentManifest([base, { ...base, videoId: "NEW-002", sha256: "b".repeat(64), split: "test" }])).toThrow(/Vazamento/);
    expect(() => assertDevelopmentManifest([base, { ...base, participantId: "S002", videoId: "NEW-002", split: "validation" }])).toThrow(/Vazamento/);
    expect(() => assertDevelopmentManifest([base, { ...base, participantId: "S002", sha256: "b".repeat(64), split: "test" }])).toThrow(/Vazamento/);
  });
});

describe("TCN pequena, somente prova sintética", () => {
  it("tem 1066 parâmetros, 31 quadros de contexto e inicialização reproduzível", () => {
    const a = new TinyContactTcn(21), b = new TinyContactTcn(21), { input } = synthetic();
    expect(a.parameterCount).toBe(1066);
    expect(a.receptiveField).toBe(RECEPTIVE_FIELD);
    expect(a.scores(input)).toEqual(b.scores(input));
    expect(a.status).toBe("synthetic-only-not-validated");
  });

  it("é causal e não consulta quadros futuros", () => {
    const model = new TinyContactTcn(), { input } = synthetic();
    const before = model.scores(input);
    input[40].fill(4);
    expect(model.scores(input).slice(0, 40)).toEqual(before.slice(0, 40));
  });

  it("gradientes de todas as camadas concordam com diferenças finitas", () => {
    const model = new TinyContactTcn(7), { input, targets, mask } = synthetic();
    const { gradients } = model.lossAndGradients(input, targets, mask, 3);
    model.layers.forEach((layer, l) => {
      for (const kind of ["weights", "bias"] as const) {
        const candidates = [...gradients[l][kind]].map((g, i) => ({ g, i })).sort((a, b) => Math.abs(b.g) - Math.abs(a.g)).slice(0, 3);
        expect(candidates.some(({ g }) => Math.abs(g) > 1e-9)).toBe(true);
        for (const { i, g } of candidates) {
          const value = layer[kind][i], epsilon = 1e-5;
          layer[kind][i] = value + epsilon;
          const plus = model.lossAndGradients(input, targets, mask, 3).loss;
          layer[kind][i] = value - epsilon;
          const minus = model.lossAndGradients(input, targets, mask, 3).loss;
          layer[kind][i] = value;
          expect((plus - minus) / (2 * epsilon)).toBeCloseTo(g, 6);
        }
      }
    });
  });

  it("rótulos mascarados não afetam perda ou gradientes e lote vazio é recusado", () => {
    const model = new TinyContactTcn(), { input, targets, mask } = synthetic();
    const baseline = model.lossAndGradients(input, targets, mask);
    targets[0] = [1, 1];
    expect(model.lossAndGradients(input, targets, mask)).toEqual(baseline);
    expect(() => model.lossAndGradients(input, targets, mask.map(() => [0, 0]))).toThrow(/Sem rótulos/);
    expect(() => model.scores(input.map((r) => r.slice(1)))).toThrow(/Tensor/);
    expect(() => model.scores(Array.from({ length: 257 }, () => input[0]))).toThrow(/limite/);
    input[0][0] = NaN;
    expect(() => model.scores(input)).toThrow(/Tensor/);
  });

  it("executa pipeline→loss→SGD e reduz perda sintética, sem alegar acurácia", () => {
    const started = performance.now();
    const window = prepareWindow(frames(), 0, 640, 480);
    const labeled = (["left", "right"] as const).map((side) => ({ side, startMs: 0, endMs: 2100 }));
    const { targets, mask } = prepareTargets(window, [{ timeMs: 1200, side: "left" }, { timeMs: 1800, side: "right" }], labeled);
    const model = new TinyContactTcn(21);
    const before = model.layers.map((l) => [...l.weights]);
    const initial = model.lossAndGradients(window.input, targets, mask).loss;
    for (let step = 0; step < 80; step++) model.trainSyntheticStep(window.input, targets, mask);
    const final = model.lossAndGradients(window.input, targets, mask).loss;
    expect(final).toBeLessThan(initial);
    expect(model.layers.every((l, i) => l.weights.some((w, j) => w !== before[i][j]))).toBe(true);
    expect(model.scores(window.input).flat().every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
    console.info(JSON.stringify({ test: "sintético, não valida marcha", parameters: model.parameterCount, steps: 80, initialLoss: initial, finalLoss: final, elapsedMs: Math.round(performance.now() - started) }));
  });
});
