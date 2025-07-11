export interface SwitchrConfig {
  version: string;
  currentProject?: string;
  projectsDir: string;
  configDir: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  defaultIDE: string;
  autoStart: boolean;
  healthCheckInterval: number;
  portRange: {
    start: number;
    end: number;
  };
}

export interface ProjectConfigFile {
  name: string;
  type: string;
  description?: string;
  environment?: Record<string, string>;
  services?: Array<{
    name: string;
    command: string;
    port?: number;
    healthCheck?: string;
    dependencies?: string[];
    autoRestart?: boolean;
  }>;
  tools?: Record<string, string>;
  ide?: {
    type: string;
    workspace?: string;
    extensions?: string[];
    settings?: Record<string, unknown>;
  };
  scripts?: Record<string, string>;
}

export interface GlobalConfig {
  projects: Record<
    string,
    {
      name: string;
      path: string;
      lastUsed?: string;
      favorite?: boolean;
    }
  >;
  settings: SwitchrConfig;
}
