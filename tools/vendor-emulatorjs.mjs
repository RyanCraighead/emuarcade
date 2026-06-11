import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { path7za } = require('7zip-bin');
const execFileAsync = promisify(execFile);
const emulatorPackage = path.join(
  repoRoot,
  'node_modules',
  '@emulatorjs',
  'emulatorjs'
);
const emulatorData = path.join(emulatorPackage, 'data');
const vendorRoot = path.join(repoRoot, 'public', 'emulatorjs');
const vendorData = path.join(vendorRoot, 'data');
const vendorCores = path.join(vendorData, 'cores');
const vendorExtractedCores = path.join(vendorCores, 'extracted');
const vendorReports = path.join(vendorCores, 'reports');
const defaultSystemCores = {
  atari2600: 'stella2014',
  atari7800: 'prosystem',
  arcade: 'fbneo',
  coleco: 'gearcoleco',
  gb: 'gambatte',
  gba: 'mgba',
  lynx: 'handy',
  n64: 'parallel_n64',
  nds: 'melonds',
  nes: 'fceumm',
  ngp: 'mednafen_ngp',
  pce: 'mednafen_pce',
  psx: 'pcsx_rearmed',
  psp: 'ppsspp',
  segaGG: 'genesis_plus_gx',
  segaMD: 'genesis_plus_gx',
  segaMS: 'smsplus',
  snes: 'snes9x',
  vb: 'beetle_vb',
  ws: 'mednafen_wswan',
};
const optionalCoreNames = ['mupen64plus_next'];
const supportedCoreNames = new Set([
  ...Object.values(defaultSystemCores),
  ...optionalCoreNames,
]);

const getCoreNameFromDataFile = (fileName) => {
  const match = /^(.*?)(?:-thread)?(?:-legacy)?-wasm\.data$/.exec(fileName);

  return match ? match[1] : null;
};

const copyIfExists = async (source, destination) => {
  if (existsSync(source)) {
    await cp(source, destination, { recursive: true });
  }
};

