// Bundles src/cli/*.ts into self-contained CommonJS files in dist/cli/ so the
// tools run on any cPanel Node.js (>= 20.12) without TypeScript tooling.
import { build } from "esbuild";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const entryPoints = readdirSync("src/cli")
  .filter((f) => f.endsWith(".ts") && !f.startsWith("_"))
  .map((f) => `src/cli/${f}`);

await build({
  entryPoints,
  outdir: "dist/cli",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: false,
  legalComments: "none",
  logLevel: "warning",
  tsconfig: "tsconfig.json",
  alias: { "server-only": fileURLToPath(new URL("../tests/stubs/server-only.ts", import.meta.url)) },
});
console.log(`✓ CLI dibundel: ${entryPoints.map((e) => e.replace("src/cli/", "")).join(", ")} → dist/cli/`);
