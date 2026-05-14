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
//
// Lazy-require each backend so that unused backends never load their
// dependencies.  This lets gcs-cli work without @google-cloud/storage
// installed, and vice versa.
// ---------------------------------------------------------------------------
function createBackend(config) {
    switch (config.type) {
        case "gcs": {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { GCSSdkBackend } = require("./gcs-sdk");
            return new GCSSdkBackend(config);
        }
        case "gcs-cli": {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { GCSCliBackend } = require("./gcs-cli");
            return new GCSCliBackend(config);
        }
        default:
            throw new Error(`Unknown storage backend: "${config.type}". Supported: gcs, gcs-cli`);
    }
}
