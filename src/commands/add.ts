// src/commands/add.ts - Fixed version with exactOptionalPropertyTypes support
import { Command, Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import ora from 'ora';
import { ConfigManager } from '../core/ConfigManager';
import { PackageManager, type AddPackageOptions } from '../core/PackageManager';
import { RuntimeRegistry } from '../core/runtime/RuntimeRegistry';
import { ServiceTemplateRegistry } from '../core/service/ServiceTemplateRegistry';
import { logger } from '../utils/Logger';
import { PackageType, PackageInstallResult } from '../types/Package';
import { RuntimeType } from '../types/Runtime';
import path from 'path';

interface AddCommandFlags {
  dev: boolean;
  global: boolean;
  optional: boolean;
  config: string[] | undefined;
  force: boolean;
  runtime: string | undefined;
  manager: string | undefined;
  'dry-run': boolean;
  'skip-if-exists': boolean;
  type: string | undefined;
}

export default class Add extends Command {
  static override description = 'Add packages, runtimes, or services to the current project';

  static override examples = [
    // Runtime examples
    '<%= config.bin %> <%= command.id %> nodejs@18.17.0',
    '<%= config.bin %> <%= command.id %> python@3.11.5',
    '<%= config.bin %> <%= command.id %> go@1.21.3',

    // Service examples
    '<%= config.bin %> <%= command.id %> postgresql@15',
    '<%= config.bin %> <%= command.id %> redis@7 --config port=6380',
    '<%= config.bin %> <%= command.id %> mongodb@6 --config username=admin password=secret',

    // Dependency examples
    '<%= config.bin %> <%= command.id %> express@4.18.0',
    '<%= config.bin %> <%= command.id %> typescript@5.0.0 --dev',
    '<%= config.bin %> <%= command.id %> eslint --dev --global',
    '<%= config.bin %> <%= command.id %> django --runtime python',
  ];

  static override args = {
    package: Args.string({
      description: 'Package to add (name@version format)',
      required: true,
    }),
  };

  static override flags = {
    dev: Flags.boolean({
      char: 'd',
      description: 'Add as development dependency',
      default: false,
    }),
    global: Flags.boolean({
      char: 'g',
      description: 'Install globally',
      default: false,
    }),
    optional: Flags.boolean({
      description: 'Mark as optional dependency',
      default: false,
    }),
    config: Flags.string({
      char: 'c',
      description: 'Service configuration (key=value pairs)',
      multiple: true,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Force installation even if already exists',
      default: false,
    }),
    runtime: Flags.string({
      char: 'r',
      description: 'Specify runtime for dependency (nodejs, python, etc.)',
    }),
    manager: Flags.string({
      char: 'm',
      description: 'Specify version manager (nvm, fnm, pyenv, etc.)',
    }),
    'dry-run': Flags.boolean({
      description: 'Show what would be added without executing',
      default: false,
    }),
    'skip-if-exists': Flags.boolean({
      description: 'Skip installation if package already exists',
      default: false,
    }),
    type: Flags.string({
      char: 't',
      description: 'Force package type',
      options: ['runtime', 'service', 'dependency'],
    }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Add);

    try {
      // Initialize registries
      await this.initializeRegistries();

      const configManager = ConfigManager.getInstance();
      const currentProject = await configManager.getCurrentProject();

      if (!currentProject) {
        this.error(
          `No active project. Run ${chalk.white('switchr switch <project-name>')} to activate a project.`
        );
      }

      this.log(chalk.blue(`📦 Adding package: ${chalk.bold(args.package)}`));

      if (flags['dry-run']) {
        await this.showDryRun(args.package, flags);
        return;
      }

      const packageManager = new PackageManager({
        projectPath: process.cwd(),
        cacheDir: path.join(process.cwd(), '.switchr', 'cache'),
      });

      // Build options object conditionally to satisfy exactOptionalPropertyTypes
      const options: AddPackageOptions = {
        dev: flags.dev,
        global: flags.global,
        optional: flags.optional,
        force: flags.force,
        skipIfExists: flags['skip-if-exists'],
        ...(flags.runtime && { runtime: flags.runtime }),
        ...(flags.manager && { manager: flags.manager }),
      };

      const packageSpec = args.package;

      const result = await packageManager.addPackage(packageSpec, options);

      if (result.success) {
        this.log(chalk.green(`✅ Successfully added ${packageSpec}`));

        if (result.warnings && result.warnings.length > 0) {
          result.warnings.forEach(warning => {
            this.log(chalk.yellow(`⚠️  ${warning}`));
          });
        }

        // Show what was added
        await this.showAddedPackage(result);

        // Show next steps
        this.showNextSteps(result.package.name, result.package.type);
      } else {
        this.error(result.error || 'Failed to add package');
      }
    } catch (error) {
      logger.error('Failed to add package', error);
      this.error(error instanceof Error ? error.message : 'Unknown error occurred');
    }
  }

  private async initializeRegistries(): Promise<void> {
    const spinner = ora('Initializing package registries...').start();

    try {
      await RuntimeRegistry.initialize();
      await ServiceTemplateRegistry.initialize();
      spinner.succeed('Package registries initialized');
    } catch (error) {
      spinner.fail('Failed to initialize registries');
      throw error;
    }
  }

  private async showDryRun(packageSpec: string, flags: AddCommandFlags): Promise<void> {
    this.log(chalk.yellow('🧪 Dry run - showing what would be added:\n'));

    const [name, packageVersion] = packageSpec.split('@');
    const packageType = await this.detectPackageType(name, flags);

    this.log(chalk.blue(`📦 Package: ${chalk.white(name)}`));
    this.log(chalk.gray(`   Type: ${packageType}`));

    if (packageVersion) {
      this.log(chalk.gray(`   Version: ${packageVersion}`));
    }

    if (flags.config && flags.config.length > 0) {
      this.log(chalk.gray(`   Config: ${flags.config.join(', ')}`));
    }

    switch (packageType) {
      case 'runtime':
        await this.showRuntimeDryRun(name, packageVersion);
        break;
      case 'service':
        await this.showServiceDryRun(name);
        break;
      case 'dependency':
        await this.showDependencyDryRun(name, flags, packageVersion);
        break;
      default:
        this.log(chalk.gray(`   Installation: Standard package installation`));
    }

    this.log(chalk.yellow('\n💡 Run without --dry-run to execute the installation'));
  }

  private async showRuntimeDryRun(name: string, packageVersion?: string): Promise<void> {
    if (!RuntimeRegistry.isSupported(name)) {
      this.log(chalk.red(`   ❌ Unsupported runtime: ${name}`));
      this.log(
        chalk.gray(`   Supported runtimes: ${RuntimeRegistry.getRegisteredTypes().join(', ')}`)
      );
      return;
    }

    try {
      const tempManager = RuntimeRegistry.create(name as RuntimeType, process.cwd(), '/tmp');
      const availableManagers = await tempManager.getAvailableManagers();
      const bestManager = availableManagers.find(m => m.available);

      if (!bestManager) {
        this.log(chalk.red(`   ❌ No version manager available for ${name}`));
        this.log(chalk.gray(`   Install one of: ${availableManagers.map(m => m.name).join(', ')}`));
        return;
      }

      this.log(chalk.green(`   ✅ Version manager: ${bestManager.name} (${bestManager.version})`));

      if (packageVersion) {
        const isInstalled = await tempManager.isInstalled(packageVersion);
        this.log(
          chalk.gray(
            `   Current status: ${isInstalled ? 'Already installed' : 'Will be installed'}`
          )
        );
      }

      const availableVersions = await tempManager.listAvailable();
      if (availableVersions.length > 0) {
        this.log(
          chalk.gray(
            `   Available versions: ${availableVersions.slice(0, 5).join(', ')}${availableVersions.length > 5 ? '...' : ''}`
          )
        );
      }
    } catch (error) {
      this.log(
        chalk.yellow(
          `   ⚠️  Could not check runtime details: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  private async showServiceDryRun(name: string): Promise<void> {
    const template = ServiceTemplateRegistry.getTemplate(name);

    if (!template) {
      this.log(chalk.red(`   ❌ Unknown service template: ${name}`));

      // Show suggestions
      const allTemplates = ServiceTemplateRegistry.getAllTemplates();
      const suggestions = allTemplates
        .filter(t => t.name.includes(name) || name.includes(t.name))
        .slice(0, 3);

      if (suggestions.length > 0) {
        this.log(chalk.gray(`   Did you mean: ${suggestions.map(t => t.name).join(', ')}?`));
      } else {
        this.log(
          chalk.gray(
            `   Available services: ${allTemplates
              .slice(0, 5)
              .map(t => t.name)
              .join(', ')}`
          )
        );
      }
      return;
    }

    const templateInfo = template.getTemplate();
    this.log(chalk.green(`   ✅ Service template: ${templateInfo.description}`));
    this.log(chalk.gray(`   Category: ${templateInfo.category}`));
    this.log(chalk.gray(`   Default version: ${templateInfo.version}`));

    if (templateInfo.ports.length > 0) {
      this.log(chalk.gray(`   Default ports: ${templateInfo.ports.join(', ')}`));
    }

    if (templateInfo.dependencies && templateInfo.dependencies.length > 0) {
      this.log(chalk.gray(`   Dependencies: ${templateInfo.dependencies.join(', ')}`));
    }
  }

  private async showDependencyDryRun(
    _name: string,
    flags: AddCommandFlags,
    packageVersion?: string
  ): Promise<void> {
    const runtime = flags.runtime || (await this.detectProjectRuntime());

    if (!runtime) {
      this.log(chalk.red(`   ❌ Cannot determine runtime for dependency`));
      this.log(chalk.gray(`   Use --runtime flag to specify (nodejs, python, go, etc.)`));
      return;
    }

    this.log(chalk.green(`   ✅ Runtime: ${runtime}`));

    // Show package manager that would be used
    const packageManager = await this.getPackageManagerForRuntime(runtime);
    this.log(chalk.gray(`   Package manager: ${packageManager}`));

    if (flags.dev) {
      this.log(chalk.gray(`   Will be added as development dependency`));
    }

    if (packageVersion) {
      this.log(chalk.gray(`   Version: ${packageVersion}`));
    }
  }

  private async showAddedPackage(result: PackageInstallResult): Promise<void> {
    const { package: pkg, installedVersion, installPath } = result;

    this.log(chalk.blue('\n📋 Package Details:'));
    this.log(chalk.gray(`   Name: ${pkg.name}`));
    this.log(chalk.gray(`   Type: ${pkg.type}`));

    if (installedVersion) {
      this.log(chalk.gray(`   Installed version: ${installedVersion}`));
    }

    if (installPath) {
      this.log(chalk.gray(`   Install path: ${installPath}`));
    }

    if (pkg.type === 'runtime') {
      await this.showRuntimeStatus(pkg.name, installedVersion || 'unknown');
    } else if (pkg.type === 'service') {
      await this.showServiceStatus(pkg.name);
    }
  }

  private async showRuntimeStatus(runtimeName: string, installedVersion: string): Promise<void> {
    try {
      const manager = RuntimeRegistry.create(runtimeName as RuntimeType, process.cwd(), '/tmp');
      const env = await manager.getCurrentVersion();

      if (env) {
        this.log(chalk.gray(`   Status: ${chalk.green('Active')}`));
        this.log(chalk.gray(`   Binary path: ${env.binPath}`));
        this.log(chalk.gray(`   Installed version: ${installedVersion}`));

        // Show environment variables that will be set
        if (Object.keys(env.envVars).length > 0) {
          this.log(chalk.gray(`   Environment variables:`));
          Object.entries(env.envVars)
            .slice(0, 3)
            .forEach(([key, value]) => {
              this.log(chalk.gray(`     ${key}=${value}`));
            });
        }
      }
    } catch (error) {
      this.log(chalk.gray(`   Status: ${chalk.yellow('Installed but not active')}`));
      this.log(chalk.gray(`   Version: ${installedVersion}`));
    }
  }

  private async showServiceStatus(_serviceName: string): Promise<void> {
    this.log(chalk.gray(`   Status: ${chalk.yellow('Ready to start')}`));
    this.log(chalk.gray(`   Use 'switchr start' to run services`));
  }

  private async detectPackageType(name: string, flags: AddCommandFlags): Promise<PackageType> {
    // Explicit type from flags
    if (flags.type) return flags.type as PackageType;

    // Runtime detection
    if (RuntimeRegistry.isSupported(name)) {
      return 'runtime';
    }

    // Service detection
    if (ServiceTemplateRegistry.hasTemplate(name)) {
      return 'service';
    }

    // Popular service aliases
    const serviceAliases = [
      'postgres',
      'postgresql',
      'mysql',
      'mariadb',
      'redis',
      'memcached',
      'mongodb',
      'mongo',
      'elasticsearch',
      'opensearch',
      'rabbitmq',
      'kafka',
      'nginx',
      'apache',
      'caddy',
    ];

    if (serviceAliases.includes(name.toLowerCase())) {
      return 'service';
    }

    // Default to dependency
    return 'dependency';
  }

  private async detectProjectRuntime(): Promise<string | null> {
    try {
      const detectedRuntimes = await RuntimeRegistry.detectProjectRuntime(process.cwd());
      return detectedRuntimes[0] || null;
    } catch {
      return null;
    }
  }

  private async getPackageManagerForRuntime(runtime: string): Promise<string> {
    switch (runtime) {
      case 'nodejs':
        return await this.detectNodePackageManager();
      case 'python':
        return 'pip';
      case 'go':
        return 'go mod';
      case 'java':
        return 'maven';
      case 'rust':
        return 'cargo';
      default:
        return 'unknown';
    }
  }

  private async detectNodePackageManager(): Promise<string> {
    const fs = await import('fs-extra');
    const projectPath = process.cwd();

    const lockFiles = [
      { file: 'yarn.lock', manager: 'yarn' },
      { file: 'pnpm-lock.yaml', manager: 'pnpm' },
      { file: 'package-lock.json', manager: 'npm' },
    ];

    for (const { file, manager } of lockFiles) {
      const lockPath = `${projectPath}/${file}`;
      try {
        const exists = await fs.pathExists(lockPath);
        if (exists) return manager;
      } catch {
        continue;
      }
    }

    return 'npm'; // Default fallback
  }

  private showNextSteps(packageName: string, packageType: PackageType): void {
    this.log(chalk.blue('\n🎯 Next steps:'));

    switch (packageType) {
      case 'runtime':
        this.log(chalk.gray(`   • Restart your shell or run: ${chalk.white('exec $SHELL')}`));
        this.log(
          chalk.gray(`   • Verify installation: ${chalk.white(`${packageName} --version`)}`)
        );
        this.log(chalk.gray(`   • Check project status: ${chalk.white('switchr status')}`));
        break;

      case 'service':
        this.log(chalk.gray(`   • Start services: ${chalk.white('switchr start')}`));
        this.log(chalk.gray(`   • Check service status: ${chalk.white('switchr status')}`));
        this.log(chalk.gray(`   • View service logs: ${chalk.white('switchr logs')}`));
        break;

      case 'dependency':
        this.log(chalk.gray(`   • Check project status: ${chalk.white('switchr status')}`));
        this.log(
          chalk.gray(`   • Install other dependencies: ${chalk.white('switchr add <package>')}`)
        );
        break;
    }

    this.log(chalk.gray(`   • View all packages: ${chalk.white('switchr packages')}`));
    this.log(chalk.gray(`   • Switch projects: ${chalk.white('switchr switch <project>')}`));
  }

  // TODO: Will be needed for advanced service configuration parsing
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // @ts-expect-error - Method reserved for future use
  private _parseServiceConfig(_configString: string): Record<string, unknown> {
    // This method will be used to parse complex service configuration
    // from command line arguments in a future update
    return {};
  }
}
