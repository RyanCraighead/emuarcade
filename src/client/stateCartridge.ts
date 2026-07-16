import {
  calculateStateCartridgeSha256,
  encodeStateCartridgeBase64,
  joinStateCartridgePayload,
  splitStateCartridgePayload,
  stateCartridgeChunkRefSchema,
  stateCartridgeManifestSchema,
  stateCartridgeManifestUploadResultSchema,
} from '../shared/stateCartridge';
import type {
  StateCartridgeChunkRef,
  StateCartridgeManifest,
} from '../shared/stateCartridge';
import type { SharedStatePostData } from '../shared/sharedState';

export type StateCartridgeProgress = {
  completed: number;
  total: number;
  phase: 'download' | 'manifest' | 'upload';
};

const readApiError = async (response: Response, fallback: string) => {
  const payload: unknown = await response.json().catch(() => null);

  if (
    payload !== null &&
    typeof payload === 'object' &&
    typeof Reflect.get(payload, 'error') === 'string'
  ) {
    return Reflect.get(payload, 'error');
  }

  return fallback;
};

const uploadChunk = async (
  payload: Uint8Array,
  index: number,
  count: number
) => {
  const response = await fetch('/api/state-cartridge/chunk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: encodeStateCartridgeBase64(payload),
      index,
      count,
    }),
  });

  if (!response.ok) {
    throw new Error(
      await readApiError(response, 'Could not upload State Cartridge chunk')
    );
  }

  return stateCartridgeChunkRefSchema.parse(await response.json());
};

const uploadManifest = async (manifest: StateCartridgeManifest) => {
  const response = await fetch('/api/state-cartridge/manifest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(manifest),
  });

  if (!response.ok) {
    throw new Error(
      await readApiError(response, 'Could not upload State Cartridge manifest')
    );
  }

  return stateCartridgeManifestUploadResultSchema.parse(await response.json());
};

export const uploadStateCartridge = async (
  compressedPayload: Uint8Array,
  onProgress?: (progress: StateCartridgeProgress) => void
) => {
  const payloads = splitStateCartridgePayload(compressedPayload);
  const chunks: StateCartridgeChunkRef[] = [];

  for (let index = 0; index < payloads.length; index += 1) {
    const payload = payloads[index];

    if (!payload) {
      throw new Error('State Cartridge chunk is missing');
    }

    onProgress?.({ completed: index, total: payloads.length, phase: 'upload' });
    chunks.push(await uploadChunk(payload, index, payloads.length));
  }

  onProgress?.({
    completed: payloads.length,
    total: payloads.length,
    phase: 'manifest',
  });

  const manifest: StateCartridgeManifest = {
    v: 1,
    n: compressedPayload.byteLength,
    h: await calculateStateCartridgeSha256(compressedPayload),
    chunks,
  };
  const result = await uploadManifest(manifest);

  return result.mediaUrl;
};

const downloadManifest = async (mediaUrl: string) => {
  const query = new URLSearchParams({ url: mediaUrl });
  const response = await fetch(`/api/state-cartridge/manifest?${query}`);

  if (!response.ok) {
    throw new Error(
      await readApiError(
        response,
        'Could not download State Cartridge manifest'
      )
    );
  }

  return stateCartridgeManifestSchema.parse(await response.json());
};

const downloadChunk = async (
  reference: StateCartridgeChunkRef,
  index: number,
  count: number
) => {
  const query = new URLSearchParams({ url: reference.u });
  const response = await fetch(`/api/state-cartridge/chunk?${query}`);

  if (!response.ok) {
    throw new Error(
      await readApiError(response, 'Could not download State Cartridge chunk')
    );
  }

  const returnedIndex = Number(response.headers.get('X-EmuArcade-Chunk-Index'));
  const returnedCount = Number(response.headers.get('X-EmuArcade-Chunk-Count'));
  const payload = new Uint8Array(await response.arrayBuffer());

  if (
    returnedIndex !== index ||
    returnedCount !== count ||
    payload.byteLength !== reference.z ||
    (await calculateStateCartridgeSha256(payload)) !== reference.h
  ) {
    throw new Error('Downloaded State Cartridge chunk failed verification');
  }

  return payload;
};

export const downloadStateCartridge = async (
  postData: SharedStatePostData,
  onProgress?: (progress: StateCartridgeProgress) => void
) => {
  if (!postData.m || !postData.b) {
    throw new Error('Shared checkpoint has incomplete State Cartridge data');
  }

  onProgress?.({ completed: 0, total: 1, phase: 'manifest' });
  const manifest = await downloadManifest(postData.m);

  if (manifest.n !== postData.b) {
    throw new Error('State Cartridge length does not match the checkpoint');
  }

  const payloads: Uint8Array[] = [];

  for (let index = 0; index < manifest.chunks.length; index += 1) {
    const reference = manifest.chunks[index];

    if (!reference) {
      throw new Error('State Cartridge manifest has a missing chunk');
    }

    onProgress?.({
      completed: index,
      total: manifest.chunks.length,
      phase: 'download',
    });
    payloads.push(
      await downloadChunk(reference, index, manifest.chunks.length)
    );
  }

  const payload = joinStateCartridgePayload(payloads, manifest.n);

  if ((await calculateStateCartridgeSha256(payload)) !== manifest.h) {
    throw new Error('State Cartridge payload failed verification');
  }

  onProgress?.({
    completed: manifest.chunks.length,
    total: manifest.chunks.length,
    phase: 'download',
  });

  return payload;
};
