// src/core/service/ServiceTemplateRegistry.ts - FIXED VERSION
import { ServiceTemplate, ServiceTemplateBase } from './ServiceTemplate';
import { PostgreSQLTemplate } from './templates/PostgreSQLTemplate';
import { RedisTemplate } from './templates/RedisTemplate';
import { MongoDBTemplate } from './templates/MongoDBTemplate';
import { logger } from '../../utils/Logger';

export class ServiceTemplateRegistry {
  private static templates = new Map<string, ServiceTemplateBase>();
  private static initialized = false;

  static async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Register built-in templates
      this.register('postgresql', new PostgreSQLTemplate());
      this.register('postgres', new PostgreSQLTemplate()); // Alias
      this.register('redis', new RedisTemplate());
      this.register('mongodb', new MongoDBTemplate());
      this.register('mongo', new MongoDBTemplate()); // Alias

      this.initialized = true;
      logger.debug(`Initialized ${this.templates.size} service templates`);
    } catch (error) {
      logger.error('Failed to initialize service templates', error);
      throw error;
    }
  }

  static register(name: string, template: ServiceTemplateBase): void {
    this.templates.set(name, template);
    logger.debug(`Registered service template: ${name}`);
  }

  static getTemplate(name: string): ServiceTemplateBase | null {
    return this.templates.get(name) || null;
  }

  static getAllTemplates(): ServiceTemplate[] {
    return Array.from(this.templates.values()).map(t => t.getTemplate());
  }

  static getTemplatesByCategory(category: string): ServiceTemplate[] {
    return this.getAllTemplates().filter(t => t.category === category);
  }

  static hasTemplate(name: string): boolean {
    return this.templates.has(name);
  }

  static searchTemplates(query: string): ServiceTemplate[] {
    const lowercaseQuery = query.toLowerCase();

    return this.getAllTemplates().filter(
      template =>
        template.name.toLowerCase().includes(lowercaseQuery) ||
        template.description.toLowerCase().includes(lowercaseQuery) ||
        template.category.toLowerCase().includes(lowercaseQuery)
    );
  }

  static getTemplatesByProjectType(projectType: string): ServiceTemplate[] {
    const suggestions: Record<string, string[]> = {
      nodejs: ['postgresql', 'redis', 'mongodb'],
      python: ['postgresql', 'redis', 'mongodb'],
      java: ['postgresql', 'redis'],
      go: ['postgresql', 'redis', 'mongodb'],
      rust: ['postgresql', 'redis'],
    };

    const templateNames = suggestions[projectType] || [];
    return templateNames
      .map(name => this.getTemplate(name))
      .filter((template): template is ServiceTemplateBase => template !== null)
      .map(template => template.getTemplate());
  }
}

// src/core/service/templates/PostgreSQLTemplate.ts - FIXED VERSION
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
        dataPath: {
          type: 'string',
          description: 'Data volume path (optional)',
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
    try {
      await ProcessUtils.execute('docker', ['stop', instanceName]);
      await ProcessUtils.execute('docker', ['rm', instanceName]);

      // Also remove data volume if it exists
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
    const { version, database, username, password, port, dataPath } = config;

    let command = `docker run --name postgresql-${version} -d `;
    command += `-p ${port}:5432 `;
    command += `-e POSTGRES_DB=${database} `;
    command += `-e POSTGRES_USER=${username} `;
    command += `-e POSTGRES_PASSWORD=${password} `;

    // Add data persistence
    if (dataPath) {
      command += `-v ${dataPath}:/var/lib/postgresql/data `;
    } else {
      command += `-v postgresql-${version}-data:/var/lib/postgresql/data `;
    }

    command += `postgres:${version}`;

    return command;
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

      // String validation
      if (expectedType === 'string' && typeof value === 'string') {
        if (key === 'database' && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
          errors.push(`Database name must be a valid identifier`);
        }
        if (key === 'username' && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
          errors.push(`Username must be a valid identifier`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }
}

// src/core/service/templates/RedisTemplate.ts - ENHANCED VERSION
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
        persistence: {
          type: 'boolean',
          default: false,
          description: 'Enable data persistence',
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

      // Remove data volume if persistence was enabled
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
    const { version, port, password, maxMemory, persistence } = config;

    let command = `docker run --name redis-${version} -d -p ${port}:6379`;

    // Add Redis configuration
    const redisArgs: string[] = [];

    if (password) {
      redisArgs.push('--requirepass', password);
    }

    if (maxMemory) {
      redisArgs.push('--maxmemory', maxMemory);
      redisArgs.push('--maxmemory-policy', 'allkeys-lru');
    }

    if (persistence) {
      redisArgs.push('--save', '60', '1000');
      command += ` -v redis-${version}-data:/data`;
    } else {
      redisArgs.push('--save', '""');
    }

    command += ` redis:${version}`;

    if (redisArgs.length > 0) {
      command += ` redis-server ${redisArgs.join(' ')}`;
    }

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

      if (key === 'maxMemory' && typeof value === 'string') {
        if (!/^\d+(kb|mb|gb)$/i.test(value)) {
          errors.push(`Max memory must be in format like '256mb', '1gb'`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }
}

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
