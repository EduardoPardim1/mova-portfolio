import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicSupabaseConfig } from "./config";
export async function createServerSupabaseClient() {
  const config = publicSupabaseConfig();
  if (!config) return null;
  const store = await cookies();
  return createServerClient(config.url, config.key, { cookies: {
    getAll: () => store.getAll(),
    setAll(items) {
      try { items.forEach(({ name, value, options }) => store.set(name, value, options)); }
      catch (error) {
        // Em Server Components a renovação é responsabilidade do middleware.
        if (!(error instanceof Error) || !error.message.includes("Cookies can only be modified")) throw error;
      }
    },
  } });
}
