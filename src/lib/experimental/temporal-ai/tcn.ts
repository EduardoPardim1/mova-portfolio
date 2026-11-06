import { INPUT_CHANNELS, RECEPTIVE_FIELD, type Tensor } from "./data";

const CHANNELS = 8;
const DILATIONS = [1, 2, 4, 8];
type Layer = { inputs: number; outputs: number; kernel: number; dilation: number; residual: boolean; relu: boolean; weights: Float64Array; bias: Float64Array };
type Gradient = { weights: Float64Array; bias: Float64Array };
const zeros = (rows: number, columns: number): Tensor => Array.from({ length: rows }, () => Array<number>(columns).fill(0));
const sigmoid = (value: number) => value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));

/** TCN causal mínima própria. Somente laboratório: não é detector treinado/validado. */
export class TinyContactTcn {
  readonly status = "synthetic-only-not-validated";
  readonly receptiveField = RECEPTIVE_FIELD;
  readonly layers: Layer[];

  constructor(seed = 21) {
    if (!Number.isInteger(seed)) throw new Error("Semente inválida.");
    let state = seed >>> 0;
    const random = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 2 ** 32; };
    const layer = (inputs: number, outputs: number, kernel: number, dilation: number, residual: boolean, relu: boolean): Layer => ({
      inputs, outputs, kernel, dilation, residual, relu,
      weights: Float64Array.from({ length: inputs * outputs * kernel }, () => (random() * 2 - 1) * Math.sqrt(3 / (inputs * kernel))),
      bias: new Float64Array(outputs),
    });
    this.layers = [layer(INPUT_CHANNELS, CHANNELS, 1, 1, false, true),
      ...DILATIONS.map((d) => layer(CHANNELS, CHANNELS, 3, d, true, true)),
      layer(CHANNELS, 2, 1, 1, false, false)];
  }

  get parameterCount() { return this.layers.reduce((n, l) => n + l.weights.length + l.bias.length, 0); }

  private forward(input: Tensor) {
    if (!input.length || input.length > 256 || input.some((r) => r.length !== INPUT_CHANNELS || r.some((v) => !Number.isFinite(v) || Math.abs(v) > 5))) throw new Error("Tensor inválido ou acima do limite de 256 quadros.");
    const activations = [input];
    for (const layer of this.layers) {
      const previous = activations.at(-1)!;
      const output = zeros(input.length, layer.outputs);
      for (let t = 0; t < input.length; t++) for (let o = 0; o < layer.outputs; o++) {
        let sum = layer.bias[o] + (layer.residual ? previous[t][o] : 0);
        for (let k = 0; k < layer.kernel; k++) {
          const source = t - k * layer.dilation;
          if (source < 0) continue;
          for (let i = 0; i < layer.inputs; i++) sum += previous[source][i] * layer.weights[(o * layer.kernel + k) * layer.inputs + i];
        }
        if (!Number.isFinite(sum)) throw new Error("Falha numérica na TCN.");
        output[t][o] = layer.relu ? Math.max(0, sum) : sum;
      }
      activations.push(output);
    }
    return activations;
  }

  /** Escores [IC esquerdo, IC direito]; jamais eventos clínicos ou confiança calibrada. */
  scores(input: Tensor) { return this.forward(input).at(-1)!.map((row) => row.map(sigmoid)); }

  lossAndGradients(input: Tensor, targets: Tensor, mask: Tensor, positiveWeight = 1) {
    const validTarget = (row: number[]) => row.length === 2 && row.every((v) => v === 0 || v === 1);
    if (targets.length !== input.length || mask.length !== input.length || !targets.every(validTarget) || !mask.every(validTarget)
      || !Number.isFinite(positiveWeight) || positiveWeight < 1 || positiveWeight > 100) throw new Error("Alvos, máscaras ou peso de classe inválidos.");
    const count = mask.flat().reduce((a, b) => a + b, 0);
    if (!count) throw new Error("Sem rótulos elegíveis: ausência não é classe negativa.");
    const activations = this.forward(input), logits = activations.at(-1)!;
    let loss = 0;
    let upstream = zeros(input.length, 2);
    for (let t = 0; t < input.length; t++) for (let side = 0; side < 2; side++) {
      const z = logits[t][side], y = targets[t][side];
      const weight = mask[t][side] * (y ? positiveWeight : 1) / count;
      loss += weight * (Math.max(z, 0) - z * y + Math.log1p(Math.exp(-Math.abs(z))));
      upstream[t][side] = weight * (sigmoid(z) - y);
    }
    const gradients: Gradient[] = [];
    for (let l = this.layers.length - 1; l >= 0; l--) {
      const layer = this.layers[l], previous = activations[l], output = activations[l + 1];
      const grad = { weights: new Float64Array(layer.weights.length), bias: new Float64Array(layer.bias.length) };
      const downstream = zeros(input.length, layer.inputs);
      for (let t = 0; t < input.length; t++) for (let o = 0; o < layer.outputs; o++) {
        const delta = layer.relu && output[t][o] <= 0 ? 0 : upstream[t][o];
        grad.bias[o] += delta;
        if (layer.residual) downstream[t][o] += delta;
        for (let k = 0; k < layer.kernel; k++) {
          const source = t - k * layer.dilation;
          if (source < 0) continue;
          for (let i = 0; i < layer.inputs; i++) {
            const index = (o * layer.kernel + k) * layer.inputs + i;
            grad.weights[index] += delta * previous[source][i];
            downstream[source][i] += delta * layer.weights[index];
          }
        }
      }
      gradients.unshift(grad);
      upstream = downstream;
    }
    return { loss, gradients };
  }

  /** Um passo SGD, com clipping global. Sem I/O, loops de épocas ou pesos reais. */
  trainSyntheticStep(input: Tensor, targets: Tensor, mask: Tensor, learningRate = .02, positiveWeight = 1) {
    if (!Number.isFinite(learningRate) || learningRate <= 0 || learningRate > .1) throw new Error("Taxa de aprendizado inválida.");
    const { loss, gradients } = this.lossAndGradients(input, targets, mask, positiveWeight);
    let norm = 0;
    for (const grad of gradients) for (const values of [grad.weights, grad.bias]) for (const value of values) norm += value * value;
    norm = Math.sqrt(norm);
    if (!Number.isFinite(loss) || !Number.isFinite(norm)) throw new Error("Gradiente inválido; pesos preservados.");
    const factor = learningRate / Math.max(1, norm);
    this.layers.forEach((layer, l) => {
      for (let i = 0; i < layer.weights.length; i++) layer.weights[i] -= factor * gradients[l].weights[i];
      for (let i = 0; i < layer.bias.length; i++) layer.bias[i] -= factor * gradients[l].bias[i];
    });
    return { loss, gradientNorm: norm };
  }
}
