declare module 'gifenc' {
  export type GifPalette = number[][];

  export type GifEncoder = {
    bytes: () => Uint8Array;
    finish: () => void;
    writeFrame: (
      index: Uint8Array,
      width: number,
      height: number,
      options: {
        delay?: number;
        palette?: GifPalette;
      }
    ) => void;
  };

  export const GIFEncoder: (options?: {
    auto?: boolean;
    initialCapacity?: number;
  }) => GifEncoder;

  export const applyPalette: (
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifPalette,
    format?: string
  ) => Uint8Array;

  export const quantize: (
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: {
      format?: string;
    }
  ) => GifPalette;
}
