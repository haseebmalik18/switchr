// src/commands/stop.ts - Complete file with TypeScript fixes
import { Command, Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import ora from 'ora';
import { ConfigManager } from '../core/ConfigManager';
import { ProcessUtils } from '../utils/ProcessUtils';
import { logger } from '../utils/Logger';
import { Service } from '../types/Project';

interface RunningService {
  name: string;
  pid: number;
  port?: number;
  command: string; // Keep as required string, but provide fallback
}

export default class Stop extends Command {
  static override description = 'Stop services for the current project';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> api',
    '<%= config.bin %> <%= command.id %> --all',
    '<%= config.bin %> <%= command.id %> --force',
  ];

  static override args = {
    service: Args.string({
      description: 'Specific service name to stop',
    }),
  };

  static override flags = {
    all: Flags.boolean({
      char: 'a',
      description: 'Stop all services (default behavior)',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Force stop with SIGKILL (skip graceful shutdown)',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Show what would be stopped without executing',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Stop);

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
        return;
      }

      const runningServices = await this.findRunningServices(currentProject.services);

      if (runningServices.length === 0) {
        this.log(chalk.yellow('📋 No running services found'));
        this.log(chalk.gray(`   Run ${chalk.white('switchr status')} to check service status`));
        return;
      }

      let servicesToStop: RunningService[] = [];

      if (args.service) {
        const service = runningServices.find(s => s.name === args.service);
        if (!service) {
          const availableRunning = runningServices.map(s => s.name).join(', ');
          this.error(
            `Service '${args.service}' is not running. Running services: ${availableRunning || 'none'}`
          );
        }
        servicesToStop = [service];
      } else {
        servicesToStop = runningServices;
      }

      this.log(
        chalk.blue(
          `🛑 Stopping ${servicesToStop.length} service(s) for '${currentProject.name}'...\n`
        )
      );

      if (flags['dry-run']) {
        this.showDryRun(servicesToStop);
        return;
      }

      const results = await this.stopServices(servicesToStop, flags.force);

      this.showResults(results);
    } catch (error) {
      logger.error('Failed to stop services', error);
      this.error(error instanceof Error ? error.message : 'Unknown error occurred');
    }
  }

  private async findRunningServices(services: Service[]): Promise<RunningService[]> {
    const running: RunningService[] = [];

    for (const service of services) {
      if (service.port) {
        const pid = await ProcessUtils.findProcessByPort(service.port);
        if (pid) {
          running.push({
            name: service.name,
            pid,
            port: service.port,
            command: service.command || `port-${service.port}`, // Provide fallback
          });
        }
      } else if (service.command) {
        // Add explicit check for command
        const pid = await this.findProcessByCommand(service.command);
        if (pid) {
          running.push({
            name: service.name,
            pid,
            command: service.command, // Guaranteed to be string here
          });
        }
      }
    }

    return running;
  }

  private async findProcessByCommand(command: string): Promise<number | null> {
    try {
      const isWindows = process.platform === 'win32';

      if (isWindows) {
        const result = await ProcessUtils.execute('tasklist', ['/fo', 'csv']);
        const lines = result.stdout.split('\n');

        for (const line of lines) {
          if (line.toLowerCase().includes(command.toLowerCase())) {
            const match = line.match(/"(\d+)"/);
            if (match) {
              return parseInt(match[1], 10);
            }
          }
        }
      } else {
        const result = await ProcessUtils.execute('pgrep', ['-f', command]);
        if (result.exitCode === 0 && result.stdout.trim()) {
          const pid = parseInt(result.stdout.trim().split('\n')[0], 10);
          if (!isNaN(pid)) {
            return pid;
          }
        }
      }
    } catch (error) {
      logger.debug(`Failed to find process by command: ${command}`, error);
    }

    return null;
  }

  private showDryRun(services: RunningService[]): void {
    this.log(chalk.yellow('🧪 Dry run - services that would be stopped:\n'));

    services.forEach(service => {
      this.log(chalk.gray(`   • ${chalk.white(service.name)} (PID: ${service.pid})`));
      if (service.command && !service.command.startsWith('port-')) {
        this.log(chalk.gray(`     Command: ${service.command}`));
      }
      if (service.port) {
        this.log(chalk.gray(`     Port: ${service.port}`));
      }
      this.log('');
    });

    this.log(chalk.yellow('💡 Run without --dry-run to stop the services'));
  }

  private async stopServices(
    services: RunningService[],
    force: boolean
  ): Promise<Array<{ service: string; success: boolean; error?: string }>> {
    const results: Array<{ service: string; success: boolean; error?: string }> = [];
    const spinner = ora('🛑 Stopping services...').start();

    try {
      const stopPromises = services.map(async service => {
        try {
          await this.stopService(service, force);
          return { service: service.name, success: true };
        } catch (error) {
          logger.debug(`Failed to stop service ${service.name}`, error);
          return {
            service: service.name,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      });

      const stopResults = await Promise.all(stopPromises);
      results.push(...stopResults);

      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      if (failed === 0) {
        spinner.succeed(`🛑 Successfully stopped ${successful} service(s)`);
      } else if (successful > 0) {
        spinner.warn(`🛑 Stopped ${successful}/${services.length} service(s) (${failed} failed)`);
      } else {
        spinner.fail('🛑 Failed to stop any services');
      }
    } catch (error) {
      spinner.fail('🛑 Failed to stop services');
      throw error;
    }

    return results;
  }

  private async stopService(service: RunningService, force: boolean): Promise<void> {
    const signal = force ? 'SIGKILL' : 'SIGTERM';

    try {
      await ProcessUtils.killProcess(service.pid, signal);

      if (!force) {
        await this.sleep(2000);

        if (ProcessUtils.isProcessRunning(service.pid)) {
          await ProcessUtils.killProcess(service.pid, 'SIGKILL');
          await this.sleep(1000);
        }
      }

      if (ProcessUtils.isProcessRunning(service.pid)) {
        throw new Error(`Process ${service.pid} is still running after kill attempt`);
      }

      logger.debug(`Successfully stopped service ${service.name} (PID: ${service.pid})`);
    } catch (error) {
      throw new Error(
        `Failed to stop service ${service.name}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private showResults(results: Array<{ service: string; success: boolean; error?: string }>): void {
    this.log('');

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    if (successful.length > 0) {
      this.log(chalk.green('✅ Stopped services:'));
      successful.forEach(result => {
        this.log(chalk.gray(`   • ${result.service}`));
      });
      this.log('');
    }

    if (failed.length > 0) {
      this.log(chalk.red('❌ Failed to stop:'));
      failed.forEach(result => {
        this.log(chalk.gray(`   • ${result.service}: ${result.error}`));
      });
      this.log('');
    }

    if (successful.length > 0) {
      this.log(chalk.blue('🎯 Next steps:'));
      this.log(chalk.gray(`   • Check status: ${chalk.white('switchr status')}`));
      this.log(chalk.gray(`   • Start services: ${chalk.white('switchr start')}`));
      this.log(chalk.gray(`   • Switch project: ${chalk.white('switchr switch <project>')}`));
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
