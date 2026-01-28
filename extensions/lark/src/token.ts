import type { LarkConfig } from "./types.js";

export type LarkCredentialResolution = {
  appId: string;
  appSecret: string;
  source: "config" | "env" | "file" | "none";
};

/**
 * Resolve Lark credentials from config or environment
 */
export function resolveLarkCredentials(
  config: LarkConfig | undefined,
  accountId?: string,
): LarkCredentialResolution {
  // Try config first
  if (config) {
    const accountConfig = accountId && config.accounts?.[accountId];
    const appId = accountConfig?.appId?.trim() || config.appId?.trim();
    const appSecret = accountConfig?.appSecret?.trim() || config.appSecret?.trim();

    if (appId && appSecret) {
      return { appId, appSecret, source: "config" };
    }
  }

  // Try environment variables
  const envAppId = process.env.LARK_APP_ID?.trim();
  const envAppSecret = process.env.LARK_APP_SECRET?.trim();

  if (envAppId && envAppSecret) {
    return { appId: envAppId, appSecret: envAppSecret, source: "env" };
  }

  // Also support FEISHU_ prefix for Chinese users
  const feishuAppId = process.env.FEISHU_APP_ID?.trim();
  const feishuAppSecret = process.env.FEISHU_APP_SECRET?.trim();

  if (feishuAppId && feishuAppSecret) {
    return { appId: feishuAppId, appSecret: feishuAppSecret, source: "env" };
  }

  return { appId: "", appSecret: "", source: "none" };
}
