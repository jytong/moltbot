import type { MoltbotConfig, MarkdownTableMode } from "clawdbot/plugin-sdk";

import type { ResolvedLarkAccount, LarkMessageEvent } from "./types.js";
import {
  createLarkClient,
  createLarkWSClient,
  EventDispatcher,
  LoggerLevel,
  sendAudioMessage,
  sendFileMessage,
  sendImageMessage,
  sendTextMessage,
  uploadFile,
  uploadImage,
  type LarkClient,
  type LarkWSClient,
} from "./api.js";
import { getLarkRuntime } from "./runtime.js";

// WebSocket reconnect policy with exponential backoff
const WS_RECONNECT_POLICY = {
  initialMs: 1000,
  maxMs: 60000,
  factor: 2,
  jitter: 0.2,
};

const MAX_RECONNECT_ATTEMPTS = 10;

function computeBackoff(attempt: number): number {
  const base = WS_RECONNECT_POLICY.initialMs * WS_RECONNECT_POLICY.factor ** Math.max(attempt - 1, 0);
  const jitter = base * WS_RECONNECT_POLICY.jitter * Math.random();
  return Math.min(WS_RECONNECT_POLICY.maxMs, Math.round(base + jitter));
}

async function sleepWithAbort(ms: number, abortSignal?: AbortSignal): Promise<boolean> {
  if (ms <= 0) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(true), ms);
    if (abortSignal) {
      const onAbort = () => {
        clearTimeout(timer);
        resolve(false);
      };
      abortSignal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

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

// Structured logging helpers
type LogLevel = "info" | "warn" | "error" | "debug";

interface LogContext {
  accountId?: string;
  action?: string;
  chatId?: string;
  senderId?: string;
  messageId?: string;
  attempt?: number;
  maxAttempts?: number;
  delayMs?: number;
  error?: string;
}

function formatLogMessage(level: LogLevel, message: string, ctx?: LogContext): string {
  const prefix = ctx?.accountId ? `[${ctx.accountId}]` : "[lark]";
  const contextParts: string[] = [];

  if (ctx?.action) contextParts.push(`action=${ctx.action}`);
  if (ctx?.chatId) contextParts.push(`chat=${ctx.chatId}`);
  if (ctx?.senderId) contextParts.push(`sender=${ctx.senderId}`);
  if (ctx?.messageId) contextParts.push(`msg=${ctx.messageId}`);
  if (ctx?.attempt !== undefined) {
    contextParts.push(`attempt=${ctx.attempt}${ctx.maxAttempts ? `/${ctx.maxAttempts}` : ""}`);
  }
  if (ctx?.delayMs !== undefined) contextParts.push(`delay=${ctx.delayMs}ms`);
  if (ctx?.error) contextParts.push(`error="${ctx.error}"`);

  const contextStr = contextParts.length > 0 ? ` (${contextParts.join(", ")})` : "";
  return `${prefix} ${message}${contextStr}`;
}

function logInfo(runtime: LarkRuntimeEnv, message: string, ctx?: LogContext): void {
  runtime.log?.(formatLogMessage("info", message, ctx));
}

function logError(runtime: LarkRuntimeEnv, message: string, ctx?: LogContext): void {
  runtime.error?.(formatLogMessage("error", message, ctx));
}

function logVerbose(core: LarkCoreRuntime, runtime: LarkRuntimeEnv, message: string, ctx?: LogContext): void {
  if (core.logging.shouldLogVerbose()) {
    runtime.log?.(formatLogMessage("debug", message, ctx));
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

  if (!rawBody) {
    return;
  }

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
    logVerbose(core, runtime, "Ignoring group message without mention", {
      accountId: account.accountId,
      chatId,
      senderId,
    });
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
      logVerbose(core, runtime, "Blocked DM (dmPolicy=disabled)", {
        accountId: account.accountId,
        senderId,
      });
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
            logVerbose(core, runtime, "Pairing request created", {
              accountId: account.accountId,
              senderId,
              action: "pairing",
            });
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
              logVerbose(core, runtime, "Pairing reply failed", {
                accountId: account.accountId,
                senderId,
                action: "pairing",
                error: String(err),
              });
            }
          }
        } else {
          logVerbose(core, runtime, "Blocked unauthorized sender", {
            accountId: account.accountId,
            senderId,
            action: dmPolicy,
          });
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
    logVerbose(core, runtime, "Dropped control command from unauthorized sender", {
      accountId: account.accountId,
      chatId,
      senderId,
      action: "control_command",
    });
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
    onRecordError: (err: unknown) => {
      logError(runtime, "Failed updating session meta", {
        accountId: account.accountId,
        action: "session_update",
        error: String(err),
      });
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
      deliver: async (payload: { text?: string; mediaUrls?: string[]; mediaUrl?: string }) => {
        await deliverLarkReply({
          payload,
          client,
          chatId,
          replyToId: messageId,
          runtime,
          core,
          config,
          accountId: account.accountId,
          statusSink,
          tableMode,
        });
      },
      onError: (err: unknown, info: { kind: string }) => {
        logError(runtime, `Reply failed (${info.kind})`, {
          accountId: account.accountId,
          chatId,
          action: "reply",
          error: String(err),
        });
      },
    },
  });
}

