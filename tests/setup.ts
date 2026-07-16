import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { Blob as RuntimeBlob, File as RuntimeFile } from 'node:buffer';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

Object.defineProperties(globalThis, {
  Blob: { configurable: true, value: RuntimeBlob },
  File: { configurable: true, value: RuntimeFile },
});

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string): MediaQueryList => ({
    addEventListener: () => undefined,
    addListener: () => undefined,
    dispatchEvent: () => true,
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: () => undefined,
    removeListener: () => undefined,
  }),
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});
