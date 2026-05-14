"use strict";
/**
 * Storage backend interface.
 *
 * No-authentication mode uses pure `fetch` against a bucket configured to allow
 * unauthenticated PUT/DELETE scoped to a namespace_key prefix. No SDK,
 * no CLI, no auth header.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBackend = createBackend;
// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
const gcs_no_auth_1 = require("./gcs-no-auth");
const s3_no_auth_1 = require("./s3-no-auth");
function createBackend(config) {
    switch (config.provider) {
        case "gcs":
            return new gcs_no_auth_1.GcsNoAuthBackend(config);
        case "s3":
            return new s3_no_auth_1.S3NoAuthBackend(config);
        default:
            throw new Error(`Unknown storage provider: "${config.provider}". Supported: gcs, s3`);
    }
}
