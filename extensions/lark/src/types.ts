/**
 * Lark account configuration (single account)
 */
export type LarkAccountConfig = {
  name?: string;
  enabled?: boolean;
  appId?: string;
  appSecret?: string;
  encryptKey?: string;
  verificationToken?: string;
  dmPolicy?: "pairing" | "allowlist" | "open" | "disabled";
  allowFrom?: Array<string | number>;
  groups?: Record<string, LarkGroupConfig>;
  textChunkLimit?: number;
  mediaMaxMb?: number;
};

/**
 * Lark group configuration
 */
export type LarkGroupConfig = {
  enabled?: boolean;
  requireMention?: boolean;
  autoReply?: boolean;
  users?: Array<string | number>;
};

/**
 * Full Lark channel configuration
 */
export type LarkConfig = LarkAccountConfig & {
  accounts?: Record<string, LarkAccountConfig>;
  defaultAccount?: string;
};

/**
 * Resolved Lark account (after merging config)
 */
export type ResolvedLarkAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  appId: string;
  appSecret: string;
  encryptKey?: string;
  verificationToken?: string;
  credentialSource: "config" | "env" | "file" | "none";
  config: LarkAccountConfig;
};

/**
 * Lark message from API
 */
export type LarkMessage = {
  message_id: string;
  root_id?: string;
  parent_id?: string;
  create_time: string;
  chat_id: string;
  chat_type: "p2p" | "group";
  message_type: string;
  content: string;
  mentions?: LarkMention[];
};

/**
 * Lark mention in message
 */
export type LarkMention = {
  key: string;
  id: {
    union_id?: string;
    user_id?: string;
    open_id?: string;
  };
  name: string;
  tenant_key?: string;
};

/**
 * Lark sender info
 */
export type LarkSender = {
  sender_id: {
    union_id?: string;
    user_id?: string;
    open_id?: string;
  };
  sender_type: string;
  tenant_key?: string;
};

/**
 * Lark message event data
 */
export type LarkMessageEvent = {
  sender: LarkSender;
  message: LarkMessage;
};

/**
 * Lark bot info
 */
export type LarkBotInfo = {
  app_name?: string;
  open_id?: string;
};

/**
 * Lark send options
 */
export type LarkSendOptions = {
  appId?: string;
  appSecret?: string;
  accountId?: string;
  cfg?: unknown;
  mediaUrl?: string;
  caption?: string;
  replyToId?: string;
};

/**
 * Lark send result
 */
export type LarkSendResult = {
  ok: boolean;
  messageId?: string;
  error?: string;
};

/**
 * Lark probe result
 */
export type LarkProbeResult = {
  ok: boolean;
  bot?: LarkBotInfo;
  error?: string;
  latencyMs?: number;
};

