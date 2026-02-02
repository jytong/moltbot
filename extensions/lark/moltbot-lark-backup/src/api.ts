import { Readable } from "node:stream";

import * as lark from "@larksuiteoapi/node-sdk";

import type { LarkBotInfo, LarkCard, LarkSendResult } from "./types.js";

export type LarkClient = lark.Client;
export type LarkWSClient = lark.WSClient;

// Retry configuration
const RETRY_CONFIG = {
  maxAttempts: 3,
  initialDelayMs: 500,
  maxDelayMs: 5000,
  factor: 2,
};

// Error codes that should trigger a retry
const RETRYABLE_ERROR_CODES = new Set([
  99991400, // System busy
  99991663, // Request too frequent
  99991672, // Rate limit exceeded
]);

// Network error patterns that should trigger a retry
const RETRYABLE_ERROR_PATTERNS = [
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
  /ECONNREFUSED/i,
  /socket hang up/i,
  /network/i,
];

function isRetryableError(error: unknown): boolean {
  if (!error) return false;

  // Check for Lark API error codes
  if (typeof error === "object" && error !== null) {
    const errObj = error as { code?: number; message?: string };
    if (errObj.code && RETRYABLE_ERROR_CODES.has(errObj.code)) {
      return true;
    }
  }

  // Check for network errors
  const errMsg = error instanceof Error ? error.message : String(error);
  return RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(errMsg));
}

