// src/types/Package.ts - Enhanced with proper types
export type PackageType = 'runtime' | 'dependency' | 'service' | 'tool';

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
  config?: Record<string, any>;
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
  repository?: string;
  homepage?: string;
  keywords?: string[];
  lastUpdated?: string;
  maintainers?: string[];
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
      config: Record<string, any>;
      image?: string;
      digest?: string;
      ports?: number[];
    }
  >;
}
