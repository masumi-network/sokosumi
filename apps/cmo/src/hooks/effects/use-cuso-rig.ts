"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import { type CusoRig, startCusoRig } from "../../components/app/cuso-rig";
import type { CusoArt } from "../../components/cuso";

let poses: Promise<string> | null = null;

/** His poses drawing, fetched once per page load. */
function loadPoses(): Promise<string> {
  poses ??= fetch("/cuso/poses.svg").then((res) => {
    if (!res.ok) throw new Error(`poses.svg: ${res.status}`);
    return res.text();
  });
  poses.catch(() => {
    poses = null; // the next mount asks again
  });
  return poses;
}

/**
 * Cuso's animated drawing inside `host`, in pose `art`, while `on`. Returns
 * whether he is live (until then, loading, a failed load or motion off, the
 * caller shows his still) and `hop`, which makes him hop when he is.
 */
export function useCusoRig(
  host: RefObject<HTMLElement | null>,
  art: CusoArt,
  on: boolean,
): { live: boolean; hop: () => void } {
  const rig = useRef<CusoRig | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!on) return;
    let current = true;
    let fig: SVGSVGElement | null = null;
    loadPoses()
      .then((svg) => {
        const el = host.current;
        const shadow = el?.querySelector<HTMLElement>(".cuso-shadow");
        if (!current || !el || !shadow) return;
        el.insertAdjacentHTML("beforeend", svg);
        fig = el.lastElementChild as SVGSVGElement;
        fig.classList.add("cuso-rig");
        rig.current = startCusoRig(fig, shadow);
        setLive(true);
      })
      .catch(() => {
        // He keeps his still.
      });
    return () => {
      current = false;
      rig.current?.stop();
      rig.current = null;
      fig?.remove();
      setLive(false);
    };
  }, [host, on]);

  useEffect(() => {
    if (live) rig.current?.pose(art);
  }, [art, live]);

  return { live, hop: () => rig.current?.hop() };
}
