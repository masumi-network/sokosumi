/** Portrait CSS width, height and pixel ratio of each iOS device. */
const SPLASH_DEVICES = [
  [1032, 1376, 2],
  [1024, 1366, 2],
  [834, 1210, 2],
  [834, 1194, 2],
  [768, 1024, 2],
  [820, 1180, 2],
  [834, 1112, 2],
  [810, 1080, 2],
  [744, 1133, 2],
  [440, 956, 3],
  [402, 874, 3],
  [420, 912, 3],
  [430, 932, 3],
  [393, 852, 3],
  [390, 844, 3],
  [428, 926, 3],
  [360, 780, 3],
  [414, 896, 3],
  [375, 812, 3],
  [414, 896, 2],
  [414, 736, 3],
  [375, 667, 2],
  [320, 568, 2],
] as const;

const SPLASH_IMAGES = SPLASH_DEVICES.flatMap(([width, height, ratio]) =>
  (["portrait", "landscape"] as const).flatMap((orientation) => {
    const [x, y] =
      orientation === "portrait" ? [width, height] : [height, width];
    const file = `/images/splash-screens/apple-splash-${x * ratio}-${y * ratio}`;
    const media = `(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: ${orientation})`;
    return [
      { href: `${file}.jpg`, media },
      {
        href: `${file}-dark.jpg`,
        media: `${media} and (prefers-color-scheme: dark)`,
      },
    ];
  }),
);

export function ApplePwaHead() {
  return (
    <>
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-title" content="Sokosumi" />
      <link
        rel="apple-touch-icon"
        href="/images/app-icons/apple-icon-180.png"
      />
      <meta
        name="theme-color"
        content="#ffffff"
        media="(prefers-color-scheme: light)"
      />
      <meta
        name="theme-color"
        content="#0c0c0c"
        media="(prefers-color-scheme: dark)"
      />
      {SPLASH_IMAGES.map(({ href, media }) => (
        <link
          key={href}
          rel="apple-touch-startup-image"
          href={href}
          media={media}
        />
      ))}
    </>
  );
}
