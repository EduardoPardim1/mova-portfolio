import { createBrowserClient } from "@supabase/ssr";
import { publicSupabaseConfig } from "./config";
export { isSafePublicSupabaseKey } from "./config";
export function createClient() {
  const config = publicSupabaseConfig();
  return config ? createBrowserClient(config.url, config.key) : null;
}
