export type AnnotationClock = { sha256: string; timesMs: number[]; durationMs: number };
/** Manifesto de conversão local; nunca estima FPS pelo nome do arquivo. */
export function parseAnnotationClock(value: unknown): AnnotationClock {
  const data = value as { convertedSha256?: string; convertedTimeline?: { timeBase?: number[]; frames?: { index: number; pts: number; duration: number }[] }; verification?: { equalPtsAndDurations?: boolean } };
  if (!data || !/^[a-f0-9]{64}$/.test(data.convertedSha256 ?? "") || data.verification?.equalPtsAndDurations !== true) throw new Error("Manifesto temporal inválido.");
  const timeline = data.convertedTimeline, base = timeline?.timeBase, frames = timeline?.frames;
  if (!base || base.length !== 2 || !base.every(n => Number.isInteger(n) && n > 0) || !Array.isArray(frames) || !frames.length || frames.length > 3600) throw new Error("Relógio inválido ou acima de 3.600 quadros.");
  if (frames.some((f, i) => !f || f.index !== i || !Number.isSafeInteger(f.pts) || f.pts < 0 || !Number.isSafeInteger(f.duration) || f.duration <= 0 || (i > 0 && f.pts !== frames[i - 1].pts + frames[i - 1].duration))) throw new Error("PTS não contíguos: não presumir quadro intermediário.");
  const timesMs = frames.map(f => f.pts * base[0] * 1000 / base[1]);
  const last = frames.at(-1)!;
  const durationMs = (last.pts + last.duration) * base[0] * 1000 / base[1];
  if (timesMs[0] !== 0 || !Number.isFinite(durationMs) || durationMs > 120000) throw new Error("Trecho fora do limite experimental.");
  return { sha256: data.convertedSha256!, timesMs, durationMs };
}

export function adjacentFrame(clock: AnnotationClock, currentMs: number, direction: "backward" | "forward") {
  if (!Number.isFinite(currentMs) || currentMs < 0) throw new Error("Relógio de reprodução inválido.");
  // O currentTime pode estar no meio da célula de apresentação: usar o seu início.
  let index = 0;
  while (index + 1 < clock.timesMs.length && clock.timesMs[index + 1] <= currentMs + .01) index++;
  return Math.max(0, Math.min(clock.timesMs.length - 1, index + (direction === "forward" ? 1 : -1)));
}

export async function seekAnnotationFrame(video: HTMLVideoElement, clock: AnnotationClock, index: number, signal: AbortSignal): Promise<number> {
  if (!Number.isInteger(index) || index < 0 || index >= clock.timesMs.length || !video.requestVideoFrameCallback) throw new Error("Busca exata indisponível.");
  const expected = clock.timesMs[index];
  const end = clock.timesMs[index + 1] ?? clock.durationMs;
  return new Promise((resolve, reject) => {
    let sought = false, presented: number | null = null, handle: number | null = null, done = false;
    const finish = (error?: Error) => {
      if (done) return; done = true; clearTimeout(timer);
      if (handle !== null) video.cancelVideoFrameCallback(handle);
      video.removeEventListener("seeked", seeked); video.removeEventListener("error", failed); signal.removeEventListener("abort", aborted);
      if (error) reject(error); else resolve(presented!);
    };
    const verify = () => { if (sought && presented !== null) finish(Math.abs(presented - expected) <= 1 ? undefined : new Error("O navegador apresentou outro PTS; quadro não confirmado.")); };
    const seeked = () => { sought = true; verify(); };
    const failed = () => finish(new Error("Falha de decodificação."));
    const aborted = () => finish(new Error("Busca cancelada."));
    const timer = setTimeout(() => finish(new Error("Sem quadro confirmado em 5 segundos.")), 5000);
    if (signal.aborted) { aborted(); return; }
    signal.addEventListener("abort", aborted); video.addEventListener("seeked", seeked); video.addEventListener("error", failed);
    video.pause();
    handle = video.requestVideoFrameCallback((_, metadata) => { presented = metadata.mediaTime * 1000; verify(); });
    video.currentTime = (expected + (end - expected) / 2) / 1000;
  });
}
