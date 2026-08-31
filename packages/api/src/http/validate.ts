import type { Context } from "hono";
import type { z } from "zod";

import { err } from "../domain/errors";

/** Parse and validate a JSON request body, or throw a `validation_error`. */
export async function parseJson<S extends z.ZodTypeAny>(
  c: Context,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw err.validation("Request body must be JSON");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw err.validation("Invalid request body", result.error.issues);
  }
  // safeParse's `.data` is typed `any` under a generic bound; it is exactly
  // `z.infer<S>` at runtime.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return result.data;
}
