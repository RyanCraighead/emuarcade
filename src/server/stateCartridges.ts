import { media } from '@devvit/web/server';
import {
  MAX_STATE_CARTRIDGE_PNG_BYTES,
  STATE_CARTRIDGE_CHUNK_BYTES,
  calculateStateCartridgeSha256,
  decodeStateCartridgeBase64,
  decodeStateCartridgeManifest,
  decodeStateCartridgePng,
  encodeStateCartridgeManifest,
  encodeStateCartridgePng,
  joinStateCartridgePayload,
  stateCartridgeBytesEqual,
  stateCartridgeManifestSchema,
  stateCartridgeUrlSchema,
} from '../shared/stateCartridge';
import type {
  StateCartridgeChunkUploadInput,
  StateCartridgeChunkUploadResult,
  StateCartridgeManifest,
  StateCartridgeManifestUploadResult,
} from '../shared/stateCartridge';

const FETCH_ATTEMPTS = 3;
const FETCH_TIMEOUT_MS = 8_000;
const REDDIT_MEDIA_HOSTNAMES = new Set(['i.redd.it', 'preview.redd.it']);

const encodeStandardBase64 = (bytes: Uint8Array) => {
  let binary = '';
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize)
    );
  }

  return btoa(binary);
};

const toPngDataUrl = (bytes: Uint8Array) => {
  return `data:image/png;base64,${encodeStandardBase64(bytes)}`;
};

const wait = async (milliseconds: number) => {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
};

export const assertRedditMediaUrl = (value: string) => {
  const parsedValue = stateCartridgeUrlSchema.parse(value);
  const url = new URL(parsedValue);
  const hostname = url.hostname.toLowerCase();

  if (url.protocol !== 'https:' || !REDDIT_MEDIA_HOSTNAMES.has(hostname)) {
    throw new Error('State Cartridge must use a Reddit-hosted media URL');
  }

  return url.toString();
};

const fetchStateCartridgePng = async (mediaUrl: string) => {
  const url = assertRedditMediaUrl(mediaUrl);
  let lastError: unknown = null;

  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'image/png,image/*;q=0.8' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`Reddit media returned HTTP ${response.status}`);
      }

      const contentLength = Number(response.headers.get('content-length'));

      if (
        Number.isFinite(contentLength) &&
        contentLength > MAX_STATE_CARTRIDGE_PNG_BYTES
      ) {
        throw new Error('State Cartridge PNG exceeds the safe size limit');
      }

      const bytes = new Uint8Array(await response.arrayBuffer());

      if (bytes.byteLength > MAX_STATE_CARTRIDGE_PNG_BYTES) {
        throw new Error('State Cartridge PNG exceeds the safe size limit');
      }

      return bytes;
    } catch (error) {
      lastError = error;

      if (attempt + 1 < FETCH_ATTEMPTS) {
        await wait(250 * (attempt + 1));
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Unable to retrieve State Cartridge media');
};

const uploadAndVerifyPng = async (
  png: Uint8Array,
  expected: {
    kind: 'chunk' | 'manifest';
    index: number;
    count: number;
    payload: Uint8Array;
  }
) => {
  const uploaded = await media.upload({
    type: 'image',
    url: toPngDataUrl(png),
  });
  const roundTripPng = await fetchStateCartridgePng(uploaded.mediaUrl);
  const roundTrip = decodeStateCartridgePng(roundTripPng);

  if (
    roundTrip.kind !== expected.kind ||
    roundTrip.index !== expected.index ||
    roundTrip.count !== expected.count ||
    !stateCartridgeBytesEqual(roundTrip.payload, expected.payload)
  ) {
    throw new Error('Reddit changed the State Cartridge during upload');
  }

  return assertRedditMediaUrl(uploaded.mediaUrl);
};

export const uploadStateCartridgeChunk = async (
  input: StateCartridgeChunkUploadInput
): Promise<StateCartridgeChunkUploadResult> => {
  const payload = decodeStateCartridgeBase64(input.data);

  if (
    payload.byteLength < 1 ||
    payload.byteLength > STATE_CARTRIDGE_CHUNK_BYTES
  ) {
    throw new Error('State Cartridge chunk exceeds the safe size limit');
  }

  const png = encodeStateCartridgePng(payload, {
    kind: 'chunk',
    index: input.index,
    count: input.count,
  });
  const mediaUrl = await uploadAndVerifyPng(png, {
    kind: 'chunk',
    index: input.index,
    count: input.count,
    payload,
  });

  return {
    u: mediaUrl,
    z: payload.byteLength,
    h: await calculateStateCartridgeSha256(payload),
  };
};

export const readStateCartridgeChunk = async (mediaUrl: string) => {
  const png = await fetchStateCartridgePng(mediaUrl);
  const cartridge = decodeStateCartridgePng(png);

  if (cartridge.kind !== 'chunk') {
    throw new Error('State Cartridge URL does not contain a state chunk');
  }

  return cartridge;
};

const verifyManifestChunks = async (manifest: StateCartridgeManifest) => {
  const payloads: Uint8Array[] = [];

  for (let index = 0; index < manifest.chunks.length; index += 1) {
    const reference = manifest.chunks[index];

    if (!reference) {
      throw new Error('State Cartridge manifest has a missing chunk');
    }

    const cartridge = await readStateCartridgeChunk(reference.u);

    if (
      cartridge.index !== index ||
      cartridge.count !== manifest.chunks.length ||
      cartridge.payload.byteLength !== reference.z ||
      (await calculateStateCartridgeSha256(cartridge.payload)) !== reference.h
    ) {
      throw new Error('State Cartridge chunk does not match its manifest');
    }

    payloads.push(cartridge.payload);
  }

  const payload = joinStateCartridgePayload(payloads, manifest.n);

  if ((await calculateStateCartridgeSha256(payload)) !== manifest.h) {
    throw new Error('State Cartridge payload does not match its manifest');
  }
};

export const uploadStateCartridgeManifest = async (
  value: StateCartridgeManifest
): Promise<StateCartridgeManifestUploadResult> => {
  const manifest = stateCartridgeManifestSchema.parse(value);

  manifest.chunks.forEach((chunk) => assertRedditMediaUrl(chunk.u));
  await verifyManifestChunks(manifest);

  const payload = encodeStateCartridgeManifest(manifest);
  const png = encodeStateCartridgePng(payload, { kind: 'manifest' });
  const mediaUrl = await uploadAndVerifyPng(png, {
    kind: 'manifest',
    index: 0,
    count: 1,
    payload,
  });

  return { mediaUrl };
};

export const readStateCartridgeManifest = async (mediaUrl: string) => {
  const png = await fetchStateCartridgePng(mediaUrl);
  const cartridge = decodeStateCartridgePng(png);

  if (cartridge.kind !== 'manifest') {
    throw new Error('State Cartridge URL does not contain a manifest');
  }

  const manifest = decodeStateCartridgeManifest(cartridge.payload);
  manifest.chunks.forEach((chunk) => assertRedditMediaUrl(chunk.u));

  return manifest;
};
