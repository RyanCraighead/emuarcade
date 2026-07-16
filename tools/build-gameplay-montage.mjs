#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FRAME_SIZE = 720;
const FPS = 24;
const CLIP_SECONDS = 3;
const GRID_SECONDS = 3;
const LOGO_HOLD_SECONDS = 3;
const FADE_SECONDS = 0.4;
const VIDEO_SUFFIXES = new Set(['.m4v', '.mkv', '.mov', '.mp4', '.webm']);

const parseArgs = () => {
  const options = {
    clipsDir: join(ROOT, 'local', 'splash-clips'),
    ffmpeg: 'ffmpeg',
    focalY: 0.62,
    maxClips: 9,
    outputDir: join(ROOT, 'public'),
  };

  for (let index = 2; index < process.argv.length; index += 1) {
    const flag = process.argv[index];
    const value = process.argv[index + 1];

    if (!value) {
      throw new Error(`Missing value for ${flag}`);
    }

    if (flag === '--clips-dir') {
      options.clipsDir = resolve(value);
    } else if (flag === '--output-dir') {
      options.outputDir = resolve(value);
    } else if (flag === '--max-clips') {
      options.maxClips = Number.parseInt(value, 10);
    } else if (flag === '--focal-y') {
      options.focalY = Number.parseFloat(value);
    } else if (flag === '--ffmpeg') {
      options.ffmpeg = value;
    } else {
      throw new Error(`Unknown option: ${flag}`);
    }

    index += 1;
  }

  if (!Number.isInteger(options.maxClips) || options.maxClips < 1) {
    throw new Error('--max-clips must be a positive integer');
  }
  if (options.focalY < 0 || options.focalY > 1) {
    throw new Error('--focal-y must be between 0 and 1');
  }

  return options;
};

const run = (command, args) => {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
};

const findClips = (directory, limit) => {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory)
    .map((name) => join(directory, name))
    .filter(
      (path) =>
        statSync(path).isFile() && VIDEO_SUFFIXES.has(extname(path).toLowerCase())
    )
    .sort((left, right) => left.localeCompare(right))
    .slice(0, limit);
};

const encodeOptions = (output) => [
  '-c:v',
  'libx264',
  '-preset',
  'medium',
  '-crf',
  '23',
  '-pix_fmt',
  'yuv420p',
  output,
];

const normalizeClip = (ffmpeg, source, output, focalY) => {
  const cropY = `(in_h-${FRAME_SIZE})*${focalY.toFixed(3)}`;
  const videoFilter = [
    `scale=${FRAME_SIZE}:${FRAME_SIZE}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${FRAME_SIZE}:${FRAME_SIZE}:(in_w-${FRAME_SIZE})/2:${cropY}`,
    `fps=${FPS}`,
    'setsar=1',
    `fade=t=in:st=0:d=${FADE_SECONDS}`,
    `fade=t=out:st=${CLIP_SECONDS - FADE_SECONDS}:d=${FADE_SECONDS}`,
    'format=yuv420p',
  ].join(',');

  run(ffmpeg, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-stream_loop',
    '-1',
    '-i',
    source,
    '-t',
    String(CLIP_SECONDS),
    '-an',
    '-vf',
    videoFilter,
    ...encodeOptions(output),
  ]);
};

const buildGrid = (ffmpeg, clips, output) => {
  const inputs = Array.from(
    { length: 9 },
    (_, index) => clips[index % clips.length]
  );
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];

  for (const clip of inputs) {
    args.push('-stream_loop', '-1', '-i', clip);
  }

  const tileSize = FRAME_SIZE / 3;
  const filters = inputs.map(
    (_, index) =>
      `[${index}:v]scale=${tileSize}:${tileSize}:flags=lanczos,` +
      `setpts=PTS-STARTPTS[t${index}]`
  );
  const tileInputs = inputs.map((_, index) => `[t${index}]`).join('');
  const layout = Array.from({ length: 9 }, (_, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    return `${column * tileSize}_${row * tileSize}`;
  }).join('|');

  filters.push(
    `${tileInputs}xstack=inputs=9:layout=${layout}:fill=black[grid]`
  );
  filters.push(
    '[grid]' +
      `zoompan=z='if(lte(on,${FPS}),2.5-1.5*on/${FPS},1)':` +
      "x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':" +
      `d=1:s=${FRAME_SIZE}x${FRAME_SIZE}:fps=${FPS},` +
      `trim=duration=${GRID_SECONDS},setpts=PTS-STARTPTS,` +
      `fade=t=out:st=${GRID_SECONDS - FADE_SECONDS}:d=${FADE_SECONDS},` +
      'format=yuv420p[out]'
  );

  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[out]',
    '-an',
    '-frames:v',
    String(GRID_SECONDS * FPS),
    ...encodeOptions(output)
  );
  run(ffmpeg, args);
};