// Media type detection and Lark file type mapping
type MediaType = "image" | "audio" | "video" | "document" | "unknown";
type LarkFileType = "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream";

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];
const AUDIO_EXTENSIONS = [".mp3", ".wav", ".ogg", ".opus", ".m4a", ".aac"];
const VIDEO_EXTENSIONS = [".mp4", ".mov", ".avi", ".mkv", ".webm"];
const DOCUMENT_EXTENSIONS = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"];

function detectMediaType(url: string): MediaType {
  const lower = url.toLowerCase();

  if (IMAGE_EXTENSIONS.some((ext) => lower.includes(ext)) || lower.includes("image/")) {
    return "image";
  }
  if (AUDIO_EXTENSIONS.some((ext) => lower.includes(ext)) || lower.includes("audio/")) {
    return "audio";
  }
  if (VIDEO_EXTENSIONS.some((ext) => lower.includes(ext)) || lower.includes("video/")) {
    return "video";
  }
  if (DOCUMENT_EXTENSIONS.some((ext) => lower.includes(ext))) {
    return "document";
  }
  return "unknown";
}

function getLarkFileType(url: string): LarkFileType {
  const lower = url.toLowerCase();

  // Audio
  if (lower.includes(".opus") || lower.includes("audio/opus")) return "opus";

  // Video
  if (lower.includes(".mp4") || lower.includes("video/mp4")) return "mp4";

  // Documents
  if (lower.includes(".pdf") || lower.includes("application/pdf")) return "pdf";
  if (lower.includes(".doc") || lower.includes("application/msword") || lower.includes(".docx")) return "doc";
  if (lower.includes(".xls") || lower.includes("application/vnd.ms-excel") || lower.includes(".xlsx")) return "xls";
  if (lower.includes(".ppt") || lower.includes("application/vnd.ms-powerpoint") || lower.includes(".pptx")) return "ppt";

  // Default to stream for unknown types
  return "stream";
}

function getFileNameFromUrl(url: string): string {
  // Handle local file paths (absolute or relative)
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    // Extract filename from local path
    const pathParts = url.split("/");
    const fileName = pathParts[pathParts.length - 1];
    if (fileName && fileName.includes(".")) {
      return fileName;
    }
  }

  // Handle URLs
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split("/");
    const fileName = pathParts[pathParts.length - 1];
    if (fileName && fileName.includes(".")) {
      return fileName;
    }
  } catch {
    // Invalid URL
  }

  // Default filename based on current timestamp
  return `file_${Date.now()}`;
}

/**
 * Deliver reply to Lark
 */
