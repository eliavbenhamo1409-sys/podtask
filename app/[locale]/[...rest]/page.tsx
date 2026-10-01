import { notFound } from "next/navigation";

/**
 * Catch-all under the locale segment so unknown URLs render the branded
 * `app/[locale]/not-found.tsx` instead of Next's default 404 page.
 */
export default function CatchAllPage() {
  notFound();
}
