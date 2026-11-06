"use client";
import { createClient } from "@/lib/supabase/browser";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const lock = useRef(false);
  async function logout() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage("");
    try {
      const client = createClient();
      if (!client) { setMessage("Não foi possível sair: acesso temporariamente indisponível."); return; }
      const { error } = await client.auth.signOut();
      if (error) { setMessage("Não foi possível encerrar a sessão. Tente novamente."); return; }
      router.replace("/"); router.refresh();
    } catch { setMessage("Falha de conexão ao sair. A saída não foi confirmada; tente novamente."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <><button type="button" className="button secondary" disabled={busy} onClick={() => void logout()}>{busy ? "Saindo…" : "Sair"}</button>{message && <p role="status" aria-live="polite">{message}</p>}</>;
}
