import { z } from "zod";

import { LegacyExodusError } from "@shared/errors";

export interface Command<Payload, Type extends string> {
  readonly id: string;
  readonly type: Type;
  readonly createdAt: Date;
  readonly payload: Readonly<Payload>;
}

export interface InitializeProjectPayload {
  readonly projectId: string;
  readonly name: string;
}

export interface DiscoverProjectPayload {
  readonly projectId: string;
  readonly fileId: string;
  readonly path: string;
  readonly language: string;
}

export interface UpdateKnowledgePayload {
  readonly projectId: string;
  readonly artifactId: string;
}

export type InitializeProjectCommand = Command<InitializeProjectPayload, "InitializeProject">;
export type DiscoverProjectCommand = Command<DiscoverProjectPayload, "DiscoverProject">;
export type UpdateKnowledgeCommand = Command<UpdateKnowledgePayload, "UpdateKnowledge">;

export type LegacyExodusCommand =
  | InitializeProjectCommand
  | DiscoverProjectCommand
  | UpdateKnowledgeCommand;

const commandBaseSchema = {
  id: z.string().uuid(),
  createdAt: z.date(),
};

export const commandSchema = z.discriminatedUnion("type", [
  z.object({
    ...commandBaseSchema,
    type: z.literal("InitializeProject"),
    payload: z.object({
      projectId: z.string().uuid(),
      name: z.string().trim().min(1),
    }),
  }),
  z.object({
    ...commandBaseSchema,
    type: z.literal("DiscoverProject"),
    payload: z.object({
      projectId: z.string().uuid(),
      fileId: z.string().uuid(),
      path: z.string().trim().min(1),
      language: z.string().trim().min(1),
    }),
  }),
  z.object({
    ...commandBaseSchema,
    type: z.literal("UpdateKnowledge"),
    payload: z.object({
      projectId: z.string().uuid(),
      artifactId: z.string().uuid(),
    }),
  }),
]);

export function validateCommand(command: unknown): LegacyExodusCommand {
  const parsedCommand = commandSchema.safeParse(command);

  if (!parsedCommand.success) {
    throw new LegacyExodusError({
      code: "COMMAND_INVALID",
      message: "Command is invalid.",
      metadata: { issues: parsedCommand.error.issues },
    });
  }

  return parsedCommand.data;
}
