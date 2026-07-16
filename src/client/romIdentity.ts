import type { EmulatorCore } from '../shared/emulator';

const SAMPLE_BYTES = 64 * 1024;

const encodeBase64Url = (bytes: Uint8Array) => {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
};

export const createRomFingerprint = async (
  rom: Blob,
  core: EmulatorCore
) => {
  const head = new Uint8Array(
    await rom.slice(0, Math.min(SAMPLE_BYTES, rom.size)).arrayBuffer()
  );
  const tailStart = Math.max(0, rom.size - SAMPLE_BYTES);
  const tail = new Uint8Array(await rom.slice(tailStart).arrayBuffer());
  const metadata = new TextEncoder().encode(`${core}:${rom.size}:`);
  const sampled = new Uint8Array(
    metadata.byteLength + head.byteLength + tail.byteLength
  );

  sampled.set(metadata, 0);
  sampled.set(head, metadata.byteLength);
  sampled.set(tail, metadata.byteLength + head.byteLength);

  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', sampled)
  );

  return encodeBase64Url(digest.subarray(0, 12));
};
