import { Command, Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import ora from 'ora';
import { ConfigManager } from '../core/ConfigManager';
import { ProcessUtils } from '../utils/ProcessUtils';
import { logger } from '../utils/Logger';
import { Service } from '../types/Project';

export default class Start extends Command {
  static override description = 'Start services for the current project';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> api',
    '<%= config.bin %> <%= command.id %> --all',
  ];

  static override args = {
    service: Args.string({
      description: 'Specific service name to start',
    }),
  };

  static override flags = {
    all: Flags.boolean({
      char: 'a',
      description: 'Start all services (default behavior)',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Force start even if ports are in use',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Show what would be started without executing',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Start);

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

      let servicesToStart: Service[] = [];

      if (args.service) {
        const service = currentProject.services.find(s => s.name === args.service);
        if (!service) {
          this.error(
            `Service '${args.service}' not found. Available services: ${currentProject.services.map(s => s.name).join(', ')}`
          );
        }
        servicesToStart = [service];
      } else {
        servicesToStart = currentProject.services;
      }

      this.log(
        chalk.blue(
          `🚀 Starting ${servicesToStart.length} service(s) for '${currentProject.name}'...\n`
        )
      );

      if (flags['dry-run']) {
        this.showDryRun(servicesToStart);
        return;
      }

      if (!flags.force) {
        await this.checkPortConflicts(servicesToStart);
      }

      const results = await this.startServices(servicesToStart, currentProject.path);

      this.showResults(results, servicesToStart);
    } catch (error) {
      logger.error('Failed to start services', error);
      this.error(error instanceof Error ? error.message : 'Unknown error occurred');
    }
  }

  private showDryRun(services: Service[]): void {
    this.log(chalk.yellow('🧪 Dry run - services that would be started:\n'));

    services.forEach(service => {
      this.log(chalk.gray(`   • ${chalk.white(service.name)}: ${service.command}`));
      if (service.port) {
        this.log(chalk.gray(`     Port: ${service.port}`));
      }
      if (service.workingDirectory) {
        this.log(chalk.gray(`     Working directory: ${service.workingDirectory}`));
      }
      if (service.dependencies && service.dependencies.length > 0) {
        this.log(chalk.gray(`     Dependencies: ${service.dependencies.join(', ')}`));
      }
      this.log('');
    });

    this.log(chalk.yellow('💡 Run without --dry-run to start the services'));
  }

  private async checkPortConflicts(services: Service[]): Promise<void> {
    const conflicts: Array<{ service: string; port: number; pid?: number }> = [];

    for (const service of services) {
      if (service.port) {
        const isAvailable = await ProcessUtils.isPortAvailable(service.port);
        if (!isAvailable) {
          const pid = await ProcessUtils.findProcessByPort(service.port);

          const conflict: { service: string; port: number; pid?: number } = {
            service: service.name,
            port: service.port,
          };

          if (pid) {
            conflict.pid = pid;
          }

          conflicts.push(conflict);
        }
      }
    }

    if (conflicts.length > 0) {
      this.log(chalk.red('❌ Port conflicts detected:\n'));
      conflicts.forEach(conflict => {
        this.log(
          chalk.red(
            `   • ${conflict.service} → port ${conflict.port}${conflict.pid ? ` (PID: ${conflict.pid})` : ''}`
          )
        );
      });

      this.log(chalk.yellow(`\n💡 Solutions:`));
      this.log(chalk.gray(`   • Stop conflicting processes: ${chalk.white('switchr stop')}`));
      this.log(chalk.gray(`   • Use --force to start anyway`));
      this.log(chalk.gray(`   • Change ports in switchr.yml`));

      throw new Error('Cannot start services due to port conflicts');
    }
  }

  private async startServices(
    services: Service[],
    projectPath: string
  ): Promise<Array<{ service: string; success: boolean; error?: string; pid?: number }>> {
    const results: Array<{ service: string; success: boolean; error?: string; pid?: number }> = [];
    const spinner = ora('🚀 Starting services...').start();

    try {
      // TODO: Implement proper dependency resolution
      for (let i = 0; i < services.length; i++) {
        const service = services[i];
        spinner.text = `🚀 Starting ${service.name} (${i + 1}/${services.length})...`;

        try {
          const pid = await this.startService(service, projectPath);
          results.push({
            service: service.name,
            success: true,
            pid,
          });

          if (i < services.length - 1) {
            await this.sleep(1500);
          }
        } catch (error) {
          results.push({
            service: service.name,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      if (failed === 0) {
        spinner.succeed(`🚀 Successfully started ${successful} service(s)`);
      } else if (successful > 0) {
        spinner.warn(`🚀 Started ${successful}/${services.length} service(s) (${failed} failed)`);
      } else {
        spinner.fail('🚀 Failed to start any services');
      }
    } catch (error) {
      spinner.fail('🚀 Failed to start services');
      throw error;
    }

    return results;
  }

  private async startService(service: Service, projectPath: string): Promise<number> {
    const { command, args } = ProcessUtils.parseCommand(service.command);

    const env = {
      ...ProcessUtils.getEnvironmentVariables(),
      ...service.environment,
    };

    const child = ProcessUtils.spawn(command, args, {
      cwd: service.workingDirectory || projectPath,
      env,
      detached: true,
      stdio: 'ignore',
    });

    if (!child.pid) {
      throw new Error(`Failed to start process for ${service.name}`);
    }

    child.unref();

    await this.sleep(500);

    if (!ProcessUtils.isProcessRunning(child.pid)) {
      throw new Error(`Process for ${service.name} started but immediately crashed`);
    }

    logger.debug(`Started service ${service.name} with PID ${child.pid}`);
    return child.pid;
  }

  private showResults(
    results: Array<{ service: string; success: boolean; error?: string; pid?: number }>,
    services: Service[]
  ): void {
    this.log('');

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    if (successful.length > 0) {
      this.log(chalk.green('✅ Started services:'));
      successful.forEach(result => {
        const service = services.find(s => s.name === result.service);
        const pidInfo = result.pid ? chalk.gray(` (PID: ${result.pid})`) : '';
        const portInfo = service?.port ? chalk.blue(` → http://localhost:${service.port}`) : '';

        this.log(chalk.gray(`   • ${result.service}${pidInfo}${portInfo}`));
      });
      this.log('');
    }

    if (failed.length > 0) {
      this.log(chalk.red('❌ Failed to start:'));
      failed.forEach(result => {
        this.log(chalk.gray(`   • ${result.service}: ${result.error}`));
      });
      this.log('');
    }

    if (successful.length > 0) {
      this.log(chalk.blue('🎯 Next steps:'));
      this.log(chalk.gray(`   • Check status: ${chalk.white('switchr status')}`));
      this.log(chalk.gray(`   • View logs: Check your terminal or service logs`));
      this.log(chalk.gray(`   • Stop services: ${chalk.white('switchr stop')}`));
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
