/**
 * Picks the look of the printed document.
 *
 * Each option is a miniature of the page itself rather than a colour swatch —
 * the point is to show what a report will look like, and a band of colour on
 * its own does not answer that.
 */
import { DOC_THEMES, css, docTheme, type DocThemeId } from '../docTheme';
import { useLanguage } from '../i18n/useLanguage';

function Thumbnail({ id }: { id: DocThemeId }) {
  const theme = docTheme(id);
  return (
    <span className="doc-thumb" aria-hidden="true">
      <span className="doc-thumb__band" style={{ background: css(theme.band) }}>
        <span className="doc-thumb__mark" style={{ background: css(theme.accent) }} />
      </span>
      <span className="doc-thumb__rule" style={{ background: css(theme.accent) }} />
      <span className="doc-thumb__panels">
        <span style={{ background: css(theme.panel) }} />
        <span style={{ background: css(theme.panel) }} />
      </span>
      <span className="doc-thumb__head" style={{ background: css(theme.tintGroup) }} />
      <span className="doc-thumb__rows">
        <span style={{ background: css(theme.row) }} />
        <span />
        <span style={{ background: css(theme.row) }} />
        <span />
      </span>
    </span>
  );
}

export function DocThemePicker({
  value,
  onChange,
}: {
  value: DocThemeId;
  onChange: (id: DocThemeId) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="doc-themes">
      {DOC_THEMES.map((id) => (
        <button
          key={id}
          type="button"
          className="doc-theme"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
        >
          <Thumbnail id={id} />
          <span className="doc-theme__name">{t.docThemeNames[id]}</span>
        </button>
      ))}
    </div>
  );
}
