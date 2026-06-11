class EJS_COMPRESSION {
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
