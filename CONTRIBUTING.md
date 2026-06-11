# Contributing

Thanks for taking the time to improve EmuArcade.

## Development Setup

```sh
npm install
npm run check
```

Use `npm run dev` for Devvit playtesting once type checking, linting, and the production build pass.

## Standards

- Keep the app local-first for ROM and BIOS data. Do not add server endpoints that upload, proxy, cache, or redistribute game files.
- Use Devvit Web APIs only. Do not add Blocks or `@devvit/public-api` app code.
- Prefer typed tRPC procedures for server/client communication.
- Keep the feed splash lightweight; put heavier emulator work in the expanded view or runner iframe.
- Preserve GPL-3.0-only licensing.

## Pull Requests

Before opening a pull request:

1. Run `npm run check`.
2. Describe user-facing behavior changes.
3. Call out any EmulatorJS integration changes.
4. Include screenshots or short recordings for UI changes when possible.

## ROM and BIOS Policy

Do not commit ROMs, BIOS files, copyrighted game assets, or links to unauthorized downloads. Test with homebrew, public-domain, or otherwise legally usable files.
