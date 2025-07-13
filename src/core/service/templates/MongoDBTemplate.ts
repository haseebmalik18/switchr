// src/core/service/templates/MongoDBTemplate.ts - ENHANCED VERSION
import { ServiceTemplateBase, ServiceTemplate, ServiceInstance } from '../ServiceTemplate';
import { ProcessUtils } from '../../../utils/ProcessUtils';

export class MongoDBTemplate extends ServiceTemplateBase {
  constructor() {
    const template: ServiceTemplate = {
      name: 'mongodb',
      version: '6',
      description: 'MongoDB document database',
      category: 'database',
      ports: [27017],
      environment: {},
      healthCheck: 'mongosh --eval "db.adminCommand(\'ping\')"',
      config: {
        version: {
          type: 'string',
          default: '6',
          description: 'MongoDB version',
          enum: ['5', '6', '7'],
        },
        port: {
          type: 'number',
          default: 27017,
          description: 'MongoDB port',
        },
        database: {
          type: 'string',
          default: 'dev',
          description: 'Default database name',
        },
        username: {
          type: 'string',
          description: 'MongoDB username (optional)',
        },
        password: {
          type: 'string',
          description: 'MongoDB password (optional)',
        },
        replicaSet: {
          type: 'boolean',
          default: false,
          description: 'Enable replica set',
        },
      },
    };

    super(template);
  }

  async install(config: Record<string, any>): Promise<ServiceInstance> {
    const validation = this.validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid MongoDB config: ${validation.errors.join(', ')}`);
    }

    const finalConfig = { ...this.getDefaultConfig(), ...config };
    const command = this.getCommand(finalConfig);

    const environment: Record<string, string> = {};
    if (finalConfig.username && finalConfig.password) {
      environment.MONGO_INITDB_ROOT_USERNAME = finalConfig.username;
      environment.MONGO_INITDB_ROOT_PASSWORD = finalConfig.password;
      environment.MONGO_INITDB_DATABASE = finalConfig.database;
    }

    return {
      template: 'mongodb',
      name: `mongodb-${finalConfig.version}`,
      version: finalConfig.version,
      config: finalConfig,
      ports: [finalConfig.port],
      environment,
      command,
      healthCheck: this.getHealthCheck(finalConfig),
    };
  }

  async uninstall(instanceName: string): Promise<void> {
    try {
      await ProcessUtils.execute('docker', ['stop', instanceName]);
      await ProcessUtils.execute('docker', ['rm', instanceName]);

      // Remove data volume
      try {
        await ProcessUtils.execute('docker', ['volume', 'rm', `${instanceName}-data`]);
      } catch {
        // Volume might not exist, ignore error
      }
    } catch (error) {
      // Container might not exist, ignore error
    }
  }

  getCommand(config: Record<string, any>): string {
    const { version, port, username, password, database, replicaSet } = config;

    let command = `docker run --name mongodb-${version} -d -p ${port}:27017`;

    // Add data persistence
    command += ` -v mongodb-${version}-data:/data/db`;

    if (username && password) {
      command += ` -e MONGO_INITDB_ROOT_USERNAME=${username}`;
      command += ` -e MONGO_INITDB_ROOT_PASSWORD=${password}`;
      command += ` -e MONGO_INITDB_DATABASE=${database}`;
    }

    command += ` mongo:${version}`;

    if (replicaSet) {
      command += ` --replSet rs0`;
    }

    return command;
  }

  private getHealthCheck(config: Record<string, any>): string {
    const { port, username, password } = config;

    if (username && password) {
      return `mongosh --port ${port} --username ${username} --password ${password} --eval "db.adminCommand('ping')"`;
    }

    return `mongosh --port ${port} --eval "db.adminCommand('ping')"`;
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

    // Validate username/password pair
    const { username, password } = config;
    if ((username && !password) || (!username && password)) {
      errors.push('Both username and password must be provided together');
    }

    return { valid: errors.length === 0, errors };
  }
}
