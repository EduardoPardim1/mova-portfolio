import { INPUT_POINTS, normalizePose, type Landmark } from "./data";
import type { Recording } from "./supervised-data";

/** Três identidades artificiais. Não representa biomecânica ou sujeitos humanos. */
export function syntheticTrainingDataset(): Recording[] {
  return (["train", "validation", "test"] as const).map((split, subject) => {
    const frames = Array.from({ length: 96 }, (_, t) => {
      const points: Landmark[] = Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: 1 }));
      points[11] = { x: .4, y: .2, visibility: 1 }; points[12] = { x: .6, y: .2, visibility: 1 };
      INPUT_POINTS.forEach((index, i) => { points[index] = { x: i % 2 ? .55 : .45, y: .5 + Math.floor(i / 2) * .06 + (i > 3 ? .01 * Math.sin(t / 4 + subject * .1) : 0), visibility: 1 }; });
      return { timeMs: t * 1000 / 30, sourceTimeMs: t * 1000 / 30, values: normalizePose(points, 640, 480) };
    });
    return { version: 1, participantId: `SYN-${subject}`, videoId: `SYN-REC-${subject}`, sha256: String(subject + 1).repeat(64), split,
      fps: 30, normalization: "pelvis-torso-aspect-v1", provenance: { source: "gerador matemático stage7-v1", license: "synthetic-project-fixture", permissionEvidence: "nenhuma pessoa ou mídia", commercialTrainingAllowed: true, imageRightsCleared: true, synthetic: true },
      reviewers: ["SYN-R1", "SYN-R2"], adjudicator: "SYN-R1", frames,
      complete: (["left", "right"] as const).map(side => ({ side, startMs: 0, endMs: frames.at(-1)!.timeMs })), excluded: [],
      events: [36, 48, 60, 72, 84].map((t, i) => ({ timeMs: frames[t].timeMs, startMs: frames[t].timeMs, endMs: frames[t].timeMs, side: i % 2 ? "right" : "left", status: "confirmed", reviewerIds: ["SYN-R1", "SYN-R2"] })) };
  });
}