function computeRetryDelay(attempt: number): number {
  const delay = RETRY_CONFIG.initialDelayMs * RETRY_CONFIG.factor ** attempt;
  return Math.min(delay, RETRY_CONFIG.maxDelayMs);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  operation: () => Promise<T>,
  _operationName: string,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < RETRY_CONFIG.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;

      if (!isRetryableError(err) || attempt >= RETRY_CONFIG.maxAttempts - 1) {
        throw err;
      }

      const delay = computeRetryDelay(attempt);
      // Log retry attempt (silent for now, could be connected to runtime logger)
      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Create a Lark API client
 */
export function createLarkClient(appId: string, appSecret: string): LarkClient {
  return new lark.Client({
    appId,
    appSecret,
    disableTokenCache: false,
  });
}

/**
 * Create a Lark WebSocket client for receiving messages
 */
export function createLarkWSClient(
  appId: string,
  appSecret: string,
  logLevel: lark.LoggerLevel = lark.LoggerLevel.info,
): LarkWSClient {
  return new lark.WSClient({
    appId,
    appSecret,
    loggerLevel: logLevel,
  });
}

/**
 * Get bot info using the bot.v3.info API
 */
export async function getBotInfo(client: LarkClient): Promise<LarkBotInfo | null> {
  try {
    const response = (await client.request({
      method: "GET",
      url: "/open-apis/bot/v3/info",
    })) as { code?: number; msg?: string; bot?: { app_name?: string; open_id?: string } };
    if (response?.bot) {
      return {
        app_name: response.bot.app_name,
        open_id: response.bot.open_id,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Send a text message with retry support
 */
export async function sendTextMessage(
  client: LarkClient,
  receiveId: string,
  receiveIdType: "open_id" | "user_id" | "union_id" | "email" | "chat_id",
  text: string,
  replyToId?: string,
): Promise<LarkSendResult> {
  try {
    const content = JSON.stringify({ text });

    // Use reply API if replyToId is provided
    if (replyToId) {
      const response = await withRetry(
        () =>
          client.im.message.reply({
            path: {
              message_id: replyToId,
            },
            data: {
              msg_type: "text",
              content,
            },
          }),
        "sendTextMessage.reply",
      );

      if (response?.data?.message_id) {
        return { ok: true, messageId: response.data.message_id };
      }

      return { ok: false, error: "No message_id in response" };
    }

    // Send new message
    const response = await withRetry(
      () =>
        client.im.message.create({
          params: {
            receive_id_type: receiveIdType,
          },
          data: {
            receive_id: receiveId,
            msg_type: "text",
            content,
          },
        }),
      "sendTextMessage.create",
    );

    if (response?.data?.message_id) {
      return { ok: true, messageId: response.data.message_id };
    }

    return { ok: false, error: "No message_id in response" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Send an image message with retry support
 */
export async function sendImageMessage(
  client: LarkClient,
  receiveId: string,
  receiveIdType: "open_id" | "user_id" | "union_id" | "email" | "chat_id",
  imageKey: string,
): Promise<LarkSendResult> {
  try {
    const content = JSON.stringify({ image_key: imageKey });
    const response = await withRetry(
      () =>
        client.im.message.create({
          params: {
            receive_id_type: receiveIdType,
          },
          data: {
            receive_id: receiveId,
            msg_type: "image",
            content,
          },
        }),
      "sendImageMessage",
    );

    if (response?.data?.message_id) {
      return { ok: true, messageId: response.data.message_id };
    }

    return { ok: false, error: "No message_id in response" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Upload an image and get image_key with retry support
 */
export async function uploadImage(
  client: LarkClient,
  imageBuffer: Buffer,
): Promise<{ ok: boolean; imageKey?: string; error?: string }> {
  try {
    const response = await withRetry(
      () =>
        client.im.image.create({
          data: {
            image_type: "message",
            // Create fresh stream on each retry (streams can only be consumed once)
            image: Readable.from(imageBuffer),
          },
        }),
      "uploadImage",
    );

    // The response type from SDK may vary, handle both shapes
    const data = response as unknown as
      | { data?: { image_key?: string }; image_key?: string }
      | undefined;
    const imageKey =
      (data as { data?: { image_key?: string } } | undefined)?.data?.image_key ??
      (data as { image_key?: string } | undefined)?.image_key;

    if (imageKey) {
      return { ok: true, imageKey };
    }

    return { ok: false, error: "No image_key in response" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Upload a file and get file_key with retry support
 */
export async function uploadFile(
  client: LarkClient,
  fileBuffer: Buffer,
  fileName: string,
  fileType: "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream",
): Promise<{ ok: boolean; fileKey?: string; error?: string }> {
  try {
    const response = await withRetry(
      () =>
        client.im.file.create({
          data: {
            file_type: fileType,
            file_name: fileName,
            // Create fresh stream on each retry (streams can only be consumed once)
            file: Readable.from(fileBuffer),
          },
        }),
      "uploadFile",
    );

    // The response type from SDK may vary, handle both shapes
    const data = response as unknown as
      | { data?: { file_key?: string }; file_key?: string }
      | undefined;
    const fileKey =
      (data as { data?: { file_key?: string } } | undefined)?.data?.file_key ??
      (data as { file_key?: string } | undefined)?.file_key;

    if (fileKey) {
      return { ok: true, fileKey };
    }

    return { ok: false, error: "No file_key in response" };
  } catch (err) {
    // Extract detailed error info from Lark SDK / Axios errors
    let errorDetail = err instanceof Error ? err.message : String(err);
    const axiosErr = err as { response?: { data?: { code?: number; msg?: string } } };
    if (axiosErr.response?.data) {
      const { code, msg } = axiosErr.response.data;
      errorDetail = `${errorDetail} (code: ${code}, msg: ${msg})`;
      console.error("[lark uploadFile] API error:", { code, msg, fileName, fileType });
    }
    return { ok: false, error: errorDetail };
  }
}

/**
 * Send a file message with retry support
 */
export async function sendFileMessage(
  client: LarkClient,
  receiveId: string,
  receiveIdType: "open_id" | "user_id" | "union_id" | "email" | "chat_id",
  fileKey: string,
): Promise<LarkSendResult> {
  try {
    const content = JSON.stringify({ file_key: fileKey });
    const response = await withRetry(
      () =>
        client.im.message.create({
          params: {
            receive_id_type: receiveIdType,
          },
          data: {
            receive_id: receiveId,
            msg_type: "file",
            content,
          },
        }),
      "sendFileMessage",
    );

    if (response?.data?.message_id) {
      return { ok: true, messageId: response.data.message_id };
    }

    return { ok: false, error: "No message_id in response" };
  } catch (err) {
    // Extract detailed error info from Lark SDK / Axios errors
    let errorDetail = err instanceof Error ? err.message : String(err);
    const axiosErr = err as { response?: { data?: { code?: number; msg?: string } } };
    if (axiosErr.response?.data) {
      const { code, msg } = axiosErr.response.data;
      errorDetail = `${errorDetail} (code: ${code}, msg: ${msg})`;
      console.error("[lark sendFileMessage] API error:", { code, msg, receiveId, receiveIdType, fileKey });
    }
    return { ok: false, error: errorDetail };
  }
}

/**
 * Send an audio message with retry support
 */
export async function sendAudioMessage(
  client: LarkClient,
  receiveId: string,
  receiveIdType: "open_id" | "user_id" | "union_id" | "email" | "chat_id",
  fileKey: string,
): Promise<LarkSendResult> {
  try {
    const content = JSON.stringify({ file_key: fileKey });
    const response = await withRetry(
      () =>
        client.im.message.create({
          params: {
            receive_id_type: receiveIdType,
          },
          data: {
            receive_id: receiveId,
            msg_type: "audio",
            content,
          },
        }),
      "sendAudioMessage",
    );

    if (response?.data?.message_id) {
      return { ok: true, messageId: response.data.message_id };
    }

    return { ok: false, error: "No message_id in response" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Reply to a message
 */
export async function replyToMessage(
  client: LarkClient,
  messageId: string,
  text: string,
): Promise<LarkSendResult> {
  try {
    const content = JSON.stringify({ text });
    const response = await client.im.message.reply({
      path: {
        message_id: messageId,
      },
      data: {
        msg_type: "text",
        content,
      },
    });

    if (response?.data?.message_id) {
      return { ok: true, messageId: response.data.message_id };
    }

    return { ok: false, error: "No message_id in response" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Send an interactive card message with retry support
 */
export async function sendCardMessage(
  client: LarkClient,
  receiveId: string,
  receiveIdType: "open_id" | "user_id" | "union_id" | "email" | "chat_id",
  card: LarkCard,
  replyToId?: string,
): Promise<LarkSendResult> {
  try {
    // Build the card content in the format Lark expects
    const cardContent = JSON.stringify(card);

    // Use reply API if replyToId is provided
    if (replyToId) {
      const response = await withRetry(
        () =>
          client.im.message.reply({
            path: {
              message_id: replyToId,
            },
            data: {
              msg_type: "interactive",
              content: cardContent,
            },
          }),
        "sendCardMessage.reply",
      );

      if (response?.data?.message_id) {
        return { ok: true, messageId: response.data.message_id };
      }

      return { ok: false, error: "No message_id in response" };
    }

    // Send new card message
    const response = await withRetry(
      () =>
        client.im.message.create({
          params: {
            receive_id_type: receiveIdType,
          },
          data: {
            receive_id: receiveId,
            msg_type: "interactive",
            content: cardContent,
          },
        }),
      "sendCardMessage.create",
    );

    if (response?.data?.message_id) {
      return { ok: true, messageId: response.data.message_id };
    }

    return { ok: false, error: "No message_id in response" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Download a message resource (audio, video, image, file) with retry support
 * This is used to download resources sent by users (not uploaded by bot)
 *
 * Note: Lark API only accepts "image" or "file" as type parameter.
 * Audio and video should use "file" type.
 */
export async function downloadMessageResource(
  client: LarkClient,
  messageId: string,
  fileKey: string,
  resourceType: "image" | "file" | "audio" | "video",
): Promise<{ ok: boolean; buffer?: Buffer; error?: string }> {
  // Map resource types to Lark API types (only "image" and "file" are valid)
  const apiType = resourceType === "image" ? "image" : "file";

  try {
    const response = await withRetry(
      () =>
        client.im.messageResource.get({
          params: {
            type: apiType,
          },
          path: {
            message_id: messageId,
            file_key: fileKey,
          },
        }),
      "downloadMessageResource",
    );

    // Read stream to buffer
    const stream = response.getReadableStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);

    return { ok: true, buffer };
  } catch (err) {
    // Extract detailed error info from Lark SDK / Axios errors
    let errorDetail = err instanceof Error ? err.message : String(err);
    const axiosErr = err as { response?: { data?: { code?: number; msg?: string } } };
    if (axiosErr.response?.data) {
      const { code, msg } = axiosErr.response.data;
      errorDetail = `${errorDetail} (code: ${code}, msg: ${msg})`;
      console.error("[lark downloadMessageResource] API error:", {
        code,
        msg,
        messageId,
        fileKey,
        resourceType,
      });
    }
    return { ok: false, error: errorDetail };
  }
}

// Re-export EventDispatcher for monitor usage
export const EventDispatcher = lark.EventDispatcher;
export const LoggerLevel = lark.LoggerLevel;
