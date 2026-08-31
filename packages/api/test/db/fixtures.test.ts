import { expect, it } from "vitest";

import { makeRepos } from "../../src/db/repositories";
import { describeEachAdapter } from "../support/adapters";
import { clean, loadClean } from "../support/fixtures";

describeEachAdapter("fixture: clean", (ctx) => {
  it("seeds the settings singleton, one admin, and two users, verbatim", async () => {
    await loadClean(ctx().handle);
    const repos = makeRepos(ctx().handle);

    const settings = await repos.settings.get();
    expect(settings?.deploymentName).toBe("Clean Fixture");

    const users = await repos.users.list();
    expect(users.map((u) => u.email).sort()).toEqual([
      "admin@example.com",
      "alice@example.com",
      "bob@example.com",
    ]);
    expect(await repos.users.countActiveAdmins()).toBe(1);

    const admin = await repos.users.findByEmail("admin@example.com");
    expect(admin?.createdAt).toEqual(clean.admin.createdAt);
    expect(admin?.emailVerifiedAt).toEqual(clean.admin.emailVerifiedAt);
    expect(admin?.role).toBe("admin");
  });
});
