import type { MoltbotPluginApi } from "clawdbot/plugin-sdk";
import { emptyPluginConfigSchema } from "clawdbot/plugin-sdk";

import { larkDock, larkPlugin } from "./src/channel.js";
import { setLarkRuntime } from "./src/runtime.js";

const plugin = {
  id: "lark",
  name: "Lark",
  description: "Lark/Feishu channel plugin (Bot API)",
  configSchema: emptyPluginConfigSchema(),
  register(api: MoltbotPluginApi) {
    setLarkRuntime(api.runtime);
    api.registerChannel({ plugin: larkPlugin, dock: larkDock });
  },
};

export default plugin;