async function deliverLarkReply(params: {
  payload: { text?: string; mediaUrls?: string[]; mediaUrl?: string };
  client: LarkClient;
  chatId: string;
  replyToId?: string;
  runtime: LarkRuntimeEnv;
  core: LarkCoreRuntime;
  config: MoltbotConfig;
  accountId?: string;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
  tableMode?: MarkdownTableMode;
}): Promise<void> {
  const { payload, client, chatId, replyToId, runtime, core, config, accountId, statusSink } = params;
  const tableMode = params.tableMode ?? "code";
  const text = core.channel.text.convertMarkdownTables(payload.text ?? "", tableMode);

  // Collect all media URLs
  const mediaUrls: string[] = [];
  if (payload.mediaUrl) mediaUrls.push(payload.mediaUrl);
  if (payload.mediaUrls) mediaUrls.push(...payload.mediaUrls);

  // Process media URLs
  for (const url of mediaUrls) {
    try {
      const mediaType = detectMediaType(url);
      // Use loadWebMedia instead of fetchRemoteMedia to support local file paths
      const fetched = await core.media.loadWebMedia(url);

      switch (mediaType) {
        case "image": {
          // Upload and send image
          const uploadResult = await uploadImage(client, fetched.buffer);
          if (uploadResult.ok && uploadResult.imageKey) {
            await sendImageMessage(client, chatId, "chat_id", uploadResult.imageKey);
            statusSink?.({ lastOutboundAt: Date.now() });
          } else {
            logError(runtime, "Image upload failed", {
              accountId,
              chatId,
              action: "upload_image",
              error: uploadResult.error || "unknown error",
            });
          }
          break;
        }

        case "audio": {
          // Upload and send audio
          const fileName = getFileNameFromUrl(url);
          const fileType = getLarkFileType(url);
          const uploadResult = await uploadFile(client, fetched.buffer, fileName, fileType);
          if (uploadResult.ok && uploadResult.fileKey) {
            await sendAudioMessage(client, chatId, "chat_id", uploadResult.fileKey);
            statusSink?.({ lastOutboundAt: Date.now() });
          } else {
            logError(runtime, "Audio upload failed", {
              accountId,
              chatId,
              action: "upload_audio",
              error: uploadResult.error || "unknown error",
            });
          }
          break;
        }

        case "video":
        case "document": {
          // Upload and send as file
          const fileName = getFileNameFromUrl(url);
          const fileType = getLarkFileType(url);
          const uploadResult = await uploadFile(client, fetched.buffer, fileName, fileType);
          if (uploadResult.ok && uploadResult.fileKey) {
            await sendFileMessage(client, chatId, "chat_id", uploadResult.fileKey);
            statusSink?.({ lastOutboundAt: Date.now() });
          } else {
            logError(runtime, `${mediaType === "video" ? "Video" : "Document"} upload failed`, {
              accountId,
              chatId,
              action: `upload_${mediaType}`,
              error: uploadResult.error || "unknown error",
            });
          }
          break;
        }

        case "unknown":
        default: {
          // Try to send as a generic file
          const fileName = getFileNameFromUrl(url);
          const uploadResult = await uploadFile(client, fetched.buffer, fileName, "stream");
          if (uploadResult.ok && uploadResult.fileKey) {
            await sendFileMessage(client, chatId, "chat_id", uploadResult.fileKey);
            statusSink?.({ lastOutboundAt: Date.now() });
          } else {
            logError(runtime, "File upload failed", {
              accountId,
              chatId,
              action: "upload_file",
              error: uploadResult.error || "unknown error",
            });
          }
          break;
        }
      }
    } catch (err) {
      logError(runtime, "Media send failed", {
        accountId,
        chatId,
        action: "send_media",
        error: String(err),
      });
    }
  }

  // Process text
  if (text) {
    const chunkMode = core.channel.text.resolveChunkMode(config, "lark", accountId);
    const chunks = core.channel.text.chunkMarkdownTextWithMode(
      text,
      LARK_TEXT_LIMIT,
      chunkMode,
    );
    // Only reply to the first chunk, send rest as new messages
    let isFirstChunk = true;
    for (const chunk of chunks) {
      try {
        await sendTextMessage(client, chatId, "chat_id", chunk, isFirstChunk ? replyToId : undefined);
        statusSink?.({ lastOutboundAt: Date.now() });
        isFirstChunk = false;
      } catch (err) {
        logError(runtime, "Message send failed", {
          accountId,
          chatId,
          action: "send_text",
          error: String(err),
        });
      }
    }
  }
}

