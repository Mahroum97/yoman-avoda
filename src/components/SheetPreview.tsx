/**
 * On-screen A4 rendering of a diary page.
 *
 * It mirrors src/pdf/entryPage.ts block for block — same header band, same
 * column proportions, same padding rows — so the preview predicts what the
 * generated PDF will look like. Change one, change the other.
 */
import { useEffect, useMemo, useState } from 'react';
import type { DiaryEntry, Project } from '../types';
import { formatDdMmYyyy, formatLongDate } from '../lib/dates';
import { useLanguage } from '../i18n/useLanguage';
import type { Strings } from '../i18n/strings';
import { Logo } from './Logo';

/** Same ratios as CREW_COLUMNS in the PDF and Word builders. */
const CREW_WIDTHS = [1750, 1500, 1700, 1000, 1900, 1550, 1486];
const CREW_TOTAL = CREW_WIDTHS.reduce((a, b) => a + b, 0);
const pct = (twips: number) => `${((twips / CREW_TOTAL) * 100).toFixed(2)}%`;

const MIN_CREW_ROWS = 6;
const DESCRIPTION_LINES = 13;
const SUPERVISOR_LINES = 9;

/** Splits text onto the ruled lines, padding out to `minLines`. */
function useRuled(text: string, minLines: number, perLine: number): string[] {
  return useMemo(() => {
    const lines: string[] = [];
    for (const raw of text.split(/\r?\n/)) {
      if (!raw.trim()) {
        lines.push('');
        continue;
      }
      let current = '';
      for (const word of raw.trim().split(/\s+/)) {
        const candidate = current ? `${current} ${word}` : word;
        if (candidate.length > perLine && current) {
          lines.push(current);
          current = word;
        } else {
          current = candidate;
        }
      }
      if (current) lines.push(current);
    }
    while (lines.length < minLines) lines.push('');
    return lines;
  }, [text, minLines, perLine]);
}

function HeaderBand({
  title,
  subtitle,
  detail,
  page,
  pages,
  companyLogo,
  t,
}: {
  title: string;
  subtitle: string;
  detail: string;
  page: number;
  pages: number;
  companyLogo?: string;
  t: Strings;
}) {
  return (
    <div className="sheet__band">
      <div className="sheet__band-start">
        <Logo size={26} />
        <div>
          <div className="sheet__band-title">{title}</div>
          <div className="sheet__band-sub">{subtitle}</div>
        </div>
      </div>
      <div className="sheet__band-end">
        {companyLogo && <img className="sheet__band-logo" src={companyLogo} alt="" />}
        <div>
          <div className="sheet__band-detail">{detail}</div>
          <div className="sheet__band-page">{t.docPage(page, pages)}</div>
        </div>
      </div>
    </div>
  );
}

function FooterBand({
  project,
  page,
  pages,
  t,
}: {
  project: Project;
  page: number;
  pages: number;
  t: Strings;
}) {
  const now = new Date();
  return (
    <div className="sheet__footer">
      <span>{project.company || project.name}</span>
      <span>
        {t.docGeneratedBy} · {formatDdMmYyyy(now.toISOString().slice(0, 10))}{' '}
        {now.toTimeString().slice(0, 5)}
      </span>
      <span>{t.docPage(page, pages)}</span>
    </div>
  );
}

function InfoPanel({
  heading,
  lines,
}: {
  heading: string;
  lines: [string, string][];
}) {
  return (
    <div className="sheet__panel">
      <div className="sheet__panel-head">{heading}</div>
      {lines.map(([label, value]) => (
        <div className="sheet__line" key={label}>
          <span className="sheet__line-label">{label}:</span>
          <span className="sheet__line-value">{value}</span>
        </div>
      ))}
    </div>
  );
}

