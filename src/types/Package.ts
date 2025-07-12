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
}

export interface RuntimePackage extends PackageDefinition {
  type: 'runtime';
  installPath?: string;
  binPath?: string;
  envVars?: Record<string, string>;
}

export interface ServicePackage extends PackageDefinition {
  type: 'service';
  template: string;
  config?: Record<string, any>;
  healthCheck?: string;
  dependencies?: string[];
  ports?: number[];
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
    }
  >;
  packages: Record<
    string,
    {
      version: string;
      resolved?: string;
      integrity?: string;
      dependencies?: string[];
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
    }
  >;
}
