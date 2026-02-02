/**
 * Capability scope for features like cards
 */
export type LarkCapabilityScope = "off" | "dm" | "group" | "all" | "allowlist";

/**
 * Lark capabilities configuration
 */
export type LarkCapabilities = {
  cards?: LarkCapabilityScope;
};

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
  capabilities?: LarkCapabilities;
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
 * Lark card header template colors
 */
export type LarkCardTemplateColor =
  | "blue"
  | "wathet"
  | "turquoise"
  | "green"
  | "yellow"
  | "orange"
  | "red"
  | "carmine"
  | "violet"
  | "purple"
  | "indigo"
  | "grey";

/**
 * Lark card text element
 */
export type LarkCardText = {
  tag: "plain_text" | "lark_md";
  content: string;
  lines?: number;
};

/**
 * Lark card header
 */
export type LarkCardHeader = {
  title: LarkCardText;
  subtitle?: LarkCardText;
  template?: LarkCardTemplateColor;
};

/**
 * Lark card button
 */
export type LarkCardButton = {
  tag: "button";
  text: LarkCardText;
  type?: "default" | "primary" | "danger";
  value?: Record<string, unknown>;
  url?: string;
  multi_url?: {
    url?: string;
    pc_url?: string;
    ios_url?: string;
    android_url?: string;
  };
  confirm?: {
    title: LarkCardText;
    text: LarkCardText;
  };
};

/**
 * Lark card action element
 */
export type LarkCardAction = {
  tag: "action";
  actions: LarkCardButton[];
  layout?: "bisected" | "trisection" | "flow";
};

/**
 * Lark card div element
 */
export type LarkCardDiv = {
  tag: "div";
  text?: LarkCardText;
  fields?: Array<{
    is_short?: boolean;
    text: LarkCardText;
  }>;
  extra?: LarkCardButton;
};

/**
 * Lark card image element
 */
export type LarkCardImage = {
  tag: "img";
  img_key: string;
  alt: LarkCardText;
  title?: LarkCardText;
  mode?: "crop_center" | "fit_horizontal";
  preview?: boolean;
};

/**
 * Lark card note element
 */
export type LarkCardNote = {
  tag: "note";
  elements: Array<LarkCardText | { tag: "img"; img_key: string; alt: LarkCardText }>;
};

/**
 * Lark card hr element
 */
export type LarkCardHr = {
  tag: "hr";
};

/**
 * Lark card column
 */
export type LarkCardColumn = {
  tag: "column";
  width?: "weighted" | "auto";
  weight?: number;
  vertical_align?: "top" | "center" | "bottom";
  elements: LarkCardElement[];
};

/**
 * Lark card column set element
 */
export type LarkCardColumnSet = {
  tag: "column_set";
  flex_mode?: "none" | "stretch" | "flow" | "bisect" | "trisect";
  background_style?: "default" | "grey";
  horizontal_spacing?: "default" | "small";
  columns: LarkCardColumn[];
};

/**
 * Lark card element (union type)
 */
export type LarkCardElement =
  | LarkCardDiv
  | LarkCardAction
  | LarkCardImage
  | LarkCardNote
  | LarkCardHr
  | LarkCardColumnSet;

/**
 * Lark interactive card
 */
export type LarkCard = {
  header?: LarkCardHeader;
  elements: LarkCardElement[];
  config?: {
    wide_screen_mode?: boolean;
    enable_forward?: boolean;
    update_multi?: boolean;
  };
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
  card?: LarkCard;
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

