import { unzlibSync, zlibSync } from 'fflate';
import { z } from 'zod';

export const STATE_CARTRIDGE_CHUNK_BYTES = 2_000_000;
export const MAX_STATE_CARTRIDGE_CHUNKS = 32;
export const MAX_STATE_CARTRIDGE_BYTES =
  STATE_CARTRIDGE_CHUNK_BYTES * MAX_STATE_CARTRIDGE_CHUNKS;
export const MAX_STATE_CARTRIDGE_PNG_BYTES = 4 * 1024 * 1024;

export type StateCartridgeKind = 'chunk' | 'manifest';

export type StateCartridgeChunkRef = {
  u: string;
  z: number;
  h: string;
};

export type StateCartridgeManifest = {
  v: 1;
  n: number;
  h: string;
  chunks: StateCartridgeChunkRef[];
};

export type StateCartridgeChunkUploadInput = z.infer<
  typeof stateCartridgeChunkUploadInputSchema
>;

export type StateCartridgeChunkUploadResult = StateCartridgeChunkRef;

export type StateCartridgeManifestUploadInput = StateCartridgeManifest;

export type StateCartridgeManifestUploadResult = {
  mediaUrl: string;
};

export type DecodedStateCartridge = {
  kind: StateCartridgeKind;
  index: number;
  count: number;
  payload: Uint8Array;
};

const PNG_SIGNATURE = Uint8Array.of(
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a
);
const CARTRIDGE_MAGIC = new TextEncoder().encode('EACART01');
const CARTRIDGE_HEADER_BYTES = 22;
const MAX_PNG_DIMENSION = 2_048;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export const stateCartridgeChunkRefSchema = z.object({
  u: z.string().url().max(512),
  z: z.number().int().positive().max(STATE_CARTRIDGE_CHUNK_BYTES),
  h: z.string().regex(SHA256_PATTERN),
});

export const stateCartridgeManifestSchema = z
  .object({
    v: z.literal(1),
    n: z.number().int().positive().max(MAX_STATE_CARTRIDGE_BYTES),
    h: z.string().regex(SHA256_PATTERN),
    chunks: z
      .array(stateCartridgeChunkRefSchema)
      .min(1)
      .max(MAX_STATE_CARTRIDGE_CHUNKS),
  })
  .refine(
    (manifest) =>
      manifest.chunks.reduce((total, chunk) => total + chunk.z, 0) ===
      manifest.n,
    { message: 'Cartridge chunk lengths do not match the manifest' }
  );

export const stateCartridgeChunkUploadInputSchema = z
  .object({
    data: z
      .string()
      .min(1)
      .max(Math.ceil((STATE_CARTRIDGE_CHUNK_BYTES * 4) / 3) + 16),
    index: z
      .number()
      .int()
      .min(0)
      .max(MAX_STATE_CARTRIDGE_CHUNKS - 1),
    count: z.number().int().min(1).max(MAX_STATE_CARTRIDGE_CHUNKS),
  })
  .refine((input) => input.index < input.count, {
    message: 'Cartridge chunk index is out of range',
  });

export const stateCartridgeManifestUploadInputSchema =
  stateCartridgeManifestSchema;

export const stateCartridgeUrlSchema = z.string().url().max(512);

export const stateCartridgeManifestUploadResultSchema = z.object({
  mediaUrl: stateCartridgeUrlSchema,
});

const createCrcTable = () => {
  const table = new Uint32Array(256);

  for (let index = 0; index < table.length; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
};

const CRC_TABLE = createCrcTable();

const calculateCrc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    const tableIndex = (crc ^ byte) & 0xff;
    crc = (CRC_TABLE[tableIndex] ?? 0) ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
};

const concatenateBytes = (parts: readonly Uint8Array[]) => {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }

  return output;
};

const writeUint16 = (bytes: Uint8Array, offset: number, value: number) => {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(
    offset,
    value,
    false
  );
};

const writeUint32 = (bytes: Uint8Array, offset: number, value: number) => {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
    offset,
    value,
    false
  );
};

const readUint16 = (bytes: Uint8Array, offset: number) => {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength
  ).getUint16(offset, false);
};

