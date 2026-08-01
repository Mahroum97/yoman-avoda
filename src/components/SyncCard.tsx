/**
 * The two halves of local-network sync, in one card.
 *
 * The Mac app is the hub: it shows the address and a pairing code. Every other
 * device types those once and then syncs with a button. Which half is shown
 * depends on whether this build can host — that is, whether it is the Mac app.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '../i18n/useLanguage';
import { useToast } from '../hooks/toastContext';
import type { SyncServerStatus } from '../lib/save';
import {
  canHost,
  forgetPeer,
  lastSyncAt,
  probe,
  readPeer,
  savePeer,
  syncNow,
  type Peer,
  type SyncProgress,
} from '../sync/client';
import { Card, Field } from './ui';

function formatTime(stamp: number | null, locale: string): string | null {
  if (!stamp) return null;
  return new Date(stamp).toLocaleString(locale, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ------------------------------------------------------------------ the Mac */

function HostPanel() {
  const { t, language } = useLanguage();
  const [status, setStatus] = useState<SyncServerStatus | null>(null);

  const refresh = useCallback(async () => {
    const bridge = window.yoman?.sync;
    if (!bridge) return;
    setStatus(await bridge.status());
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (!status) return <p className="muted small">{t.loading}</p>;

  if (!status.running || !status.address) {
    return (
      <div className="stack">
        <p className="card__note">{t.syncHostOffline}</p>
        <div>
          <button
            type="button"
            className="btn"
            onClick={async () => setStatus(await window.yoman!.sync!.start())}
          >
            {t.syncStartHost}
          </button>
        </div>
      </div>
    );
  }

  const seen = formatTime(status.lastSyncAt, language);

  return (
    <div className="stack">
      <p className="card__note">{t.syncHostHint}</p>
      <div className="sync-pair">
        <div>
          <div className="sync-pair__label">{t.syncAddress}</div>
          <div className="sync-pair__value">{status.address}</div>
        </div>
        <div>
          <div className="sync-pair__label">{t.syncCode}</div>
          <div className="sync-pair__value sync-pair__value--code">{status.code}</div>
        </div>
      </div>
      {seen && <p className="muted small">{t.syncLastAt(seen)}</p>}
      <div className="btn-row">
        <button
          type="button"
          className="btn btn--sm"
          onClick={async () => setStatus(await window.yoman!.sync!.newCode())}
        >
          {t.syncNewCode}
        </button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- the phone */

function ClientPanel() {
  const { t, language } = useLanguage();
  const toast = useToast();
  const [peer, setPeer] = useState<Peer | null>(readPeer);
  const [address, setAddress] = useState(peer?.address ?? '');
  const [code, setCode] = useState(peer?.code ?? '');
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState<string | null>(formatTime(lastSyncAt(), language));
  // A transfer full of photos takes real time; without this the phone just
  // sits there and the user assumes it has hung — which is what they reported.
  const [progress, setProgress] = useState<SyncProgress | null>(null);

  const connect = async () => {
    if (!address.trim() || code.trim().length < 4) {
      toast.error(t.syncNeedDetails);
      return;
    }
    setBusy(true);
    try {
      if (!(await probe(address))) {
        toast.error(t.syncNotFound);
        return;
      }
      const next = { address: address.trim(), code: code.trim() };
      savePeer(next);
      setPeer(next);
      await run(next);
    } finally {
      setBusy(false);
    }
  };

  const run = async (target: Peer) => {
    setBusy(true);
    setProgress(null);
    try {
      const outcome = await syncNow(target, setProgress);
      setSeen(formatTime(Date.now(), language));
      toast.show(
        t.syncDone(
          outcome.received.projects + outcome.received.entries,
          outcome.sent.projects + outcome.sent.entries,
        ),
      );
    } catch (error) {
      // Each of these means something different to someone standing on a site
      // with a phone, and "sync failed" sent them looking in the wrong place.
      const message = error instanceof Error ? error.message : '';
      const reason =
        message === 'BAD_CODE'
          ? t.syncBadCode
          : message === 'UNREACHABLE'
            ? t.syncUnreachable
            : message === 'TIMEOUT'
              ? t.syncTimeout
              : message === 'VERSION_MISMATCH'
                ? t.syncVersionMismatch
                : t.syncFailed;
      toast.error(reason);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="stack">
      <p className="card__note">{t.syncClientHint}</p>

      <Field label={t.syncAddress} hint={t.syncAddressHint}>
        <input
          type="text"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="192.168.1.20:45231"
        />
      </Field>

      <Field label={t.syncCode}>
        <input
          type="text"
          inputMode="numeric"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="123456"
        />
      </Field>

      {seen && <p className="muted small">{t.syncLastAt(seen)}</p>}

      <div className="btn-row">
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy}
          onClick={() => (peer ? void run({ address, code }) : void connect())}
        >
          {busy
            ? progress && progress.total > 0
              ? t.syncProgress(progress.done + 1, progress.total)
              : t.syncWorking
            : peer
              ? t.syncNow
              : t.syncConnect}
        </button>
        {peer && (
          <button
            type="button"
            className="btn btn--danger"
            disabled={busy}
            onClick={() => {
              forgetPeer();
              setPeer(null);
              setSeen(null);
              toast.show(t.syncForgotten);
            }}
          >
            {t.syncForget}
          </button>
        )}
      </div>
    </div>
  );
}

export function SyncCard() {
  const { t } = useLanguage();
  return (
    <Card title={t.syncTitle} note={undefined}>
      {canHost() ? <HostPanel /> : <ClientPanel />}
    </Card>
  );
}
