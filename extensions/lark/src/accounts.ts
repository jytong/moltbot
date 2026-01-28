import type { MoltbotConfig } from "clawdbot/plugin-sdk";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "clawdbot/plugin-sdk";

import type { LarkAccountConfig, LarkConfig } from "./types.js";
import { resolveLarkCredentials } from "./token.js";

export type ResolvedLarkAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  appId: string;
  appSecret: string;
  encryptKey?: string;
  verificationToken?: string;
  credentialSource: "config" | "env" | "file" | "none";
  config: LarkAccountConfig;
};

function listConfiguredAccountIds(cfg: MoltbotConfig): string[] {
  const accounts = (cfg.channels?.lark as LarkConfig | undefined)?.accounts;
  if (!accounts || typeof accounts !== "object") return [];
  return Object.keys(accounts).filter(Boolean);
}

export function listLarkAccountIds(cfg: MoltbotConfig): string[] {
  const ids = listConfiguredAccountIds(cfg);
  if (ids.length === 0) return [DEFAULT_ACCOUNT_ID];
  return ids.sort((a, b) => a.localeCompare(b));
}

export function resolveDefaultLarkAccountId(cfg: MoltbotConfig): string {
  const larkConfig = cfg.channels?.lark as LarkConfig | undefined;
  if (larkConfig?.defaultAccount?.trim()) return larkConfig.defaultAccount.trim();
  const ids = listLarkAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) return DEFAULT_ACCOUNT_ID;
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

function resolveAccountConfig(
  cfg: MoltbotConfig,
  accountId: string,
): LarkAccountConfig | undefined {
  const accounts = (cfg.channels?.lark as LarkConfig | undefined)?.accounts;
  if (!accounts || typeof accounts !== "object") return undefined;
  return accounts[accountId] as LarkAccountConfig | undefined;
}

function mergeLarkAccountConfig(cfg: MoltbotConfig, accountId: string): LarkAccountConfig {
  const raw = (cfg.channels?.lark ?? {}) as LarkConfig;
  const { accounts: _ignored, defaultAccount: _ignored2, ...base } = raw;
  const account = resolveAccountConfig(cfg, accountId) ?? {};
  return { ...base, ...account };
}

export function resolveLarkAccount(params: {
  cfg: MoltbotConfig;
  accountId?: string | null;
}): ResolvedLarkAccount {
  const accountId = normalizeAccountId(params.accountId);
  const baseEnabled = (params.cfg.channels?.lark as LarkConfig | undefined)?.enabled !== false;
  const merged = mergeLarkAccountConfig(params.cfg, accountId);
  const accountEnabled = merged.enabled !== false;
  const enabled = baseEnabled && accountEnabled;
  const credentials = resolveLarkCredentials(
    params.cfg.channels?.lark as LarkConfig | undefined,
    accountId,
  );

  return {
    accountId,
    name: merged.name?.trim() || undefined,
    enabled,
    appId: credentials.appId,
    appSecret: credentials.appSecret,
    encryptKey: merged.encryptKey?.trim(),
    verificationToken: merged.verificationToken?.trim(),
    credentialSource: credentials.source,
    config: merged,
  };
}

export function listEnabledLarkAccounts(cfg: MoltbotConfig): ResolvedLarkAccount[] {
  return listLarkAccountIds(cfg)
    .map((accountId) => resolveLarkAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}
