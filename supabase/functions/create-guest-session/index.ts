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
//   creates real auth.users rows, so production deployments should layer a
//   CAPTCHA or rate-limit in front of it to avoid abuse.
import { CORS_HEADERS, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";

declare const Deno: {
  serve: (h: (req: Request) => Response | Promise<Response>) => void;
  env: { get(key: string): string | undefined };
};

function randomPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return errorResponse("method_not_allowed", 405);

  const body = await req.json().catch(() => ({}));
  const localeRaw = typeof body?.locale === "string" ? body.locale : "he";
  const locale = localeRaw === "en" ? "en" : "he";

  const sb = serviceClient();

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
