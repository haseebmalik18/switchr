// src/types/Package.ts - Fixed with proper exports and license property
export type PackageType = 'runtime' | 'dependency' | 'service' | 'tool';

// Re-export RuntimeType from Runtime.ts for convenience
export type { RuntimeType } from './Runtime';

export interface PackageDefinition {
  name: string;
  version?: string;
  type: PackageType;
  runtime?: string;
  global?: boolean;
  optional?: boolean;
  devOnly?: boolean;
  description?: string;
  category?: string;
  registry?: string;
  license?: string; // Added license property
  keywords?: string[];
  repository?: string;
  homepage?: string;
  maintainers?: string[];
}

export interface RuntimePackage extends PackageDefinition {
  type: 'runtime';
  installPath?: string;
  binPath?: string;
  envVars?: Record<string, string>;
  manager?: string; // nvm, fnm, asdf, etc.
}

export interface ServicePackage extends PackageDefinition {
  type: 'service';
  template: string;
  config?: Record<string, unknown>;
  healthCheck?: string;
  dependencies?: string[];
  ports?: number[];
  image?: string;
  volumes?: string[];
}

export interface DependencyPackage extends PackageDefinition {
  type: 'dependency';
  runtime: string; // Required for dependencies
  packageManager?: string; // npm, pip, cargo, etc.
}

export interface PackageSearchResult extends PackageDefinition {
  downloads?: number;
  lastUpdated?: string;
  score?: number;
}

export interface PackageInstallResult {
  success: boolean;
  package: PackageDefinition;
  installedVersion?: string;
  installPath?: string;
  error?: string;
  warnings?: string[];
}

export interface LockFile {
  lockfileVersion: number;
  name: string;
  switchrVersion: string;
  generated: string;
  runtimes: Record<
    string,
    {
      version: string;
      resolved: string;
      integrity?: string;
      path?: string;
      manager?: string;
    }
  >;
  packages: Record<
    string,
    {
      version: string;
      resolved?: string;
      integrity?: string;
      dependencies?: string[];
      runtime?: string;
    }
  >;
  services: Record<
    string,
    {
      template: string;
      version: string;
      config: Record<string, unknown>;
      image?: string;
      digest?: string;
      ports?: number[];
    }
  >;
}

// Type guards for better type safety
export function isRuntimePackage(pkg: PackageDefinition): pkg is RuntimePackage {
  return pkg.type === 'runtime';
}

export function isServicePackage(pkg: PackageDefinition): pkg is ServicePackage {
  return pkg.type === 'service';
}

export function isDependencyPackage(pkg: PackageDefinition): pkg is DependencyPackage {
  return pkg.type === 'dependency';
}

export function isPackageSearchResult(obj: unknown): obj is PackageSearchResult {
  return (
    obj !== null &&
    obj !== undefined &&
    typeof obj === 'object' &&
    'name' in obj &&
    'type' in obj &&
    typeof (obj as Record<string, unknown>).name === 'string' &&
    typeof (obj as Record<string, unknown>).type === 'string' &&
    ['runtime', 'dependency', 'service', 'tool'].includes(
      (obj as Record<string, unknown>).type as string
    )
  );
}

// Utility functions for package management
export function parsePackageSpec(spec: string): { name: string; version?: string } {
  const parts = spec.includes('@') && !spec.startsWith('@') ? spec.split('@') : [spec];
  return {
    name: parts[0],
    version: parts[1],
  };
}

export function formatPackageSpec(name: string, version?: string): string {
  return version ? `${name}@${version}` : name;
}

export function normalizePackageName(name: string): string {
  return name.toLowerCase().trim();
}

export function isValidPackageType(type: string): type is PackageType {
  return ['runtime', 'dependency', 'service', 'tool'].includes(type);
}

// Package version utilities
export function compareVersions(a: string, b: string): number {
  // Basic semver comparison - would use proper semver library in production
  const normalize = (v: string) =>
    v
      .replace(/^v/, '')
      .split('.')
      .map(n => parseInt(n, 10) || 0);
  const aParts = normalize(a);
  const bParts = normalize(b);
  const maxLength = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < maxLength; i++) {
    const aPart = aParts[i] || 0;
    const bPart = bParts[i] || 0;

    if (aPart > bPart) return 1;
    if (aPart < bPart) return -1;
  }

  return 0;
}

export function isVersionOutdated(current: string, latest: string): boolean {
  if (current === latest) return false;
  if (latest === 'latest') return true;

  try {
    return compareVersions(current, latest) < 0;
  } catch {
    return current !== latest;
  }
}

export function isBreakingChange(current: string, latest: string): boolean {
  try {
    const currentMajor = parseInt(current.split('.')[0], 10);
    const latestMajor = parseInt(latest.split('.')[0], 10);
    return latestMajor > currentMajor;
  } catch {
    return false;
  }
}

// Package registry utilities
export interface RegistryConfig {
  name: string;
  url: string;
  type: 'npm' | 'pypi' | 'crates' | 'maven' | 'nuget';
  auth?: {
    token?: string;
    username?: string;
    password?: string;
  };
}

export interface PackageSearchOptions {
  limit?: number;
  offset?: number;
  type?: PackageType;
  runtime?: string;
  includePrerelease?: boolean;
}

export interface PackageRegistry {
  search(query: string, options?: PackageSearchOptions): Promise<PackageSearchResult[]>;
  getPackageInfo(name: string, version?: string): Promise<PackageDefinition | null>;
  getVersions(name: string): Promise<string[]>;
  getLatestVersion(name: string): Promise<string | null>;
  packageExists(name: string): Promise<boolean>;
}

// Export constants
export const SUPPORTED_PACKAGE_TYPES: PackageType[] = ['runtime', 'dependency', 'service', 'tool'];

export const PACKAGE_TYPE_DESCRIPTIONS: Record<PackageType, string> = {
  runtime: 'Programming language runtime (Node.js, Python, Go, etc.)',
  dependency: 'Library or package dependency',
  service: 'Infrastructure service (database, cache, queue, etc.)',
  tool: 'Development tool or utility',
};

export const DEFAULT_PACKAGE_MANAGERS: Record<string, string> = {
  nodejs: 'npm',
  python: 'pip',
  go: 'go mod',
  java: 'maven',
  rust: 'cargo',
  php: 'composer',
  ruby: 'gem',
  dotnet: 'nuget',
};

// Error types
export class PackageNotFoundError extends Error {
  constructor(packageName: string, registry?: string) {
    super(`Package '${packageName}' not found${registry ? ` in ${registry} registry` : ''}`);
    this.name = 'PackageNotFoundError';
  }
}

export class PackageInstallError extends Error {
  constructor(packageName: string, reason: string) {
    super(`Failed to install package '${packageName}': ${reason}`);
    this.name = 'PackageInstallError';
  }
}

export class RegistryError extends Error {
  constructor(registry: string, reason: string) {
    super(`Registry error (${registry}): ${reason}`);
    this.name = 'RegistryError';
  }
}

export class InvalidPackageSpecError extends Error {
  constructor(spec: string) {
    super(`Invalid package specification: '${spec}'`);
    this.name = 'InvalidPackageSpecError';
  }
}
