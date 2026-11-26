import { describe, expect, it } from "vitest";

import {
  ADMIN_SEO_ALERT_MAX_PAGES,
  adminSeoAlertNotifications,
  readAdminSeoAlerts,
} from "./admin-seo-alert-notify";

const alert = (
  id: string,
  severity: "critical" | "warning" | "info",
  taskId: string | null = null,
) => ({ id, severity, taskId });
const ADMIN = { id: "admin-1", role: "user,admin" };

describe("adminSeoAlertNotifications", () => {
  it("notifies an admin about critical alerts only, keyed by the Task when there is one", () => {
    const inputs = adminSeoAlertNotifications(
      [
        alert("a1", "critical", "task-1"),
        alert("a2", "warning", "task-2"),
        alert("a3", "critical"),
      ],
      [ADMIN],
      [],
    );
    expect(
      inputs.map((input) => [input.userId, input.referenceId, input.eventId]),
    ).toEqual([
      ["admin-1", "task-1", "task-1"],
      ["admin-1", "a3", "a3"],
    ]);
    expect(inputs[0]).toMatchObject({
      kind: "SYSTEM",
      messageKey: "Notifications.System.seoAdminCritical",
    });
  });

  it("sends one notification for two critical alerts of the same Task", () => {
    expect(
      adminSeoAlertNotifications(
        [alert("a1", "critical", "task-1"), alert("a2", "critical", "task-1")],
        [ADMIN],
        [],
      ),
    ).toHaveLength(1);
  });

  it("skips a user whose role only contains the word admin", () => {
    expect(
      adminSeoAlertNotifications(
        [alert("a1", "critical")],
        [
          { id: "u1", role: "user" },
          { id: "u2", role: "subadmin" },
          { id: "u3", role: null },
        ],
        [],
      ),
    ).toEqual([]);
  });

  it("notifies an admin whose ban has ended, not one who is still banned", () => {
    const now = new Date("2026-11-25T12:00:00.000Z");
    const inputs = adminSeoAlertNotifications(
      [alert("a1", "critical")],
      [
        { ...ADMIN, banned: true, banExpires: new Date("2026-11-24") },
        { id: "admin-2", role: "Admin", banned: true, banExpires: null },
      ],
      [],
      now,
    );
    expect(inputs.map((input) => input.userId)).toEqual(["admin-1"]);
  });

  it("does not notify an admin again, and still notifies an admin who has no row", () => {
    const inputs = adminSeoAlertNotifications(
      [alert("a1", "critical", "task-1")],
      [ADMIN, { id: "admin-2", role: "admin" }],
      [{ userId: "admin-1", referenceId: "task-1" }],
    );
    expect(inputs.map((input) => input.userId)).toEqual(["admin-2"]);
  });
});

describe("readAdminSeoAlerts", () => {
  const NOW = new Date("2026-11-25T12:00:00.000Z");
  const at = (hoursAgo: number) =>
    new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();
  const row = (
    id: string,
    hoursAgo: number,
    severity: "critical" | "warning" = "critical",
  ) => ({ id, taskId: null, severity, at: at(hoursAgo) });
  /** Serves the rows 25 to a page, as the list does, and records the pages asked for. */
  const pagesOf = (rows: ReturnType<typeof row>[]) => {
    const asked: number[] = [];
    const readPage = async (page: number) => {
      asked.push(page);
      return {
        critical: rows.filter((item) => item.severity === "critical").length,
        items: rows.slice((page - 1) * 25, page * 25),
      };
    };
    return { asked, readPage };
  };
  const rows = (count: number, hoursAgo = 1) =>
    Array.from({ length: count }, (_, index) => row(`a${index}`, hoursAgo));

  it("reads the 26th critical alert, on the second page", async () => {
    const { asked, readPage } = pagesOf(rows(26));
    const result = await readAdminSeoAlerts(readPage, NOW);
    expect(result.alerts.map((alert) => alert.id)).toContain("a25");
    expect(result).toMatchObject({ critical: 26, capped: false, old: 0 });
    expect(asked).toEqual([1, 2]);
  });

  it("stops at the page limit and says the read was cut", async () => {
    const { asked, readPage } = pagesOf(
      rows(25 * ADMIN_SEO_ALERT_MAX_PAGES + 5),
    );
    const result = await readAdminSeoAlerts(readPage, NOW);
    expect(result.alerts).toHaveLength(25 * ADMIN_SEO_ALERT_MAX_PAGES);
    expect(result.capped).toBe(true);
    expect(asked).toHaveLength(ADMIN_SEO_ALERT_MAX_PAGES);
  });

  it("does not say the read was cut when the last allowed page holds the last alert", async () => {
    const { readPage } = pagesOf(rows(25 * ADMIN_SEO_ALERT_MAX_PAGES));
    expect((await readAdminSeoAlerts(readPage, NOW)).capped).toBe(false);
  });

  it("reads no further page after the sync deadline and says the read was cut", async () => {
    const { asked, readPage } = pagesOf(rows(60));
    const result = await readAdminSeoAlerts(readPage, NOW, () => false);
    expect(asked).toEqual([1]);
    expect(result).toMatchObject({ capped: true });
    expect(result.alerts).toHaveLength(25);
  });

  it("does not say the read was cut when the last allowed page is short", async () => {
    const { readPage } = pagesOf(rows(25 * ADMIN_SEO_ALERT_MAX_PAGES - 1));
    expect((await readAdminSeoAlerts(readPage, NOW)).capped).toBe(false);
  });

  it("skips and counts a critical alert older than 24 hours", async () => {
    const { readPage } = pagesOf([row("new", 23), row("old", 25)]);
    const result = await readAdminSeoAlerts(readPage, NOW);
    expect(result.alerts.map((alert) => alert.id)).toEqual(["new"]);
    expect(result).toMatchObject({ critical: 2, old: 1 });
  });

  it("does not read a second page when the first one ends with an old or a warning alert", async () => {
    const old = pagesOf([...rows(24), ...rows(6, 30)]);
    expect(await readAdminSeoAlerts(old.readPage, NOW)).toMatchObject({
      critical: 30,
      old: 6,
    });
    expect(old.asked).toEqual([1]);
    const warning = pagesOf([
      ...rows(24),
      ...Array.from({ length: 6 }, () => row("w", 1, "warning")),
    ]);
    expect(
      (await readAdminSeoAlerts(warning.readPage, NOW)).alerts,
    ).toHaveLength(24);
    expect(warning.asked).toEqual([1]);
  });
});
