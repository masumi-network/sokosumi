import { describe, expect, it } from "vitest";

import { adminSeoAlertNotifications } from "./admin-seo-alert-notify";

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

  it("does not notify an admin again, and still notifies an admin who has no row", () => {
    const inputs = adminSeoAlertNotifications(
      [alert("a1", "critical", "task-1")],
      [ADMIN, { id: "admin-2", role: "admin" }],
      [{ userId: "admin-1", referenceId: "task-1" }],
    );
    expect(inputs.map((input) => input.userId)).toEqual(["admin-2"]);
  });
});
