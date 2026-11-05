import type { CmoBrandMedia } from "@sokosumi/core-client";
import { ArrowUpRight } from "lucide-react";

import type { BrandBrain } from "../lib/brand-sections";

type Page = CmoBrandMedia["pages"][number];

/** The homepage as visitors see it: a browser window with the phone in front. */
export function SiteShowcase({
  media,
  host,
}: {
  media: CmoBrandMedia | null;
  host: string;
}) {
  const desktop = media?.pages.find(
    (page) => page.device === "desktop" && page.label === "Home",
  );
  const phone = media?.pages.find((page) => page.device === "mobile");
  if (!desktop) {
    return media ? null : (
      <div className="bm-show bm-pending" aria-hidden="true">
        <Browser host={host} />
      </div>
    );
  }
  return (
    <div className="bm-show">
      <Browser host={host} page={desktop} />
      {phone ? (
        <div className="bm-phone">
          <img src={phone.url} alt={`${host} on a phone`} loading="lazy" />
        </div>
      ) : null}
    </div>
  );
}

function Browser({ host, page }: { host: string; page?: Page }) {
  return (
    <figure className="bm-browser">
      <div className="bm-bar">
        <span className="bm-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="bm-address">{host}</span>
      </div>
      {page ? (
        <img src={page.url} alt={`${host} homepage`} loading="lazy" />
      ) : (
        <div className="bm-shot-empty">Taking screenshots of {host}…</div>
      )}
    </figure>
  );
}

/**
 * The material research found on the brand's own site: its key pages and the
 * pictures on them (products, screens, people). Cuso uses them in posts; each
 * opens full size.
 */
export function SiteGallery({ media }: { media: CmoBrandMedia }) {
  const pages = media.pages.filter(
    (page) => page.device === "desktop" && page.label !== "Home",
  );
  if (pages.length === 0 && media.pictures.length === 0) return null;
  return (
    <div className="bm-gallery">
      {pages.length > 0 ? (
        <ul className="bm-pages">
          {pages.map((page) => (
            <li key={page.url}>
              <a href={page.pageUrl} target="_blank" rel="noreferrer">
                <img src={page.url} alt={`${page.label} page`} loading="lazy" />
                <span className="bm-caption">
                  {page.label}
                  <ArrowUpRight size={14} aria-hidden="true" />
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {media.pictures.length > 0 ? (
        <ul className="bm-pictures">
          {media.pictures.map((picture) => (
            <li key={picture.url}>
              <a href={picture.url} target="_blank" rel="noreferrer">
                <img
                  src={picture.url}
                  alt={picture.alt || "A picture from the site"}
                  loading="lazy"
                />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="note">
        Saved to the Project's files in Sokosumi, under Brand research, for your
        whole team. Cuso uses them in your posts.
      </p>
    </div>
  );
}

/** Each competitor with its homepage, so the owner sees the market at a glance. */
export function CompetitorCards({
  brain,
  media,
}: {
  brain: BrandBrain;
  media: CmoBrandMedia;
}) {
  return (
    <ul className="bm-rivals">
      {brain.competitors.map((competitor) => {
        const shot = media.competitors.find(
          (candidate) => candidate.name === competitor.name,
        );
        const body = (
          <>
            {shot ? (
              <img
                src={shot.url}
                alt={`${competitor.name} homepage`}
                loading="lazy"
              />
            ) : (
              <span className="bm-rival-blank" aria-hidden="true">
                {competitor.name.slice(0, 1)}
              </span>
            )}
            <span className="bm-rival-text">
              <b>
                {competitor.name}
                {competitor.url ? (
                  <ArrowUpRight size={14} aria-hidden="true" />
                ) : null}
              </b>
              {competitor.note ? <span>{competitor.note}</span> : null}
            </span>
          </>
        );
        return (
          <li key={competitor.name}>
            {competitor.url ? (
              <a href={competitor.url} target="_blank" rel="noreferrer">
                {body}
              </a>
            ) : (
              <div>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