export function SheetPreview({
  entry,
  project,
  companyLogo,
  pages = 1,
}: {
  entry: DiaryEntry;
  project: Project;
  companyLogo?: string;
  pages?: number;
}) {
  const { t, dir } = useLanguage();
  const description = useRuled(entry.workDescription, DESCRIPTION_LINES, 92);
  const notes = useRuled(entry.supervisorNotes, SUPERVISOR_LINES, 44);
  const rowCount = Math.max(
    MIN_CREW_ROWS,
    entry.management.length,
    entry.contractors.length,
    entry.equipment.length,
  );

  return (
    <div className="sheet" dir={dir}>
      <HeaderBand
        title={t.docWorkDiary}
        subtitle={project.name}
        detail={formatLongDate(entry.date, t)}
        page={1}
        pages={pages}
        companyLogo={companyLogo}
        t={t}
      />

      <div className="sheet__panels">
        <InfoPanel
          heading={t.labelProject}
          lines={[
            [t.labelProjectName, project.name],
            [t.labelAddress, project.address],
            [t.labelCompany, project.company],
          ]}
        />
        <InfoPanel
          heading={t.labelDateWeather}
          lines={[
            [t.labelDate, formatLongDate(entry.date, t)],
            [t.labelWeather, entry.weather],
          ]}
        />
      </div>

      <div className="sheet__section">{t.labelCrewSection}</div>

      <table className="sheet__grid">
        <colgroup>
          {CREW_WIDTHS.map((width, i) => (
            <col key={i} style={{ width: pct(width) }} />
          ))}
        </colgroup>
        <tbody>
          <tr className="sheet__group-row">
            <td colSpan={2}>{t.labelManagement}</td>
            <td colSpan={2}>{t.labelContractor}</td>
            <td colSpan={3}>{t.labelEquipment}</td>
          </tr>
          <tr className="sheet__col-row">
            <td>{t.labelName}</td>
            <td>{t.labelRole}</td>
            <td>{t.labelTrade}</td>
            <td className="sheet__col-row--tiny">{t.labelWorkers}</td>
            <td>{t.labelKind}</td>
            <td>{t.labelQty}</td>
            <td>{t.labelHours}</td>
          </tr>
          {Array.from({ length: rowCount }, (_, i) => {
            const staff = entry.management[i];
            const contractor = entry.contractors[i];
            const equipment = entry.equipment[i];
            return (
              <tr key={i}>
                <td>{staff?.name ?? ''}</td>
                <td>{staff?.role ?? ''}</td>
                <td>{contractor?.trade ?? ''}</td>
                <td>{contractor?.workers ?? ''}</td>
                <td>{equipment?.kind ?? ''}</td>
                <td>{equipment?.qty ?? ''}</td>
                <td>{equipment?.hours ?? ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="sheet__section">{t.labelWorkDescription}</div>

      <div className="sheet__body">
        <div className="sheet__ruled">
          {description.map((line, i) => (
            <div className="sheet__rule" key={i}>
              {line}
            </div>
          ))}
        </div>

        <div className="sheet__casting">
          <div className="sheet__casting-head">{t.labelCasting}</div>
          <div className="sheet__casting-row">
            <div className="sheet__casting-label">{t.labelDescription}</div>
            <div className="sheet__casting-value">
              <div>{entry.casting.description}</div>
              <div>
                <span className="sheet__sub">{t.labelSizeQty}:</span> {entry.casting.sizeQty}
              </div>
            </div>
          </div>
          <div className="sheet__casting-row">
            <div className="sheet__casting-label">{t.labelPump}</div>
            <div className="sheet__casting-value">{entry.casting.pump}</div>
          </div>
          <div className="sheet__casting-row">
            <div className="sheet__casting-label">{t.labelConcrete}</div>
            <div className="sheet__casting-value">
              <div>
                <span className="sheet__sub">{t.labelKind}:</span> {entry.casting.concreteType}
              </div>
              <div>
                <span className="sheet__sub">{t.labelQty}:</span> {entry.casting.concreteQty}
              </div>
            </div>
          </div>
          <div className="sheet__casting-notes">
            <div>
              <span className="sheet__sub">{t.labelNotes}:</span> {entry.casting.notes}
            </div>
            <div>
              <span className="sheet__sub">{t.labelConcreteType}:</span> {entry.casting.notesConcreteType}
            </div>
          </div>
        </div>
      </div>

      <div className="sheet__body sheet__body--footer">
        <div className="sheet__notes">
          <div className="sheet__notes-head">{t.labelSupervisorNotes}</div>
          {notes.map((line, i) => (
            <div className="sheet__rule" key={i}>
              {line}
            </div>
          ))}
        </div>
        <div className="sheet__signatures">
          {[
            [t.labelSupervisorSignature, entry.supervisorSignature],
            [t.labelManagerSignature, entry.managerSignature],
          ].map(([label, src]) => (
            <div className="sheet__sign" key={label}>
              <div className="sheet__sign-label">{label}</div>
              {src ? <img src={src} alt={label} /> : <div className="sheet__sign-line" />}
            </div>
          ))}
        </div>
      </div>

      <FooterBand project={project} page={1} pages={pages} t={t} />
    </div>
  );
}

/** Second sheet: the photo appendix, matching the PDF's appendix page. */
export function PhotoSheet({
  entry,
  project,
  companyLogo,
  pages = 2,
}: {
  entry: DiaryEntry;
  project: Project;
  companyLogo?: string;
  pages?: number;
}) {
  const { t, dir } = useLanguage();
  const [urls, setUrls] = useState<string[]>([]);

  // Mint and revoke in one effect: a URL created during render can outlive the
  // cleanup that revokes it, leaving broken images behind.
  useEffect(() => {
    const made = entry.photos.map((photo) => URL.createObjectURL(photo.blob));
    setUrls(made);
    return () => {
      for (const url of made) URL.revokeObjectURL(url);
    };
  }, [entry.photos]);

  if (entry.photos.length === 0) return null;

  return (
    <div className="sheet sheet--photos" dir={dir}>
      <HeaderBand
        title={t.docPhotoAppendix}
        subtitle={project.name}
        detail={formatLongDate(entry.date, t)}
        page={2}
        pages={pages}
        companyLogo={companyLogo}
        t={t}
      />
      <div className="sheet__photos">
        {entry.photos.map((photo, i) => (
          <figure className="sheet__photo" key={photo.id}>
            <img src={urls[i]} alt={photo.caption || t.photoNumber(i + 1)} />
            <figcaption>{photo.caption || t.photoNumber(i + 1)}</figcaption>
          </figure>
        ))}
      </div>
      <FooterBand project={project} page={2} pages={pages} t={t} />
    </div>
  );
}
