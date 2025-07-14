// src/commands/logs.ts - Production-quality logs command
import { Command, Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import { ConfigManager } from '../core/ConfigManager';
import { ProcessUtils } from '../utils/ProcessUtils';
import { logger } from '../utils/Logger';
import { Service } from '../types/Project';

interface LogEntry {
  timestamp: Date;
  service: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  pid?: number;
}

interface ServiceLogInfo {
  name: string;
  pid?: number;
  logFile?: string;
  running: boolean;
}

interface LogsCommandFlags {
  follow: boolean;
  tail: number;
  since: string | undefined;
  level: string | undefined;
  json: boolean;
  timestamps: boolean;
  raw: boolean;
  grep: string | undefined;
}

export default class Logs extends Command {
  static override description = 'View logs for project services';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> api',
    '<%= config.bin %> <%= command.id %> --follow',
    '<%= config.bin %> <%= command.id %> --since 1h',
    '<%= config.bin %> <%= command.id %> --level error',
    '<%= config.bin %> <%= command.id %> --tail 100',
  ];

  static override args = {
    service: Args.string({
      description: 'Specific service name to show logs for',
    }),
  };

  static override flags = {
    follow: Flags.boolean({
      char: 'f',
      description: 'Follow log output (live tail)',
      default: false,
    }),
    tail: Flags.integer({
      char: 't',
      description: 'Number of recent log lines to show',
      default: 50,
    }),
    since: Flags.string({
      char: 's',
      description: 'Show logs since duration (e.g., 1h, 30m, 1d)',
    }),
    level: Flags.string({
      char: 'l',
      description: 'Filter by log level',
      options: ['debug', 'info', 'warn', 'error'],
    }),
    json: Flags.boolean({
      description: 'Output logs in JSON format',
      default: false,
    }),
    timestamps: Flags.boolean({
      description: 'Show timestamps',
      default: true,
    }),
    raw: Flags.boolean({
      description: 'Show raw log output without formatting',
      default: false,
    }),
    grep: Flags.string({
      char: 'g',
      description: 'Filter logs by text pattern',
    }),
  };

  private shouldStop = false;
  private parsedArgs: { service?: string } = {};
  // TODO: Will be needed for different follow modes (tail, watch, etc.)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // @ts-expect-error - Property reserved for future use
  private _followMode: 'tail' | 'watch' | 'live' = 'tail';

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Logs);
    this.parsedArgs = { ...(args.service && { service: args.service }) };

    try {
      const configManager = ConfigManager.getInstance();
      const currentProject = await configManager.getCurrentProject();

      if (!currentProject) {
        this.error(
          `No active project. Run ${chalk.white('switchr switch <project-name>')} to activate a project.`
        );
      }

      if (currentProject.services.length === 0) {
        this.log(chalk.yellow('📋 No services configured for this project'));
        this.log(
          chalk.gray(
            `   Add services to ${chalk.white('switchr.yml')} or run ${chalk.white('switchr init')} again`
          )
        );
        return;
      }

      const servicesToShow = this.determineServicesToShow(args.service, currentProject.services);
      const serviceLogInfo = await this.getServiceLogInfo(servicesToShow);

      if (flags.follow) {
        this.setupSignalHandlers();
        await this.followLogs(serviceLogInfo, flags);
      } else {
        await this.showLogs(serviceLogInfo, flags);
      }
    } catch (error) {
      logger.error('Failed to show logs', error);
      this.error(error instanceof Error ? error.message : 'Unknown error occurred');
    }
  }

  private determineServicesToShow(
    serviceName: string | undefined,
    allServices: Service[]
  ): Service[] {
    if (serviceName) {
      const service = allServices.find(s => s.name === serviceName);
      if (!service) {
        const availableServices = allServices.map(s => s.name).join(', ');
        this.error(
          `Service '${serviceName}' not found. Available services: ${availableServices || 'none'}`
        );
      }
      return [service];
    }

    return allServices;
  }

  private async getServiceLogInfo(services: Service[]): Promise<ServiceLogInfo[]> {
    const serviceLogInfo: ServiceLogInfo[] = [];

    for (const service of services) {
      const info: ServiceLogInfo = {
        name: service.name,
        running: false,
      };

      // Check if service is running and get PID
      if (service.port) {
        const pid = await ProcessUtils.findProcessByPort(service.port);
        if (pid) {
          info.pid = pid;
          info.running = true;
        }
      }

      // Look for log files in common locations
      const logFile = await this.findLogFile(service);
      if (logFile) {
        info.logFile = logFile;
      }

      serviceLogInfo.push(info);
    }

    return serviceLogInfo;
  }

  private async findLogFile(service: Service): Promise<string | undefined> {
    const possibleLogLocations = [
      `logs/${service.name}.log`,
      `${service.name}.log`,
      `logs/${service.name}/app.log`,
      `var/log/${service.name}.log`,
      `.switchr/logs/${service.name}.log`,
    ];

    for (const location of possibleLogLocations) {
      const fullPath = `${process.cwd()}/${location}`;
      try {
        const exists = await import('fs-extra').then(fs => fs.pathExists(fullPath));
        if (exists) {
          return fullPath;
        }
      } catch {
        continue;
      }
    }

    return undefined;
  }

  private async showLogs(serviceLogInfo: ServiceLogInfo[], flags: LogsCommandFlags): Promise<void> {
    if (flags.json) {
      await this.showLogsJson(serviceLogInfo, flags);
      return;
    }

    if (serviceLogInfo.length === 0) {
      this.log(chalk.yellow('📋 No services found'));
      return;
    }

    // Show header
    if (!flags.raw) {
      const sinceText = flags.since ? ` (since ${flags.since})` : '';
      this.log(chalk.blue(`📋 Service Logs${sinceText}\n`));
    }

    for (const serviceInfo of serviceLogInfo) {
      await this.showServiceLogs(serviceInfo, flags, serviceLogInfo);
    }

    if (!flags.raw && serviceLogInfo.length > 1) {
      this.log(
        chalk.gray(
          `\n💡 Use ${chalk.white(`switchr logs ${serviceLogInfo[0].name}`)} to view specific service logs`
        )
      );
      this.log(chalk.gray(`💡 Use ${chalk.white('switchr logs --follow')} to follow live logs`));
    }
  }

  private async showServiceLogs(
    serviceInfo: ServiceLogInfo,
    flags: LogsCommandFlags,
    allServiceInfo: ServiceLogInfo[]
  ): Promise<void> {
    if (!flags.raw) {
      const statusIcon = serviceInfo.running ? chalk.green('●') : chalk.red('●');
      const pidInfo = serviceInfo.pid ? chalk.gray(` (PID: ${serviceInfo.pid})`) : '';
      this.log(chalk.blue(`${statusIcon} ${serviceInfo.name}${pidInfo}`));
    }

    try {
      let logs: string[] = [];

      // Try to get logs from different sources
      if (serviceInfo.logFile) {
        logs = await this.readLogFile(serviceInfo.logFile, flags);
      } else if (serviceInfo.pid) {
        logs = await this.getProcessLogs(serviceInfo.pid, flags);
      } else {
        logs = await this.getDockerLogs(serviceInfo.name, flags);
      }

      if (logs.length === 0) {
        if (!flags.raw) {
          this.log(chalk.gray('   No logs found'));
        }
        return;
      }

      // Apply filters
      logs = this.applyFilters(logs, flags);

      // Limit output
      if (flags.tail && logs.length > flags.tail) {
        logs = logs.slice(-flags.tail);
      }

      // Display logs
      for (const log of logs) {
        this.displayLogLine(log, serviceInfo.name, flags);
      }

      if (!flags.raw && serviceInfo !== allServiceInfo[allServiceInfo.length - 1]) {
        this.log(''); // Add spacing between services
      }
    } catch (error) {
      if (!flags.raw) {
        this.log(
          chalk.gray(
            `   Error reading logs: ${error instanceof Error ? error.message : 'Unknown error'}`
          )
        );
      }
    }
  }

  private async readLogFile(logFile: string, flags: LogsCommandFlags): Promise<string[]> {
    const fs = await import('fs-extra');

    try {
      let content = await fs.readFile(logFile, 'utf8');

      // Apply time filter if specified
      if (flags.since) {
        content = this.filterLogsBySince(content, flags.since);
      }

      return content.split('\n').filter(line => line.trim());
    } catch (error) {
      logger.debug(`Failed to read log file ${logFile}`, error);
      return [];
    }
  }

  private async getProcessLogs(pid: number, flags: LogsCommandFlags): Promise<string[]> {
    try {
      // Try to get logs from journalctl on Linux
      if (process.platform === 'linux') {
        const args = ['--no-pager', '--lines', flags.tail?.toString() || '50', '_PID=' + pid];

        if (flags.since) {
          args.push('--since', this.convertSinceToJournalctlFormat(flags.since));
        }

        const result = await ProcessUtils.execute('journalctl', args);
        return result.stdout.split('\n').filter(line => line.trim());
      }

      // For other platforms, return empty (would need platform-specific implementations)
      return [];
    } catch (error) {
      logger.debug(`Failed to get process logs for PID ${pid}`, error);
      return [];
    }
  }

  private async getDockerLogs(serviceName: string, flags: LogsCommandFlags): Promise<string[]> {
    try {
      const args = ['logs'];

      if (flags.tail) {
        args.push('--tail', flags.tail.toString());
      }

      if (flags.since) {
        args.push('--since', flags.since);
      }

      args.push(serviceName);

      const result = await ProcessUtils.execute('docker', args);
      return result.stdout.split('\n').filter(line => line.trim());
    } catch (error) {
      logger.debug(`Failed to get Docker logs for ${serviceName}`, error);
      return [];
    }
  }

  private applyFilters(logs: string[], flags: LogsCommandFlags): string[] {
    let filteredLogs = logs;

    // Filter by log level
    if (flags.level) {
      const levelPattern = new RegExp(`\\b${flags.level}\\b`, 'i');
      filteredLogs = filteredLogs.filter(log => levelPattern.test(log));
    }

    // Filter by grep pattern
    if (flags.grep) {
      const grepPattern = new RegExp(flags.grep, 'i');
      filteredLogs = filteredLogs.filter(log => grepPattern.test(log));
    }

    return filteredLogs;
  }

  private displayLogLine(log: string, serviceName: string, flags: LogsCommandFlags): void {
    if (flags.raw) {
      this.log(log);
      return;
    }

    // Parse log line for better formatting
    const parsed = this.parseLogLine(log);

    let output = '';

    // Add timestamp if enabled and available
    if (flags.timestamps && parsed.timestamp) {
      output += chalk.gray(`[${parsed.timestamp.toISOString()}] `);
    }

    // Add service name for multi-service logs
    if (!this.parsedArgs.service) {
      // Show service name when viewing all services
      output += chalk.cyan(`[${serviceName}] `);
    }

    // Add log level coloring
    const coloredMessage = this.colorizeLogLevel(parsed.message, parsed.level);
    output += coloredMessage;

    this.log(output);
  }

  private parseLogLine(log: string): LogEntry {
    // Basic log parsing - would be enhanced for specific log formats
    const timestampMatch = log.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/);
    const levelMatch = log.match(/\b(DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\b/i);

    return {
      timestamp: timestampMatch ? new Date(timestampMatch[1]) : new Date(),
      service: '',
      level: levelMatch
        ? (levelMatch[1].toLowerCase() as 'debug' | 'info' | 'warn' | 'error')
        : 'info',
      message: log,
    };
  }

  private colorizeLogLevel(message: string, level: string): string {
    switch (level.toLowerCase()) {
      case 'error':
      case 'fatal':
        return chalk.red(message);
      case 'warn':
      case 'warning':
        return chalk.yellow(message);
      case 'debug':
        return chalk.gray(message);
      case 'info':
      default:
        return chalk.white(message);
    }
  }

  private async followLogs(
    serviceLogInfo: ServiceLogInfo[],
    flags: LogsCommandFlags
  ): Promise<void> {
    this.log(chalk.blue('📋 Following logs... (Press Ctrl+C to stop)\n'));

    // Start following logs for each service
    const followPromises = serviceLogInfo.map(async serviceInfo => {
      try {
        if (serviceInfo.logFile) {
          await this.followLogFile(serviceInfo, flags);
        } else {
          await this.followDockerLogs(serviceInfo, flags);
        }
      } catch (error) {
        if (!this.shouldStop) {
          logger.debug(`Failed to follow logs for ${serviceInfo.name}`, error);
        }
      }
    });

    // Wait for all follow operations (or until stopped)
    await Promise.race([Promise.all(followPromises), this.waitForStop()]);
  }

  private async followLogFile(serviceInfo: ServiceLogInfo, flags: LogsCommandFlags): Promise<void> {
    if (!serviceInfo.logFile) return;

    try {
      // Use tail -f equivalent
      const args = ['-f'];

      if (flags.tail) {
        args.push('-n', flags.tail.toString());
      }

      args.push(serviceInfo.logFile);

      const child = ProcessUtils.spawn('tail', args, {
        stdio: 'pipe',
      });

      if (child.stdout) {
        child.stdout.on('data', (data: Buffer) => {
          if (this.shouldStop) return;

          const lines = data
            .toString()
            .split('\n')
            .filter(line => line.trim());
          for (const line of lines) {
            const filteredLines = this.applyFilters([line], flags);
            if (filteredLines.length > 0) {
              this.displayLogLine(line, serviceInfo.name, flags);
            }
          }
        });
      }

      if (child.stderr) {
        child.stderr.on('data', (data: Buffer) => {
          if (!this.shouldStop) {
            logger.debug(`tail stderr: ${data.toString()}`);
          }
        });
      }

      // Wait until stopped
      while (!this.shouldStop) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      child.kill('SIGTERM');
    } catch (error) {
      logger.debug(`Failed to follow log file for ${serviceInfo.name}`, error);
    }
  }

  private async followDockerLogs(
    serviceInfo: ServiceLogInfo,
    flags: LogsCommandFlags
  ): Promise<void> {
    try {
      const args = ['logs', '-f'];

      if (flags.tail) {
        args.push('--tail', flags.tail.toString());
      }

      args.push(serviceInfo.name);

      const child = ProcessUtils.spawn('docker', args, {
        stdio: 'pipe',
      });

      if (child.stdout) {
        child.stdout.on('data', (data: Buffer) => {
          if (this.shouldStop) return;

          const lines = data
            .toString()
            .split('\n')
            .filter(line => line.trim());
          for (const line of lines) {
            const filteredLines = this.applyFilters([line], flags);
            if (filteredLines.length > 0) {
              this.displayLogLine(line, serviceInfo.name, flags);
            }
          }
        });
      }

      // Wait until stopped
      while (!this.shouldStop) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      child.kill('SIGTERM');
    } catch (error) {
      logger.debug(`Failed to follow Docker logs for ${serviceInfo.name}`, error);
    }
  }

  private setupSignalHandlers(): void {
    process.on('SIGINT', () => {
      this.shouldStop = true;
      this.log(chalk.yellow('\n📋 Stopping log follow...'));
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      this.shouldStop = true;
      process.exit(0);
    });
  }

  private async waitForStop(): Promise<void> {
    while (!this.shouldStop) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  private filterLogsBySince(content: string, since: string): string {
    const cutoffTime = this.parseSinceTime(since);
    if (!cutoffTime) return content;

    const lines = content.split('\n');
    return lines
      .filter(line => {
        const timestampMatch = line.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/);
        if (!timestampMatch) return true; // Include lines without timestamps

        const lineTime = new Date(timestampMatch[1]);
        return lineTime >= cutoffTime;
      })
      .join('\n');
  }

  private parseSinceTime(since: string): Date | null {
    const now = new Date();
    const match = since.match(/^(\d+)([hmsd])$/);

    if (!match) return null;

    const amount = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 's':
        return new Date(now.getTime() - amount * 1000);
      case 'm':
        return new Date(now.getTime() - amount * 60 * 1000);
      case 'h':
        return new Date(now.getTime() - amount * 60 * 60 * 1000);
      case 'd':
        return new Date(now.getTime() - amount * 24 * 60 * 60 * 1000);
      default:
        return null;
    }
  }

  private convertSinceToJournalctlFormat(since: string): string {
    // Convert our format to journalctl format
    const match = since.match(/^(\d+)([hmsd])$/);
    if (!match) return since;

    const amount = match[1];
    const unit = match[2];

    switch (unit) {
      case 's':
        return `${amount} seconds ago`;
      case 'm':
        return `${amount} minutes ago`;
      case 'h':
        return `${amount} hours ago`;
      case 'd':
        return `${amount} days ago`;
      default:
        return since;
    }
  }

  private async showLogsJson(
    serviceLogInfo: ServiceLogInfo[],
    flags: LogsCommandFlags
  ): Promise<void> {
    const logsData: Array<{
      service: string;
      timestamp?: string;
      level?: string;
      message?: string;
      pid?: number;
      error?: string;
    }> = [];

    for (const serviceInfo of serviceLogInfo) {
      try {
        let logs: string[] = [];

        if (serviceInfo.logFile) {
          logs = await this.readLogFile(serviceInfo.logFile, flags);
        } else if (serviceInfo.pid) {
          logs = await this.getProcessLogs(serviceInfo.pid, flags);
        } else {
          logs = await this.getDockerLogs(serviceInfo.name, flags);
        }

        logs = this.applyFilters(logs, flags);

        if (flags.tail && logs.length > flags.tail) {
          logs = logs.slice(-flags.tail);
        }

        for (const log of logs) {
          const parsed = this.parseLogLine(log);
          logsData.push({
            service: serviceInfo.name,
            timestamp: parsed.timestamp.toISOString(),
            level: parsed.level,
            message: parsed.message,
            ...(serviceInfo.pid !== undefined && { pid: serviceInfo.pid }),
          });
        }
      } catch (error) {
        logsData.push({
          service: serviceInfo.name,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Sort by timestamp
    logsData.sort((a, b) => {
      if (!a.timestamp || !b.timestamp) return 0;
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });

    this.log(JSON.stringify(logsData, null, 2));
  }
}
