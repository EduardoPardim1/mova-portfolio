"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileUp, Pause, Play, Trash2, Undo2 } from "lucide-react";
import { annotationCsv, annotationDraftKey, emptyAnnotation, normalizeAnnotation, validUncertainty, type AnnotationConfidence, type AnnotationSide, type GaitAnnotationDocument, type GaitAnnotationEvent } from "@/lib/gait-annotations";
import { GaitAnnotationReview } from "./gait-annotation-review";
import { adjacentFrame, parseAnnotationClock, seekAnnotationFrame, type AnnotationClock } from "@/lib/experimental/annotation-frame-clock";
import styles from "./gait-annotation-tool.module.css";

const makeId = () => crypto.randomUUID();
const format = (milliseconds: number) => `${Math.floor(milliseconds / 60000).toString().padStart(2, "0")}:${((milliseconds % 60000) / 1000).toFixed(3).padStart(6, "0")}`;

export function GaitAnnotationTool() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileUrl = useRef<string | null>(null);
  const localFile = useRef<File | null>(null);
  const [clock, setClock] = useState<AnnotationClock | null>(null);
  const exactSeek = useRef<AbortController | null>(null);
  const exactFrame = useRef<{ currentTime: number; ptsMs: number } | null>(null);
  const frameRequest = useRef<number | null>(null);
  const frameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackGeneration = useRef(0);
  const frameGeneration = useRef(0);
  const [videoId, setVideoId] = useState("local-video");
  const [document, setDocument] = useState<GaitAnnotationDocument>(() => emptyAnnotation());
  const [source, setSource] = useState<string | null>(null);
  const [timeMs, setTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [confidence, setConfidence] = useState<AnnotationConfidence>("high");
  const [message, setMessage] = useState("Selecione um arquivo local. Esta ferramenta não mostra estimativas do MOVA.");

  useEffect(() => {
    const video = videoRef.current;
    return () => {
      playbackGeneration.current += 1;
      exactSeek.current?.abort();
      frameGeneration.current += 1;
      if (frameRequest.current !== null) video?.cancelVideoFrameCallback?.(frameRequest.current);
      if (frameTimer.current) clearTimeout(frameTimer.current);
      if (playbackTimer.current) clearTimeout(playbackTimer.current);
      video?.pause();
      if (fileUrl.current) URL.revokeObjectURL(fileUrl.current);
    };
  }, []);
  useEffect(() => { const video = videoRef.current; if (video) video.playbackRate = speed; }, [speed]);
  useEffect(() => { setDocument((current) => ({ ...current, videoId, updatedAt: new Date().toISOString() })); }, [videoId]);
  useEffect(() => { if (!document.videoId) return; localStorage.setItem(annotationDraftKey(document.videoId, document.reviewerId), JSON.stringify(document)); }, [document]);

  const orderedEvents = useMemo(() => [...document.events].sort((a, b) => a.timeMs - b.timeMs), [document.events]);
  function cancelFrameStep() {
    exactSeek.current?.abort(); exactSeek.current = null; exactFrame.current = null;
    frameGeneration.current += 1;
    if (frameRequest.current !== null) videoRef.current?.cancelVideoFrameCallback?.(frameRequest.current);
    frameRequest.current = null;
    if (frameTimer.current) clearTimeout(frameTimer.current);
    frameTimer.current = null;
  }
  function clearPlaybackWatch() {
    if (playbackTimer.current) clearTimeout(playbackTimer.current);
    playbackTimer.current = null;
  }
  function playbackError(error?: unknown) {
    const name = error && typeof error === "object" && "name" in error ? error.name : "";
    return name === "NotAllowedError" ? "O navegador bloqueou a reprodução. Clique em Reproduzir novamente."
      : name === "NotSupportedError" ? "O navegador não suporta a reprodução deste arquivo. Tente um MP4 H.264 ou WebM compatível."
        : "Não foi possível reproduzir o vídeo local. Verifique o formato e tente carregar o arquivo novamente.";
  }
  function checkPlaybackProgress() {
    const video = videoRef.current;
    if (!video) return;
    clearPlaybackWatch();
    const startTime = video.currentTime;
    playbackTimer.current = setTimeout(() => {
      if (!video.paused && !video.ended && video.currentTime <= startTime) {
        video.pause();
        setMessage("O navegador iniciou a reprodução, mas o vídeo não avançou. Recarregue o arquivo ou tente outro navegador; a anotação foi preservada.");
      }
    }, 4000);
  }
  async function togglePlayback() {
    const video = videoRef.current;
    if (!video || !source) return;
    cancelFrameStep();
    clearPlaybackWatch();
    const generation = ++playbackGeneration.current;
    if (!video.paused) { video.pause(); return; }
    if (video.ended) video.currentTime = 0;
    try {
      // A anotação é visual. Silenciar evita depender do relógio/dispositivo de áudio.
      video.muted = true;
      await video.play();
      if (generation !== playbackGeneration.current) return;
      checkPlaybackProgress();
    } catch (error) {
      if (generation === playbackGeneration.current) { setPlaying(false); setMessage(playbackError(error)); }
    }
  }
  function seek(deltaMs: number) { const video = videoRef.current; if (!video) return; cancelFrameStep(); clearPlaybackWatch(); playbackGeneration.current += 1; video.pause(); video.currentTime = Math.max(0, Math.min(Number.isFinite(video.duration) ? video.duration : 0, video.currentTime + deltaMs / 1000)); }
  function stepOneFrame(direction: "backward" | "forward") {
    const video = videoRef.current;
    if (!video || !source) return;
    cancelFrameStep();
    clearPlaybackWatch();
    playbackGeneration.current += 1;
    video.pause();
    if (clock) {
      const controller = new AbortController(); exactSeek.current = controller;
      const index = adjacentFrame(clock, video.currentTime * 1000, direction);
      void seekAnnotationFrame(video, clock, index, controller.signal).then(ptsMs => {
        if (controller.signal.aborted) return;
        exactFrame.current = { currentTime: video.currentTime, ptsMs };
        setTimeMs(Math.round(ptsMs)); setMessage(`Quadro ${index} confirmado por PTS: ${ptsMs.toFixed(3)} ms. Não é uma marcação de contato.`);
      }).catch(() => { if (!controller.signal.aborted) setMessage("Não foi possível confirmar o quadro por PTS. Nenhuma referência foi criada; confira o manifesto e tente novamente."); });
      return;
    }
    const fallbackMs = 1000 / 30;
    if (direction === "backward") {
      seek(-fallbackMs);
      setMessage("Retrocesso de um quadro aproximado (33 ms). A API do navegador não fornece decodificação reversa quadro a quadro.");
      return;
    }
    const nextFrame = (video as HTMLVideoElement & { requestVideoFrameCallback?: (callback: () => void) => number }).requestVideoFrameCallback;
    if (!nextFrame) {
      seek(fallbackMs);
      setMessage("Avanço de um quadro aproximado (33 ms); este navegador não expõe requestVideoFrameCallback.");
      return;
    }
    const generation = frameGeneration.current;
    frameRequest.current = nextFrame.call(video, () => {
      if (generation !== frameGeneration.current) return;
      cancelFrameStep();
      video.pause();
      setTimeMs(Math.round(video.currentTime * 1000));
      setMessage("Avanço de um quadro decodificado.");
    });
    frameTimer.current = setTimeout(() => {
      if (generation !== frameGeneration.current) return;
      cancelFrameStep();
      video.pause();
      setMessage("O navegador não entregou o próximo quadro. Use +0,1 s para navegar por tempo.");
    }, 3000);
    video.muted = true;
    void video.play().catch((error) => {
      if (generation !== frameGeneration.current) return;
      cancelFrameStep();
      setMessage(playbackError(error));
    });
  }
  function updateDocument(update: (current: GaitAnnotationDocument) => GaitAnnotationDocument) { setDocument((current) => ({ ...update(current), updatedAt: new Date().toISOString() })); }
  function startReview(reviewerId: string) {
    if (localStorage.getItem(annotationDraftKey(videoId, reviewerId))) { setMessage("Já existe rascunho para esse revisor e vídeo. Recupere pelo código; não será sobrescrito."); return; }
    updateDocument(() => ({ ...emptyAnnotation(videoId), reviewerId }));
    setMessage("Nova revisão vazia. Nenhum contato de outro revisor foi copiado; mantenha as revisões cegas e independentes.");
  }
  function restoreReview(reviewerId: string) {
    try {
      const raw = localStorage.getItem(annotationDraftKey(videoId, reviewerId));
      const parsed = raw ? normalizeAnnotation(JSON.parse(raw)) : null;
      if (!parsed || parsed.reviewerId !== reviewerId || parsed.videoId !== videoId) throw new Error();
      setDocument(parsed); setMessage("Revisão recuperada localmente. Não consulte a revisão de outro avaliador antes de finalizar a sua.");
    } catch { setMessage("Revisão não encontrada ou inválida. Documento atual preservado."); }
  }
  function editEventTime(id: string, value: number) {
    const event = document.events.find(e => e.id === id);
    if (!event || !Number.isInteger(value) || value < 0 || (event.uncertaintyMs && !validUncertainty(value, event.uncertaintyMs))) {
      setMessage("Horário inválido ou fora da incerteza registrada. Corrija ou limpe o intervalo antes de mover o evento."); return;
    }
    updateDocument(current => ({ ...current, events: current.events.map(e => e.id === id ? { ...e, timeMs: value } : e) }));
  }
  function captureVideoTime() {
    const time = videoRef.current?.currentTime;
    if (!source || time === undefined || !Number.isFinite(time) || time < 0) {
      setMessage("Carregue um vídeo local antes de registrar uma marcação.");
      return null;
    }
    const verified = exactFrame.current;
    const captured = Math.round(verified && videoRef.current?.paused && verified.currentTime === time ? verified.ptsMs : time * 1000);
    setTimeMs(captured);
    return captured;
  }
  function setWalkingBoundary(boundary: "walkingStartMs" | "walkingEndMs", value: number | null) {
    if (value !== null && (!Number.isFinite(value) || value < 0 || !Number.isInteger(value))) {
      setMessage("Informe um horário válido em milissegundos inteiros, maior ou igual a zero.");
      return;
    }
    const start = boundary === "walkingStartMs" ? value : document.walkingStartMs;
    const end = boundary === "walkingEndMs" ? value : document.walkingEndMs;
    if (start !== null && end !== null && start > end) {
      setMessage("O início da marcha não pode ficar depois do fim. Corrija ou limpe o outro limite antes de marcar novamente.");
      return;
    }
    updateDocument((current) => ({ ...current, [boundary]: value }));
    const label = boundary === "walkingStartMs" ? "Início" : "Fim";
    setMessage(value === null ? `${label} da marcha removido.` : `${label} da marcha registrado em ${format(value)}. Você pode editar o horário ou marcar novamente.`);
  }
  function markWalkingBoundary(boundary: "walkingStartMs" | "walkingEndMs") {
    const captured = captureVideoTime();
    if (captured !== null) setWalkingBoundary(boundary, captured);
  }
  function addEvent(side: AnnotationSide, kind: GaitAnnotationEvent["kind"]) { const captured = captureVideoTime(); if (captured === null) return; updateDocument((current) => ({ ...current, events: [...current.events, { id: makeId(), timeMs: captured, side, confidence, kind } ] })); setMessage(kind === "ambiguous" ? "Evento ambíguo registrado; ele não entrará automaticamente na referência primária." : "Contato inicial registrado localmente."); }
  function intervalIsOpen(kind: "pause" | "occlusion") { return document.intervals.some((interval) => interval.kind === kind && interval.endMs === null); }
  function toggleInterval(kind: "pause" | "occlusion") {
    const captured = captureVideoTime();
    if (captured === null) return;
    const open = [...document.intervals].reverse().find((interval) => interval.kind === kind && interval.endMs === null);
    if (open && captured < open.startMs) { setMessage("O fim do intervalo não pode ficar antes do início. Avance o vídeo antes de encerrar."); return; }
    updateDocument((current) => open
      ? { ...current, intervals: current.intervals.map((interval) => interval.id === open.id ? { ...interval, endMs: captured } : interval) }
      : { ...current, intervals: [...current.intervals, { id: makeId(), kind, startMs: captured, endMs: null }] });
    const label = kind === "pause" ? "Pausa" : "Oclusão";
    setMessage(`${label} ${open ? "encerrada" : "iniciada"} em ${format(captured)}.`);
  }
  function selectFile(file: File | undefined) { if (!file) return; localFile.current = file; setClock(null); cancelFrameStep(); clearPlaybackWatch(); playbackGeneration.current += 1; videoRef.current?.pause(); setPlaying(false); if (fileUrl.current) URL.revokeObjectURL(fileUrl.current); fileUrl.current = URL.createObjectURL(file); setSource(fileUrl.current); setTimeMs(0); setDurationMs(0); setMessage("Arquivo carregado localmente, sem áudio. Defina um ID anônimo para salvar o rascunho."); }
  async function importClock(file: File | undefined) {
    const media = localFile.current;
    if (!file || !media || file.size > 2 * 1024 ** 2 || media.size > 100 * 1024 ** 2) { setMessage("Selecione vídeo de até 100 MiB e manifesto de até 2 MiB para navegação por PTS."); return; }
    try {
      const parsed = parseAnnotationClock(JSON.parse(await file.text()));
      const digest = await crypto.subtle.digest("SHA-256", await media.arrayBuffer());
      const hash = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, "0")).join("");
      if (media !== localFile.current) return;
      if (hash !== parsed.sha256 || Math.abs(parsed.durationMs - (videoRef.current?.duration ?? 0) * 1000) > 2) throw new Error();
      cancelFrameStep(); setClock(parsed); setMessage("Relógio e SHA-256 conferidos localmente. Os botões de quadro agora exigem confirmação por PTS.");
    } catch { setClock(null); setMessage("Manifesto inválido ou não corresponde ao vídeo. Navegação exata não habilitada."); }
  }
  function loadDraft() { try { const raw = localStorage.getItem(annotationDraftKey(videoId, document.reviewerId)); const parsed = raw ? normalizeAnnotation(JSON.parse(raw)) : null; if (!parsed) { setMessage("Não há rascunho válido para este ID local. Confira também se o início da marcha está antes do fim."); return; } setDocument(parsed); setMessage("Rascunho local recuperado. Reabra o arquivo correspondente para continuar a revisão."); } catch { setMessage("Não foi possível recuperar o rascunho local. O documento atual foi preservado."); } }
  function importJson(file: File | undefined) { if (!file) return; const reader = new FileReader(); reader.onload = () => { try { const parsed = normalizeAnnotation(JSON.parse(String(reader.result))); if (!parsed) throw new Error(); setVideoId(parsed.videoId); setDocument(parsed); setMessage("Anotação importada localmente. Revise antes de comparar."); } catch { setMessage("Arquivo de anotação inválido. Confira se o início da marcha está antes do fim. O documento atual foi preservado."); } }; reader.onerror = () => setMessage("Não foi possível ler o JSON local. O documento atual foi preservado."); reader.readAsText(file); }
  function download(name: string, text: string, type: string) { const url = URL.createObjectURL(new Blob([text], { type })); const link = window.document.createElement("a"); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url); }
  const exportId = `${videoId}${document.reviewerId ? `-${document.reviewerId}` : ""}`;
  return <section className={`card ${styles.tool}`}>
    <span className="eyebrow">Ferramenta de desenvolvimento local</span><h1>Anotação humana independente</h1><p className="muted">Não envia vídeo, landmarks ou marcações ao servidor. Marque somente o que for observável; não abra resultados do MOVA antes de finalizar a referência.</p>
    <label className="label" htmlFor="annotation-video-id">ID anônimo do vídeo</label><div className={`actions ${styles.identity}`}><input id="annotation-video-id" className="field" value={videoId} onChange={(event) => setVideoId(event.target.value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "local-video")} /><button className="button secondary" type="button" onClick={loadDraft}>Recuperar rascunho</button></div>
    <div className="actions"><label className="button secondary"><FileUp size={17} />Selecionar vídeo local<input hidden type="file" accept="video/mp4,video/webm,video/quicktime" onChange={(event) => selectFile(event.target.files?.[0])} /></label><label className="button secondary">Importar JSON<input hidden type="file" accept="application/json" onChange={(event) => importJson(event.target.files?.[0])} /></label><button className="button secondary" type="button" onClick={() => download(`${exportId}-referencia.json`, JSON.stringify(document, null, 2), "application/json")}><Download size={17} />Exportar JSON</button><button className="button secondary" type="button" onClick={() => download(`${exportId}-referencia.csv`, annotationCsv(document), "text/csv;charset=utf-8")}><Download size={17} />Exportar CSV</button></div>
    <GaitAnnotationReview document={document} onNew={startReview} onRestore={restoreReview} onUncertainty={(id, value) => updateDocument(current => ({ ...current, events: current.events.map(event => event.id === id ? { ...event, uncertaintyMs: value } : event) }))} />
    <details><summary>Relógio experimental para navegação quadro a quadro</summary><p>Importe o conversion.json gerado localmente para este vídeo. Sem manifesto, o retrocesso continua aproximado. Não supõe 30 Hz para vídeos desconhecidos.</p><label className="button secondary">Importar relógio verificado<input hidden type="file" accept=".json" onChange={event => void importClock(event.target.files?.[0])} /></label><p>{clock ? `${clock.timesMs.length} timestamps conferidos; confirme também o enquadramento e a visibilidade.` : "Nenhum relógio verificado carregado."}</p></details>
    <p className="notice" aria-live="polite">{message}</p>
    <video className={styles.video} ref={videoRef} src={source ?? undefined} controls muted playsInline preload="auto"
      onLoadedMetadata={(event) => { const video = event.currentTarget; video.playbackRate = speed; setDurationMs(Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0); }}
      onTimeUpdate={(event) => { const video = event.currentTarget; const exact = exactFrame.current; setTimeMs(Math.round(exact && video.paused && exact.currentTime === video.currentTime ? exact.ptsMs : video.currentTime * 1000)); }}
      onPlaying={() => { setPlaying(true); setMessage("Reproduzindo sem áudio. Pause para marcar os contatos observáveis."); checkPlaybackProgress(); }}
      onPause={() => { setPlaying(false); clearPlaybackWatch(); }}
      onEnded={() => { cancelFrameStep(); clearPlaybackWatch(); setPlaying(false); setMessage("Fim do vídeo. As marcações permanecem no rascunho local."); }}
      onWaiting={() => setMessage("Aguardando o navegador decodificar o vídeo local…")}
      onError={() => { cancelFrameStep(); clearPlaybackWatch(); setPlaying(false); setMessage(playbackError()); }} />
    <div className={`actions ${styles.transport}`} role="group" aria-label="Controles do vídeo"><button className="button secondary" type="button" disabled={!source} onClick={() => void togglePlayback()} aria-pressed={playing}>{playing ? <Pause size={16} /> : <Play size={16} />}Reproduzir/pausar</button><button className="button secondary" type="button" disabled={!source} onClick={() => stepOneFrame("backward")}>← 1 quadro</button><button className="button secondary" type="button" disabled={!source} onClick={() => stepOneFrame("forward")}>1 quadro →</button><button className="button secondary" type="button" disabled={!source} onClick={() => seek(-100)}>-0,1 s</button><button className="button secondary" type="button" disabled={!source} onClick={() => seek(100)}>+0,1 s</button><button className="button secondary" type="button" disabled={!source} onClick={() => seek(-500)}>-0,5 s</button><button className="button secondary" type="button" disabled={!source} onClick={() => seek(500)}>+0,5 s</button><span className={styles.time}>Tempo: <b>{format(timeMs)}</b>{durationMs ? ` / ${format(durationMs)}` : ""}</span></div>
    <div className={styles.settings}><div><label className="label" htmlFor="annotation-speed">Velocidade</label><select id="annotation-speed" className="field" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}><option value={0.25}>0,25×</option><option value={0.5}>0,5×</option><option value={1}>1×</option></select></div><div><label className="label" htmlFor="annotation-confidence">Confiança do evento observável</label><select id="annotation-confidence" className="field" value={confidence} onChange={(event) => setConfidence(event.target.value as AnnotationConfidence)}><option value="high">Alta</option><option value="medium">Média</option><option value="low">Baixa / revisar</option></select></div></div>
    <div className="actions"><button className="button primary" type="button" disabled={!source} onClick={() => addEvent("left", "initial_contact")}>Marcar contato esquerdo</button><button className="button primary" type="button" disabled={!source} onClick={() => addEvent("right", "initial_contact")}>Marcar contato direito</button><button className="button secondary" type="button" disabled={!source} onClick={() => addEvent("unknown", "ambiguous")}>Marcar indeterminado</button><button className="button secondary" type="button" disabled={!source} onClick={() => toggleInterval("pause")}>{intervalIsOpen("pause") ? "Encerrar pausa" : "Iniciar pausa"}</button><button className="button secondary" type="button" disabled={!source} onClick={() => toggleInterval("occlusion")}>{intervalIsOpen("occlusion") ? "Encerrar oclusão" : "Iniciar oclusão"}</button><button className="button secondary" type="button" onClick={() => updateDocument((current) => ({ ...current, events: current.events.slice(0, -1) }))}><Undo2 size={16} />Desfazer</button></div>
    <fieldset className={styles.boundaries}>
      <legend>Trecho de marcha avaliado</legend>
      {(["walkingStartMs", "walkingEndMs"] as const).map((boundary) => {
        const isStart = boundary === "walkingStartMs";
        const label = isStart ? "Início" : "Fim";
        const value = document[boundary];
        return <div key={boundary}>
          <button className="button secondary" type="button" disabled={!source} onClick={() => markWalkingBoundary(boundary)}>{label} da marcha</button>
          <output aria-label={`${label} registrado`}>{value === null ? "Não marcado" : format(value)}</output>
          <label className="label" htmlFor={`annotation-${boundary}`}>{label} da marcha (ms)</label>
          <div className="actions">
            <input id={`annotation-${boundary}`} className="field" type="number" min="0" step="1" value={value ?? ""} onChange={(event) => setWalkingBoundary(boundary, event.target.value === "" ? null : event.target.valueAsNumber)} />
            <button className="button secondary" type="button" disabled={value === null} onClick={() => setWalkingBoundary(boundary, null)}>Limpar {isStart ? "início" : "fim"}</button>
          </div>
        </div>;
      })}
      <p>Use o instante atual com o vídeo pausado ou reproduzindo. Para corrigir, marque novamente, edite os milissegundos ou limpe o limite.</p>
    </fieldset>
    <h2>Linha do tempo e eventos ({orderedEvents.length})</h2><div className="notice" style={{ position: "relative", minHeight: 44 }}>{orderedEvents.map((event) => <span key={event.id} title={`${event.side} ${format(event.timeMs)}`} style={{ position: "absolute", left: `${durationMs ? Math.min(98, event.timeMs / durationMs * 98) : 0}%`, top: 8, width: 10, height: 28, borderRadius: 5, background: event.kind === "ambiguous" ? "#d97706" : event.side === "left" ? "#7c3aed" : "#e76f51" }} />)}</div>
    <div className={styles.eventTable}><table className="table"><thead><tr><th>Tempo (ms)</th><th>Tipo/lado</th><th>Confiança</th><th>Ações</th></tr></thead><tbody>{orderedEvents.map((event) => <tr key={event.id}><td><input className="field" aria-label="Tempo do evento em milissegundos" type="number" min="0" value={event.timeMs} onChange={(input) => editEventTime(event.id, input.target.valueAsNumber)} /></td><td>{event.kind === "ambiguous" ? "Indeterminado" : event.side === "left" ? "Contato esquerdo" : "Contato direito"}</td><td>{event.confidence}</td><td><button className="button secondary" type="button" onClick={() => updateDocument((current) => ({ ...current, events: current.events.filter((item) => item.id !== event.id) }))}><Trash2 size={16} />Excluir</button></td></tr>)}</tbody></table></div>
  </section>;
}
