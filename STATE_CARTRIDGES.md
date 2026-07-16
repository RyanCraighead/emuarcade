# State Cartridges

EmuArcade can share an exact emulator checkpoint without uploading a ROM, BIOS, or save to Redis.

## Storage

Small compressed states are stored directly in the custom post's `postData`. Larger states are split into 2,000,000-byte chunks and encoded into the RGB pixels of valid PNG images. The PNGs and a small manifest PNG are uploaded through Reddit's media API. Only the manifest URL and compatibility metadata remain in `postData`.

The app never uses PNG metadata fields for state bytes. Reddit may rewrite PNG compression or filters, so the decoder reconstructs the RGB pixels instead of expecting identical PNG file bytes.

## Integrity

Each upload is fetched from the returned Reddit CDN URL and decoded before it is accepted. The server compares the recovered bytes with the original upload. Each manifest records every chunk's order, length, and SHA-256 digest plus a SHA-256 digest for the complete compressed payload. Loading repeats those checks before inflation and verifies the final state length and checksum.

The post also records the ROM fingerprint, EmulatorJS version, and exact core implementation. Nintendo 64 checkpoints distinguish ParaLLEl N64 from Mupen64Plus Next.

## Limits

- Safe custom-post metadata budget: 1,800 bytes
- State Cartridge chunk payload: 2,000,000 bytes
- Maximum chunks per checkpoint: 32
- Maximum compressed checkpoint: 64,000,000 bytes
- Maximum declared raw checkpoint: 128 MiB
- Maximum PNG response accepted by the backend: 4 MiB

These limits keep each client request below Devvit's request-size ceiling and bound decoder memory. A state that exceeds the cartridge limit is rejected without truncation.

## Privacy

Creating a checkpoint post intentionally makes its compressed state and selected preview available through Reddit-hosted media. Local ROMs and BIOS files never leave the device. A recipient must provide a locally stored ROM with the matching fingerprint before the checkpoint can run.

The HTTP permission is limited to `i.redd.it` and `preview.redd.it`. Those hosts are used only to read back Reddit-hosted State Cartridge PNGs; no external storage provider is involved.