const readUint32 = (bytes: Uint8Array, offset: number) => {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength
  ).getUint32(offset, false);
};

const createPngChunk = (type: string, data: Uint8Array) => {
  const typeBytes = new TextEncoder().encode(type);

  if (typeBytes.byteLength !== 4) {
    throw new Error('PNG chunk types must be four bytes');
  }

  const output = new Uint8Array(12 + data.byteLength);
  writeUint32(output, 0, data.byteLength);
  output.set(typeBytes, 4);
  output.set(data, 8);
  writeUint32(
    output,
    8 + data.byteLength,
    calculateCrc32(concatenateBytes([typeBytes, data]))
  );

  return output;
};

const createCartridgePayload = (
  payload: Uint8Array,
  kind: StateCartridgeKind,
  index: number,
  count: number
) => {
  const output = new Uint8Array(CARTRIDGE_HEADER_BYTES + payload.byteLength);

  output.set(CARTRIDGE_MAGIC, 0);
  output[8] = 1;
  output[9] = kind === 'chunk' ? 1 : 2;
  writeUint16(output, 10, index);
  writeUint16(output, 12, count);
  writeUint32(output, 14, payload.byteLength);
  writeUint32(output, 18, calculateCrc32(payload));
  output.set(payload, CARTRIDGE_HEADER_BYTES);

  return output;
};

export const encodeStateCartridgePng = (
  payload: Uint8Array,
  options: {
    kind: StateCartridgeKind;
    index?: number;
    count?: number;
  }
) => {
  const index = options.index ?? 0;
  const count = options.count ?? 1;

  if (payload.byteLength === 0) {
    throw new Error('State Cartridge payload is empty');
  }

  if (count < 1 || count > MAX_STATE_CARTRIDGE_CHUNKS) {
    throw new Error('State Cartridge chunk count is out of range');
  }

  if (index < 0 || index >= count) {
    throw new Error('State Cartridge chunk index is out of range');
  }

  if (
    options.kind === 'chunk' &&
    payload.byteLength > STATE_CARTRIDGE_CHUNK_BYTES
  ) {
    throw new Error('State Cartridge chunk is too large');
  }

  const cartridge = createCartridgePayload(payload, options.kind, index, count);
  const pixelCount = Math.ceil(cartridge.byteLength / 3);
  const width = Math.min(1_024, Math.max(64, Math.ceil(Math.sqrt(pixelCount))));
  const height = Math.ceil(pixelCount / width);

  if (height > MAX_PNG_DIMENSION) {
    throw new Error('State Cartridge image would be too tall');
  }

  const pixels = new Uint8Array(width * height * 3);
  pixels.set(cartridge);
  const scanlines = new Uint8Array(height * (width * 3 + 1));

  for (let row = 0; row < height; row += 1) {
    const scanlineOffset = row * (width * 3 + 1);
    const pixelOffset = row * width * 3;

    scanlines[scanlineOffset] = 0;
    scanlines.set(
      pixels.subarray(pixelOffset, pixelOffset + width * 3),
      scanlineOffset + 1
    );
  }

  const ihdr = new Uint8Array(13);
  writeUint32(ihdr, 0, width);
  writeUint32(ihdr, 4, height);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const png = concatenateBytes([
    PNG_SIGNATURE,
    createPngChunk('IHDR', ihdr),
    createPngChunk('IDAT', zlibSync(scanlines, { level: 0 })),
    createPngChunk('IEND', new Uint8Array()),
  ]);

  if (png.byteLength > MAX_STATE_CARTRIDGE_PNG_BYTES) {
    throw new Error('Encoded State Cartridge PNG is too large');
  }

  return png;
};

const paethPredictor = (left: number, above: number, upperLeft: number) => {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);

  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left;
  }

  return aboveDistance <= upperLeftDistance ? above : upperLeft;
};

