import type { EmulatorCore } from '../shared/emulator';

export type RomMetadata = {
  title: string;
  titleSource: 'header' | 'filename';
};

const getTitleFromFileName = (fileName: string) => {
  const parts = fileName.split('.');

  if (parts.length <= 1) {
    return fileName.trim();
  }

  parts.pop();

  return parts.join('.').trim();
};

const cleanTitle = (value: string) => {
  return value.replace(/\s+/g, ' ').trim();
};

const decodeAscii = (bytes: Uint8Array) => {
  const value = Array.from(bytes)
    .map((byte) => {
      if (byte >= 32 && byte <= 126) {
        return String.fromCharCode(byte);
      }

      return ' ';
    })
    .join('');

  return cleanTitle(value);
};

const readBytes = async (file: File, start: number, length: number) => {
  if (start >= file.size) {
    return new Uint8Array();
  }

  const buffer = await file.slice(start, start + length).arrayBuffer();

  return new Uint8Array(buffer);
};

const firstReadableTitle = (candidates: string[]) => {
  return candidates.find((candidate) => candidate.length >= 2) ?? null;
};

const readTitleCandidate = async (
  file: File,
  start: number,
  length: number
) => {
  return decodeAscii(await readBytes(file, start, length));
};

const readHeaderTitle = async (file: File, core: EmulatorCore) => {
  if (core === 'gb') {
    return firstReadableTitle([await readTitleCandidate(file, 0x0134, 16)]);
  }

  if (core === 'gba') {
    return firstReadableTitle([await readTitleCandidate(file, 0x00a0, 12)]);
  }

  if (core === 'n64') {
    return firstReadableTitle([await readTitleCandidate(file, 0x0020, 20)]);
  }

  if (core === 'segaMD') {
    return firstReadableTitle([
      await readTitleCandidate(file, 0x0150, 48),
      await readTitleCandidate(file, 0x0120, 48),
    ]);
  }

  if (core === 'snes') {
    return firstReadableTitle([
      await readTitleCandidate(file, 0x7fc0, 21),
      await readTitleCandidate(file, 0xffc0, 21),
    ]);
  }

  return null;
};

export const detectRomMetadata = async (
  file: File,
  core: EmulatorCore
): Promise<RomMetadata> => {
  const fallback = getTitleFromFileName(file.name);

  try {
    const headerTitle = await readHeaderTitle(file, core);

    if (headerTitle) {
      return {
        title: headerTitle,
        titleSource: 'header',
      };
    }
  } catch (error) {
    console.warn('Unable to read ROM metadata', error);
  }

  return {
    title: fallback,
    titleSource: 'filename',
  };
};
