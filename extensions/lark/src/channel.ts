import type {
  ChannelAccountSnapshot,
  ChannelDock,
  ChannelPlugin,
  MoltbotConfig,
} from "clawdbot/plugin-sdk";
import {
  applyAccountNameToChannelSection,
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  deleteAccountFromConfigSection,
  formatPairingApproveHint,
  migrateBaseNameToDefaultAccount,
  normalizeAccountId,
  PAIRING_APPROVED_MESSAGE,
  setAccountEnabledInConfigSection,
} from "clawdbot/plugin-sdk";

import {
  listLarkAccountIds,
  resolveDefaultLarkAccountId,
  resolveLarkAccount,
  type ResolvedLarkAccount,
} from "./accounts.js";
import { LarkConfigSchema } from "./config-schema.js";
import { larkOnboardingAdapter } from "./onboarding.js";
import { probeLark } from "./probe.js";
import { sendMessageLark } from "./send.js";
import { collectLarkStatusIssues } from "./status-issues.js";

const meta = {
  id: "lark",
  label: "Lark",
  selectionLabel: "Lark/Feishu (Bot)",
  docsPath: "/channels/lark",
  docsLabel: "lark",
  blurb: "Lark/Feishu messaging platform with Bot API.",
  aliases: ["feishu", "fs"],
  order: 75,
  quickstartAllowFrom: true,
};

function normalizeLarkMessagingTarget(raw: string): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^(lark|feishu|fs):/i, "");
}

export const larkDock: ChannelDock = {
  id: "lark",
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    blockStreaming: true,
  },
  outbound: { textChunkLimit: 4000 },
  config: {
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveLarkAccount({ cfg: cfg as MoltbotConfig, accountId }).config.allowFrom ?? []).map(
        (entry) => String(entry),
      ),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.replace(/^(lark|feishu|fs):/i, ""))
        .map((entry) => entry.toLowerCase()),
  },
  groups: {
    resolveRequireMention: ({ cfg, accountId, groupId }) => {
      const account = resolveLarkAccount({ cfg: cfg as MoltbotConfig, accountId });
      return account.config.groups?.[groupId]?.requireMention ?? true;
    },
  },
  threading: {
    resolveReplyToMode: () => "off",
  },
};

