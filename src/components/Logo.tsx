/**
 * The app mark: a navy clipboard with an amber clip and a completed-day check.
 * The same shapes are in public/favicon.svg (which the PWA and macOS icons are
 * rasterised from) and are drawn again in the PDF header band.
 */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role="img"
      aria-label="יומן עבודה"
      focusable="false"
    >
      <rect width="512" height="512" rx="96" fill="#0f2d4a" />
      <rect x="118" y="118" width="276" height="316" rx="28" fill="#f7f9fc" />
      <rect x="206" y="86" width="100" height="60" rx="18" fill="#d97706" />
      <rect x="226" y="70" width="60" height="40" rx="14" fill="#d97706" />
      <g fill="#0f2d4a">
        <rect x="156" y="200" width="200" height="18" rx="9" />
        <rect x="156" y="248" width="200" height="18" rx="9" opacity="0.75" />
        <rect x="156" y="296" width="200" height="18" rx="9" opacity="0.55" />
        <rect x="156" y="344" width="120" height="18" rx="9" opacity="0.4" />
      </g>
      <circle cx="336" cy="353" r="34" fill="#d97706" />
      <path
        d="M320 353l11 12 22-24"
        fill="none"
        stroke="#fff"
        strokeWidth="12"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
