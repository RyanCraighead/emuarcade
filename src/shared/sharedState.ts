import { deflateSync, inflateSync } from 'fflate';
import { z } from 'zod';
import { isEmulatorCore } from './emulator';
import type { EmulatorCore } from './emulator';

export const MAX_SHARED_POST_DATA_BYTES = 1_800;

export type SharedStateCodec = 'd' | 'p' | 'x';
export type SharedStatePreviewKind = 'gif' | 'hidden' | 'image';

export type SharedStatePostData = {
  v: 1;
  k: 's';
  c: EmulatorCore;
  g: string;
  r: string;
  e: SharedStateCodec;
  s: string;
  z: number;
  a: string;
  p?: string;
  q?: 'g' | 'i';
  h?: 1;
};

export type EncodedSharedState = {
  postData: SharedStatePostData;
  compressedBytes: number;
  postDataBytes: number;
  rawBytes: number;
  fits: boolean;
};

export type SharedStateShareInput = {
  postData: SharedStatePostData;
  previewDataUrl: string | null;
  previewKind: SharedStatePreviewKind;
  title: string;
};

export type SharedStateShareResult = {
  mediaUrl: string | null;
  postDataBytes: number;
  postId: string;
  postUrl: string;
  subredditName: string;
};

export type SharedStateCommentInput = {
  postId: string;
  text: string;
};

type CompressionCandidate = {
  codec: SharedStateCodec;
  bytes: Uint8Array;
};

const sharedStatePostDataShape = z.object({
  v: z.literal(1),
  k: z.literal('s'),
  c: z.string().refine(isEmulatorCore),
  g: z.string().trim().min(1).max(80),
  r: z.string().min(8).max(64),
  e: z.enum(['d', 'p', 'x']),
  s: z.string().min(1).max(2_000),
  z: z.number().int().positive(),
  a: z.string().min(1).max(16),
  p: z.string().url().max(512).optional(),
  q: z.enum(['g', 'i']).optional(),
  h: z.literal(1).optional(),
});

const normalizeSharedStatePostData = (
  value: z.infer<typeof sharedStatePostDataShape>
): SharedStatePostData => {
  return {
    v: value.v,
    k: value.k,
    c: value.c,
    g: value.g,
    r: value.r,
    e: value.e,
    s: value.s,
    z: value.z,
    a: value.a,
    ...(value.p ? { p: value.p } : {}),
    ...(value.q ? { q: value.q } : {}),
    ...(value.h ? { h: value.h } : {}),
  };
};

export const sharedStateShareInputSchema = z.object({
  postData: sharedStatePostDataShape.transform(normalizeSharedStatePostData),
  previewDataUrl: z
    .string()
    .startsWith('data:')
    .max(28_000_000)
    .nullable(),
  previewKind: z.enum(['gif', 'hidden', 'image']),
  title: z.string().trim().min(1).max(120),
});

export const sharedStateCommentInputSchema = z.object({
  postId: z.string().regex(/^t3_[a-z0-9]+$/i),
  text: z.string().trim().min(1).max(10_000),
});

const encodeBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
};

