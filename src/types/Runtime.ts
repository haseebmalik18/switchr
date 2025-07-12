export type RuntimeType = 'nodejs' | 'python' | 'go' | 'java' | 'rust' | 'php';

export interface RuntimeVersion {
  version: string;
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
  build?: string;
}

export interface RuntimeEnvironment {
  type: RuntimeType;
  version: string;
  path: string;
  binPath: string;
  envVars: Record<string, string>;
  isActive: boolean;
  installedAt?: Date;
}

export interface RuntimeInstallOptions {
  version: string;
  projectPath: string;
  global?: boolean;
  skipIfExists?: boolean;
  env?: Record<string, string>;
}

export interface RuntimeManagerConfig {
  cacheDir: string;
  projectPath: string;
  preferredManager?: string;
  timeout?: number;
  retries?: number;
}

export interface VersionManagerInfo {
  name: string;
  command: string;
  available: boolean;
  version?: string;
  priority: number;
}
