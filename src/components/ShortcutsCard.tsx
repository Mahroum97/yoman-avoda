/**
 * Keyboard shortcuts, in Settings — the list, and the one place they change.
 *
 * A row is the action's own label and the key it answers to. Pressing the key
 * starts listening, and the next combination is stored; `Backspace` clears it,
 * because a shortcut that does nothing is a real answer here for the same
 * reason it is for a swipe. A combination already spoken for is refused by
 * name rather than quietly stolen from the action that had it.
 *
 * **The key is printed left to right and says so in the markup.** `⌘ + S` set
 * loose in a Hebrew line comes out as `S + ⌘`: the same reordering the PDF's
 * dates are guarded against, one layout up.
 */
import { useEffect, useState } from 'react';
import {
  SHORTCUTS,
  bindingFor,
  comboLabel,
  comboOf,
  readBindings,
  resetBindings,
  setRecording,
  shortcutFor,
  writeBinding,
  type ShortcutGroup,
} from '../lib/shortcuts';
import { useToast } from '../hooks/toastContext';
import { useLanguage } from '../i18n/useLanguage';
import { Card } from './ui';

const GROUPS: ShortcutGroup[] = ['nav', 'page', 'app'];

export function ShortcutsCard() {
  const { t } = useLanguage();
  const toast = useToast();
  // Re-read after every change: the bindings live in localStorage, and this is
  // the only screen that writes them.
  const [, bump] = useState(0);
  const [listening, setListening] = useState<string | null>(null);

  const heading: Record<ShortcutGroup, string> = {
    nav: t.shortcutsNav,
    page: t.shortcutsPage,
    app: t.shortcutsApp,
  };

  /*
   * While a row is listening, this handler takes the whole keyboard.
   *
   * Capture, `preventDefault` and the module's own recording flag together are
   * what stop the combination being *used* at the moment it is being recorded
   * — pressing ⌘S to bind it would otherwise save the page underneath, and 1
   * would walk off this screen before the binding was written.
   */
  useEffect(() => {
    if (!listening) return;
    setRecording(true);

    const onKey = (event: KeyboardEvent) => {
      const combo = comboOf(event);
      if (!combo) return; // A modifier on its own — still waiting for the key.
      event.preventDefault();
      event.stopPropagation();

      if (combo === 'escape') {
        setListening(null);
        return;
      }
      if (combo === 'backspace' || combo === 'delete') {
        writeBinding(listening, null);
        setListening(null);
        bump((n) => n + 1);
        return;
      }

      const taken = shortcutFor(combo);
      if (taken && taken.id !== listening) {
        toast.error(t.shortcutTaken(taken.label(t)));
        setListening(null);
        return;
      }

      writeBinding(listening, combo);
      setListening(null);
      bump((n) => n + 1);
    };

    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      setRecording(false);
    };
  }, [listening, t, toast]);

  const changed = Object.keys(readBindings()).length > 0;

  return (
    <Card title={t.shortcutsTitle} note={t.shortcutsHint}>
      <div className="stack">
        {GROUPS.map((group) => (
          <div className="shortcuts__group" key={group}>
            <p className="shortcuts__heading">{heading[group]}</p>
            {SHORTCUTS.filter((def) => def.group === group).map((def) => {
              const combo = bindingFor(def.id);
              const active = listening === def.id;
              return (
                <div className="shortcut" key={def.id}>
                  <span className="shortcut__label">{def.label(t)}</span>
                  <button
                    type="button"
                    className="shortcut__key"
                    data-listening={active || undefined}
                    data-empty={!combo && !active ? '' : undefined}
                    aria-label={`${def.label(t)} — ${combo ? comboLabel(combo) : t.swipeNone}`}
                    onClick={() => setListening(active ? null : def.id)}
                  >
                    {active ? (
                      t.shortcutRecord
                    ) : combo ? (
                      /* Left to right whatever the page around it is doing. */
                      <span dir="ltr">{comboLabel(combo)}</span>
                    ) : (
                      t.swipeNone
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        ))}

        <p className="muted small">{t.shortcutsClear}</p>

        {changed && (
          <div>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                resetBindings();
                bump((n) => n + 1);
              }}
            >
              {t.shortcutsReset}
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}
