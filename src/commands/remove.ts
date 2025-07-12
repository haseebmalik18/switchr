export default class Remove extends Command {
  static override description = 'Remove packages, runtimes, or services from the current project';

  static override examples = [
    '<%= config.bin %> <%= command.id %> postgresql',
    '<%= config.bin %> <%= command.id %> nodejs@16',
    '<%= config.bin %> <%= command.id %> express',
    '<%= config.bin %> <%= command.id %> typescript --dev',
  ];

  static override args = {
    package: Args.string({
      description: 'Package name to remove',
      required: true,
    }),
  };

  static override flags = {
    force: Flags.boolean({
      char: 'f',
      description: 'Force removal without confirmation',
      default: false,
    }),
    'keep-data': Flags.boolean({
      description: 'Keep service data when removing services',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Show what would be removed without executing',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Remove);

    try {
      const configManager = ConfigManager.getInstance();
      const currentProject = await configManager.getCurrentProject();

      if (!currentProject) {
        this.error(
          `No active project. Run ${chalk.white('switchr switch <project-name>')} to activate a project.`
        );
      }

      if (flags['dry-run']) {
        await this.showDryRun(args.package, currentProject);
        return;
      }

      if (!flags.force) {
        const { default: inquirer } = await import('inquirer');
        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: `Remove ${args.package} from project?`,
            default: false,
          },
        ]);

        if (!confirm) {
          this.log(chalk.yellow('Removal cancelled.'));
          return;
        }
      }

      this.log(chalk.blue(`🗑️  Removing package: ${chalk.bold(args.package)}`));

      const packageManager = new PackageManager({
        projectPath: currentProject.path,
        cacheDir: configManager.getConfigDir(),
      });

      await packageManager.removePackage(args.package, {
        keepData: flags['keep-data'],
      });

      this.log(chalk.green(`✅ Successfully removed ${args.package}`));
    } catch (error) {
      logger.error('Failed to remove package', error);
      this.error(error instanceof Error ? error.message : 'Unknown error occurred');
    }
  }

  private async showDryRun(packageName: string, project: any): Promise<void> {
    this.log(chalk.yellow('🧪 Dry run - showing what would be removed:\n'));

    // Check if package exists in project
    const packageExists = await this.checkPackageExists(packageName, project);

    if (!packageExists) {
      this.log(chalk.red(`❌ Package '${packageName}' not found in project`));
      return;
    }

    this.log(chalk.red(`🗑️  Would remove: ${chalk.white(packageName)}`));
    this.log(chalk.gray(`   From project: ${project.name}`));

    // Show what services depend on this package
    const dependentServices = this.findDependentServices(packageName, project);
    if (dependentServices.length > 0) {
      this.log(chalk.yellow(`   ⚠️  Services that depend on this package:`));
      dependentServices.forEach(service => {
        this.log(chalk.gray(`     • ${service}`));
      });
    }

    this.log(chalk.yellow('\n💡 Run without --dry-run to remove the package'));
  }

  private async checkPackageExists(packageName: string, project: any): Promise<boolean> {
    if (!project.packages) return false;

    // Check runtimes
    if (project.packages.runtimes && project.packages.runtimes[packageName]) {
      return true;
    }

    // Check dependencies
    if (project.packages.dependencies) {
      const found = project.packages.dependencies.find((dep: any) => dep.name === packageName);
      if (found) return true;
    }

    // Check services
    if (project.packages.services) {
      const found = project.packages.services.find((svc: any) => svc.name === packageName);
      if (found) return true;
    }

    return false;
  }

  private findDependentServices(packageName: string, project: any): string[] {
    const dependents: string[] = [];

    if (project.services) {
      project.services.forEach((service: any) => {
        if (service.dependencies && service.dependencies.includes(packageName)) {
          dependents.push(service.name);
        }
      });
    }

    return dependents;
  }
}
