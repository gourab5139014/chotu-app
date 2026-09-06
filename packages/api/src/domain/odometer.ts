import type { FuelEntryRow } from "../db/schema/types";

import { err } from "./errors";

export interface OdometerCandidate {
  id: string;
  entryDate: string;
  createdAt: Date;
  odometerMiE3: number;
}

type Orderable = Pick<FuelEntryRow, "entryDate" | "createdAt" | "id">;

/** The INV-2 ordering: entry_date, then created_at, then id. */
export function compareEntryOrder(a: Orderable, b: Orderable): number {
  if (a.entryDate !== b.entryDate) return a.entryDate < b.entryDate ? -1 : 1;
  const at = a.createdAt.getTime();
  const bt = b.createdAt.getTime();
  if (at !== bt) return at - bt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * INV-2 / FR-13.3. `existing` is every entry already stored for the vehicle.
 * Project `candidate` into that ordered sequence (replacing itself on an
 * update) and throw `odometer_decrease` if any adjacent pair would decrease,
 * or if the earliest entry would fall below the vehicle's starting odometer.
 * An adjacent tie is allowed — the write succeeds and reconciliation flags it.
 */
export function assertOdometerProgression(
  existing: FuelEntryRow[],
  initialOdometerMiE3: number,
  candidate: OdometerCandidate,
  mode: "create" | "update",
): void {
  const base =
    mode === "update"
      ? existing.filter((e) => e.id !== candidate.id)
      : existing;
  const sequence = [...base, candidate].sort(compareEntryOrder);
  let prev = initialOdometerMiE3;
  for (const e of sequence) {
    if (e.odometerMiE3 < prev) throw err.odometerDecrease();
    prev = e.odometerMiE3;
  }
}
