import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { publicSupabaseConfig } from "@/lib/supabase/config";
import { safeAuthDestination } from "@/lib/auth/redirect";

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const config = publicSupabaseConfig();
  const updates = new Map<string, { name: string; value: string; options: CookieOptions }>();
  const response = (target: string, success: boolean) => {
    const result = NextResponse.redirect(new URL(target, url.origin));
    for (const cookie of updates.values()) {
      if (success || cookie.value === "" || (cookie.options.maxAge !== undefined && cookie.options.maxAge <= 0)) result.cookies.set(cookie.name, cookie.value, cookie.options);
    }
    result.headers.set("Cache-Control", "private, no-store");
    result.headers.set("Referrer-Policy", "no-referrer");
    return result;
  };
  if (!config) return response("/login?authError=configuration", false);
  const code = url.searchParams.get("code");
  if (!code || url.searchParams.has("error")) return response("/login?authError=callback", false);
  try {
    const client = createServerClient(config.url, config.key, { cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(items) { items.forEach(item => { request.cookies.set(item.name, item.value); updates.set(item.name, item); }); },
    } });
    // O SDK lê/reconstitui o verifier PKCE, inclusive cookies fragmentados.
    const flowId = url.searchParams.get("sb_flow_id");
    const { data, error } = await client.auth.exchangeCodeForSession(code, flowId === null ? undefined : { flowId });
    if (error || !data.session || !data.user) return response("/login?authError=callback", false);
    return response(safeAuthDestination(url.searchParams.get("next"), true), true);
  } catch { return response("/login?authError=callback", false); }
}
