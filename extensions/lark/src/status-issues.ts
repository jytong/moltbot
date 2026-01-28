import type { MoltbotConfig } from "clawdbot/plugin-sdk";

import { resolveLarkAccount } from "./accounts.js";

export type LarkStatusIssue = {
  level: "error" | "warning" | "info";
  message: string;
  path?: string;
};

/**
 * Collect status issues for Lark configuration
 */
export function collectLarkStatusIssues(params: {
  cfg: MoltbotConfig;
  accountId?: string;
}): LarkStatusIssue[] {
  const { cfg, accountId } = params;
  const issues: LarkStatusIssue[] = [];
  const account = resolveLarkAccount({ cfg, accountId });

  // Check credentials
  if (!account.appId || !account.appSecret) {
    issues.push({
      level: "error",
      message: "Lark credentials not configured (appId and appSecret required)",
      path: "channels.lark.appId",
    });
  }

  // Check DM policy
  const dmPolicy = account.config.dmPolicy;
  if (dmPolicy === "allowlist") {
    const allowFrom = account.config.allowFrom ?? [];
    if (allowFrom.length === 0) {
      issues.push({
        level: "warning",
        message: "DM policy is 'allowlist' but no users are configured",
        path: "channels.lark.allowFrom",
      });
    }
  }

  // Check if disabled
  if (!account.enabled) {
    issues.push({
      level: "info",
      message: "Lark channel is disabled",
      path: "channels.lark.enabled",
    });
  }

  return issues;
}