const extractCoreData = async (source, fileName) => {
  const coreKey = fileName.replace(/\.data$/, '');
  const destination = path.join(vendorExtractedCores, coreKey);

  await mkdir(destination, { recursive: true });
  await execFileAsync(path7za, ['x', '-y', `-o${destination}`, source], {
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });

  const files = (await readdir(destination))
    .filter((item) => item !== 'manifest.json')
    .sort();
  const manifest = {
    files,
    js: files.find((item) => item.endsWith('.js') && !item.endsWith('.worker.js')) ?? null,
    wasm: files.find((item) => item.endsWith('.wasm')) ?? null,
    worker: files.find((item) => item.endsWith('.worker.js')) ?? null,
    build: files.includes('build.json') ? 'build.json' : null,
    core: files.includes('core.json') ? 'core.json' : null,
    license: files.includes('license.txt') ? 'license.txt' : null,
  };

  await writeFile(
    path.join(destination, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
};

const patchNoExternalFallbacks = async () => {
  const emulatorSource = path.join(vendorData, 'src', 'emulator.js');
  const loaderSource = path.join(vendorData, 'loader.js');
  let content = await readFile(emulatorSource, 'utf8');

  content = content.replace(
    /    getCores\(\) \{[\s\S]*?    \}\r?\n    requiresThreads\(core\) \{/,
    `    getCores() {
        return {
            "atari2600": ["stella2014"],
            "atari7800": ["prosystem"],
            "arcade": ["fbneo"],
            "coleco": ["gearcoleco"],
            "gb": ["gambatte"],
            "gba": ["mgba"],
            "lynx": ["handy"],
            "n64": ["parallel_n64", "mupen64plus_next"],
            "nds": ["melonds"],
            "nes": ["fceumm"],
            "ngp": ["mednafen_ngp"],
            "pce": ["mednafen_pce"],
            "psx": ["pcsx_rearmed"],
            "psp": ["ppsspp"],
            "segaGG": ["genesis_plus_gx"],
            "segaMD": ["genesis_plus_gx"],
            "segaMS": ["smsplus"],
            "snes": ["snes9x"],
            "vb": ["beetle_vb"],
            "ws": ["mednafen_wswan"]
        };
    }
    requiresThreads(core) {`
  );

  content = content.replace(
    /        const requiresThreads = \[[^\]]+\];/,
    '        const requiresThreads = ["ppsspp"];'
  );

  content = content.replace(
    '        this.netplayEnabled = (window.EJS_DEBUG_XX === true) && (window.EJS_EXPERIMENTAL_NETPLAY === true);',
    '        this.netplayEnabled = false;'
  );

  content = content.replace(
    /    checkForUpdates\(\) \{[\s\S]*?    \}\r?\n    versionAsInt\(ver\) \{/,
    `    checkForUpdates() {
        return;
    }
    versionAsInt(ver) {`
  );

  content = content.replace(
    /            if \(res === -1\) \{[\s\S]*?                console\.warn\("File was not found locally, but was found on the emulatorjs cdn\.\\nIt is recommended to download the stable release from here: https:\/\/cdn\.emulatorjs\.org\/releases\/"\);\r?\n            \}/,
    `            if (res === -1) {
                this.startGameError(this.localization("Error downloading core") + " (" + filename + ")");
                return;
            }`
  );

  content = content.replace(
    `            this.checkCompression(new Uint8Array(data), this.localization("Decompress Game Core")).then((data) => {
                let js, thread, wasm;`,
    `            Promise.resolve(data).then((data) => {
                let js, thread, wasm;`
  );

  content = content.replace(
    /            if \(!this\.debug\) \{[\s\S]*?                    return;\r?\n                \}\r?\n            \}\r?\n            const corePath = "cores\/" \+ filename;\r?\n            let res = await this\.downloadFile\(corePath, \(progress\) => \{[\s\S]*?            gotCore\(res\.data\);\r?\n            this\.storage\.core\.put\(filename, \{[\s\S]*?            \}\);/,
    `            const corePath = "cores/extracted/" + filename.replace(/\\.data$/, "");
            const manifestRes = await this.downloadFile(corePath + "/manifest.json", null, false, { responseType: "text", method: "GET" });
            if (manifestRes === -1) {
                this.startGameError(this.localization("Error downloading core") + " (" + filename + ")");
                return;
            }
            const manifest = typeof manifestRes.data === "string" ? JSON.parse(manifestRes.data) : manifestRes.data;
            const files = {};
            for (const file of manifest.files) {
                if (file.endsWith(".js") || file.endsWith(".wasm")) {
                    files[file] = this.config.dataPath + corePath + "/" + file;
                    continue;
                }
                const fileRes = await this.downloadFile(corePath + "/" + file, (progress) => {
                    this.textElem.innerText = this.localization("Download Game Core") + progress;
                }, false, { responseType: "arraybuffer", method: "GET" });
                if (fileRes === -1) {
                    this.startGameError(this.localization("Error downloading core") + " (" + filename + ")");
                    return;
                }
                files[file] = new Uint8Array(fileRes.data);
            }
            gotCore(files);`
  );

  content = content.replace(
    `    initGameCore(js, wasm, thread) {
        let script = this.createElement("script");
        script.src = URL.createObjectURL(new Blob([js], { type: "application/javascript" }));
        script.addEventListener("load", () => {
            this.initModule(wasm, thread);
        });
        document.body.appendChild(script);
    }`,
    `    initGameCore(js, wasm, thread) {
        let script = this.createElement("script");
        script.src = js;
        script.addEventListener("load", () => {
            this.initModule(wasm, thread);
        });
        script.addEventListener("error", () => {
            this.startGameError(this.localization("Error loading EmulatorJS runtime"));
        });
        document.body.appendChild(script);
    }`
  );

  content = content.replace(
    `                if (fileName.endsWith(".wasm")) {
                    return URL.createObjectURL(new Blob([wasmData], { type: "application/wasm" }));
                } else if (fileName.endsWith(".worker.js")) {
                    return URL.createObjectURL(new Blob([threadData], { type: "application/javascript" }));
                }`,
    `                if (fileName.endsWith(".wasm")) {
                    return wasmData;
                } else if (fileName.endsWith(".worker.js")) {
                    return threadData;
                }`
  );

  content = content.replace(
    /this\.config\.netplayUrl = this\.config\.netplayUrl \|\| "https:\/\/netplay\.emulatorjs\.org";/,
    'this.config.netplayUrl = this.config.netplayUrl || "";'
  );

  content = content.replace(
    /        this\.netplay\.getOpenRooms = async \(\) => \{[\s\S]*?        \}\r?\n        this\.netplay\.updateTableList = async \(\) => \{/,
    `        this.netplay.getOpenRooms = async () => {
            return [];
        }
        this.netplay.updateTableList = async () => {`
  );

  content = content.replace(
    /        this\.netplay\.startSocketIO = \(callback\) => \{[\s\S]*?        \}\r?\n        this\.netplay\.openRoom = \(roomName, maxPlayers, password\) => \{/,
    `        this.netplay.startSocketIO = () => {
            throw new Error("Netplay is disabled in this local Devvit build.");
        }
        this.netplay.openRoom = (roomName, maxPlayers, password) => {`
  );

  content = content
    .replace(
      /                if \(\[[^\]]+\]\.includes\(this\.getCore\(\)\) && this\.config\.disableCue === undefined\) \{/,
      '                if (["pcsx_rearmed", "genesis_plus_gx", "mednafen_pce", "smsplus"].includes(this.getCore()) && this.config.disableCue === undefined) {'
    )
    .replace(
      /            if \(this\.getCore\(\) === "[^"]+"\) \{\r?\n                buttons\.push\(\{ id: 10, label: this\.localization\("SWAP DISKS"\) \}\);\r?\n            \} else \{\r?\n                buttons\.push\(\{ id: 10, label: this\.localization\("SWAP DISKS"\) \}\);\r?\n                buttons\.push\(\{ id: 11, label: this\.localization\("EJECT\/INSERT DISK"\) \}\);\r?\n            \}/,
      `            buttons.push({ id: 10, label: this.localization("SWAP DISKS") });
            buttons.push({ id: 11, label: this.localization("EJECT/INSERT DISK") });`
    )
    .replace(
      '            console.warn("Threads is set to true, but the SharedArrayBuffer function is not exposed. Threads requires 2 headers to be set when sending you html page. See https://stackoverflow.com/a/68630724");',
      '            console.warn("Threads is set to true, but the SharedArrayBuffer function is not exposed. Threads requires cross-origin isolation headers.");'
    )
    .replace(
      '        this.gamepad = new GamepadHandler(); //https://github.com/ethanaobrien/Gamepad',
      '        this.gamepad = new GamepadHandler();'
    )
    .replace(
      '<!--!Font Awesome Free 6.5.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2023 Fonticons, Inc.-->',
      ''
    )
    .replace(
      '            this.createLink(home, "https://github.com/EmulatorJS/EmulatorJS", "View on GitHub", true);\n',
      ''
    )
    .replace(
      '            this.createLink(home, "https://discord.gg/6akryGkETU", "Join the discord", true);\n',
      ''
    )
    .replace(
      '            this.createLink(info, "https://emulatorjs.org", "EmulatorJS");',
      '            info.append("EmulatorJS");'
    )
    .replace(
      '            this.createLink(info, "https://github.com/libretro/RetroArch/", "RetroArch");',
      '            info.append("RetroArch");'
    )
    .replace(
      '                this.createLink(info, this.repository, this.coreName);',
      '                info.append(this.coreName);'
    )
    .replace(
      /            retroarch\.innerText = this\.localization\("This project is powered by"\) \+ " ";[\s\S]*?            a\.appendChild\(licenseLink\);/,
      '            retroarch.innerText = this.localization("This project is powered by") + " RetroArch.";'
    );

  await writeFile(emulatorSource, content, 'utf8');

  let loaderContent = await readFile(loaderSource, 'utf8');
  loaderContent = loaderContent
    .replace(/        "socket\.io\.min\.js",\r?\n/, '')
    .replace(
      /            script\.src = function\(\) \{[\s\S]*?            \}\(\);/,
      '            script.src = scriptPath + "src/" + file;'
    )
    .replace(
      /            css\.href = function\(\) \{[\s\S]*?            \}\(\);/,
      '            css.href = scriptPath + file;'
    )
    .replace(
      /    if \(\("undefined" != typeof EJS_DEBUG_XX && true === EJS_DEBUG_XX\)\) \{[\s\S]*?    \} else \{[\s\S]*?    \}/,
      `    for (let i = 0; i < scripts.length; i++) {
        await loadScript(scripts[i]);
    }
    await loadStyle("emulator.css");`
    );
  loaderContent = loaderContent.replace(
    /console\[minifiedFailed \? "warn" : "error"\]\("Failed to load " \+ file \+ " beacuse it's likly that the minified files are missing\.[\s\S]*?Note: you will probably need to do the same for the cores, extract them to the data\/cores\/ folder\."\);/,
    'console[minifiedFailed ? "warn" : "error"]("Failed to load " + file + ". The local EmulatorJS runtime bundle is incomplete. Run npm run vendor:emulatorjs and rebuild the Devvit app.");'
  );
  loaderContent = loaderContent
    .replace('    config.adUrl = window.EJS_AdUrl;', '    config.adUrl = null;')
    .replace('    config.filePaths = window.EJS_paths;', '    config.filePaths = {};')
    .replace(
      '    config.gamePatchUrl = window.EJS_gamePatchUrl;',
      '    config.gamePatchUrl = null;'
    )
    .replace(
      '    config.gameParentUrl = window.EJS_gameParentUrl;',
      '    config.gameParentUrl = null;'
    )
    .replace(
      '    config.externalFiles = window.EJS_externalFiles;',
      '    config.externalFiles = {};'
    )
    .replace('    config.netplayUrl = window.EJS_netplayServer;', '    config.netplayUrl = "";')
    .replace('    config.loadState = window.EJS_loadStateURL;', '    config.loadState = null;')
    .replace('    config.backgroundImg = window.EJS_backgroundImage;', '    config.backgroundImg = null;')
    .replace(
      /            let path;\r?\n            console\.log\("Loading language", language\);\r?\n            if \("undefined" != typeof EJS_paths && typeof EJS_paths\[language\] === "string"\) \{[\s\S]*?            \} else \{[\s\S]*?            \}/,
      `            const path = scriptPath + "localization/" + language + ".json";
            console.log("Loading language", language);`
    )
    .replace(
      '    if ((typeof window.EJS_language === "string" && window.EJS_language !== "en-US") || (systemLang && window.EJS_disableAutoLang !== false)) {',
      '    if (typeof window.EJS_language === "string" && window.EJS_language !== "en-US") {'
    );
  await writeFile(loaderSource, loaderContent, 'utf8');

  const compressionSource = path.join(vendorData, 'src', 'compression.js');
  const compressionContent = `class EJS_COMPRESSION {
    constructor(EJS) {
        this.EJS = EJS;
    }
    readUint16(data, offset) {
        return data[offset] | (data[offset + 1] << 8);
    }
    readUint32(data, offset) {
        return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
    }
    isCompressed(data) {
        if ((data[0] === 80 && data[1] === 75) && ((data[2] === 3 && data[3] === 4) || (data[2] === 5 && data[3] === 6) || (data[2] === 7 && data[3] === 8))) {
            return "zip";
        } else if (data[0] === 55 && data[1] === 122 && data[2] === 188 && data[3] === 175 && data[4] === 39 && data[5] === 28) {
            return "7z";
        } else if ((data[0] === 82 && data[1] === 97 && data[2] === 114 && data[3] === 33 && data[4] === 26 && data[5] === 7) && ((data[6] === 0) || (data[6] === 1 && data[7] == 0))) {
            return "rar";
        }
        return null;
    }
    async decompress(data, updateMsg, fileCbFunc) {
        const compressed = this.isCompressed(data.slice(0, 10));
        if (compressed === null) {
            return this.emitFile("!!notCompressedData", data, fileCbFunc);
        }
        if (compressed !== "zip") {
            this.EJS.startGameError("7z and RAR archives are not supported in this Devvit build. Use a ZIP or an uncompressed ROM.");
            return {};
        }
        try {
            return await this.decompressZip(data, updateMsg, fileCbFunc);
        } catch(e) {
            console.error(e);
            this.EJS.startGameError(e instanceof Error ? e.message : "Unable to extract ZIP archive");
            return {};
        }
    }
    emitFile(fileName, fileData, fileCbFunc, files) {
        if (typeof fileCbFunc === "function") {
            fileCbFunc(fileName, fileData);
            if (files) {
                files[fileName] = true;
            }
        } else if (files) {
            files[fileName] = fileData;
        } else {
            return { [fileName]: fileData };
        }
        return files;
    }
    findEndOfCentralDirectory(data) {
        const start = Math.max(0, data.length - 65557);
        for (let offset = data.length - 22; offset >= start; offset--) {
            if (this.readUint32(data, offset) === 0x06054b50) {
                return offset;
            }
        }
        return -1;
    }
    async inflateRaw(data) {
        if (typeof DecompressionStream !== "function") {
            throw new Error("ZIP extraction is not supported by this browser.");
        }
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    async decompressZip(data, updateMsg, fileCbFunc) {
        const endOffset = this.findEndOfCentralDirectory(data);
        if (endOffset === -1) {
            throw new Error("Invalid ZIP archive.");
        }

        const fileCount = this.readUint16(data, endOffset + 10);
        let directoryOffset = this.readUint32(data, endOffset + 16);
        const files = {};

        for (let index = 0; index < fileCount; index++) {
            if (this.readUint32(data, directoryOffset) !== 0x02014b50) {
                throw new Error("Invalid ZIP central directory.");
            }

            const flags = this.readUint16(data, directoryOffset + 8);
            const method = this.readUint16(data, directoryOffset + 10);
            const compressedSize = this.readUint32(data, directoryOffset + 20);
            const fileSize = this.readUint32(data, directoryOffset + 24);
            const nameLength = this.readUint16(data, directoryOffset + 28);
            const extraLength = this.readUint16(data, directoryOffset + 30);
            const commentLength = this.readUint16(data, directoryOffset + 32);
            const localOffset = this.readUint32(data, directoryOffset + 42);
            const fileName = new TextDecoder().decode(data.slice(directoryOffset + 46, directoryOffset + 46 + nameLength));

            directoryOffset += 46 + nameLength + extraLength + commentLength;

            if ((flags & 1) === 1) {
                throw new Error("Encrypted ZIP archives are not supported.");
            }

            if (fileName.endsWith("/")) {
                this.emitFile(fileName, new Uint8Array(), fileCbFunc, files);
                continue;
            }

            if (this.readUint32(data, localOffset) !== 0x04034b50) {
                throw new Error("Invalid ZIP local file header.");
            }

            const localNameLength = this.readUint16(data, localOffset + 26);
            const localExtraLength = this.readUint16(data, localOffset + 28);
            const fileStart = localOffset + 30 + localNameLength + localExtraLength;
            const compressedData = data.slice(fileStart, fileStart + compressedSize);
            let fileData;

            if (method === 0) {
                fileData = compressedData;
            } else if (method === 8) {
                fileData = await this.inflateRaw(compressedData);
            } else {
                throw new Error("Unsupported ZIP compression method: " + method);
            }

            if (fileSize !== 0 && fileData.length !== fileSize) {
                console.warn("ZIP entry size mismatch for " + fileName);
            }

            this.emitFile(fileName, fileData, fileCbFunc, files);

            if (typeof updateMsg === "function") {
                updateMsg(" " + Math.floor(((index + 1) / fileCount) * 100).toString() + "%", true);
            }
        }

        return files;
    }
}

window.EJS_COMPRESSION = EJS_COMPRESSION;
`;
  await writeFile(compressionSource, compressionContent, 'utf8');

  const shadersSource = path.join(vendorData, 'src', 'shaders.js');
  let shadersContent = await readFile(shadersSource, 'utf8');
  shadersContent = shadersContent.replace(
    /    \/\/https:\/\/github\.com\/libretro\/glsl-shaders\/blob\/master\/([^\r\n]+)/g,
    '    // Bundled libretro shader: $1'
  );
  await writeFile(shadersSource, shadersContent, 'utf8');
};

if (!existsSync(emulatorData)) {
  throw new Error(
    'Missing @emulatorjs/emulatorjs. Run npm install before vendoring.'
  );
}

await rm(vendorRoot, { force: true, recursive: true });
await mkdir(vendorReports, { recursive: true });
await mkdir(vendorExtractedCores, { recursive: true });

await copyIfExists(path.join(emulatorData, 'compression'), path.join(vendorData, 'compression'));
await rm(path.join(vendorData, 'compression', 'README.md'), { force: true });
await copyIfExists(path.join(emulatorData, 'localization'), path.join(vendorData, 'localization'));
await rm(path.join(vendorData, 'localization', 'README.md'), { force: true });
await copyIfExists(path.join(emulatorData, 'src'), path.join(vendorData, 'src'));
await rm(path.join(vendorData, 'src', 'socket.io.min.js'), { force: true });
await copyIfExists(path.join(emulatorData, 'loader.js'), path.join(vendorData, 'loader.js'));
await copyIfExists(path.join(emulatorData, 'emulator.css'), path.join(vendorData, 'emulator.css'));
await copyIfExists(path.join(emulatorData, 'version.json'), path.join(vendorData, 'version.json'));
await copyIfExists(path.join(emulatorPackage, 'LICENSE'), path.join(vendorRoot, 'LICENSE'));
await patchNoExternalFallbacks();

const emulatorScope = path.join(repoRoot, 'node_modules', '@emulatorjs');
const packageNames = await readdir(emulatorScope);
let copiedFiles = 0;
let extractedCoreArchives = 0;

for (const packageName of packageNames) {
  if (!packageName.startsWith('core-')) {
    continue;
  }

  const packagePath = path.join(emulatorScope, packageName);
  const files = await readdir(packagePath, { recursive: true });

  for (const file of files) {
    const source = path.join(packagePath, file);
    const fileName = path.basename(file);
    const coreName = getCoreNameFromDataFile(fileName);

    if (file.endsWith('.data') && coreName && supportedCoreNames.has(coreName)) {
      await extractCoreData(source, fileName);
      extractedCoreArchives += 1;
    }

    if (fileName === 'ppsspp-assets.zip' && supportedCoreNames.has('ppsspp')) {
      await cp(source, path.join(vendorCores, fileName));
      copiedFiles += 1;
    }

    if (
      file.startsWith(`reports${path.sep}`) &&
      file.endsWith('.json') &&
      supportedCoreNames.has(path.basename(file, '.json'))
    ) {
      await cp(source, path.join(vendorReports, fileName));
      copiedFiles += 1;
    }
  }
}

console.log(`Vendored EmulatorJS data to ${vendorData}`);
console.log(`Extracted ${extractedCoreArchives} core archives.`);
console.log(`Copied ${copiedFiles} auxiliary core artifacts and reports.`);
