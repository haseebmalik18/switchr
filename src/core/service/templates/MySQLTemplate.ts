// src/core/service/templates/MySQLTemplate.ts - PRODUCTION MYSQL TEMPLATE
import { ServiceTemplateBase, ServiceTemplate, ServiceInstance } from '../ServiceTemplate';
import { ProcessUtils } from '../../../utils/ProcessUtils';

export class MySQLTemplate extends ServiceTemplateBase {
  constructor() {
    const template: ServiceTemplate = {
      name: 'mysql',
      version: '8.0',
      description: 'MySQL relational database server',
      category: 'database',
      ports: [3306],
      environment: {
        MYSQL_ROOT_PASSWORD: 'root',
        MYSQL_DATABASE: 'dev',
        MYSQL_USER: 'dev',
        MYSQL_PASSWORD: 'dev',
      },
      healthCheck: 'mysqladmin ping -h localhost -u root -proot',
      config: {
        version: {
          type: 'string',
          default: '8.0',
          description: 'MySQL version',
          enum: ['5.7', '8.0', '8.1'],
        },
        rootPassword: {
          type: 'string',
          default: 'root',
          description: 'MySQL root password',
          required: true,
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
          default: 3306,
          description: 'Database port',
        },
        charset: {
          type: 'string',
          default: 'utf8mb4',
          description: 'Default character set',
          enum: ['utf8', 'utf8mb4', 'latin1'],
        },
        collation: {
          type: 'string',
          default: 'utf8mb4_unicode_ci',
          description: 'Default collation',
        },
      },
    };

    super(template);
  }

  async install(config: Record<string, any>): Promise<ServiceInstance> {
    const validation = this.validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid MySQL config: ${validation.errors.join(', ')}`);
    }

    const finalConfig = { ...this.getDefaultConfig(), ...config };
    const command = this.getCommand(finalConfig);

    return {
      template: 'mysql',
      name: `mysql-${finalConfig.version}`,
      version: finalConfig.version,
      config: finalConfig,
      ports: [finalConfig.port],
      environment: {
        MYSQL_ROOT_PASSWORD: finalConfig.rootPassword,
        MYSQL_DATABASE: finalConfig.database,
        MYSQL_USER: finalConfig.username,
        MYSQL_PASSWORD: finalConfig.password,
      },
      command,
      healthCheck: `mysqladmin ping -h localhost -P ${finalConfig.port} -u root -p${finalConfig.rootPassword}`,
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
        // Volume might not exist
      }
    } catch (error) {
      // Container might not exist
    }
  }

  getCommand(config: Record<string, any>): string {
    const { version, port, rootPassword, database, username, password, charset, collation } =
      config;

    let command = `docker run --name mysql-${version} -d -p ${port}:3306`;

    // Add data persistence
    command += ` -v mysql-${version}-data:/var/lib/mysql`;

    // Environment variables
    command += ` -e MYSQL_ROOT_PASSWORD=${rootPassword}`;
    command += ` -e MYSQL_DATABASE=${database}`;
    command += ` -e MYSQL_USER=${username}`;
    command += ` -e MYSQL_PASSWORD=${password}`;

    // Character set and collation
    command += ` mysql:${version}`;
    command += ` --character-set-server=${charset}`;
    command += ` --collation-server=${collation}`;
    command += ` --default-authentication-plugin=mysql_native_password`;

    return command;
  }

  validateConfig(config: Record<string, any>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const schema = this.template.config!;

    for (const [key, fieldSchema] of Object.entries(schema)) {
      const value = config[key];

      if (fieldSchema.required && (value === undefined || value === null)) {
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

      if (key === 'rootPassword' && typeof value === 'string' && value.length < 4) {
        errors.push(`Root password must be at least 4 characters long`);
      }
    }

    return { valid: errors.length === 0, errors };
  }
}
