export interface ServiceTemplate {
  name: string;
  version: string;
  description: string;
  category: 'database' | 'cache' | 'queue' | 'search' | 'monitoring' | 'web' | 'other';
  ports: number[];
  environment: Record<string, string>;
  healthCheck?: string;
  dependencies?: string[];
  config?: ServiceConfigSchema;
}

export interface ServiceConfigSchema {
  [key: string]: {
    type: 'string' | 'number' | 'boolean' | 'array';
    required?: boolean;
    default?: any;
    description?: string;
    enum?: any[];
  };
}

export interface ServiceInstance {
  template: string;
  name: string;
  version: string;
  config: Record<string, any>;
  ports: number[];
  environment: Record<string, string>;
  command: string;
  healthCheck?: string;
}

/**
 * Abstract base class for service templates
 */
export abstract class ServiceTemplateBase {
  protected template: ServiceTemplate;

  constructor(template: ServiceTemplate) {
    this.template = template;
  }

  abstract install(config: Record<string, any>): Promise<ServiceInstance>;
  abstract uninstall(instanceName: string): Promise<void>;
  abstract getCommand(config: Record<string, any>): string;
  abstract validateConfig(config: Record<string, any>): { valid: boolean; errors: string[] };

  getTemplate(): ServiceTemplate {
    return { ...this.template };
  }

  getDefaultConfig(): Record<string, any> {
    const config: Record<string, any> = {};

    if (this.template.config) {
      for (const [key, schema] of Object.entries(this.template.config)) {
        if (schema.default !== undefined) {
          config[key] = schema.default;
        }
      }
    }

    return config;
  }
}
