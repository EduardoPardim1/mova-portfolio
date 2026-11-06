export function seekPresentedFrame(video: HTMLVideoElement, targetSeconds: number): Promise<VideoFrameCallbackMetadata> {
  if (typeof video.requestVideoFrameCallback !== "function" || !Number.isFinite(targetSeconds) || targetSeconds < 0) return Promise.reject(new Error("Navegador sem suporte a timestamps de quadros ou alvo inválido."));
  return new Promise((resolve, reject) => {
    let sought = false, done = false, callback: number | null = null;
    let presentedMetadata: VideoFrameCallbackMetadata | undefined;
    const timer = setTimeout(() => finish(new Error("Busca sem quadro apresentado em 5 segundos.")), 5000);
    const finish = (error?: Error, metadata?: VideoFrameCallbackMetadata) => {
      if (done) return;
      done = true; clearTimeout(timer);
      if (callback !== null) video.cancelVideoFrameCallback(callback);
      video.removeEventListener("seeked", seeked); video.removeEventListener("error", failed);
      if (error) reject(error); else resolve(metadata!);
    };
    const seeked = () => {
      sought = true;
      if (presentedMetadata) finish(undefined, presentedMetadata);
    };
    const failed = () => finish(new Error("Erro de decodificação na busca local."));
    const presented: VideoFrameRequestCallback = (_, metadata) => {
      // Os eventos podem chegar em qualquer ordem. Reagendar após um callback
      // que antecede seeked perde o único quadro apresentado no vídeo pausado.
      presentedMetadata = metadata;
      if (sought && !video.seeking) finish(undefined, metadata);
    };
    video.addEventListener("seeked", seeked);
    video.addEventListener("error", failed);
    callback = video.requestVideoFrameCallback(presented);
    video.currentTime = targetSeconds;
  });
}

/** Uses mediaTime, never fabricates monotonic timestamps for duplicate decoded frames. */
export async function samplePresentedVideo(video:HTMLVideoElement, options:{hz:10|30; cancelled:()=>boolean; onFrame:(timeMs:number)=>void; onProgress?:(timeMs:number)=>void}) {
 if(!Number.isFinite(video.duration)||video.duration<=0)throw Error("Duração inválida.");
 const started=performance.now();let previous=-Infinity,accepted=0,duplicates=0;
 for(let i=0;(i+.5)/options.hz<video.duration-.016;i++){
  if(options.cancelled())return {cancelled:true,accepted,duplicates};
  if(performance.now()-started>Math.max(180000,video.duration*30000))throw Error("Tempo máximo de processamento excedido.");
  const frame=await seekPresentedFrame(video,(i+.5)/options.hz+.001);
  if(options.cancelled())return {cancelled:true,accepted,duplicates};
  const t=frame.mediaTime*1000;
  if(!Number.isFinite(t)||t<0||t>video.duration*1000)throw Error("Timestamp inválido do decodificador.");
  if(t<=previous){duplicates++;continue;}
  options.onFrame(t);previous=t;accepted++;options.onProgress?.(t);
 }
 if(!accepted)throw Error("Nenhum quadro apresentado.");
 return {cancelled:false,accepted,duplicates};
}
