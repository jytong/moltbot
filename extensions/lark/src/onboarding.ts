import type {
  ChannelOnboardingAdapter,
  ChannelOnboardingDmPolicy,
  MoltbotConfig,
  WizardPrompter,
} from "clawdbot/plugin-sdk";
import {
  addWildcardAllowFrom,
  DEFAULT_ACCOUNT_ID,
  normalizeAccountId,
  promptAccountId,
} from "clawdbot/plugin-sdk";

import {
  listLarkAccountIds,
  resolveDefaultLarkAccountId,
  resolveLarkAccount,
} from "./accounts.js";

const channel = "lark" as const;

function setLarkDmPolicy(
  cfg: MoltbotConfig,
  dmPolicy: "pairing" | "allowlist" | "open" | "disabled",
) {
  const allowFrom = dmPolicy === "open" ? addWildcardAllowFrom(cfg.channels?.lark?.allowFrom) : undefined;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      lark: {
        ...cfg.channels?.lark,
        dmPolicy,
        ...(allowFrom ? { allowFrom } : {}),
      },
    },
  } as MoltbotConfig;
}

async function noteLarkCredentialsHelp(prompter: WizardPrompter): Promise<void> {
  await prompter.note(
    [
      "1) Open Lark Developer Console: https://open.feishu.cn/app/ (飞书) or https://open.larksuite.com (Lark)",
      "2) Create an application and get the App ID and App Secret",
      "3) Configure the bot permissions (im:message, im:message:send_as_bot, etc.)",
      "4) Enable the bot capability and add it to a chat",
      "Tip: you can also set LARK_APP_ID and LARK_APP_SECRET in your env.",
      "Docs: https://docs.molt.bot/channels/lark",
    ].join("\n"),
    "Lark credentials",
  );
}

async function promptLarkAllowFrom(params: {
  cfg: MoltbotConfig;
  prompter: WizardPrompter;
  accountId: string;
}): Promise<MoltbotConfig> {
  const { cfg, prompter, accountId } = params;
  const resolved = resolveLarkAccount({ cfg, accountId });
  const existingAllowFrom = resolved.config.allowFrom ?? [];
  const entry = await prompter.text({
    message: "Lark allowFrom (open_id or user_id)",
    placeholder: "ou_xxxxxxxxxx",
    initialValue: existingAllowFrom[0] ? String(existingAllowFrom[0]) : undefined,
    validate: (value) => {
      const raw = String(value ?? "").trim();
      if (!raw) return "Required";
      // Accept ou_ (open_id), on_ (union_id) or other formats
      return undefined;
    },
  });
  const normalized = String(entry).trim();
  const merged = [
    ...existingAllowFrom.map((item) => String(item).trim()).filter(Boolean),
    normalized,
  ];
  const unique = [...new Set(merged)];

  if (accountId === DEFAULT_ACCOUNT_ID) {
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        lark: {
          ...cfg.channels?.lark,
          enabled: true,
          dmPolicy: "allowlist",
          allowFrom: unique,
        },
      },
    } as MoltbotConfig;
  }

  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      lark: {
        ...cfg.channels?.lark,
        enabled: true,
        accounts: {
          ...cfg.channels?.lark?.accounts,
          [accountId]: {
            ...cfg.channels?.lark?.accounts?.[accountId],
            enabled: cfg.channels?.lark?.accounts?.[accountId]?.enabled ?? true,
            dmPolicy: "allowlist",
            allowFrom: unique,
          },
        },
      },
    },
  } as MoltbotConfig;
}

const dmPolicy: ChannelOnboardingDmPolicy = {
  label: "Lark",
  channel,
  policyKey: "channels.lark.dmPolicy",
  allowFromKey: "channels.lark.allowFrom",
  getCurrent: (cfg) => (cfg.channels?.lark?.dmPolicy ?? "pairing") as "pairing",
  setPolicy: (cfg, policy) => setLarkDmPolicy(cfg as MoltbotConfig, policy),
  promptAllowFrom: async ({ cfg, prompter, accountId }) => {
    const id =
      accountId && normalizeAccountId(accountId)
        ? normalizeAccountId(accountId) ?? DEFAULT_ACCOUNT_ID
        : resolveDefaultLarkAccountId(cfg as MoltbotConfig);
    return promptLarkAllowFrom({
      cfg: cfg as MoltbotConfig,
      prompter,
      accountId: id,
    });
  },
};

