import { ProjectType, ServiceDefinition } from './Project';

export interface SwitchrConfig {
  version: string;
  currentProject?: string | undefined;
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
  type: ProjectType;
  description?: string;
  environment?: Record<string, string>;
  services?: ServiceDefinition[];
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
