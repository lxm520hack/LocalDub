import { client } from '#/lib/rspc.ts';

export async function readInput(): Promise<string> {
  return client.query(['readInput', null]);
}

export async function writeInput(content: string): Promise<void> {
  await client.mutation(['writeInput', content]);
}

export async function readInputSchema(): Promise<string> {
  return client.query(['readInputSchema', null]);
}
