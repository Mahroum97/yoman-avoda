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
  blob: Blob;
  /** Pixel dimensions after downscaling, used to lay the photo out in Word. */
  width: number;
  height: number;
  takenAt: number;
}

export type EntryStatus = 'draft' | 'signed';

/** One day of the diary — one printed page of the form. */
export interface DiaryEntry {
  id?: number;
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
  /** חתימת מפקח — PNG data URL */
  supervisorSignature: string;
  /** חתימת מנ"ע — PNG data URL */
  managerSignature: string;
  photos: Photo[];
  status: EntryStatus;
  createdAt: number;
  updatedAt: number;
}

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

export const emptyCasting = (): CastingDetails => ({
  description: '',
  sizeQty: '',
  pump: '',
  concreteType: '',
  concreteQty: '',
  notes: '',
  notesConcreteType: '',
});
