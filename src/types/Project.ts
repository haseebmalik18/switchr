export type ProjectType = 'node' | 'python' | 'java' | 'go' | 'rust' | 'php' | 'generic';
export type PackageType = 'runtime' | 'dependency' | 'service' | 'tool';

export interface ToolVersions {
  [key: string]: string;
}

// Enhanced Service Definition with template support
export interface ServiceDefinition {
  name: string;
  command?: string; // Optional when using templates
  template?: string; // Service template name (postgresql, redis, etc.)
  version?: string; // Template version
  port?: number;
  healthCheck?: string;
  dependencies?: string[];
  autoRestart?: boolean;
  config?: Record<string, unknown>; // Template-specific configuration
}

export interface Service extends ServiceDefinition {
  environment?: Record<string, string>;
  workingDirectory?: string;
}

export interface IDEConfig {
  type: 'vscode' | 'intellij' | 'sublime' | 'vim' | 'generic';
  workspace?: string;
  extensions?: string[];
  settings?: Record<string, unknown>;
  runConfigurations?: Record<string, unknown>[];
}

// Package Management Types
export interface RuntimeDefinition {
  [runtimeName: string]: string; // e.g., { "nodejs": "18.17.0", "python": "3.11.5" }
}

export interface DependencyDefinition {
  name: string;
  version?: string;
  type: 'dependency'; // Add required type field
  runtime: string; // Make runtime required to match DependencyPackage
  dev?: boolean; // Development dependency
  optional?: boolean; // Optional dependency
  global?: boolean; // Install globally
  description?: string;
}

export interface ServicePackageDefinition {
  name: string;
  type: 'service'; // Add required type field
  template: string; // Template name (postgresql, redis, mongodb, etc.)
  version?: string; // Template version
  config?: Record<string, unknown>; // Service-specific configuration
  description?: string;
}

export interface ProjectPackages {
  runtimes?: RuntimeDefinition;
  dependencies?: DependencyDefinition[];
  services?: ServicePackageDefinition[];
}

// Enhanced Project Profile
export interface ProjectProfile {
  name: string;
  path: string;
  type: ProjectType;
  description?: string;
  environment: Record<string, string>;
  services: Service[]; // Legacy services (still supported)
  tools: ToolVersions; // Detected tools
  packages?: ProjectPackages; // New package management
  ide?: IDEConfig;
  scripts?: Record<string, string>;
  createdAt: string;
  lastUsed?: string;
}

// Enhanced Project Detection
export interface ProjectDetectionResult {
  type: ProjectType;
  suggestedServices: Service[];
  suggestedTools: ToolVersions;
  suggestedEnvironment: Record<string, string>;
  suggestedPackages?: ProjectPackages; // New suggested packages
  confidence: number;
}

// Lock File Types
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
      manager?: string; // nvm, fnm, asdf, etc.
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

// Enhanced Configuration File Schema
export interface ProjectConfigFile {
  name: string;
  type: ProjectType;
  description?: string;

  // Package Management (New)
  packages?: {
    runtimes?: RuntimeDefinition;
    dependencies?: DependencyDefinition[];
    services?: ServicePackageDefinition[];
  };

  // Environment Variables
  environment?: Record<string, string>;

  // Legacy Services (still supported for backward compatibility)
  services?: ServiceDefinition[];

  // Tools (auto-detected)
  tools?: Record<string, string>;

  // IDE Configuration
  ide?: {
    type: string;
    workspace?: string;
    extensions?: string[];
    settings?: Record<string, unknown>;
  };

  // Custom Scripts
  scripts?: Record<string, string>;
}
