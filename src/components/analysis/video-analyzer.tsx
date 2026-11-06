"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, FileVideo, Pause, Play, RotateCcw, ScanLine, Square } from "lucide-react";
import { samplePresentedVideo } from "@/lib/video-frame-sampling";
import type { VideoAnalysis } from "@/lib/pose-analysis";
import { analysePoseSamples, calculateKneeAngles, type PoseSample } from "@/lib/pose-analysis";
import { analyseFootSeparationCandidates } from "@/lib/gait-alternative-signals";
import { compareVerticalV03WithAp, type GaitMethodComparison } from "@/lib/experimental/gait-ap-event-detector";
import { analyseScientificInitialContactCandidates, type ScientificEventAnalysis } from "@/lib/experimental/gait-scientific-event-detector";
import { analyseFootSeparationRhythm, type RhythmPerspective, type RhythmScreenAnalysis } from "@/lib/experimental/gait-rhythm-screen";

type Landmark = { x: number; y: number; z: number; visibility?: number };
type Landmarker = { detectForVideo: (video: HTMLVideoElement, timestamp: number) => { landmarks: Landmark[][] }; close: () => void };

const connections: Array<[number, number]> = [[0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],[11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],[12,14],[14,16],[16,18],[16,20],[16,22],[18,20],[11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[29,31],[31,27],[24,26],[26,28],[28,30],[30,32],[32,28]];
const wasmUrl = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";
const modelUrl = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";

export function VideoAnalyzer({ distanceMeters, onComplete }: { distanceMeters?: number; onComplete: (value: VideoAnalysis) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<Landmarker | null>(null);
  const rafRef = useRef<number>(0);
  const objectUrlRef = useRef<string | null>(null);
  const samplesRef = useRef<PoseSample[]>([]);
  const lastSampleMs = useRef(-Infinity);
  const lastUiUpdateMs = useRef(0);
  const cancelFileProcessing = useRef(false);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "processing" | "error">("idle");
  const [message, setMessage] = useState("Selecione um vídeo ou habilite a câmera.");
  const [source, setSource] = useState<"camera" | "file" | null>(null);
  const [running, setRunning] = useState(false);
  const [quality, setQuality] = useState<number | null>(null);
  const [missingFrames, setMissingFrames] = useState(0);

  const releaseCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current?.srcObject) videoRef.current.srcObject = null;
    setSource((current) => current === "camera" ? null : current);
  }, []);
  const releaseFile = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    cancelFileProcessing.current = true;
    releaseCamera();
    releaseFile();
    landmarkerRef.current?.close();
  }, [releaseCamera, releaseFile]);

  const loadModel = useCallback(async () => {
    if (landmarkerRef.current) return landmarkerRef.current;
    setState("loading");
    setMessage("Carregando MediaPipe Pose Landmarker localmente…");
    try {
      const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks(wasmUrl);
      let model: unknown;
      try {
        model = await PoseLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: modelUrl, delegate: "GPU" }, runningMode: "VIDEO", numPoses: 1, minPoseDetectionConfidence: .5, minTrackingConfidence: .5, minPosePresenceConfidence: .5 });
      } catch {
        model = await PoseLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: modelUrl, delegate: "CPU" }, runningMode: "VIDEO", numPoses: 1, minPoseDetectionConfidence: .5, minTrackingConfidence: .5, minPosePresenceConfidence: .5 });
      }
      landmarkerRef.current = model as Landmarker;
      setState("ready");
      setMessage("Modelo pronto. Inicie a análise.");
      return landmarkerRef.current;
    } catch {
      setState("error");
      setMessage("Não foi possível carregar o MediaPipe. Verifique conexão, WebGL e compatibilidade do navegador.");
      return null;
    }
  }, []);

  const draw = useCallback((landmarks: Landmark[]) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#62d5c9";
    context.lineWidth = Math.max(2, canvas.width / 360);
    connections.forEach(([first, last]) => {
      const a = landmarks[first];
      const b = landmarks[last];
      if (a && b && (a.visibility ?? 1) >= .35 && (b.visibility ?? 1) >= .35) {
        context.beginPath();
        context.moveTo(a.x * canvas.width, a.y * canvas.height);
        context.lineTo(b.x * canvas.width, b.y * canvas.height);
        context.stroke();
      }
    });
    landmarks.forEach((point) => {
      if ((point.visibility ?? 1) < .35) return;
      context.beginPath();
      context.arc(point.x * canvas.width, point.y * canvas.height, Math.max(3, canvas.width / 200), 0, Math.PI * 2);
      context.fillStyle = "#eafffb";
      context.fill();
    });
  }, []);

  const recordFrame = useCallback((pose: Landmark[] | undefined, timestampMs: number) => {
    const leftAnkle = pose?.[27];
    const rightAnkle = pose?.[28];
    const visibility = pose ? Math.min(leftAnkle?.visibility ?? 0, rightAnkle?.visibility ?? 0) : 0;
    const knees = pose ? calculateKneeAngles(pose) : { left: null, right: null };
    if (pose) draw(pose);
    samplesRef.current.push({
      timeMs: timestampMs,
      leftAnkleY: leftAnkle?.y ?? null,
      rightAnkleY: rightAnkle?.y ?? null,
      leftAnkleX: leftAnkle?.x ?? null,
      rightAnkleX: rightAnkle?.x ?? null,
      hipCenterX: pose?.[23] && pose?.[24] ? (pose[23].x + pose[24].x) / 2 : null,
      hipCenterY: pose?.[23] && pose?.[24] ? (pose[23].y + pose[24].y) / 2 : null,
      leftHeelX: pose?.[29]?.x ?? null,
      rightHeelX: pose?.[30]?.x ?? null,
      leftHeelY: pose?.[29]?.y ?? null,
      rightHeelY: pose?.[30]?.y ?? null,
      leftFootIndexX: pose?.[31]?.x ?? null,
      rightFootIndexX: pose?.[32]?.x ?? null,
      leftFootIndexY: pose?.[31]?.y ?? null,
      rightFootIndexY: pose?.[32]?.y ?? null,
      leftAnkleVisibility: pose?.[27]?.visibility ?? null,
      rightAnkleVisibility: pose?.[28]?.visibility ?? null,
      leftHeelVisibility: pose?.[29]?.visibility ?? null,
      rightHeelVisibility: pose?.[30]?.visibility ?? null,
      leftHipVisibility: pose?.[23]?.visibility ?? null,
      rightHipVisibility: pose?.[24]?.visibility ?? null,
      visibility,
      leftKneeAngle: knees.left,
      rightKneeAngle: knees.right,
    });
    if (timestampMs - lastUiUpdateMs.current >= 400) {
      lastUiUpdateMs.current = timestampMs;
      setQuality(visibility);
      if (visibility < .35) setMissingFrames((value) => value + 1);
      else setMissingFrames(0);
    }
  }, [draw]);

  const complete = useCallback((duration: number) => {
    cancelAnimationFrame(rafRef.current);
    setRunning(false);
    const analysis = analysePoseSamples(samplesRef.current, duration, distanceMeters);
    if (process.env.NODE_ENV !== "production") {
      const developmentWindow = window as Window & { __MOVA_LAST_GAIT_ANALYSIS__?: VideoAnalysis; __MOVA_LAST_GAIT_ALTERNATIVE__?: ReturnType<typeof analyseFootSeparationCandidates>; __MOVA_LAST_GAIT_AP_EXPERIMENT__?: GaitMethodComparison; __MOVA_LAST_GAIT_SCIENTIFIC_EXPERIMENT__?: ScientificEventAnalysis; __MOVA_LAST_GAIT_RHYTHM_EXPERIMENT__?: RhythmScreenAnalysis; __MOVA_LAST_POSE_SAMPLES__?: PoseSample[]; __MOVA_GAIT_PERSPECTIVE__?: RhythmPerspective };
      const perspective = developmentWindow.__MOVA_GAIT_PERSPECTIVE__ ?? "indeterminate";
      developmentWindow.__MOVA_LAST_GAIT_ANALYSIS__ = analysis;
      developmentWindow.__MOVA_LAST_GAIT_ALTERNATIVE__ = analyseFootSeparationCandidates(samplesRef.current);
      developmentWindow.__MOVA_LAST_GAIT_AP_EXPERIMENT__ = compareVerticalV03WithAp(samplesRef.current, duration, perspective);
      developmentWindow.__MOVA_LAST_GAIT_SCIENTIFIC_EXPERIMENT__ = analyseScientificInitialContactCandidates(samplesRef.current, perspective);
      developmentWindow.__MOVA_LAST_GAIT_RHYTHM_EXPERIMENT__ = analyseFootSeparationRhythm(samplesRef.current, perspective);
      // Somente desenvolvimento: permite auditoria local; nunca é persistido ou enviado.
      developmentWindow.__MOVA_LAST_POSE_SAMPLES__ = samplesRef.current;
    }
    onComplete(analysis);
    setState("ready");
    setMessage(`Análise concluída: ${analysis.usableFrames}/${analysis.totalFrames} quadros úteis.`);
  }, [distanceMeters, onComplete]);

  const processCameraFrame = useCallback(() => {
    const video = videoRef.current;
    const model = landmarkerRef.current;
    if (!video || !model || video.paused || video.ended) return;
    const timestamp = Math.round(video.currentTime * 1000);
    try {
      if (timestamp > lastSampleMs.current && timestamp - lastSampleMs.current >= 80) {
        lastSampleMs.current = timestamp;
        recordFrame(model.detectForVideo(video, timestamp).landmarks[0], timestamp);
      }
    } catch {
      recordFrame(undefined, timestamp);
    }
    rafRef.current = requestAnimationFrame(processCameraFrame);
  }, [recordFrame]);

  const processFile = useCallback(async (model: Landmarker, video: HTMLVideoElement) => {
    try {
      const result = await samplePresentedVideo(video, {
        hz: 10, // Preserve detector sampling scale; experimental 30 Hz is evaluated separately.
        cancelled: () => cancelFileProcessing.current,
        onFrame: timestamp => {
          try { recordFrame(model.detectForVideo(video, timestamp).landmarks[0], timestamp); }
          catch { recordFrame(undefined, timestamp); }
        },
        onProgress: timestamp => setMessage(`Analisando ${Math.min(timestamp / 1000, video.duration).toFixed(1)} s de ${video.duration.toFixed(1)} s…`),
      });
      if (result.cancelled) {
        setRunning(false); setState("ready");
        setMessage("Análise cancelada. Nenhum resultado parcial foi concluído.");
        return;
      }
      complete(video.duration);
    } catch {
      setRunning(false); setState("error");
      setMessage("Não foi possível obter os quadros apresentados. Use um navegador atualizado e tente novamente.");
    }
  }, [complete, recordFrame]);

  const startAnalysis = useCallback(async () => {
    // A new video timeline must not reuse MediaPipe tracking/timestamps from an earlier run.
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
    const model = await loadModel();
    const video = videoRef.current;
    if (!model || !video || !source) return;
    samplesRef.current = [];
    lastSampleMs.current = -Infinity;
    lastUiUpdateMs.current = 0;
    cancelFileProcessing.current = false;
    setMissingFrames(0);
    setState("processing");
    setRunning(true);
    try {
      if (source === "file") {
        video.pause();
        void processFile(model, video);
      } else {
        await video.play();
        rafRef.current = requestAnimationFrame(processCameraFrame);
      }
    } catch {
      setRunning(false);
      setState("error");
      setMessage("O navegador não conseguiu reproduzir esta mídia.");
    }
  }, [loadModel, processCameraFrame, processFile, source]);

  const stopAnalysis = useCallback(() => {
    if (source === "file") {
      cancelFileProcessing.current = true;
      return;
    }
    const video = videoRef.current;
    video?.pause();
    complete(video?.currentTime ?? 0);
    if (source === "camera") releaseCamera();
  }, [complete, releaseCamera, source]);

  async function useCamera() {
    releaseFile();
    releaseCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.src = "";
      video.srcObject = stream;
      video.muted = true;
      setSource("camera");
      setMessage("Câmera habilitada. Inicie a análise para mapear o corpo em tempo real.");
      await video.play();
      await loadModel();
    } catch {
      setState("error");
      setMessage("A câmera não está disponível ou a permissão foi negada.");
    }
  }

  function fileSelected(file: File | undefined) {
    if (!file) return;
    const supportedMime = ["video/mp4", "video/webm", "video/quicktime"].includes(file.type);
    const supportedExtension = /\.(mp4|webm|mov)$/i.test(file.name);
    if (!supportedMime && !supportedExtension) {
      setState("error");
      setMessage("Formato não suportado por esta análise. Use MP4, WebM ou MOV que seu navegador consiga reproduzir.");
      return;
    }
    if (file.size > 500 * 1024 * 1024) {
      setState("error");
      setMessage("O vídeo excede o limite local de 500 MB.");
      return;
    }
    releaseCamera();
    releaseFile();
    setSource("file");
    setState("idle");
    setMessage("Vídeo pronto. A análise usa amostras temporais reprodutíveis e não envia o arquivo ao servidor.");
    const video = videoRef.current!;
    const objectUrl = URL.createObjectURL(file);
    objectUrlRef.current = objectUrl;
    video.srcObject = null;
    video.src = objectUrl;
  }

  return <section className="card">
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><div><h2 style={{ marginTop: 0 }}>Vídeo e mapeamento corporal</h2><p className="muted">O vídeo é processado localmente neste navegador e não é enviado automaticamente.</p></div><span className="eyebrow">{state}</span></div>
    <div className="actions"><button type="button" className="button secondary" disabled={state === "loading" || running} onClick={useCamera}><Camera size={17} />Usar câmera</button><label className="button secondary"><FileVideo size={17} />Enviar vídeo<input disabled={state === "loading" || running} hidden type="file" accept="video/mp4,video/webm,video/quicktime" onChange={(event) => fileSelected(event.target.files?.[0])} /></label>{source && <button type="button" className="button primary" disabled={state === "loading"} onClick={running ? stopAnalysis : startAnalysis}>{running ? <><Pause size={17} />Finalizar análise</> : <><ScanLine size={17} />Processar vídeo</>}</button>}{source === "camera" && <button type="button" className="button secondary" onClick={releaseCamera}><Square size={17} />Encerrar câmera</button>}</div>
    <p className="notice" aria-live="polite">{message}</p>{quality !== null && <p className="muted">Qualidade atual da detecção: {Math.round(quality * 100)}%{missingFrames ? ` · ${missingFrames} intervalo(s) sem pessoa detectada` : ""}</p>}
    <div style={{ position: "relative", background: "#071d29", borderRadius: 12, overflow: "hidden", minHeight: source ? 240 : 0 }}><video ref={videoRef} controls playsInline onEnded={() => { if (source === "camera" && running) complete(videoRef.current?.currentTime ?? 0); }} onLoadedMetadata={() => setMessage("Mídia carregada. Você pode iniciar o processamento.")} style={{ width: "100%", display: source ? "block" : "none" }} /><canvas ref={canvasRef} aria-label="Esqueleto corporal detectado" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} /></div>
    {source && <div className="actions"><button className="button secondary" type="button" disabled={state === "loading" || running} onClick={() => void videoRef.current?.play()}><Play size={16} />Reproduzir</button><button className="button secondary" type="button" disabled={state === "loading" || running} onClick={() => { if (videoRef.current) videoRef.current.currentTime = 0; samplesRef.current = []; setQuality(null); }}><RotateCcw size={16} />Reiniciar</button></div>}
  </section>;
}
