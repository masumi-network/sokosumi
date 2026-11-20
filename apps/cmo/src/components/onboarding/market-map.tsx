import type { BrandBrain } from "../../lib/brand-sections";
import { companyUrl } from "../../lib/brand-sections";

type MarketMapData = NonNullable<NonNullable<BrandBrain["reveal"]>["map"]>;

interface MarketMapProps {
  map: MarketMapData;
  /** Competitors and alternatives, to link each dot to its homepage. */
  companies: BrandBrain["competitors"];
}

/** How close two dots may sit, in percent of the plot, before labels collide. */
const CLEAR = { x: 30, y: 7 };

/**
 * Moves a dot that would sit on another toward the middle until its label is
 * clear. The business keeps its own place; the others move around it.
 */
export function spreadPlayers(
  players: MarketMapData["players"],
): MarketMapData["players"] {
  const placed: MarketMapData["players"] = [];
  const youFirst = [...players].sort(
    (a, b) => Number(b.you ?? false) - Number(a.you ?? false),
  );
  for (const player of youFirst) {
    const step = player.y > 50 ? -CLEAR.y : CLEAR.y;
    let y = player.y;
    while (
      placed.some(
        (other) =>
          Math.abs(other.x - player.x) < CLEAR.x &&
          Math.abs(other.y - y) < CLEAR.y,
      )
    ) {
      y += step;
    }
    placed.push({ ...player, y });
  }
  return placed;
}

/** Where the business sits against its competitors, on Cuso's two axes. */
export function MarketMap({ map, companies }: MarketMapProps) {
  return (
    <figure className="ob-map" aria-label="Where you sit against competitors">
      <div className="ob-map-plot">
        <span className="ob-map-axis top">↑ {map.y.high}</span>
        <span className="ob-map-axis bottom">{map.y.low}</span>
        {spreadPlayers(map.players).map((player) => {
          const url = player.you
            ? undefined
            : companyUrl(player.name, companies);
          const Dot = url ? "a" : "span";
          return (
            <Dot
              key={player.name}
              {...(url
                ? { href: url, target: "_blank", rel: "noreferrer" }
                : {})}
              className={[
                "ob-map-dot",
                player.you ? "you" : "",
                player.x > 70 ? "flip" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ left: `${player.x}%`, bottom: `${player.y}%` }}
            >
              <i aria-hidden="true" />
              {player.name}
            </Dot>
          );
        })}
      </div>
      <figcaption className="ob-map-x">
        <span>{map.x.low}</span>
        <span>{map.x.high} →</span>
      </figcaption>
    </figure>
  );
}
