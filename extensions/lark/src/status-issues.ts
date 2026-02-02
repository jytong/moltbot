import type { ChannelAccountSnapshot, ChannelStatusIssue } from "clawdbot/plugin-sdk";

// Type guard helpers
function asString(val: unknown): string | undefined {
  return typeof val === "string" ? val : undefined;
}

function asBool(val: unknown): boolean | undefined {
  return typeof val === "boolean" ? val : undefined;
}

// Lark account status shape from snapshot
interface LarkAccountStatus {
  accountId?: unknown;
  enabled?: unknown;
  configured?: unknown;
  tokenSource?: unknown;
  dmPolicy?: unknown;
  lastError?: unknown;
  running?: unknown;
}

function readLarkAccountStatus(entry: ChannelAccountSnapshot): LarkAccountStatus | null {
  if (!entry || typeof entry !== "object") return null;
  return entry as LarkAccountStatus;
}

// Error pattern detection
const PERMISSION_ERROR_PATTERNS = [
  /permission denied/i,
  /99991403/,
  /no permission/i,
  /unauthorized/i,
];

const CONNECTION_ERROR_PATTERNS = [
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
  /ECONNREFUSED/i,
  /socket hang up/i,
  /network/i,
  /WebSocket.*failed/i,
  /connection.*failed/i,
];

function isPermissionError(error: string | null | undefined): boolean {
  if (!error) return false;
  return PERMISSION_ERROR_PATTERNS.some((pattern) => pattern.test(error));
}

function isConnectionError(error: string | null | undefined): boolean {
  if (!error) return false;
  return CONNECTION_ERROR_PATTERNS.some((pattern) => pattern.test(error));
}

/**
 * Collect status issues for Lark channel accounts
 */
export function collectLarkStatusIssues(
  accounts: ChannelAccountSnapshot[],
): ChannelStatusIssue[] {
  const issues: ChannelStatusIssue[] = [];

  for (const entry of accounts) {
    const account = readLarkAccountStatus(entry);
    if (!account) continue;

    const accountId = asString(account.accountId) ?? "default";
    const enabled = asBool(account.enabled) !== false;

    // Skip disabled accounts
    if (!enabled) continue;

    const configured = asBool(account.configured) === true;
    const tokenSource = asString(account.tokenSource);
    const dmPolicy = asString(account.dmPolicy);
    const lastError = asString(account.lastError);

    // 1. Check credentials configuration
    if (!configured) {
      issues.push({
        channel: "lark",
        accountId,
        kind: "config",
        message: "Lark credentials not configured.",
        fix: "Set channels.lark.appId and appSecret, or use environment variables LARK_APP_ID/LARK_APP_SECRET.",
      });
      continue; // Skip other checks if not configured
    }

    // 2. Note if credentials are from environment (informational)
    if (tokenSource === "env") {
      issues.push({
        channel: "lark",
        accountId,
        kind: "config",
        message: "Lark credentials loaded from environment variables.",
      });
    }

    // 3. Check DM policy
    if (dmPolicy === "open") {
      issues.push({
        channel: "lark",
        accountId,
        kind: "config",
        message:
          'Lark dmPolicy is "open", allowing any user to message the bot without pairing.',
        fix: 'Set channels.lark.dmPolicy to "pairing" or "allowlist" to restrict access.',
      });
    }

    // 4. Check for runtime errors
    if (lastError) {
      if (isPermissionError(lastError)) {
        issues.push({
          channel: "lark",
          accountId,
          kind: "auth",
          message: "Lark bot lacks required permissions.",
          fix: "Enable im:message and im:message.receive_v1 permissions in Lark Developer Console.",
        });
      } else if (isConnectionError(lastError)) {
        issues.push({
          channel: "lark",
          accountId,
          kind: "runtime",
          message: `Lark connection error: ${lastError}`,
          fix: "Check network connectivity and ensure Lark domains are not blocked by proxy.",
        });
      } else {
        // Generic runtime error
        issues.push({
          channel: "lark",
          accountId,
          kind: "runtime",
          message: `Lark error: ${lastError}`,
        });
      }
    }
  }

  return issues;
}
