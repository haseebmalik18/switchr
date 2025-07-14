// src/commands/status.ts - Complete production implementation with strong typing
import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import ora from 'ora';
import { ConfigManager } from '../core/ConfigManager';
import { RuntimeRegistry } from '../core/runtime/RuntimeRegistry';
import { ProcessUtils } from '../utils/ProcessUtils';
import { logger } from '../utils/Logger';
import { ProjectProfile, Service } from '../types/Project';
import { RuntimeType } from '../types/Runtime';

interface ServiceStatus {
  name: string;
  status: 'running' | 'stopped' | 'error' | 'unknown';
  pid?: number;
  port?: number;
  memory?: string;
  cpu?: string;
  uptime?: string;
  template?: string;
  command?: string;
}

interface RuntimeStatus {
  name: string;
  version: string;
  installed: boolean;
  active: boolean;
  path?: string;
  manager?: string;
}

interface ProjectStatus {
  project: ProjectProfile;
  runtimes: RuntimeStatus[];
  services: ServiceStatus[];
  totalServices: number;
  runningServices: number;
  errorServices: number;
}

interface StatusCommandFlags {
  detailed: boolean;
  json: boolean;
  watch: boolean;
  services: string | undefined;
}

export default class Status extends Command {
  static override description = 'Show project and service status';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --detailed',
    '<%= config.bin %> <%= command.id %> --json',
    '<%= config.bin %> <%= command.id %> --services redis,postgres',
    '<%= config.bin %> <%= command.id %> --watch',
  ];

  static override flags = {
    detailed: Flags.boolean({
      char: 'd',
      description: 'Show detailed service information',
      default: false,
    }),
    json: Flags.boolean({
      char: 'j',
      description: 'Output in JSON format',
      default: false,
    }),
    watch: Flags.boolean({
      char: 'w',
      description: 'Watch for changes and update status',
      default: false,
    }),
    services: Flags.string({
      char: 's',
      description: 'Filter by specific services (comma-separated)',
    }),
  };

  private configManager: ConfigManager;

  constructor(argv: string[], config: import('@oclif/core').Config) {
    super(argv, config);
    this.configManager = ConfigManager.getInstance();
  }

  public async run(): Promise<void> {
    const { flags } = await this.parse(Status);

    try {
      // Initialize runtime registry
      await RuntimeRegistry.initialize();

      const currentProject = await this.configManager.getCurrentProject();
      if (!currentProject) {
        this.error('No active project. Run switchr switch <project-name> to activate a project.');
      }

      if (flags.watch) {
        await this.watchStatus(currentProject, flags);
      } else {
        await this.showStatus(currentProject, flags);
      }
    } catch (error) {
      logger.error('Failed to get status', error);
      this.error(error instanceof Error ? error.message : 'Unknown error occurred');
    }
  }

  private async showStatus(project: ProjectProfile, flags: StatusCommandFlags): Promise<void> {
    const spinner = ora('Gathering status information...').start();

    try {
      const projectStatus = await this.getProjectStatus(project, flags);
      spinner.stop();

      if (flags.json) {
        this.outputJson(projectStatus);
        return;
      }

      this.displayStatus(projectStatus, flags);
    } catch (error) {
      spinner.fail('Failed to gather status information');
      throw error;
    }
  }

  private async getProjectStatus(
    project: ProjectProfile,
    flags: StatusCommandFlags
  ): Promise<ProjectStatus> {
    const [runtimeStatuses, serviceStatuses] = await Promise.all([
      this.getRuntimeStatuses(project),
      this.getServiceStatuses(project.services, flags),
    ]);

    return {
      project,
      runtimes: runtimeStatuses,
      services: serviceStatuses,
      totalServices: serviceStatuses.length,
      runningServices: serviceStatuses.filter(s => s.status === 'running').length,
      errorServices: serviceStatuses.filter(s => s.status === 'error').length,
    };
  }

  private async getRuntimeStatuses(project: ProjectProfile): Promise<RuntimeStatus[]> {
    const statuses: RuntimeStatus[] = [];

    // Get runtime info from project tools and packages
    const runtimeConfigs = new Map<string, string>();

    // Check project tools (legacy)
    if (project.tools) {
      Object.entries(project.tools).forEach(([tool, version]) => {
        if (['node', 'nodejs', 'python', 'go', 'java', 'rust'].includes(tool)) {
          runtimeConfigs.set(tool === 'node' ? 'nodejs' : tool, version);
        }
      });
    }

    // Check project packages (new format)
    if (project.packages?.runtimes) {
      Object.entries(project.packages.runtimes).forEach(([runtime, version]) => {
        runtimeConfigs.set(runtime, version);
      });
    }

    // Get status for each runtime
    for (const [runtimeName, version] of runtimeConfigs) {
      try {
        if (RuntimeRegistry.isSupported(runtimeName)) {
          const manager = RuntimeRegistry.create(
            runtimeName as RuntimeType,
            project.path,
            this.configManager.getConfigDir()
          );

          const currentEnv = await manager.getCurrentVersion();
          const isInstalled = await manager.isInstalled(version);
          const bestManager = await manager.getBestManager();

          statuses.push({
            name: runtimeName,
            version,
            installed: isInstalled,
            active: currentEnv?.version === version,
            ...(currentEnv?.path && { path: currentEnv.path }),
            ...(bestManager?.name && { manager: bestManager.name }),
          });
        } else {
          statuses.push({
            name: runtimeName,
            version,
            installed: false,
            active: false,
          });
        }
      } catch (error) {
        logger.debug(`Failed to get status for runtime ${runtimeName}:`, error);
        statuses.push({
          name: runtimeName,
          version,
          installed: false,
          active: false,
        });
      }
    }

    return statuses;
  }

  private async getServiceStatuses(
    services: Service[],
    flags: StatusCommandFlags
  ): Promise<ServiceStatus[]> {
    const filteredServices = this.filterServices(services, flags);
    const statuses = await Promise.all(
      filteredServices.map(service => this.checkServiceStatus(service))
    );

    return statuses;
  }

  private filterServices(services: Service[], flags: StatusCommandFlags): Service[] {
    if (!flags.services) {
      return services;
    }

    const requestedServices = flags.services.split(',').map(s => s.trim().toLowerCase());
    return services.filter(service => requestedServices.includes(service.name.toLowerCase()));
  }

  private async checkServiceStatus(service: Service): Promise<ServiceStatus> {
    try {
      // Check if service is running via PM2
      const pm2Status = await this.checkPM2Status(service.name);
      if (pm2Status) {
        return {
          name: service.name,
          status: 'running',
          pid: pm2Status.pid,
          memory: pm2Status.memory,
          cpu: pm2Status.cpu,
          uptime: pm2Status.uptime,
          ...(service.template && { template: service.template }),
          ...(service.command && { command: service.command }),
          ...(service.port && { port: service.port }),
        };
      }

      // Check if service is running via Docker
      const dockerStatus = await this.checkDockerStatus(service.name);
      if (dockerStatus) {
        return {
          name: service.name,
          status: 'running',
          memory: dockerStatus.memory,
          uptime: dockerStatus.uptime,
          ...(service.template && { template: service.template }),
          ...(service.command && { command: service.command }),
          ...(service.port && { port: service.port }),
        };
      }

      // Check if service is listening on port
      if (service.port) {
        const isListening = await this.checkPortStatus(service.port);
        if (isListening) {
          return {
            name: service.name,
            status: 'running',
            port: service.port,
            ...(service.template && { template: service.template }),
            ...(service.command && { command: service.command }),
          };
        }
      }

      return {
        name: service.name,
        status: 'stopped',
        ...(service.template && { template: service.template }),
        ...(service.command && { command: service.command }),
        ...(service.port && { port: service.port }),
      };
    } catch (error) {
      logger.debug(`Failed to check status for service ${service.name}:`, error);
      return {
        name: service.name,
        status: 'error',
        ...(service.template && { template: service.template }),
        ...(service.command && { command: service.command }),
        ...(service.port && { port: service.port }),
      };
    }
  }

  private async checkPM2Status(
    serviceName: string
  ): Promise<{ pid: number; memory: string; cpu: string; uptime: string } | null> {
    try {
      const result = await ProcessUtils.execute('pm2', ['jlist']);
      if (result.exitCode !== 0) return null;

      const processes = JSON.parse(result.stdout);
      const process = processes.find(
        (p: { name: string; pm2_env?: { status?: string } }) => p.name === serviceName
      );

      if (process && process.pm2_env?.status === 'online') {
        return {
          pid: process.pid,
          memory: this.formatMemory(process.monit?.memory || 0),
          cpu: `${process.monit?.cpu || 0}%`,
          uptime: this.formatUptime(process.pm2_env?.pm_uptime || Date.now()),
        };
      }
    } catch {
      // PM2 not available or service not found
    }
    return null;
  }

  private async checkDockerStatus(
    serviceName: string
  ): Promise<{ memory: string; uptime: string } | null> {
    try {
      const result = await ProcessUtils.execute('docker', [
        'stats',
        '--no-stream',
        '--format',
        'table {{.Container}}\t{{.MemUsage}}\t{{.CPUPerc}}',
        serviceName,
      ]);

      if (result.exitCode === 0 && result.stdout.trim()) {
        const lines = result.stdout.trim().split('\n');
        if (lines.length > 1) {
          const [, memory] = lines[1].split('\t');

          // Get container creation time for uptime
          const inspectResult = await ProcessUtils.execute('docker', [
            'inspect',
            '--format',
            '{{.State.StartedAt}}',
            serviceName,
          ]);

          const uptime =
            inspectResult.exitCode === 0
              ? this.formatUptime(new Date(inspectResult.stdout.trim()).getTime())
              : 'Unknown';

          return { memory, uptime };
        }
      }
    } catch {
      // Docker not available or service not found
    }
    return null;
  }

  private async checkPortStatus(port: number): Promise<boolean> {
    try {
      const result = await ProcessUtils.execute('lsof', ['-i', `:${port}`]);
      return result.exitCode === 0 && result.stdout.includes('LISTEN');
    } catch {
      return false;
    }
  }

  private displayStatus(projectStatus: ProjectStatus, flags: StatusCommandFlags): void {
    // Project header
    this.log(chalk.blue('📊 Project Status\n'));
    this.log(chalk.blue(`Project: ${chalk.white(projectStatus.project.name)}`));
    this.log(chalk.gray(`Path: ${projectStatus.project.path}`));
    this.log(chalk.gray(`Type: ${projectStatus.project.type}`));
    this.log('');

    // Runtime status
    if (projectStatus.runtimes.length > 0) {
      this.log(chalk.blue('🔧 Runtimes:'));
      projectStatus.runtimes.forEach(runtime => {
        const statusIcon = runtime.active
          ? chalk.green('●')
          : runtime.installed
            ? chalk.yellow('●')
            : chalk.red('●');
        const statusText = runtime.active
          ? 'active'
          : runtime.installed
            ? 'installed'
            : 'not installed';

        this.log(
          `   ${statusIcon} ${chalk.white(runtime.name)} ${chalk.gray(`v${runtime.version}`)} ${chalk.gray(`(${statusText})`)}`
        );

        if (flags.detailed && runtime.manager) {
          this.log(chalk.gray(`     Manager: ${runtime.manager}`));
        }
        if (flags.detailed && runtime.path) {
          this.log(chalk.gray(`     Path: ${runtime.path}`));
        }
      });
      this.log('');
    }

    // Service status
    this.log(
      chalk.blue(
        `⚡ Services (${projectStatus.runningServices}/${projectStatus.totalServices} running):`
      )
    );

    if (projectStatus.services.length === 0) {
      this.log(chalk.gray('   No services configured'));
    } else {
      projectStatus.services.forEach(service => {
        this.displayServiceStatus(service, flags);
      });
    }

    this.displayStatusFooter(projectStatus);
  }

  private displayServiceStatus(service: ServiceStatus, flags: StatusCommandFlags): void {
    const statusIcon = this.getStatusIcon(service.status);
    const statusColor = this.getStatusColor(service.status);

    this.log(`   ${statusIcon} ${chalk.white(service.name)} ${statusColor(service.status)}`);

    if (flags.detailed) {
      if (service.template) {
        this.log(chalk.gray(`     Template: ${service.template}`));
      }
      if (service.command) {
        this.log(chalk.gray(`     Command: ${service.command}`));
      }
      if (service.port) {
        this.log(chalk.gray(`     Port: ${service.port}`));
      }
      if (service.pid) {
        this.log(chalk.gray(`     PID: ${service.pid}`));
      }
      if (service.memory) {
        this.log(chalk.gray(`     Memory: ${service.memory}`));
      }
      if (service.cpu) {
        this.log(chalk.gray(`     CPU: ${service.cpu}`));
      }
      if (service.uptime) {
        this.log(chalk.gray(`     Uptime: ${service.uptime}`));
      }
    }
  }

  private async watchStatus(project: ProjectProfile, flags: StatusCommandFlags): Promise<void> {
    this.log(chalk.blue('👀 Watching project status (Press Ctrl+C to stop)...'));
    this.log('');

    const interval = setInterval(async () => {
      try {
        // Clear screen
        process.stdout.write('\x1B[2J\x1B[0f');

        const projectStatus = await this.getProjectStatus(project, flags);
        this.displayStatus(projectStatus, flags);

        this.log(chalk.gray(`\nLast updated: ${new Date().toLocaleTimeString()}`));
      } catch (error) {
        logger.error('Error during status watch:', error);
      }
    }, 3000); // Update every 3 seconds

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      clearInterval(interval);
      this.log('\n' + chalk.blue('👋 Status monitoring stopped'));
      process.exit(0);
    });

    // Show initial status
    const projectStatus = await this.getProjectStatus(project, flags);
    this.displayStatus(projectStatus, flags);
    this.log(chalk.gray(`\nLast updated: ${new Date().toLocaleTimeString()}`));
  }

  private outputJson(projectStatus: ProjectStatus): void {
    this.log(JSON.stringify(projectStatus, null, 2));
  }

  private displayStatusFooter(projectStatus: ProjectStatus): void {
    this.log('');

    if (projectStatus.runningServices === 0) {
      this.log(chalk.gray(`💡 Use ${chalk.white('switchr start')} to start services`));
    } else if (projectStatus.runningServices < projectStatus.totalServices) {
      this.log(
        chalk.gray(`💡 Use ${chalk.white('switchr start <service>')} to start specific services`)
      );
    }

    if (projectStatus.errorServices > 0) {
      this.log(chalk.gray(`⚠️  ${projectStatus.errorServices} service(s) have errors`));
    }

    this.log(chalk.gray(`💡 Use ${chalk.white('switchr status --detailed')} for more information`));
    this.log(chalk.gray(`💡 Use ${chalk.white('switchr logs <service>')} to view service logs`));
  }

  private getStatusIcon(status: string): string {
    switch (status) {
      case 'running':
        return chalk.green('●');
      case 'stopped':
        return chalk.yellow('●');
      case 'error':
        return chalk.red('●');
      default:
        return chalk.gray('●');
    }
  }

  private getStatusColor(status: string): (text: string) => string {
    switch (status) {
      case 'running':
        return chalk.green;
      case 'stopped':
        return chalk.yellow;
      case 'error':
        return chalk.red;
      default:
        return chalk.gray;
    }
  }

  private formatMemory(bytes: number): string {
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 B';

    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = bytes / Math.pow(1024, i);

    return `${size.toFixed(1)} ${sizes[i]}`;
  }

  private formatUptime(startTime: number): string {
    const uptime = Date.now() - startTime;
    const seconds = Math.floor(uptime / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}
