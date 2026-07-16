import './index.css';

import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  Download,
  FolderOpen,
  Gamepad2,
  Image as ImageIcon,
  Library,
  LockKeyhole,
  MessageCircle,
  MonitorPlay,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Settings2,
  Share2,
  Save,
  SlidersHorizontal,
  Trash2,
  UploadCloud,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { navigateTo, showToast } from '@devvit/web/client';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import {
  StrictMode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ChangeEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import {
  DEFAULT_SETTINGS,
  EMULATOR_SYSTEMS,
  N64_CORE_OPTIONS,
  VIDEO_FILTERS,
  getSystemByCore,
  inferCoreFromFileName,
  isEmulatorCore,
  isN64CoreOption,
  isVideoFilter,
} from '../shared/emulator';
import type {
  ClipShareInput,
  ClipShareResult,
  EmulatorCore,
  EmulatorSettings,
  ViewerState,
} from '../shared/emulator';
import {
  MAX_SHARED_POST_DATA_BYTES,
  decodeSharedState,
  encodeSharedState,
  measurePostDataBytes,
  withSharedStatePreview,
} from '../shared/sharedState';
import type {
  EncodedSharedState,
  SharedStatePostData,
  SharedStatePreviewKind,
  SharedStateShareInput,
  SharedStateShareResult,
} from '../shared/sharedState';
import {
  createGameFromFile,
  deleteGame,
  gameMatchesRomFile,
  hasGameFiles,
  listGames,
  updateGameSettings,
} from './gameLibrary';
import type { StoredGame } from './gameLibrary';
import { recordGameLaunch } from './playStats';
import { detectRomMetadata } from './romMetadata';
import type { RomMetadata } from './romMetadata';
import { createRomFingerprint } from './romIdentity';
import { loadSharedPostData } from './sharedPostContext';
import { trpc } from './trpc';

declare global {
  interface Window {
    emuarcadeCaptureStream?: (fps: number) => MediaStream | null;
    emuarcadeRoot?: Root;
    emuarcadeStop?: () => void;
  }
}

type PanelKey = 'play' | 'library' | 'import' | 'settings';
type ClipRecordingMode = 'manual' | 'rolling';
type ClipCaptureState =
  | 'idle'
  | 'recording'
  | 'processing'
  | 'ready'
  | 'encoding-gif'
  | 'sharing';

type RecordedClip = {
  url: string;
  blob: Blob;
  thumbnailDataUrl: string | null;
  mimeType: string;
  durationMs: number;
  sizeBytes: number;
  gameTitle: string;
  core: EmulatorCore;
  recordingMode: ClipRecordingMode;
};

type RollingClipChunk = {
  blob: Blob;
  capturedAt: number;
};

type GifEncodeProfile = {
  colors: number;
  fps: number;
  maxWidth: number;
};

type RunnerActionMessage =
  | {
      action: 'clip' | 'rotate' | 'runner-ready' | 'shared-state-loaded';
      type: 'emuarcade:runner-action';
    }
  | {
      action: 'share-state';
      state: Uint8Array;
      type: 'emuarcade:runner-action';
    };

type StateShareDraft = EncodedSharedState & {
  thumbnailDataUrl: string | null;
};

type PendingSharedState = {
  bytes: Uint8Array;
  gameId: string | null;
  postData: SharedStatePostData;
};

type StateShareStatus =
  | 'idle'
  | 'compressing'
  | 'sharing'
  | 'commenting'
  | 'shared';

const LIBRARY_PAGE_SIZE = 6;
const CLIP_MAX_DURATION_MS = 15_000;
const ROLLING_CLIP_DURATION_MS = 10_000;
const CLIP_CHUNK_INTERVAL_MS = 1_000;
const CLIP_VIDEO_BITS_PER_SECOND = 1_800_000;
const CLIP_MAX_SHARE_BYTES = 20 * 1024 * 1024;
const CLIP_MODE_STORAGE_KEY = 'emuarcade-clip-mode';
const SHARED_PREVIEW_URL_ESTIMATE = `https://preview.redd.it/${'x'.repeat(
  220
)}.gif`;
const GIF_ENCODE_PROFILES: readonly GifEncodeProfile[] = [
  { colors: 256, fps: 15, maxWidth: 640 },
  { colors: 256, fps: 12, maxWidth: 560 },
  { colors: 192, fps: 12, maxWidth: 480 },
];
const DESKTOP_LAYOUT_QUERY = '(min-width: 1024px)';
const PHONE_ASPECT_LAYOUT_QUERY = '(max-aspect-ratio: 3/4)';
const MOBILE_WIDTH_QUERY = '(max-width: 820px)';
const MOBILE_POINTER_QUERY = '(pointer: coarse)';
let viewerStateRequest: Promise<ViewerState> | null = null;

const loadViewerState = () => {
  viewerStateRequest ??= trpc.viewerState.query();
  return viewerStateRequest;
};

const getIsDesktopLayout = () => {
  return window.matchMedia(DESKTOP_LAYOUT_QUERY).matches;
};

const useIsDesktopLayout = () => {
  const [isDesktopLayout, setIsDesktopLayout] = useState(getIsDesktopLayout);

  useEffect(() => {
    const mediaQueryList = window.matchMedia(DESKTOP_LAYOUT_QUERY);
    const updateLayout = () => setIsDesktopLayout(mediaQueryList.matches);

    updateLayout();
    mediaQueryList.addEventListener('change', updateLayout);

    return () => {
      mediaQueryList.removeEventListener('change', updateLayout);
    };
  }, []);

  return isDesktopLayout;
};

const getIsMobileImmersiveCapable = () => {
  return (
    window.matchMedia(PHONE_ASPECT_LAYOUT_QUERY).matches ||
    window.matchMedia(MOBILE_WIDTH_QUERY).matches ||
    window.matchMedia(MOBILE_POINTER_QUERY).matches ||
    (globalThis.navigator?.maxTouchPoints ?? 0) > 0
  );
};

const getInitialPhoneViewRotated = () => {
  const isLocalPreview =
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === 'localhost';

  return (
    isLocalPreview &&
    new URLSearchParams(window.location.search).get('rotated') === '1'
  );
};

const useIsMobileImmersiveCapable = () => {
  const [isMobileImmersiveCapable, setIsMobileImmersiveCapable] = useState(
    getIsMobileImmersiveCapable
  );

  useEffect(() => {
    const mediaQueryLists = [
      window.matchMedia(PHONE_ASPECT_LAYOUT_QUERY),
      window.matchMedia(MOBILE_WIDTH_QUERY),
      window.matchMedia(MOBILE_POINTER_QUERY),
    ];
    const updateLayout = () =>
      setIsMobileImmersiveCapable(getIsMobileImmersiveCapable());

    updateLayout();
    mediaQueryLists.forEach((mediaQueryList) => {
      mediaQueryList.addEventListener('change', updateLayout);
    });

    return () => {
      mediaQueryLists.forEach((mediaQueryList) => {
        mediaQueryList.removeEventListener('change', updateLayout);
      });
    };
  }, []);

  return isMobileImmersiveCapable;
};

const isRunnerActionMessage = (data: unknown): data is RunnerActionMessage => {
  if (data === null || typeof data !== 'object') {
    return false;
  }

  const type = Reflect.get(data, 'type');
  const action = Reflect.get(data, 'action');

  if (type !== 'emuarcade:runner-action') {
    return false;
  }

  if (action === 'share-state') {
    return Reflect.get(data, 'state') instanceof Uint8Array;
  }

  return (
    action === 'clip' ||
    action === 'rotate' ||
    action === 'runner-ready' ||
    action === 'shared-state-loaded'
  );
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const formatDate = (value: string) => {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
};

const formatDuration = (durationMs: number) => {
  const seconds = Math.max(0, Math.ceil(durationMs / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

const getPreferredClipMimeType = () => {
  if (typeof MediaRecorder === 'undefined') {
    return '';
  }

  return (
    [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=h264,aac',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? ''
  );
};

const readBlobAsDataUrl = async (blob: Blob) => {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Unable to read clip data'));
      }
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('Unable to read clip data'));
    };
    reader.readAsDataURL(blob);
  });
};

const captureThumbnailDataUrl = (canvas: HTMLCanvasElement) => {
  try {
    const thumbnail = document.createElement('canvas');
    const scale = Math.min(1, 640 / Math.max(1, canvas.width));
    const width = Math.max(1, Math.round(canvas.width * scale));
    const height = Math.max(1, Math.round(canvas.height * scale));
    const context = thumbnail.getContext('2d', { alpha: false });

    if (!context) {
      return null;
    }

    thumbnail.width = width;
    thumbnail.height = height;
    context.imageSmoothingEnabled = false;
    context.drawImage(canvas, 0, 0, width, height);

    return thumbnail.toDataURL('image/png');
  } catch (error) {
    console.error('Unable to capture clip thumbnail', error);
    return null;
  }
};

const getInitialClipRecordingMode = (): ClipRecordingMode => {
  try {
    return window.localStorage.getItem(CLIP_MODE_STORAGE_KEY) === 'rolling'
      ? 'rolling'
      : 'manual';
  } catch {
    return 'manual';
  }
};

const persistClipRecordingMode = (mode: ClipRecordingMode) => {
  try {
    window.localStorage.setItem(CLIP_MODE_STORAGE_KEY, mode);
  } catch {
    // Nonessential preference; recording still works without it.
  }
};

const getClipFileExtension = (mimeType: string) => {
  if (mimeType.includes('mp4')) {
    return 'mp4';
  }

  if (mimeType.includes('gif')) {
    return 'gif';
  }

  return 'webm';
};

const sanitizeDownloadName = (value: string) => {
  const withoutControlCharacters = Array.from(value, (character) =>
    character.charCodeAt(0) < 32 ? ' ' : character
  ).join('');
  const normalized = withoutControlCharacters
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized || 'emuarcade-clip';
};

const waitForVideoEvent = async (
  video: HTMLVideoElement,
  eventName: keyof HTMLMediaElementEventMap,
  timeoutMs = 5_000
) => {
  await new Promise<void>((resolve, reject) => {
    let cleanup = () => undefined;
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(video.error ?? new Error('Unable to read recorded clip'));
    };
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, timeoutMs);
    cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener(eventName, onEvent);
      video.removeEventListener('error', onError);
    };

    video.addEventListener(eventName, onEvent, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
};

const seekVideo = async (video: HTMLVideoElement, time: number) => {
  const targetTime = Math.min(
    Math.max(0, time),
    Math.max(0, video.duration || time)
  );

  if (Math.abs(video.currentTime - targetTime) < 0.02) {
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await waitForVideoEvent(video, 'loadeddata', 2_000).catch(() => {
        // The browser may already have enough data without firing loadeddata.
      });
    }

    return;
  }

  const seeked = waitForVideoEvent(video, 'seeked');
  video.currentTime = targetTime;
  await seeked;
};

