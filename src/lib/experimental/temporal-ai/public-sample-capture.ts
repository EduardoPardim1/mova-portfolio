import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { seekPresentedFrame } from "../gait-contact-lab-capture";
import type { PoseFrame } from "./data";
import { summarizePublicSample } from "./public-sample-qc";
import { probeUntrainedTcn } from "./public-sample-inference";

/** Um trecho prefixado de 12 s; sem escolher trecho pelo resultado do detector. */
export async function capturePublicSample(video: HTMLVideoElement) {
  if (!video.requestVideoFrameCallback || !Number.isFinite(video.duration) || video.duration < 12) throw new Error("Amostra/callback incompatível com o protocolo de 12 segundos.");
  const started = performance.now();
  const model = await PoseLandmarker.createFromOptions(await FilesetResolver.forVisionTasks("/wasm"), {
    baseOptions: { modelAssetPath: "/model.task", delegate: "CPU" }, runningMode: "VIDEO", numPoses: 1,
    minPoseDetectionConfidence: .5, minTrackingConfidence: .5, minPosePresenceConfidence: .5,
  });
  const frames: PoseFrame[] = [];
  let duplicatePresentedFrames = 0;
  const seeks: { targetMs: number; presentedMs: number }[] = [];
  try {
    video.pause(); video.muted = true;
    for (let index = 0; index < 360; index++) {
      if (performance.now() - started > 180000) throw new Error("Orçamento de 180 segundos excedido.");
      const target = (index + .5) / 30 + .001;
      const metadata = await seekPresentedFrame(video, target);
      const timeMs = metadata.mediaTime * 1000;
      seeks.push({ targetMs: target * 1000, presentedMs: timeMs });
      if (timeMs < 0 || timeMs >= 12000) throw new Error("Quadro fora do trecho solicitado.");
      if (frames.length && timeMs <= frames.at(-1)!.timeMs) { duplicatePresentedFrames++; continue; }
      const landmarks = model.detectForVideo(video, timeMs).landmarks[0] ?? [];
      frames.push({ timeMs, landmarks });
    }
    return { metadata: { width: video.videoWidth, height: video.videoHeight, durationMs: video.duration * 1000, nativeFps: null },
      requestedHz: 30, segment: { startMs: 0, endMs: 12000 }, seeks, duplicatePresentedFrames,
      qc: summarizePublicSample(frames, video.videoWidth, video.videoHeight, 12000),
      tcn: probeUntrainedTcn(frames, video.videoWidth, video.videoHeight, 12000), processingMs: performance.now() - started,
      visuallyDistinctFrames: "não verificado; timestamps diferentes não provam imagens distintas",
      anatomicalSideVerified: false, independentVisualReview: false };
  } finally { model.close(); frames.length = 0; video.pause(); }
}
