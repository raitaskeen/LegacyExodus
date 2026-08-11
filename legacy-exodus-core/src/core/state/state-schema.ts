import { z } from "zod";

import { LegacyExodusError } from "@shared/errors";

import {
  freezeProjectState,
  ProjectStatus,
  type ProjectState,
} from "./project-state";

const artifactSchema = z.object({
  id: z.string().uuid(),
  type: z.string().trim().min(1),
  createdAt: z.date(),
});

export const projectStateSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1),
    version: z.number().int().nonnegative(),
    status: z.nativeEnum(ProjectStatus),
    metadata: z.record(z.string(), z.string()),
    artifacts: z.record(z.string(), artifactSchema),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .superRefine((state, context): void => {
    if (state.updatedAt < state.createdAt) {
      context.addIssue({
        code: "custom",
        message: "updatedAt must not be earlier than createdAt.",
        path: ["updatedAt"],
      });
    }
  });

export function validateProjectState(state: unknown): ProjectState {
  const parsedState = projectStateSchema.safeParse(state);

  if (!parsedState.success) {
    throw new LegacyExodusError({
      code: "PROJECT_STATE_INVALID",
      message: "Project state is invalid.",
      metadata: { issues: parsedState.error.issues },
    });
  }

  return freezeProjectState(parsedState.data);
}
