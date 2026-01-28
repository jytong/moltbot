import type { MoltbotConfig, MarkdownTableMode } from "clawdbot/plugin-sdk";

import type { ResolvedLarkAccount, LarkMessageEvent } from "./types.js";
import {
  createLarkClient,
  createLarkWSClient,
  EventDispatcher,
  LoggerLevel,
  sendTextMessage,
  type LarkClient,
} from "./api.js";
import { getLarkRuntime } from "./runtime.js";

export type LarkRuntimeEnv = {
  log?: (message: string) => void;
  error?: (message: string) => void;
};

export type LarkMonitorOptions = {
  appId: string;
  appSecret: string;
  account: ResolvedLarkAccount;
  config: MoltbotConfig;
  runtime: LarkRuntimeEnv;
  abortSignal: AbortSignal;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

export type LarkMonitorResult = {
  stop: () => void;
};

const LARK_TEXT_LIMIT = 4000;
const DEFAULT_MEDIA_MAX_MB = 5;

type LarkCoreRuntime = ReturnType<typeof getLarkRuntime>;

function logVerbose(core: LarkCoreRuntime, runtime: LarkRuntimeEnv, message: string): void {
  if (core.logging.shouldLogVerbose()) {
    runtime.log?.(`[lark] ${message}`);
  }
}

function isSenderAllowed(senderId: string, allowFrom: string[]): boolean {
  if (allowFrom.includes("*")) return true;
  const normalizedSenderId = senderId.toLowerCase();
  return allowFrom.some((entry) => {
    const normalized = entry.toLowerCase().replace(/^(lark|feishu|fs):/i, "");
    return normalized === normalizedSenderId;
  });
}

/**
 * Parse message content from Lark
 */
function parseMessageContent(msgType: string, content: string): { text?: string; imageKey?: string } {
  try {
    const parsed = JSON.parse(content);
    if (msgType === "text") {
      return { text: parsed.text };
    }
    if (msgType === "image") {
      return { imageKey: parsed.image_key };
    }
    if (msgType === "post") {
      // Rich text - extract plain text
      const extractText = (node: unknown): string => {
        if (!node || typeof node !== "object") return "";
        const n = node as Record<string, unknown>;
        if (n.tag === "text" && typeof n.text === "string") return n.text;
        if (Array.isArray(n.content)) {
          return n.content.map((row) =>
            Array.isArray(row) ? row.map(extractText).join("") : ""
          ).join("\n");
        }
        return "";
      };
      const text = extractText(parsed);
      return { text };
    }
    return { text: content };
  } catch {
    return { text: content };
  }
}

/**
 * Process incoming message
 */
async function processMessage(
  event: LarkMessageEvent,
  client: LarkClient,
  account: ResolvedLarkAccount,
  config: MoltbotConfig,
  runtime: LarkRuntimeEnv,
  core: LarkCoreRuntime,
  _mediaMaxMb: number,
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void,
): Promise<void> {
  const { sender, message } = event;
  const senderId = sender.sender_id.open_id || sender.sender_id.user_id || "";
  const chatId = message.chat_id;
  const chatType = message.chat_type;
  const isGroup = chatType === "group";
  const messageId = message.message_id;

  // Parse message content
  const { text, imageKey } = parseMessageContent(message.message_type, message.content);
  const rawBody = text?.trim() || (imageKey ? "<media:image>" : "");

  if (!rawBody) return;

  // Check mentions in group chat
  // In group chats, we assume bot is mentioned if there are any mentions
  // since the bot only receives messages where it's explicitly mentioned
  let isMentioned = false;
  if (isGroup && message.mentions?.length) {
    // Lark only sends messages to bot when bot is mentioned in group chat
    // So if we receive a group message with mentions, bot is likely mentioned
    isMentioned = true;
  }

  // Resolve group require mention
  const requireMention = isGroup
    ? account.config.groups?.[chatId]?.requireMention ?? true
    : false;

  if (isGroup && requireMention && !isMentioned) {
    logVerbose(core, runtime, `[${account.accountId}] Ignoring group message without mention`);
    return;
  }

  // Check DM policy
  const dmPolicy = account.config.dmPolicy ?? "pairing";
  const configAllowFrom = (account.config.allowFrom ?? []).map((v) => String(v));
  const shouldComputeAuth = core.channel.commands.shouldComputeCommandAuthorized(
    rawBody,
    config,
  );
  const storeAllowFrom =
    !isGroup && (dmPolicy !== "open" || shouldComputeAuth)
      ? await core.channel.pairing.readAllowFromStore("lark").catch(() => [])
      : [];
  const effectiveAllowFrom = [...configAllowFrom, ...storeAllowFrom];
  const useAccessGroups = config.commands?.useAccessGroups !== false;
  const senderAllowedForCommands = isSenderAllowed(senderId, effectiveAllowFrom);
  const commandAuthorized = shouldComputeAuth
    ? core.channel.commands.resolveCommandAuthorizedFromAuthorizers({
        useAccessGroups,
        authorizers: [{ configured: effectiveAllowFrom.length > 0, allowed: senderAllowedForCommands }],
      })
    : undefined;

  if (!isGroup) {
    if (dmPolicy === "disabled") {
      logVerbose(core, runtime, `Blocked lark DM from ${senderId} (dmPolicy=disabled)`);
      return;
    }

    if (dmPolicy !== "open") {
      const allowed = senderAllowedForCommands;

      if (!allowed) {
        if (dmPolicy === "pairing") {
          const { code, created } = await core.channel.pairing.upsertPairingRequest({
            channel: "lark",
            id: senderId,
            meta: {},
          });

          if (created) {
            logVerbose(core, runtime, `lark pairing request sender=${senderId}`);
            try {
              await sendTextMessage(
                client,
                chatId,
                "chat_id",
                core.channel.pairing.buildPairingReply({
                  channel: "lark",
                  idLine: `Your Lark user id: ${senderId}`,
                  code,
                }),
              );
              statusSink?.({ lastOutboundAt: Date.now() });
            } catch (err) {
              logVerbose(
                core,
                runtime,
                `lark pairing reply failed for ${senderId}: ${String(err)}`,
              );
            }
          }
        } else {
          logVerbose(
            core,
            runtime,
            `Blocked unauthorized lark sender ${senderId} (dmPolicy=${dmPolicy})`,
          );
        }
        return;
      }
    }
  }

  // Route to agent
  const route = core.channel.routing.resolveAgentRoute({
    cfg: config,
    channel: "lark",
    accountId: account.accountId,
    peer: {
      kind: isGroup ? "group" : "dm",
      id: chatId,
    },
  });

  if (
    isGroup &&
    core.channel.commands.isControlCommandMessage(rawBody, config) &&
    commandAuthorized !== true
  ) {
    logVerbose(core, runtime, `lark: drop control command from unauthorized sender ${senderId}`);
    return;
  }

  const fromLabel = isGroup ? `group:${chatId}` : `user:${senderId}`;
  const storePath = core.channel.session.resolveStorePath(config.session?.store, {
    agentId: route.agentId,
  });
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(config);
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });
  const timestamp = message.create_time ? parseInt(message.create_time, 10) : undefined;
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "Lark",
    from: fromLabel,
    timestamp,
    previousTimestamp,
    envelope: envelopeOptions,
    body: rawBody,
  });

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: isGroup ? `lark:group:${chatId}` : `lark:${senderId}`,
    To: `lark:${chatId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: isGroup ? "group" : "direct",
    ConversationLabel: fromLabel,
    SenderId: senderId,
    CommandAuthorized: commandAuthorized,
    Provider: "lark",
    Surface: "lark",
    MessageSid: messageId,
    OriginatingChannel: "lark",
    OriginatingTo: `lark:${chatId}`,
  });

  await core.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
    ctx: ctxPayload,
    onRecordError: (err) => {
      runtime.error?.(`lark: failed updating session meta: ${String(err)}`);
    },
  });

  const tableMode = core.channel.text.resolveMarkdownTableMode({
    cfg: config,
    channel: "lark",
    accountId: account.accountId,
  });

  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: config,
    dispatcherOptions: {
      deliver: async (payload) => {
        await deliverLarkReply({
          payload,
          client,
          chatId,
          runtime,
          core,
          config,
          accountId: account.accountId,
          statusSink,
          tableMode,
        });
      },
      onError: (err, info) => {
        runtime.error?.(`[${account.accountId}] Lark ${info.kind} reply failed: ${String(err)}`);
      },
    },
  });
}

/**
 * Deliver reply to Lark
 */
async function deliverLarkReply(params: {
  payload: { text?: string; mediaUrls?: string[]; mediaUrl?: string };
  client: LarkClient;
  chatId: string;
  runtime: LarkRuntimeEnv;
  core: LarkCoreRuntime;
  config: MoltbotConfig;
  accountId?: string;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
  tableMode?: MarkdownTableMode;
}): Promise<void> {
  const { payload, client, chatId, runtime, core, config, accountId, statusSink } = params;
  const tableMode = params.tableMode ?? "code";
  const text = core.channel.text.convertMarkdownTables(payload.text ?? "", tableMode);

  // TODO: Handle media URLs by uploading and sending

  if (text) {
    const chunkMode = core.channel.text.resolveChunkMode(config, "lark", accountId);
    const chunks = core.channel.text.chunkMarkdownTextWithMode(
      text,
      LARK_TEXT_LIMIT,
      chunkMode,
    );
    for (const chunk of chunks) {
      try {
        await sendTextMessage(client, chatId, "chat_id", chunk);
        statusSink?.({ lastOutboundAt: Date.now() });
      } catch (err) {
        runtime.error?.(`Lark message send failed: ${String(err)}`);
      }
    }
  }
}

/**
 * Start monitoring Lark messages via WebSocket
 */
export async function monitorLarkProvider(
  options: LarkMonitorOptions,
): Promise<LarkMonitorResult> {
  const {
    appId,
    appSecret,
    account,
    config,
    runtime,
    abortSignal,
    statusSink,
  } = options;

  const core = getLarkRuntime();
  const effectiveMediaMaxMb = account.config.mediaMaxMb ?? DEFAULT_MEDIA_MAX_MB;
  const client = createLarkClient(appId, appSecret);

  let stopped = false;
  const stopHandlers: Array<() => void> = [];

  const stop = () => {
    stopped = true;
    for (const handler of stopHandlers) {
      handler();
    }
  };

  // Create WebSocket client
  const wsClient = createLarkWSClient(appId, appSecret, LoggerLevel.info);

  // Create event dispatcher
  const eventDispatcher = new EventDispatcher({}).register({
    "im.message.receive_v1": async (data: unknown) => {
      if (stopped || abortSignal.aborted) return;

      statusSink?.({ lastInboundAt: Date.now() });

      try {
        const event = data as LarkMessageEvent;
        await processMessage(
          event,
          client,
          account,
          config,
          runtime,
          core,
          effectiveMediaMaxMb,
          statusSink,
        );
      } catch (err) {
        runtime.error?.(`[${account.accountId}] Lark message processing failed: ${String(err)}`);
      }
    },
  });

  // Start WebSocket connection
  void wsClient.start({ eventDispatcher });

  // Handle abort signal
  abortSignal.addEventListener(
    "abort",
    () => {
      stopped = true;
      // Note: WSClient doesn't have a built-in stop method, but setting stopped flag
      // will prevent further message processing
    },
    { once: true },
  );

  return { stop };
}
