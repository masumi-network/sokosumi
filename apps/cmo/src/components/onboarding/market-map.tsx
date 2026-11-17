import type { BrandBrain } from "../../lib/brand-sections";
import { companyUrl } from "../../lib/brand-sections";

type MarketMapData = NonNullable<NonNullable<BrandBrain["reveal"]>["map"]>;

interface MarketMapProps {
  map: MarketMapData;
  /** Competitors and alternatives, to link each dot to its homepage. */
  companies: BrandBrain["competitors"];
}

/** Where the business sits against its competitors, on Cuso's two axes. */
export function MarketMap({ map, companies }: MarketMapProps) {
  return (
    <figure className="ob-map" aria-label="Where you sit against competitors">
      <div className="ob-map-plot">
        <span className="ob-map-axis top">↑ {map.y.high}</span>
        <span className="ob-map-axis bottom">{map.y.low}</span>
        {map.players.map((player) => {
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
