import { createLarkClient, getBotInfo } from "./api.js";
import type { LarkProbeResult } from "./types.js";

/**
 * Probe Lark API to check connectivity and get bot info
 */
export async function probeLark(
  appId: string,
  appSecret: string,
  timeoutMs = 5000,
): Promise<LarkProbeResult> {
  if (!appId?.trim() || !appSecret?.trim()) {
    return { ok: false, error: "Missing credentials" };
  }

  const start = Date.now();

  try {
    const client = createLarkClient(appId, appSecret);

    // Race against timeout
    const botInfoPromise = getBotInfo(client);
    const timeoutPromise = new Promise<null>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), timeoutMs),
    );

    const botInfo = await Promise.race([botInfoPromise, timeoutPromise]);
    const latencyMs = Date.now() - start;

    if (botInfo) {
      return {
        ok: true,
        bot: botInfo,
        latencyMs,
      };
    }

    return {
      ok: true,
      latencyMs,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - start,
    };
  }
}
