// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { CookieMethodsServer } from "@supabase/ssr";
const mocks = vi.hoisted(() => ({ create: vi.fn(), cookies: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.create }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
import { GET } from "@/app/auth/callback/route";
import { middleware, config } from "@/middleware";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSafePublicSupabaseKey, publicSupabaseConfig } from "@/lib/supabase/config";
import { safeAuthDestination } from "@/lib/auth/redirect";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://audit.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "sb_publishable_fixture_only");
});
afterEach(() => vi.unstubAllEnvs());
const request = (path: string, cookie = "") => new NextRequest(`https://mova.invalid${path}`, { headers: { cookie } });
const jwt = (role: string, alg = "HS256") => [JSON.stringify({ alg }), JSON.stringify({ role })].map(s => Buffer.from(s).toString("base64url")).join(".") + ".fictitious";

describe("configuração e destinos", () => {
  it("recusa segredo, role privilegiada, JWT malformado e chave desconhecida", () => {
    for (const value of [undefined, "", "sb_secret_fixture", jwt("service_role"), jwt("authenticated"), jwt("anon", "none"), "x.y.z", "random", " sb_publishable_fixture"]) expect(isSafePublicSupabaseKey(value)).toBe(false);
    expect(isSafePublicSupabaseKey(jwt("anon"))).toBe(true);
    expect(isSafePublicSupabaseKey("sb_publishable_fixture")).toBe(true);
  });
  it("configuração inválida não cria cliente", async () => {
    for (const value of ["", "https://evil.invalid", "https://audit.supabase.co/path", "https://u:p@audit.supabase.co", "http://audit.supabase.co", "https://audit.supabase.co?x=1"]) {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", value); expect(publicSupabaseConfig()).toBeNull(); expect(await createServerSupabaseClient()).toBeNull();
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("recusa redirecionamentos maliciosos e preserva destinos internos", () => {
    for (const value of ["https://evil.invalid", "//evil.invalid", "/\\evil.invalid", "/%2f%2fevil.invalid", "/login", "/dashboard/../../auth/callback", "/dashboard\n", "javascript:alert(1)"]) expect(safeAuthDestination(value)).toBe("/dashboard");
    expect(safeAuthDestination("/patients?view=active")).toBe("/patients?view=active");
    expect(safeAuthDestination("/update-password", true)).toBe("/update-password");
    expect(safeAuthDestination("/update-password")).toBe("/dashboard");
  });
});

describe("callback com cookies reais Next e SDK mockado", () => {
  it("lê cookies fragmentados, encaminha flowId e persiste cookies na resposta", async () => {
    const exchange = vi.fn();
    mocks.create.mockImplementation((_url, _key, { cookies }: { cookies: CookieMethodsServer }) => ({ auth: { exchangeCodeForSession: exchange.mockImplementation(async () => {
      expect(await cookies.getAll()).toEqual([{ name: "verifier.0", value: "fixture-a" }, { name: "verifier.1", value: "fixture-b" }]);
      await cookies.setAll!([{ name: "session", value: "fixture-session", options: { path: "/", sameSite: "lax", secure: true } }]);
      return { data: { session: {}, user: {} }, error: null };
    }) } }));
    const response = await GET(request("/auth/callback?code=fixture-code&sb_flow_id=fixture-flow&next=%2Fupdate-password", "verifier.0=fixture-a; verifier.1=fixture-b"));
    expect(exchange).toHaveBeenCalledWith("fixture-code", { flowId: "fixture-flow" });
    expect(response.headers.get("location")).toBe("https://mova.invalid/update-password");
    expect(response.cookies.get("session")?.value).toBe("fixture-session");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it.each(["/auth/callback", "/auth/callback?code=x&error=expired"])("recusa callback incompleto: %s", async path => {
    expect((await GET(request(path))).headers.get("location")).toContain("authError=callback"); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("não emite sessão em exchange inválido; conserva remoção de cookies", async () => {
    mocks.create.mockImplementation((_u, _k, { cookies }: { cookies: CookieMethodsServer }) => ({ auth: { exchangeCodeForSession: async () => {
      await cookies.setAll!([{ name: "session", value: "must-not-persist", options: {} }, { name: "old", value: "", options: { maxAge: 0 } }]);
      return { data: { session: null, user: null }, error: new Error("fictitious") };
    } } }));
    const response = await GET(request("/auth/callback?code=expired&next=https://evil.invalid"));
    expect(response.headers.get("location")).toContain("/login?authError=callback");
    expect(response.cookies.get("session")).toBeUndefined(); expect(response.cookies.get("old")?.value).toBe("");
  });
  it("captura falha de rede sem expor detalhes", async () => {
    mocks.create.mockReturnValue({ auth: { exchangeCodeForSession: async () => { throw new Error("fixture-sensitive-detail"); } } });
    const response = await GET(request("/auth/callback?code=fixture"));
    expect(response.headers.get("location")).not.toContain("sensitive"); expect(response.headers.get("location")).toContain("authError=callback");
  });
  it("configuração ausente falha fechada no callback", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    expect((await GET(request("/auth/callback?code=x"))).headers.get("location")).toContain("configuration"); expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe("renovação e defesa em profundidade", () => {
  it("renova request e response, preservando várias chamadas setAll", async () => {
    mocks.create.mockImplementation((_u, _k, { cookies }: { cookies: CookieMethodsServer }) => ({ auth: { getUser: async () => {
      await cookies.setAll!([{ name: "session", value: "renewed-fixture", options: { path: "/" } }]);
      await cookies.setAll!([{ name: "old.1", value: "", options: { maxAge: 0 } }]);
      expect(await cookies.getAll()).toContainEqual({ name: "session", value: "renewed-fixture" });
      return { data: { user: { id: "fixture" } }, error: null };
    } } }));
    const req = request("/patients", "session=old-fixture"); const res = await middleware(req);
    expect(req.cookies.get("session")?.value).toBe("renewed-fixture");
    expect(res.headers.get("x-middleware-request-cookie")).toContain("renewed-fixture");
    expect(res.cookies.get("session")?.value).toBe("renewed-fixture"); expect(res.cookies.get("old.1")?.value).toBe("");
  });
  it("preserva cookies removidos no redirecionamento de sessão inválida", async () => {
    mocks.create.mockImplementation((_u, _k, { cookies }: { cookies: CookieMethodsServer }) => ({ auth: { getUser: async () => {
      await cookies.setAll!([{ name: "session", value: "", options: { maxAge: 0 } }]);
      return { data: { user: null }, error: null };
    } } }));
    const response = await middleware(request("/admin")); expect(response.headers.get("location")).toContain("/login?"); expect(response.cookies.get("session")?.value).toBe("");
    expect((await middleware(request("/api/patients"))).status).toBe(401);
  });
  it("recusa configuração ausente e rede indisponível sem abrir rota", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect((await middleware(request("/evolution"))).headers.get("location")).toContain("configuration");
    expect((await middleware(request("/api/assessments"))).status).toBe(503);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://audit.supabase.co");
    mocks.create.mockReturnValue({ auth: { getUser: async () => { throw new Error("offline"); } } });
    expect((await middleware(request("/api/patients"))).status).toBe(503);
    mocks.create.mockReturnValue({ auth: { getUser: async () => ({ data: { user: null }, error: { name: "AuthRetryableFetchError", status: 503 } }) } });
    expect((await middleware(request("/api/patients"))).status).toBe(503);
  });
  it("matcher inclui áreas privadas e não captura login, callback ou webhook", () => {
    for (const root of ["dashboard", "patients", "assessments", "evolution", "subscription", "admin", "reports", "settings"]) expect(config.matcher).toContain(`/${root}/:path*`);
    expect(config.matcher.some(p => p.includes("login") || p.includes("callback") || p.includes("billing"))).toBe(false);
  });
  it("cliente server grava cookies em handlers, não oculta erros não relacionados", async () => {
    const store = { getAll: () => [{ name: "session", value: "fixture" }], set: vi.fn() };
    mocks.cookies.mockResolvedValue(store); mocks.create.mockImplementation((_u, _k, o) => o);
    const client = await createServerSupabaseClient() as unknown as { cookies: CookieMethodsServer };
    expect(await client.cookies.getAll()).toHaveLength(1);
    await client.cookies.setAll!([{ name: "session", value: "fixture-new", options: { secure: true } }]);
    expect(store.set).toHaveBeenCalledWith("session", "fixture-new", { secure: true });
    store.set.mockImplementation(() => { throw new Error("Cookies can only be modified in a Server Action or Route Handler"); });
    expect(() => client.cookies.setAll!([{ name: "x", value: "x", options: {} }])).not.toThrow();
    store.set.mockImplementation(() => { throw new Error("other failure"); });
    expect(() => client.cookies.setAll!([{ name: "x", value: "x", options: {} }])).toThrow("other failure");
  });
});
