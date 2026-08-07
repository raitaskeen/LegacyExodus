import { Command } from "commander";

import { createApplicationRuntime } from "@runtime/application";

const packageVersion = "0.1.0";

export async function runCli(argumentsToParse: string[] = process.argv): Promise<void> {
  const program = new Command();

  program
    .name("legacy-exodus")
    .description("LegacyExodus deterministic modernization core")
    .version(packageVersion)
    .command("status")
    .description("Report the runtime status")
    .action(async (): Promise<void> => {
      const runtime = createApplicationRuntime();

      await runtime.start();
      process.stdout.write(
        `${JSON.stringify({ name: "LegacyExodus Core", status: "initialized" })}\n`,
      );
      await runtime.shutdown();
    });

  await program.parseAsync(argumentsToParse);
}

void runCli().catch((error: unknown): void => {
  const message = error instanceof Error ? error.message : "Unexpected runtime failure.";

  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
