import { seekPresentedFrame } from "../video-frame-sampling";
import { createHighFrequencySamplingSession } from "./gait-high-frequency-pipeline";
import { exportCandidateRun } from "./gait-candidate-comparison";
import { runContactExperiments, type FootFrame, type FootPoint } from "./gait-contact-prototypes";

export const CONTACT_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";
export const CONTACT_WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";

/** Só o harness local importa esta coleta. Dados de pose nunca saem desta função. */
export async function captureContactLab(video: HTMLVideoElement, videoId: string, mode: "playback-lite" | "offline-lite" | "offline-full" = "playback-lite") {
  if (!video.requestVideoFrameCallback || !Number.isFinite(video.duration) || video.duration <= 0 || video.duration > 120) throw new Error("Vídeo ou callbacks inelegíveis para o ensaio local.");
  const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
  const started = performance.now();
  const vision = await FilesetResolver.forVisionTasks(CONTACT_WASM_URL);
  const model = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: mode === "offline-full" ? CONTACT_MODEL_URL.replaceAll("pose_landmarker_lite", "pose_landmarker_full") : CONTACT_MODEL_URL, delegate: "CPU" }, runningMode: "VIDEO", numPoses: 1,
    minPoseDetectionConfidence: .5, minTrackingConfidence: .5, minPosePresenceConfidence: .5,
  });
  const frames: FootFrame[] = [];
  const session = createHighFrequencySamplingSession({ targetHz: 30, perspective: "lateral", durationMs: Math.round(video.duration * 1000) });
  const aspect = video.videoWidth / video.videoHeight;
  const seekAudit: Array<{ targetMs: number; presentedMs: number }> = [];
  let handle: number | null = null;
  const observe = (metadata: { mediaTime: number; presentedFrames?: number }) => {
    session.observe(metadata, () => {
      const timeMs = Math.round(metadata.mediaTime * 1000);
      const pose = model.detectForVideo(video, timeMs).landmarks[0];
      if (!pose) return null;
      // A API instalada expõe visibility; presence só é usado se vier na resposta.
      const point = (i: number): FootPoint => ({ x: pose[i]?.x * aspect, y: pose[i]?.y, visibility: pose[i]?.visibility ?? 0, presence: (pose[i] as { presence?: number } | undefined)?.presence });
      const leftHip = point(23), rightHip = point(24);
      frames.push({ timeMs,
        hip: { x: (leftHip.x + rightHip.x) / 2, y: (leftHip.y + rightHip.y) / 2, visibility: Math.min(leftHip.visibility, rightHip.visibility), presence: Math.min(leftHip.presence ?? 1, rightHip.presence ?? 1) },
        left: { ankle: point(27), heel: point(29), toe: point(31) },
        right: { ankle: point(28), heel: point(30), toe: point(32) },
      });
      return { timeMs, leftAnkleX: pose[27]?.x ?? null, rightAnkleX: pose[28]?.x ?? null,
        leftAnkleY: pose[27]?.y ?? null, rightAnkleY: pose[28]?.y ?? null,
        hipCenterX: (pose[23].x + pose[24].x) / 2, hipCenterY: (pose[23].y + pose[24].y) / 2,
        visibility: Math.min(pose[27]?.visibility ?? 0, pose[28]?.visibility ?? 0) };
    });
  };
  try {
    if (mode !== "playback-lite") {
      video.pause();
      for (let index = 1; (index + .5) / 30 < video.duration - .016; index++) {
        if (performance.now() - started > 180000) throw new Error("Tempo máximo da extração pausada excedido.");
        // Alvo no centro da célula, evitando a ambiguidade de busca na borda.
        // Somente mediaTime observado é fornecido ao detector.
        const target = (index + .5) / 30 + .001;
        const metadata = await seekPresentedFrame(video, target);
        seekAudit.push({ targetMs: Math.round(target * 1000), presentedMs: Math.round(metadata.mediaTime * 1000) });
        observe(metadata);
      }
    } else {
    await new Promise<void>((resolve, reject) => {
      let finished = false, lastProgress = performance.now();
      const timer = setInterval(() => {
        if (performance.now() - lastProgress > 10000 || performance.now() - started > 180000) finish(new Error("Processamento sem progresso ou tempo máximo excedido."));
      }, 1000);
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        clearInterval(timer);
        video.removeEventListener("ended", ended);
        video.removeEventListener("error", failed);
        if (handle !== null) video.cancelVideoFrameCallback(handle);
        video.pause();
        if (error) reject(error); else resolve();
      };
      const ended = () => finish();
      const failed = () => finish(new Error("Falha de reprodução local."));
      const frame: VideoFrameRequestCallback = (_, metadata) => {
        if (finished) return;
        lastProgress = performance.now();
        observe(metadata);
        if (video.ended) finish(); else handle = video.requestVideoFrameCallback(frame);
      };
      video.addEventListener("ended", ended);
      video.addEventListener("error", failed);
      video.currentTime = 0;
      video.muted = true;
      video.play().then(() => { if (!finished) handle = video.requestVideoFrameCallback(frame); }).catch(() => finish(new Error("Reprodução recusada.")));
    });
    }
    const result = session.finalize();
    const processingMs = Math.round(performance.now() - started);
    return {
      mode,
      seekAudit,
      metadata: { durationMs: Math.round(video.duration * 1000), width: video.videoWidth, height: video.videoHeight, nativeFps: null, visuallyDistinctFrames: "not_verified" },
      baseline: exportCandidateRun(result, { videoId, runId: crypto.randomUUID(), exportedAt: new Date().toISOString(), processingMs }),
      laboratory: runContactExperiments(frames, "lateral"),
    };
  } finally {
    if (handle !== null) video.cancelVideoFrameCallback(handle);
    video.pause(); model.close(); frames.length = 0;
  }
}

/** Busca local: aguarda seeked + apresentação; timeout impede travamento. */
export { seekPresentedFrame } from "../video-frame-sampling";
