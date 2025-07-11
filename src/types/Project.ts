export type ProjectType = 'node' | 'python' | 'java' | 'go' | 'rust' | 'generic';

export interface ToolVersions {
  node?: string;
  npm?: string;
  python?: string;
  pip?: string;
  java?: string;
  maven?: string;
  gradle?: string;
  go?: string;
  rust?: string;
  [key: string]: string | undefined;
}

export interface Service {
  name: string;
  command: string;
  port?: number;
  healthCheck?: string;
  dependencies?: string[];
  environment?: Record<string, string>;
  workingDirectory?: string;
  autoRestart?: boolean;
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
