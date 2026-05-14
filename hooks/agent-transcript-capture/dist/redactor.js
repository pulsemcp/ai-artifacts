"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redactContent = redactContent;
// ---------------------------------------------------------------------------
// Built-in patterns (ordered most-specific-first)
// ---------------------------------------------------------------------------
const BUILTIN_RULES = [
    // --- Block patterns (multiline, most distinctive) ---
    {
        name: "private_key",
        regex: /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g,
        replacement: "[REDACTED:private_key]",
    },
    // --- Token patterns (ordered so longer prefixes match before shorter) ---
    {
        name: "jwt",
        regex: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_.-]{10,}/g,
        replacement: "[REDACTED:jwt]",
    },
    {
        name: "aws_key",
        regex: /(?:AKIA|ASIA)[A-Z0-9]{16}/g,
        replacement: "[REDACTED:aws_key]",
    },
    {
        name: "aws_secret",
        regex: /(aws_secret_access_key\s*=\s*)[A-Za-z0-9/+=]{40}/gi,
        replacement: "$1[REDACTED:aws_secret]",
    },
    {
        name: "github_pat",
        regex: /github_pat_[A-Za-z0-9_]{20,}/g,
        replacement: "[REDACTED:github_pat]",
    },
    {
        name: "github_token",
        regex: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}/g,
        replacement: "[REDACTED:github_token]",
    },
    {
        // Must come before openai_key since sk- prefix overlaps.
        name: "anthropic_key",
        regex: /sk-ant-[A-Za-z0-9_-]{20,}/g,
        replacement: "[REDACTED:anthropic_key]",
    },
    {
        // Must come before openai_key since sk_ prefix overlaps.
        name: "stripe_key",
        regex: /sk_(?:live|test)_[A-Za-z0-9]+/g,
        replacement: "[REDACTED:stripe_key]",
    },
    {
        name: "openai_key",
        regex: /sk-[A-Za-z0-9]{20,}/g,
        replacement: "[REDACTED:openai_key]",
    },
    {
        name: "bearer_token",
        regex: /Bearer\s+[A-Za-z0-9._\-]{20,}/g,
        replacement: "Bearer [REDACTED:bearer_token]",
    },
    // --- Assignment / context-aware patterns ---
    {
        name: "generic_api_key",
        regex: /(?:api[_-]?key|apikey|api[_-]?secret)\s*[:=]\s*['"]?[A-Za-z0-9_\-/.+=]{16,}['"]?/gi,
        replacement: "[REDACTED:generic_api_key]",
    },
    {
        name: "connection_string",
        regex: /(?:mongodb|postgres|postgresql|mysql|redis|amqp|amqps):\/\/[^\s'"]+/gi,
        replacement: "[REDACTED:connection_string]",
    },
    {
        name: "password_assignment",
        regex: /((?:password|passwd|pwd)\s*[:=]\s*['"]?)[^\s'"]{4,}(['"]?)/gi,
        replacement: "$1[REDACTED:password]$2",
    },
    {
        // Negative lookahead for ${ avoids redacting template variable references.
        name: "env_secret",
        regex: /((?:SECRET|KEY|TOKEN|PASS|PASSWORD|CREDENTIAL|PRIVATE_KEY|CREDENTIALS)[A-Z_]*\s*=\s*['"]?)(?!\$\{)[^\s'"]{4,}(['"]?)/g,
        replacement: "$1[REDACTED:env_secret]$2",
    },
    // --- Broad patterns (last to avoid over-matching) ---
    {
        name: "email",
        regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
        replacement: "[REDACTED:email]",
    },
];
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Build the full list of redaction rules from built-ins + user extras.
 * Invalid user-supplied regex patterns are silently skipped.
 */
function buildRules(extraPatterns) {
    const rules = [...BUILTIN_RULES];
    if (extraPatterns) {
        for (const p of extraPatterns) {
            try {
                rules.push({
                    name: p.name,
                    regex: new RegExp(p.pattern, "g"),
                    replacement: p.replacement ?? `[REDACTED:${p.name}]`,
                });
            }
            catch {
                // Invalid regex supplied by user — skip it.
                process.stderr.write(`trace-capture: skipping invalid extra pattern "${p.name}"\n`);
            }
        }
    }
    return rules;
}
/**
 * Apply all redaction rules to the given content string.
 */
function redactContent(content, extraPatterns) {
    const rules = buildRules(extraPatterns);
    let result = content;
    for (const rule of rules) {
        // Reset lastIndex for stateful regexes (global flag).
        rule.regex.lastIndex = 0;
        result = result.replace(rule.regex, rule.replacement);
    }
    return result;
}
