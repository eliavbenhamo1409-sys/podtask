"use client";

import { useState } from "react";
import { useRouter } from "@/lib/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { MOCK_MODE } from "@/lib/env";

export function LogoutButton({ label }: { label: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    setPending(true);
    try {
      if (!MOCK_MODE) {
        await createClient().auth.signOut();
      }
    } catch {
      // Fall through: the login screen clears any stale session cookie.
    } finally {
      router.push("/login");
    }
  }

  return (
    <button
      type="button"
      className="btn btn-secondary"
      onClick={() => void handleLogout()}
      disabled={pending}
    >
      {label}
    </button>
  );
}
