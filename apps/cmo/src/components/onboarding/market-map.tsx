"use client";

import type { CmoBrandMedia } from "@sokosumi/core-client";
import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import type { BrandBrain } from "../../lib/brand-sections";
import { CompetitorCards } from "../brand-media";
import { RivalFacts } from "../brand-profile";

type MarketMap = NonNullable<NonNullable<BrandBrain["reveal"]>["map"]>;
type Rival = BrandBrain["competitors"][number];

/** Past this x a label sits left of its dot, so no name runs off the plot. */
const FLIP_X = 75;

const same = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The Competitors tile: the market map over the rival rows when the read
 * placed at least two players, else the rows alone as before. A dot and its
 * row pick each other.
 */
export function Competitors({
  brain,
  media,
}: {
  brain: BrandBrain;
  media: CmoBrandMedia | null;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const rivals = [...brain.competitors, ...(brain.alternatives ?? [])];
  const map = brain.reveal?.map;
  const pick = (name: string) =>
    setPicked((current) => (current && same(current, name) ? null : name));

  if (!map || map.players.length < 2) {
    return (
      <>
        {media && media.competitors.length > 0 ? (
          <CompetitorCards brain={brain} media={media} />
        ) : (
          <ul className="ob-list">
            {rivals.map((rival) => (
              <li key={rival.name}>
                {rival.url ? (
                  <a href={rival.url} target="_blank" rel="noreferrer">
                    {rival.name}
                  </a>
                ) : (
                  rival.name
                )}
                {rival.note ? ` · ${rival.note}` : ""}
              </li>
            ))}
          </ul>
        )}
        <RivalFacts competitors={brain.competitors} />
      </>
    );
  }

  return (
    <>
      <Plot map={map} picked={picked} onPick={pick} />
      <ul className="ob-rivals">
        {rivals.map((rival) => (
          <RivalRow
            key={rival.name}
            rival={rival}
            shot={
              media?.competitors.find((shot) => same(shot.name, rival.name))
                ?.url
            }
            picked={picked !== null && same(picked, rival.name)}
            onPick={() => pick(rival.name)}
          />
        ))}
      </ul>
      <RivalFacts competitors={brain.competitors} />
    </>
  );
}

/** Two axes, dashed centre lines, every player a dot; the founder's in Iris. */
function Plot({
  map,
  picked,
  onPick,
}: {
  map: MarketMap;
  picked: string | null;
  onPick: (name: string) => void;
}) {
  return (
    <figure className="ob-map">
      <div className="ob-map-plot">
        <span className="ob-map-axis top">↑ {map.y.high}</span>
        <span className="ob-map-axis bottom">{map.y.low}</span>
        <div className="ob-map-field">
          {map.players.map((player, index) => {
            const className = [
              "ob-map-dot",
              player.you ? "you" : "",
              player.x > FLIP_X ? "flip" : "",
            ]
              .filter(Boolean)
              .join(" ");
            const style = {
              left: `${clamp(player.x)}%`,
              bottom: `${clamp(player.y)}%`,
              animationDelay: `${index * 120}ms`,
            };
            return player.you ? (
              <span key={player.name} className={className} style={style}>
                {player.name}
              </span>
            ) : (
              <button
                key={player.name}
                type="button"
                className={className}
                style={style}
                aria-pressed={picked !== null && same(picked, player.name)}
                onClick={() => onPick(player.name)}
              >
                {player.name}
              </button>
            );
          })}
        </div>
      </div>
      <figcaption className="ob-map-x">
        <span>{map.x.low}</span>
        <span>{map.x.high} →</span>
      </figcaption>
    </figure>
  );
}

const clamp = (value: number) => Math.min(100, Math.max(0, value));

/** A rival as a row the map can pick, with its homepage and a way to its site. */
function RivalRow({
  rival,
  shot,
  picked,
  onPick,
}: {
  rival: Rival;
  shot: string | undefined;
  picked: boolean;
  onPick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className="ob-rival"
        aria-pressed={picked}
        onClick={onPick}
      >
        {shot ? (
          <img src={shot} alt={`${rival.name} homepage`} loading="lazy" />
        ) : (
          <span className="ob-rival-blank" aria-hidden="true">
            {rival.name.slice(0, 1)}
          </span>
        )}
        <span className="ob-rival-text">
          <b>{rival.name}</b>
          {rival.note ? <span>{rival.note}</span> : null}
        </span>
      </button>
      {rival.url ? (
        <a
          className="ob-rival-link"
          href={rival.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${rival.name}'s site`}
        >
          <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      ) : null}
    </li>
  );
}
