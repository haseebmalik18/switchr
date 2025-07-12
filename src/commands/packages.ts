export default class Packages extends Command {
  static override description = 'Manage project packages and dependencies';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --outdated',
    '<%= config.bin %> <%= command.id %> --tree',
  ];

  static override flags = {
    outdated: Flags.boolean({
      description: 'Show outdated packages',
      default: false,
    }),
    tree: Flags.boolean({
      description: 'Show dependency tree',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output in JSON format',
      default: false,
    }),
    type: Flags.string({
      char: 't',
      description: 'Filter by package type',
      options: ['runtime', 'service', 'dependency'],
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(Packages);

    try {
      const configManager = ConfigManager.getInstance();
      const currentProject = await configManager.getCurrentProject();

      if (!currentProject) {
        this.error(
          `No active project. Run ${chalk.white('switchr switch <project-name>')} to activate a project.`
        );
      }

      const packageManager = new PackageManager({
        projectPath: currentProject.path,
        cacheDir: configManager.getConfigDir(),
      });

      if (flags.outdated) {
        await this.showOutdatedPackages(packageManager);
      } else if (flags.tree) {
        await this.showDependencyTree(packageManager);
      } else {
        await this.showPackageStatus(packageManager, flags);
      }
    } catch (error) {
      logger.error('Failed to get package information', error);
      this.error(error instanceof Error ? error.message : 'Unknown error occurred');
    }
  }

  private async showPackageStatus(packageManager: any, flags: any): Promise<void> {
    const status = await packageManager.getPackageStatus();

    if (flags.json) {
      this.log(JSON.stringify(status, null, 2));
      return;
    }

    this.log(chalk.blue(`📦 Package Status\n`));

    // Show runtimes
    if (!flags.type || flags.type === 'runtime') {
      this.log(chalk.blue('🔧 RUNTIMES:'));
      if (status.runtimes.length === 0) {
        this.log(chalk.gray('   No runtimes configured'));
      } else {
        status.runtimes.forEach((runtime: any) => {
          const statusIcon = runtime.installed
            ? runtime.active
              ? chalk.green('●')
              : chalk.yellow('●')
            : chalk.red('●');
          const statusText = runtime.active
            ? 'Active'
            : runtime.installed
              ? 'Installed'
              : 'Not installed';

          this.log(
            `  ${statusIcon} ${chalk.white(runtime.name)}@${runtime.version} - ${chalk.gray(statusText)}`
          );
        });
      }
      this.log('');
    }

    // Show services
    if (!flags.type || flags.type === 'service') {
      this.log(chalk.blue('⚡ SERVICES:'));
      if (status.services.length === 0) {
        this.log(chalk.gray('   No services configured'));
      } else {
        status.services.forEach((service: any) => {
          const statusIcon = service.running ? chalk.green('●') : chalk.red('●');
          const statusText = service.running ? 'Running' : 'Stopped';

          this.log(
            `  ${statusIcon} ${chalk.white(service.name)}@${service.version} - ${chalk.gray(statusText)}`
          );
        });
      }
      this.log('');
    }

    // Show dependencies
    if (!flags.type || flags.type === 'dependency') {
      this.log(chalk.blue('📚 DEPENDENCIES:'));
      if (status.dependencies.length === 0) {
        this.log(chalk.gray('   No dependencies configured'));
      } else {
        status.dependencies.forEach((dep: any) => {
          const statusIcon = dep.installed ? chalk.green('●') : chalk.red('●');
          const statusText = dep.installed ? 'Installed' : 'Not installed';

          this.log(
            `  ${statusIcon} ${chalk.white(dep.name)}@${dep.version} - ${chalk.gray(statusText)}`
          );
        });
      }
    }

    this.log(chalk.gray(`\n💡 Use ${chalk.white('switchr add <package>')} to add packages`));
    this.log(chalk.gray(`💡 Use ${chalk.white('switchr update')} to update packages`));
  }

  private async showOutdatedPackages(packageManager: any): Promise<void> {
    this.log(chalk.blue('🔍 Checking for outdated packages...'));

    const outdated = await packageManager.checkForUpdates();

    if (outdated.length === 0) {
      this.log(chalk.green('✅ All packages are up to date'));
      return;
    }

    this.log(chalk.yellow(`📋 ${outdated.length} outdated package(s):\n`));

    outdated.forEach((pkg: any) => {
      const current = chalk.red(pkg.currentVersion);
      const latest = chalk.green(pkg.latestVersion);
      const breaking = pkg.breaking ? chalk.red(' (BREAKING)') : '';

      this.log(`  ${chalk.white(pkg.name)}: ${current} → ${latest}${breaking}`);
    });

    this.log(chalk.gray(`\n💡 Run ${chalk.white('switchr update')} to update packages`));
  }

  private async showDependencyTree(packageManager: any): Promise<void> {
    this.log(chalk.blue('🌳 Dependency Tree\n'));

    const tree = await packageManager.getDependencyTree();
    this.displayTree(tree);
  }

  private displayTree(tree: any, prefix: string = '', isLast: boolean = true): void {
    const connector = isLast ? '└── ' : '├── ';
    this.log(`${prefix}${connector}${chalk.white(tree.name)}@${tree.version}`);

    if (tree.dependencies && tree.dependencies.length > 0) {
      const newPrefix = prefix + (isLast ? '    ' : '│   ');
      tree.dependencies.forEach((dep: any, index: number) => {
        const isLastDep = index === tree.dependencies.length - 1;
        this.displayTree(dep, newPrefix, isLastDep);
      });
    }
  }
}
