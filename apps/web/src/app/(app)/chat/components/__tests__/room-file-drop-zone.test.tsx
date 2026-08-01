import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RoomFileDropZone } from "@/app/chat/components/room-file-drop-zone";

describe("RoomFileDropZone", () => {
  it("calls onFiles when files are dropped while enabled", () => {
    const onFiles = vi.fn();
    render(
      <RoomFileDropZone enabled onFiles={onFiles} label="Drop files to attach">
        <div>room</div>
      </RoomFileDropZone>,
    );

    const zone = screen.getByText("room").parentElement;
    expect(zone).toBeTruthy();
    const file = new File(["hello"], "note.txt", { type: "text/plain" });
    fireEvent.drop(zone!, {
      dataTransfer: {
        types: ["Files"],
        files: [file],
      },
    });

    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0]?.[0]).toEqual([file]);
  });

  it("ignores drops when disabled", () => {
    const onFiles = vi.fn();
    render(
      <RoomFileDropZone
        enabled={false}
        onFiles={onFiles}
        label="Drop files to attach"
      >
        <div>room</div>
      </RoomFileDropZone>,
    );

    const zone = screen.getByText("room").parentElement;
    fireEvent.drop(zone!, {
      dataTransfer: {
        types: ["Files"],
        files: [new File(["x"], "a.txt", { type: "text/plain" })],
      },
    });

    expect(onFiles).not.toHaveBeenCalled();
  });

  it("shows overlay while dragging files", () => {
    render(
      <RoomFileDropZone enabled onFiles={vi.fn()} label="Drop files to attach">
        <div>room</div>
      </RoomFileDropZone>,
    );

    const zone = screen.getByText("room").parentElement!;
    fireEvent.dragEnter(zone, {
      dataTransfer: { types: ["Files"], files: [] },
    });

    expect(screen.getByText("Drop files to attach")).toBeInTheDocument();
  });

  it("calls onFiles when a clipboard file is pasted while enabled", () => {
    const onFiles = vi.fn();
    render(
      <RoomFileDropZone enabled onFiles={onFiles} label="Drop files to attach">
        <div>room</div>
      </RoomFileDropZone>,
    );

    const zone = screen.getByText("room").parentElement!;
    const file = new File(["img"], "paste.png", { type: "image/png" });
    fireEvent.paste(zone, {
      clipboardData: {
        items: [
          {
            kind: "file",
            getAsFile: () => file,
          },
        ],
      },
    });

    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0]?.[0]).toEqual([file]);
  });

  it("leaves text paste alone when clipboard has no file items", () => {
    const onFiles = vi.fn();
    render(
      <RoomFileDropZone enabled onFiles={onFiles} label="Drop files to attach">
        <div>room</div>
      </RoomFileDropZone>,
    );

    const zone = screen.getByText("room").parentElement!;
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        items: [
          {
            kind: "string",
            getAsFile: () => null,
          },
        ],
      },
    });

    const prevented = !zone.dispatchEvent(event);

    expect(onFiles).not.toHaveBeenCalled();
    expect(prevented).toBe(false);
  });

  it("ignores paste when disabled", () => {
    const onFiles = vi.fn();
    render(
      <RoomFileDropZone
        enabled={false}
        onFiles={onFiles}
        label="Drop files to attach"
      >
        <div>room</div>
      </RoomFileDropZone>,
    );

    const zone = screen.getByText("room").parentElement!;
    fireEvent.paste(zone, {
      clipboardData: {
        items: [
          {
            kind: "file",
            getAsFile: () =>
              new File(["img"], "paste.png", { type: "image/png" }),
          },
        ],
      },
    });

    expect(onFiles).not.toHaveBeenCalled();
  });
});
