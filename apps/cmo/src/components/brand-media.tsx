import type { CmoBrandMedia } from "@sokosumi/core-client";
import { ArrowUpRight } from "lucide-react";
import { AGENT_NAME } from "../lib/agent";
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
  const phone = media?.pages.find(
    (page) => page.device === "mobile" && page.label === "Home",
  );
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

type Section = CmoBrandMedia["sections"][number];

/** How a section of a page is named under its picture. */
const SECTION_NAMES: Record<Section["kind"], string> = {
  hero: "Hero",
  pricing: "Pricing",
  testimonials: "Testimonials",
  customers: "Customer logos",
  faq: "Questions",
  product: "Product",
  features: "Features",
  cta: "Call to action",
  section: "Section",
};

/** How many things research kept from the site, for the fold's count. */
export function siteFinds(media: CmoBrandMedia): number {
  return (
    media.pages.filter((page) => page.device === "desktop").length +
    media.sections.length +
    media.pictures.length
  );
}

/**
 * What research kept from the brand's own site: the pages it read, each
 * page's sections (pricing, testimonials, product shots) and the pictures on
 * them. Cuso makes posts from them; a page opens the site, a picture opens
 * full size.
 */
export function SiteGallery({ media }: { media: CmoBrandMedia }) {
  const pages = media.pages.filter((page) => page.device === "desktop");
  if (siteFinds(media) === 0) return null;
  return (
    <div className="bm-gallery">
      {pages.length > 0 ? (
        <section>
          <h3>Pages I read</h3>
          <ul className="bm-pages">
            {pages.map((page) => (
              <li key={page.url}>
                <a href={page.pageUrl} target="_blank" rel="noreferrer">
                  <img
                    src={page.url}
                    alt={`${page.label} page`}
                    loading="lazy"
                  />
                  <span className="bm-caption">
                    {page.label}
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {media.sections.length > 0 ? (
        <section>
          <h3>What is on them</h3>
          <ul className="bm-pictures bm-sections">
            {media.sections.map((section) => (
              <li key={section.url}>
                <a href={section.url} target="_blank" rel="noreferrer">
                  <img
                    src={section.url}
                    alt={`${SECTION_NAMES[section.kind]} on the ${section.pageLabel} page: ${section.title}`}
                    loading="lazy"
                  />
                  <span className="bm-caption">
                    {SECTION_NAMES[section.kind]}
                  </span>
                  <span className="bm-about">{section.title}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {media.pictures.length > 0 ? (
        <section>
          <h3>Pictures</h3>
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
        </section>
      ) : null}
      <p className="note">
        Saved to your files, under Brand research, for your whole team.{" "}
        {AGENT_NAME} makes your posts from them.
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
