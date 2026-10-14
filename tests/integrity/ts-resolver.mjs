import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

async function exists(url) {
  try {
    await access(fileURLToPath(url));
    return true;
  } catch {
    return false;
  }
}

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[a-z]+$/i.test(specifier)) {
    const base = context.parentURL ?? import.meta.url;
    for (const ext of [".ts", ".tsx", ".mts"]) {
      const candidate = new URL(specifier + ext, base).href;
      if (await exists(candidate)) return nextResolve(candidate, context);
    }
  }
  return nextResolve(specifier, context);
}
