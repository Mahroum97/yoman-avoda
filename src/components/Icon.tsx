/**
 * The app's icons, drawn here rather than fetched or bundled.
 *
 * They used to be emoji, and emoji are the wrong tool for an interface: every
 * platform draws them differently, they carry their own colours so they cannot
 * follow the theme, they sit on their own baseline, and a row of them reads as
 * decoration rather than as controls. On a black background 📋 and 🏗️ are two
 * unrelated illustrations; a set of line icons is one family.
 *
 * Inline SVG, not files from an icon site: this app has to render identically
 * with no network, a downloaded set would be third-party assets bundled under
 * someone's licence terms, and `stroke="currentColor"` is what lets one icon be
 * navy in the bar, blue when selected and white on a coloured button without a
 * second copy of anything.
 *
 * House style — 24×24 box, 1.8 stroke, round caps and joins, no fills except
 * where a shape is meant to read as solid.
 */
import type { JSX } from 'react';

export type IconName =
  | 'diary'
  | 'reports'
  | 'projects'
  | 'contacts'
  | 'settings'
  | 'plus'
  | 'sun'
  | 'moon'
  | 'auto'
  | 'black'
  | 'phone'
  | 'close'
  | 'printer'
  | 'download'
  | 'upload'
  | 'trash'
  | 'search'
  | 'grid'
  | 'list'
  | 'select'
  | 'sort'
  | 'check'
  | 'pin'
  | 'warning'
  | 'undo'
  | 'redo'
  | 'camera'
  | 'sync'
  | 'backup'
  | 'crew'
  | 'equipment'
  | 'concrete'
  | 'image'
  | 'share'
  | 'swipe'
  | 'copy'
  | 'calendar'
  | 'chevron'
  | 'arrowUp'
  | 'arrowDown';

