"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useRouter } from "@/lib/i18n/navigation";
import { Blobs } from "@/components/podtask/blobs";
import { BrandMark } from "@/components/podtask/brand-mark";
import { ArrowIcon } from "@/components/podtask/icons";
import { clearCachedProfileInitial } from "@/lib/student/profile-initial";
import { signInEmailFor } from "@/lib/auth/username";
import { MOCK_MODE } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

// The Supabase SDK (~60 KB compressed) is not needed to paint this screen,
// only to submit it. It is loaded right after mount (see the effect below)
// so it is ready by the time the student clicks, without blocking first paint.
const loadSupabase = () =>
  import("@/lib/supabase/client").then(
    (m) => m.createClient() as unknown as SupabaseClient<Database>,
  );

const STALE_GUEST_COOKIE_CLEAR =
  "pt_guest=; path=/; max-age=0; SameSite=Lax";

type Mode = "student" | "lecturer";
const MODES: Mode[] = ["student", "lecturer"];

const fieldLabelStyle = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.12em",
  color: "rgb(var(--muted))",
  textTransform: "uppercase",
} as const;

export function LoginClient({
  initialMode = "student",
  next,
}: {
  initialMode?: Mode;
  /** In-app path to return to after sign-in, already validated by page.tsx. */
  next?: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The tab picks the entrance: the lecturer tab has no guest access, opens
  // the dashboard and refuses accounts without the lecturer role. The server
  // still decides who is a lecturer (lecturer layout + RLS); the tab only
  // picks the destination and the error message.
  const [mode, setMode] = useState<Mode>(initialMode);
  const tabRefs = useRef<Record<Mode, HTMLButtonElement | null>>({ student: null, lecturer: null });
  const mockMode = MOCK_MODE;

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.cookie = STALE_GUEST_COOKIE_CLEAR;
    // Whoever signs in next may be a different student.
    clearCachedProfileInitial();
    // Warm the SDK chunk in the background, so sign-in has nothing left to
    // download. The dashboard route is prefetched only in mock mode: with real
    // auth this visitor is still signed out, so the prefetch would cache the
    // middleware's redirect back to /login (see enterStudio).
    void import("@/lib/supabase/client");
    if (MOCK_MODE) router.prefetch("/student");

    // The Back button can restore this page from the back/forward cache with
    // the buttons still disabled by the sign-in that navigated away.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setPending(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [router]);

  function selectMode(next: Mode, focus = false) {
    if (focus) tabRefs.current[next]?.focus();
    if (next === mode) return;
    setMode(next);
    setError(null);
    // Keep ?mode in the address so a reload (or the lecturer layout's
    // redirect target) opens the same tab.
    const url = new URL(window.location.href);
    if (next === "lecturer") url.searchParams.set("mode", "lecturer");
    else url.searchParams.delete("mode");
    window.history.replaceState(null, "", url);
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = MODES.indexOf(mode);
    let next: Mode | null = null;
    // Two tabs: either arrow moves to the other one, in LTR and RTL alike.
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      next = MODES[(index + 1) % MODES.length];
    } else if (event.key === "Home") {
      next = MODES[0];
    } else if (event.key === "End") {
      next = MODES[MODES.length - 1];
    }
    if (!next) return;
    event.preventDefault();
    if (!pending) selectMode(next, true);
  }

  // After a real sign-in, open the dashboard with a full page load. It is the
  // only navigation guaranteed to reach the middleware with the new auth
  // cookie: a client-side router.push can be answered from the router cache,
  // which in a fresh browser still holds the signed-out redirect to /login,
  // so the student would stay on this screen (seen on first visits from
  // Windows machines; any browser without an earlier session is affected).
  function enterStudio(destination: Mode) {
    const area = destination === "lecturer" ? "lecturer" : "student";
    // Back to the page the middleware intercepted, when it is in this area.
    const target = next && next.split("/")[2] === area ? next : `/${locale}/${area}`;
    window.location.assign(target);
  }

  async function handleSignIn(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    if (mockMode) {
      router.push(mode === "lecturer" ? "/lecturer" : "/student");
      return;
    }

    // A username maps to its account's auth e-mail; an e-mail still works
    // for accounts created before usernames. Anything else cannot match.
    const email = signInEmailFor(username);
    if (!email || !password) {
      setError(t("auth.errorInvalid"));
      setPending(false);
      return;
    }

    let leaving = false;
    try {
      const supabase = await loadSupabase();
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error || !data.user) {
        setError(t("auth.errorInvalid"));
        return;
      }
      if (mode === "lecturer") {
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", data.user.id)
          .maybeSingle();
        if (profileError || !profile) {
          await supabase.auth.signOut({ scope: "local" });
          setError(t("auth.errorGeneric"));
          return;
        }
        if (profile.role !== "lecturer" && profile.role !== "admin") {
          // Local scope: only this browser's new session, never the
          // student's sessions on other devices.
          await supabase.auth.signOut({ scope: "local" });
          setError(t("auth.errorNotLecturer"));
          return;
        }
      }
      leaving = true;
      enterStudio(mode);
    } catch {
      setError(t("auth.errorGeneric"));
    } finally {
      // Keep the buttons disabled while the dashboard loads.
      if (!leaving) setPending(false);
    }
  }

  async function handleGuest() {
    setError(null);

    if (mockMode) {
      router.push("/student");
      return;
    }

    setPending(true);
    let leaving = false;
    try {
      const supabase = await loadSupabase();

      // Mint a one-shot guest user via the create-guest-session edge function.
      // This sidesteps the project-level Anonymous Sign-ins toggle: the
      // function uses the service role to create a confirmed email/password
      // user, returns ephemeral credentials, and we sign in with them.
      const { data, error: invokeError } = await supabase.functions.invoke<{
        ok?: boolean;
        email?: string;
        password?: string;
        error?: string;
      }>("create-guest-session", {
        body: { locale },
      });

      if (invokeError || !data?.ok || !data.email || !data.password) {
        // Fall back to native anonymous sign-in if the function path failed
        // (e.g. function not deployed yet on a fresh environment). If both
        // routes are unavailable the user sees the disabled-anonymous hint.
        const { error: anonError } = await supabase.auth.signInAnonymously({
          options: {
            data: { full_name: "Guest visitor", locale },
          },
        });
        if (anonError) {
          setError(t("auth.errorAnonymousDisabled"));
          return;
        }
        leaving = true;
        enterStudio("student");
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });
      if (signInError) {
        setError(t("auth.errorGeneric"));
        return;
      }
      leaving = true;
      enterStudio("student");
    } catch {
      setError(t("auth.errorGeneric"));
    } finally {
      // Keep the button disabled while the dashboard loads, so a second click
      // cannot mint another guest user.
      if (!leaving) setPending(false);
    }
  }

  return (
    <div className="screen" style={{ minHeight: "100vh", position: "relative" }}>
      <Blobs />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="card-hero"
          style={{ width: "100%", maxWidth: 480, padding: 40 }}
        >
          <div role="tablist" aria-label={t("auth.tabsLabel")} className="auth-tabs">
            {MODES.map((m) => (
              <button
                key={m}
                ref={(el) => {
                  tabRefs.current[m] = el;
                }}
                type="button"
                role="tab"
                id={`auth-tab-${m}`}
                aria-selected={mode === m}
                aria-controls="auth-panel"
                tabIndex={mode === m ? 0 : -1}
                className="auth-tab"
                disabled={pending && mode !== m}
                onClick={() => selectMode(m)}
                onKeyDown={onTabKeyDown}
              >
                {m === "lecturer" ? t("auth.tabLecturer") : t("auth.tabStudent")}
              </button>
            ))}
          </div>

          <div
            role="tabpanel"
            id="auth-panel"
            aria-labelledby={`auth-tab-${mode}`}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
                margin: "28px 0 24px",
              }}
            >
              <BrandMark size={88} />
              <div
                style={{
                  fontSize: 11,
                  color: "rgb(var(--muted))",
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  fontWeight: 600,
                }}
              >
                {mode === "lecturer" ? t("lecturer.brand") : t("brand.tagline")}
              </div>
            </div>

            <div style={{ textAlign: "center" }}>
              <h1 className="title" style={{ fontSize: 28 }}>
                {mode === "lecturer" ? t("auth.lecturerTitle") : t("auth.title")}
              </h1>
              <p className="subtitle">
                {mode === "lecturer" ? t("auth.lecturerSubtitle") : t("auth.subtitle")}
              </p>
            </div>

            <form onSubmit={handleSignIn} style={{ marginTop: 24 }}>
              <label className="flex-col" style={{ gap: 6 }}>
                <span style={fieldLabelStyle}>{t("auth.username")}</span>
                <input
                  type="text"
                  name="username"
                  required
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  dir="ltr"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="input"
                  placeholder="noa.levi"
                />
              </label>

              <label
                className="flex-col"
                style={{ gap: 6, marginTop: 16 }}
              >
                <span style={fieldLabelStyle}>{t("auth.password")}</span>
                <input
                  type="password"
                  name="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input"
                  placeholder="••••••••"
                />
              </label>

              <AnimatePresence>
                {error && (
                  <motion.div
                    role="alert"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    style={{
                      marginTop: 16,
                      padding: 12,
                      borderRadius: 12,
                      background: "rgba(255,241,245,0.7)",
                      color: "rgb(var(--pink-rose))",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>

              <button
                type="submit"
                className="btn btn-primary btn-lg"
                style={{ width: "100%", marginTop: 24 }}
                disabled={pending}
              >
                {t("auth.signIn")}
                <span className="icon-flip">
                  <ArrowIcon />
                </span>
              </button>
              <div
                style={{
                  textAlign: "center",
                  fontSize: 12,
                  color: "rgb(var(--muted))",
                  marginTop: 10,
                }}
              >
                {t("auth.accountsHint")}
              </div>

              {mode === "student" ? (
                <>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      margin: "20px 0 4px",
                    }}
                  >
                    <div
                      style={{
                        height: 1,
                        flex: 1,
                        background: "rgb(var(--line))",
                      }}
                    />
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: "0.18em",
                        textTransform: "uppercase",
                        color: "rgb(var(--muted))",
                      }}
                    >
                      {t("auth.or")}
                    </span>
                    <div
                      style={{
                        height: 1,
                        flex: 1,
                        background: "rgb(var(--line))",
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleGuest()}
                    className="btn btn-ghost"
                    disabled={pending}
                    style={{
                      width: "100%",
                      gap: 8,
                      fontWeight: 700,
                      color: "rgb(var(--ink))",
                    }}
                  >
                    {t("auth.continueAsGuest")}
                    <span className="icon-flip">
                      <ArrowIcon size={16} />
                    </span>
                  </button>
                  <div
                    style={{
                      textAlign: "center",
                      fontSize: 12,
                      color: "rgb(var(--muted))",
                      marginTop: 4,
                    }}
                  >
                    {t("auth.guestHint")}
                  </div>
                </>
              ) : (
                <div
                  style={{
                    textAlign: "center",
                    fontSize: 12,
                    color: "rgb(var(--muted))",
                    marginTop: 16,
                  }}
                >
                  {t("auth.lecturerHint")}
                </div>
              )}
            </form>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
