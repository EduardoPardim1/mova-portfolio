// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/auth/callback/route";

// SDK @supabase/ssr e auth-js REAIS, transporte inteiramente falso. Sem contas/e-mails.
const fakeFetch = vi.fn();
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://audit.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "sb_publishable_fixture_only");
  fakeFetch.mockReset(); vi.stubGlobal("fetch", fakeFetch);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const callback = (cookie = "", code = "fixture-code", flowId = "") => GET(new NextRequest(`https://mova.invalid/auth/callback?code=${code}&next=%2Fupdate-password${flowId ? `&sb_flow_id=${flowId}` : ""}`, { headers: { cookie } }));
describe("contrato PKCE do SDK instalado, sem rede", () => {
  it.each(["", "irrelevant=fixture"])("sem cookie verifier não solicita token (%s)", async cookie => {
    const response = await callback(cookie);
    expect(response.headers.get("location")).toContain("authError=callback");
    expect(fakeFetch).not.toHaveBeenCalled();
    expect(response.cookies.getAll().filter(c => c.value && !c.name.includes("verifier"))).toEqual([]);
  });
  it.each(["legacy", "slot-fragmentado"])("SDK lê verifier (%s) e cria cookies após troca válida", async mode => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = [JSON.stringify({ alg: "HS256" }), JSON.stringify({ sub: "fixture-user", exp })].map(s => Buffer.from(s).toString("base64url")).join(".") + ".fixture";
    fakeFetch.mockImplementation(async (url, options) => {
      expect(String(url)).toBe("https://audit.supabase.co/auth/v1/token?grant_type=pkce");
      expect(JSON.parse(options.body).code_verifier).toBe("fixture-verifier");
      return new Response(JSON.stringify({ access_token: token, refresh_token: "fixture-refresh", expires_in: 3600, token_type: "bearer", user: { id: "fixture-user", aud: "authenticated" } }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const encoded = "base64-" + Buffer.from(JSON.stringify("fixture-verifier/recovery")).toString("base64url");
    const slot = "sb-audit-auth-token-flow-fixture-flow-code-verifier";
    const cookie = mode === "legacy" ? 'sb-audit-auth-token-code-verifier="fixture-verifier/recovery"' : `${slot}.0=${encoded.slice(0, 20)}; ${slot}.1=${encoded.slice(20)}`;
    const response = await callback(cookie, "fixture-code", mode === "legacy" ? "" : "fixture-flow");
    expect(response.headers.get("location")).toBe("https://mova.invalid/update-password");
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(response.cookies.getAll().some(c => c.name.startsWith("sb-audit-auth-token") && !c.name.includes("verifier") && c.value.length > 0)).toBe(true);
  });
  it("flowId sem slot não usa verifier legado de outro fluxo", async () => {
    const response = await callback('sb-audit-auth-token-code-verifier="fixture-other"', "fixture-code", "missing-flow");
    expect(response.headers.get("location")).toContain("authError=callback"); expect(fakeFetch).not.toHaveBeenCalled();
  });
  it("erro de código expirado não emite cookies de sessão", async () => {
    fakeFetch.mockResolvedValue(new Response(JSON.stringify({ code: "flow_state_expired", message: "fixture" }), { status: 400, headers: { "content-type": "application/json" } }));
    const response = await callback('sb-audit-auth-token-code-verifier="fixture-verifier"', "expired-fixture");
    expect(response.headers.get("location")).toContain("authError=callback");
    expect(response.cookies.getAll().some(c => !c.name.includes("verifier") && c.value.length > 0)).toBe(false);
  });
});
