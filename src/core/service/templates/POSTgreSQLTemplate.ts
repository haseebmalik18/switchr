import { ServiceTemplateBase, ServiceTemplate, ServiceInstance } from '../ServiceTemplate';
import { ProcessUtils } from '../../../utils/ProcessUtils';

export class PostgreSQLTemplate extends ServiceTemplateBase {
  constructor() {
    const template: ServiceTemplate = {
      name: 'postgresql',
      version: '15',
      description: 'PostgreSQL database server',
      category: 'database',
      ports: [5432],
      environment: {
        POSTGRES_DB: 'dev',
        POSTGRES_USER: 'dev',
        POSTGRES_PASSWORD: 'dev',
      },
      healthCheck: 'pg_isready -h localhost -p 5432',
      config: {
        version: {
          type: 'string',
          default: '15',
          description: 'PostgreSQL version',
          enum: ['13', '14', '15', '16'],
        },
        database: {
          type: 'string',
          default: 'dev',
          description: 'Default database name',
        },
        username: {
          type: 'string',
          default: 'dev',
          description: 'Database username',
        },
        password: {
          type: 'string',
          default: 'dev',
          description: 'Database password',
        },
        port: {
          type: 'number',
          default: 5432,
          description: 'Database port',
        },
      },
    };

    super(template);
  }

  async install(config: Record<string, any>): Promise<ServiceInstance> {
    const validation = this.validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid PostgreSQL config: ${validation.errors.join(', ')}`);
    }

    const finalConfig = { ...this.getDefaultConfig(), ...config };
    const command = this.getCommand(finalConfig);

    return {
      template: 'postgresql',
      name: `postgresql-${finalConfig.version}`,
      version: finalConfig.version,
      config: finalConfig,
      ports: [finalConfig.port],
      environment: {
        POSTGRES_DB: finalConfig.database,
        POSTGRES_USER: finalConfig.username,
        POSTGRES_PASSWORD: finalConfig.password,
      },
      command,
      healthCheck: `pg_isready -h localhost -p ${finalConfig.port}`,
    };
  }

  async uninstall(instanceName: string): Promise<void> {
    // Stop and remove PostgreSQL container
    try {
      await ProcessUtils.execute('docker', ['stop', instanceName]);
      await ProcessUtils.execute('docker', ['rm', instanceName]);
    } catch (error) {
      // Container might not exist, ignore error
    }
  }

  getCommand(config: Record<string, any>): string {
    const { version, database, username, password, port } = config;

    return (
      `docker run --name postgresql-${version} -d ` +
      `-p ${port}:5432 ` +
      `-e POSTGRES_DB=${database} ` +
      `-e POSTGRES_USER=${username} ` +
      `-e POSTGRES_PASSWORD=${password} ` +
      `postgres:${version}`
    );
  }

  validateConfig(config: Record<string, any>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const schema = this.template.config!;

    for (const [key, fieldSchema] of Object.entries(schema)) {
      const value = config[key];

      // Check required fields
      if (fieldSchema.required && (value === undefined || value === null)) {
        errors.push(`Missing required field: ${key}`);
        continue;
      }

      // Skip validation if value is undefined and not required
      if (value === undefined) continue;

      // Type validation
      const expectedType = fieldSchema.type;
      const actualType = Array.isArray(value) ? 'array' : typeof value;

      if (actualType !== expectedType) {
        errors.push(`Field '${key}' must be of type ${expectedType}, got ${actualType}`);
      }

      // Enum validation
      if (fieldSchema.enum && !fieldSchema.enum.includes(value)) {
        errors.push(`Field '${key}' must be one of: ${fieldSchema.enum.join(', ')}`);
      }

      // Port validation
      if (key === 'port' && typeof value === 'number') {
        if (value < 1 || value > 65535) {
          errors.push(`Port must be between 1 and 65535`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }
}
