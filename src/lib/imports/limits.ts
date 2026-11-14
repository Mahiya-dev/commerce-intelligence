/**
 * Upload limits (pure module: shared by the server and the upload form).
 * Keep MAX_TOTAL_BYTES below serverActions.bodySizeLimit in next.config.ts.
 * On Vercel the platform caps a request body at 4.5 MB regardless.
 */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** One upload may carry several files (each validated and staged on its own). */
export const MAX_FILES = 10;
export const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
export const MAX_ROWS = 50_000;
