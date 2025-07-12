import { Command, Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import { ConfigManager } from '../core/ConfigManager';
import { PackageManager } from '../core/PackageManager';
import { ServiceTemplateRegistry } from '../core/service/ServiceTemplateRegistry';
import { RuntimeRegistry } from '../core/runtime/RuntimeRegistry';
import { logger } from '../utils/Logger';

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
    'dry-run': Flags.boolean({
      description: 'Show what would be added without executing',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Add);

    try {
      await ServiceTemplateRegistry.initialize();

      const configManager = ConfigManager.getInstance();
      const currentProject = await configManager.getCurrentProject();

      if (!currentProject) {
        this.error(
          `No active project. Run ${chalk.white('switchr switch <project-name>')} to activate a project.`
        );
      }

      this.log(chalk.blue(`📦 Adding package: ${chalk.bold(args.package)}`));

      if (flags['dry-run']) {
        await this.showDryRun(args.package, flags, currentProject);
        return;
      }

      const packageManager = new PackageManager({
        projectPath: currentProject.path,
        cacheDir: configManager.getConfigDir(),
        force: flags.force,
      });

      // Parse service configuration
      const serviceConfig = this.parseServiceConfig(flags.config || []);

      // Add the package
      await packageManager.addPackage(args.package, {
        global: flags.global,
        optional: flags.optional,
        runtime: flags.runtime,
        ...serviceConfig,
      });

      this.log(chalk.green(`✅ Successfully added ${args.package}`));

      // Show what was added
      await this.showAddedPackage(args.package, flags);

      // Show next steps
      this.showNextSteps(args.package);
    } catch (error) {
      logger.error('Failed to add package', error);
      this.error(error instanceof Error ? error.message : 'Unknown error occurred');
    }
  }

  private async showDryRun(packageSpec: string, flags: any, project: any): Promise<void> {
    this.log(chalk.yellow('🧪 Dry run - showing what would be added:\n'));

    const [name, version] = packageSpec.split('@');
    const packageType = this.detectPackageType(name);

    this.log(chalk.blue(`📦 Package: ${chalk.white(name)}`));
    this.log(chalk.gray(`   Type: ${packageType}`));
    if (version) this.log(chalk.gray(`   Version: ${version}`));
    if (flags.dev) this.log(chalk.gray(`   Development dependency: Yes`));
    if (flags.global) this.log(chalk.gray(`   Global installation: Yes`));
    if (flags.runtime) this.log(chalk.gray(`   Runtime: ${flags.runtime}`));

    if (packageType === 'service' && flags.config?.length > 0) {
      this.log(chalk.gray(`   Configuration:`));
      const config = this.parseServiceConfig(flags.config);
      Object.entries(config).forEach(([key, value]) => {
        this.log(chalk.gray(`     ${key}: ${value}`));
      });
    }

    this.log(chalk.yellow('\n💡 Run without --dry-run to add the package'));
  }

  private async showAddedPackage(packageSpec: string, flags: any): Promise<void> {
    const [name, version] = packageSpec.split('@');
    const packageType = this.detectPackageType(name);

    this.log(chalk.blue('\n📋 Package Details:'));
    this.log(chalk.gray(`   Name: ${name}`));
    this.log(chalk.gray(`   Type: ${packageType}`));
    if (version) this.log(chalk.gray(`   Version: ${version}`));

    if (packageType === 'runtime') {
      this.log(chalk.gray(`   Status: ${chalk.green('Active')}`));
    } else if (packageType === 'service') {
      this.log(chalk.gray(`   Status: ${chalk.yellow('Ready to start')}`));
    }
  }

  private detectPackageType(name: string): PackageType {
    if (['nodejs', 'python', 'go', 'java', 'rust', 'php'].includes(name)) {
      return 'runtime';
    }
    if (ServiceTemplateRegistry.hasTemplate(name)) {
      return 'service';
    }
    return 'dependency';
  }

  private parseServiceConfig(configArray: string[]): Record<string, any> {
    const config: Record<string, any> = {};

    for (const configStr of configArray) {
      const [key, value] = configStr.split('=', 2);
      if (key && value !== undefined) {
        // Try to parse as number or boolean
        let parsedValue: any = value;
        if (value === 'true') parsedValue = true;
        else if (value === 'false') parsedValue = false;
        else if (!isNaN(Number(value))) parsedValue = Number(value);

        config[key] = parsedValue;
      }
    }

    return config;
  }

  private showNextSteps(packageName: string): void {
    const [name] = packageName.split('@');

    this.log(chalk.blue('\n🎯 Next steps:'));

    if (this.detectPackageType(name) === 'service') {
      this.log(chalk.gray(`   • Start services: ${chalk.white('switchr start')}`));
      this.log(chalk.gray(`   • Check status: ${chalk.white('switchr status')}`));
    } else if (this.detectPackageType(name) === 'runtime') {
      this.log(
        chalk.gray(
          `   • Restart your shell or run: ${chalk.white('switchr switch ' + process.cwd().split('/').pop())}`
        )
      );
      if (name === 'nodejs') {
        this.log(chalk.gray(`   • Install dependencies: ${chalk.white('npm install')}`));
      } else if (name === 'python') {
        this.log(
          chalk.gray(`   • Install dependencies: ${chalk.white('pip install -r requirements.txt')}`)
        );
      }
    } else {
      this.log(chalk.gray(`   • Check status: ${chalk.white('switchr status')}`));
    }
  }
}
