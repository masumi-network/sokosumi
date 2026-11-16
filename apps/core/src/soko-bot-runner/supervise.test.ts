import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { superviseRunner } from "./supervise";

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
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

  it("reports a runner that could not be started, once", async () => {
    const { code, report } = await run((child) => {
      child.emit("error", new Error("spawn EAGAIN"));
      child.emit("close", null, null);
    });
    expect(code).toBe(1);
    expect(report).toHaveBeenCalledExactlyOnceWith({
      code: "runner_exited",
      message: "The runner ended with an error: spawn EAGAIN",
    });
  });

  it("passes a stop signal on to the runner", async () => {
    const { report } = await run((child) => {
      process.emit("SIGTERM", "SIGTERM");
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      child.emit("close", null, "SIGTERM");
    });
    expect(report).toHaveBeenCalledOnce();
    expect(process.listenerCount("SIGTERM")).toBe(0);
  });
});
