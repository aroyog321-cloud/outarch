"use strict";

const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_ARRAY_ITEMS = 100;
const DEFAULT_MAX_OBJECT_KEYS = 100;
const DEFAULT_MAX_STRING_LENGTH = 2000;

const SENSITIVE_KEY = /(?:^|[_-])(?:authorization|cookie|credential|database[_-]?url|private[_-]?key|password|passwd|secret|token)(?:$|[_-])/i;
const API_KEY = /(?:^|[_-])api[_-]?key(?:$|[_-])/i;

const TEXT_PATTERNS = Object.freeze([
  {
    label: "private-key",
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gi,
    replacement: "[REDACTED:private-key]"
  },
  {
    label: "authorization",
    pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    replacement: (_match, scheme) => `${scheme} [REDACTED]`
  },
  {
    label: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replacement: "[REDACTED:jwt]"
  },
  {
    label: "provider-token",
    pattern: /\b(?:AIza[A-Za-z0-9_-]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/g,
    replacement: "[REDACTED:token]"
  },
  {
    label: "url-credential",
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
    replacement: (_match, scheme) => `${scheme}[REDACTED]@`
  },
  {
    label: "assignment",
    pattern: /\b((?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|database[_-]?url|password|passwd|secret|token)\s*(?:=|:)\s*)([^\s,;]+)/gi,
    replacement: (_match, label) => `${label}[REDACTED]`
  }
]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sensitiveKey(key) {
  const normalized = String(key || "").replace(/([a-z0-9])([A-Z])/g, "$1_$2");
  return SENSITIVE_KEY.test(normalized) || API_KEY.test(normalized);
}

function redactText(value, options = {}) {
  const maximum = Number.isInteger(options.maxLength) && options.maxLength > 0
    ? options.maxLength
    : DEFAULT_MAX_STRING_LENGTH;
  let text = String(value ?? "").replace(/[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  let redactions = 0;
  for (const rule of TEXT_PATTERNS) {
    text = text.replace(rule.pattern, (...args) => {
      redactions++;
      return typeof rule.replacement === "function" ? rule.replacement(...args) : rule.replacement;
    });
  }
  const truncated = text.length > maximum;
  if (truncated) text = `${text.slice(0, Math.max(0, maximum - 12))} [truncated]`;
  return { value: text, redactions, truncations: truncated ? 1 : 0 };
}

function sanitizeContextValue(value, options = {}) {
  const limits = {
    maxDepth: Number.isInteger(options.maxDepth) ? Math.max(1, options.maxDepth) : DEFAULT_MAX_DEPTH,
    maxArrayItems: Number.isInteger(options.maxArrayItems) ? Math.max(1, options.maxArrayItems) : DEFAULT_MAX_ARRAY_ITEMS,
    maxObjectKeys: Number.isInteger(options.maxObjectKeys) ? Math.max(1, options.maxObjectKeys) : DEFAULT_MAX_OBJECT_KEYS,
    maxStringLength: Number.isInteger(options.maxStringLength) ? Math.max(32, options.maxStringLength) : DEFAULT_MAX_STRING_LENGTH
  };
  const seen = new WeakSet();
  const stats = { redactions: 0, truncations: 0 };

  function visit(input, depth, key = "") {
    if (sensitiveKey(key)) {
      stats.redactions++;
      return "[REDACTED]";
    }
    if (input === null || typeof input === "boolean") return input;
    if (typeof input === "number") return Number.isFinite(input) ? input : null;
    if (typeof input === "string" || typeof input === "bigint") {
      const sanitized = redactText(input, { maxLength: limits.maxStringLength });
      stats.redactions += sanitized.redactions;
      stats.truncations += sanitized.truncations;
      return sanitized.value;
    }
    if (typeof input === "undefined" || typeof input === "function" || typeof input === "symbol") return null;
    if (depth >= limits.maxDepth) {
      stats.truncations++;
      return "[truncated]";
    }
    if (seen.has(input)) {
      stats.truncations++;
      return "[circular]";
    }
    seen.add(input);
    if (Array.isArray(input)) {
      if (input.length > limits.maxArrayItems) stats.truncations++;
      const output = input.slice(0, limits.maxArrayItems).map(item => visit(item, depth + 1));
      seen.delete(input);
      return output;
    }
    if (!isPlainObject(input)) {
      const sanitized = redactText(String(input), { maxLength: limits.maxStringLength });
      stats.redactions += sanitized.redactions;
      stats.truncations += sanitized.truncations;
      seen.delete(input);
      return sanitized.value;
    }
    const entries = Object.entries(input);
    if (entries.length > limits.maxObjectKeys) stats.truncations++;
    const output = {};
    for (const [property, nested] of entries.slice(0, limits.maxObjectKeys)) {
      output[property] = visit(nested, depth + 1, property);
    }
    seen.delete(input);
    return output;
  }

  return { value: visit(value, 0), ...stats };
}

/**
 * Which secret shapes a string contains, by label, without redacting it.
 *
 * `redactText` already removes them and counts how many; an export has to be
 * able to TELL the operator what it found before they hand the file to someone,
 * which is a different question. Same rule table, so the scan can never claim a
 * file is clean of something the redactor would have caught (T113).
 */
function scanText(value) {
  const text = String(value ?? "");
  const found = [];
  for (const rule of TEXT_PATTERNS) {
    // Every rule is a global regex, so reset lastIndex before reusing it.
    rule.pattern.lastIndex = 0;
    const matches = text.match(rule.pattern);
    if (matches && matches.length) found.push({ label: rule.label, count: matches.length });
  }
  return found;
}

module.exports = {
  DEFAULT_MAX_ARRAY_ITEMS,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_OBJECT_KEYS,
  DEFAULT_MAX_STRING_LENGTH,
  redactText,
  sanitizeContextValue,
  scanText,
  sensitiveKey
};
