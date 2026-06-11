# EmuArcade

EmuArcade is a Devvit Web app that lets Reddit users run their own legally provided games through EmulatorJS inside a custom post.

## Features

- Local game library stored in the browser
- ROM file import
- Optional BIOS support
- EmulatorJS stable runtime
- Local save files, save states, and touch-control layouts
- Manual clips, rolling 10-second clips, GIF sharing, and local video download
- Per-game volume, shader, rewind, thread, and virtual gamepad settings
- Lightweight Reddit feed view and expanded emulator view

## Development

```sh
npm install
npm run check
npm run dev
```

`npm run dev` starts Devvit playtest for the configured test subreddit.
`npm run local` starts a browser-only local Vite server for fast UI and emulator testing without Reddit.
Use `/game.html` for local expanded-view testing and `/splash.html` for the feed launcher.

## Important

EmuArcade does not include ROMs, BIOS files, or copyrighted game content. Users are responsible for providing files they have the right to use. Local file imports stay in the user's browser and are not sent to the Devvit server.

Devvit app updates can change the WebView origin, so browser-only storage may not survive every playtest or release. EmuArcade does not use Redis or server storage for user libraries, ROMs, BIOS files, saves, save states, or control layouts.

## License

GPL-3.0-only. See [LICENSE](LICENSE).
