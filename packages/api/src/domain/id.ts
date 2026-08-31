import { uuidv7 } from "uuidv7";

/** Application-generated UUID v7 — time-ordered, for stable pagination. */
export function newId(): string {
  return uuidv7();
}
