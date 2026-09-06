import { Hono } from "hono";

import type { AppDeps, AppHono } from "../http/context";
import { protect } from "../middleware/protect";
import { runReconcile } from "../reconcile";

/**
 * `GET /reconcile` (FR-17.1) — read-only checks over the caller's own data.
 * The full findings, each with a value-free message. The deployment-wide
 * admin run is `GET /admin/reconcile` in routes/admin.ts (FR-17.2).
 */
export function reconcileRoutes(deps: AppDeps): Hono<AppHono> {
  const r = new Hono<AppHono>();
  r.use("*", ...protect(deps));

  r.get("/", async (c) => {
    const user = c.get("user")!;
    const [vehicles, entries, settings] = await Promise.all([
      deps.repos.vehicles.listForUser(user.id),
      deps.repos.fuelEntries.listForUser(user.id),
      deps.repos.settings.get(),
    ]);

    const findings = runReconcile({
      vehicles,
      entries,
      fuelVolumePrecision: settings?.fuelVolumePrecision ?? 3,
    });

    return c.json({
      findings: findings.map((f) => ({
        recordType: f.recordType,
        recordId: f.recordId,
        vehicleId: f.vehicleId,
        checkCode: f.checkCode,
        message: f.message,
      })),
    });
  });

  return r;
}
