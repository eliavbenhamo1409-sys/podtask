/**
 * Create a Podtask account (username + password), or reset a password.
 * Accounts are made by admins only; there is no self sign-up.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/create-account.ts --username noa.levi --name "נועה לוי" --role student
 *
 *   ... --username dr.cohen --name "ד״ר יעל כהן" --role lecturer --course AI101
 *   ... --reset-password --username noa.levi
 *
 * Options
 *   --username      3-32 chars: a-z 0-9 . _ -  (letter or digit at both ends)
 *   --name          full name shown in the app and in lecturer reports
 *   --role          student | lecturer                         (default student)
 *   --course        course id or course code in the institution; repeatable.
 *                   Lecturers become the course's lecturer, students are enrolled.
 *   --institution   institution id                    (default: Demo sandbox)
 *   --locale        he | en                                     (default he)
 *   --password-prompt   type the password (hidden) instead of generating one.
 *                   Piped stdin works too: the first line is the password.
 *   --reset-password    set a new password for an existing --username.
 *
 * Without --password-prompt the database generates a 12-character password
 * and this script prints it ONCE. A password is never accepted as a
 * command-line argument (shell history) and never written anywhere else.
 *
 * Everything runs in one transaction in `public.admin_create_account` /
 * `public.admin_set_password` (supabase/migrations/20260519000001_username_accounts.sql),
 * callable with the service-role key only. Without the key, run the same
 * functions in the Supabase SQL editor (see supabase/functions/README.md).
 */

// Keep in sync with lib/auth/username.ts and the profiles_username_format check.
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/;

interface Options {
  values: Map<string, string[]>;
  flags: Set<string>;
}

const FLAGS = new Set(["password-prompt", "reset-password", "help"]);

function parseArgs(argv: string[]): Options {
  const values = new Map<string, string[]>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) fail(`Unexpected argument: ${a}`);
    const key = a.slice(2);
    if (key === "password" || key.startsWith("password=")) {
      fail("Passwords are not accepted on the command line. Use --password-prompt, or omit it to generate one.");
    }
    if (FLAGS.has(key)) {
      flags.add(key);
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) fail(`Missing value for --${key}`);
    values.set(key, [...(values.get(key) ?? []), next]);
    i += 1;
  }
  return { values, flags };
}

function fail(message: string): never {
  process.stderr.write(`create-account: ${message}\n`);
  process.exit(1);
}

function one(opts: Options, key: string): string | undefined {
  const v = opts.values.get(key);
  if (v && v.length > 1) fail(`--${key} given more than once`);
  return v?.[0];
}

/** Reads a password without echoing it (TTY), or the first line of piped stdin. */
function readPassword(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return new Promise((resolve, reject) => {
      let data = "";
      stdin.setEncoding("utf8");
      stdin.on("data", (chunk: string) => {
        data += chunk;
      });
      stdin.on("end", () => resolve(data.split(/\r?\n/)[0] ?? ""));
      stdin.on("error", reject);
    });
  }
  return new Promise((resolve) => {
    process.stdout.write(question);
    let value = "";
    const finish = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
      resolve(value);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") return finish();
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function promptPassword(): Promise<string> {
  const first = await readPassword("Password (8-72 characters): ");
  if (process.stdin.isTTY) {
    const again = await readPassword("Repeat password: ");
    if (again !== first) fail("Passwords do not match.");
  }
  if (first.length < 8 || Buffer.byteLength(first, "utf8") > 72) fail("Password must be 8-72 characters.");
  return first;
}

async function rpc(fn: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url) fail("Set SUPABASE_URL (https://<project-ref>.supabase.co).");
  if (!key) fail("Set SUPABASE_SERVICE_ROLE_KEY (Supabase dashboard -> Project Settings -> API keys).");
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const err = (parsed ?? {}) as { message?: string; hint?: string };
    fail(`${fn} failed (HTTP ${res.status}): ${err.message ?? text}${err.hint ? ` (${err.hint})` : ""}`);
  }
  return (parsed ?? {}) as Record<string, unknown>;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.flags.has("help") || process.argv.length <= 2) {
    process.stdout.write(
      "Usage: node scripts/create-account.ts --username <u> --name <full name> [--role student|lecturer]\n" +
        "         [--course <id|code>]... [--institution <id>] [--locale he|en] [--password-prompt]\n" +
        "       node scripts/create-account.ts --reset-password --username <u> [--password-prompt]\n" +
        "Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. See the header of this file.\n",
    );
    return;
  }

  const username = (one(opts, "username") ?? "").trim().toLowerCase();
  if (!USERNAME_PATTERN.test(username)) {
    fail("--username must be 3-32 characters: a-z, 0-9, dot, underscore, hyphen; letter or digit at both ends.");
  }
  const password = opts.flags.has("password-prompt") ? await promptPassword() : null;

  if (opts.flags.has("reset-password")) {
    const out = await rpc("admin_set_password", { p_username: username, p_password: password });
    process.stdout.write(`Password updated for ${out.username}.\n`);
    if (typeof out.generated_password === "string") {
      process.stdout.write(`New password (shown once): ${out.generated_password}\n`);
    }
    return;
  }

  const fullName = (one(opts, "name") ?? "").trim();
  if (!fullName) fail("--name is required.");
  const role = one(opts, "role") ?? "student";
  if (role !== "student" && role !== "lecturer") fail("--role must be student or lecturer.");
  const locale = one(opts, "locale") ?? "he";
  if (locale !== "he" && locale !== "en") fail("--locale must be he or en.");

  const out = await rpc("admin_create_account", {
    p_username: username,
    p_full_name: fullName,
    p_role: role,
    p_password: password,
    p_institution_id: one(opts, "institution") ?? null,
    p_courses: opts.values.get("course") ?? [],
    p_locale: locale,
  });

  const courses = Array.isArray(out.courses)
    ? (out.courses as { code?: string; name?: string }[]).map((c) => `${c.name} (${c.code})`).join(", ")
    : "";
  process.stdout.write(
    [
      `Created ${out.role} account.`,
      `  username:    ${out.username}`,
      `  name:        ${fullName}`,
      `  institution: ${out.institution_id}`,
      `  courses:     ${courses || "none"}`,
      `  sign in at:  /login${role === "lecturer" ? "?mode=lecturer" : ""} (${role === "lecturer" ? "Lecturer" : "Student"} tab)`,
    ].join("\n") + "\n",
  );
  if (typeof out.generated_password === "string") {
    process.stdout.write(`  password (shown once): ${out.generated_password}\n`);
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
