import { describe, expect, it, mock } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { analyzeProject } from "@cli/commands/analyze";
import { initializeWorkspace } from "@cli/commands/init";
import {
  CliError,
  UnexpectedEngineResultError,
  toCliErrorResponse,
  writeCliError,
} from "@cli/errors";
import { ConfigurationError, LegacyExodusError } from "@shared/errors";
import type { LegacyExodusEngine } from "@core/engine";

describe("CLI Error Contracts & Error-Path Behavioral Hardening", () => {
  // ─── Error Classification & Response Mapping ──────────────────────────────
  describe("toCliErrorResponse", () => {
    it("maps CliError to code and user message", () => {
      const error = new CliError("WORKSPACE_NOT_FOUND", "The target path does not exist.");
      const response = toCliErrorResponse(error);

      expect(error.name).toBe("CliError");
      expect(response.code).toBe("WORKSPACE_NOT_FOUND");
      expect(response.message).toBe("The target path does not exist.");
    });

    it("maps ConfigurationError to CONFIG_INVALID code", () => {
      const error = new ConfigurationError("Missing required key");
      const response = toCliErrorResponse(error);

      expect(response.code).toBe("CONFIG_INVALID");
      expect(response.message).toBe("Invalid LegacyExodus configuration.");
    });

    it("maps LegacyExodusError to its specific error code", () => {
      const error = new LegacyExodusError({
        code: "DISCOVERY_RECORD_INVALID",
        message: "Internal corruption details",
        metadata: { recordId: "rec-123" },
      });
      const response = toCliErrorResponse(error);

      expect(response.code).toBe("DISCOVERY_RECORD_INVALID");
      expect(response.message).toBe("LegacyExodus could not complete the requested operation.");
    });

    it("maps UnexpectedEngineResultError with structured metadata", () => {
      const error = new UnexpectedEngineResultError("AnalyzeProject", "InitWorkspace");
      const response = toCliErrorResponse(error);

      expect(error.name).toBe("UnexpectedEngineResultError");
      expect(error.code).toBe("CLI_ENGINE_RESULT_INVALID");
      expect(error.metadata).toEqual({ expectedType: "AnalyzeProject", actualType: "InitWorkspace" });
      expect(response.code).toBe("CLI_ENGINE_RESULT_INVALID");
      expect(response.message).toBe("LegacyExodus could not complete the requested operation.");
    });

    it("maps standard Error to CLI_UNEXPECTED_ERROR fallback without stack trace leakage", () => {
      const error = new Error("Database disk I/O failure at /private/var/db");
      const response = toCliErrorResponse(error);

      expect(response.code).toBe("CLI_UNEXPECTED_ERROR");
      expect(response.message).toBe("LegacyExodus encountered an unexpected error.");
    });

    it("maps non-Error objects and primitives to CLI_UNEXPECTED_ERROR", () => {
      expect(toCliErrorResponse("string error")).toEqual({
        code: "CLI_UNEXPECTED_ERROR",
        message: "LegacyExodus encountered an unexpected error.",
      });
      expect(toCliErrorResponse(null)).toEqual({
        code: "CLI_UNEXPECTED_ERROR",
        message: "LegacyExodus encountered an unexpected error.",
      });
      expect(toCliErrorResponse(undefined)).toEqual({
        code: "CLI_UNEXPECTED_ERROR",
        message: "LegacyExodus encountered an unexpected error.",
      });
      expect(toCliErrorResponse(404)).toEqual({
        code: "CLI_UNEXPECTED_ERROR",
        message: "LegacyExodus encountered an unexpected error.",
      });
    });
  });

  // ─── Stderr Writing ───────────────────────────────────────────────────────
  describe("writeCliError", () => {
    it("writes formatted message and code to process.stderr", () => {
      let writtenData = "";
      const originalWrite = process.stderr.write;
      process.stderr.write = ((chunk: string | Uint8Array) => {
        writtenData += chunk.toString();
        return true;
      }) as any;

      try {
        const error = new CliError("TEST_CLI_CODE", "Something failed in CLI.");
        writeCliError(error);

        expect(writtenData).toContain("TEST_CLI_CODE");
        expect(writtenData).toContain("Something failed in CLI.");
      } finally {
        process.stderr.write = originalWrite;
      }
    });

    it("writes plain error format to a plain stream", () => {
      let writtenData = "";
      const mockStream = {
        isTTY: false,
        write: (chunk: string) => {
          writtenData += chunk;
          return true;
        },
      } as unknown as NodeJS.WriteStream;

      const error = new CliError("TEST_CLI_CODE", "Something failed in CLI.");
      writeCliError(error, mockStream);

      expect(writtenData).toBe("Error: Something failed in CLI.\nCode: TEST_CLI_CODE\n");
    });
  });

  // ─── ErrorPresenter Formatting & Remediation Tests ────────────────────────
  describe("ErrorPresenter", () => {
    it("renders compact plain output for DISCOVERY_PATH_NOT_FOUND with remediation", async () => {
      const { ErrorPresenter } = await import("@cli/presentation/errors");
      const presenter = new ErrorPresenter({
        isTTY: false,
        isCI: false,
        noColor: true,
        isUnicodeSupported: false,
        width: 80,
        mode: "plain",
        theme: "mono",
      });

      const error = new LegacyExodusError({
        code: "DISCOVERY_PATH_NOT_FOUND",
        message: "The requested discovery path does not exist.",
      });

      const output = presenter.renderError(error);
      expect(output).toContain("Error: The requested discovery path does not exist.");
      expect(output).toContain("Code: DISCOVERY_PATH_NOT_FOUND");
      expect(output).toContain("Remediation: Verify the target project path exists and has read permissions.");
    });

    it("renders interactive card layout with hints and banners for WORKSPACE_ALREADY_INITIALIZED", async () => {
      const { ErrorPresenter } = await import("@cli/presentation/errors");
      const presenter = new ErrorPresenter({
        isTTY: true,
        isCI: false,
        noColor: false,
        isUnicodeSupported: true,
        width: 80,
        mode: "interactive",
        theme: "classic",
      });

      const error = new CliError("WORKSPACE_ALREADY_INITIALIZED", "This workspace is already initialized.");
      const output = presenter.renderError(error);

      expect(output).toContain("WORKSPACE_ALREADY_INITIALIZED");
      expect(output).toContain("This workspace is already initialized.");
      expect(output).toContain("Hint");
      expect(output).toContain("To reinitialize, remove the existing .legacy-exodus directory first.");
      expect(output).toContain("Operation failed");
    });

    it("renders CONFIG_INVALID with configuration context and remediation hint", async () => {
      const { ErrorPresenter } = await import("@cli/presentation/errors");
      const presenter = new ErrorPresenter({
        isTTY: false,
        isCI: true,
        noColor: true,
        isUnicodeSupported: false,
        width: 80,
        mode: "ci",
        theme: "mono",
      });

      const error = new ConfigurationError("Missing database file path.");
      const output = presenter.renderError(error);

      expect(output).toContain("Error: Missing database file path.");
      expect(output).toContain("Code: CONFIG_INVALID");
      expect(output).toContain("Remediation: Verify environment variables and configuration files.");
    });
  });

  // ─── Analyze Command Error Handling & Lifecycle Cleanup ───────────────────
  describe("analyzeProject error paths", () => {
    it("throws UnexpectedEngineResultError and shuts down engine when wrong result type is returned", async () => {
      let shutdownCalled = false;
      const mockEngine = {
        initialize: mock(async () => {}),
        resolveProjectId: mock(async () => "00000000-0000-4000-8000-000000000000"),
        execute: mock(async () => ({ type: "OtherResult" })),
        shutdown: mock(async () => {
          shutdownCalled = true;
        }),
      } as unknown as LegacyExodusEngine;

      await expect(analyzeProject("some/path", () => mockEngine)).rejects.toThrow(
        UnexpectedEngineResultError,
      );
      expect(shutdownCalled).toBe(true);
    });

    it("propagates engine execution error and always shuts down engine in finally block", async () => {
      let shutdownCalled = false;
      const mockEngine = {
        initialize: mock(async () => {}),
        resolveProjectId: mock(async () => "00000000-0000-4000-8000-000000000000"),
        execute: mock(async () => {
          throw new LegacyExodusError({ code: "DISCOVERY_FAILED", message: "Scan failed" });
        }),
        shutdown: mock(async () => {
          shutdownCalled = true;
        }),
      } as unknown as LegacyExodusEngine;

      await expect(analyzeProject("some/path", () => mockEngine)).rejects.toThrow(
        LegacyExodusError,
      );
      expect(shutdownCalled).toBe(true);
    });
  });

  // ─── Workspace Init Error Paths ──────────────────────────────────────────
  describe("initializeWorkspace error paths", () => {
    it("throws WORKSPACE_NOT_FOUND when target path does not exist", async () => {
      const nonExistentPath = join(tmpdir(), `non-existent-workspace-${Date.now()}`);
      await expect(initializeWorkspace(nonExistentPath, "1.0.0")).rejects.toThrow(
        new CliError("WORKSPACE_NOT_FOUND", "The initialization path does not exist."),
      );
    });

    it("throws WORKSPACE_INVALID when target path is a file instead of a directory", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "cli-test-file-"));
      const filePath = join(tempDir, "regular-file.txt");
      await writeFile(filePath, "hello", "utf8");

      try {
        await expect(initializeWorkspace(filePath, "1.0.0")).rejects.toThrow(
          new CliError("WORKSPACE_INVALID", "The initialization path must be a directory."),
        );
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it("throws WORKSPACE_ALREADY_INITIALIZED when workspace metadata file already exists", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "cli-test-init-"));

      try {
        await initializeWorkspace(tempDir, "1.0.0");
        await expect(initializeWorkspace(tempDir, "1.0.0")).rejects.toThrow(
          new CliError("WORKSPACE_ALREADY_INITIALIZED", "This workspace is already initialized."),
        );
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });
});
