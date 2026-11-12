import type { PipelineResult } from "@/lib/imports/pipeline";

export type ImportFormState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  result?: PipelineResult;
};

export const INITIAL_IMPORT_STATE: ImportFormState = { status: "idle" };
