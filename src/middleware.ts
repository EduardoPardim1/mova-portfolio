import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicSupabaseConfig } from "@/lib/supabase/config";

export async function middleware(request: NextRequest) {
  const updates = new Map<string, { name: string; value: string; options: CookieOptions }>();
  const finish = (response: NextResponse, failed = false) => {
    for (const item of updates.values()) {
      if (!failed || item.value === "" || (item.options.maxAge !== undefined && item.options.maxAge <= 0)) response.cookies.set(item.name, item.value, item.options);
    }
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  };
  const deny = (reason: "configuration" | "session" | "network") => {
    if (request.nextUrl.pathname.startsWith("/api/")) return finish(NextResponse.json({ error: reason === "session" ? "Sessão inválida ou expirada" : "Autenticação temporariamente indisponível" }, { status: reason === "session" ? 401 : 503 }), true);
    const target = new URL(request.nextUrl.pathname === "/update-password" ? "/forgot-password" : "/login", request.url);
    target.searchParams.set("authError", reason);
    if (request.nextUrl.pathname !== "/update-password") target.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return finish(NextResponse.redirect(target), true);
  };
  const settings = publicSupabaseConfig();
  if (!settings) return deny("configuration");
  try {
    const client = createServerClient(settings.url, settings.key, { cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(items) { items.forEach(item => { request.cookies.set(item.name, item.value); updates.set(item.name, item); }); },
    } });
    const { data: { user }, error } = await client.auth.getUser();
    if (error) return deny(error.name === "AuthRetryableFetchError" || error.status === 0 || (error.status ?? 0) >= 500 ? "network" : "session");
    if (!user) return deny("session");
    // Encaminha a request já renovada para o SSR, além dos Set-Cookie na resposta.
    return finish(NextResponse.next({ request }));
  } catch { return deny("network"); }
}
export const config = { matcher: [
  "/dashboard/:path*", "/patients/:path*", "/assessments/:path*", "/evolution/:path*",
  "/reports/:path*", "/settings/:path*", "/subscription/:path*", "/admin/:path*", "/dev/:path*", "/update-password",
  "/api/patients/:path*", "/api/assessments/:path*", "/api/uploads/:path*", "/api/reports/:path*",
] };
