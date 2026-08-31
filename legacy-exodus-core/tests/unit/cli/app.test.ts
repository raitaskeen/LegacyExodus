import { describe, expect, test } from "bun:test";

import { CLI_VERSION, createCLI } from "@cli/app";

describe("CLI application", () => {
  test("creates a command router with core metadata", (): void => {
    const cli = createCLI();

    expect(cli.name()).toBe("legacy-exodus");
    expect(cli.version()).toBe(CLI_VERSION);
    expect(cli.commands.map((command) => command.name())).toEqual([
      "status",
      "init",
      "plugins",
      "analyze",
      "test",
      "verify",
    ]);
  });
});
