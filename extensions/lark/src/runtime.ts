import type { RuntimeEnv } from "clawdbot/plugin-sdk";

let runtimeEnv: RuntimeEnv;

export function setLarkRuntime(runtime: RuntimeEnv): void {
  runtimeEnv = runtime;
}

export function getLarkRuntime(): RuntimeEnv {
  if (!runtimeEnv) {
    throw new Error("Lark runtime not initialized");
  }
  return runtimeEnv;
}