const PATHS: Record<IconName, JSX.Element> = {
  // A bound notebook: cover, spine, and two written lines.
  diary: (
    <>
      <rect x="4.5" y="3" width="15" height="18" rx="2.5" />
      <path d="M8.5 3v18" />
      <path d="M12 8.5h4M12 12.5h4" />
    </>
  ),
  reports: (
    <>
      <path d="M4 20h16" />
      <path d="M7.5 20v-5.5M12 20V8M16.5 20v-8.5" />
    </>
  ),
  // A building rather than a crane: it survives being drawn at 20px.
  projects: (
    <>
      <path d="M4 21V8.5L12 4l8 4.5V21" />
      <path d="M9 21v-5h6v5" />
      <path d="M8.5 11h2M13.5 11h2" />
    </>
  ),
  contacts: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <circle cx="9" cy="11" r="2.2" />
      <path d="M5.8 16.2c.7-1.6 5.7-1.6 6.4 0" />
      <path d="M15 10h3.2M15 13.5h3.2" />
    </>
  ),
  // Sliders, not a cog: a cog turns to mush below 20px.
  settings: (
    <>
      <path d="M4 8h9M17 8h3M4 16h3M11 16h9" />
      <circle cx="15" cy="8" r="2.2" />
      <circle cx="9" cy="16" r="2.2" />
    </>
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
    </>
  ),
  moon: <path d="M20.5 14.8A8.7 8.7 0 0 1 9.2 3.5a8.7 8.7 0 1 0 11.3 11.3z" />,
  // Half filled, the way a light/dark toggle reads at a glance.
  auto: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none" />
    </>
  ),
  black: <rect x="4" y="4" width="16" height="16" rx="4.5" fill="currentColor" stroke="none" />,
  phone: (
    <path d="M7 3.5h2.6l1.5 3.8-1.9 1.4a11.5 11.5 0 0 0 5.1 5.1l1.4-1.9 3.8 1.5V16a2.5 2.5 0 0 1-2.7 2.5A15.8 15.8 0 0 1 4.5 6.2 2.5 2.5 0 0 1 7 3.5z" />
  ),
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  printer: (
    <>
      <path d="M7 9V3.5h10V9" />
      <path d="M7 17H5.5A1.5 1.5 0 0 1 4 15.5v-5A1.5 1.5 0 0 1 5.5 9h13a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H17" />
      <rect x="7" y="14" width="10" height="6.5" rx="1.2" />
    </>
  ),
  download: (
    <>
      <path d="M12 3.5v11" />
      <path d="M8 11l4 4 4-4" />
      <path d="M4.5 19.5h15" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15.5v-11" />
      <path d="M8 8.5l4-4 4 4" />
      <path d="M4.5 19.5h15" />
    </>
  ),
  trash: (
    <>
      <path d="M4 6.5h16" />
      <path d="M9.5 6.5V4.5h5v2" />
      <path d="M6 6.5l.9 13a1.5 1.5 0 0 0 1.5 1.4h7.2a1.5 1.5 0 0 0 1.5-1.4l.9-13" />
      <path d="M10.5 10.5v7M13.5 10.5v7" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="M15.5 15.5l4.5 4.5" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.8" />
      <rect x="13" y="4" width="7" height="7" rx="1.8" />
      <rect x="4" y="13" width="7" height="7" rx="1.8" />
      <rect x="13" y="13" width="7" height="7" rx="1.8" />
    </>
  ),
  list: (
    <>
      <path d="M9 6.5h11M9 12h11M9 17.5h11" />
      <path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />
    </>
  ),
  select: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12.2l2.4 2.4 4.6-4.8" />
    </>
  ),
  sort: (
    <>
      <path d="M7 4.5v15M7 19.5l-3-3M7 19.5l3-3" />
      <path d="M13 7h7M13 12h5M13 17h3" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  pin: (
    <>
      <path d="M9 3.5h6l-1 6 3 3.2v2H7v-2l3-3.2z" />
      <path d="M12 14.7v5.8" />
    </>
  ),
  warning: (
    <>
      <path d="M12 4.2l8.6 15.3H3.4z" />
      <path d="M12 10v4M12 16.8h.01" />
    </>
  ),
  undo: (
    <>
      <path d="M4.5 9.5h10a5 5 0 0 1 0 10h-4" />
      <path d="M8 5.5l-3.5 4L8 13.5" />
    </>
  ),
  redo: (
    <>
      <path d="M19.5 9.5h-10a5 5 0 0 0 0 10h4" />
      <path d="M16 5.5l3.5 4-3.5 4" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8.5h3l1.5-2.5h7L17 8.5h3a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 20 19.5H4A1.5 1.5 0 0 1 2.5 18v-8A1.5 1.5 0 0 1 4 8.5z" />
      <circle cx="12" cy="13.5" r="3.4" />
    </>
  ),
  // A shield with a tick: "kept safe", which is what a backup is — and clearly
  // not the download arrow the export buttons already use.
  backup: (
    <>
      <path d="M12 3.2l7 2.6v5.4c0 4.2-2.9 7.6-7 9.6-4.1-2-7-5.4-7-9.6V5.8z" />
      <path d="M8.8 12.1l2.2 2.2 4.2-4.4" />
    </>
  ),
  sync: (
    <>
      <path d="M4.5 12a7.5 7.5 0 0 1 12.8-5.3l2.2 2.2" />
      <path d="M19.5 12a7.5 7.5 0 0 1-12.8 5.3l-2.2-2.2" />
      <path d="M19.5 4.5v4.4h-4.4M4.5 19.5v-4.4h4.4" />
    </>
  ),

  /*
   * The five below label counts in a diary row — workers, plant, concrete,
   * photos — where an icon has to survive being drawn at fourteen pixels beside
   * a numeral. That rules out anything with interior detail: the shapes here are
   * chosen for silhouette, because at that size a silhouette is all there is.
   */
  crew: (
    <>
      <circle cx="9" cy="8" r="3.1" />
      <path d="M3.5 19.5c0-3.1 2.5-5 5.5-5s5.5 1.9 5.5 5" />
      <path d="M16 5.6a3.1 3.1 0 0 1 0 5.8" />
      <path d="M17.5 14.9c1.9.6 3 2.3 3 4.6" />
    </>
  ),
  // A spanner, not a machine: an excavator at 14px is a smudge, a spanner is
  // still a spanner.
  equipment: (
    <path d="M15.6 3.6a5 5 0 0 0-6.2 6.3L3.7 15.6a2 2 0 0 0 2.8 2.8l5.7-5.7a5 5 0 0 0 6.3-6.2l-2.9 2.9-2.5-.7-.7-2.5z" />
  ),
  // A cube, because what it labels is a volume in cubic metres.
  concrete: (
    <>
      <path d="M12 3.2l7.5 4v9.6l-7.5 4-7.5-4V7.2z" />
      <path d="M4.5 7.2l7.5 4 7.5-4" />
      <path d="M12 11.2v9.6" />
    </>
  ),
  // A picture, distinct from `camera`: one is "take one", this is "there are n".
  image: (
    <>
      <rect x="3.2" y="4.8" width="17.6" height="14.4" rx="2.5" />
      <circle cx="8.6" cy="9.8" r="1.6" />
      <path d="M3.6 16.6l4.4-4a1.8 1.8 0 0 1 2.4 0l3.2 2.9" />
      <path d="M13 14.2l2.2-2a1.8 1.8 0 0 1 2.4 0l2.8 2.5" />
    </>
  ),
  share: (
    <>
      <path d="M12 15.2V3.8" />
      <path d="M8.2 7.4L12 3.6l3.8 3.8" />
      <path d="M6 11.5H5A1.5 1.5 0 0 0 3.5 13v6A1.5 1.5 0 0 0 5 20.5h14a1.5 1.5 0 0 0 1.5-1.5v-6a1.5 1.5 0 0 0-1.5-1.5h-1" />
    </>
  ),
  // Two arrows from a centre line — the gesture, not a direction.
  swipe: (
    <>
      <path d="M12 5.5v13" />
      <path d="M8 9.5l-4 2.5 4 2.5" />
      <path d="M16 9.5l4 2.5-4 2.5" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="3.5" width="12" height="14" rx="2.2" />
      <path d="M15.5 20.5h-10a2 2 0 0 1-2-2v-11" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5.5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17" />
      <path d="M8 3.5v4M16 3.5v4" />
    </>
  ),
  // Points to the inline end; the stylesheet flips it with the language.
  chevron: <path d="M9.5 5.5l6.5 6.5-6.5 6.5" />,
  // Up and down are never flipped: reordering a row is vertical in every
  // language, unlike `chevron`, which means "onwards" and follows the text.
  arrowUp: (
    <>
      <path d="M12 19.5v-15" />
      <path d="M6 10.5l6-6 6 6" />
    </>
  ),
  arrowDown: (
    <>
      <path d="M12 4.5v15" />
      <path d="M6 13.5l6 6 6-6" />
    </>
  ),
};

export function Icon({
  name,
  size = 22,
  strokeWidth = 1.8,
  className,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      // Named, so a rule can address one kind of icon — which is how `chevron`
      // gets mirrored in a right-to-left layout without every caller of it
      // having to remember that it points the way the text runs.
      className={['icon', `icon--${name}`, className].filter(Boolean).join(' ')}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decoration: every icon in this app sits beside or inside a labelled
      // control, so a screen reader announcing it would only repeat the label.
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
