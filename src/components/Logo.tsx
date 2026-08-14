/**
 * The app mark: the document the app makes.
 *
 * A navy tile, a white sheet, and the same header band and amber rule that open
 * every page this app exports — so the icon on the home screen and the paper
 * that comes out of it are recognisably the same thing. The shapes are kept in
 * step with `public/favicon.svg`, which the PWA and macOS icons are rasterised
 * from; change one, change the other.
 *
 * The gradient ids are suffixed per instance: two of these on one page with the
 * same id would have the second silently pick up the first one's definition.
 */
import { useId } from 'react';

export function Logo({ size = 30 }: { size?: number }) {
  const id = useId();
  const tile = `logo-tile-${id}`;
  const page = `logo-page-${id}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role="img"
      aria-label="יומן עבודה"
      focusable="false"
    >
      <defs>
        <linearGradient id={tile} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#17456e" />
          <stop offset="1" stopColor="#0c2540" />
        </linearGradient>
        <clipPath id={page}>
          <rect x="132" y="100" width="248" height="312" rx="26" />
        </clipPath>
      </defs>

      <rect width="512" height="512" rx="114" fill={`url(#${tile})`} />
      <rect x="132" y="100" width="248" height="312" rx="26" fill="#ffffff" />

      <g clipPath={`url(#${page})`}>
        <rect x="132" y="100" width="248" height="58" fill="#0f2d4a" />
        <rect x="132" y="158" width="248" height="13" fill="#d97706" />
      </g>

      <g fill="#0f2d4a">
        <rect x="168" y="216" width="176" height="19" rx="9.5" opacity="0.9" />
        <rect x="168" y="266" width="176" height="19" rx="9.5" opacity="0.62" />
        <rect x="168" y="316" width="104" height="19" rx="9.5" opacity="0.4" />
      </g>
    </svg>
  );
}
