export type ProjectType = 'node' | 'python' | 'java' | 'go' | 'rust' | 'generic';

export interface ToolVersions {
  [key: string]: string;
}

export interface ServiceDefinition {
  name: string;
  command: string;
  port?: number;
  healthCheck?: string;
  dependencies?: string[];
  autoRestart?: boolean;
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

export interface ProjectProfile {
  name: string;
  path: string;
  type: ProjectType;
  description?: string;
  environment: Record<string, string>;
  services: Service[];
  tools: ToolVersions;
  ide?: IDEConfig;
  scripts?: Record<string, string>;
  createdAt: string;
  lastUsed?: string;
}

export interface ProjectDetectionResult {
  type: ProjectType;
  suggestedServices: Service[];
  suggestedTools: ToolVersions;
  suggestedEnvironment: Record<string, string>;
  confidence: number;
}
