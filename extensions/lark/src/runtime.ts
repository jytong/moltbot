import type { PluginRuntime } from "clawdbot/plugin-sdk";

let runtimeEnv: PluginRuntime;

export function setLarkRuntime(runtime: PluginRuntime): void {
  runtimeEnv = runtime;
}

export function getLarkRuntime(): PluginRuntime {
  if (!runtimeEnv) {
    throw new Error("Lark runtime not initialized");
  }
  return runtimeEnv;
}
