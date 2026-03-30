import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import useModal from "./use-modal";

interface StatefulModalProps {
  open: boolean;
  onOpenChange: React.Dispatch<React.SetStateAction<boolean>>;
  label: string;
}

function StatefulModal({ open, label }: StatefulModalProps) {
  const [count, setCount] = useState(0);

  if (!open) {
    return null;
  }

  return (
    <div>
      <p>{label}</p>
      <p data-testid="count">{count}</p>
      <button type="button" onClick={() => setCount((current) => current + 1)}>
        increment
      </button>
    </div>
  );
}

function TestHarness() {
  const [label, setLabel] = useState("Initial share");
  const { Component, showModal } = useModal(StatefulModal, { label });

  return (
    <>
      <button type="button" onClick={showModal}>
        open
      </button>
      <button type="button" onClick={() => setLabel("Updated share")}>
        update label
      </button>
      {Component}
    </>
  );
}

describe("useModal", () => {
  it("keeps modal state when extra props change", () => {
    render(<TestHarness />);

    fireEvent.click(screen.getByRole("button", { name: "open" }));
    fireEvent.click(screen.getByRole("button", { name: "increment" }));

    expect(screen.getByTestId("count")).toHaveTextContent("1");
    expect(screen.getByText("Initial share")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "update label" }));

    expect(screen.getByText("Updated share")).toBeInTheDocument();
    expect(screen.getByTestId("count")).toHaveTextContent("1");
  });
});
