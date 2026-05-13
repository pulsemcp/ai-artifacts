"use strict";
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
exports.getUsername = getUsername;
exports.hashUser = hashUser;
exports.scrubUsername = scrubUsername;
const crypto = __importStar(require("crypto"));
const os = __importStar(require("os"));
/** Return the current system username. */
function getUsername() {
    return os.userInfo().username;
}
/**
 * Compute a pseudonymised user identifier.
 * sha256(orgSalt + username) truncated to 12 hex characters.
 */
function hashUser(orgSalt) {
    return crypto
        .createHash("sha256")
        .update(orgSalt + getUsername())
        .digest("hex")
        .slice(0, 12);
}
/**
 * Replace every literal occurrence of the system username in `content` with
 * a pseudonymised placeholder.  Catches paths like /home/username/ and
 * JSON-escaped variants like \\/home\\/username.
 */
function scrubUsername(content, hashedUser) {
    const username = os.userInfo().username;
    if (!username)
        return content;
    const placeholder = `[USER:${hashedUser}]`;
    // Escape for use in a regex (username could contain dots, etc.)
    const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, "g");
    return content.replace(re, placeholder);
}
