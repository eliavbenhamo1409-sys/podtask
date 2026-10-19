/**
 * Username accounts. Admins create every student and lecturer account with a
 * username and a password (supabase/migrations/20260519000001_username_accounts.sql,
 * `public.admin_create_account`). Supabase Auth signs in by e-mail, so each
 * username account carries a synthetic auth e-mail on a domain that never
 * receives mail; the login screen derives it from the username, so no lookup
 * is needed before sign-in.
 *
 * Keep USERNAME_PATTERN in sync with the `profiles_username_format` check.
 */

export const USERNAME_EMAIL_DOMAIN = "users.podtask.app";

/** 3-32 characters: a-z, 0-9, dot, underscore, hyphen; letter or digit at both ends. */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidUsername(raw: string): boolean {
  return USERNAME_PATTERN.test(normalizeUsername(raw));
}

/**
 * The auth e-mail to sign in with. A username maps to its synthetic address;
 * an e-mail (accounts created before usernames) is used as typed. Null when
 * the input is neither, so the caller can answer "invalid credentials"
 * without a network round trip.
 */
export function signInEmailFor(identifier: string): string | null {
  const value = normalizeUsername(identifier);
  if (value.includes("@")) return value;
  return USERNAME_PATTERN.test(value) ? `${value}@${USERNAME_EMAIL_DOMAIN}` : null;
}

export function isUsernameEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${USERNAME_EMAIL_DOMAIN}`);
}

/** What to show for an account: the username for username accounts, else the e-mail. */
export function accountLabel(email: string): string {
  return isUsernameEmail(email) ? email.slice(0, email.lastIndexOf("@")) : email;
}