const encodeClipAsGifWithProfile = async (
  clip: RecordedClip,
  profile: GifEncodeProfile
) => {
  const video = document.createElement('video');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', {
    alpha: false,
    willReadFrequently: true,
  });

  if (!context) {
    throw new Error('GIF export is not available');
  }

  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  const metadataReady = waitForVideoEvent(video, 'loadedmetadata');
  const dataReady = waitForVideoEvent(video, 'loadeddata').catch(() => {
    // Metadata is enough to seek; loadeddata is only a decode warmup.
  });
  video.src = clip.url;
  video.load();
  await metadataReady;
  await dataReady;

  const sourceWidth = Math.max(1, video.videoWidth || 640);
  const sourceHeight = Math.max(1, video.videoHeight || 360);
  const scale = Math.min(1, profile.maxWidth / sourceWidth);
  const width = Math.max(2, Math.round(sourceWidth * scale));
  const height = Math.max(2, Math.round(sourceHeight * scale));
  const durationSeconds = Math.max(0.1, clip.durationMs / 1000);
  const frameDelay = Math.round(1000 / profile.fps);
  const frameCount = Math.max(1, Math.ceil(durationSeconds * profile.fps));
  const gif = GIFEncoder();

  canvas.width = width;
  canvas.height = height;
  context.imageSmoothingEnabled = false;

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const time = Math.min(
      durationSeconds - 0.001,
      frameIndex / profile.fps
    );

    await seekVideo(video, time);
    context.drawImage(video, 0, 0, width, height);

    const pixels = context.getImageData(0, 0, width, height).data;
    const palette = quantize(pixels, profile.colors);
    const indexedFrame = applyPalette(pixels, palette);

    gif.writeFrame(indexedFrame, width, height, {
      delay: frameDelay,
      palette,
    });
  }

  gif.finish();

  const gifBytes = gif.bytes();
  const outputBytes = new Uint8Array(gifBytes.length);
  outputBytes.set(gifBytes);

  return new Blob([outputBytes.buffer], { type: 'image/gif' });
};

const encodeClipAsGif = async (clip: RecordedClip) => {
  let lastGif: Blob | null = null;

  for (const profile of GIF_ENCODE_PROFILES) {
    const gif = await encodeClipAsGifWithProfile(clip, profile);
    lastGif = gif;

    if (gif.size <= CLIP_MAX_SHARE_BYTES) {
      return gif;
    }
  }

  return lastGif;
};

const postClipShare = async (
  input: ClipShareInput
): Promise<ClipShareResult> => {
  const response = await fetch('/api/share-clip', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);

    if (
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof payload.error === 'string'
    ) {
      throw new Error(payload.error);
    }

    throw new Error('Could not share this clip');
  }

  return await response.json();
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

const postStateShare = async (
  input: SharedStateShareInput
): Promise<SharedStateShareResult> => {
  const response = await fetch('/api/share-state', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await readApiError(response, 'Could not share this state'));
  }

  return await response.json();
};

const postStateShareComment = async (postId: string, text: string) => {
  const response = await fetch('/api/share-state-comment', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ postId, text }),
  });

  if (!response.ok) {
    throw new Error(await readApiError(response, 'Could not post the comment'));
  }
};

const findMatchingLocalGame = async (
  games: StoredGame[],
  postData: SharedStatePostData
) => {
  const candidates = games.filter(
    (game) => game.core === postData.c && hasGameFiles(game)
  );

  for (const game of candidates) {
    if (
      game.romBlob &&
      (await createRomFingerprint(game.romBlob, game.core)) === postData.r
    ) {
      return game;
    }
  }

  return null;
};

const getEstimatedSharedPostDataBytes = (
  postData: SharedStatePostData,
  previewKind: SharedStatePreviewKind
) => {
  return measurePostDataBytes(
    withSharedStatePreview(
      postData,
      previewKind === 'hidden' ? null : SHARED_PREVIEW_URL_ESTIMATE,
      previewKind
    )
  );
};

const getGameSystemLabel = (game: StoredGame) => {
  return getSystemByCore(game.core)?.shortName ?? game.core;
};

const getRunnerSrc = (gameId: string, runnerKey: number) => {
  const params = new URLSearchParams({
    id: gameId,
    run: runnerKey.toString(),
  });

  return `/emulator-runner.html?${params.toString()}`;
};

const replaceGame = (games: StoredGame[], game: StoredGame) => {
  return games
    .map((item) => (item.id === game.id ? game : item))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
};

