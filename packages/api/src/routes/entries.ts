import { Hono } from "hono";
import { z } from "zod";

import { insertFuelEntryInTx, updateFuelEntryInTx } from "../db/repositories";
import { makeUnitOfWork, runTxSteps } from "../db/uow";
import { err } from "../domain/errors";
import { newId } from "../domain/id";
import type { AppDeps, AppHono } from "../http/context";
import { parseJson } from "../http/validate";
import { protect } from "../middleware/protect";
import {
  formatPrice,
  fromCanonical,
  roundDistance,
  roundVolume,
  toCanonical,
} from "../units";
import type { FuelEntryRow, UnitSystem, VehicleRow } from "../db/schema/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// `volume > 0` (FR-13.1) is a refine, not a field bound: zod-to-json-schema
// renders `.gt(0)` / `.positive()` as a boolean `exclusiveMinimum`, which is
// not valid OpenAPI 3.
export const EntryCreateBody = z
  .object({
    entryDate: z.string().regex(DATE_RE, { message: "Expected YYYY-MM-DD" }),
    odometer: z.number().min(0),
    volume: z.number(),
    totalCost: z.number().min(0),
    isFullTank: z.boolean().default(true),
    notes: z.string().max(1000).nullable().optional(),
  })
  .refine((b) => b.volume > 0, {
    message: "volume must be greater than zero",
    path: ["volume"],
  });

