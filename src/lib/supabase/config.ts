/** Validação de configuração, não verificação criptográfica de uma chave. */
export function isSafePublicSupabaseKey(key: string | undefined): key is string {
  if (!key || key !== key.trim() || key.length > 4096) return false;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  const parts = key.split(".");
  if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) return false;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    const header = JSON.parse(atob(parts[0].replace(/-/g, "+").replace(/_/g, "/")));
    return header.alg === "HS256" && payload.role === "anon";
  } catch { return false; }
}

export function publicSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !isSafePublicSupabaseKey(key)) return null;
  try {
    const parsed = new URL(url);
    const hosted = parsed.protocol === "https:" && /^[a-z0-9-]+\.supabase\.co$/.test(parsed.hostname) && !parsed.port;
    const local = process.env.NODE_ENV !== "production" && parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname);
    if ((!hosted && !local) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") return null;
    return { url: parsed.origin, key };
  } catch { return null; }
}
