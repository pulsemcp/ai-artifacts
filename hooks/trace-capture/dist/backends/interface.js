"use strict";
/**
 * Storage backend interface.
 *
 * Each backend (GCS, S3, Azure Blob, etc.) implements a single `upload`
 * method. The hook pipes a tar.gz buffer through it.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBackend = createBackend;
// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
function createBackend(config) {
    switch (config.type) {
        case "gcs": {
            const { GCSBackend } = require("./gcs");
            return new GCSBackend(config);
        }
        default:
            throw new Error(`Unknown storage backend: "${config.type}". Supported: gcs`);
    }
}
