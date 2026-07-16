#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLIPS_DIR = join(ROOT, 'local', 'splash-clips');
const SOURCE_DIR = join(CLIPS_DIR, '.source');
const MANIFEST = join(ROOT, 'tools', 'gameplay-sources.json');
const LOCAL_YT_DLP = join(ROOT, 'local', 'tools', 'yt-dlp.exe');

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

const main = () => {
  const sources = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const ytDlp = existsSync(LOCAL_YT_DLP) ? LOCAL_YT_DLP : 'yt-dlp';

  mkdirSync(SOURCE_DIR, { recursive: true });

  for (const source of sources) {
    const sourceFile = join(SOURCE_DIR, `${source.sourceId}.mp4`);
    const clipFile = join(
      CLIPS_DIR,
      `${String(source.order).padStart(2, '0')}-${source.slug}.mp4`
    );

    if (!existsSync(sourceFile)) {
      run(ytDlp, [
        '--no-playlist',
        '--js-runtimes',
        'node',
        '-f',
        '18/b[height<=360][ext=mp4]/b[height<=360]',
        '-o',
        sourceFile,
        source.url,
      ]);
    }

    const crop = source.crop;
    const filter =
      `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},` +
      'scale=720:720:flags=lanczos,fps=24,setsar=1,format=yuv420p';

    run('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      String(source.startSeconds),
      '-i',
      sourceFile,
      '-t',
      String(source.durationSeconds),
      '-an',
      '-vf',
      filter,
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '19',
      clipFile,
    ]);
  }

  console.log(`Prepared ${sources.length} gameplay clips in ${CLIPS_DIR}`);
};

main();