export const larkOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,
  dmPolicy,
  getStatus: async ({ cfg }) => {
    const configured = listLarkAccountIds(cfg as MoltbotConfig).some((accountId) => {
      const account = resolveLarkAccount({ cfg: cfg as MoltbotConfig, accountId });
      return Boolean(account.appId && account.appSecret);
    });
    return {
      channel,
      configured,
      statusLines: [`Lark: ${configured ? "configured" : "needs credentials"}`],
      selectionHint: configured ? "recommended · configured" : "recommended · newcomer-friendly",
      quickstartScore: configured ? 1 : 10,
    };
  },
  configure: async ({ cfg, prompter, accountOverrides, shouldPromptAccountIds, forceAllowFrom }) => {
    const larkOverride = accountOverrides.lark?.trim();
    const defaultLarkAccountId = resolveDefaultLarkAccountId(cfg as MoltbotConfig);
    let larkAccountId = larkOverride
      ? normalizeAccountId(larkOverride)
      : defaultLarkAccountId;

    if (shouldPromptAccountIds && !larkOverride) {
      larkAccountId = await promptAccountId({
        cfg: cfg as MoltbotConfig,
        prompter,
        label: "Lark",
        currentId: larkAccountId,
        listAccountIds: listLarkAccountIds,
        defaultAccountId: defaultLarkAccountId,
      });
    }

    let next = cfg as MoltbotConfig;
    const resolvedAccount = resolveLarkAccount({ cfg: next, accountId: larkAccountId });
    const accountConfigured = Boolean(resolvedAccount.appId && resolvedAccount.appSecret);
    const allowEnv = larkAccountId === DEFAULT_ACCOUNT_ID;
    const canUseEnv = allowEnv && Boolean(
      process.env.LARK_APP_ID?.trim() && process.env.LARK_APP_SECRET?.trim(),
    );
    const hasConfigCredentials = Boolean(
      resolvedAccount.config.appId && resolvedAccount.config.appSecret,
    );

    let appId: string | null = null;
    let appSecret: string | null = null;

    if (!accountConfigured) {
      await noteLarkCredentialsHelp(prompter);
    }

    if (canUseEnv && !resolvedAccount.config.appId) {
      const keepEnv = await prompter.confirm({
        message: "LARK_APP_ID/LARK_APP_SECRET detected. Use env vars?",
        initialValue: true,
      });
      if (keepEnv) {
        next = {
          ...next,
          channels: {
            ...next.channels,
            lark: {
              ...next.channels?.lark,
              enabled: true,
            },
          },
        } as MoltbotConfig;
      } else {
        appId = String(
          await prompter.text({
            message: "Enter Lark App ID",
            placeholder: "cli_xxxxxxxxxx",
            validate: (value) => (value?.trim() ? undefined : "Required"),
          }),
        ).trim();
        appSecret = String(
          await prompter.text({
            message: "Enter Lark App Secret",
            validate: (value) => (value?.trim() ? undefined : "Required"),
          }),
        ).trim();
      }
    } else if (hasConfigCredentials) {
      const keep = await prompter.confirm({
        message: "Lark credentials already configured. Keep them?",
        initialValue: true,
      });
      if (!keep) {
        appId = String(
          await prompter.text({
            message: "Enter Lark App ID",
            placeholder: "cli_xxxxxxxxxx",
            validate: (value) => (value?.trim() ? undefined : "Required"),
          }),
        ).trim();
        appSecret = String(
          await prompter.text({
            message: "Enter Lark App Secret",
            validate: (value) => (value?.trim() ? undefined : "Required"),
          }),
        ).trim();
      }
    } else {
      appId = String(
        await prompter.text({
          message: "Enter Lark App ID",
          placeholder: "cli_xxxxxxxxxx",
          validate: (value) => (value?.trim() ? undefined : "Required"),
        }),
      ).trim();
      appSecret = String(
        await prompter.text({
          message: "Enter Lark App Secret",
          validate: (value) => (value?.trim() ? undefined : "Required"),
        }),
      ).trim();
    }

    if (appId && appSecret) {
      if (larkAccountId === DEFAULT_ACCOUNT_ID) {
        next = {
          ...next,
          channels: {
            ...next.channels,
            lark: {
              ...next.channels?.lark,
              enabled: true,
              appId,
              appSecret,
            },
          },
        } as MoltbotConfig;
      } else {
        next = {
          ...next,
          channels: {
            ...next.channels,
            lark: {
              ...next.channels?.lark,
              enabled: true,
              accounts: {
                ...next.channels?.lark?.accounts,
                [larkAccountId]: {
                  ...next.channels?.lark?.accounts?.[larkAccountId],
                  enabled: true,
                  appId,
                  appSecret,
                },
              },
            },
          },
        } as MoltbotConfig;
      }
    }

    if (forceAllowFrom) {
      next = await promptLarkAllowFrom({
        cfg: next,
        prompter,
        accountId: larkAccountId,
      });
    }

    return { cfg: next, accountId: larkAccountId };
  },
};
