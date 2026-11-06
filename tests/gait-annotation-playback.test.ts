import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GaitAnnotationTool } from "@/components/development/gait-annotation-tool";
import { emptyAnnotation, type GaitAnnotationDocument } from "@/lib/gait-annotations";

let video: HTMLVideoElement;
let paused: boolean;
let play: ReturnType<typeof vi.spyOn>;
let pause: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = vi.fn(() => "blob:local-test");
    static revokeObjectURL = vi.fn();
  });
  paused = true;
  play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    paused = false;
    this.dispatchEvent(new Event("playing"));
    return Promise.resolve();
  });
  pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
    paused = true;
    this.dispatchEvent(new Event("pause"));
  });
  const { container } = render(createElement(GaitAnnotationTool));
  video = container.querySelector("video")!;
  Object.defineProperty(video, "paused", { configurable: true, get: () => paused });
  Object.defineProperty(video, "duration", { configurable: true, value: 8 });
  const fileInput = container.querySelector('input[type="file"]')!;
  fireEvent.change(fileInput, { target: { files: [new File(["synthetic"], "synthetic.mp4", { type: "video/mp4" })] } });
});

function storedAnnotation(): GaitAnnotationDocument {
  return JSON.parse(localStorage.getItem("mova:gait-annotation:local-video")!);
}

function importAnnotation(value: unknown) {
  fireEvent.change(window.document.querySelector('input[accept="application/json"]')!, {
    target: { files: [new File([JSON.stringify(value)], "reference.json", { type: "application/json" })] },
  });
}

