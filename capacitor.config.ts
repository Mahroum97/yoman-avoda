import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Native shell configuration.
 *
 * The iPhone app is the same built `dist/` the website and the Mac app use —
 * only the file-saving path differs, because iOS has no download folder and
 * hands files to the share sheet instead (see src/lib/save.ts).
 */
const config: CapacitorConfig = {
  appId: 'com.mahroum.yoman',
  appName: 'יומן עבודה',
  webDir: 'dist',
  ios: {
    // The diary is a document, not a game: keep the web view opaque and let the
    // page own its own background so dark mode does not flash white.
    backgroundColor: '#0f2d4a',
    contentInset: 'never',
    limitsNavigationsToAppBoundDomains: true,
  },
  plugins: {
    Keyboard: {
      // Let the page keep its layout and scroll the focused field into view,
      // rather than the web view resizing under the user's finger.
      resize: 'native',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
