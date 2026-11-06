import {FilesetResolver,PoseLandmarker} from '@mediapipe/tasks-vision';
import {samplePresentedVideo} from '../video-frame-sampling';
import type {PoseSample} from '../pose-analysis';
/** Local harness only: resources must be hosted on loopback; no network video. */
export async function captureLocalGait(video:HTMLVideoElement){
 if(!['localhost','127.0.0.1'].includes(location.hostname)||!video.src.startsWith('blob:')||!Number.isFinite(video.duration)||video.duration>120)throw Error('Local video required');
 const started=performance.now();
 const model=await PoseLandmarker.createFromOptions(await FilesetResolver.forVisionTasks('/wasm'),{baseOptions:{modelAssetPath:'/model.task',delegate:'CPU'},runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:.5,minTrackingConfidence:.5,minPosePresenceConfidence:.5});
 const samples:PoseSample[]=[];let duplicates=0;
 try{video.pause();const result=await samplePresentedVideo(video,{hz:30,cancelled:()=>false,onFrame:timeMs=>{
  const p=model.detectForVideo(video,timeMs).landmarks[0];
  samples.push({timeMs,leftAnkleX:p?.[27]?.x??null,rightAnkleX:p?.[28]?.x??null,leftAnkleY:p?.[27]?.y??null,rightAnkleY:p?.[28]?.y??null,hipCenterX:p?(p[23].x+p[24].x)/2:null,hipCenterY:p?(p[23].y+p[24].y)/2:null,leftAnkleVisibility:p?.[27]?.visibility??null,rightAnkleVisibility:p?.[28]?.visibility??null,leftHeelX:p?.[29]?.x??null,rightHeelX:p?.[30]?.x??null,leftHeelY:p?.[29]?.y??null,rightHeelY:p?.[30]?.y??null,visibility:p?Math.min(p[27].visibility??0,p[28].visibility??0):0});
 }});duplicates=result.duplicates;return {samples,duplicates,processingMs:performance.now()-started,durationSeconds:video.duration};}finally{model.close();}
}