export const EntryUpdateBody = z
  .object({
    entryDate: z.string().regex(DATE_RE, { message: "Expected YYYY-MM-DD" }),
    odometer: z.number().min(0),
    volume: z.number(),
    totalCost: z.number().min(0),
    isFullTank: z.boolean(),
    notes: z.string().max(1000).nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, {
    message: "Provide at least one field to change",
  })
  .refine((b) => b.volume === undefined || b.volume > 0, {
    message: "volume must be greater than zero",
    path: ["volume"],
  });

/** Canonical values plus the display projection in the caller's units (FR-15.3). */
function publicEntry(e: FuelEntryRow, unitSystem: UnitSystem, precision: number) {
  const volume = roundVolume(
    fromCanonical(e.volumeGalE3, unitSystem, "volume"),
    precision,
  );
  const totalCost = e.totalCostUsdCents / 100;
  return {
    id: e.id,
    vehicleId: e.vehicleId,
    entryDate: e.entryDate,
    isFullTank: e.isFullTank,
    notes: e.notes,
    currencyCode: e.currencyCode,
    // Canonical (D-1).
    odometerMiE3: e.odometerMiE3,
    volumeGalE3: e.volumeGalE3,
    totalCostUsdCents: e.totalCostUsdCents,
    // Display projection.
    unitSystem,
    odometer: roundDistance(
      fromCanonical(e.odometerMiE3, unitSystem, "distance"),
    ),
    volume,
    totalCost,
    totalCostFormatted: formatPrice(e.totalCostUsdCents),
    // Derived price per display volume unit, at the same precision (FR-15.6).
    pricePerVolume: volume > 0 ? roundVolume(totalCost / volume, precision) : null,
    sourceUnitSystem: e.sourceUnitSystem,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

/**
 * Fuel entries (FR-12). Create and list hang off a vehicle; get / update /
 * delete are addressed by entry id. Every path re-checks the ownership chain
 * entry -> vehicle -> user and returns `404`, never `403`, for a mismatch
 * (FR-12.6, INV-1).
 */
export function entryRoutes(deps: AppDeps): Hono<AppHono> {
  const r = new Hono<AppHono>();
  // Mounted at "/", so `protect` is applied per-route, not with r.use("*"),
  // which would also gate the other "/"-mounted public routes.
  const guard = protect(deps);
  const uow = makeUnitOfWork(deps.handle);

  async function precisionForDeployment(): Promise<number> {
    return (await deps.repos.settings.get())?.fuelVolumePrecision ?? 3;
  }

  async function loadOwnedVehicle(
    vehicleId: string,
    userId: string,
  ): Promise<VehicleRow> {
    const v = await deps.repos.vehicles.findById(vehicleId);
    if (v == null || v.userId !== userId) throw err.notFound("Vehicle not found");
    return v;
  }

  async function loadOwnedEntry(
    id: string,
    userId: string,
  ): Promise<{ entry: FuelEntryRow; vehicle: VehicleRow }> {
    const entry = await deps.repos.fuelEntries.findById(id);
    if (entry == null) throw err.notFound("Entry not found");
    const vehicle = await deps.repos.vehicles.findById(entry.vehicleId);
    if (vehicle == null || vehicle.userId !== userId) {
      throw err.notFound("Entry not found");
    }
    return { entry, vehicle };
  }

  // POST /vehicles/:vehicleId/entries (FR-12.1)
  r.post("/vehicles/:vehicleId/entries", ...guard, async (c) => {
    const user = c.get("user")!;
    const vehicle = await loadOwnedVehicle(c.req.param("vehicleId"), user.id);
    const body = await parseJson(c, EntryCreateBody);
    const precision = await precisionForDeployment();

    const now = new Date();
    const row: FuelEntryRow = {
      id: newId(),
      vehicleId: vehicle.id,
      entryDate: body.entryDate,
      odometerMiE3: toCanonical(body.odometer, user.unitSystem, "distance"),
      volumeGalE3: toCanonical(body.volume, user.unitSystem, "volume"),
      totalCostUsdCents: toCanonical(body.totalCost, user.unitSystem, "money"),
      currencyCode: "USD",
      isFullTank: body.isFullTank,
      notes: body.notes ?? null,
      sourceUnitSystem: user.unitSystem,
      sourcePayload: {
        entryDate: body.entryDate,
        odometer: body.odometer,
        volume: body.volume,
        totalCost: body.totalCost,
        isFullTank: body.isFullTank,
        notes: body.notes ?? null,
        unitSystem: user.unitSystem,
      },
      createdAt: now,
      updatedAt: now,
    };

    // The vehicle lock and the INV checks (INV-2 / INV-3 / INV-4) land in
    // T9a.3 and T9b; the write already runs under the lock so those become
    // extra steps, not a rewrite.
    await runTxSteps(uow, { vehicleId: vehicle.id }, [
      (tx) => insertFuelEntryInTx(tx, row),
    ]);

    return c.json(
      { entry: publicEntry(row, user.unitSystem, precision) },
      201,
    );
  });

  // GET /entries/:id (FR-12.3)
  r.get("/entries/:id", ...guard, async (c) => {
    const user = c.get("user")!;
    const { entry } = await loadOwnedEntry(c.req.param("id"), user.id);
    const precision = await precisionForDeployment();
    return c.json({ entry: publicEntry(entry, user.unitSystem, precision) });
  });

  // PATCH /entries/:id (FR-12.4)
  r.patch("/entries/:id", ...guard, async (c) => {
    const user = c.get("user")!;
    const { entry } = await loadOwnedEntry(c.req.param("id"), user.id);
    const body = await parseJson(c, EntryUpdateBody);
    const precision = await precisionForDeployment();

    const patch: Partial<
      Pick<
        FuelEntryRow,
        | "entryDate"
        | "odometerMiE3"
        | "volumeGalE3"
        | "totalCostUsdCents"
        | "isFullTank"
        | "notes"
        | "sourcePayload"
      >
    > = {};
    if (body.entryDate !== undefined) patch.entryDate = body.entryDate;
    if (body.odometer !== undefined) {
      patch.odometerMiE3 = toCanonical(body.odometer, user.unitSystem, "distance");
    }
    if (body.volume !== undefined) {
      patch.volumeGalE3 = toCanonical(body.volume, user.unitSystem, "volume");
    }
    if (body.totalCost !== undefined) {
      patch.totalCostUsdCents = toCanonical(
        body.totalCost,
        user.unitSystem,
        "money",
      );
    }
    if (body.isFullTank !== undefined) patch.isFullTank = body.isFullTank;
    if (body.notes !== undefined) patch.notes = body.notes;

    // Record the latest submission alongside the create-time source system.
    patch.sourcePayload = {
      ...entry.sourcePayload,
      lastUpdate: {
        ...body,
        unitSystem: user.unitSystem,
        at: new Date().toISOString(),
      },
    };

    await runTxSteps(uow, { vehicleId: entry.vehicleId }, [
      (tx) => updateFuelEntryInTx(tx, entry.id, patch),
    ]);

    const updated = await deps.repos.fuelEntries.findById(entry.id);
    return c.json({ entry: publicEntry(updated!, user.unitSystem, precision) });
  });

  // DELETE /entries/:id (FR-12.5)
  r.delete("/entries/:id", ...guard, async (c) => {
    const user = c.get("user")!;
    const { entry } = await loadOwnedEntry(c.req.param("id"), user.id);
    await deps.repos.fuelEntries.delete(entry.id);
    return c.body(null, 204);
  });

  return r;
}
