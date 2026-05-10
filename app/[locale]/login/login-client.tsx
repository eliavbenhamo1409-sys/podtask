"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "@/lib/i18n/navigation";
import { Blobs } from "@/components/podtask/blobs";
import { BrandMark } from "@/components/podtask/brand-mark";
import { Eyebrow } from "@/components/podtask/eyebrow";
import { ArrowIcon, SparkIcon } from "@/components/podtask/icons";
import { createClient } from "@/lib/supabase/client";

const STALE_GUEST_COOKIE_CLEAR =
  "pt_guest=; path=/; max-age=0; SameSite=Lax";

export function LoginClient() {
  const t = useTranslations();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicSent, setMagicSent] = useState(false);
  const mockMode =
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_MOCK_MODE !== "false";

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.cookie = STALE_GUEST_COOKIE_CLEAR;
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
      const supabase = createClient();
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
      const { error: anonError } = await createClient().auth.signInAnonymously({
        options: {
          data: { full_name: "Guest visitor", locale: "he" },
        },
      });
      if (anonError) {
        setError(t("auth.errorAnonymousDisabled"));
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
      const supabase = createClient();
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
                style={{
                  padding: "14px 18px",
                  borderRadius: 14,
                  border: "1px solid rgb(var(--line))",
                  background: "white",
                  fontSize: 15,
                  outline: "none",
                }}
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
                style={{
                  padding: "14px 18px",
                  borderRadius: 14,
                  border: "1px solid rgb(var(--line))",
                  background: "white",
                  fontSize: 15,
                  outline: "none",
                }}
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
