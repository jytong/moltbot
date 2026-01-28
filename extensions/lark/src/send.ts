import type { MoltbotConfig } from "clawdbot/plugin-sdk";

import { resolveLarkAccount } from "./accounts.js";
import { createLarkClient, sendImageMessage, sendTextMessage, uploadImage } from "./api.js";
import { getLarkRuntime } from "./runtime.js";
import type { LarkSendOptions, LarkSendResult } from "./types.js";

const LARK_TEXT_LIMIT = 4000;

/**
 * Resolve send context (client credentials)
 */
function resolveSendContext(options: LarkSendOptions): {
  appId: string;
  appSecret: string;
} {
  if (options.cfg) {
    const account = resolveLarkAccount({
      cfg: options.cfg as MoltbotConfig,
      accountId: options.accountId,
    });
    return {
      appId: options.appId || account.appId,
      appSecret: options.appSecret || account.appSecret,
    };
  }

  return {
    appId: options.appId || "",
    appSecret: options.appSecret || "",
  };
}

/**
 * Determine receive_id_type based on the chat ID format
 */
function resolveReceiveIdType(
  chatId: string,
): "open_id" | "user_id" | "union_id" | "email" | "chat_id" {
  const trimmed = chatId.trim();

  // Chat ID (group chat)
  if (trimmed.startsWith("oc_")) {
    return "chat_id";
  }

  // Open ID (user)
  if (trimmed.startsWith("ou_")) {
    return "open_id";
  }

  // Union ID
  if (trimmed.startsWith("on_")) {
    return "union_id";
  }

  // Email
  if (trimmed.includes("@")) {
    return "email";
  }

  // Default to chat_id
  return "chat_id";
}

/**
 * Send a message to Lark
 */
export async function sendMessageLark(
  chatId: string,
  text: string,
  options: LarkSendOptions = {},
): Promise<LarkSendResult> {
  const { appId, appSecret } = resolveSendContext(options);

  if (!appId || !appSecret) {
    return { ok: false, error: "No Lark credentials configured" };
  }

  if (!chatId?.trim()) {
    return { ok: false, error: "No chat_id provided" };
  }

  const client = createLarkClient(appId, appSecret);
  const receiveIdType = resolveReceiveIdType(chatId);

  // Handle media if provided
  if (options.mediaUrl) {
    return sendMediaMessageLark(client, chatId, receiveIdType, text, options.mediaUrl);
  }

  // Send text message
  const trimmedText = text?.trim() || "";
  if (!trimmedText) {
    return { ok: false, error: "No text content to send" };
  }

  // Chunk long messages
  const chunks = chunkText(trimmedText, LARK_TEXT_LIMIT);
  let lastResult: LarkSendResult = { ok: false, error: "No chunks to send" };

  for (const chunk of chunks) {
    lastResult = await sendTextMessage(
      client,
      chatId,
      receiveIdType,
      chunk,
      options.replyToId,
    );

    if (!lastResult.ok) {
      return lastResult;
    }
  }

  return lastResult;
}

/**
 * Send a media message
 */
async function sendMediaMessageLark(
  client: ReturnType<typeof createLarkClient>,
  chatId: string,
  receiveIdType: "open_id" | "user_id" | "union_id" | "email" | "chat_id",
  caption: string,
  mediaUrl: string,
): Promise<LarkSendResult> {
  try {
    const core = getLarkRuntime();

    // Fetch the media
    const fetched = await core.channel.media.fetchRemoteMedia({ url: mediaUrl });

    // Upload to Lark
    const uploadResult = await uploadImage(client, fetched.buffer);
    if (!uploadResult.ok || !uploadResult.imageKey) {
      return { ok: false, error: uploadResult.error || "Failed to upload image" };
    }

    // Send the image
    const sendResult = await sendImageMessage(
      client,
      chatId,
      receiveIdType,
      uploadResult.imageKey,
    );

    if (!sendResult.ok) {
      return sendResult;
    }

    // Send caption as separate text message if provided
    if (caption?.trim()) {
      const captionResult = await sendTextMessage(
        client,
        chatId,
        receiveIdType,
        caption.trim(),
      );
      return captionResult;
    }

    return sendResult;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Chunk text into smaller pieces
 */
function chunkText(text: string, limit: number): string[] {
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
}
