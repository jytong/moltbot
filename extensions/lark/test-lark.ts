#!/usr/bin/env npx tsx
/**
 * 飞书渠道通讯测试脚本 - 消息监听与自动回复
 *
 * 使用方法:
 * 1. 设置环境变量:
 *    export LARK_APP_ID=cli_xxxx
 *    export LARK_APP_SECRET=xxxx
 *
 * 2. 运行: npx tsx extensions/lark/test-lark.ts
 *
 * 功能:
 * - 启动 WebSocket 长连接监听消息
 * - 收到消息后自动回复确认信息
 * - Ctrl+C 退出
 */

import * as lark from "@larksuiteoapi/node-sdk";

// ==================== 配置区域 ====================
const CONFIG = {
  appId: process.env.LARK_APP_ID || "YOUR_APP_ID",
  appSecret: process.env.LARK_APP_SECRET || "YOUR_APP_SECRET",
};
// ==================================================

// 创建 API 客户端
const client = new lark.Client({
  appId: CONFIG.appId,
  appSecret: CONFIG.appSecret,
  disableTokenCache: false,
});

// 消息事件类型
type LarkMessageEvent = {
  sender: {
    sender_id: {
      open_id?: string;
      user_id?: string;
      union_id?: string;
    };
    sender_type?: string;
  };
  message: {
    message_id: string;
    chat_id: string;
    chat_type: "p2p" | "group";
    message_type: string;
    content: string;
    create_time?: string;
    mentions?: Array<{
      key: string;
      id: { open_id?: string; user_id?: string };
      name: string;
    }>;
  };
};

/**
 * 解析消息内容
 */
function parseMessageContent(msgType: string, content: string): string {
  try {
    const parsed = JSON.parse(content);
    if (msgType === "text") {
      return parsed.text || "";
    }
    if (msgType === "image") {
      return "[图片消息]";
    }
    if (msgType === "post") {
      // 富文本消息 - 提取纯文本
      const extractText = (node: unknown): string => {
        if (!node || typeof node !== "object") return "";
        const n = node as Record<string, unknown>;
        if (n.tag === "text" && typeof n.text === "string") return n.text;
        if (Array.isArray(n.content)) {
          return n.content
            .map((row) => (Array.isArray(row) ? row.map(extractText).join("") : ""))
            .join("\n");
        }
        return "";
      };
      return extractText(parsed) || "[富文本消息]";
    }
    return `[${msgType}消息]`;
  } catch {
    return content;
  }
}

/**
 * 发送回复消息
 */
async function sendReply(chatId: string, text: string): Promise<boolean> {
  try {
    const response = await client.im.message.create({
      params: {
        receive_id_type: "chat_id",
      },
      data: {
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      },
    });

    return Boolean(response?.data?.message_id);
  } catch (err) {
    console.error("发送回复失败:", err);
    return false;
  }
}

/**
 * 处理收到的消息
 */
async function handleMessage(event: LarkMessageEvent): Promise<void> {
  const { sender, message } = event;
  const senderId = sender.sender_id.open_id || sender.sender_id.user_id || "未知用户";
  const chatId = message.chat_id;
  const chatType = message.chat_type === "p2p" ? "私聊" : "群聊";
  const messageContent = parseMessageContent(message.message_type, message.content);

  // 打印收到的消息
  console.log("\n" + "─".repeat(50));
  console.log(`📩 收到${chatType}消息`);
  console.log(`   发送者 ID: ${senderId}`);
  console.log(`   Chat ID: ${chatId}`);
  console.log(`   消息类型: ${message.message_type}`);
  console.log(`   消息内容: ${messageContent}`);
  console.log(`   时间: ${new Date().toLocaleString("zh-CN")}`);

  // 构建回复消息
  const replyText = [
    `✅ 收到了用户 ${senderId} 发来的消息：`,
    ``,
    `「${messageContent}」`,
    ``,
    `---`,
    `消息ID: ${message.message_id}`,
    `聊天类型: ${chatType}`,
    `处理时间: ${new Date().toLocaleString("zh-CN")}`,
  ].join("\n");

  // 发送回复
  console.log("\n📤 发送回复...");
  const success = await sendReply(chatId, replyText);
  if (success) {
    console.log("✅ 回复发送成功!");
  } else {
    console.log("❌ 回复发送失败!");
  }
}

/**
 * 获取机器人信息
 */
async function getBotInfo(): Promise<{ name?: string; openId?: string } | null> {
  try {
    const response = (await client.request({
      method: "GET",
      url: "/open-apis/bot/v3/info",
    })) as { code?: number; msg?: string; bot?: { app_name?: string; open_id?: string } };

    if (response?.bot) {
      return {
        name: response.bot.app_name,
        openId: response.bot.open_id,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 主函数 - 启动消息监听
 */
async function main() {
  console.log("═".repeat(50));
  console.log("🤖 飞书机器人消息监听测试");
  console.log("═".repeat(50));

  // 检查配置
  if (CONFIG.appId === "YOUR_APP_ID" || CONFIG.appSecret === "YOUR_APP_SECRET") {
    console.log("\n❌ 请先配置 App ID 和 App Secret!");
    console.log("");
    console.log("方式1: 设置环境变量");
    console.log("  export LARK_APP_ID=cli_xxxx");
    console.log("  export LARK_APP_SECRET=xxxx");
    console.log("");
    console.log("方式2: 直接修改脚本中的 CONFIG 对象");
    process.exit(1);
  }

  console.log("\n📋 配置信息:");
  console.log(`   App ID: ${CONFIG.appId}`);

  // 获取机器人信息
  console.log("\n🔍 获取机器人信息...");
  const botInfo = await getBotInfo();
  if (botInfo) {
    console.log(`   ✅ 机器人名称: ${botInfo.name}`);
    console.log(`   ✅ Open ID: ${botInfo.openId}`);
  } else {
    console.log("   ⚠️  无法获取机器人信息，请检查 App ID 和 App Secret");
    process.exit(1);
  }

  // 创建 WebSocket 客户端
  console.log("\n🔌 启动 WebSocket 连接...");

  const wsClient = new lark.WSClient({
    appId: CONFIG.appId,
    appSecret: CONFIG.appSecret,
    loggerLevel: lark.LoggerLevel.error,
  });

  // 创建事件分发器
  const eventDispatcher = new lark.EventDispatcher({}).register({
    "im.message.receive_v1": async (data: unknown) => {
      try {
        await handleMessage(data as LarkMessageEvent);
      } catch (err) {
        console.error("处理消息时出错:", err);
      }
    },
  });

  // 启动 WebSocket
  void wsClient.start({ eventDispatcher });

  console.log("✅ WebSocket 连接已启动!");
  console.log("");
  console.log("═".repeat(50));
  console.log("📡 正在监听消息... (Ctrl+C 退出)");
  console.log("═".repeat(50));
  console.log("");
  console.log("请在飞书中向机器人发送消息进行测试:");
  console.log("  - 私聊: 直接给机器人发消息");
  console.log("  - 群聊: 在群中 @机器人 发消息");
  console.log("");

  // 保持进程运行
  process.on("SIGINT", () => {
    console.log("\n\n👋 正在退出...");
    process.exit(0);
  });

  // 保持进程存活
  await new Promise(() => {});
}

// 运行主函数
main().catch((err) => {
  console.error("程序执行失败:", err);
  process.exit(1);
});
