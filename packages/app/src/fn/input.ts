import { invoke } from './invoke';

export async function readInput(): Promise<string> {
  return invoke<string>('read_input');
}

export async function writeInput(content: string): Promise<void> {
  return invoke('write_input', { content });
}

export async function readInputSchema(): Promise<string> {
  return invoke<string>('read_input_schema');
}
