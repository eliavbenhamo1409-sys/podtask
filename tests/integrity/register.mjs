// Resolve hook so Node can run the app's extension-less TypeScript imports
// (`import { x } from "./types"`) with its built-in type stripping.
// Usage: node --experimental-transform-types --import ./tests/integrity/register.mjs --test "tests/integrity/*.test.ts"
import { register } from "node:module";
import { pathToFileURL } from "node:url";
register(pathToFileURL("./tests/integrity/ts-resolver.mjs"));
