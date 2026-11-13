import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { superviseRunner } from "./supervise";

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
  child.stderr = new EventEmitter();
  return child;
}

async function run(
  end: (child: ReturnType<typeof fakeChild>) => void,
  report = vi.fn().mockResolvedValue(undefined),
) {
  const child = fakeChild();
  const exit = superviseRunner(child as never, report);
  end(child);
  return { code: await exit, report };
}

describe("superviseRunner", () => {
  it("reports nothing when the runner ends cleanly", async () => {
    const { code, report } = await run((child) => child.emit("close", 0, null));
    expect(code).toBe(0);
    expect(report).not.toHaveBeenCalled();
  });

  it("reports a crash with the end of what the runner printed", async () => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const { code, report } = await run((child) => {
      child.stderr.emit("data", Buffer.from("TypeError: boom\n    at main"));
      child.emit("close", 1, null);
    });
    expect(code).toBe(1);
    expect(report).toHaveBeenCalledWith({
      code: "runner_exited",
      message:
        "The runner ended with exit code 1: TypeError: boom\n    at main",
    });
  });

  it("reports a killed runner and survives Core refusing the report", async () => {
    const { code, report } = await run(
      (child) => child.emit("close", null, "SIGKILL"),
      vi.fn().mockRejectedValue(new Error("turn is not active")),
    );
    expect(code).toBe(1);
    expect(report).toHaveBeenCalledWith({
      code: "runner_exited",
      message: "The runner ended with signal SIGKILL",
    });
  });
});
