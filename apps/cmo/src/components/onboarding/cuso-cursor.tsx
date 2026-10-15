"use client";

import { motion } from "motion/react";

/**
 * Cuso's mark, the CMO.xyz cursor, alive while he works: it drifts as if
 * moving across a page and leaves a soft trail of clicks.
 */
export function CusoCursor({ active }: { active: boolean }) {
  return (
    <div className="ob-cursor" aria-hidden="true">
      {active ? (
        <>
          <motion.span
            className="ob-ripple"
            initial={{ scale: 0.4, opacity: 0.5 }}
            animate={{ scale: 1.8, opacity: 0 }}
            transition={{ duration: 1.8, repeat: Number.POSITIVE_INFINITY }}
          />
          <motion.span
            className="ob-ripple"
            initial={{ scale: 0.4, opacity: 0.5 }}
            animate={{ scale: 1.8, opacity: 0 }}
            transition={{
              duration: 1.8,
              repeat: Number.POSITIVE_INFINITY,
              delay: 0.9,
            }}
          />
        </>
      ) : null}
      <motion.img
        src="/logo.svg"
        alt=""
        width={44}
        height={64}
        animate={
          active
            ? {
                x: [0, 10, -6, 4, 0],
                y: [0, -6, 4, -2, 0],
                rotate: [0, -6, 4, -2, 0],
              }
            : { x: 0, y: 0, rotate: 0 }
        }
        transition={
          active
            ? {
                duration: 4,
                repeat: Number.POSITIVE_INFINITY,
                ease: "easeInOut",
              }
            : { duration: 0.3 }
        }
      />
    </div>
  );
}
