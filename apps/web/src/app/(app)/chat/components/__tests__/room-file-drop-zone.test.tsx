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
});
