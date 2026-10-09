/*
 * Encodings Codepad can read and write. `id` is the encoding_rs name the backend uses;
 * `bom` only matters for the Unicode ones.
 */
export interface EncodingOption {
  label: string;
  id: string;
  bom: boolean;
}

const o = (label: string, id: string, bom = false): EncodingOption => ({ label, id, bom });

export const ENCODINGS: EncodingOption[] = [
  o('UTF-8', 'UTF-8'),
  o('UTF-8 with BOM', 'UTF-8', true),
  o('UTF-16 LE', 'UTF-16LE', true),
  o('UTF-16 BE', 'UTF-16BE', true),
  o('Western (Windows 1252)', 'windows-1252'),
  o('Western (ISO 8859-15)', 'ISO-8859-15'),
  o('Central European (Windows 1250)', 'windows-1250'),
  o('Central European (ISO 8859-2)', 'ISO-8859-2'),
  o('Cyrillic (Windows 1251)', 'windows-1251'),
  o('Cyrillic (KOI8-R)', 'KOI8-R'),
  o('Greek (Windows 1253)', 'windows-1253'),
  o('Turkish (Windows 1254)', 'windows-1254'),
  o('Hebrew (Windows 1255)', 'windows-1255'),
  o('Arabic (Windows 1256)', 'windows-1256'),
  o('Baltic (Windows 1257)', 'windows-1257'),
  o('Vietnamese (Windows 1258)', 'windows-1258'),
  o('Mac Roman', 'macintosh'),
  o('Japanese (Shift JIS)', 'Shift_JIS'),
  o('Japanese (EUC-JP)', 'EUC-JP'),
  o('Korean (EUC-KR)', 'EUC-KR'),
  o('Chinese Simplified (GBK)', 'GBK'),
  o('Chinese Simplified (GB18030)', 'gb18030'),
  o('Chinese Traditional (Big5)', 'Big5'),
];

/** The name shown in the status bar and pickers. */
export function encodingLabel(id: string, bom: boolean): string {
  const exact = ENCODINGS.find((e) => e.id === id && e.bom === bom);
  if (exact) return exact.label;
  if (id === 'UTF-8') return bom ? 'UTF-8 with BOM' : 'UTF-8';
  return ENCODINGS.find((e) => e.id === id)?.label ?? id;
}
