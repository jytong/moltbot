import { MarkdownConfigSchema } from "clawdbot/plugin-sdk";
import { z } from "zod";

const allowFromEntry = z.union([z.string(), z.number()]);

const larkGroupSchema = z
  .object({
    enabled: z.boolean().optional(),
    requireMention: z.boolean().optional(),
    autoReply: z.boolean().optional(),
    users: z.array(allowFromEntry).optional(),
  })
  .optional();

// Capability scope for card messages
const capabilityScopeSchema = z.enum(["off", "dm", "group", "all", "allowlist"]).optional();

const larkCapabilitiesSchema = z
  .object({
    cards: capabilityScopeSchema,
  })
  .optional();

const larkAccountSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  markdown: MarkdownConfigSchema,
  appId: z.string().optional(),
  appSecret: z.string().optional(),
  encryptKey: z.string().optional(),
  verificationToken: z.string().optional(),
  dmPolicy: z.enum(["pairing", "allowlist", "open", "disabled"]).optional(),
  allowFrom: z.array(allowFromEntry).optional(),
  groups: z.object({}).catchall(larkGroupSchema).optional(),
  textChunkLimit: z.number().optional(),
  mediaMaxMb: z.number().optional(),
  capabilities: larkCapabilitiesSchema,
});

export const LarkConfigSchema = larkAccountSchema.extend({
  accounts: z.object({}).catchall(larkAccountSchema).optional(),
  defaultAccount: z.string().optional(),
});

export type LarkConfigSchemaType = z.infer<typeof LarkConfigSchema>;
