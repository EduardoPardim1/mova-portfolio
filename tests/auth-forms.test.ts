import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/supabase/browser", () => ({ createClient: mocks.client }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }) }));
import { AuthForm } from "@/components/auth/auth-form";
import { LogoutButton } from "@/components/auth/logout-button";

let auth: { signInWithPassword: ReturnType<typeof vi.fn>; signUp: ReturnType<typeof vi.fn>; resetPasswordForEmail: ReturnType<typeof vi.fn>; updateUser: ReturnType<typeof vi.fn>; getUser: ReturnType<typeof vi.fn>; signOut: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.clearAllMocks(); window.history.replaceState({}, "", "/login");
  auth = { signInWithPassword: vi.fn(), signUp: vi.fn(), resetPasswordForEmail: vi.fn(), updateUser: vi.fn(), getUser: vi.fn().mockResolvedValue({ data: { user: { id: "fixture" } }, error: null }), signOut: vi.fn() };
  mocks.client.mockReturnValue({ auth });
});
afterEach(cleanup);
function fill() {
  const email = document.querySelector('input[name="email"]'); if (email) fireEvent.change(email, { target: { value: "fixture@example.invalid" } });
  const password = document.querySelector('input[name="password"]'); if (password) fireEvent.change(password, { target: { value: "synthetic-only-password" } });
}
const submit = () => fireEvent.submit(document.querySelector("form")!);
const enabled = (name: string) => !(screen.getByRole("button", { name }) as HTMLButtonElement).disabled;

describe("formulários de autenticação offline", () => {
  it("login recusado não redireciona nem mostra detalhes do provedor", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: { message: "sensitive-fixture" } });
    render(createElement(AuthForm, { mode: "login" })); fill(); submit();
    await screen.findByText(/Não foi possível entrar/); expect(mocks.replace).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain("sensitive-fixture"); expect(enabled("Entrar")).toBe(true);
  });
  it("falha de rede libera loading e permite nova tentativa", async () => {
    auth.signInWithPassword.mockRejectedValue(new Error("offline"));
    render(createElement(AuthForm, { mode: "login" })); fill(); submit();
    await screen.findByText(/Verifique sua conexão/); expect(enabled("Entrar")).toBe(true);
  });
  it("bloqueia envio concorrente e respeita next interno", async () => {
    let resolve!: (v: unknown) => void;
    auth.signInWithPassword.mockImplementation(() => new Promise(r => { resolve = r; }));
    window.history.replaceState({}, "", "/login?next=%2Fpatients");
    render(createElement(AuthForm, { mode: "login" })); fill(); submit(); submit();
    expect(auth.signInWithPassword).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ data: { session: {}, user: {} }, error: null }));
    expect(mocks.replace).toHaveBeenCalledWith("/patients"); expect(mocks.refresh).toHaveBeenCalled();
  });
  it("login bem sucedido recusa next externo", async () => {
    window.history.replaceState({}, "", "/login?next=%2F%2Fevil.invalid");
    auth.signInWithPassword.mockResolvedValue({ data: { session: {}, user: {} }, error: null });
    render(createElement(AuthForm, { mode: "login" })); fill(); submit();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/dashboard"));
  });
  it("configuração ausente não chama Auth", async () => {
    mocks.client.mockReturnValue(null); render(createElement(AuthForm, { mode: "login" })); fill(); submit();
    await screen.findByText(/Contate o suporte/); expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });
  it("nome curto é recusado; nome válido é enviado em metadata sem depender do prefixo do e-mail", async () => {
    auth.signUp.mockResolvedValue({ error: null }); render(createElement(AuthForm, { mode: "signup" })); fill();
    fireEvent.change(screen.getByLabelText("Nome completo"), { target: { value: " A " } }); submit();
    await screen.findByText(/2 a 120 caracteres/); expect(auth.signUp).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Nome completo"), { target: { value: "Revisor Sintético" } });
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "a@example.invalid" } }); submit();
    await screen.findByText(/Solicitação recebida/);
    expect(auth.signUp).toHaveBeenCalledWith(expect.objectContaining({ options: { data: { full_name: "Revisor Sintético" }, emailRedirectTo: `${location.origin}/auth/callback` } }));
  });
  it("recuperação solicita callback PKCE; mensagem não confirma existência de conta", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: null }); render(createElement(AuthForm, { mode: "forgot" })); fill(); submit();
    await screen.findByText(/Se o endereço estiver apto/);
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("fixture@example.invalid", { redirectTo: `${location.origin}/auth/callback?next=%2Fupdate-password` });
  });
  it("recuperação com erro não informa envio de e-mail", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: { message: "fixture" } }); render(createElement(AuthForm, { mode: "forgot" })); fill(); submit();
    await screen.findByText(/Não foi possível solicitar/); expect(enabled("Enviar instruções")).toBe(true);
  });
  it("link sem sessão mantém atualização bloqueada", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: null }); render(createElement(AuthForm, { mode: "update" }));
    await screen.findByText(/Link inválido ou expirado/); expect(enabled("Atualizar senha")).toBe(false); submit(); expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it("sessão que expira antes de enviar não atualiza a senha", async () => {
    render(createElement(AuthForm, { mode: "update" })); await waitFor(() => expect(enabled("Atualizar senha")).toBe(true)); fill();
    auth.getUser.mockResolvedValue({ data: { user: null }, error: null }); submit();
    await screen.findByText(/Link inválido ou expirado/); expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it("update com sessão verificada só confirma sucesso após resposta", async () => {
    auth.updateUser.mockResolvedValue({ data: { user: { id: "fixture" } }, error: null });
    render(createElement(AuthForm, { mode: "update" })); await waitFor(() => expect(enabled("Atualizar senha")).toBe(true)); fill(); submit();
    await screen.findByText(/Senha atualizada com sucesso/); expect(auth.getUser).toHaveBeenCalledTimes(2);
  });
  it.each(["error", "throw"])("falha ao atualizar senha (%s) libera envio sem alegar sucesso", async kind => {
    if (kind === "error") auth.updateUser.mockResolvedValue({ data: { user: null }, error: { message: "fixture" } }); else auth.updateUser.mockRejectedValue(new Error("offline"));
    render(createElement(AuthForm, { mode: "update" })); await waitFor(() => expect(enabled("Atualizar senha")).toBe(true)); fill(); submit();
    await screen.findByText(/Não foi possível atualizar|Verifique sua conexão/); expect(enabled("Atualizar senha")).toBe(true); expect(document.body.textContent).not.toContain("Senha atualizada com sucesso");
  });
  it.each(["error", "throw"])("logout falho (%s) não redireciona e libera botão", async kind => {
    if (kind === "error") auth.signOut.mockResolvedValue({ error: new Error("fixture") }); else auth.signOut.mockRejectedValue(new Error("offline"));
    render(createElement(LogoutButton)); fireEvent.click(screen.getByRole("button", { name: "Sair" }));
    await waitFor(() => expect(enabled("Sair")).toBe(true)); expect(mocks.replace).not.toHaveBeenCalled(); expect(screen.getByRole("status").textContent).toMatch(/Não foi possível|não foi confirmada/);
  });
  it("logout confirmado redireciona", async () => {
    auth.signOut.mockResolvedValue({ error: null }); render(createElement(LogoutButton)); fireEvent.click(screen.getByRole("button", { name: "Sair" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/"));
  });
});