const buildLogoCard = (ffmpeg, output) => {
  const duration = LOGO_HOLD_SECONDS + FADE_SECONDS * 2;
  const mascot = join(ROOT, 'public', 'emu-mascot.png');
  const fontCandidates = [
    'C:/Windows/Fonts/segoeuib.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  ];
  const fontFile = fontCandidates.find((path) => existsSync(path));
  const fontOption = fontFile
    ? `fontfile='${fontFile.replace(':', '\\:')}'`
    : "font='Sans'";
  const filter = [
    `[1:v]scale=250:250:force_original_aspect_ratio=decrease[logo]`,
    `[0:v][logo]overlay=(W-w)/2:162:shortest=1[card]`,
    `[card]drawtext=text='EmuArcade':${fontOption}:fontcolor=#f7f3ea:` +
      `fontsize=76:x=(w-text_w)/2:y=438,` +
      `fade=t=in:st=0:d=${FADE_SECONDS},` +
      `fade=t=out:st=${LOGO_HOLD_SECONDS + FADE_SECONDS}:d=${FADE_SECONDS},` +
      'format=yuv420p[out]',
  ].join(';');

  run(ffmpeg, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=black:s=${FRAME_SIZE}x${FRAME_SIZE}:r=${FPS}:d=${duration}`,
    '-loop',
    '1',
    '-i',
    mascot,
    '-filter_complex',
    filter,
    '-map',
    '[out]',
    '-an',
    '-frames:v',
    String(Math.round(duration * FPS)),
    ...encodeOptions(output),
  ]);
};

const concatenate = (ffmpeg, clips, output) => {
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];

  for (const clip of clips) {
    args.push('-i', clip);
  }

  const streams = clips.map((_, index) => `[${index}:v]`).join('');
  args.push(
    '-filter_complex',
    `${streams}concat=n=${clips.length}:v=1:a=0[out]`,
    '-map',
    '[out]',
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '24',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    output
  );
  run(ffmpeg, args);
};

const createPoster = (ffmpeg, video, output) => {
  run(ffmpeg, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    '0.6',
    '-i',
    video,
    '-frames:v',
    '1',
    '-c:v',
    'libwebp',
    '-quality',
    '84',
    output,
  ]);
};

const main = () => {
  const options = parseArgs();
  const sources = findClips(options.clipsDir, options.maxClips);

  if (sources.length === 0) {
    throw new Error(
      `No gameplay clips found in ${options.clipsDir}. ` +
        'Add MP4, WebM, MOV, M4V, or MKV captures first.'
    );
  }

  const temp = mkdtempSync(join(tmpdir(), 'emuarcade-montage-'));
  mkdirSync(options.outputDir, { recursive: true });

  try {
    const normalized = sources.map((source, index) => {
      const output = join(temp, `clip-${String(index).padStart(2, '0')}.mp4`);
      normalizeClip(options.ffmpeg, source, output, options.focalY);
      return output;
    });
    const grid = join(temp, 'grid.mp4');
    const logo = join(temp, 'logo.mp4');
    const montage = join(temp, 'splash-montage.mp4');
    const poster = join(temp, 'splash-montage-poster.webp');

    buildGrid(options.ffmpeg, normalized, grid);
    buildLogoCard(options.ffmpeg, logo);
    concatenate(options.ffmpeg, [...normalized, grid, logo], montage);
    createPoster(options.ffmpeg, montage, poster);

    const videoOutput = join(options.outputDir, 'splash-montage.mp4');
    const posterOutput = join(
      options.outputDir,
      'splash-montage-poster.webp'
    );
    copyFileSync(montage, videoOutput);
    copyFileSync(poster, posterOutput);
    console.log(`Generated ${videoOutput}`);
    console.log(`Generated ${posterOutput}`);
  } finally {
    rmSync(temp, { force: true, recursive: true });
  }
};

main();
