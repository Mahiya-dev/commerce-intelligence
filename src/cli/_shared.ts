import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Loads environment variables for CLI commands from .env files in the current
 * directory (later files do not override earlier ones or the real env).
 * On cPanel, put a .env file next to server.js (outside public_html).
 */
export function loadEnv(): void {
  for (const file of [".env.local", ".env"]) {
    const path = resolve(process.cwd(), file);
    if (existsSync(path)) {
      // Node >= 20.12. Does not override variables that are already set.
      process.loadEnvFile(path);
    }
  }
}

export function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}
