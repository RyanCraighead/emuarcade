export type EmulatorCore =
  | 'nes'
  | 'snes'
  | 'segaMS'
  | 'segaMD'
  | 'segaGG'
  | 'gb'
  | 'gba'
  | 'n64'
  | 'nds'
  | 'psx'
  | 'psp'
  | 'atari2600'
  | 'atari7800'
  | 'lynx'
  | 'pce'
  | 'vb'
  | 'ngp'
  | 'ws'
  | 'coleco'
  | 'arcade';

export type VideoFilter =
  | 'disabled'
  | 'crt-aperture.glslp'
  | 'crt-easymode.glslp'
  | 'crt-geom.glslp'
  | '2xScaleHQ.glslp'
  | '4xScaleHQ.glslp'
  | 'sabr'
  | 'bicubic'
  | 'mix-frames';

export type N64CoreOption = 'mupen64plus_next' | 'parallel_n64';

export type EmulatorSystem = {
  core: EmulatorCore;
  name: string;
  shortName: string;
  extensions: readonly string[];
  needsBios: boolean;
  description: string;
};

export type EmulatorSettings = {
  volume: number;
  muted: boolean;
  shader: VideoFilter;
  n64Core: N64CoreOption;
  rewind: boolean;
  threads: boolean;
  virtualGamepad: boolean;
  startOnLoad: boolean;
};

export type AppInfo = {
  username: string;
  subredditName: string;
  postId: string | null;
  launchCount: number;
};

export type LaunchInput = {
  core: EmulatorCore;
  title: string;
};

export type LaunchResult = {
  launchCount: number;
};

export type ViewerState = {
  isAuthenticated: boolean;
  isNewPlayer: boolean;
};

export type ClipShareInput = {
  dataUrl: string;
  thumbnailDataUrl: string | null;
  mimeType: string;
  shareFormat: 'video' | 'gif';
  sizeBytes: number;
  durationMs: number;
  gameTitle: string;
  core: EmulatorCore;
  postTitle?: string | undefined;
};

export type ClipShareResult = {
  mediaUrl: string;
  postId: string | null;
  postUrl: string | null;
  subredditName: string;
  shareKind: 'video' | 'gif' | 'image';
};

