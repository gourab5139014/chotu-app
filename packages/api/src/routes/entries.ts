import { Hono } from "hono";
import { z } from "zod";

import {
  insertFuelEntryInTx,
  listVehicleEntriesInTx,
  updateFuelEntryInTx,
} from "../db/repositories";
import { makeUnitOfWork, runTxSteps, type Tx } from "../db/uow";
import { err } from "../domain/errors";
import { newId } from "../domain/id";
import { assertOdometerProgression } from "../domain/odometer";
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
const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;
const LIST_ORDER = "entry_date desc, created_at desc, id desc";

interface Cursor {
  entryDate: string;
  createdAt: Date;
  id: string;
}

function encodeCursor(e: FuelEntryRow): string {
  return Buffer.from(
    JSON.stringify({
      entryDate: e.entryDate,
      createdAt: e.createdAt.toISOString(),
      id: e.id,
    }),
  ).toString("base64url");
}

function decodeCursor(raw: string): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw err.validation("Malformed cursor");
  }
  const p = parsed as Record<string, unknown>;
  if (
    typeof p["entryDate"] !== "string" ||
    typeof p["createdAt"] !== "string" ||
    typeof p["id"] !== "string"
  ) {
    throw err.validation("Malformed cursor");
  }
  const createdAt = new Date(p["createdAt"]);
  if (Number.isNaN(createdAt.getTime())) throw err.validation("Malformed cursor");
  return { entryDate: p["entryDate"], createdAt, id: p["id"] };
}

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

/** INV-3: no create or update of an entry on an archived vehicle (FR-13.5). */
function assertVehicleWritable(vehicle: VehicleRow): void {
  if (vehicle.archivedAt != null) {
    throw err.conflict(
      "This vehicle is archived and does not take fuel entry changes.",
    );
  }
}

/** `YYYY-MM-DD` for "now" in the given IANA zone. */
function todayInZone(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** INV-4: entry_date is at most two days ahead of today in the user's tz (FR-13.4). */
function assertEntryDateWithinWindow(entryDate: string, timeZone: string): void {
  const [y, m, d] = todayInZone(timeZone).split("-").map(Number);
  const max = new Date(Date.UTC(y!, m! - 1, d! + 2)).toISOString().slice(0, 10);
  if (entryDate > max) {
    throw err.validation(
      "Entry date is more than two days ahead of today in your time zone.",
    );
  }
}

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

  /**
   * A `runTxSteps` step (under the vehicle row lock) that reads the vehicle's
   * entries and throws `odometer_decrease` if `candidate` would break INV-2.
   */
  function guardOdometer(
    vehicleId: string,
    initialOdometerMiE3: number,
    candidate: Parameters<typeof assertOdometerProgression>[2],
    mode: "create" | "update",
  ) {
    return (tx: Tx): unknown => {
      const listed = listVehicleEntriesInTx(tx, vehicleId);
      if (Array.isArray(listed)) {
        assertOdometerProgression(listed, initialOdometerMiE3, candidate, mode);
        return undefined;
      }
      return listed.then((entries) =>
        assertOdometerProgression(entries, initialOdometerMiE3, candidate, mode),
      );
    };
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
    assertVehicleWritable(vehicle);
    assertEntryDateWithinWindow(body.entryDate, user.timeZone);
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

    // INV-2 (FR-13.3): the guard reads the vehicle's entries and the write
    // both run inside one uow holding the vehicle row lock, so two concurrent
    // writers cannot both pass and then both commit (FR-13.7).
    await runTxSteps(uow, { vehicleId: vehicle.id }, [
      guardOdometer(
        vehicle.id,
        vehicle.initialOdometerMiE3,
        {
          id: row.id,
          entryDate: row.entryDate,
          createdAt: row.createdAt,
          odometerMiE3: row.odometerMiE3,
        },
        "create",
      ),
      (tx) => insertFuelEntryInTx(tx, row),
    ]);

    return c.json(
      { entry: publicEntry(row, user.unitSystem, precision) },
      201,
    );
  });

  // GET /vehicles/:vehicleId/entries — history (FR-12.2, FR-14).
  r.get("/vehicles/:vehicleId/entries", ...guard, async (c) => {
    const user = c.get("user")!;
    const vehicle = await loadOwnedVehicle(c.req.param("vehicleId"), user.id);

    const rawLimit = c.req.query("limit");
    const limit =
      rawLimit == null
        ? DEFAULT_PAGE
        : Math.min(Math.max(Number.parseInt(rawLimit, 10) || 0, 1), MAX_PAGE);
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (from != null && !DATE_RE.test(from)) {
      throw err.validation("`from` must be YYYY-MM-DD");
    }
    if (to != null && !DATE_RE.test(to)) {
      throw err.validation("`to` must be YYYY-MM-DD");
    }
    const rawCursor = c.req.query("cursor");
    const cursor = rawCursor != null ? decodeCursor(rawCursor) : undefined;
    const precision = await precisionForDeployment();

    // Fetch one extra to know whether another page follows.
    const rows = await deps.repos.fuelEntries.listForVehicle(vehicle.id, {
      limit: limit + 1,
      ...(from != null ? { from } : {}),
      ...(to != null ? { to } : {}),
      ...(cursor != null ? { cursor } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    return c.json({
      entries: page.map((e) => publicEntry(e, user.unitSystem, precision)),
      page: {
        limit,
        order: LIST_ORDER,
        filter: { from: from ?? null, to: to ?? null },
        nextCursor: hasMore && last != null ? encodeCursor(last) : null,
      },
    });
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
    const { entry, vehicle } = await loadOwnedEntry(c.req.param("id"), user.id);
    const body = await parseJson(c, EntryUpdateBody);
    assertVehicleWritable(vehicle);
    if (body.entryDate !== undefined) {
      assertEntryDateWithinWindow(body.entryDate, user.timeZone);
    }
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

    // INV-2: re-check the sequence with the updated position and odometer,
    // under the vehicle row lock (FR-13.3, FR-13.7).
    const candidate = {
      id: entry.id,
      entryDate: patch.entryDate ?? entry.entryDate,
      createdAt: entry.createdAt,
      odometerMiE3: patch.odometerMiE3 ?? entry.odometerMiE3,
    };
    await runTxSteps(uow, { vehicleId: entry.vehicleId }, [
      guardOdometer(entry.vehicleId, vehicle.initialOdometerMiE3, candidate, "update"),
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
