// Edge Function: create-guest-session
//
// Mints a one-shot "guest" auth user using the service role key so the
// student can continue without enabling the Anonymous Sign-ins provider in
// the Supabase Dashboard. Returns ephemeral email + password the client
// immediately consumes via supabase.auth.signInWithPassword.
//
// Notes
// - email_confirm: true bypasses the project's email confirmation setting.
// - raw_user_meta_data flows through public.handle_new_user (see migration
//   20260506000003_anonymous_auth_support.sql), which seeds the profile row
//   with the Demo sandbox institution and locale.
// - This endpoint is unauthenticated by design (it is the login path). It
//   creates real auth.users rows, so it is rate limited per client address
//   (and globally) through `rate_limit_events`. Guest interviews carry no
//   identity claim: the lecturer report marks them as guest sessions.
import { CORS_HEADERS, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";

declare const Deno: {
  serve: (h: (req: Request) => Response | Promise<Response>) => void;
  env: { get(key: string): string | undefined };
};

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_ADDRESS_PER_HOUR = 6;
const MAX_GLOBAL_PER_HOUR = 150;

function randomPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashAddress(address: string): Promise<string> {
  const data = new TextEncoder().encode(`guest:${address}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest).slice(0, 12), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

function clientAddress(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const first = forwarded.split(",")[0]?.trim();
  return first || req.headers.get("cf-connecting-ip") || "unknown";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return errorResponse("method_not_allowed", 405);

  const body = await req.json().catch(() => ({}));
  const localeRaw = typeof body?.locale === "string" ? body.locale : "he";
  const locale = localeRaw === "en" ? "en" : "he";

  const sb = serviceClient();
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const addressKey = `guest_create:${await hashAddress(clientAddress(req))}`;

  const [{ count: perAddress }, { count: global }] = await Promise.all([
    sb
      .from("rate_limit_events")
      .select("id", { count: "exact", head: true })
      .eq("key", addressKey)
      .gte("window_start", since),
    sb
      .from("rate_limit_events")
      .select("id", { count: "exact", head: true })
      .like("key", "guest_create:%")
      .gte("window_start", since),
  ]);
  if ((perAddress ?? 0) >= MAX_PER_ADDRESS_PER_HOUR || (global ?? 0) >= MAX_GLOBAL_PER_HOUR) {
    return errorResponse("guest_rate_limited", 429);
  }
  await sb.from("rate_limit_events").insert({ key: addressKey, count: 1 });

  const email = `guest-${crypto.randomUUID()}@guest.podtask.app`;
  const password = randomPassword();

  const { data, error } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: "Guest visitor",
      locale,
      is_guest: true,
    },
  });

  if (error || !data.user) {
    await sb
      .from("system_events")
      .insert({
        event_type: "auth.guest.create_failed",
        entity_type: "auth_user",
        payload: {
          severity: "error",
          message: error?.message ?? "unknown",
        },
      })
      .then(() => undefined, () => undefined);
    return errorResponse("guest_create_failed", 500);
  }

  return jsonResponse({ ok: true, email, password });
});
