import type { MoltbotConfig } from "clawdbot/plugin-sdk";

import { resolveLarkAccount } from "./accounts.js";
import {
  createLarkClient,
  sendAudioMessage,
  sendCardMessage,
  sendFileMessage,
  sendImageMessage,
  sendTextMessage,
  uploadFile,
  uploadImage,
} from "./api.js";
import { getLarkRuntime } from "./runtime.js";
import type { LarkCard, LarkSendOptions, LarkSendResult } from "./types.js";

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

  // Handle card message if provided
  if (options.card) {
    return sendCardMessage(client, chatId, receiveIdType, options.card, options.replyToId);
  }

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
 * Send a card message to Lark
 */
export async function sendCardMessageLark(
  chatId: string,
  card: LarkCard,
  options: Omit<LarkSendOptions, "card"> = {},
): Promise<LarkSendResult> {
  return sendMessageLark(chatId, "", { ...options, card });
}

// Media type detection
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
 * Send a media message (supports image, audio, video, document, and generic files)
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

    // Fetch the media (use loadWebMedia to support local file paths)
    const fetched = await core.media.loadWebMedia(mediaUrl);
    const mediaType = detectMediaType(mediaUrl);

    let sendResult: LarkSendResult;

    switch (mediaType) {
      case "image": {
        // Upload and send image
        const uploadResult = await uploadImage(client, fetched.buffer);
        if (!uploadResult.ok || !uploadResult.imageKey) {
          return { ok: false, error: uploadResult.error || "Failed to upload image" };
        }
        sendResult = await sendImageMessage(client, chatId, receiveIdType, uploadResult.imageKey);
        break;
      }

      case "audio": {
        // Upload and send audio
        const fileName = getFileNameFromUrl(mediaUrl);
        const fileType = getLarkFileType(mediaUrl);
        const uploadResult = await uploadFile(client, fetched.buffer, fileName, fileType);
        if (!uploadResult.ok || !uploadResult.fileKey) {
          return { ok: false, error: uploadResult.error || "Failed to upload audio" };
        }
        sendResult = await sendAudioMessage(client, chatId, receiveIdType, uploadResult.fileKey);
        break;
      }

      case "video":
      case "document": {
        // Upload and send as file
        const fileName = getFileNameFromUrl(mediaUrl);
        const fileType = getLarkFileType(mediaUrl);
        const uploadResult = await uploadFile(client, fetched.buffer, fileName, fileType);
        if (!uploadResult.ok || !uploadResult.fileKey) {
          return { ok: false, error: uploadResult.error || `Failed to upload ${mediaType}` };
        }
        sendResult = await sendFileMessage(client, chatId, receiveIdType, uploadResult.fileKey);
        break;
      }

      case "unknown":
      default: {
        // Try to send as a generic file with "stream" type
        const fileName = getFileNameFromUrl(mediaUrl);
        const uploadResult = await uploadFile(client, fetched.buffer, fileName, "stream");
        if (!uploadResult.ok || !uploadResult.fileKey) {
          return { ok: false, error: uploadResult.error || "Failed to upload file" };
        }
        sendResult = await sendFileMessage(client, chatId, receiveIdType, uploadResult.fileKey);
        break;
      }
    }

    if (!sendResult.ok) {
      return sendResult;
    }

    // Send caption as separate text message if provided
    if (caption?.trim()) {
      const captionResult = await sendTextMessage(client, chatId, receiveIdType, caption.trim());
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
