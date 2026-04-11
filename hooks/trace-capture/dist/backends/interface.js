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
const gcs_sdk_1 = require("./gcs-sdk");
const gcs_cli_1 = require("./gcs-cli");
function createBackend(config) {
    switch (config.type) {
        case "gcs":
            return new gcs_sdk_1.GCSSdkBackend(config);
        case "gcs-cli":
            return new gcs_cli_1.GCSCliBackend(config);
        default:
            throw new Error(`Unknown storage backend: "${config.type}". Supported: gcs, gcs-cli`);
    }
}
