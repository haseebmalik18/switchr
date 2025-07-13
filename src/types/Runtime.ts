// src/types/Runtime.ts - Enhanced runtime types
export type RuntimeType = 'nodejs' | 'python' | 'go' | 'java' | 'rust' | 'php' | 'ruby' | 'dotnet';

export interface RuntimeVersion {
  version: string;
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
  build?: string;
  lts?: boolean;
}

export interface RuntimeEnvironment {
  type: RuntimeType;
  version: string;
  path: string;
  binPath: string;
  envVars: Record<string, string>;
  isActive: boolean;
  installedAt?: Date;
  manager?: string;
  packageManager?: string;
}

export interface RuntimeInstallOptions {
  version: string;
  projectPath: string;
  global?: boolean;
  skipIfExists?: boolean;
  env?: Record<string, string>;
  manager?: string; // Preferred version manager
}

export interface VersionManagerInfo {
  name: string;
  command: string;
  available: boolean;
  version?: string;
  priority: number;
  supportedRuntimes: RuntimeType[];
}

export interface RuntimeManagerConfig {
  cacheDir: string;
  projectPath: string;
  preferredManager?: string;
  timeout?: number;
  retries?: number;
}
