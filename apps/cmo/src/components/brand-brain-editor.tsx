"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { useState, useTransition } from "react";

type BrandBrain = NonNullable<CmoOverview["brandBrain"]>;

const lines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/** The editable parts of the Brand Brain, one item per line. */
export function brandBrainFromForm(
  previous: BrandBrain,
  form: {
    summary: string;
    tone: string;
    doLines: string;
    dontLines: string;
    examples: string;
    audience: string;
    products: string;
  },
): BrandBrain {
  return {
    ...previous,
    summary: form.summary.trim(),
    voice: {
      tone: form.tone.trim(),
      do: lines(form.doLines),
      dont: lines(form.dontLines),
      examples: lines(form.examples),
    },
    audience: lines(form.audience),
    products: lines(form.products),
  };
}

interface BrandBrainEditorProps {
  brandBrain: BrandBrain;
  save: (brandBrain: BrandBrain) => Promise<void>;
}

export function BrandBrainEditor({ brandBrain, save }: BrandBrainEditorProps) {
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (name: string) => String(data.get(name) ?? "");
    startTransition(async () => {
      await save(
        brandBrainFromForm(brandBrain, {
          summary: value("summary"),
          tone: value("tone"),
          doLines: value("do"),
          dontLines: value("dont"),
          examples: value("examples"),
          audience: value("audience"),
          products: value("products"),
        }),
      );
      setSaved(true);
    });
  }

  return (
    <form onSubmit={onSubmit} className="stack">
      <h2>Brand Brain</h2>
      <p className="note">
        What Cuso knows about your brand. Every post follows it. One item per
        line.
      </p>
      <label className="field">
        <span>Summary</span>
        <textarea name="summary" rows={3} defaultValue={brandBrain.summary} />
      </label>
      <label className="field">
        <span>Tone</span>
        <input name="tone" defaultValue={brandBrain.voice.tone} />
      </label>
      <label className="field">
        <span>Do</span>
        <textarea
          name="do"
          rows={3}
          defaultValue={brandBrain.voice.do.join("\n")}
        />
      </label>
      <label className="field">
        <span>Don't</span>
        <textarea
          name="dont"
          rows={3}
          defaultValue={brandBrain.voice.dont.join("\n")}
        />
      </label>
      <label className="field">
        <span>Lines that sound like you</span>
        <textarea
          name="examples"
          rows={3}
          defaultValue={brandBrain.voice.examples.join("\n")}
        />
      </label>
      <label className="field">
        <span>Audience</span>
        <textarea
          name="audience"
          rows={2}
          defaultValue={brandBrain.audience.join("\n")}
        />
      </label>
      <label className="field">
        <span>Products</span>
        <textarea
          name="products"
          rows={2}
          defaultValue={brandBrain.products.join("\n")}
        />
      </label>
      <div className="actions">
        <button type="submit" disabled={pending}>
          {pending ? "Saving" : "Save Brand Brain"}
        </button>
        {saved && !pending ? <span className="note">Saved</span> : null}
      </div>
    </form>
  );
}
