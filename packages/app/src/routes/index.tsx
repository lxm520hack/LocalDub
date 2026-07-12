import { IndexPage } from '#/components/pages/home/IndexPage.tsx';
import { createFileRoute } from '@tanstack/solid-router';
import { isTauri } from '@tauri-apps/api/core';

export const Route = createFileRoute('/')({
  component:  IndexPage
  ,
});