const decodeBase64Url = (value: string) => {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

const calculateChecksum = (bytes: Uint8Array) => {
  let hash = 0x811c9dc5;

  for (const byte of bytes) {
    hash = Math.imul(hash ^ byte, 0x01000193);
  }

  return (hash >>> 0).toString(36);
};

const encodeDelta = (bytes: Uint8Array) => {
  const encoded = new Uint8Array(bytes.length);
  let previous = 0;

  for (let index = 0; index < bytes.length; index += 1) {
    const value = bytes[index] ?? 0;

    encoded[index] = (value - previous + 256) & 0xff;
    previous = value;
  }

  return encoded;
};

const decodeDelta = (bytes: Uint8Array) => {
  const decoded = new Uint8Array(bytes.length);
  let previous = 0;

  for (let index = 0; index < bytes.length; index += 1) {
    const value = ((bytes[index] ?? 0) + previous) & 0xff;

    decoded[index] = value;
    previous = value;
  }

  return decoded;
};

const encodePageXor = (bytes: Uint8Array) => {
  const encoded = new Uint8Array(bytes.length);

  for (let index = 0; index < bytes.length; index += 1) {
    encoded[index] =
      index < 256
        ? (bytes[index] ?? 0)
        : (bytes[index] ?? 0) ^ (bytes[index - 256] ?? 0);
  }

  return encoded;
};

const decodePageXor = (bytes: Uint8Array) => {
  const decoded = new Uint8Array(bytes.length);

  for (let index = 0; index < bytes.length; index += 1) {
    decoded[index] =
      index < 256
        ? (bytes[index] ?? 0)
        : (bytes[index] ?? 0) ^ (decoded[index - 256] ?? 0);
  }

  return decoded;
};

const compressCandidate = (
  codec: SharedStateCodec,
  bytes: Uint8Array
): CompressionCandidate => {
  return {
    codec,
    bytes: deflateSync(bytes, { level: 9 }),
  };
};

const getSmallestCompression = (bytes: Uint8Array) => {
  const candidates = [
    compressCandidate('d', bytes),
    compressCandidate('x', encodeDelta(bytes)),
    compressCandidate('p', encodePageXor(bytes)),
  ];
  let smallest = candidates[0];

  if (!smallest) {
    throw new Error('Unable to compress save state');
  }

  for (const candidate of candidates.slice(1)) {
    if (candidate.bytes.byteLength < smallest.bytes.byteLength) {
      smallest = candidate;
    }
  }

  return smallest;
};

export const measurePostDataBytes = (postData: SharedStatePostData) => {
  return new TextEncoder().encode(JSON.stringify(postData)).byteLength;
};

export const encodeSharedState = (
  bytes: Uint8Array,
  metadata: {
    core: EmulatorCore;
    gameTitle: string;
    romFingerprint: string;
  }
): EncodedSharedState => {
  if (bytes.byteLength === 0) {
    throw new Error('Save state is empty');
  }

  const compressed = getSmallestCompression(bytes);
  const postData: SharedStatePostData = {
    v: 1,
    k: 's',
    c: metadata.core,
    g: metadata.gameTitle.trim().slice(0, 80),
    r: metadata.romFingerprint,
    e: compressed.codec,
    s: encodeBase64Url(compressed.bytes),
    z: bytes.byteLength,
    a: calculateChecksum(bytes),
  };
  const postDataBytes = measurePostDataBytes(postData);

  return {
    postData,
    compressedBytes: compressed.bytes.byteLength,
    postDataBytes,
    rawBytes: bytes.byteLength,
    fits: postDataBytes <= MAX_SHARED_POST_DATA_BYTES,
  };
};

export const decodeSharedState = (postData: SharedStatePostData) => {
  const inflated = inflateSync(decodeBase64Url(postData.s));
  const decoded =
    postData.e === 'x'
      ? decodeDelta(inflated)
      : postData.e === 'p'
        ? decodePageXor(inflated)
        : inflated;

  if (decoded.byteLength !== postData.z) {
    throw new Error('Shared save state has an invalid length');
  }

  if (calculateChecksum(decoded) !== postData.a) {
    throw new Error('Shared save state failed its integrity check');
  }

  return decoded;
};

export const parseSharedStatePostData = (
  value: unknown
): SharedStatePostData | null => {
  const parsed = sharedStatePostDataShape.safeParse(value);

  if (!parsed.success || !isEmulatorCore(parsed.data.c)) {
    return null;
  }

  return normalizeSharedStatePostData(parsed.data);
};

export const withSharedStatePreview = (
  postData: SharedStatePostData,
  mediaUrl: string | null,
  previewKind: SharedStatePreviewKind
): SharedStatePostData => {
  const basePostData: SharedStatePostData = {
    v: postData.v,
    k: postData.k,
    c: postData.c,
    g: postData.g,
    r: postData.r,
    e: postData.e,
    s: postData.s,
    z: postData.z,
    a: postData.a,
  };

  if (previewKind === 'hidden' || !mediaUrl) {
    return { ...basePostData, h: 1 };
  }

  return {
    ...basePostData,
    p: mediaUrl,
    q: previewKind === 'gif' ? 'g' : 'i',
  };
};