const decodeScanlines = (
  encoded: Uint8Array,
  width: number,
  height: number,
  channels: number
) => {
  const rowBytes = width * channels;
  const expectedBytes = height * (rowBytes + 1);

  if (encoded.byteLength !== expectedBytes) {
    throw new Error('State Cartridge PNG has an invalid pixel payload');
  }

  const decoded = new Uint8Array(height * rowBytes);

  for (let row = 0; row < height; row += 1) {
    const encodedOffset = row * (rowBytes + 1);
    const decodedOffset = row * rowBytes;
    const filter = encoded[encodedOffset] ?? 255;

    if (filter > 4) {
      throw new Error('State Cartridge PNG uses an unsupported filter');
    }

    for (let column = 0; column < rowBytes; column += 1) {
      const source = encoded[encodedOffset + 1 + column] ?? 0;
      const left =
        column >= channels
          ? (decoded[decodedOffset + column - channels] ?? 0)
          : 0;
      const above =
        row > 0 ? (decoded[decodedOffset - rowBytes + column] ?? 0) : 0;
      const upperLeft =
        row > 0 && column >= channels
          ? (decoded[decodedOffset - rowBytes + column - channels] ?? 0)
          : 0;
      let value = source;

      if (filter === 1) {
        value = source + left;
      } else if (filter === 2) {
        value = source + above;
      } else if (filter === 3) {
        value = source + Math.floor((left + above) / 2);
      } else if (filter === 4) {
        value = source + paethPredictor(left, above, upperLeft);
      }

      decoded[decodedOffset + column] = value & 0xff;
    }
  }

  return decoded;
};

const parsePngPixels = (png: Uint8Array) => {
  if (png.byteLength < PNG_SIGNATURE.byteLength) {
    throw new Error('State Cartridge PNG is truncated');
  }

  for (let index = 0; index < PNG_SIGNATURE.byteLength; index += 1) {
    if (png[index] !== PNG_SIGNATURE[index]) {
      throw new Error('State Cartridge is not a PNG image');
    }
  }

  let offset = PNG_SIGNATURE.byteLength;
  let width = 0;
  let height = 0;
  let channels = 0;
  let foundIhdr = false;
  let foundIend = false;
  const idatParts: Uint8Array[] = [];

  while (offset + 12 <= png.byteLength) {
    const length = readUint32(png, offset);
    const chunkEnd = offset + 12 + length;

    if (chunkEnd > png.byteLength) {
      throw new Error('State Cartridge PNG contains a truncated chunk');
    }

    const typeBytes = png.subarray(offset + 4, offset + 8);
    const type = new TextDecoder().decode(typeBytes);
    const data = png.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = readUint32(png, offset + 8 + length);

    if (calculateCrc32(concatenateBytes([typeBytes, data])) !== expectedCrc) {
      throw new Error('State Cartridge PNG failed its chunk integrity check');
    }

    if (type === 'IHDR') {
      if (foundIhdr || data.byteLength !== 13) {
        throw new Error('State Cartridge PNG has an invalid header');
      }

      width = readUint32(data, 0);
      height = readUint32(data, 4);
      const bitDepth = data[8];
      const colorType = data[9];
      const compression = data[10];
      const filter = data[11];
      const interlace = data[12];

      if (
        width < 1 ||
        height < 1 ||
        width > MAX_PNG_DIMENSION ||
        height > MAX_PNG_DIMENSION ||
        bitDepth !== 8 ||
        (colorType !== 2 && colorType !== 6) ||
        compression !== 0 ||
        filter !== 0 ||
        interlace !== 0
      ) {
        throw new Error('State Cartridge PNG uses an unsupported format');
      }

      channels = colorType === 2 ? 3 : 4;
      foundIhdr = true;
    } else if (type === 'IDAT') {
      idatParts.push(Uint8Array.from(data));
    } else if (type === 'IEND') {
      foundIend = true;
      break;
    }

    offset = chunkEnd;
  }

  if (!foundIhdr || !foundIend || idatParts.length === 0) {
    throw new Error('State Cartridge PNG is incomplete');
  }

  const expectedScanlineBytes = height * (width * channels + 1);

  if (expectedScanlineBytes > MAX_STATE_CARTRIDGE_PNG_BYTES * 2) {
    throw new Error('State Cartridge PNG expands beyond the safe limit');
  }

  const scanlines = unzlibSync(concatenateBytes(idatParts), {
    out: new Uint8Array(expectedScanlineBytes + 1),
  });
  const decoded = decodeScanlines(scanlines, width, height, channels);

  if (channels === 3) {
    return decoded;
  }

  const rgb = new Uint8Array(width * height * 3);

  for (let source = 0, target = 0; source < decoded.length; source += 4) {
    rgb[target] = decoded[source] ?? 0;
    rgb[target + 1] = decoded[source + 1] ?? 0;
    rgb[target + 2] = decoded[source + 2] ?? 0;
    target += 3;
  }

  return rgb;
};

