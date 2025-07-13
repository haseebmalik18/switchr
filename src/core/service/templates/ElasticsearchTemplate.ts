// src/core/service/templates/ElasticsearchTemplate.ts - PRODUCTION ELASTICSEARCH TEMPLATE
import { ServiceTemplateBase, ServiceTemplate, ServiceInstance } from '../ServiceTemplate';
import { ProcessUtils } from '../../../utils/ProcessUtils';

export class ElasticsearchTemplate extends ServiceTemplateBase {
  constructor() {
    const template: ServiceTemplate = {
      name: 'elasticsearch',
      version: '8.11',
      description: 'Elasticsearch search and analytics engine',
      category: 'search',
      ports: [9200, 9300],
      environment: {
        'discovery.type': 'single-node',
        'xpack.security.enabled': 'false',
        ES_JAVA_OPTS: '-Xms512m -Xmx512m',
      },
      healthCheck: 'curl -f http://localhost:9200/_cluster/health',
      config: {
        version: {
          type: 'string',
          default: '8.11',
          description: 'Elasticsearch version',
          enum: ['7.17', '8.11', '8.12'],
        },
        httpPort: {
          type: 'number',
          default: 9200,
          description: 'HTTP API port',
        },
        transportPort: {
          type: 'number',
          default: 9300,
          description: 'Transport port for node communication',
        },
        clusterName: {
          type: 'string',
          default: 'elasticsearch-dev',
          description: 'Cluster name',
        },
        nodeName: {
          type: 'string',
          default: 'es-node-1',
          description: 'Node name',
        },
        heapSize: {
          type: 'string',
          default: '512m',
          description: 'JVM heap size (e.g., 512m, 1g)',
        },
        enableSecurity: {
          type: 'boolean',
          default: false,
          description: 'Enable X-Pack security',
        },
        password: {
          type: 'string',
          description: 'Elastic user password (when security enabled)',
        },
      },
    };

    super(template);
  }

  async install(config: Record<string, any>): Promise<ServiceInstance> {
    const validation = this.validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid Elasticsearch config: ${validation.errors.join(', ')}`);
    }

    const finalConfig = { ...this.getDefaultConfig(), ...config };
    const command = this.getCommand(finalConfig);

    const environment: Record<string, string> = {
      'cluster.name': finalConfig.clusterName,
      'node.name': finalConfig.nodeName,
      'discovery.type': 'single-node',
      ES_JAVA_OPTS: `-Xms${finalConfig.heapSize} -Xmx${finalConfig.heapSize}`,
      'xpack.security.enabled': finalConfig.enableSecurity.toString(),
    };

    if (finalConfig.enableSecurity && finalConfig.password) {
      environment['ELASTIC_PASSWORD'] = finalConfig.password;
    }

    return {
      template: 'elasticsearch',
      name: `elasticsearch-${finalConfig.version}`,
      version: finalConfig.version,
      config: finalConfig,
      ports: [finalConfig.httpPort, finalConfig.transportPort],
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
        // Volume might not exist
      }
    } catch (error) {
      // Container might not exist
    }
  }

  getCommand(config: Record<string, any>): string {
    const { version, httpPort, transportPort, clusterName, nodeName, heapSize, enableSecurity } =
      config;

    let command = `docker run --name elasticsearch-${version} -d`;

    // Port mappings
    command += ` -p ${httpPort}:9200 -p ${transportPort}:9300`;

    // Data persistence
    command += ` -v elasticsearch-${version}-data:/usr/share/elasticsearch/data`;

    // Environment variables
    command += ` -e "cluster.name=${clusterName}"`;
    command += ` -e "node.name=${nodeName}"`;
    command += ` -e "discovery.type=single-node"`;
    command += ` -e "ES_JAVA_OPTS=-Xms${heapSize} -Xmx${heapSize}"`;
    command += ` -e "xpack.security.enabled=${enableSecurity}"`;

    if (enableSecurity && config.password) {
      command += ` -e "ELASTIC_PASSWORD=${config.password}"`;
    }

    // Disable security for development by default
    if (!enableSecurity) {
      command += ` -e "xpack.security.enabled=false"`;
    }

    command += ` elasticsearch:${version}`;

    return command;
  }

  private getHealthCheck(config: Record<string, any>): string {
    const { httpPort, enableSecurity, password } = config;

    if (enableSecurity && password) {
      return `curl -f -u elastic:${password} http://localhost:${httpPort}/_cluster/health`;
    }

    return `curl -f http://localhost:${httpPort}/_cluster/health`;
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

      if ((key === 'httpPort' || key === 'transportPort') && typeof value === 'number') {
        if (value < 1 || value > 65535) {
          errors.push(`${key} must be between 1 and 65535`);
        }
      }

      if (key === 'heapSize' && typeof value === 'string') {
        if (!value.match(/^\d+[mg]$/i)) {
          errors.push('heapSize must be in format like "512m" or "1g"');
        }
      }
    }

    // Validate security configuration
    if (config.enableSecurity && !config.password) {
      errors.push('Password is required when security is enabled');
    }

    if (config.httpPort === config.transportPort) {
      errors.push('HTTP and transport ports cannot be the same');
    }

    return { valid: errors.length === 0, errors };
  }
}
