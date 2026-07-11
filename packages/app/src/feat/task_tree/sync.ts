// sync

import { createCollection, localStorageCollectionOptions } from "@tanstack/solid-db";
import { z } from "zod";

export const taskGroupExpandCollection = createCollection(
  localStorageCollectionOptions({
    id: 'task-group-expand',
    schema: z.object({
      id: z.string(),
    }),
    storageKey: 'localdub_task_group_expand',
    getKey: (item) => item.id,
  })
);

