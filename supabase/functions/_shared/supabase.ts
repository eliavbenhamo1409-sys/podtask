// @ts-expect-error -- Deno import URL, resolved at runtime in Edge Functions.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: { env: { get(key: string): string | undefined } };

export function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

export async function userClient(req: Request) {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      auth: { persistSession: false },
      global: { headers: { Authorization: auth } },
    },
  );
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  return { sb, userId: data.user.id };
}
