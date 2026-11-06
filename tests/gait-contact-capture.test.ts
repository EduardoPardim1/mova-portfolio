import { afterEach, describe, expect, it, vi } from "vitest";
import { seekPresentedFrame } from "../src/lib/experimental/gait-contact-lab-capture";

function videoFixture() {
  const video = document.createElement("video");
  let next: VideoFrameRequestCallback;
  video.requestVideoFrameCallback = vi.fn((callback) => { next = callback; return 42; });
  video.cancelVideoFrameCallback = vi.fn();
  return { video, presented: (mediaTime: number) => next(0, { mediaTime } as VideoFrameCallbackMetadata) };
}
afterEach(() => vi.useRealTimers());
describe("coleta pausada do laboratório", () => {
  it("usa o horário apresentado pelo navegador, não o alvo solicitado", async () => {
    const { video, presented } = videoFixture();
    const promise = seekPresentedFrame(video, .1);
    video.dispatchEvent(new Event("seeked")); presented(.08333);
    expect((await promise).mediaTime).toBe(.08333);
    expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(42);
  });
  it("aguarda os dois eventos mesmo quando apresentação antecede seeked", async () => {
    const { video, presented } = videoFixture();
    const promise = seekPresentedFrame(video, .1);
    presented(.1); expect(video.requestVideoFrameCallback).toHaveBeenCalledTimes(1);
    video.dispatchEvent(new Event("seeked"));
    expect((await promise).mediaTime).toBe(.1);
  });
  it("encerra por timeout com cancelamento de callback", async () => {
    vi.useFakeTimers();
    const { video } = videoFixture();
    const promise = seekPresentedFrame(video, .1);
    const rejected = expect(promise).rejects.toThrow("5 segundos");
    await vi.advanceTimersByTimeAsync(5000); await rejected;
    expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(42);
  });
  it("propaga falha de decodificação", async () => {
    const { video } = videoFixture();
    const promise = seekPresentedFrame(video, .1);
    video.dispatchEvent(new Event("error"));
    await expect(promise).rejects.toThrow("decodificação");
  });
});
