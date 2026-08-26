/**
 * Domain model for the construction site work diary (יומן עבודה).
 *
 * Field names mirror the printed A4 form in
 * "יומן עבודה לעבודות בנייה.pdf" one-to-one, so that the Word export can be a
 * faithful replica. The Hebrew label of every field is noted in a comment.
 */

/** פרויקט — a construction site. Every diary entry belongs to one. */
export interface Project {
  id?: number;
  /**
   * Stable identity across devices. The numeric `id` is a local auto-increment
   * key and collides between the phone and the Mac, so sync matches on this.
   */
  uid: string;
  /** שם הפרויקט */
  name: string;
  /** כתובת */
  address: string;
  /** שם חברה */
  company: string;
  archived: boolean;
  createdAt: number;
}

/** צוות הנהלה — one line in the management-team columns. */
export interface ManagementRow {
  id: string;
  /** שם */
  name: string;
  /** תפקיד */
  role: string;
}

/** קבלן — one line in the contractor columns. */
export interface ContractorRow {
  id: string;
  /** מקצוע */
  trade: string;
  /** כמות עובדים */
  workers: string;
}

/** ציוד — one line in the equipment columns. */
export interface EquipmentRow {
  id: string;
  /** סוג */
  kind: string;
  /** כמות */
  qty: string;
  /** שט"ע (שעות עבודה) */
  hours: string;
}

/** פרטי יציקה — the casting/pour box beside the work description. */
export interface CastingDetails {
  /** תיאור */
  description: string;
  /** גודל-כמות */
  sizeQty: string;
  /** משאבה */
  pump: string;
  /** סוג בטון */
  concreteType: string;
  /** כמות בטון (מ"ק) */
  concreteQty: string;
  /** הערות */
  notes: string;
  /** סוג בטון — the second, free line at the bottom of the box */
  notesConcreteType: string;
}

/** A site photo attached to a diary entry, kept as a Blob inside IndexedDB. */
export interface Photo {
  id: string;
  caption: string;
  /**
   * The JPEG itself.
   *
   * Bytes rather than a `Blob`, and that is not a detail: a Blob in IndexedDB
   * lives in a file beside the database, and on iOS installing a new build of
   * the app breaks the reference to it — the record survives and the picture
   * does not. See `src/lib/photoData.ts`.
   */
  bytes?: Uint8Array;
  /** How photos were stored before that. Still read; never written. */
  blob?: Blob;
  /** Pixel dimensions after downscaling, used to lay the photo out in Word. */
  width: number;
  height: number;
  takenAt: number;
}

export type EntryStatus = 'draft' | 'signed';

/** One day of the diary — one printed page of the form. */
export interface DiaryEntry {
  id?: number;
  /** Stable identity across devices — see Project.uid. */
  uid: string;
  /** The owning project's uid, so an entry can be matched before ids exist. */
  projectUid: string;
  projectId: number;
  /** תאריך — ISO `yyyy-mm-dd`, the natural sort key */
  date: string;
  /** מזג אוויר */
  weather: string;
  management: ManagementRow[];
  contractors: ContractorRow[];
  equipment: EquipmentRow[];
  /** תיאור העבודה שבוצעה */
  workDescription: string;
  casting: CastingDetails;
  /** הערות המפקח */
  supervisorNotes: string;
  /**
   * התקבל היום — what was delivered to the site that day.
   *
   * Added to the printed form after the app was first built from it, so it is
   * optional: a page written by an earlier version, or arriving from a backup
   * or a device that has not been updated, simply has nothing to say here.
   */
  receivedToday?: string;
  /** חתימת מפקח — PNG data URL */
  supervisorSignature: string;
  /** חתימת מנ"ע — PNG data URL */
  managerSignature: string;
  photos: Photo[];
  status: EntryStatus;
  /**
   * Held at the top of the diary list.
   *
   * A property of the day, not of the device: the page you keep coming back to
   * is the same one on the phone and on the Mac, so this travels with the record
   * rather than living in localStorage beside the view and sort settings.
   * Optional — a page from an older version or an older backup is simply
   * unpinned.
   */
  pinned?: boolean;
  /**
   * In the trash since this moment — out of the diary, but not gone.
   *
   * Deleting a page is a soft delete now. A day's page is the record of what
   * happened on a site, and the seven seconds of an undo toast is not long
   * enough to notice that the wrong one went; emptying the trash is what
   * actually destroys it, and that is the only path that writes a tombstone.
   *
   * It travels like any other field, so the trash is the same on the phone and
   * on the Mac. Optional, so a page written before the trash existed — or
   * arriving from a device that has not been updated — is simply not in it.
   */
  deletedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * ספקים וקבלנים — one line of the site's own address book.
 *
 * Not part of the printed form, and deliberately not tied to a project: the
 * point of the list is that the same plasterer or crane supplier turns up on
 * the next job, and the number is already there. `projects` is therefore free
 * text — "which sites did he work with me on" — rather than a link to a
 * `Project` record, because the useful answer often names a job that predates
 * the app or was never kept in it.
 */
export interface Contact {
  id?: number;
  /** Stable identity across devices — see Project.uid. */
  uid: string;
  /** שם קבלן או ספק */
  name: string;
  /** תחום התעסקות */
  trade: string;
  /** מספר טלפון */
  phone: string;
  /** באיזה פרויקט עבד איתי */
  projects: string;
  /** הערות כלליות */
  notes: string;
  createdAt: number;
  updatedAt: number;
}

/** The fields a line can arrive with from a file — everything else is minted. */
export type ContactDraft = Partial<
  Pick<Contact, 'name' | 'trade' | 'phone' | 'projects' | 'notes'>
>;

/**
 * Remembered values that feed the dropdowns. Entries learn from themselves:
 * saving a diary page upserts every value it used, ranked by `uses`.
 */
export type PresetKind =
  | 'staff'
  | 'role'
  | 'trade'
  | 'equipment'
  | 'weather'
  | 'concreteType';

export interface Preset {
  id?: number;
  kind: PresetKind;
  value: string;
  uses: number;
  updatedAt: number;
}

/** An entry joined with its project, as needed by the Word builders. */
export interface EntryWithProject {
  entry: DiaryEntry;
  project: Project;
}

/**
 * A record of something deleted, kept so the deletion can travel to the other
 * device instead of the record simply reappearing on the next sync.
 */
export interface Tombstone {
  uid: string;
  table: TombstoneTable;
  deletedAt: number;
}

/** Every table whose deletions have to travel. */
export type TombstoneTable = 'projects' | 'entries' | 'contacts';

export const emptyCasting = (): CastingDetails => ({
  description: '',
  sizeQty: '',
  pump: '',
  concreteType: '',
  concreteQty: '',
  notes: '',
  notesConcreteType: '',
});
