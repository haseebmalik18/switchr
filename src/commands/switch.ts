import { Command, Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import ora from 'ora';
import { ConfigManager } from '../core/ConfigManager';
import { ProcessUtils } from '../utils/ProcessUtils';
import { logger } from '../utils/Logger';
import { ProjectProfile, Service } from '../types/Project';
import { ServiceDependencyResolver } from '../core/ServiceDependencyResolver';

interface RunningService {
  name: string;
  pid: number;
  port?: number;
}

export default class Switch extends Command {
  static override description = 'Switch to a different project';

  static override examples = [
    '<%= config.bin %> <%= command.id %> my-project',
    '<%= config.bin %> <%= command.id %> my-project --force',
    '<%= config.bin %> <%= command.id %> my-project --no-stop',
  ];

  static override args = {
    project: Args.string({
      description: 'Project name to switch to',
      required: true,
    }),
  };

  static override flags = {
    force: Flags.boolean({
      char: 'f',
      description: 'Force switch even if current services fail to stop',
      default: false,
    }),
    'no-stop': Flags.boolean({
      description: 'Do not stop current project services',
      default: false,
    }),
    'no-start': Flags.boolean({
      description: 'Do not start new project services',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Show what would be done without executing',
      default: false,
    }),
  };

  private configManager!: ConfigManager;
  private runningServices: RunningService[] = [];

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Switch);

    this.configManager = ConfigManager.getInstance();

    try {
      // Validate target project exists
      const targetProject = await this.configManager.getProject(args.project);
      if (!targetProject) {
        this.error(
          `Project '${args.project}' not found. Run ${chalk.white('switchr list')} to see available projects.`
        );
      }

      // Check if already on target project
      const currentProject = await this.configManager.getCurrentProject();
      if (currentProject?.name === args.project) {
        this.log(chalk.yellow(`📋 Already on project '${args.project}'`));
        this.log(chalk.gray(`   Run ${chalk.white('switchr status')} to see current status`));
        return;
      }

      this.log(chalk.blue(`🔄 Switching to project '${args.project}'...\n`));

      if (flags['dry-run']) {
        await this.showDryRun(currentProject, targetProject, flags);
        return;
      }

      // Execute the switch
      await this.executeSwitch(currentProject, targetProject, flags);

      this.log(chalk.green(`\n✅ Successfully switched to '${args.project}'!`));
      this.showNextSteps();
    } catch (error) {
      logger.error('Failed to switch project', error);
      this.error(error instanceof Error ? error.message : 'Unknown error occurred');
    }
  }

  private async showDryRun(
    currentProject: ProjectProfile | null,
    targetProject: ProjectProfile,
    flags: any
  ): Promise<void> {
    this.log(chalk.yellow('🧪 Dry run - showing what would be executed:\n'));

    if (currentProject && !flags['no-stop']) {
      this.log(chalk.red('📱 Services to stop:'));
      if (currentProject.services.length > 0) {
        currentProject.services.forEach(service => {
          this.log(chalk.gray(`   • ${service.name}: ${service.command}`));
        });
      } else {
        this.log(chalk.gray('   (no services configured)'));
      }
      this.log('');
    }

    if (!flags['no-start']) {
      this.log(chalk.green('🚀 Services to start:'));
      if (targetProject.services.length > 0) {
        targetProject.services.forEach(service => {
          this.log(
            chalk.gray(
              `   • ${service.name}: ${service.command}${service.port ? ` (port ${service.port})` : ''}`
            )
          );
        });
      } else {
        this.log(chalk.gray('   (no services configured)'));
      }
      this.log('');
    }

    this.log(chalk.blue('🌍 Environment changes:'));
    const envVars = Object.keys(targetProject.environment);
    if (envVars.length > 0) {
      envVars.forEach(key => {
        this.log(chalk.gray(`   • ${key}=${targetProject.environment[key]}`));
      });
    } else {
      this.log(chalk.gray('   (no environment variables)'));
    }

    this.log(chalk.yellow('\n💡 Run without --dry-run to execute the switch'));
  }

  private async executeSwitch(
    currentProject: ProjectProfile | null,
    targetProject: ProjectProfile,
    flags: any
  ): Promise<void> {
    // Step 1: Stop current services
    if (currentProject && !flags['no-stop']) {
      await this.stopCurrentServices(currentProject, flags.force);
    }

    // Step 2: Update current project in config (no global env setting)
    await this.configManager.setCurrentProject(targetProject.name);

    // Step 3: Start new services with their environment
    if (!flags['no-start']) {
      await this.startProjectServices(targetProject);
    }
  }

  private async stopCurrentServices(currentProject: ProjectProfile, force: boolean): Promise<void> {
    if (currentProject.services.length === 0) {
      this.log(chalk.gray('📱 No current services to stop\n'));
      return;
    }

    const spinner = ora('📱 Stopping current services...').start();

    try {
      this.runningServices = await this.findRunningServices(currentProject.services);

      if (this.runningServices.length === 0) {
        spinner.succeed('📱 No running services found');
        return;
      }

      spinner.text = `📱 Stopping ${this.runningServices.length} service(s)...`;

      const stopPromises = this.runningServices.map(async service => {
        try {
          await this.stopService(service);
          return { service: service.name, success: true };
        } catch (error) {
          logger.debug(`Failed to stop service ${service.name}`, error);
          return { service: service.name, success: false, error };
        }
      });

      const results = await Promise.all(stopPromises);
      const failed = results.filter(r => !r.success);

      if (failed.length > 0 && !force) {
        spinner.fail(`📱 Failed to stop ${failed.length} service(s)`);
        failed.forEach(f => {
          this.log(chalk.red(`   ✗ ${f.service}`));
        });
        throw new Error(`Failed to stop services. Use --force to continue anyway.`);
      } else if (failed.length > 0 && force) {
        spinner.warn(`📱 Stopped services (${failed.length} failed, continuing with --force)`);
      } else {
        spinner.succeed(`📱 Stopped ${this.runningServices.length} service(s)`);
      }
    } catch (error) {
      spinner.fail('📱 Failed to stop current services');
      throw error;
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
          });
        }
      }
    }

    return running;
  }

  private async stopService(service: RunningService): Promise<void> {
    try {
      // Try graceful shutdown first
      await ProcessUtils.killProcess(service.pid, 'SIGTERM');

      // Wait a bit for graceful shutdown
      await this.sleep(2000);

      // Check if still running
      if (ProcessUtils.isProcessRunning(service.pid)) {
        // Force kill if still running
        await ProcessUtils.killProcess(service.pid, 'SIGKILL');
        await this.sleep(1000);
      }

      logger.debug(`Successfully stopped service ${service.name} (PID: ${service.pid})`);
    } catch (error) {
      throw new Error(
        `Failed to stop service ${service.name}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async setEnvironmentVariables(project: ProjectProfile): Promise<void> {
    const envVars = Object.keys(project.environment);

    if (envVars.length === 0) {
      this.log(chalk.gray('🌍 No environment variables to set\n'));
      return;
    }

    const spinner = ora(`🌍 Setting ${envVars.length} environment variable(s)...`).start();

    try {
      for (const [key, value] of Object.entries(project.environment)) {
        ProcessUtils.setEnvironmentVariable(key, value);
      }

      spinner.succeed(`🌍 Set ${envVars.length} environment variable(s)`);

      if (envVars.length <= 5) {
        envVars.forEach(key => {
          this.log(chalk.gray(`   • ${key}=${project.environment[key]}`));
        });
      } else {
        this.log(
          chalk.gray(`   • ${envVars.slice(0, 3).join(', ')} and ${envVars.length - 3} more...`)
        );
      }
    } catch (error) {
      spinner.fail('🌍 Failed to set environment variables');
      throw error;
    }
  }

  private async startProjectServices(project: ProjectProfile): Promise<void> {
    if (project.services.length === 0) {
      this.log(chalk.gray('🚀 No services to start\n'));
      return;
    }

    const spinner = ora(`🚀 Starting ${project.services.length} service(s)...`).start();

    try {
      // Check for port conflicts
      await this.checkPortConflicts(project.services);

      // Create dependency resolver and startup plan
      const resolver = new ServiceDependencyResolver(project.services);
      const startupPlan = resolver.createStartupPlan();

      spinner.text = `🚀 Starting ${project.services.length} service(s) in ${startupPlan.maxPhases} phases...`;

      // Show dependency tree in verbose mode or if there are dependencies
      const hasDependencies = project.services.some(
        s => s.dependencies && s.dependencies.length > 0
      );
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
      const allResults: Array<{
        service: string;
        success: boolean;
        error?: string;
        phase: number;
      }> = [];

      for (let phaseIndex = 0; phaseIndex < startupPlan.phases.length; phaseIndex++) {
        const phase = startupPlan.phases[phaseIndex];
        spinner.text = `🚀 Starting Phase ${phaseIndex + 1}/${startupPlan.maxPhases}: ${phase.map(s => s.name).join(', ')}...`;

        // Start all services in current phase in parallel
        const phaseResults = await Promise.all(
          phase.map(async service => {
            try {
              await this.startService(service, project.path, project.environment);
              return { service: service.name, success: true, phase: phaseIndex + 1 };
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

        allResults.push(...phaseResults);

        // Wait between phases for services to fully start
        if (phaseIndex < startupPlan.phases.length - 1) {
          await this.sleep(2000);
        }
      }

      const successful = allResults.filter(r => r.success).length;
      const failed = allResults.filter(r => !r.success);

      if (failed.length === 0) {
        spinner.succeed(
          `🚀 Started ${successful} service(s) across ${startupPlan.maxPhases} phases`
        );
      } else {
        spinner.warn(
          `🚀 Started ${successful}/${project.services.length} service(s) (${failed.length} failed)`
        );
        failed.forEach(f => {
          this.log(chalk.yellow(`   ⚠ Phase ${f.phase} - ${f.service}: ${f.error}`));
        });
      }

      // Show running services
      const successfulResults = allResults.filter(r => r.success);
      if (successfulResults.length > 0) {
        this.log('');
        successfulResults.forEach(result => {
          const service = project.services.find(s => s.name === result.service);
          const phaseInfo = chalk.gray(`[Phase ${result.phase}]`);
          const portInfo = service?.port ? chalk.blue(` → http://localhost:${service.port}`) : '';
          this.log(chalk.gray(`   • ${result.service} ${phaseInfo}${portInfo}`));
        });
      }
    } catch (error) {
      spinner.fail('🚀 Failed to start services');
      throw error;
    }
  }

  private async checkPortConflicts(services: Service[]): Promise<void> {
    const conflicts: { service: string; port: number }[] = [];

    for (const service of services) {
      if (service.port) {
        const isAvailable = await ProcessUtils.isPortAvailable(service.port);
        if (!isAvailable) {
          conflicts.push({ service: service.name, port: service.port });
        }
      }
    }

    if (conflicts.length > 0) {
      throw new Error(
        `Port conflicts detected: ${conflicts.map(c => `${c.service} (port ${c.port})`).join(', ')}`
      );
    }
  }

  private async startService(
    service: Service,
    workingDir: string,
    projectEnvironment: Record<string, string> = {}
  ): Promise<void> {
    const { command, args } = ProcessUtils.parseCommand(service.command);

    // Combine project environment + service-specific environment
    const serviceEnv = {
      ...ProcessUtils.getEnvironmentVariables(), // Base system environment
      ...projectEnvironment, // Project-wide environment
      ...service.environment, // Service-specific environment (highest priority)
    };

    const child = ProcessUtils.spawn(command, args, {
      cwd: service.workingDirectory || workingDir,
      env: serviceEnv,
      detached: true,
      stdio: 'ignore',
    });

    // Detach the child process so it continues running
    child.unref();

    logger.debug(`Started service ${service.name} with command: ${service.command}`);
    logger.debug(`Environment variables: ${Object.keys(serviceEnv).join(', ')}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private showNextSteps(): void {
    this.log(chalk.blue('\n🎯 Next steps:'));
    this.log(chalk.gray(`   • Check status: ${chalk.white('switchr status')}`));
    this.log(chalk.gray(`   • View services: ${chalk.white('switchr status --verbose')}`));
    this.log(chalk.gray(`   • Open project: ${chalk.white('code .')}`));
    this.log(chalk.gray(`   • Stop services: ${chalk.white('switchr stop')}`));
  }
}