/**
 * Start monitoring Lark messages via WebSocket with reconnection support
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
  let currentWsClient: LarkWSClient | null = null;
  let reconnectAttempt = 0;

  const stop = () => {
    stopped = true;
    currentWsClient = null;
  };

  // Create event dispatcher
  const eventDispatcher = new EventDispatcher({}).register({
    "im.message.receive_v1": async (data: unknown) => {
      if (stopped || abortSignal.aborted) {
        return;
      }

      // Reset reconnect counter on successful message
      reconnectAttempt = 0;
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
        logError(runtime, "Message processing failed", {
          accountId: account.accountId,
          action: "process_message",
          error: String(err),
        });
      }
    },
  });

  /**
   * Start WebSocket connection with reconnection logic
   */
  const startConnection = async (): Promise<void> => {
    while (!stopped && !abortSignal.aborted && reconnectAttempt < MAX_RECONNECT_ATTEMPTS) {
      try {
        // Create new WebSocket client
        currentWsClient = createLarkWSClient(appId, appSecret, LoggerLevel.info);

        logInfo(runtime, "Starting WebSocket connection", {
          accountId: account.accountId,
          action: "ws_connect",
          attempt: reconnectAttempt + 1,
          maxAttempts: MAX_RECONNECT_ATTEMPTS,
        });

        // Start the connection - this returns a promise that resolves when connected
        await currentWsClient.start({ eventDispatcher });

        // If we get here, connection was established successfully
        reconnectAttempt = 0;
        logInfo(runtime, "WebSocket connected", {
          accountId: account.accountId,
          action: "ws_connected",
        });

        // The SDK handles keep-alive internally and doesn't expose connection close events.
        // The start() method returns immediately after connection is established.
        // We need to wait here until stopped or aborted, rather than looping.
        // The SDK will call eventDispatcher when messages arrive.
        // If connection drops, the SDK may throw or we rely on health checks.

        // Wait indefinitely until abort signal or stop
        await new Promise<void>((resolve) => {
          if (stopped || abortSignal.aborted) {
            resolve();
            return;
          }
          const onAbort = () => {
            resolve();
          };
          abortSignal.addEventListener("abort", onAbort, { once: true });
        });

        // Exit the loop since we're done
        break;

      } catch (err) {
        reconnectAttempt++;
        const errMsg = err instanceof Error ? err.message : String(err);
        logError(runtime, "WebSocket error", {
          accountId: account.accountId,
          action: "ws_error",
          attempt: reconnectAttempt,
          maxAttempts: MAX_RECONNECT_ATTEMPTS,
          error: errMsg,
        });

        if (stopped || abortSignal.aborted) {
          break;
        }

        if (reconnectAttempt < MAX_RECONNECT_ATTEMPTS) {
          const backoffMs = computeBackoff(reconnectAttempt);
          logInfo(runtime, "Reconnecting after delay", {
            accountId: account.accountId,
            action: "ws_reconnect",
            delayMs: backoffMs,
          });

          const shouldContinue = await sleepWithAbort(backoffMs, abortSignal);
          if (!shouldContinue) {
            break;
          }
        }
      }
    }

    if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      logError(runtime, "Max reconnect attempts reached", {
        accountId: account.accountId,
        action: "ws_max_attempts",
        attempt: reconnectAttempt,
        maxAttempts: MAX_RECONNECT_ATTEMPTS,
      });
    }
  };

  // Handle abort signal
  abortSignal.addEventListener(
    "abort",
    () => {
      stopped = true;
      currentWsClient = null;
    },
    { once: true },
  );

  // Start the connection loop (non-blocking)
  void startConnection();

  return { stop };
}
