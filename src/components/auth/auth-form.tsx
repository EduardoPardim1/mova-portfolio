"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/browser";
import { AUTH_MESSAGES, safeAuthDestination } from "@/lib/auth/redirect";

type Mode = "login" | "signup" | "forgot" | "update";
const copy = {
  login: ["Acessar plataforma", "Entrar"], signup: ["Criar acesso", "Criar conta"],
  forgot: ["Recuperar senha", "Enviar instruções"], update: ["Definir nova senha", "Atualizar senha"],
};

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [canUpdate, setCanUpdate] = useState(false);
  const [checking, setChecking] = useState(mode === "update");
  useEffect(() => {
    let active = true;
    const error = new URLSearchParams(window.location.search).get("authError");
    if (error && Object.hasOwn(AUTH_MESSAGES, error)) setMessage(AUTH_MESSAGES[error as keyof typeof AUTH_MESSAGES]);
    if (mode === "update") {
      void (async () => {
        try {
          if (new URLSearchParams(window.location.hash.slice(1)).has("error")) { if (active) setMessage(AUTH_MESSAGES.callback); return; }
          const client = createClient();
          if (!client) { if (active) setMessage(AUTH_MESSAGES.configuration); return; }
          const { data: { user }, error } = await client.auth.getUser();
          if (active) {
            setCanUpdate(Boolean(user) && !error);
            if (error || !user) setMessage(AUTH_MESSAGES.callback);
          }
        } catch { if (active) setMessage(AUTH_MESSAGES.network); }
        finally { if (active) setChecking(false); }
      })();
    }
    return () => { active = false; };
  }, [mode]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || (mode === "update" && !canUpdate)) return;
    lock.current = true; setBusy(true); setMessage("");
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const client = createClient();
      if (!client) { setMessage(AUTH_MESSAGES.configuration); return; }
      const email = String(data.get("email") ?? "").trim();
      const password = String(data.get("password") ?? "");
      if (mode !== "forgot" && password.length < 8) { setMessage("A senha deve ter pelo menos 8 caracteres."); return; }
      if (mode === "login") {
        const { data: result, error } = await client.auth.signInWithPassword({ email, password });
        if (error || !result.session || !result.user) { setMessage("Não foi possível entrar. Confira e-mail, senha e confirmação do cadastro."); return; }
        setMessage("Login realizado. Redirecionando…");
        router.replace(safeAuthDestination(new URLSearchParams(window.location.search).get("next")));
        router.refresh();
      } else if (mode === "signup") {
        const fullName = String(data.get("fullName") ?? "").trim();
        if (Array.from(fullName).length < 2 || Array.from(fullName).length > 120) { setMessage("Informe seu nome com 2 a 120 caracteres."); return; }
        const { error } = await client.auth.signUp({ email, password, options: { data: { full_name: fullName }, emailRedirectTo: `${window.location.origin}/auth/callback` } });
        setMessage(error ? "Não foi possível concluir o cadastro. Confira os dados e tente novamente mais tarde." : "Solicitação recebida. Verifique seu e-mail para confirmar o acesso, se aplicável, neste mesmo navegador.");
        if (!error) form.reset();
      } else if (mode === "forgot") {
        const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/callback?next=%2Fupdate-password` });
        setMessage(error ? "Não foi possível solicitar a recuperação. Tente novamente mais tarde." : "Se o endereço estiver apto à recuperação, enviaremos instruções. Abra o link neste mesmo navegador.");
      } else {
        // Revalida no envio: a sessão pode ter expirado desde a abertura da página.
        const { data: { user }, error: sessionError } = await client.auth.getUser();
        if (sessionError || !user) { setCanUpdate(false); setMessage(AUTH_MESSAGES.callback); return; }
        const { data: result, error } = await client.auth.updateUser({ password });
        setMessage(error || !result.user ? "Não foi possível atualizar a senha. Solicite outro link se a sessão expirou." : "Senha atualizada com sucesso. Você pode acessar a plataforma.");
        if (!error && result.user) form.reset();
      }
    } catch { setMessage(AUTH_MESSAGES.network); }
    finally { lock.current = false; setBusy(false); }
  }

  return <main className="container" style={{ paddingTop: 70, maxWidth: 520 }}>
    <Link className="brand" href="/">MO<i>VA</i></Link><h1>{copy[mode][0]}</h1>
    <form className="form" onSubmit={submit} aria-busy={busy || checking}>
      {mode === "signup" && <><label className="label" htmlFor="fullName">Nome completo</label><input id="fullName" className="field" name="fullName" autoComplete="name" required minLength={2} maxLength={120} disabled={busy} /></>}
      {mode !== "update" && <><label className="label" htmlFor="email">E-mail</label><input id="email" className="field" name="email" type="email" autoComplete="email" required disabled={busy} /></>}
      {mode !== "forgot" && <><label className="label" htmlFor="password">{mode === "update" ? "Nova senha" : "Senha"}</label><input id="password" className="field" name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} disabled={busy || checking || (mode === "update" && !canUpdate)} /></>}
      {checking && <p role="status">Verificando sessão…</p>}
      {message && <p className="notice" role="status" aria-live="polite">{message}</p>}
      <button className="button primary" type="submit" disabled={busy || checking || (mode === "update" && !canUpdate)}>{busy ? "Aguarde…" : copy[mode][1]}</button>
      <p className="muted"><Link href="/login">Entrar</Link> · <Link href="/signup">Criar acesso</Link> · <Link href="/forgot-password">Recuperar senha</Link></p>
      {mode === "update" && <Link href="/dashboard">Ir para a plataforma</Link>}
    </form>
  </main>;
}