describe("revisão experimental independente", () => {
  it("separa rascunhos e não copia eventos ou sobrescreve revisão existente", () => {
    fireEvent.click(screen.getByText("Revisão experimental: revisor e incerteza temporal"));
    fireEvent.change(screen.getByLabelText("ID pseudônimo do revisor"), { target: { value: "R01" } });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar revisão independente" }));
    video.currentTime = 1;
    fireEvent.click(screen.getByRole("button", { name: "Marcar contato esquerdo" }));
    fireEvent.change(screen.getByLabelText("Limite inferior (ms)"), { target: { value: "990" } });
    fireEvent.change(screen.getByLabelText("Limite superior (ms)"), { target: { value: "1033" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar incerteza" }));
    const first = localStorage.getItem("mova:gait-annotation:local-video:review:R01")!;
    expect(JSON.parse(first).events[0].uncertaintyMs).toEqual({ startMs: 990, endMs: 1033 });
    fireEvent.change(screen.getByLabelText("Tempo do evento em milissegundos"), { target: { value: "2000" } });
    expect(screen.getByText(/Horário inválido ou fora da incerteza/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("ID pseudônimo do revisor"), { target: { value: "R02" } });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar revisão independente" }));
    expect(JSON.parse(localStorage.getItem("mova:gait-annotation:local-video:review:R02")!).events).toEqual([]);
    expect(localStorage.getItem("mova:gait-annotation:local-video:review:R01")).toBe(first);
    fireEvent.change(screen.getByLabelText("ID pseudônimo do revisor"), { target: { value: "R01" } });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar revisão independente" }));
    expect(screen.getByText(/Já existe rascunho/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Recuperar revisão pelo código" }));
    expect(screen.getByLabelText("Tempo do evento em milissegundos")).toHaveProperty("value", "1000");
  });
});

describe("delimitação e marcações no instante do clique", () => {
  it.each([false, true])("captura o relógio do vídeo sem depender de timeupdate (reproduzindo=%s)", async (playing) => {
    if (playing) await act(async () => fireEvent.click(screen.getByRole("button", { name: "Reproduzir/pausar" })));
    video.currentTime = 1.234;
    fireEvent.click(screen.getByRole("button", { name: "Início da marcha" }));
    video.currentTime = 2.789;
    fireEvent.click(screen.getByRole("button", { name: "Fim da marcha" }));
    expect(screen.getByLabelText("Início registrado").textContent).toBe("00:01.234");
    expect(screen.getByLabelText("Fim registrado").textContent).toBe("00:02.789");
    expect(storedAnnotation()).toMatchObject({ walkingStartMs: 1234, walkingEndMs: 2789 });
    expect(paused).toBe(!playing);
  });

  it("permite remarcar, editar e limpar, incluindo início no instante zero", () => {
    fireEvent.click(screen.getByRole("button", { name: "Início da marcha" }));
    expect(screen.getByLabelText("Início registrado").textContent).toBe("00:00.000");
    video.currentTime = 1;
    fireEvent.click(screen.getByRole("button", { name: "Início da marcha" }));
    fireEvent.change(screen.getByLabelText("Início da marcha (ms)"), { target: { value: "750" } });
    expect(storedAnnotation().walkingStartMs).toBe(750);
    fireEvent.click(screen.getByRole("button", { name: "Limpar início" }));
    expect(screen.getByLabelText("Início registrado").textContent).toBe("Não marcado");
    expect(storedAnnotation().walkingStartMs).toBeNull();
  });

  it("rejeita limites invertidos por clique e edição, preservando os valores anteriores", () => {
    video.currentTime = 2;
    fireEvent.click(screen.getByRole("button", { name: "Fim da marcha" }));
    video.currentTime = 3;
    fireEvent.click(screen.getByRole("button", { name: "Início da marcha" }));
    expect(screen.getByText(/O início da marcha não pode ficar depois do fim/)).toBeTruthy();
    expect(storedAnnotation()).toMatchObject({ walkingStartMs: null, walkingEndMs: 2000 });
    video.currentTime = 1;
    fireEvent.click(screen.getByRole("button", { name: "Início da marcha" }));
    fireEvent.change(screen.getByLabelText("Fim da marcha (ms)"), { target: { value: "500" } });
    expect(storedAnnotation()).toMatchObject({ walkingStartMs: 1000, walkingEndMs: 2000 });
    fireEvent.change(screen.getByLabelText("Início da marcha (ms)"), { target: { value: "-1" } });
    expect(screen.getByText(/horário válido em milissegundos inteiros/)).toBeTruthy();
    expect(storedAnnotation().walkingStartMs).toBe(1000);
  });

  it("exporta os limites reais em JSON e os preserva ao importar", async () => {
    video.currentTime = .5;
    fireEvent.click(screen.getByRole("button", { name: "Início da marcha" }));
    video.currentTime = 4;
    fireEvent.click(screen.getByRole("button", { name: "Fim da marcha" }));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Exportar JSON" }));
    const calls = vi.mocked(URL.createObjectURL).mock.calls;
    const blob = calls.at(-1)![0] as Blob;
    const json = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
    expect(JSON.parse(json)).toMatchObject({ walkingStartMs: 500, walkingEndMs: 4000 });
    fireEvent.click(screen.getByRole("button", { name: "Limpar início" }));
    fireEvent.click(screen.getByRole("button", { name: "Limpar fim" }));
    importAnnotation(JSON.parse(json));
    await waitFor(() => expect(screen.getByLabelText("Fim registrado").textContent).toBe("00:04.000"));
    expect(screen.getByLabelText("Início registrado").textContent).toBe("00:00.500");
    await waitFor(() => expect(storedAnnotation()).toMatchObject({ walkingStartMs: 500, walkingEndMs: 4000 }));
  });

  it("recupera limites do rascunho e rejeita JSON invertido sem substituir o documento", async () => {
    const saved = { ...emptyAnnotation(), walkingStartMs: 0, walkingEndMs: 1500 };
    localStorage.setItem("mova:gait-annotation:local-video", JSON.stringify(saved));
    fireEvent.click(screen.getByRole("button", { name: "Recuperar rascunho" }));
    expect(screen.getByLabelText("Fim registrado").textContent).toBe("00:01.500");
    importAnnotation({ ...saved, walkingStartMs: 2500 });
    await waitFor(() => expect(screen.getByText(/Arquivo de anotação inválido/)).toBeTruthy());
    expect(storedAnnotation()).toMatchObject({ walkingStartMs: 0, walkingEndMs: 1500 });
  });

  it("usa o relógio atual para contatos, pausas e oclusões e mantém ambos os estados abertos", () => {
    video.currentTime = .321;
    fireEvent.click(screen.getByRole("button", { name: "Marcar contato esquerdo" }));
    expect(storedAnnotation().events[0].timeMs).toBe(321);
    video.currentTime = .5;
    fireEvent.click(screen.getByRole("button", { name: "Iniciar pausa" }));
    video.currentTime = .6;
    fireEvent.click(screen.getByRole("button", { name: "Iniciar oclusão" }));
    expect(screen.getByRole("button", { name: "Encerrar pausa" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Encerrar oclusão" })).toBeTruthy();
    video.currentTime = .9;
    fireEvent.click(screen.getByRole("button", { name: "Encerrar pausa" }));
    video.currentTime = 1;
    fireEvent.click(screen.getByRole("button", { name: "Encerrar oclusão" }));
    expect(storedAnnotation().intervals).toMatchObject([{ kind: "pause", startMs: 500, endMs: 900 }, { kind: "occlusion", startMs: 600, endMs: 1000 }]);
  });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("reprodução na anotação local", () => {
  it("reproduz silenciado e reflete playing, pause e ended no botão", async () => {
    const button = screen.getByRole("button", { name: "Reproduzir/pausar" });
    await act(async () => fireEvent.click(button));
    expect(video.muted).toBe(true);
    expect(play).toHaveBeenCalledOnce();
    expect(button.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.ended(video);
    expect(screen.getByText(/Fim do vídeo/)).toBeTruthy();
  });

  it("exibe uma rejeição de play sem promessa rejeitada não tratada", async () => {
    play.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Reproduzir/pausar" })));
    expect(screen.getByText(/navegador bloqueou a reprodução/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reproduzir/pausar" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("detecta play resolvido sem avanço e mantém a anotação", async () => {
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Marcar contato esquerdo" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Reproduzir/pausar" })));
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.getByText(/vídeo não avançou/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: /eventos \(1\)/ })).toBeTruthy();
    expect(paused).toBe(true);
  });

  it("não interrompe vídeo cujo relógio avança", async () => {
    vi.useFakeTimers();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Reproduzir/pausar" })));
    video.currentTime = 1;
    act(() => vi.advanceTimersByTime(4000));
    expect(paused).toBe(false);
  });

  it("invalida o callback de avanço de quadro antes de reproduzir normalmente", async () => {
    let callback: VideoFrameRequestCallback | undefined;
    video.requestVideoFrameCallback = vi.fn((next) => { callback = next; return 42; });
    video.cancelVideoFrameCallback = vi.fn();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "1 quadro →" })));
    fireEvent.pause(video);
    paused = true;
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Reproduzir/pausar" })));
    expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(42);
    pause.mockClear();
    act(() => callback?.(0, {} as VideoFrameCallbackMetadata));
    expect(pause).not.toHaveBeenCalled();
    expect(paused).toBe(false);
  });

  it("encerra avanço de quadro sem callback e informa erro de decodificação", async () => {
    vi.useFakeTimers();
    video.requestVideoFrameCallback = vi.fn(() => 1);
    video.cancelVideoFrameCallback = vi.fn();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "1 quadro →" })));
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByText(/não entregou o próximo quadro/)).toBeTruthy();
    expect(paused).toBe(true);
    fireEvent.error(video);
    expect(screen.getByText(/Não foi possível reproduzir/)).toBeTruthy();
  });
});
