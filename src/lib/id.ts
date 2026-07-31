/** Short unique id for table rows and photos (stable across saves). */
export const uid = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
