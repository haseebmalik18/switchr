// src/commands/start.ts - Production-quality implementation
import { Command, Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import ora from 'ora';
import { ConfigManager } from '../core/ConfigManager';
import { ServiceDependencyResolver } from '../core/ServiceDependencyResolver';
import { ProcessUtils } from '../utils/ProcessUtils';
import { logger } from '../utils/Logger';
import { Service } from '../types/Project';
import { ServiceTemplateRegistry } from '../core/service/ServiceTemplateRegistry';

interface ServiceStartResult {
  service: string;
  success: boolean;
  error?: string;
  pid?: number;
  phase?: number;
}

interface PortConflict {
  service: string;
  port: number;
  pid?: number;
}

export default class Start extends Command {
  static override description = 'Start services for the current project';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> api',
    '<%= config.bin %> <%= command.id %> --all',
    '<%= config.bin %> <%= command.id %> --force',
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
    timeout: Flags.integer({
      description: 'Timeout in seconds for service startup',
      default: 30,
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

      const servicesToStart = this.determineServicesToStart(args.service, currentProject.services);

      this.log(
        chalk.blue(
          `🚀 Starting ${servicesToStart.length} service(s) for '${currentProject.name}'...\n`
        )
      );

      if (flags['dry-run']) {
        this.showDryRun(servicesToStart);
        return;
      }

      // Validate services before starting
      this.validateServices(servicesToStart);

      // Check for conflicts unless forced
      if (!flags.force) {
        await this.checkPortConflicts(servicesToStart);
      }

      // Start the services
      const results = await this.startServices(
        servicesToStart,
        currentProject.path,
        currentProject.environment,
        flags.timeout
      );

      // Show results
      this.showResults(results, servicesToStart);
    } catch (error) {
      logger.error('Failed to start services', error);
      this.error(
        `Failed to start services: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private determineServicesToStart(
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

  private validateServices(services: Service[]): void {
    const errors: string[] = [];

    for (const service of services) {
      // Validate service has either command or template
      if (!service.command && !service.template) {
        errors.push(`Service '${service.name}' has no command or template defined`);
      }

      // Validate command if present
      if (service.command && typeof service.command !== 'string') {
        errors.push(`Service '${service.name}' has invalid command type`);
      }

      // Validate port if present
      if (service.port !== undefined) {
        if (!Number.isInteger(service.port) || service.port < 1 || service.port > 65535) {
          errors.push(`Service '${service.name}' has invalid port: ${service.port}`);
        }
      }

      // Validate dependencies exist
      if (service.dependencies?.length) {
        const serviceNames = new Set(services.map(s => s.name));
        const invalidDeps = service.dependencies.filter(dep => !serviceNames.has(dep));
        if (invalidDeps.length > 0) {
          errors.push(
            `Service '${service.name}' has invalid dependencies: ${invalidDeps.join(', ')}`
          );
        }
      }
    }

    if (errors.length > 0) {
      this.error(`Service validation failed:\n${errors.map(e => `  • ${e}`).join('\n')}`);
    }
  }

  private showDryRun(services: Service[]): void {
    this.log(chalk.yellow('🧪 Dry run - services that would be started:\n'));

    services.forEach(service => {
      const command = this.getServiceCommand(service);
      this.log(chalk.gray(`   • ${chalk.white(service.name)}: ${command}`));

      if (service.port) {
        this.log(chalk.gray(`     Port: ${service.port}`));
      }

      if (service.workingDirectory) {
        this.log(chalk.gray(`     Working directory: ${service.workingDirectory}`));
      }

      if (service.dependencies?.length) {
        this.log(chalk.gray(`     Dependencies: ${service.dependencies.join(', ')}`));
      }

      this.log('');
    });

    this.log(chalk.yellow('💡 Run without --dry-run to start the services'));
  }

  private async checkPortConflicts(services: Service[]): Promise<void> {
    const conflicts: PortConflict[] = [];

    for (const service of services) {
      if (service.port) {
        const isAvailable = await ProcessUtils.isPortAvailable(service.port);
        if (!isAvailable) {
          const pid = await ProcessUtils.findProcessByPort(service.port);
          conflicts.push({
            service: service.name,
            port: service.port,
            ...(pid && { pid }),
          });
        }
      }
    }

    if (conflicts.length > 0) {
      this.log(chalk.red('❌ Port conflicts detected:\n'));
      conflicts.forEach(conflict => {
        const pidInfo = conflict.pid ? ` (PID: ${conflict.pid})` : '';
        this.log(chalk.red(`   • ${conflict.service} → port ${conflict.port}${pidInfo}`));
      });

      this.log(chalk.yellow(`\n💡 Solutions:`));
      this.log(chalk.gray(`   • Stop conflicting processes: ${chalk.white('switchr stop')}`));
      this.log(chalk.gray(`   • Use --force to start anyway`));
      this.log(chalk.gray(`   • Change ports in switchr.yml`));

      this.error('Cannot start services due to port conflicts');
    }
  }

  private async startServices(
    services: Service[],
    projectPath: string,
    projectEnvironment: Record<string, string> = {},
    timeoutSeconds: number = 30
  ): Promise<ServiceStartResult[]> {
    const results: ServiceStartResult[] = [];
    const spinner = ora('🚀 Starting services...').start();

    try {
      // Create dependency resolver and startup plan
      const resolver = new ServiceDependencyResolver(services);
      const startupPlan = resolver.createStartupPlan();

      spinner.text = `🚀 Starting ${services.length} service(s) in ${startupPlan.maxPhases} phases...`;

      // Show dependency tree if there are dependencies
      const hasDependencies = services.some(s => s.dependencies?.length);
      if (hasDependencies) {
        spinner.stop();
        this.log(chalk.blue('📊 Dependency-aware startup:'));
        startupPlan.phases.forEach((phase, index) => {
          const phaseNames = phase.map(s => s.name).join(', ');
          this.log(chalk.gray(`   Phase ${index + 1}: ${phaseNames}`));
        });
        this.log('');
        spinner.start();
      }

      // Start services phase by phase
      for (let phaseIndex = 0; phaseIndex < startupPlan.phases.length; phaseIndex++) {
        const phase = startupPlan.phases[phaseIndex];
        spinner.text = `🚀 Starting Phase ${phaseIndex + 1}/${startupPlan.maxPhases}: ${phase.map(s => s.name).join(', ')}...`;

        // Start all services in current phase in parallel
        const phaseResults = await Promise.allSettled(
          phase.map(async service => {
            try {
              const pid = await this.startService(
                service,
                projectPath,
                projectEnvironment,
                timeoutSeconds
              );
              return {
                service: service.name,
                success: true,
                pid,
                phase: phaseIndex + 1,
              };
            } catch (error) {
              return {
                service: service.name,
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                phase: phaseIndex + 1,
              };
            }
          })
        );

        // Process results
        phaseResults.forEach(result => {
          if (result.status === 'fulfilled') {
            results.push(result.value);
          } else {
            results.push({
              service: 'unknown',
              success: false,
              error: result.reason instanceof Error ? result.reason.message : 'Promise rejected',
              phase: phaseIndex + 1,
            });
          }
        });

        // Wait between phases for services to fully start
        if (phaseIndex < startupPlan.phases.length - 1) {
          await this.sleep(2000);
        }
      }

      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      if (failed === 0) {
        spinner.succeed(
          `🚀 Successfully started ${successful} service(s) across ${startupPlan.maxPhases} phases`
        );
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

  private async startService(
    service: Service,
    projectPath: string,
    projectEnvironment: Record<string, string> = {},
    timeoutSeconds: number = 30
  ): Promise<number> {
    const command = this.getServiceCommand(service);
    const { command: cmd, args } = ProcessUtils.parseCommand(command);

    // Combine project environment + service-specific environment
    const serviceEnv = {
      ...ProcessUtils.getEnvironmentVariables(), // Base system environment
      ...projectEnvironment, // Project-wide environment
      ...service.environment, // Service-specific environment (highest priority)
    };

    // Start the process
    const child = ProcessUtils.spawn(cmd, args, {
      cwd: service.workingDirectory || projectPath,
      env: serviceEnv,
      detached: true,
      stdio: 'ignore',
    });

    if (!child.pid) {
      throw new Error(`Failed to start process for ${service.name}: No PID returned`);
    }

    // Detach so it continues running
    child.unref();

    // Wait and verify it's still running
    await this.sleep(1000);

    if (!ProcessUtils.isProcessRunning(child.pid)) {
      throw new Error(`Service ${service.name} started but immediately crashed`);
    }

    // Wait for service to be ready (with timeout)
    await this.waitForServiceReady(service, timeoutSeconds);

    logger.debug(`Started service ${service.name} with PID ${child.pid}`);
    return child.pid;
  }

  private getServiceCommand(service: Service): string {
    if (service.command) {
      return service.command;
    }

    if (service.template) {
      // Generate command from service template
      try {
        const template = ServiceTemplateRegistry.getTemplate(service.template);
        if (!template) {
          throw new Error(`Service template '${service.template}' not found`);
        }

        // Use the template's getCommand method with service config
        const config = service.config || {};
        const command = template.getCommand(config);

        // Replace any additional placeholders that might not be handled by the template
        let finalCommand = command;

        // Replace service-specific placeholders
        if (service.port) {
          finalCommand = finalCommand.replace(/{{port}}/g, service.port.toString());
        }

        if (service.name) {
          finalCommand = finalCommand.replace(/{{name}}/g, service.name);
        }

        return finalCommand;
      } catch (error) {
        logger.error(`Failed to generate command from template '${service.template}':`, error);
        throw new Error(
          `Failed to generate command from service template '${service.template}': ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    throw new Error(`Service '${service.name}' has no command or template specified`);
  }

  private async waitForServiceReady(service: Service, timeoutSeconds: number): Promise<void> {
    if (!service.port) {
      // No port to check, assume ready after brief delay
      await this.sleep(500);
      return;
    }

    const startTime = Date.now();
    const timeoutMs = timeoutSeconds * 1000;

    while (Date.now() - startTime < timeoutMs) {
      const isPortReady = !(await ProcessUtils.isPortAvailable(service.port));
      if (isPortReady) {
        return; // Service is ready
      }
      await this.sleep(500);
    }

    throw new Error(
      `Service ${service.name} did not become ready within ${timeoutSeconds} seconds`
    );
  }

  private showResults(results: ServiceStartResult[], services: Service[]): void {
    this.log('');

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    // Show successful starts
    if (successful.length > 0) {
      this.log(chalk.green('✅ Started services:'));
      successful.forEach(result => {
        const service = services.find(s => s.name === result.service);
        const pidInfo = result.pid ? chalk.gray(` (PID: ${result.pid})`) : '';
        const phaseInfo = result.phase ? chalk.gray(` [Phase ${result.phase}]`) : '';
        const portInfo = service?.port ? chalk.blue(` → http://localhost:${service.port}`) : '';

        this.log(chalk.gray(`   • ${result.service}${phaseInfo}${pidInfo}${portInfo}`));
      });
      this.log('');
    }

    // Show failures
    if (failed.length > 0) {
      this.log(chalk.red('❌ Failed to start:'));
      failed.forEach(result => {
        this.log(chalk.gray(`   • ${result.service}: ${result.error}`));
      });
      this.log('');
    }

    // Show next steps
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