export const larkPlugin: ChannelPlugin<ResolvedLarkAccount> = {
  id: "lark",
  meta,
  onboarding: larkOnboardingAdapter,
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    reactions: true,
    threads: false,
    polls: false,
    nativeCommands: false,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.lark"] },
  configSchema: buildChannelConfigSchema(LarkConfigSchema),
  config: {
    listAccountIds: (cfg) => listLarkAccountIds(cfg as MoltbotConfig),
    resolveAccount: (cfg, accountId) => resolveLarkAccount({ cfg: cfg as MoltbotConfig, accountId }),
    defaultAccountId: (cfg) => resolveDefaultLarkAccountId(cfg as MoltbotConfig),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg: cfg as MoltbotConfig,
        sectionKey: "lark",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg: cfg as MoltbotConfig,
        sectionKey: "lark",
        accountId,
        clearBaseFields: ["appId", "appSecret", "name"],
      }),
    isConfigured: (account) => Boolean(account.appId?.trim() && account.appSecret?.trim()),
    describeAccount: (account): ChannelAccountSnapshot => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.appId?.trim() && account.appSecret?.trim()),
      tokenSource: account.credentialSource,
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveLarkAccount({ cfg: cfg as MoltbotConfig, accountId }).config.allowFrom ?? []).map(
        (entry) => String(entry),
      ),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.replace(/^(lark|feishu|fs):/i, ""))
        .map((entry) => entry.toLowerCase()),
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const useAccountPath = Boolean(
        (cfg as MoltbotConfig).channels?.lark?.accounts?.[resolvedAccountId],
      );
      const basePath = useAccountPath
        ? `channels.lark.accounts.${resolvedAccountId}.`
        : "channels.lark.";
      return {
        policy: account.config.dmPolicy ?? "pairing",
        allowFrom: account.config.allowFrom ?? [],
        policyPath: `${basePath}dmPolicy`,
        allowFromPath: basePath,
        approveHint: formatPairingApproveHint("lark"),
        normalizeEntry: (raw) => raw.replace(/^(lark|feishu|fs):/i, ""),
      };
    },
  },
  groups: {
    resolveRequireMention: ({ cfg, accountId, groupId }) => {
      const account = resolveLarkAccount({ cfg: cfg as MoltbotConfig, accountId });
      return account.config.groups?.[groupId]?.requireMention ?? true;
    },
  },
  threading: {
    resolveReplyToMode: () => "off",
  },
  messaging: {
    normalizeTarget: normalizeLarkMessagingTarget,
    targetResolver: {
      looksLikeId: (raw) => {
        const trimmed = raw.trim();
        if (!trimmed) return false;
        // Lark IDs start with oc_ (chat), ou_ (user), on_ (union)
        return /^(oc_|ou_|on_)[a-zA-Z0-9]+$/.test(trimmed);
      },
      hint: "<chatId> (oc_xxx for groups, ou_xxx for users)",
    },
  },
  directory: {
    self: async () => null,
    listPeers: async ({ cfg, accountId, query, limit }) => {
      const account = resolveLarkAccount({ cfg: cfg as MoltbotConfig, accountId });
      const q = query?.trim().toLowerCase() || "";
      const peers = Array.from(
        new Set(
          (account.config.allowFrom ?? [])
            .map((entry) => String(entry).trim())
            .filter((entry) => Boolean(entry) && entry !== "*")
            .map((entry) => entry.replace(/^(lark|feishu|fs):/i, "")),
        ),
      )
        .filter((id) => (q ? id.toLowerCase().includes(q) : true))
        .slice(0, limit && limit > 0 ? limit : undefined)
        .map((id) => ({ kind: "user", id }) as const);
      return peers;
    },
    listGroups: async () => [],
  },
  setup: {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
    applyAccountName: ({ cfg, accountId, name }) =>
      applyAccountNameToChannelSection({
        cfg: cfg as MoltbotConfig,
        channelKey: "lark",
        accountId,
        name,
      }),
    validateInput: ({ accountId, input }) => {
      if (input.useEnv && accountId !== DEFAULT_ACCOUNT_ID) {
        return "LARK_APP_ID/LARK_APP_SECRET can only be used for the default account.";
      }
      if (!input.useEnv && (!input.appId || !input.appSecret)) {
        return "Lark requires appId and appSecret (or --use-env).";
      }
      return null;
    },
    applyAccountConfig: ({ cfg, accountId, input }) => {
      const namedConfig = applyAccountNameToChannelSection({
        cfg: cfg as MoltbotConfig,
        channelKey: "lark",
        accountId,
        name: input.name,
      });
      const next =
        accountId !== DEFAULT_ACCOUNT_ID
          ? migrateBaseNameToDefaultAccount({
              cfg: namedConfig,
              channelKey: "lark",
            })
          : namedConfig;
      if (accountId === DEFAULT_ACCOUNT_ID) {
        return {
          ...next,
          channels: {
            ...next.channels,
            lark: {
              ...next.channels?.lark,
              enabled: true,
              ...(input.useEnv
                ? {}
                : {
                    appId: input.appId,
                    appSecret: input.appSecret,
                  }),
            },
          },
        } as MoltbotConfig;
      }
      return {
        ...next,
        channels: {
          ...next.channels,
          lark: {
            ...next.channels?.lark,
            enabled: true,
            accounts: {
              ...next.channels?.lark?.accounts,
              [accountId]: {
                ...next.channels?.lark?.accounts?.[accountId],
                enabled: true,
                appId: input.appId,
                appSecret: input.appSecret,
              },
            },
          },
        },
      } as MoltbotConfig;
    },
  },
  pairing: {
    idLabel: "larkUserId",
    normalizeAllowEntry: (entry) => entry.replace(/^(lark|feishu|fs):/i, ""),
    notifyApproval: async ({ cfg, id }) => {
      const account = resolveLarkAccount({ cfg: cfg as MoltbotConfig });
      if (!account.appId || !account.appSecret) {
        throw new Error("Lark credentials not configured");
      }
      await sendMessageLark(id, PAIRING_APPROVED_MESSAGE, {
        appId: account.appId,
        appSecret: account.appSecret,
      });
    },
  },
  outbound: {
    deliveryMode: "direct",
    chunker: (text, limit) => {
      if (!text) return [];
      if (limit <= 0 || text.length <= limit) return [text];
      const chunks: string[] = [];
      let remaining = text;
      while (remaining.length > limit) {
        const window = remaining.slice(0, limit);
        const lastNewline = window.lastIndexOf("\n");
        const lastSpace = window.lastIndexOf(" ");
        let breakIdx = lastNewline > 0 ? lastNewline : lastSpace;
        if (breakIdx <= 0) breakIdx = limit;
        const rawChunk = remaining.slice(0, breakIdx);
        const chunk = rawChunk.trimEnd();
        if (chunk.length > 0) chunks.push(chunk);
        const brokeOnSeparator = breakIdx < remaining.length && /\s/.test(remaining[breakIdx]);
        const nextStart = Math.min(remaining.length, breakIdx + (brokeOnSeparator ? 1 : 0));
        remaining = remaining.slice(nextStart).trimStart();
      }
      if (remaining.length) chunks.push(remaining);
      return chunks;
    },
    chunkerMode: "text",
    textChunkLimit: 4000,
    sendText: async ({ to, text, accountId, cfg }) => {
      const result = await sendMessageLark(to, text, {
        accountId: accountId ?? undefined,
        cfg: cfg as MoltbotConfig,
      });
      return {
        channel: "lark",
        ok: result.ok,
        messageId: result.messageId ?? "",
        error: result.error ? new Error(result.error) : undefined,
      };
    },
    sendMedia: async ({ to, text, mediaUrl, accountId, cfg }) => {
      const result = await sendMessageLark(to, text, {
        accountId: accountId ?? undefined,
        mediaUrl,
        cfg: cfg as MoltbotConfig,
      });
      return {
        channel: "lark",
        ok: result.ok,
        messageId: result.messageId ?? "",
        error: result.error ? new Error(result.error) : undefined,
      };
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    collectStatusIssues: collectLarkStatusIssues,
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      tokenSource: snapshot.tokenSource ?? "none",
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ account, timeoutMs }) =>
      probeLark(account.appId, account.appSecret, timeoutMs),
    buildAccountSnapshot: ({ account, runtime }) => {
      const configured = Boolean(account.appId?.trim() && account.appSecret?.trim());
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured,
        tokenSource: account.credentialSource,
        running: runtime?.running ?? false,
        lastStartAt: runtime?.lastStartAt ?? null,
        lastStopAt: runtime?.lastStopAt ?? null,
        lastError: runtime?.lastError ?? null,
        lastInboundAt: runtime?.lastInboundAt ?? null,
        lastOutboundAt: runtime?.lastOutboundAt ?? null,
        dmPolicy: account.config.dmPolicy ?? "pairing",
      };
    },
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      const appId = account.appId.trim();
      const appSecret = account.appSecret.trim();
      let larkBotLabel = "";

      try {
        const probe = await probeLark(appId, appSecret, 2500);
        const name = probe.ok ? probe.bot?.app_name?.trim() : null;
        if (name) larkBotLabel = ` (${name})`;
        ctx.setStatus({
          accountId: account.accountId,
          bot: probe.bot,
        });
      } catch {
        // ignore probe errors
      }

      ctx.log?.info(`[${account.accountId}] starting provider${larkBotLabel}`);

      const { monitorLarkProvider } = await import("./monitor.js");
      return monitorLarkProvider({
        appId,
        appSecret,
        account,
        config: ctx.cfg as MoltbotConfig,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        statusSink: (patch) => ctx.setStatus({ accountId: ctx.accountId, ...patch }),
      });
    },
  },
};
