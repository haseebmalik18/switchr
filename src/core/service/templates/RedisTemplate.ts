import { ServiceTemplateBase, ServiceTemplate, ServiceInstance } from '../ServiceTemplate';
import { ProcessUtils } from '../../../utils/ProcessUtils';

export class RedisTemplate extends ServiceTemplateBase {
  constructor() {
    const template: ServiceTemplate = {
      name: 'redis',
      version: '7',
      description: 'Redis in-memory data store',
      category: 'cache',
      ports: [6379],
      environment: {},
      healthCheck: 'redis-cli ping',
      config: {
        version: {
          type: 'string',
          default: '7',
          description: 'Redis version',
          enum: ['6', '7'],
        },
        port: {
          type: 'number',
          default: 6379,
          description: 'Redis port',
        },
        password: {
          type: 'string',
          description: 'Redis password (optional)',
        },
        maxMemory: {
          type: 'string',
          default: '256mb',
          description: 'Maximum memory usage',
        },
      },
    };

    super(template);
  }

  async install(config: Record<string, any>): Promise<ServiceInstance> {
    const validation = this.validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid Redis config: ${validation.errors.join(', ')}`);
    }

    const finalConfig = { ...this.getDefaultConfig(), ...config };
    const command = this.getCommand(finalConfig);

    return {
      template: 'redis',
      name: `redis-${finalConfig.version}`,
      version: finalConfig.version,
      config: finalConfig,
      ports: [finalConfig.port],
      environment: finalConfig.password ? { REDIS_PASSWORD: finalConfig.password } : {},
      command,
      healthCheck: finalConfig.password
        ? `redis-cli -a ${finalConfig.password} ping`
        : 'redis-cli ping',
    };
  }

  async uninstall(instanceName: string): Promise<void> {
    try {
      await ProcessUtils.execute('docker', ['stop', instanceName]);
      await ProcessUtils.execute('docker', ['rm', instanceName]);
    } catch (error) {
      // Container might not exist, ignore error
    }
  }

  getCommand(config: Record<string, any>): string {
    const { version, port, password, maxMemory } = config;

    let command = `docker run --name redis-${version} -d -p ${port}:6379`;

    if (password) {
      command += ` --requirepass ${password}`;
    }

    if (maxMemory) {
      command += ` --maxmemory ${maxMemory} --maxmemory-policy allkeys-lru`;
    }

    command += ` redis:${version}`;

    return command;
  }

  validateConfig(config: Record<string, any>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const schema = this.template.config!;

    for (const [key, fieldSchema] of Object.entries(schema)) {
      const value = config[key];

      if (fieldSchema.required && value === undefined) {
        errors.push(`Missing required field: ${key}`);
        continue;
      }

      if (value === undefined) continue;

      const expectedType = fieldSchema.type;
      const actualType = typeof value;

      if (actualType !== expectedType) {
        errors.push(`Field '${key}' must be of type ${expectedType}, got ${actualType}`);
      }

      if (fieldSchema.enum && !fieldSchema.enum.includes(value)) {
        errors.push(`Field '${key}' must be one of: ${fieldSchema.enum.join(', ')}`);
      }

      if (key === 'port' && typeof value === 'number') {
        if (value < 1 || value > 65535) {
          errors.push(`Port must be between 1 and 65535`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }
}
