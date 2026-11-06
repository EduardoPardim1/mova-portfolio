/** Só destinos internos conhecidos; não aceita URLs, barras codificadas ou controles. */
export function safeAuthDestination(value: string | null | undefined, recovery = false): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(value)) return "/dashboard";
  try {
    const url = new URL(value, "https://mova.invalid");
    if (url.origin !== "https://mova.invalid" || /%/.test(url.pathname)) return "/dashboard";
    const roots = ["dashboard", "patients", "assessments", "evolution", "reports", "settings", "subscription", "admin"];
    if (recovery) roots.push("update-password");
    if (!roots.some(root => url.pathname === `/${root}` || url.pathname.startsWith(`/${root}/`))) return "/dashboard";
    return url.pathname + url.search;
  } catch { return "/dashboard"; }
}
export const AUTH_MESSAGES = {
  configuration: "O acesso está temporariamente indisponível. Contate o suporte.",
  callback: "Link inválido ou expirado. Solicite um novo link e abra-o no mesmo navegador usado na solicitação.",
  session: "Sua sessão expirou ou não está autenticada. Entre novamente.",
  network: "Não foi possível verificar o acesso. Verifique sua conexão e tente novamente.",
} as const;
