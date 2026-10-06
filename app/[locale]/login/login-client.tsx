"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "@/lib/i18n/navigation";
import { Blobs } from "@/components/podtask/blobs";
import { BrandMark } from "@/components/podtask/brand-mark";
import { Eyebrow } from "@/components/podtask/eyebrow";
import { ArrowIcon, SparkIcon } from "@/components/podtask/icons";
import { clearCachedProfileInitial } from "@/lib/student/profile-initial";
import { MOCK_MODE } from "@/lib/env";

// The Supabase SDK (~60 KB compressed) is not needed to paint this screen,
// only to submit it. It is loaded right after mount (see the effect below)
// so it is ready by the time the student clicks, without blocking first paint.
const loadSupabase = () =>
  import("@/lib/supabase/client").then((m) => m.createClient());

const STALE_GUEST_COOKIE_CLEAR =
  "pt_guest=; path=/; max-age=0; SameSite=Lax";

export function LoginClient() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicSent, setMagicSent] = useState(false);
  const mockMode = MOCK_MODE;

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.cookie = STALE_GUEST_COOKIE_CLEAR;
    // Whoever signs in next may be a different student.
    clearCachedProfileInitial();
    // Warm the SDK chunk in the background.
    void import("@/lib/supabase/client");
  }, []);

  async function handleSignIn(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    if (mockMode) {
      router.push("/student");
      return;
    }

    try {
      const supabase = await loadSupabase();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setError(t("auth.errorInvalid"));
      } else {
        router.push("/student");
      }
    } catch {
      setError(t("auth.errorGeneric"));
    } finally {
      setPending(false);
    }
  }

  async function handleGuest() {
    setError(null);

    if (mockMode) {
      router.push("/student");
      return;
    }

    setPending(true);
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
        router.push("/student");
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
      router.push("/student");
    } catch {
      setError(t("auth.errorGeneric"));
    } finally {
      setPending(false);
    }
  }

  async function handleMagic() {
    if (!email) return;
    setPending(true);
    setError(null);

    if (mockMode) {
      setMagicSent(true);
      setPending(false);
      return;
    }

    try {
      const supabase = await loadSupabase();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${location.origin}/student`,
        },
      });
      if (error) setError(t("auth.errorGeneric"));
      else setMagicSent(true);
    } catch {
      setError(t("auth.errorGeneric"));
    } finally {
      setPending(false);
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
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              marginBottom: 24,
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
              {t("brand.tagline")}
            </div>
          </div>

          <div style={{ textAlign: "center" }}>
            <Eyebrow showDot>{t("auth.title")}</Eyebrow>
            <h1
              className="title"
              style={{ fontSize: 28, marginTop: 12 }}
            >
              {t("auth.title")}
            </h1>
            <p className="subtitle">{t("auth.subtitle")}</p>
          </div>

          <form onSubmit={handleSignIn} style={{ marginTop: 24 }}>
            <label className="flex-col" style={{ gap: 6 }}>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  color: "rgb(var(--muted))",
                  textTransform: "uppercase",
                }}
              >
                {t("auth.email")}
              </span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                placeholder="you@university.edu"
              />
            </label>

            <label
              className="flex-col"
              style={{ gap: 6, marginTop: 16 }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  color: "rgb(var(--muted))",
                  textTransform: "uppercase",
                }}
              >
                {t("auth.password")}
              </span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder="••••••••"
              />
            </label>

            <AnimatePresence>
              {error && (
                <motion.div
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
              {magicSent && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  style={{
                    marginTop: 16,
                    padding: 12,
                    borderRadius: 12,
                    background: "rgba(236,253,245,0.7)",
                    color: "#047857",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {t("auth.magicSent")}
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
            <button
              type="button"
              onClick={handleMagic}
              className="btn btn-secondary btn-lg"
              style={{ width: "100%", marginTop: 12, gap: 10 }}
              disabled={pending || !email}
            >
              <SparkIcon size={16} />
              {t("auth.signInWithMagic")}
            </button>

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
          </form>
        </motion.div>
      </div>
    </div>
  );
}
