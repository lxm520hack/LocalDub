import { createFileRoute } from '@tanstack/solid-router';
import { IndexPage } from '@repo/ui';
import { isTauri } from '@tauri-apps/api/core';

export const Route = createFileRoute('/')({
  component: () => <>
    <IndexPage />
    <span>isTauri: {String(isTauri())}</span>
  </>
  ,
});
