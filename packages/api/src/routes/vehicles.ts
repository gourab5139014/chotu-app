import { Hono } from "hono";
import { z } from "zod";

import { err } from "../domain/errors";
import { newId } from "../domain/id";
import type { AppDeps, AppHono } from "../http/context";
import { parseJson } from "../http/validate";
import { protect } from "../middleware/protect";
import { fromCanonical, roundDistance, toCanonical } from "../units";
import type { UnitSystem, VehicleRow } from "../db/schema/types";

const FUEL_TYPES = ["gasoline", "diesel", "ev", "hybrid", "other"] as const;

export const VehicleCreateBody = z.object({
  name: z.string().trim().min(1).max(100),
  make: z.string().trim().min(1).max(100).nullable().optional(),
  model: z.string().trim().min(1).max(100).nullable().optional(),
  year: z.number().int().min(1900).max(2100).nullable().optional(),
  fuelType: z.enum(FUEL_TYPES).nullable().optional(),
  // In the caller's own unit system (FR-11.1) — miles for imperial, km for metric.
  initialOdometer: z.number().min(0),
});

export const VehicleUpdateBody = z
  .object({
    name: z.string().trim().min(1).max(100),
    make: z.string().trim().min(1).max(100).nullable(),
    model: z.string().trim().min(1).max(100).nullable(),
    year: z.number().int().min(1900).max(2100).nullable(),
    fuelType: z.enum(FUEL_TYPES).nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, {
    message: "Provide at least one field to change",
  });

function publicVehicle(v: VehicleRow, unitSystem: UnitSystem) {
  return {
    id: v.id,
    name: v.name,
    make: v.make,
    model: v.model,
    year: v.year,
    fuelType: v.fuelType,
    initialOdometerMiE3: v.initialOdometerMiE3,
    initialOdometer: roundDistance(
      fromCanonical(v.initialOdometerMiE3, unitSystem, "distance"),
    ),
    unitSystem,
    archivedAt: v.archivedAt?.toISOString() ?? null,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

/**
 * A user's own vehicles (FR-11). Ownership is enforced by a foreign key and
 * re-checked here: a vehicle the caller does not own is `404`, never `403`,
 * so a request can't be used to probe which ids exist (FR-11.6).
 */
export function vehicleRoutes(deps: AppDeps): Hono<AppHono> {
  const r = new Hono<AppHono>();
  r.use("*", ...protect(deps));

  async function loadOwned(id: string, userId: string): Promise<VehicleRow> {
    const v = await deps.repos.vehicles.findById(id);
    if (v == null || v.userId !== userId) throw err.notFound("Vehicle not found");
    return v;
  }

  // POST /vehicles
  r.post("/", async (c) => {
    const user = c.get("user")!;
    const body = await parseJson(c, VehicleCreateBody);

    const active = await deps.repos.vehicles.listForUser(user.id, {
      activeOnly: true,
    });
    if (active.some((v) => v.name === body.name)) {
      throw err.conflict("A vehicle with this name already exists.");
    }

    const row = await deps.repos.vehicles.create({
      id: newId(),
      userId: user.id,
      name: body.name,
      make: body.make ?? null,
      model: body.model ?? null,
      year: body.year ?? null,
      fuelType: body.fuelType ?? null,
      initialOdometerMiE3: toCanonical(
        body.initialOdometer,
        user.unitSystem,
        "distance",
      ),
    });
    return c.json({ vehicle: publicVehicle(row, user.unitSystem) }, 201);
  });

  // GET /vehicles — archived vehicles are hidden by default (FR-11.4).
  r.get("/", async (c) => {
    const user = c.get("user")!;
    const includeArchived = c.req.query("includeArchived") === "true";
    const vehicles = await deps.repos.vehicles.listForUser(user.id, {
      activeOnly: !includeArchived,
    });
    return c.json({
      vehicles: vehicles.map((v) => publicVehicle(v, user.unitSystem)),
    });
  });

  // GET /vehicles/:id
  r.get("/:id", async (c) => {
    const user = c.get("user")!;
    const v = await loadOwned(c.req.param("id"), user.id);
    return c.json({ vehicle: publicVehicle(v, user.unitSystem) });
  });

  // PATCH /vehicles/:id — editable fields only; the starting odometer is fixed
  // at creation (slice 9b builds the odometer-progression check on it).
  r.patch("/:id", async (c) => {
    const user = c.get("user")!;
    const v = await loadOwned(c.req.param("id"), user.id);
    const body = await parseJson(c, VehicleUpdateBody);

    if (body.name !== undefined && body.name !== v.name) {
      const active = await deps.repos.vehicles.listForUser(user.id, {
        activeOnly: true,
      });
      if (active.some((x) => x.id !== v.id && x.name === body.name)) {
        throw err.conflict("A vehicle with this name already exists.");
      }
    }

    const patch: Partial<
      Pick<VehicleRow, "name" | "make" | "model" | "year" | "fuelType">
    > = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.make !== undefined) patch.make = body.make;
    if (body.model !== undefined) patch.model = body.model;
    if (body.year !== undefined) patch.year = body.year;
    if (body.fuelType !== undefined) patch.fuelType = body.fuelType;

    const updated = await deps.repos.vehicles.update(v.id, patch);
    return c.json({ vehicle: publicVehicle(updated, user.unitSystem) });
  });

  // POST /vehicles/:id/archive (FR-11.4) — idempotent.
  r.post("/:id/archive", async (c) => {
    const user = c.get("user")!;
    const v = await loadOwned(c.req.param("id"), user.id);
    const updated =
      v.archivedAt != null
        ? v
        : await deps.repos.vehicles.update(v.id, { archivedAt: new Date() });
    return c.json({ vehicle: publicVehicle(updated, user.unitSystem) });
  });

  // POST /vehicles/:id/unarchive — idempotent.
  r.post("/:id/unarchive", async (c) => {
    const user = c.get("user")!;
    const v = await loadOwned(c.req.param("id"), user.id);
    const updated =
      v.archivedAt == null
        ? v
        : await deps.repos.vehicles.update(v.id, { archivedAt: null });
    return c.json({ vehicle: publicVehicle(updated, user.unitSystem) });
  });

  // DELETE /vehicles/:id — cascade flag reserved for FR-11.5 (fuel_entry
  // lands in slice 9; nothing can reference a vehicle yet, so delete is
  // unconditional today, and ?cascade is accepted but not yet meaningful).
  r.delete("/:id", async (c) => {
    const user = c.get("user")!;
    const v = await loadOwned(c.req.param("id"), user.id);
    await deps.repos.vehicles.delete(v.id);
    return c.body(null, 204);
  });

  return r;
}
