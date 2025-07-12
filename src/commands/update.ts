export default class Update extends Command {
  static override description = 'Update packages to latest compatible versions';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> nodejs',
    '<%= config.bin %> <%= command.id %> --check-only',
    '<%= config.bin %> <%= command.id %> --latest',
  ];

  static override args = {
    package: Args.string({
      description: 'Specific package to update (optional)',
    }),
  };

  static override flags = {
    'check-only': Flags.boolean({
      description: 'Check for updates without installing',
      default: false,
    }),
    latest: Flags.boolean({
      description: 'Update to latest versions (may include breaking changes)',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Force update even if breaking changes detected',
      default: false,
    }),
    interactive: Flags.boolean({
      char: 'i',
      description: 'Interactively choose which packages to update',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Update);

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

      if (flags['check-only']) {
        this.log(chalk.blue('🔍 Checking for package updates...'));
        const updates = await packageManager.checkForUpdates(args.package);
        this.displayUpdateCheck(updates);
      } else if (flags.interactive) {
        this.log(chalk.blue('🔄 Interactive package update...'));
        await this.runInteractiveUpdate(packageManager, args.package);
      } else {
        this.log(chalk.blue('⬆️  Updating packages...'));
        await packageManager.updatePackages(args.package, {
          latest: flags.latest,
          force: flags.force,
        });
        this.log(chalk.green('✅ Packages updated successfully'));
      }
    } catch (error) {
      logger.error('Failed to update packages', error);
      this.error(error instanceof Error ? error.message : 'Unknown error occurred');
    }
  }

  private displayUpdateCheck(updates: any[]): void {
    if (updates.length === 0) {
      this.log(chalk.green('✅ All packages are up to date'));
      return;
    }

    this.log(chalk.yellow(`📋 ${updates.length} update(s) available:\n`));

    updates.forEach(update => {
      const fromVersion = chalk.red(update.currentVersion);
      const toVersion = chalk.green(update.latestVersion);
      const breakingChange = update.breaking ? chalk.red(' (BREAKING)') : '';

      this.log(`  ${chalk.white(update.name)}: ${fromVersion} → ${toVersion}${breakingChange}`);

      if (update.description) {
        this.log(chalk.gray(`    ${update.description}`));
      }
    });

    this.log(chalk.gray(`\n💡 Run ${chalk.white('switchr update')} to install updates`));
  }

  private async runInteractiveUpdate(packageManager: any, packageName?: string): Promise<void> {
    const { default: inquirer } = await import('inquirer');

    const updates = await packageManager.checkForUpdates(packageName);

    if (updates.length === 0) {
      this.log(chalk.green('✅ All packages are up to date'));
      return;
    }

    const choices = updates.map((update: any) => ({
      name: `${update.name}: ${update.currentVersion} → ${update.latestVersion}${update.breaking ? ' (BREAKING)' : ''}`,
      value: update.name,
      checked: !update.breaking,
    }));

    const { selectedPackages } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selectedPackages',
        message: 'Select packages to update:',
        choices,
      },
    ]);

    if (selectedPackages.length === 0) {
      this.log(chalk.yellow('No packages selected for update'));
      return;
    }

    for (const pkg of selectedPackages) {
      this.log(chalk.blue(`⬆️  Updating ${pkg}...`));
      await packageManager.updatePackages(pkg);
    }

    this.log(chalk.green('✅ Selected packages updated successfully'));
  }
}
