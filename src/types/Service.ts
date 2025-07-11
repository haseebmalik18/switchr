export interface ServiceStatus {
  name: string;
  status: 'running' | 'stopped' | 'starting' | 'stopping' | 'error';
  pid?: number;
  port?: number;
  uptime?: number;
  memory?: number;
  cpu?: number;
  restartCount?: number;
  lastError?: string;
}

export interface ServiceConfig {
  name: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  port?: number;
  healthCheck?: {
    command?: string;
    url?: string;
    interval?: number;
    timeout?: number;
    retries?: number;
  };
  dependencies?: string[];
  autoRestart?: boolean;
  maxRestarts?: number;
  restartDelay?: number;
}

export interface ServiceManager {
  start(service: ServiceConfig): Promise<void>;
  stop(serviceName: string): Promise<void>;
  restart(serviceName: string): Promise<void>;
  getStatus(serviceName: string): Promise<ServiceStatus>;
  getAllStatus(): Promise<ServiceStatus[]>;
  isHealthy(serviceName: string): Promise<boolean>;
}
