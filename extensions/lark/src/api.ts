import * as lark from "@larksuiteoapi/node-sdk";

import type { LarkBotInfo, LarkSendResult } from "./types.js";

export type LarkClient = lark.Client;
export type LarkWSClient = lark.WSClient;

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
 * Send a text message
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
    const response = await client.im.message.create({
      params: {
        receive_id_type: receiveIdType,
      },
      data: {
        receive_id: receiveId,
        msg_type: "text",
        content,
        ...(replyToId ? { reply_in_thread: false } : {}),
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
 * Send an image message
 */
export async function sendImageMessage(
  client: LarkClient,
  receiveId: string,
  receiveIdType: "open_id" | "user_id" | "union_id" | "email" | "chat_id",
  imageKey: string,
): Promise<LarkSendResult> {
  try {
    const content = JSON.stringify({ image_key: imageKey });
    const response = await client.im.message.create({
      params: {
        receive_id_type: receiveIdType,
      },
      data: {
        receive_id: receiveId,
        msg_type: "image",
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
 * Upload an image and get image_key
 */
export async function uploadImage(
  client: LarkClient,
  imageBuffer: Buffer,
): Promise<{ ok: boolean; imageKey?: string; error?: string }> {
  try {
    const response = await client.im.image.create({
      data: {
        image_type: "message",
        image: imageBuffer,
      },
    });

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

// Re-export EventDispatcher for monitor usage
export const EventDispatcher = lark.EventDispatcher;
export const LoggerLevel = lark.LoggerLevel;
