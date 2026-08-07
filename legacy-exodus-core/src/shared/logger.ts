import pino, { type Logger } from "pino";

import type { RuntimeConfig } from "@runtime/config";

export function createLogger(config: RuntimeConfig, component: string): Logger {
  return pino(
    {
      base: undefined,
      level: config.logLevel,
      messageKey: "message",
      timestamp: false,
    },
    pino.destination(2),
  ).child({ component });
}
