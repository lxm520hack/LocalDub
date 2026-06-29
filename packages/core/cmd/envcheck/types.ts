export type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip' | 'info';
export type EnvCategory = 'core' | 'optional' | 'recommended' | 'windows-only';

export type CheckResult = {
  key: string;
  status: CheckStatus;
  message: string;
  detail?: string;
  hint?: string;
  required: boolean;
};
