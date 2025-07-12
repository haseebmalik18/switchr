import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { ConfigManager } from '../core/ConfigManager';
import { ProcessUtils } from '../utils/ProcessUtils';
import { logger } from '../utils/Logger';

interface ServiceStatus {
  name: string;
  status: 'running' | 'stopped' | 'unknown';
  pid?: number;
  port?: number;
  uptime?: string;
  memory?: string;
  cpu?: string;
}

export default class Status extends Command {
  static override description = 'Show current project status and running services';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --verbose',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static override flags = {
    verbose: Flags.boolean({
      char: 'v',
      description: 'Show detailed service information',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output in JSON format',
      default: false,
    }),
    services: Flags.boolean({
      char: 's',
      description: 'Show only service status',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(Status);

    try {
      const configManager = ConfigManager.getInstance();
      const currentProject = await configManager.getCurrentProject();

      if (!currentProject) {
        this.log(chalk.yellow('📋 No active project'));
        this.log(
          chalk.gray(`   Run ${chalk.white('switchr switch <project-name>')} to activate a project`)
        );
        return;
      }

      const serviceStatuses = await this.getServiceStatuses(currentProject.services);

      if (flags.json) {
        this.outputJson(currentProject, serviceStatuses);
      } else {
        await this.outputStatus(currentProject, serviceStatuses, flags);
      }
    } catch (error) {
      logger.error('Failed to get project status', error);
      this.error(error instanceof Error ? error.message : 'Unknown error occurred');
    }
  }

  private async getServiceStatuses(services: any[]): Promise<ServiceStatus[]> {
    const statuses: ServiceStatus[] = [];

    for (const service of services) {
      try {
        const status = await this.checkServiceStatus(service);
        statuses.push(status);
      } catch (error) {
        logger.debug(`Failed to check status for service ${service.name}`, error);
        statuses.push({
          name: service.name,
          status: 'unknown',
        });
      }
    }

    return statuses;
  }

  private async checkServiceStatus(service: any): Promise<ServiceStatus> {
    const status: ServiceStatus = {
      name: service.name,
      status: 'stopped',
    };

    if (service.port) {
      const isPortBusy = !(await ProcessUtils.isPortAvailable(service.port));
      if (isPortBusy) {
        status.status = 'running';
        status.port = service.port;

        const pid = await ProcessUtils.findProcessByPort(service.port);
        if (pid) {
          status.pid = pid;

          const processInfo = await this.getProcessInfo(pid);
          if (processInfo) {
            status.uptime = processInfo.uptime;
            status.memory = processInfo.memory;
            status.cpu = processInfo.cpu;
          }
        }
      }
    } else {
      const isRunning = await this.isProcessRunningByCommand(service.command);
      status.status = isRunning ? 'running' : 'stopped';
    }

    return status;
  }

  private async isProcessRunningByCommand(command: string): Promise<boolean> {
    try {
      const isWindows = process.platform === 'win32';

      if (isWindows) {
        const result = await ProcessUtils.execute('tasklist', ['/fo', 'csv']);
        return result.stdout.toLowerCase().includes(command.toLowerCase());
      } else {
        const result = await ProcessUtils.execute('pgrep', ['-f', command]);
        return result.exitCode === 0 && result.stdout.trim().length > 0;
      }
    } catch {
      return false;
    }
  }

  private async getProcessInfo(
    pid: number
  ): Promise<{ uptime: string; memory: string; cpu: string } | null> {
    try {
      const isWindows = process.platform === 'win32';

      if (isWindows) {
        await ProcessUtils.execute('tasklist', ['/fi', `pid eq ${pid}`, '/fo', 'csv']);
        return {
          uptime: 'N/A',
          memory: 'N/A',
          cpu: 'N/A',
        };
      } else {
        const result = await ProcessUtils.execute('ps', [
          '-p',
          pid.toString(),
          '-o',
          'etime,rss,pcpu',
          '--no-headers',
        ]);
        const parts = result.stdout.trim().split(/\s+/);

        if (parts.length >= 3) {
          return {
            uptime: parts[0] || 'N/A',
            memory: parts[1] ? `${Math.round(parseInt(parts[1]) / 1024)}MB` : 'N/A',
            cpu: parts[2] ? `${parts[2]}%` : 'N/A',
          };
        }
      }
    } catch (error) {
      logger.debug(`Failed to get process info for PID ${pid}`, error);
    }

    return null;
  }

  private outputJson(project: any, serviceStatuses: ServiceStatus[]): void {
    const output = {
      project: {
        name: project.name,
        type: project.type,
        path: project.path,
        description: project.description,
      },
      services: serviceStatuses,
      summary: {
        total: serviceStatuses.length,
        running: serviceStatuses.filter(s => s.status === 'running').length,
        stopped: serviceStatuses.filter(s => s.status === 'stopped').length,
        unknown: serviceStatuses.filter(s => s.status === 'unknown').length,
      },
    };

    this.log(JSON.stringify(output, null, 2));
  }

  private async outputStatus(
    project: any,
    serviceStatuses: ServiceStatus[],
    flags: any
  ): Promise<void> {
    if (!flags.services) {
      this.log(chalk.blue(`📋 Project: ${chalk.bold(project.name)}`));
      this.log(chalk.gray(`   Type: ${project.type}`));
      this.log(chalk.gray(`   Path: ${project.path}`));

      if (project.description) {
        this.log(chalk.gray(`   Description: ${project.description}`));
      }

      this.log('');
    }

    if (serviceStatuses.length === 0) {
      this.log(chalk.yellow('⚙️  No services configured'));
      return;
    }

    const runningCount = serviceStatuses.filter(s => s.status === 'running').length;
    const totalCount = serviceStatuses.length;

    this.log(chalk.blue(`⚙️  Services (${runningCount}/${totalCount} running):`));
    this.log('');

    const sortedServices = serviceStatuses.sort((a, b) => {
      const statusOrder = { running: 0, stopped: 1, unknown: 2 };
      return statusOrder[a.status] - statusOrder[b.status];
    });

    for (const service of sortedServices) {
      this.displayService(service, flags.verbose);
    }

    this.log('');
    this.showSummary(serviceStatuses);
  }

  private displayService(service: ServiceStatus, verbose: boolean): void {
    const statusIcon = this.getStatusIcon(service.status);
    const statusColor = this.getStatusColor(service.status);

    const serviceName = chalk.white(service.name);
    const statusText = statusColor(service.status.toUpperCase());

    this.log(`${statusIcon} ${serviceName} - ${statusText}`);

    if (verbose && service.status === 'running') {
      if (service.port) {
        this.log(chalk.gray(`    📡 Port: ${service.port}`));
      }

      if (service.pid) {
        this.log(chalk.gray(`    🆔 PID: ${service.pid}`));
      }

      if (service.uptime && service.uptime !== 'N/A') {
        this.log(chalk.gray(`    ⏱️  Uptime: ${service.uptime}`));
      }

      if (service.memory && service.memory !== 'N/A') {
        this.log(chalk.gray(`    💾 Memory: ${service.memory}`));
      }

      if (service.cpu && service.cpu !== 'N/A') {
        this.log(chalk.gray(`    🔄 CPU: ${service.cpu}`));
      }

      this.log('');
    }
  }

  private getStatusIcon(status: string): string {
    switch (status) {
      case 'running':
        return chalk.green('●');
      case 'stopped':
        return chalk.red('●');
      case 'unknown':
        return chalk.yellow('●');
      default:
        return chalk.gray('●');
    }
  }

  private getStatusColor(status: string): (text: string) => string {
    switch (status) {
      case 'running':
        return chalk.green;
      case 'stopped':
        return chalk.red;
      case 'unknown':
        return chalk.yellow;
      default:
        return chalk.gray;
    }
  }

  private showSummary(serviceStatuses: ServiceStatus[]): void {
    const summary = {
      running: serviceStatuses.filter(s => s.status === 'running').length,
      stopped: serviceStatuses.filter(s => s.status === 'stopped').length,
      unknown: serviceStatuses.filter(s => s.status === 'unknown').length,
    };

    const healthPercentage = Math.round((summary.running / serviceStatuses.length) * 100);
    let healthIcon = '🔴';
    let healthText = 'Critical';

    if (healthPercentage >= 80) {
      healthIcon = '🟢';
      healthText = 'Healthy';
    } else if (healthPercentage >= 50) {
      healthIcon = '🟡';
      healthText = 'Warning';
    }

    this.log(chalk.blue('📊 Summary:'));
    this.log(chalk.gray(`   Health: ${healthIcon} ${healthText} (${healthPercentage}%)`));
    this.log(chalk.gray(`   Running: ${chalk.green(summary.running)}`));
    this.log(chalk.gray(`   Stopped: ${chalk.red(summary.stopped)}`));

    if (summary.unknown > 0) {
      this.log(chalk.gray(`   Unknown: ${chalk.yellow(summary.unknown)}`));
    }

    this.log('');
    this.log(chalk.gray('💡 Quick actions:'));
    this.log(chalk.gray(`   Start services: ${chalk.white('switchr start')}`));
    this.log(chalk.gray(`   Stop services: ${chalk.white('switchr stop')}`));
    this.log(chalk.gray(`   Switch project: ${chalk.white('switchr switch <name>')}`));
  }
}
