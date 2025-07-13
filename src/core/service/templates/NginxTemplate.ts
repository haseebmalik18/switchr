// src/core/service/templates/NginxTemplate.ts - PRODUCTION NGINX TEMPLATE
import { ServiceTemplateBase, ServiceTemplate, ServiceInstance } from '../ServiceTemplate';
import { ProcessUtils } from '../../../utils/ProcessUtils';

export class NginxTemplate extends ServiceTemplateBase {
  constructor() {
    const template: ServiceTemplate = {
      name: 'nginx',
      version: 'latest',
      description: 'Nginx HTTP server and reverse proxy',
      category: 'web',
      ports: [80, 443],
      environment: {},
      healthCheck: 'curl -f http://localhost:80/nginx_status || curl -f http://localhost:80',
      config: {
        version: {
          type: 'string',
          default: 'latest',
          description: 'Nginx version',
          enum: ['latest', '1.25', '1.24', 'alpine'],
        },
        httpPort: {
          type: 'number',
          default: 80,
          description: 'HTTP port',
        },
        httpsPort: {
          type: 'number',
          default: 443,
          description: 'HTTPS port',
        },
        enableSsl: {
          type: 'boolean',
          default: false,
          description: 'Enable SSL/TLS',
        },
        serverName: {
          type: 'string',
          default: 'localhost',
          description: 'Server name',
        },
        documentRoot: {
          type: 'string',
          default: '/usr/share/nginx/html',
          description: 'Document root directory',
        },
        customConfig: {
          type: 'string',
          description: 'Custom nginx.conf content',
        },
      },
    };

    super(template);
  }

  async install(config: Record<string, any>): Promise<ServiceInstance> {
    const validation = this.validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid Nginx config: ${validation.errors.join(', ')}`);
    }

    const finalConfig = { ...this.getDefaultConfig(), ...config };
    const command = this.getCommand(finalConfig);

    const ports = [finalConfig.httpPort];
    if (finalConfig.enableSsl) {
      ports.push(finalConfig.httpsPort);
    }

    return {
      template: 'nginx',
      name: `nginx-${finalConfig.version}`,
      version: finalConfig.version,
      config: finalConfig,
      ports,
      environment: {
        NGINX_HOST: finalConfig.serverName,
        NGINX_PORT: finalConfig.httpPort.toString(),
      },
      command,
      healthCheck: `curl -f http://localhost:${finalConfig.httpPort} || nginx -t`,
    };
  }

  async uninstall(instanceName: string): Promise<void> {
    try {
      await ProcessUtils.execute('docker', ['stop', instanceName]);
      await ProcessUtils.execute('docker', ['rm', instanceName]);

      // Remove config volume
      try {
        await ProcessUtils.execute('docker', ['volume', 'rm', `${instanceName}-config`]);
      } catch {
        // Volume might not exist
      }
    } catch (error) {
      // Container might not exist
    }
  }

  getCommand(config: Record<string, any>): string {
    const { version, httpPort, httpsPort, enableSsl, customConfig } = config;

    let command = `docker run --name nginx-${version} -d`;

    // Port mappings
    command += ` -p ${httpPort}:80`;
    if (enableSsl) {
      command += ` -p ${httpsPort}:443`;
    }

    // Volume mounts
    command += ` -v nginx-${version}-html:/usr/share/nginx/html`;
    command += ` -v nginx-${version}-config:/etc/nginx/conf.d`;

    if (customConfig) {
      // If custom config provided, mount it
      command += ` -v nginx-${version}-custom:/etc/nginx/nginx.conf:ro`;
    }

    command += ` nginx:${version}`;

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

      if ((key === 'httpPort' || key === 'httpsPort') && typeof value === 'number') {
        if (value < 1 || value > 65535) {
          errors.push(`${key} must be between 1 and 65535`);
        }
      }
    }

    // Check for port conflicts
    if (config.httpPort === config.httpsPort && config.enableSsl) {
      errors.push('HTTP and HTTPS ports cannot be the same');
    }

    return { valid: errors.length === 0, errors };
  }
}
