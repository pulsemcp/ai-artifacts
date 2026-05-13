"use strict";
/**
 * Minimal tar.gz archive builder using only Node built-ins.
 *
 * Tar format: for each file, a 512-byte header followed by file content
 * padded to 512-byte boundaries.  Two 512-byte zero blocks terminate
 * the archive.  The whole thing is gzipped.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTarGz = buildTarGz;
const zlib = __importStar(require("zlib"));
// ---------------------------------------------------------------------------
// Tar header construction
// ---------------------------------------------------------------------------
/** Write a fixed-length string into a buffer, null-terminated. */
function writeString(buf, str, offset, len) {
    const bytes = Buffer.from(str, "utf-8");
    bytes.copy(buf, offset, 0, Math.min(bytes.length, len - 1));
}
/** Write an octal number into a buffer, null-terminated. */
function writeOctal(buf, num, offset, len) {
    const str = num.toString(8).padStart(len - 1, "0");
    writeString(buf, str, offset, len);
}
/** Compute the tar header checksum (sum of all bytes, treating the checksum field as spaces). */
function computeChecksum(header) {
    let sum = 0;
    for (let i = 0; i < 512; i++) {
        // The checksum field is at offset 148, length 8.
        // During computation, treat it as all spaces (0x20).
        if (i >= 148 && i < 156) {
            sum += 0x20;
        }
        else {
            sum += header[i];
        }
    }
    return sum;
}
/** Build a 512-byte tar header for a single file entry. */
function buildHeader(filePath, size) {
    const header = Buffer.alloc(512);
    // File name (0, 100)
    writeString(header, filePath, 0, 100);
    // File mode (100, 8) — 0644
    writeOctal(header, 0o644, 100, 8);
    // Owner UID (108, 8)
    writeOctal(header, 0, 108, 8);
    // Group GID (116, 8)
    writeOctal(header, 0, 116, 8);
    // File size (124, 12)
    writeOctal(header, size, 124, 12);
    // Modification time (136, 12) — current time
    writeOctal(header, Math.floor(Date.now() / 1000), 136, 12);
    // Type flag (156, 1) — '0' = regular file
    header[156] = 0x30; // ASCII '0'
    // USTAR magic (257, 6)
    writeString(header, "ustar", 257, 6);
    // USTAR version (263, 2)
    header[263] = 0x30; // '0'
    header[264] = 0x30; // '0'
    // Compute and write checksum (148, 8)
    const checksum = computeChecksum(header);
    const csStr = checksum.toString(8).padStart(6, "0") + "\0 ";
    Buffer.from(csStr, "ascii").copy(header, 148);
    return header;
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Build a tar.gz buffer from the given entries.
 */
function buildTarGz(entries) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        for (const entry of entries) {
            // Header
            chunks.push(buildHeader(entry.path, entry.content.length));
            // Content
            chunks.push(entry.content);
            // Pad to 512-byte boundary
            const remainder = entry.content.length % 512;
            if (remainder > 0) {
                chunks.push(Buffer.alloc(512 - remainder));
            }
        }
        // Two 512-byte zero blocks to terminate the archive
        chunks.push(Buffer.alloc(1024));
        const tarBuffer = Buffer.concat(chunks);
        zlib.gzip(tarBuffer, (err, gzipped) => {
            if (err)
                return reject(err);
            resolve(gzipped);
        });
    });
}
