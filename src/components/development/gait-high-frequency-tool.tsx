"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FileUp, Play, Square } from "lucide-react";
import { createHighFrequencySamplingSession, hasVideoSamplingEnded, supportsPresentedFrameCallbacks, type HighFrequencyResult, type HighFrequencyTargetHz, type PresentedFrameMetadata } from "@/lib/experimental/gait-high-frequency-pipeline";
import type { PoseSample } from "@/lib/pose-analysis";
import { exportCandidateRun } from "@/lib/experimental/gait-candidate-comparison";

type Landmark = { x: number; y: number; visibility?: number };
type Landmarker = { detectForVideo: (video: HTMLVideoElement, timestamp: number) => { landmarks: Landmark[][] }; close: () => void };
type VideoWithFrames = HTMLVideoElement & { requestVideoFrameCallback?: (callback: (now: number, metadata: PresentedFrameMetadata) => void) => number; cancelVideoFrameCallback?: (handle: number) => void };
type FinishReason = "completed" | "cancelled" | "failed";

const wasmUrl = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";
const modelUrl = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";

export function GaitHighFrequencyTool() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const urlRef = useRef<string | null>(null);
  const landmarkerRef = useRef<Landmarker | null>(null);
  const callbackRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const finishRef = useRef<((reason: FinishReason, errorMessage?: string) => void) | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [targetHz, setTargetHz] = useState<HighFrequencyTargetHz>(25);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("Selecione um vídeo lateral local. Nada será enviado ou salvo.");
  const [result, setResult] = useState<HighFrequencyResult | null>(null);
  const [videoId, setVideoId] = useState("local-video");
  const [runMetadata, setRunMetadata] = useState<{ runId: string; processingMs: number } | null>(null);

  useEffect(() => () => {
    cancelledRef.current = true;
    finishRef.current?.("cancelled");
    const video = videoRef.current as VideoWithFrames | null;
    if (callbackRef.current !== null) video?.cancelVideoFrameCallback?.(callbackRef.current);
    video?.pause();
    landmarkerRef.current?.close();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  function select(file: File | undefined) {
    if (!file) return;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = URL.createObjectURL(file);
    setSource(urlRef.current);
    setResult(null);
    setRunMetadata(null);
    setProgress(0);
    setMessage("Vídeo local carregado. Confirme a vista lateral e inicie a amostragem experimental.");
  }

  async function loadModel() {
    if (landmarkerRef.current) return landmarkerRef.current;
    const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
    const vision = await FilesetResolver.forVisionTasks(wasmUrl);
    landmarkerRef.current = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: modelUrl, delegate: "CPU" },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: .5,
      minTrackingConfidence: .5,
      minPosePresenceConfidence: .5,
    }) as Landmarker;
    return landmarkerRef.current;
  }

  function poseSample(video: HTMLVideoElement, model: Landmarker, timeMs: number): PoseSample | null {
    const pose = model.detectForVideo(video, timeMs).landmarks[0];
    if (!pose) return null;
    const left = pose[27], right = pose[28], leftHip = pose[23], rightHip = pose[24];
    const visibility = Math.min(left?.visibility ?? 0, right?.visibility ?? 0);
    return {
      timeMs,
      leftAnkleX: left?.x ?? null,
      rightAnkleX: right?.x ?? null,
      leftAnkleY: left?.y ?? null,
      rightAnkleY: right?.y ?? null,
      hipCenterX: leftHip && rightHip ? (leftHip.x + rightHip.x) / 2 : null,
      hipCenterY: leftHip && rightHip ? (leftHip.y + rightHip.y) / 2 : null,
      visibility,
    };
  }

  async function start() {
    const video = videoRef.current as VideoWithFrames | null;
    if (!video || !source || !supportsPresentedFrameCallbacks(video)) {
      setMessage("Este navegador não expõe requestVideoFrameCallback; a ferramenta não usa seek como substituto experimental.");
      return;
    }

    try {
      setRunning(true);
      setResult(null);
      setRunMetadata(null);
      setProgress(0);
      cancelledRef.current = false;
      const startedAt = performance.now();
      const runId = crypto.randomUUID();
      const model = await loadModel();
      const session = createHighFrequencySamplingSession({ targetHz, perspective: "lateral", durationMs: Math.round(video.duration * 1000) });
      let finished = false;

      const cleanup = () => {
        video.removeEventListener("ended", onEnded);
        video.removeEventListener("error", onError);
        if (callbackRef.current !== null) video.cancelVideoFrameCallback?.(callbackRef.current);
        callbackRef.current = null;
      };
      const finish = (reason: FinishReason, errorMessage?: string) => {
        if (finished) return;
        finished = true;
        cleanup();
        if (reason === "cancelled") session.cancel();
        video.pause();
        if (reason !== "failed") {
          setResult(session.finalize());
          setRunMetadata({ runId, processingMs: Math.round(performance.now() - startedAt) });
        }
        if (reason === "completed") {
          setProgress(100);
          setMessage("Processamento experimental concluído. O resultado permanece somente nesta página.");
        } else if (reason === "cancelled") {
          setMessage("Processamento cancelado; resultado parcial mantido somente nesta página.");
        } else {
          setMessage(errorMessage ?? "A reprodução local falhou antes do fim; nenhum resultado foi apresentado como concluído.");
        }
        if (landmarkerRef.current === model) {
          model.close();
          landmarkerRef.current = null;
        }
        finishRef.current = null;
        setRunning(false);
      };
      const onEnded = () => finish("completed");
      const onError = () => finish("failed", "O navegador não conseguiu reproduzir o vídeo local até o fim. Verifique o formato do arquivo e tente novamente.");
      const onFrame = (_now: number, metadata: PresentedFrameMetadata) => {
        if (cancelledRef.current) return finish("cancelled");
        if (hasVideoSamplingEnded(video)) return finish("completed");
        try {
          session.observe(metadata, () => poseSample(video, model, Math.round(metadata.mediaTime * 1000)));
          setProgress(video.duration ? Math.min(100, metadata.mediaTime / video.duration * 100) : 0);
          if (hasVideoSamplingEnded(video)) return finish("completed");
          callbackRef.current = video.requestVideoFrameCallback!(onFrame);
        } catch {
          finish("failed", "Falha ao processar um quadro local. A execução foi encerrada sem apresentar resultado incompleto como concluído.");
        }
      };

      finishRef.current = finish;
      video.addEventListener("ended", onEnded, { once: true });
      video.addEventListener("error", onError, { once: true });
      setMessage(`Amostrando em até ${targetHz} Hz com timestamps de apresentação…`);
      video.currentTime = 0;
      await video.play();
      callbackRef.current = video.requestVideoFrameCallback(onFrame);
    } catch {
      setRunning(false);
      finishRef.current = null;
      setMessage("Não foi possível inicializar MediaPipe ou reproduzir o vídeo local.");
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    }
  }

  function cancel() {
    cancelledRef.current = true;
    finishRef.current?.("cancelled");
  }

  function downloadCandidates() {
    if (!result || !runMetadata) return;
    try {
      const exported = exportCandidateRun(result, { ...runMetadata, videoId, exportedAt: new Date().toISOString() });
      const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${videoId}-candidatos-${runMetadata.runId}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setMessage("Não foi possível exportar. Defina um ID anônimo usando até 40 letras, números, hífen ou sublinhado.");
    }
  }

  return <section className="card" style={{ maxWidth: 980 }}><span className="eyebrow">Somente desenvolvimento local</span><h1>Amostragem temporal experimental</h1><p className="muted">Processa o arquivo somente neste navegador. Não produz passos, cadência ou indicadores clínicos.</p><label className="label" htmlFor="candidate-video-id">ID anônimo do vídeo</label><input id="candidate-video-id" className="field" style={{ maxWidth: 240 }} value={videoId} onChange={(event) => setVideoId(event.target.value)} disabled={running} /><div className="actions"><label className="button secondary"><FileUp size={17} />Selecionar vídeo local<input hidden type="file" accept="video/mp4,video/webm,video/quicktime" onChange={(event) => select(event.target.files?.[0])} /></label><select aria-label="Frequência-alvo" className="field" style={{ maxWidth: 180 }} value={targetHz} onChange={(event) => setTargetHz(Number(event.target.value) as HighFrequencyTargetHz)} disabled={running}><option value={25}>25 Hz alvo</option><option value={30}>30 Hz alvo</option></select><button className="button primary" type="button" onClick={() => void start()} disabled={!source || running}><Play size={17} />Iniciar</button><button className="button secondary" type="button" onClick={cancel} disabled={!running}><Square size={17} />Cancelar</button><button className="button secondary" type="button" onClick={downloadCandidates} disabled={!result || !runMetadata || running}><Download size={17} />Exportar candidatos JSON</button></div><p className="notice" aria-live="polite">{message}</p><div className="notice">Progresso: {progress.toFixed(1)}%. A frequência-alvo é uma solicitação de amostragem; callbacks e timestamps não comprovam conteúdo visual distinto.</div><video ref={videoRef} src={source ?? undefined} muted playsInline controls style={{ width: "100%", background: "#071d29", borderRadius: 12 }} />{result && <><h2>Resultado técnico</h2><div className="stats"><article className="stat"><small>Amostras aceitas</small><b>{result.statistics.samplesAccepted}/{result.statistics.samplesRequested}</b></article><article className="stat"><small>Frequência efetiva</small><b>{result.statistics.effectiveSampleHz ?? "Indisponível"} Hz</b></article><article className="stat"><small>Cobertura de pose</small><b>{result.statistics.poseCoverage === null ? "Indisponível" : `${Math.round(result.statistics.poseCoverage * 100)}%`}</b></article><article className="stat"><small>Detector científico</small><b>{result.scientific.eligible ? `${result.scientific.events.length} candidatos` : "Indisponível"}</b></article></div><p className="notice">FPS declarado: {result.statistics.declaredFps ?? "não disponível"}; transições de apresentação: {result.statistics.presentationCounterTransitions ?? "não disponíveis"}; conteúdo visual distinto: não verificável; lacunas: {result.statistics.gaps.length}; falhas de extração: {result.statistics.extractionFailures}; falhas de pose: {result.statistics.poseFailures}.</p><ul>{[...result.limitations, ...result.scientific.limitations].map((item) => <li key={item}>{item}</li>)}</ul></>}</section>;
}
