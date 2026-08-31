import { describe, expect, it } from "vitest";

import { verifyPassword } from "../../src/auth/password";
import { hashToken } from "../../src/auth/tokens";
import {
  AlreadySeededError,
  bootstrapSchema,
  seedDeployment,
  SEEDED_ADMIN_EMAIL,
} from "../../src/db/bootstrap";
import { makeRepos } from "../../src/db/repositories";
import type { DbHandle } from "../../src/db/index";
import { openRawPostgres } from "../support/postgres";
import { openRawSqlite } from "../support/sqlite";

const url = process.env["DATABASE_URL"];
const hasPg = typeof url === "string" && url.startsWith("postgres");
const adapters: Array<"sqlite" | "postgres"> = hasPg
  ? ["sqlite", "postgres"]
  : ["sqlite"];

async function withMigrated(
  name: "sqlite" | "postgres",
  fn: (handle: DbHandle) => Promise<void>,
): Promise<void> {
  const mig =
    name === "postgres" ? await openRawPostgres(url as string) : openRawSqlite();
  try {
    await bootstrapSchema(mig.handle, { build: "seed-test" });
    await fn(mig.handle);
  } finally {
    await mig.cleanup();
  }
}

for (const name of adapters) {
  describe(`seedDeployment [${name}]`, () => {
    it("email + password: usable admin, no set-password link", async () => {
      await withMigrated(name, async (handle) => {
        const res = await seedDeployment(handle, {
          admin: { email: "admin@corp.example", password: "correct horse 12" },
        });
        const repos = makeRepos(handle);

        const admin = await repos.users.findByEmail("admin@corp.example");
        expect(admin?.role).toBe("admin");
        expect(admin?.status).toBe("active");
        expect(admin?.mustChangePassword).toBe(false);
        expect(
          await verifyPassword(admin!.passwordHash!, "correct horse 12"),
        ).toBe(true);

        expect(res.setPasswordToken).toBeUndefined();
        expect(res.apiToken.startsWith("cht_")).toBe(true);
        expect(
          (await repos.apiTokens.findByHash(hashToken(res.apiToken)))?.userId,
        ).toBe(admin?.id);
        expect((await repos.settings.get())?.deploymentName).toBe("Chotu");
      });
    });

    it("email only: no password, one-time set-password link issued", async () => {
      await withMigrated(name, async (handle) => {
        const res = await seedDeployment(handle, {
          admin: { email: "admin2@corp.example" },
        });
        const repos = makeRepos(handle);
        const admin = await repos.users.findByEmail("admin2@corp.example");

        expect(admin?.passwordHash).toBeNull();
        expect(admin?.mustChangePassword).toBe(false);
        expect(res.setPasswordToken).toBeTypeOf("string");

        const link = res.setPasswordToken as string;
        const tok = await repos.userTokens.findByHash(hashToken(link));
        expect(tok?.purpose).toBe("set_password");
        expect(tok?.userId).toBe(admin?.id);
      });
    });

    it("seedDefault: scott/tiger, must change password, warns", async () => {
      await withMigrated(name, async (handle) => {
        const res = await seedDeployment(handle, {
          admin: { seedDefault: true },
        });
        const repos = makeRepos(handle);
        const admin = await repos.users.findByEmail(SEEDED_ADMIN_EMAIL);

        expect(admin?.mustChangePassword).toBe(true);
        expect(await verifyPassword(admin!.passwordHash!, "tiger")).toBe(true);
        expect(res.warnings.join(" ")).toMatch(/default admin/i);
        expect(res.warnings.join(" ")).toMatch(/production traffic/i);
      });
    });

    it("is not idempotent: a second seed throws AlreadySeededError", async () => {
      await withMigrated(name, async (handle) => {
        await seedDeployment(handle, { admin: { seedDefault: true } });
        await expect(
          seedDeployment(handle, { admin: { seedDefault: true } }),
        ).rejects.toBeInstanceOf(AlreadySeededError);
      });
    });
  });
}
