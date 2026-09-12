/**
 * Coordinates in-memory edits with snapshots that read IndexedDB directly.
 *
 * Editors keep their newest revision in React state for a short debounce. A
 * backup or sync manifest cannot see that state, so each mounted owner
 * registers an awaited flusher here. Snapshot callers fail if any flusher
 * fails; copying the older database revision and reporting success would be
 * data loss disguised as a safety operation.
 */
export type PendingWriteFlusher = () => void | Promise<void>;

interface PendingWriteRegistration {
  flush: PendingWriteFlusher;
}

interface PendingWriteRegistry {
  registrations: Set<PendingWriteRegistration>;
}

/*
 * Dynamic imports and Vite hot replacement can evaluate this tiny module more
 * than once. Symbol.for keeps every copy on the same page-wide registry. Each
 * registration has its own token: React StrictMode may set an effect up again
 * before a deferred cleanup unregisters the first one, and deleting by flusher
 * identity would accidentally remove the new live registration too.
 */
const REGISTRY_KEY = Symbol.for('yoman-avoda.pending-writes');
const registryHost = globalThis as typeof globalThis & {
  [key: symbol]: PendingWriteRegistry | undefined;
};
const registry =
  registryHost[REGISTRY_KEY] ??
  (registryHost[REGISTRY_KEY] = { registrations: new Set() });

/** Registers one owner. The returned cleanup is safe to call more than once. */
export function registerPendingWriteFlusher(flusher: PendingWriteFlusher): () => void {
  const registration = { flush: flusher };
  registry.registrations.add(registration);
  return () => {
    registry.registrations.delete(registration);
  };
}

/**
 * Waits for every owner that is registered when this pass begins.
 *
 * Flushers may persist and wait for their own save queues. They must not call
 * this function (or start a backup) recursively: a snapshot is the consumer of
 * pending writes, never something a pending write should itself initiate.
 */
export async function flushPendingWrites(): Promise<void> {
  const pass = [...registry.registrations].map(({ flush }) =>
    Promise.resolve().then(flush),
  );
  await Promise.all(pass);
}