export const App = () => {
  const romInputRef = useRef<HTMLInputElement>(null);
  const biosInputRef = useRef<HTMLInputElement>(null);
  const runnerFrameRef = useRef<HTMLIFrameElement>(null);
  const stageViewportRef = useRef<HTMLDivElement>(null);
  const stageContentRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const rollingRecorderRef = useRef<MediaRecorder | null>(null);
  const clipChunksRef = useRef<Blob[]>([]);
  const rollingChunksRef = useRef<RollingClipChunk[]>([]);
  const clipStreamRef = useRef<MediaStream | null>(null);
  const rollingStreamRef = useRef<MediaStream | null>(null);
  const clipStopTimeoutRef = useRef<number | null>(null);
  const clipStartTimeRef = useRef<number | null>(null);
  const clipUrlRef = useRef<string | null>(null);
  const rollingMimeTypeRef = useRef('video/webm');
  const pendingSharedStateRef = useRef<PendingSharedState | null>(null);
  const [selectedCore, setSelectedCore] = useState<EmulatorCore>('nes');
  const [title, setTitle] = useState('');
  const [titleSource, setTitleSource] = useState<
    RomMetadata['titleSource'] | null
  >(null);
  const [romFile, setRomFile] = useState<File | null>(null);
  const [biosFile, setBiosFile] = useState<File | null>(null);
  const [games, setGames] = useState<StoredGame[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const [runnerKey, setRunnerKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [activePanel, setActivePanel] = useState<PanelKey>('play');
  const [libraryPage, setLibraryPage] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [phoneViewRotated, setPhoneViewRotated] = useState(
    getInitialPhoneViewRotated
  );
  const [clipState, setClipState] = useState<ClipCaptureState>('idle');
  const [clipRecordingMode, setClipRecordingMode] = useState<ClipRecordingMode>(
    getInitialClipRecordingMode
  );
  const [rollingBufferActive, setRollingBufferActive] = useState(false);
  const [recordedClip, setRecordedClip] = useState<RecordedClip | null>(null);
  const [sharedClipUrl, setSharedClipUrl] = useState<string | null>(null);
  const [sharedClipPostId, setSharedClipPostId] = useState<string | null>(null);
  const [clipPostTitle, setClipPostTitle] = useState('');
  const [clipPostComment, setClipPostComment] = useState('');
  const [clipCommentPosted, setClipCommentPosted] = useState(false);
  const [clipCommentPosting, setClipCommentPosting] = useState(false);
  const [incomingSharedState, setIncomingSharedState] =
    useState<SharedStatePostData | null>(null);
  const [stateShareDraft, setStateShareDraft] =
    useState<StateShareDraft | null>(null);
  const [stateShareTitle, setStateShareTitle] = useState('');
  const [stateShareComment, setStateShareComment] = useState('');
  const [stateSharePreviewKind, setStateSharePreviewKind] =
    useState<SharedStatePreviewKind>('image');
  const [stateShareStatus, setStateShareStatus] =
    useState<StateShareStatus>('idle');
  const [stateShareResult, setStateShareResult] =
    useState<SharedStateShareResult | null>(null);
  const [stateShareCommentPosted, setStateShareCommentPosted] = useState(false);
  const isDesktopLayout = useIsDesktopLayout();
  const isMobileImmersiveCapable = useIsMobileImmersiveCapable();
  const usePhoneImmersiveLayout = isMobileImmersiveCapable && phoneViewRotated;

  const stateSharePostDataBytes = stateShareDraft
    ? getEstimatedSharedPostDataBytes(
        stateShareDraft.postData,
        stateSharePreviewKind
      )
    : 0;
  const stateShareFits =
    stateSharePostDataBytes > 0 &&
    stateSharePostDataBytes <= MAX_SHARED_POST_DATA_BYTES;
  const canUseClipForStatePreview = Boolean(
    recordedClip &&
      activeGameId &&
      recordedClip.gameTitle ===
        games.find((game) => game.id === activeGameId)?.title
  );

  const selectedGame = useMemo(() => {
    return games.find((game) => game.id === selectedGameId) ?? null;
  }, [games, selectedGameId]);

  const activeGame = useMemo(() => {
    return games.find((game) => game.id === activeGameId) ?? null;
  }, [games, activeGameId]);

  const reconnectGame = useMemo(() => {
    if (!romFile) {
      return null;
    }

    return (
      games.find(
        (game) =>
          !hasGameFiles(game) && gameMatchesRomFile(game, romFile, selectedCore)
      ) ?? null
    );
  }, [games, romFile, selectedCore]);

  const runnerSrc = activeGameId ? getRunnerSrc(activeGameId, runnerKey) : null;
  const libraryPageCount = Math.max(
    1,
    Math.ceil(games.length / LIBRARY_PAGE_SIZE)
  );
  const clampedLibraryPage = Math.min(libraryPage, libraryPageCount - 1);
  const libraryStart = clampedLibraryPage * LIBRARY_PAGE_SIZE;
  const pagedGames = games.slice(
    libraryStart,
    libraryStart + LIBRARY_PAGE_SIZE
  );
  const libraryEnd = Math.min(libraryStart + pagedGames.length, games.length);
  const togglePhoneRotatedView = () => {
    setActivePanel('play');
    setPhoneViewRotated((current) => !current);
  };

  useEffect(() => {
    const viewport = stageViewportRef.current;
    const content = stageContentRef.current;

    if (!viewport || !content) {
      return;
    }

    let frameId: number | null = null;
    const updateSize = () => {
      frameId = null;

      if (!usePhoneImmersiveLayout) {
        content.style.removeProperty('width');
        content.style.removeProperty('height');
        return;
      }

      const bounds = viewport.getBoundingClientRect();

      if (bounds.width <= 0 || bounds.height <= 0) {
        return;
      }

      content.style.width = `${bounds.height}px`;
      content.style.height = `${bounds.width}px`;
    };
    const scheduleSizeUpdate = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(updateSize);
    };
    const resizeObserver =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(scheduleSizeUpdate)
        : null;
    const visualViewport = window.visualViewport;

    resizeObserver?.observe(viewport);
    window.addEventListener('resize', scheduleSizeUpdate);
    window.addEventListener('orientationchange', scheduleSizeUpdate);
    visualViewport?.addEventListener('resize', scheduleSizeUpdate);
    visualViewport?.addEventListener('scroll', scheduleSizeUpdate);
    scheduleSizeUpdate();

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      resizeObserver?.disconnect();
      window.removeEventListener('resize', scheduleSizeUpdate);
      window.removeEventListener('orientationchange', scheduleSizeUpdate);
      visualViewport?.removeEventListener('resize', scheduleSizeUpdate);
      visualViewport?.removeEventListener('scroll', scheduleSizeUpdate);
      content.style.removeProperty('width');
      content.style.removeProperty('height');
    };
  }, [isDesktopLayout, usePhoneImmersiveLayout]);

  const stopRunnerFrame = useCallback(() => {
    runnerFrameRef.current?.contentWindow?.emuarcadeStop?.();
  }, []);

  const setRunnerFrame = useCallback((frame: HTMLIFrameElement | null) => {
    if (runnerFrameRef.current && runnerFrameRef.current !== frame) {
      runnerFrameRef.current.contentWindow?.emuarcadeStop?.();
    }

    runnerFrameRef.current = frame;
  }, []);

  const getRunnerCanvas = useCallback(() => {
    return (
      runnerFrameRef.current?.contentDocument?.querySelector<HTMLCanvasElement>(
        'canvas'
      ) ?? null
    );
  }, []);

  const createClipStream = useCallback((canvas: HTMLCanvasElement) => {
    const runnerWindow = runnerFrameRef.current?.contentWindow;

    return (
      runnerWindow?.emuarcadeCaptureStream?.(30) ?? canvas.captureStream(30)
    );
  }, []);

  const createClipRecorder = useCallback((stream: MediaStream) => {
    const mimeType = getPreferredClipMimeType();
    const options: MediaRecorderOptions = {
      videoBitsPerSecond: CLIP_VIDEO_BITS_PER_SECOND,
    };

    if (mimeType) {
      options.mimeType = mimeType;
    }

    return new MediaRecorder(stream, options);
  }, []);

  const postPendingSharedStateToRunner = useCallback(() => {
    const pending = pendingSharedStateRef.current;

    if (!pending || !activeGameId || pending.gameId !== activeGameId) {
      return;
    }

    runnerFrameRef.current?.contentWindow?.postMessage(
      {
        state: pending.bytes,
        type: 'emuarcade:load-shared-state',
      },
      '*'
    );
  }, [activeGameId]);

  const prepareStateShare = async (bytes: Uint8Array) => {
    if (!activeGame?.romBlob) {
      showToast('Start a local game before sharing a state');
      return;
    }

    setStateShareStatus('compressing');

    try {
      const romFingerprint = await createRomFingerprint(
        activeGame.romBlob,
        activeGame.core
      );
      const encoded = encodeSharedState(bytes, {
        core: activeGame.core,
        gameTitle: activeGame.title,
        romFingerprint,
      });
      const canvas = getRunnerCanvas();
      const thumbnailDataUrl = canvas ? captureThumbnailDataUrl(canvas) : null;

      setStateShareDraft({ ...encoded, thumbnailDataUrl });
      setStateShareTitle(`${activeGame.title}: play from here`);
      setStateShareComment('');
      setStateSharePreviewKind(thumbnailDataUrl ? 'image' : 'hidden');
      setStateShareResult(null);
      setStateShareCommentPosted(false);
      setStateShareStatus('idle');

      if (!encoded.fits) {
        showToast('This exact state is too large for Reddit post data');
      }
    } catch (error) {
      console.error('Unable to prepare shared state', error);
      setStateShareStatus('idle');
      showToast('Could not prepare this save state');
    }
  };

  const closeStateShare = () => {
    if (
      stateShareStatus === 'sharing' ||
      stateShareStatus === 'commenting' ||
      stateShareStatus === 'compressing'
    ) {
      return;
    }

    setStateShareDraft(null);
    setStateShareResult(null);
    setStateShareStatus('idle');
  };

  const sharePreparedState = async () => {
    if (!stateShareDraft || !stateShareFits) {
      return;
    }

    setStateShareStatus('sharing');

    try {
      let previewDataUrl: string | null = null;

      if (stateSharePreviewKind === 'image') {
        previewDataUrl = stateShareDraft.thumbnailDataUrl;
      } else if (stateSharePreviewKind === 'gif') {
        if (!recordedClip) {
          throw new Error('Record a clip before using a GIF preview');
        }

        const gif = await encodeClipAsGif(recordedClip);

        if (!gif || gif.size > CLIP_MAX_SHARE_BYTES) {
          throw new Error('The GIF preview is too large to share');
        }

        previewDataUrl = await readBlobAsDataUrl(gif);
      }

      const result = await postStateShare({
        postData: stateShareDraft.postData,
        previewDataUrl,
        previewKind: stateSharePreviewKind,
        title: stateShareTitle,
      });

      setStateShareResult(result);
      setStateShareStatus('shared');
      showToast(`Shared checkpoint to r/${result.subredditName}`);
    } catch (error) {
      console.error('Unable to share state', error);
      setStateShareStatus('idle');
      showToast(error instanceof Error ? error.message : 'Could not share state');
    }
  };

  const sharePreparedStateComment = async () => {
    const text = stateShareComment.trim();

    if (!stateShareResult || !text || stateShareCommentPosted) {
      return;
    }

    setStateShareStatus('commenting');

    try {
      await postStateShareComment(stateShareResult.postId, text);
      setStateShareCommentPosted(true);
      setStateShareStatus('shared');
      showToast('Comment posted');
    } catch (error) {
      console.error('Unable to share state comment', error);
      setStateShareStatus('shared');
      showToast('Checkpoint shared, but the comment failed');
    }
  };

  const stopRollingBuffer = useCallback(() => {
    if (rollingRecorderRef.current?.state === 'recording') {
      rollingRecorderRef.current.stop();
      return;
    }

    rollingStreamRef.current?.getTracks().forEach((track) => track.stop());
    rollingStreamRef.current = null;
    rollingRecorderRef.current = null;
    setRollingBufferActive(false);
  }, []);

  const clearClipTimers = () => {
    if (clipStopTimeoutRef.current !== null) {
      window.clearTimeout(clipStopTimeoutRef.current);
      clipStopTimeoutRef.current = null;
    }
  };

  const stopClipStream = () => {
    if (clipStreamRef.current) {
      clipStreamRef.current.getTracks().forEach((track) => track.stop());
      clipStreamRef.current = null;
    }
  };

  const stopRollingStream = useCallback(() => {
    rollingStreamRef.current?.getTracks().forEach((track) => track.stop());
    rollingStreamRef.current = null;
  }, []);

  const revokeClipUrl = () => {
    if (clipUrlRef.current) {
      URL.revokeObjectURL(clipUrlRef.current);
      clipUrlRef.current = null;
    }
  };

  const setNextRecordedClip = (clip: RecordedClip | null) => {
    revokeClipUrl();
    clipUrlRef.current = clip?.url ?? null;
    setRecordedClip(clip);
  };

  const setClipRecordingModeAndPersist = (mode: ClipRecordingMode) => {
    setClipRecordingMode(mode);
    persistClipRecordingMode(mode);
    discardClip();
  };

  const createRecordedClip = (
    blob: Blob,
    durationMs: number,
    game: StoredGame,
    canvas: HTMLCanvasElement | null,
    recordingMode: ClipRecordingMode
  ) => {
    if (blob.size === 0) {
      setClipState('idle');
      showToast('No clip data was captured');
      return;
    }

    const clipUrl = URL.createObjectURL(blob);

    setNextRecordedClip({
      url: clipUrl,
      blob,
      thumbnailDataUrl: canvas ? captureThumbnailDataUrl(canvas) : null,
      mimeType: blob.type || getPreferredClipMimeType() || 'video/webm',
      durationMs,
      sizeBytes: blob.size,
      gameTitle: game.title,
      core: game.core,
      recordingMode,
    });
    setSharedClipUrl(null);
    setSharedClipPostId(null);
    setClipPostTitle(`${game.title} gameplay moment`);
    setClipPostComment('');
    setClipCommentPosted(false);
    setClipState('ready');
  };

  const discardClip = () => {
    setNextRecordedClip(null);
    setSharedClipUrl(null);
    setSharedClipPostId(null);
    setClipPostComment('');
    setClipCommentPosted(false);
    setClipState('idle');
  };

  const stopClipRecording = () => {
    if (recorderRef.current?.state === 'recording') {
      setClipState('processing');
      recorderRef.current.stop();
    }
  };

  const startClipRecording = () => {
    if (!activeGame) {
      showToast('Start a game before recording');
      return;
    }

    if (clipState === 'recording') {
      stopClipRecording();
      return;
    }

    if (
      clipState === 'processing' ||
      clipState === 'encoding-gif' ||
      clipState === 'sharing'
    ) {
      return;
    }

    if (typeof MediaRecorder === 'undefined') {
      showToast('This browser cannot record gameplay clips');
      return;
    }

    const canvas = getRunnerCanvas();

    if (!canvas) {
      showToast('Wait for the game screen to load');
      return;
    }

    try {
      const stream = createClipStream(canvas);

      if (stream.getVideoTracks().length === 0) {
        showToast('Could not capture the game screen');
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const recordingGame = activeGame;
      const recorder = createClipRecorder(stream);

      clearClipTimers();
      setNextRecordedClip(null);
      setSharedClipUrl(null);
      clipChunksRef.current = [];
      clipStreamRef.current = stream;
      recorderRef.current = recorder;
      clipStartTimeRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          clipChunksRef.current = [...clipChunksRef.current, event.data];
        }
      };

      recorder.onstop = () => {
        const startedAt = clipStartTimeRef.current ?? Date.now();
        const durationMs = Math.max(1, Date.now() - startedAt);
        const recordedType = recorder.mimeType || 'video/webm';
        const blob = new Blob(clipChunksRef.current, { type: recordedType });

        clearClipTimers();
        stopClipStream();
        recorderRef.current = null;
        clipStartTimeRef.current = null;
        clipChunksRef.current = [];

        if (blob.size === 0) {
          setClipState('idle');
          showToast('No clip data was captured');
          return;
        }

        createRecordedClip(blob, durationMs, recordingGame, canvas, 'manual');
        setClipState('ready');
        showToast('Clip ready');
      };

      recorder.onerror = () => {
        clearClipTimers();
        stopClipStream();
        recorderRef.current = null;
        clipStartTimeRef.current = null;
        clipChunksRef.current = [];
        setClipState('idle');
        showToast('Recording failed');
      };

      recorder.start(1_000);
      setClipState('recording');
      clipStopTimeoutRef.current = window.setTimeout(
        stopClipRecording,
        CLIP_MAX_DURATION_MS
      );
    } catch (error) {
      console.error(error);
      clearClipTimers();
      stopClipStream();
      recorderRef.current = null;
      clipStartTimeRef.current = null;
      setClipState('idle');
      showToast('Could not start clip recording');
    }
  };

  const saveRollingClip = async () => {
    if (!activeGame) {
      showToast('Start a game before clipping');
      return;
    }

    if (
      clipState === 'recording' ||
      clipState === 'processing' ||
      clipState === 'encoding-gif' ||
      clipState === 'sharing'
    ) {
      return;
    }

    const recorder = rollingRecorderRef.current;
    const canvas = getRunnerCanvas();

    if (!recorder || recorder.state !== 'recording' || !canvas) {
      showToast('Rolling buffer is still warming up');
      return;
    }

    try {
      recorder.requestData();
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    } catch {
      // Some engines may not support requestData during a timesliced capture.
    }

    const now = Date.now();
    const cutoff = now - ROLLING_CLIP_DURATION_MS - CLIP_CHUNK_INTERVAL_MS;
    const chunks = rollingChunksRef.current.filter(
      (chunk) => chunk.capturedAt >= cutoff
    );

    if (chunks.length === 0) {
      showToast('Rolling buffer is still warming up');
      return;
    }

    const oldestChunk = chunks[0];
    const durationMs = Math.min(
      ROLLING_CLIP_DURATION_MS,
      Math.max(
        CLIP_CHUNK_INTERVAL_MS,
        now - (oldestChunk?.capturedAt ?? now) + CLIP_CHUNK_INTERVAL_MS
      )
    );
    const blob = new Blob(
      chunks.map((chunk) => chunk.blob),
      { type: rollingMimeTypeRef.current || 'video/webm' }
    );

    setClipState('processing');
    createRecordedClip(blob, durationMs, activeGame, canvas, 'rolling');
    showToast('Last 10 seconds saved');
  };

  const handleClipCapture = () => {
    if (clipRecordingMode === 'rolling') {
      void saveRollingClip();
      return;
    }

    startClipRecording();
  };

  const postClipStateToRunner = useCallback(() => {
    runnerFrameRef.current?.contentWindow?.postMessage(
      {
        mode: clipRecordingMode,
        rollingBufferActive,
        state: clipState,
        type: 'emuarcade:clip-state',
      },
      '*'
    );
  }, [clipRecordingMode, clipState, rollingBufferActive]);

  const shareRecordedGif = async () => {
    if (!recordedClip) {
      return;
    }

    setClipState('encoding-gif');

    try {
      const gifBlob = await encodeClipAsGif(recordedClip);

      if (!gifBlob || gifBlob.size > CLIP_MAX_SHARE_BYTES) {
        setClipState('ready');
        showToast('GIF is too large to share');
        return;
      }

      setClipState('sharing');

      const dataUrl = await readBlobAsDataUrl(gifBlob);
      const result = await postClipShare({
        dataUrl,
        thumbnailDataUrl: recordedClip.thumbnailDataUrl,
        mimeType: 'image/gif',
        shareFormat: 'gif',
        sizeBytes: gifBlob.size,
        durationMs: recordedClip.durationMs,
        gameTitle: recordedClip.gameTitle,
        core: recordedClip.core,
        postTitle: clipPostTitle,
      });

      setSharedClipUrl(result.postUrl ?? result.mediaUrl);
      setSharedClipPostId(result.postId);
      setClipState('ready');
      showToast(`Shared GIF to r/${result.subredditName}`);
    } catch (error) {
      console.error(error);
      setClipState('ready');
      showToast('Could not create GIF');
    }
  };

  const shareRecordedClipComment = async () => {
    const text = clipPostComment.trim();

    if (!sharedClipPostId || !text || clipCommentPosted) {
      return;
    }

    setClipCommentPosting(true);

    try {
      await postStateShareComment(sharedClipPostId, text);
      setClipCommentPosted(true);
      showToast('Comment posted');
    } catch (error) {
      console.error('Unable to share clip comment', error);
      showToast('Clip shared, but the comment failed');
    } finally {
      setClipCommentPosting(false);
    }
  };

  const downloadRecordedClip = () => {
    if (!recordedClip) {
      return;
    }

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '-')
      .replace('Z', '');
    const extension = getClipFileExtension(recordedClip.mimeType);
    const link = document.createElement('a');

    link.href = recordedClip.url;
    link.download = `${sanitizeDownloadName(
      recordedClip.gameTitle
    )}-${timestamp}.${extension}`;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    showToast('Download started');
  };

  useEffect(() => {
    const handleRunnerAction = (event: MessageEvent<unknown>) => {
      if (
        event.origin !== window.location.origin &&
        event.origin !== 'null'
      ) {
        return;
      }

      if (event.source !== runnerFrameRef.current?.contentWindow) {
        return;
      }

      if (!isRunnerActionMessage(event.data)) {
        return;
      }

      if (event.data.action === 'clip') {
        handleClipCapture();
        return;
      }

      if (event.data.action === 'share-state') {
        void prepareStateShare(event.data.state);
        return;
      }

      if (event.data.action === 'runner-ready') {
        postClipStateToRunner();
        postPendingSharedStateToRunner();
        return;
      }

      if (event.data.action === 'shared-state-loaded') {
        pendingSharedStateRef.current = null;
        setIncomingSharedState(null);
        showToast('Shared checkpoint loaded');
        return;
      }

      if (
        event.data.action === 'rotate' &&
        !isMobileImmersiveCapable
      ) {
        showToast('Rotate view is only available on mobile');
        return;
      }

      if (event.data.action === 'rotate') {
        togglePhoneRotatedView();
      }
    };

    window.addEventListener('message', handleRunnerAction);

    return () => {
      window.removeEventListener('message', handleRunnerAction);
    };
  });

  useEffect(() => {
    postClipStateToRunner();
  }, [postClipStateToRunner, runnerSrc]);

  useEffect(() => {
    if (clipRecordingMode !== 'rolling' || !activeGame || !runnerSrc) {
      stopRollingBuffer();
      return;
    }

    let cancelled = false;
    let retryTimer: number | null = null;

    const startBuffer = (canvas: HTMLCanvasElement) => {
      if (
        rollingRecorderRef.current?.state === 'recording' ||
        typeof MediaRecorder === 'undefined'
      ) {
        return;
      }

      try {
        const stream = createClipStream(canvas);

        if (stream.getVideoTracks().length === 0) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const recorder = createClipRecorder(stream);

        rollingChunksRef.current = [];
        rollingStreamRef.current = stream;
        rollingRecorderRef.current = recorder;
        rollingMimeTypeRef.current = recorder.mimeType || 'video/webm';

        recorder.ondataavailable = (event) => {
          if (event.data.size === 0) {
            return;
          }

          const now = Date.now();
          const cutoff =
            now - ROLLING_CLIP_DURATION_MS - CLIP_CHUNK_INTERVAL_MS;

          rollingChunksRef.current = [
            ...rollingChunksRef.current,
            {
              blob: event.data,
              capturedAt: now,
            },
          ].filter((chunk) => chunk.capturedAt >= cutoff);
          setRollingBufferActive(true);
        };

        recorder.onstop = () => {
          stopRollingStream();
          rollingRecorderRef.current = null;
          setRollingBufferActive(false);
        };

        recorder.onerror = () => {
          stopRollingStream();
          rollingRecorderRef.current = null;
          setRollingBufferActive(false);
          console.warn('Rolling clip buffer failed for', activeGame.title);
        };

        recorder.start(CLIP_CHUNK_INTERVAL_MS);
      } catch (error) {
        console.error('Unable to start rolling buffer', error);
        stopRollingStream();
        rollingRecorderRef.current = null;
        setRollingBufferActive(false);
      }
    };

    const tryStart = () => {
      if (
        cancelled ||
        rollingRecorderRef.current?.state === 'recording' ||
        typeof MediaRecorder === 'undefined'
      ) {
        return;
      }

      const canvas = getRunnerCanvas();

      if (!canvas) {
        retryTimer = window.setTimeout(tryStart, 500);
        return;
      }

      startBuffer(canvas);
    };

    tryStart();

    return () => {
      cancelled = true;

      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }

      stopRollingBuffer();
    };
  }, [
    activeGame,
    clipRecordingMode,
    createClipRecorder,
    createClipStream,
    getRunnerCanvas,
    runnerSrc,
    stopRollingBuffer,
    stopRollingStream,
  ]);

  const loadLibrary = useCallback(async (selectId: string | null = null) => {
    const library = await listGames();

    setGames(library);
    setSelectedGameId((current) => selectId ?? current ?? library[0]?.id ?? null);
    return library;
  }, []);

  useEffect(() => {
    let mounted = true;
    const loadTimer = window.setTimeout(() => {
      void Promise.all([loadLibrary(), loadViewerState()])
        .then(([library, viewerState]) => {
          if (
            mounted &&
            viewerState.isNewPlayer &&
            library.length === 0 &&
            !getIsDesktopLayout()
          ) {
            setActivePanel('import');
          }
        })
        .catch((error: unknown) => {
          console.warn('Unable to initialize player state', error);
        });
    }, 0);

    return () => {
      mounted = false;
      window.clearTimeout(loadTimer);
    };
  }, [loadLibrary]);

  useEffect(() => {
    return () => {
      if (clipStopTimeoutRef.current !== null) {
        window.clearTimeout(clipStopTimeoutRef.current);
      }

      if (clipStreamRef.current) {
        clipStreamRef.current.getTracks().forEach((track) => track.stop());
      }

      if (rollingRecorderRef.current?.state === 'recording') {
        rollingRecorderRef.current.stop();
      }

      if (rollingStreamRef.current) {
        rollingStreamRef.current.getTracks().forEach((track) => track.stop());
      }

      if (clipUrlRef.current) {
        URL.revokeObjectURL(clipUrlRef.current);
      }
    };
  }, []);

  const refreshLibrary = async (selectId: string | null) => {
    await loadLibrary(selectId);
    setLibraryPage(0);
  };

  const detectTitle = (file: File, core: EmulatorCore) => {
    setTitle('Reading ROM...');
    setTitleSource(null);

    void detectRomMetadata(file, core).then((metadata) => {
      setTitle(metadata.title);
      setTitleSource(metadata.titleSource);
    });
  };

  const handleCoreChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const core = event.currentTarget.value;

    if (isEmulatorCore(core)) {
      setSelectedCore(core);

      if (romFile) {
        detectTitle(romFile, core);
      }
    }
  };

  const handleRomFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.item(0) ?? null;

    setRomFile(file);

    if (file) {
      const core = inferCoreFromFileName(file.name);

      setSelectedCore(core);
      detectTitle(file, core);
    } else {
      setTitle('');
      setTitleSource(null);
    }
  };

  const handleBiosFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setBiosFile(event.currentTarget.files?.item(0) ?? null);
  };

  const handleShaderChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const shader = event.currentTarget.value;

    if (isVideoFilter(shader)) {
      void updateSelectedSettings({ shader });
    }
  };

  const handleN64CoreChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const n64Core = event.currentTarget.value;

    if (isN64CoreOption(n64Core)) {
      void updateSelectedSettings({ n64Core });
    }
  };

  const clearImport = () => {
    setTitle('');
    setTitleSource(null);
    setRomFile(null);
    setBiosFile(null);

    if (romInputRef.current) {
      romInputRef.current.value = '';
    }

    if (biosInputRef.current) {
      biosInputRef.current.value = '';
    }
  };

  const activateGame = useCallback((game: StoredGame) => {
    stopRunnerFrame();
    setSelectedGameId(game.id);
    setActiveGameId(game.id);
    setRunnerKey((current) => current + 1);
    setActivePanel('play');
    recordGameLaunch({
      core: game.core,
      gameId: game.id,
      title: game.title,
    });
  }, [stopRunnerFrame]);

  const addFileGame = async () => {
    if (!romFile) {
      showToast('Choose a ROM file first');
      return;
    }

    if (!titleSource) {
      showToast('Wait for ROM title detection');
      return;
    }

    setBusy(true);

    try {
      const existingGame = reconnectGame;
      const game = existingGame
        ? await createGameFromFile({
            id: existingGame.id,
            title: existingGame.title,
            core: existingGame.core,
            romFile,
            biosFile,
            settings: existingGame.settings,
            createdAt: existingGame.createdAt,
          })
        : await createGameFromFile({
            title,
            core: selectedCore,
            romFile,
            biosFile,
            settings: DEFAULT_SETTINGS,
          });

      await refreshLibrary(game.id);
      clearImport();
      const pending = pendingSharedStateRef.current;

      if (pending && pending.gameId === null && game.romBlob) {
        const fingerprint = await createRomFingerprint(
          game.romBlob,
          game.core
        );

        if (
          game.core === pending.postData.c &&
          fingerprint === pending.postData.r
        ) {
          pendingSharedStateRef.current = { ...pending, gameId: game.id };
          activateGame(game);
          showToast('Matching ROM found. Loading shared checkpoint...');
          return;
        }

        setActivePanel('library');
        showToast('ROM added, but it does not match this checkpoint');
        return;
      }

      setActivePanel('library');
      showToast(
        existingGame ? `Reconnected ${game.title}` : `Added ${game.title}`
      );
    } catch (error) {
      console.error(error);
      showToast('Could not add this file');
    } finally {
      setBusy(false);
    }
  };

  const launchGame = async (game: StoredGame) => {
    if (!hasGameFiles(game)) {
      setSelectedGameId(game.id);
      setActivePanel('import');
      showToast('Reconnect the ROM file before playing');
      return;
    }

    activateGame(game);

    try {
      await trpc.recordLaunch.mutate({
        core: game.core,
        title: game.title,
      });
    } catch (error) {
      console.error('Unable to record launch', error);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const openSharedCheckpoint = async () => {
      const postData = await loadSharedPostData();

      if (!postData || cancelled) {
        return;
      }

      try {
        const bytes = decodeSharedState(postData);
        const library = await listGames();
        const matchingGame = await findMatchingLocalGame(library, postData);

        if (cancelled) {
          return;
        }

        setIncomingSharedState(postData);
        setGames(library);
        pendingSharedStateRef.current = {
          bytes,
          gameId: matchingGame?.id ?? null,
          postData,
        };

        if (matchingGame) {
          activateGame(matchingGame);
          showToast('Matching ROM found. Loading shared checkpoint...');
          return;
        }

        setSelectedCore(postData.c);
        setTitle(postData.g);
        setActivePanel('import');
        showToast('Import your matching ROM to play this checkpoint');
      } catch (error) {
        console.error('Unable to open shared checkpoint', error);
        showToast('This shared checkpoint is invalid');
      }
    };

    void openSharedCheckpoint();

    return () => {
      cancelled = true;
    };
  }, [activateGame]);

  const updateSelectedSettings = async (
    settings: Partial<EmulatorSettings>
  ) => {
    if (!selectedGame) {
      return;
    }

    const nextSettings: EmulatorSettings = {
      ...selectedGame.settings,
      ...settings,
    };
    const updatedAt = new Date().toISOString();
    const nextGame: StoredGame = {
      ...selectedGame,
      settings: nextSettings,
      updatedAt,
    };
    const updated = hasGameFiles(selectedGame)
      ? await updateGameSettings(selectedGame.id, nextSettings)
      : nextGame;

    if (updated) {
      setGames((current) => replaceGame(current, updated));
    }
  };

  const removeGame = async (game: StoredGame) => {
    await deleteGame(game.id);

    await refreshLibrary(selectedGameId === game.id ? null : selectedGameId);

    if (activeGameId === game.id) {
      setActiveGameId(null);
    }

    showToast(`Removed ${game.title}`);
  };

  const copyManifest = async (game: StoredGame) => {
    const manifest = {
      title: game.title,
      core: game.core,
      system: getSystemByCore(game.core)?.name ?? game.core,
      romName: game.romName,
      romSize: game.romSize,
      source: 'local-file',
      bios: game.biosName,
      settings: game.settings,
    };

    await navigator.clipboard.writeText(JSON.stringify(manifest, null, 2));
    showToast('Copied game manifest');
  };

  const importPanel = (
    <section className="border-b border-[#2f332f] p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <UploadCloud className="h-4 w-4 shrink-0 text-[#fbbf24]" />
          <h2 className="truncate text-sm font-semibold uppercase tracking-normal text-[#fbbf24]">
            Import
          </h2>
        </div>
        <span className="rounded bg-[#262a28] px-2 py-1 text-xs text-[#c9c1ad]">
          Local
        </span>
      </div>

      <div className="grid gap-3">
        {incomingSharedState && !activeGameId ? (
          <div className="rounded-md border border-[#60a5fa] bg-[#101c2a] p-3 text-sm">
            <div className="font-semibold text-white">
              Play shared checkpoint
            </div>
            <p className="mt-1 text-xs leading-5 text-[#c8d8eb]">
              Choose your own matching {incomingSharedState.g} ROM. EmuArcade
              compares an on-device fingerprint; the ROM is never included in
              the post or uploaded.
            </p>
          </div>
        ) : null}
        <label className="grid gap-1 text-xs text-[#c9c1ad]">
          System
          <select
            className="h-10 rounded-md border border-[#3a3f3b] bg-[#0d0e10] px-3 text-sm text-[#f7f3ea] outline-none focus:border-[#34d399]"
            value={selectedCore}
            onChange={handleCoreChange}
          >
            {EMULATOR_SYSTEMS.map((system) => (
              <option key={system.core} value={system.core}>
                {system.shortName} - {system.name}
              </option>
            ))}
          </select>
        </label>

        <div className="rounded-md border border-[#2f332f] bg-[#17191a] p-3">
          <div className="text-xs text-[#c9c1ad]">Detected title</div>
          <div className="mt-1 min-h-5 truncate text-sm font-semibold">
            {title || 'Choose a ROM file'}
          </div>
          <div className="mt-1 text-xs text-[#8e958a]">
            {titleSource === 'header'
              ? 'Read from ROM header'
              : titleSource === 'filename'
                ? 'Inferred from filename'
                : 'Waiting for ROM'}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <input
            ref={romInputRef}
            className="sr-only"
            type="file"
            onChange={handleRomFileChange}
          />
          <input
            ref={biosInputRef}
            className="sr-only"
            type="file"
            onChange={handleBiosFileChange}
          />
          <button
            className="inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-md border border-[#3a3f3b] bg-[#1d201f] px-3 text-sm transition hover:border-[#34d399]"
            onClick={() => romInputRef.current?.click()}
          >
            <FolderOpen className="h-4 w-4 shrink-0" />
            <span className="truncate">{romFile?.name ?? 'ROM'}</span>
          </button>
          <button
            className="inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-md border border-[#3a3f3b] bg-[#1d201f] px-3 text-sm transition hover:border-[#60a5fa]"
            onClick={() => biosInputRef.current?.click()}
          >
            <Database className="h-4 w-4 shrink-0" />
            <span className="truncate">{biosFile?.name ?? 'BIOS'}</span>
          </button>
          <p className="col-span-2 text-xs leading-5 text-[#c9c1ad]">
            {reconnectGame
              ? `${reconnectGame.title} matches a local library entry. This file will reconnect it on this device.`
              : 'Most systems do not need a BIOS. PlayStation and ColecoVision may need one that the app cannot bundle.'}
          </p>
          <button
            className="col-span-2 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#ff4500] px-3 text-sm font-semibold text-white transition hover:bg-[#e63d00] disabled:cursor-not-allowed disabled:bg-[#5b392e]"
            onClick={() => void addFileGame()}
            disabled={busy || !romFile || !titleSource}
          >
            <CheckCircle2 className="h-4 w-4" />
            {reconnectGame ? 'Reconnect ROM' : 'Add to Library'}
          </button>
        </div>
      </div>
    </section>
  );

  const libraryPanel = (
    <section className="border-b border-[#2f332f] p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Library className="h-4 w-4 shrink-0 text-[#34d399]" />
          <h2 className="truncate text-sm font-semibold uppercase tracking-normal text-[#34d399]">
            Library
          </h2>
        </div>
        <span className="text-xs text-[#c9c1ad]">
          {games.length === 0
            ? '0 games'
            : `${libraryStart + 1}-${libraryEnd} of ${games.length}`}
        </span>
      </div>

      <div className="grid gap-2">
        {games.length === 0 ? (
          <div className="rounded-md border border-dashed border-[#3a3f3b] p-4 text-sm text-[#c9c1ad]">
            No games yet.
          </div>
        ) : (
          pagedGames.map((game) => (
            <button
              key={game.id}
              className={`grid gap-1 rounded-md border p-3 text-left transition ${
                selectedGameId === game.id
                  ? 'border-[#34d399] bg-[#17211d]'
                  : 'border-[#2f332f] bg-[#17191a] hover:border-[#fbbf24]'
              }`}
              onClick={() => setSelectedGameId(game.id)}
            >
              <span className="flex min-w-0 items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold">
                  {game.title}
                </span>
                <span className="rounded bg-[#262a28] px-2 py-0.5 text-xs text-[#fbbf24]">
                  {getGameSystemLabel(game)}
                </span>
              </span>
              <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#c9c1ad]">
                <span>{formatBytes(game.romSize)}</span>
                <span>{formatDate(game.updatedAt)}</span>
                {game.biosName ? <span>BIOS</span> : null}
                {!hasGameFiles(game) ? (
                  <span className="text-[#ffb5a4]">Reconnect ROM</span>
                ) : null}
              </span>
            </button>
          ))
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          className="inline-flex h-9 items-center justify-center rounded-md border border-[#3a3f3b] bg-[#1d201f] px-3 text-sm transition hover:border-[#34d399] disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => setLibraryPage(Math.max(0, clampedLibraryPage - 1))}
          disabled={clampedLibraryPage === 0}
          title="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-xs text-[#c9c1ad]">
          Page {clampedLibraryPage + 1} / {libraryPageCount}
        </span>
        <button
          className="inline-flex h-9 items-center justify-center rounded-md border border-[#3a3f3b] bg-[#1d201f] px-3 text-sm transition hover:border-[#34d399] disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() =>
            setLibraryPage(
              Math.min(libraryPageCount - 1, clampedLibraryPage + 1)
            )
          }
          disabled={clampedLibraryPage >= libraryPageCount - 1}
          title="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </section>
  );

  const settingsPanel = (
    <section className="p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Settings2 className="h-4 w-4 shrink-0 text-[#60a5fa]" />
          <h2 className="truncate text-sm font-semibold uppercase tracking-normal text-[#60a5fa]">
            Settings
          </h2>
        </div>
        <span className="truncate text-xs text-[#c9c1ad]">
          {selectedGame ? getGameSystemLabel(selectedGame) : 'No game'}
        </span>
      </div>

      {selectedGame ? (
        <div className="grid gap-3">
          <label className="grid gap-1 text-xs text-[#c9c1ad]">
            Shader
            <select
              className="h-10 rounded-md border border-[#3a3f3b] bg-[#0d0e10] px-3 text-sm text-[#f7f3ea] outline-none focus:border-[#34d399]"
              value={selectedGame.settings.shader}
              onChange={handleShaderChange}
            >
              {VIDEO_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </label>

          {selectedGame.core === 'n64' ? (
            <label className="grid gap-1 text-xs text-[#c9c1ad]">
              N64 core
              <select
                className="h-10 rounded-md border border-[#3a3f3b] bg-[#0d0e10] px-3 text-sm text-[#f7f3ea] outline-none focus:border-[#34d399]"
                value={selectedGame.settings.n64Core}
                onChange={handleN64CoreChange}
              >
                {N64_CORE_OPTIONS.map((core) => (
                  <option key={core.value} value={core.value}>
                    {core.label}
                  </option>
                ))}
              </select>
              <span className="text-xs text-[#8e958a]">
                Relaunch the game after changing cores.
              </span>
            </label>
          ) : null}

          <label className="grid gap-2 text-xs text-[#c9c1ad]">
            <span className="flex items-center gap-2">
              {selectedGame.settings.muted ? (
                <VolumeX className="h-4 w-4" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
              Volume {Math.round(selectedGame.settings.volume * 100)}%
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={selectedGame.settings.volume}
              onChange={(event) =>
                void updateSelectedSettings({
                  volume: event.currentTarget.valueAsNumber,
                })
              }
            />
          </label>

          <details
            className="rounded-md border border-[#2f332f] bg-[#17191a] p-3"
            open
          >
            <summary className="cursor-pointer text-sm font-semibold text-[#f7f3ea]">
              Playback toggles
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <label className="flex min-h-11 items-center gap-2 rounded-md border border-[#2f332f] bg-[#111315] p-3">
                <input
                  type="checkbox"
                  checked={selectedGame.settings.muted}
                  onChange={(event) =>
                    void updateSelectedSettings({
                      muted: event.currentTarget.checked,
                    })
                  }
                />
                Mute
              </label>
              <label className="flex min-h-11 items-center gap-2 rounded-md border border-[#2f332f] bg-[#111315] p-3">
                <input
                  type="checkbox"
                  checked={selectedGame.settings.rewind}
                  onChange={(event) =>
                    void updateSelectedSettings({
                      rewind: event.currentTarget.checked,
                    })
                  }
                />
                Rewind
              </label>
              <label className="flex min-h-11 items-center gap-2 rounded-md border border-[#2f332f] bg-[#111315] p-3">
                <input
                  type="checkbox"
                  checked={selectedGame.settings.threads}
                  onChange={(event) =>
                    void updateSelectedSettings({
                      threads: event.currentTarget.checked,
                    })
                  }
                />
                Threads
              </label>
              <label className="flex min-h-11 items-center gap-2 rounded-md border border-[#2f332f] bg-[#111315] p-3">
                <input
                  type="checkbox"
                  checked={selectedGame.settings.virtualGamepad}
                  onChange={(event) =>
                    void updateSelectedSettings({
                      virtualGamepad: event.currentTarget.checked,
                    })
                  }
                />
                Touch
              </label>
            </div>
          </details>

          <details className="rounded-md border border-[#2f332f] bg-[#17191a] p-3">
            <summary className="cursor-pointer text-sm font-semibold text-[#f7f3ea]">
              Clip capture
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <button
                className={`min-h-11 rounded-md border px-3 text-left transition ${
                  clipRecordingMode === 'manual'
                    ? 'border-[#ff4500] bg-[#3a2118] text-white'
                    : 'border-[#2f332f] bg-[#111315] text-[#c9c1ad] hover:border-[#ff4500]'
                }`}
                onClick={() => setClipRecordingModeAndPersist('manual')}
              >
                Manual
              </button>
              <button
                className={`min-h-11 rounded-md border px-3 text-left transition ${
                  clipRecordingMode === 'rolling'
                    ? 'border-[#34d399] bg-[#13251f] text-white'
                    : 'border-[#2f332f] bg-[#111315] text-[#c9c1ad] hover:border-[#34d399]'
                }`}
                onClick={() => setClipRecordingModeAndPersist('rolling')}
              >
                Rolling 10s
              </button>
            </div>
            <p className="mt-2 text-xs text-[#8e958a]">
              {clipRecordingMode === 'rolling'
                ? rollingBufferActive
                  ? 'Rolling buffer ready.'
                  : 'Rolling buffer starts after a game is running.'
                : 'Press Clip once to record and again to finish.'}
            </p>
          </details>

          <div className="grid grid-cols-3 gap-2">
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#3a3f3b] bg-[#1d201f] px-3 text-sm transition hover:border-[#ff4500]"
              onClick={() => void launchGame(selectedGame)}
            >
              <Play className="h-4 w-4" />
              {hasGameFiles(selectedGame) ? 'Play' : 'Reconnect'}
            </button>
            <button
              className="inline-flex h-10 items-center justify-center rounded-md border border-[#3a3f3b] bg-[#1d201f] px-3 transition hover:border-[#60a5fa]"
              onClick={() => void copyManifest(selectedGame)}
              title="Copy manifest"
            >
              <Copy className="h-4 w-4" />
            </button>
            <button
              className="inline-flex h-10 items-center justify-center rounded-md border border-[#3a3f3b] bg-[#1d201f] px-3 text-[#ffb5a4] transition hover:border-[#ff4500]"
              onClick={() => void removeGame(selectedGame)}
              title="Remove game"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-[#3a3f3b] p-4 text-sm text-[#c9c1ad]">
          Select a game.
        </div>
      )}
    </section>
  );

  const stagePanel = (
    <section
      className={`grid h-full min-h-0 bg-[#070809] ${
        usePhoneImmersiveLayout ? 'emuarcade-stage--phone-rotated' : ''
      }`}
    >
      <div
        ref={stageViewportRef}
        className="relative min-h-0 overflow-hidden"
      >
        <div ref={stageContentRef} className="emuarcade-stage-content">
          {runnerSrc ? (
            <iframe
              ref={setRunnerFrame}
              key={runnerSrc}
              className="absolute inset-0 h-full w-full border-0 bg-black"
              src={runnerSrc}
              title="EmuArcade Emulator"
              allow="gamepad; fullscreen"
              onLoad={() => {
                postClipStateToRunner();
                postPendingSharedStateToRunner();
              }}
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center bg-[#050607] p-4">
              <div className="grid max-w-sm place-items-center gap-4 text-center">
                <img
                  className="h-20 w-20 sm:h-24 sm:w-24"
                  src="/emuarcade-mark.svg"
                  alt="EmuArcade cabinet"
                />
                <div>
                  <h2 className="text-xl font-semibold sm:text-2xl">Ready</h2>
                  <p className="mt-2 text-sm text-[#c9c1ad]">
                    {selectedGame
                      ? hasGameFiles(selectedGame)
                        ? `${selectedGame.title} is selected.`
                        : `${selectedGame.title} needs its ROM reconnected.`
                      : 'Your library is empty.'}
                  </p>
                </div>
                <button
                  className="inline-flex h-11 items-center gap-2 rounded-md bg-[#ff4500] px-4 text-sm font-semibold text-white transition hover:bg-[#e63d00] disabled:cursor-not-allowed disabled:bg-[#5b392e]"
                  onClick={() => {
                    if (selectedGame) {
                      if (hasGameFiles(selectedGame)) {
                        void launchGame(selectedGame);
                      } else {
                        setActivePanel('import');
                      }
                    }
                  }}
                  disabled={!selectedGame}
                >
                  <Gamepad2 className="h-4 w-4" />
                  {selectedGame && !hasGameFiles(selectedGame)
                    ? 'Reconnect'
                    : 'Start'}
                </button>
              </div>
            </div>
          )}
          {stateShareDraft ? (
            <div className="absolute inset-0 z-20 grid place-items-center overflow-y-auto bg-black/70 p-3">
              <div
                aria-label="Share checkpoint"
                aria-modal="true"
                className="w-[min(520px,100%)] rounded-md border border-[#3a3f3b] bg-[#111315] p-4 shadow-2xl"
                role="dialog"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-base font-semibold">
                      <Save className="h-5 w-5 text-[#34d399]" />
                      Share exact checkpoint
                    </div>
                    <p className="mt-1 text-xs text-[#a8afa6]">
                      The matching ROM stays on each player's device.
                    </p>
                  </div>
                  <button
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#3a3f3b] bg-[#1d201f]"
                    onClick={closeStateShare}
                    title="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-md border border-[#2f332f] bg-[#17191a] p-2">
                    <div className="text-[#8e958a]">Raw</div>
                    <strong>{formatBytes(stateShareDraft.rawBytes)}</strong>
                  </div>
                  <div className="rounded-md border border-[#2f332f] bg-[#17191a] p-2">
                    <div className="text-[#8e958a]">Compressed</div>
                    <strong>
                      {formatBytes(stateShareDraft.compressedBytes)}
                    </strong>
                  </div>
                  <div className="rounded-md border border-[#2f332f] bg-[#17191a] p-2">
                    <div className="text-[#8e958a]">Post data</div>
                    <strong
                      className={
                        stateShareFits ? 'text-[#34d399]' : 'text-[#ff8066]'
                      }
                    >
                      {stateSharePostDataBytes}/{MAX_SHARED_POST_DATA_BYTES} B
                    </strong>
                  </div>
                </div>

                <label className="mt-3 grid gap-1 text-xs text-[#c9c1ad]">
                  Post title
                  <input
                    className="h-10 rounded-md border border-[#3a3f3b] bg-[#0d0e10] px-3 text-sm text-white outline-none focus:border-[#34d399]"
                    maxLength={120}
                    onChange={(event) =>
                      setStateShareTitle(event.currentTarget.value)
                    }
                    value={stateShareTitle}
                  />
                </label>

                <div className="mt-3">
                  <div className="text-xs text-[#c9c1ad]">Post preview</div>
                  <div className="mt-1 grid grid-cols-3 gap-2">
                    <button
                      className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md border px-2 text-xs ${
                        stateSharePreviewKind === 'image'
                          ? 'border-[#34d399] bg-[#13251f] text-white'
                          : 'border-[#3a3f3b] bg-[#1d201f] text-[#c9c1ad]'
                      }`}
                      disabled={!stateShareDraft.thumbnailDataUrl}
                      onClick={() => setStateSharePreviewKind('image')}
                    >
                      <ImageIcon className="h-4 w-4" />
                      Snapshot
                    </button>
                    <button
                      className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md border px-2 text-xs ${
                        stateSharePreviewKind === 'gif'
                          ? 'border-[#ff4500] bg-[#3a2118] text-white'
                          : 'border-[#3a3f3b] bg-[#1d201f] text-[#c9c1ad]'
                      }`}
                      disabled={!canUseClipForStatePreview}
                      onClick={() => setStateSharePreviewKind('gif')}
                    >
                      <MonitorPlay className="h-4 w-4" />
                      Latest GIF
                    </button>
                    <button
                      className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md border px-2 text-xs ${
                        stateSharePreviewKind === 'hidden'
                          ? 'border-[#60a5fa] bg-[#101c2a] text-white'
                          : 'border-[#3a3f3b] bg-[#1d201f] text-[#c9c1ad]'
                      }`}
                      onClick={() => setStateSharePreviewKind('hidden')}
                    >
                      <LockKeyhole className="h-4 w-4" />
                      Hidden
                    </button>
                  </div>
                </div>

                <label className="mt-3 grid gap-1 text-xs text-[#c9c1ad]">
                  Optional comment
                  <textarea
                    className="min-h-20 resize-y rounded-md border border-[#3a3f3b] bg-[#0d0e10] p-3 text-sm text-white outline-none focus:border-[#60a5fa]"
                    maxLength={10_000}
                    onChange={(event) =>
                      setStateShareComment(event.currentTarget.value)
                    }
                    placeholder="Add context beneath the post"
                    value={stateShareComment}
                  />
                </label>

                {!stateShareFits ? (
                  <p className="mt-3 rounded-md border border-[#7f3124] bg-[#2b1511] p-2 text-xs leading-5 text-[#ffb5a4]">
                    This core's exact state does not compress below the safe
                    post-data limit. It has not been truncated or altered.
                  </p>
                ) : null}

                {stateShareResult ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#ff4500] px-3 text-sm font-semibold text-white"
                      onClick={() => navigateTo(stateShareResult.postUrl)}
                    >
                      <Play className="h-4 w-4" />
                      View post
                    </button>
                    {stateShareComment.trim() && !stateShareCommentPosted ? (
                      <button
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#60a5fa] bg-[#101c2a] px-3 text-sm"
                        disabled={stateShareStatus === 'commenting'}
                        onClick={() => void sharePreparedStateComment()}
                      >
                        <MessageCircle className="h-4 w-4" />
                        {stateShareStatus === 'commenting'
                          ? 'Posting'
                          : 'Post comment'}
                      </button>
                    ) : (
                      <button
                        className="h-10 rounded-md border border-[#3a3f3b] bg-[#1d201f] px-3 text-sm"
                        onClick={closeStateShare}
                      >
                        Done
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#ff4500] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#5b392e]"
                    disabled={
                      !stateShareFits ||
                      !stateShareTitle.trim() ||
                      stateShareStatus === 'sharing'
                    }
                    onClick={() => void sharePreparedState()}
                  >
                    <Share2 className="h-4 w-4" />
                    {stateShareStatus === 'sharing'
                      ? stateSharePreviewKind === 'gif'
                        ? 'Encoding and sharing'
                        : 'Sharing'
                      : 'Create checkpoint post'}
                  </button>
                )}
              </div>
            </div>
          ) : null}
          {recordedClip ? (
            <div className="absolute right-3 bottom-3 z-10 max-h-[calc(100%-24px)] w-[min(380px,calc(100%-24px))] overflow-y-auto rounded-md border border-[#3a3f3b] bg-[#111315]/95 p-3 shadow-2xl backdrop-blur">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">
                    Clip ready
                  </div>
                  <div className="text-xs text-[#c9c1ad]">
                    {formatDuration(recordedClip.durationMs)} -{' '}
                    {formatBytes(recordedClip.sizeBytes)} -{' '}
                    {recordedClip.recordingMode === 'rolling'
                      ? 'rolling'
                      : 'manual'}
                  </div>
                </div>
                <button
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#3a3f3b] bg-[#1d201f] transition hover:border-[#ff4500]"
                  onClick={discardClip}
                  title="Discard clip"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <video
                className="mt-2 aspect-video w-full rounded bg-black"
                src={recordedClip.url}
                controls
                muted
                playsInline
              />
              <details className="mt-2 rounded-md border border-[#2f332f] bg-[#17191a] p-2">
                <summary className="cursor-pointer text-xs font-semibold text-[#c9c1ad]">
                  Post details
                </summary>
                <label className="mt-2 grid gap-1 text-xs text-[#a8afa6]">
                  Title
                  <input
                    className="h-9 rounded-md border border-[#3a3f3b] bg-[#0d0e10] px-2 text-sm text-white outline-none focus:border-[#34d399]"
                    maxLength={120}
                    onChange={(event) =>
                      setClipPostTitle(event.currentTarget.value)
                    }
                    value={clipPostTitle}
                  />
                </label>
                <label className="mt-2 grid gap-1 text-xs text-[#a8afa6]">
                  Optional comment
                  <textarea
                    className="min-h-16 resize-y rounded-md border border-[#3a3f3b] bg-[#0d0e10] p-2 text-sm text-white outline-none focus:border-[#60a5fa]"
                    maxLength={10_000}
                    onChange={(event) =>
                      setClipPostComment(event.currentTarget.value)
                    }
                    value={clipPostComment}
                  />
                </label>
              </details>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  className="inline-flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-md bg-[#ff4500] px-2 text-xs font-semibold text-white transition hover:bg-[#e63d00] disabled:cursor-not-allowed disabled:bg-[#5b392e] sm:gap-2 sm:px-3 sm:text-sm"
                  onClick={() => void shareRecordedGif()}
                  disabled={
                    !clipPostTitle.trim() ||
                    clipState === 'sharing' ||
                    clipState === 'encoding-gif'
                  }
                >
                  <Share2 className="h-4 w-4" />
                  {clipState === 'encoding-gif'
                    ? 'Encoding'
                    : clipState === 'sharing'
                      ? 'Sharing'
                      : 'Share GIF'}
                </button>
                <button
                  className="inline-flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-md border border-[#3a3f3b] bg-[#1d201f] px-2 text-xs transition hover:border-[#60a5fa] sm:gap-2 sm:px-3 sm:text-sm"
                  onClick={downloadRecordedClip}
                >
                  <Download className="h-4 w-4" />
                  Download
                </button>
              </div>
              {sharedClipPostId &&
              clipPostComment.trim() &&
              !clipCommentPosted ? (
                <button
                  className="mt-2 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-[#60a5fa] bg-[#101c2a] px-3 text-sm disabled:opacity-60"
                  disabled={clipCommentPosting}
                  onClick={() => void shareRecordedClipComment()}
                >
                  <MessageCircle className="h-4 w-4" />
                  {clipCommentPosting ? 'Posting' : 'Post comment'}
                </button>
              ) : null}
              {sharedClipUrl ? (
                <div className="mt-2 truncate text-xs text-[#8e958a]">
                  Shared: {sharedClipUrl}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );

  const mobileControlsPanel = (
    <div className="h-full overflow-y-auto bg-[#121416]">
      {activePanel === 'library' ? libraryPanel : null}
      {activePanel === 'import' ? importPanel : null}
      {activePanel === 'settings' ? settingsPanel : null}
    </div>
  );

  return (
    <div
      className={`emuarcade-app-shell ${
        usePhoneImmersiveLayout ? 'emuarcade-app-shell--phone-immersive' : ''
      } grid h-full min-h-0 overflow-hidden bg-[#0d0e10] text-[#f7f3ea]`}
    >
      <div className="grid min-h-0 grid-rows-[minmax(0,1fr)]">
        <main
          className={`grid min-h-0 overflow-hidden ${
            isDesktopLayout
              ? sidebarCollapsed
                ? 'grid-cols-[64px_minmax(0,1fr)]'
                : 'grid-cols-[390px_minmax(0,1fr)]'
              : 'grid-cols-1'
          }`}
        >
          {isDesktopLayout ? (
            <>
              <aside className="grid min-h-0 border-r border-[#2f332f] bg-[#121416]">
                {sidebarCollapsed ? (
                  <div className="grid h-full grid-rows-[auto_1fr] place-items-center gap-3 p-3">
                    <button
                      className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#3a3f3b] bg-[#1d201f] transition hover:border-[#60a5fa]"
                      onClick={() => setSidebarCollapsed(false)}
                      title="Show sidebar"
                    >
                      <PanelLeftOpen className="h-4 w-4" />
                    </button>
                    <div className="grid gap-2 self-start pt-2">
                      <UploadCloud className="h-4 w-4 text-[#fbbf24]" />
                      <Library className="h-4 w-4 text-[#34d399]" />
                      <SlidersHorizontal className="h-4 w-4 text-[#60a5fa]" />
                    </div>
                  </div>
                ) : (
                  <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
                    <div className="flex items-center justify-between gap-3 border-b border-[#2f332f] px-4 py-3">
                      <span className="text-xs font-semibold uppercase tracking-normal text-[#c9c1ad]">
                        Control panel
                      </span>
                      <button
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#3a3f3b] bg-[#1d201f] transition hover:border-[#60a5fa]"
                        onClick={() => setSidebarCollapsed(true)}
                        title="Collapse sidebar"
                      >
                        <PanelLeftClose className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="emuarcade-scroll min-h-0 overflow-y-auto">
                      {importPanel}
                      {libraryPanel}
                      {settingsPanel}
                    </div>
                  </div>
                )}
              </aside>

              <section className="grid min-h-0 overflow-hidden">
                {stagePanel}
              </section>
            </>
          ) : (
            <section
              className={`grid min-h-0 overflow-hidden ${
                usePhoneImmersiveLayout
                  ? 'grid-rows-[minmax(0,1fr)]'
                  : 'grid-rows-[minmax(0,1fr)_auto]'
              }`}
            >
              <div className="relative min-h-0 overflow-hidden">
                <div
                  className={`absolute inset-0 ${
                    activePanel === 'play' || usePhoneImmersiveLayout
                      ? 'block'
                      : 'hidden'
                  }`}
                >
                  {stagePanel}
                </div>
                {usePhoneImmersiveLayout ? null : (
                  <div
                    className={`absolute inset-0 ${
                      activePanel === 'play' ? 'hidden' : 'block'
                    }`}
                  >
                    {mobileControlsPanel}
                  </div>
                )}
              </div>
              {usePhoneImmersiveLayout ? null : (
                <nav className="grid grid-cols-4 border-t border-[#2f332f] bg-[#151719]">
                  <button
                    className={`grid min-h-14 place-items-center gap-1 px-1 py-2 text-xs ${
                      activePanel === 'play'
                        ? 'text-[#34d399]'
                        : 'text-[#c9c1ad]'
                    }`}
                    onClick={() => setActivePanel('play')}
                  >
                    <MonitorPlay className="h-4 w-4" />
                    Play
                  </button>
                  <button
                    className={`grid min-h-14 place-items-center gap-1 px-1 py-2 text-xs ${
                      activePanel === 'library'
                        ? 'text-[#34d399]'
                        : 'text-[#c9c1ad]'
                    }`}
                    onClick={() => setActivePanel('library')}
                  >
                    <Library className="h-4 w-4" />
                    Library
                  </button>
                  <button
                    className={`grid min-h-14 place-items-center gap-1 px-1 py-2 text-xs ${
                      activePanel === 'import'
                        ? 'text-[#fbbf24]'
                        : 'text-[#c9c1ad]'
                    }`}
                    onClick={() => setActivePanel('import')}
                  >
                    <UploadCloud className="h-4 w-4" />
                    Import
                  </button>
                  <button
                    className={`grid min-h-14 place-items-center gap-1 px-1 py-2 text-xs ${
                      activePanel === 'settings'
                        ? 'text-[#60a5fa]'
                        : 'text-[#c9c1ad]'
                    }`}
                    onClick={() => setActivePanel('settings')}
                  >
                    <Settings2 className="h-4 w-4" />
                    Settings
                  </button>
                </nav>
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  );
};

const root = document.getElementById('root');

if (root) {
  const app = (
    <StrictMode>
      <App />
    </StrictMode>
  );

  if (window.emuarcadeRoot) {
    window.emuarcadeRoot.render(app);
  } else {
    window.emuarcadeRoot = createRoot(root);
    window.emuarcadeRoot.render(app);
  }
}