export const getDefaultClipPostTitle = (gameTitle: string) => {
  const normalizedTitle = gameTitle.replace(/\s+/g, ' ').trim();
  const suffixIndex = normalizedTitle.search(/[([]/);
  const title = (
    suffixIndex >= 0 ? normalizedTitle.slice(0, suffixIndex) : normalizedTitle
  ).trim();

  return (title || 'EmuArcade clip').slice(0, 120);
};

export const EMULATORJS_DATA_PATH = '/emulatorjs/data/';
export const EMULATORJS_STATE_BUILD = '4.2.3';

const STATE_CORE_NAMES: Record<EmulatorCore, string> = {
  arcade: 'fbneo',
  atari2600: 'stella2014',
  atari7800: 'prosystem',
  coleco: 'gearcoleco',
  gb: 'gambatte',
  gba: 'mgba',
  lynx: 'handy',
  n64: 'parallel_n64',
  nds: 'melonds',
  nes: 'fceumm',
  ngp: 'mednafen_ngp',
  pce: 'mednafen_pce',
  psp: 'ppsspp',
  psx: 'pcsx_rearmed',
  segaGG: 'genesis_plus_gx',
  segaMD: 'genesis_plus_gx',
  segaMS: 'smsplus',
  snes: 'snes9x',
  vb: 'beetle_vb',
  ws: 'mednafen_wswan',
};

export const getStateCoreFingerprint = (
  core: EmulatorCore,
  n64Core: N64CoreOption = 'parallel_n64'
) => {
  const stateCore = core === 'n64' ? n64Core : STATE_CORE_NAMES[core];

  return `ejs-${EMULATORJS_STATE_BUILD}:${stateCore}`;
};

export const getStateN64Core = (fingerprint: string | undefined) => {
  return (
    N64_CORE_OPTIONS.find(
      ({ value }) => getStateCoreFingerprint('n64', value) === fingerprint
    )?.value ?? null
  );
};

export const isCurrentStateCoreFingerprint = (
  core: EmulatorCore,
  fingerprint: string | undefined
) => {
  if (!fingerprint) {
    return true;
  }

  return core === 'n64'
    ? getStateN64Core(fingerprint) !== null
    : getStateCoreFingerprint(core) === fingerprint;
};

export const DEFAULT_SETTINGS: EmulatorSettings = {
  volume: 0.8,
  muted: false,
  shader: 'disabled',
  n64Core: 'parallel_n64',
  rewind: true,
  threads: false,
  virtualGamepad: true,
  startOnLoad: true,
};

export const VIDEO_FILTERS: readonly { value: VideoFilter; label: string }[] = [
  { value: 'disabled', label: 'Native' },
  { value: 'crt-aperture.glslp', label: 'CRT aperture' },
  { value: 'crt-easymode.glslp', label: 'CRT easymode' },
  { value: 'crt-geom.glslp', label: 'CRT geometry' },
  { value: '2xScaleHQ.glslp', label: '2x scale HQ' },
  { value: '4xScaleHQ.glslp', label: '4x scale HQ' },
  { value: 'sabr', label: 'SABR' },
  { value: 'bicubic', label: 'Bicubic' },
  { value: 'mix-frames', label: 'Mix frames' },
];

export const N64_CORE_OPTIONS: readonly {
  value: N64CoreOption;
  label: string;
  description: string;
}[] = [
  {
    value: 'parallel_n64',
    label: 'ParaLLEl N64',
    description: 'Default N64 core; often smoother on supported devices.',
  },
  {
    value: 'mupen64plus_next',
    label: 'Mupen64Plus Next',
    description: 'Compatibility fallback for games that prefer it.',
  },
];

export const EMULATOR_SYSTEMS: readonly EmulatorSystem[] = [
  {
    core: 'nes',
    name: 'Nintendo Entertainment System',
    shortName: 'NES',
    extensions: ['nes', 'fds'],
    needsBios: false,
    description: 'Fast 8-bit classics with save states and rewind.',
  },
  {
    core: 'snes',
    name: 'Super Nintendo',
    shortName: 'SNES',
    extensions: ['smc', 'sfc', 'fig', 'swc'],
    needsBios: false,
    description: '16-bit console games with rich controller support.',
  },
  {
    core: 'segaMD',
    name: 'Sega Genesis / Mega Drive',
    shortName: 'Genesis',
    extensions: ['md', 'gen', 'smd', 'bin'],
    needsBios: false,
    description: 'Genesis and Mega Drive cartridges.',
  },
  {
    core: 'segaMS',
    name: 'Sega Master System',
    shortName: 'SMS',
    extensions: ['sms'],
    needsBios: false,
    description: 'Master System and compatible 8-bit titles.',
  },
  {
    core: 'segaGG',
    name: 'Sega Game Gear',
    shortName: 'Game Gear',
    extensions: ['gg'],
    needsBios: false,
    description: 'Portable Sega games with virtual controls.',
  },
  {
    core: 'gb',
    name: 'Game Boy / Game Boy Color',
    shortName: 'GB/GBC',
    extensions: ['gb', 'gbc'],
    needsBios: false,
    description: 'Handheld cartridges with battery-save support.',
  },
  {
    core: 'gba',
    name: 'Game Boy Advance',
    shortName: 'GBA',
    extensions: ['gba'],
    needsBios: false,
    description: 'Advance cartridges with optional BIOS file.',
  },
  {
    core: 'n64',
    name: 'Nintendo 64',
    shortName: 'N64',
    extensions: ['n64', 'z64', 'v64'],
    needsBios: false,
    description: '3D console games; larger files can take a moment.',
  },
  {
    core: 'nds',
    name: 'Nintendo DS',
    shortName: 'NDS',
    extensions: ['nds'],
    needsBios: false,
    description: 'Dual-screen handheld titles.',
  },
  {
    core: 'psx',
    name: 'Sony PlayStation',
    shortName: 'PSX',
    extensions: ['cue', 'bin', 'iso', 'img', 'pbp', 'chd'],
    needsBios: true,
    description: 'Disc images; BIOS recommended for compatibility.',
  },
  {
    core: 'psp',
    name: 'PlayStation Portable',
    shortName: 'PSP',
    extensions: ['iso', 'cso', 'pbp'],
    needsBios: false,
    description: 'Portable 3D games; performance depends on device.',
  },
  {
    core: 'atari2600',
    name: 'Atari 2600',
    shortName: '2600',
    extensions: ['a26'],
    needsBios: false,
    description: 'Early cartridge games with simple controls.',
  },
  {
    core: 'atari7800',
    name: 'Atari 7800',
    shortName: '7800',
    extensions: ['a78'],
    needsBios: false,
    description: 'Atari 7800 cartridges.',
  },
  {
    core: 'lynx',
    name: 'Atari Lynx',
    shortName: 'Lynx',
    extensions: ['lnx'],
    needsBios: false,
    description: 'Handheld Atari games.',
  },
  {
    core: 'pce',
    name: 'PC Engine / TurboGrafx-16',
    shortName: 'PCE',
    extensions: ['pce'],
    needsBios: false,
    description: 'Hudson/NEC cartridges and compact discs.',
  },
  {
    core: 'vb',
    name: 'Virtual Boy',
    shortName: 'VB',
    extensions: ['vb', 'vboy'],
    needsBios: false,
    description: 'Virtual Boy titles with adjustable display filters.',
  },
  {
    core: 'ngp',
    name: 'Neo Geo Pocket',
    shortName: 'NGP',
    extensions: ['ngp', 'ngc'],
    needsBios: false,
    description: 'Neo Geo Pocket and Color cartridges.',
  },
  {
    core: 'ws',
    name: 'WonderSwan',
    shortName: 'WS',
    extensions: ['ws', 'wsc'],
    needsBios: false,
    description: 'WonderSwan and WonderSwan Color games.',
  },
  {
    core: 'coleco',
    name: 'ColecoVision',
    shortName: 'Coleco',
    extensions: ['col', 'cv'],
    needsBios: true,
    description: 'ColecoVision cartridges; BIOS may be required.',
  },
  {
    core: 'arcade',
    name: 'Arcade / MAME',
    shortName: 'Arcade',
    extensions: ['zip'],
    needsBios: false,
    description: 'Arcade ROM sets packed as ZIP files.',
  },
];

export const getSystemByCore = (core: EmulatorCore) => {
  return EMULATOR_SYSTEMS.find((system) => system.core === core);
};

export const isEmulatorCore = (value: string): value is EmulatorCore => {
  return EMULATOR_SYSTEMS.some((system) => system.core === value);
};

export const isVideoFilter = (value: string): value is VideoFilter => {
  return VIDEO_FILTERS.some((filter) => filter.value === value);
};

export const isN64CoreOption = (value: string): value is N64CoreOption => {
  return N64_CORE_OPTIONS.some((core) => core.value === value);
};

export const inferCoreFromFileName = (fileName: string): EmulatorCore => {
  const extension = fileName.split('.').pop()?.toLowerCase();
  const system = EMULATOR_SYSTEMS.find((item) =>
    item.extensions.some((supported) => supported === extension)
  );

  return system?.core ?? 'nes';
};
