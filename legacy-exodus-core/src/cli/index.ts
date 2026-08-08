import { createCLI } from "./app";
import { writeCliError } from "./errors";

export async function runCli(argumentsToParse: string[] = process.argv): Promise<void> {
  await createCLI().parseAsync(argumentsToParse);
}

if (import.meta.main) {
  void runCli().catch((error: unknown): void => {
    writeCliError(error);
    process.exitCode = 1;
  });
}