export const decodeStateCartridgePng = (
  png: Uint8Array
): DecodedStateCartridge => {
  if (png.byteLength > MAX_STATE_CARTRIDGE_PNG_BYTES) {
    throw new Error('State Cartridge PNG exceeds the safe size limit');
  }

  const pixels = parsePngPixels(png);

  if (pixels.byteLength < CARTRIDGE_HEADER_BYTES) {
    throw new Error('State Cartridge header is missing');
  }

  for (let index = 0; index < CARTRIDGE_MAGIC.byteLength; index += 1) {
    if (pixels[index] !== CARTRIDGE_MAGIC[index]) {
      throw new Error('State Cartridge header is invalid');
    }
  }

  if (pixels[8] !== 1 || (pixels[9] !== 1 && pixels[9] !== 2)) {
    throw new Error('State Cartridge version is unsupported');
  }

  const index = readUint16(pixels, 10);
  const count = readUint16(pixels, 12);
  const payloadLength = readUint32(pixels, 14);
  const payloadCrc = readUint32(pixels, 18);
  const payloadEnd = CARTRIDGE_HEADER_BYTES + payloadLength;

  if (count < 1 || count > MAX_STATE_CARTRIDGE_CHUNKS || index >= count) {
    throw new Error('State Cartridge chunk metadata is invalid');
  }

  if (payloadLength < 1 || payloadEnd > pixels.byteLength) {
    throw new Error('State Cartridge payload is truncated');
  }

  const payload = Uint8Array.from(
    pixels.subarray(CARTRIDGE_HEADER_BYTES, payloadEnd)
  );

  if (calculateCrc32(payload) !== payloadCrc) {
    throw new Error('State Cartridge payload failed its integrity check');
  }

  return {
    kind: pixels[9] === 1 ? 'chunk' : 'manifest',
    index,
    count,
    payload,
  };
};

export const encodeStateCartridgeManifest = (
  manifest: StateCartridgeManifest
) => {
  const parsed = stateCartridgeManifestSchema.parse(manifest);
  return new TextEncoder().encode(JSON.stringify(parsed));
};

export const decodeStateCartridgeManifest = (bytes: Uint8Array) => {
  let value: unknown;

  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('State Cartridge manifest is invalid JSON');
  }

  return stateCartridgeManifestSchema.parse(value);
};

export const encodeStateCartridgeBase64 = (bytes: Uint8Array) => {
  let binary = '';
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize)
    );
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
};

export const decodeStateCartridgeBase64 = (value: string) => {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

export const splitStateCartridgePayload = (bytes: Uint8Array) => {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_STATE_CARTRIDGE_BYTES) {
    throw new Error('Compressed save state exceeds the cartridge limit');
  }

  const chunks: Uint8Array[] = [];

  for (
    let offset = 0;
    offset < bytes.byteLength;
    offset += STATE_CARTRIDGE_CHUNK_BYTES
  ) {
    chunks.push(
      Uint8Array.from(
        bytes.subarray(offset, offset + STATE_CARTRIDGE_CHUNK_BYTES)
      )
    );
  }

  return chunks;
};

export const joinStateCartridgePayload = (
  chunks: readonly Uint8Array[],
  expectedBytes: number
) => {
  const payload = concatenateBytes(chunks);

  if (payload.byteLength !== expectedBytes) {
    throw new Error('State Cartridge payload length does not match');
  }

  return payload;
};

export const calculateStateCartridgeSha256 = async (bytes: Uint8Array) => {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    Uint8Array.from(bytes).buffer
  );

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
};

export const stateCartridgeBytesEqual = (
  left: Uint8Array,
  right: Uint8Array
) => {
  if (left.byteLength !== right.byteLength) {
    return false;
  }

  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
};
