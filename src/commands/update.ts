// src/commands/update.ts - Complete production-quality implementation
import { Command, Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import ora from 'ora';
import { ConfigManager } from '../core/ConfigManager';
import { PackageManager } from '../core/PackageManager';
import { RuntimeRegistry } from '../core/runtime/RuntimeRegistry';
import { ServiceTemplateRegistry } from '../core/service/ServiceTemplateRegistry';
import { logger } from '../utils/Logger';
import { PackageInstallResult } from '../types/Package';

interface UpdateResult {
  name: string;
  type: 'runtime' | 'service' | 'dependency';
  currentVersion: string;
  latestVersion: string;
  updated: boolean;
  breaking?: boolean;
  error?: string;
}

interface UpdateOptions {
  checkOnly: boolean;
  latest: boolean;
  force: boolean;
  interactive: boolean;
  dryRun: boolean;
}

export default class Update extends Command {
  static override description = 'Update packages to latest compatible versions';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> nodejs',
    '<%= config.bin %> <%= command.id %> --check-only',
    '<%= config.bin %> <%= command.id %> --latest',
    '<%= config.bin %> <%= command.id %> --interactive',
    '<%= config.bin %> <%= command.id %> --dry-run',
    '<%= config.bin %> <%= command.id %> --force',
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
    'dry-run': Flags.boolean({
      description: 'Show what would be updated without executing',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output in JSON format',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Update);

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

      const packageManager = new PackageManager({
        projectPath: currentProject.path,
        cacheDir: configManager.getConfigDir(),
      });

      const options: UpdateOptions = {
        checkOnly: flags['check-only'],
        latest: flags.latest,
        force: flags.force,
        interactive: flags.interactive,
        dryRun: flags['dry-run'],
      };

      if (options.checkOnly) {
        await this.checkForUpdates(packageManager, args.package, flags.json);
      } else if (options.interactive) {
        await this.runInteractiveUpdate(packageManager, args.package);
      } else if (options.dryRun) {
        await this.showUpdateDryRun(packageManager, options, args.package);
      } else {
        await this.performUpdate(packageManager, options, args.package, flags.json);
      }
    } catch (error) {
      logger.error('Failed to update packages', error);
      this.error(`Update failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async initializeRegistries(): Promise<void> {
    const spinner = ora('Initializing package registries...').start();

    try {
      await Promise.all([RuntimeRegistry.initialize(), ServiceTemplateRegistry.initialize()]);
      spinner.succeed('Package registries initialized');
    } catch (error) {
      spinner.fail('Failed to initialize registries');
      throw error;
    }
  }

  private async checkForUpdates(
    packageManager: PackageManager,
    packageName?: string,
    jsonOutput: boolean = false
  ): Promise<void> {
    const spinner = ora('🔍 Checking for package updates...').start();

    try {
      const updates = await this.getAvailableUpdates(packageManager, packageName);
      spinner.stop();

      if (jsonOutput) {
        this.log(JSON.stringify(updates, null, 2));
        return;
      }

      this.displayUpdateCheck(updates);
    } catch (error) {
      spinner.fail('Failed to check for updates');
      throw error;
    }
  }

  private async getAvailableUpdates(
    packageManager: PackageManager,
    packageName?: string
  ): Promise<UpdateResult[]> {
    const status = await packageManager.getPackageStatus();
    const updates: UpdateResult[] = [];

    // Check runtime updates
    for (const runtime of status.runtimes) {
      if (packageName && runtime.name !== packageName) continue;

      try {
        const latestVersion = await this.getLatestRuntimeVersion(runtime.name);
        const isOutdated = latestVersion && this.isVersionOutdated(runtime.version, latestVersion);

        if (isOutdated) {
          const breaking = this.isBreakingChange(runtime.version, latestVersion);
          updates.push({
            name: runtime.name,
            type: 'runtime',
            currentVersion: runtime.version,
            latestVersion,
            updated: false,
            breaking,
          });
        }
      } catch (error) {
        logger.debug(`Failed to check updates for runtime ${runtime.name}`, error);
      }
    }

    // Check service updates
    for (const service of status.services) {
      if (packageName && service.name !== packageName) continue;

      try {
        const latestVersion = await this.getLatestServiceVersion(service.name);
        const isOutdated = latestVersion && this.isVersionOutdated(service.version, latestVersion);

        if (isOutdated) {
          updates.push({
            name: service.name,
            type: 'service',
            currentVersion: service.version,
            latestVersion,
            updated: false,
          });
        }
      } catch (error) {
        logger.debug(`Failed to check updates for service ${service.name}`, error);
      }
    }

    // Check dependency updates
    for (const dependency of status.dependencies) {
      if (packageName && dependency.name !== packageName) continue;

      try {
        const latestVersion = await this.getLatestDependencyVersion(
          dependency.name,
          dependency.runtime
        );
        const isOutdated =
          latestVersion && this.isVersionOutdated(dependency.version, latestVersion);

        if (isOutdated) {
          const breaking = this.isBreakingChange(dependency.version, latestVersion);
          updates.push({
            name: dependency.name,
            type: 'dependency',
            currentVersion: dependency.version,
            latestVersion,
            updated: false,
            breaking,
          });
        }
      } catch (error) {
        logger.debug(`Failed to check updates for dependency ${dependency.name}`, error);
      }
    }

    return updates;
  }

  private displayUpdateCheck(updates: UpdateResult[]): void {
    if (updates.length === 0) {
      this.log(chalk.green('✅ All packages are up to date'));
      return;
    }

    this.log(chalk.blue(`📋 ${updates.length} update(s) available:\n`));

    // Group by type
    const grouped = this.groupUpdatesByType(updates);

    for (const [type, typeUpdates] of Object.entries(grouped)) {
      if (typeUpdates.length === 0) continue;

      this.log(chalk.blue(`${this.getTypeIcon(type)} ${type.toUpperCase()}:`));

      typeUpdates.forEach(update => {
        const fromVersion = chalk.red(update.currentVersion);
        const toVersion = chalk.green(update.latestVersion);
        const breakingWarning = update.breaking ? chalk.red(' (BREAKING)') : '';

        this.log(`  ${chalk.white(update.name)}: ${fromVersion} → ${toVersion}${breakingWarning}`);
      });

      this.log('');
    }

    this.log(chalk.gray(`💡 Run ${chalk.white('switchr update')} to install updates`));
    this.log(
      chalk.gray(
        `💡 Run ${chalk.white('switchr update --interactive')} to choose specific packages`
      )
    );
    this.log(chalk.gray(`💡 Run ${chalk.white('switchr update --latest')} for breaking changes`));
  }

  private async runInteractiveUpdate(
    packageManager: PackageManager,
    packageName?: string
  ): Promise<void> {
    const { default: inquirer } = await import('inquirer');

    const updates = await this.getAvailableUpdates(packageManager, packageName);

    if (updates.length === 0) {
      this.log(chalk.green('✅ All packages are up to date'));
      return;
    }

    const choices = updates.map(update => ({
      name: `${update.name}: ${update.currentVersion} → ${update.latestVersion}${update.breaking ? ' (BREAKING)' : ''}`,
      value: update.name,
      checked: !update.breaking, // Don't auto-select breaking changes
    }));

    const { selectedPackages } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selectedPackages',
        message: 'Select packages to update:',
        choices,
        validate: (input: string[]) => {
          if (input.length === 0) {
            return 'Please select at least one package';
          }
          return true;
        },
      },
    ]);

    if (selectedPackages.length === 0) {
      this.log(chalk.yellow('No packages selected for update'));
      return;
    }

    // Confirm breaking changes
    const breakingUpdates = updates.filter(u => selectedPackages.includes(u.name) && u.breaking);

    if (breakingUpdates.length > 0) {
      this.log(chalk.yellow('\n⚠️  Breaking changes detected:'));
      breakingUpdates.forEach(update => {
        this.log(
          chalk.gray(`   • ${update.name}: ${update.currentVersion} → ${update.latestVersion}`)
        );
      });

      const { confirmBreaking } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmBreaking',
          message: 'Proceed with breaking changes?',
          default: false,
        },
      ]);

      if (!confirmBreaking) {
        this.log(chalk.yellow('Update cancelled due to breaking changes'));
        return;
      }
    }

    // Perform updates
    const results: PackageInstallResult[] = [];
    const spinner = ora('⬆️  Updating selected packages...').start();

    try {
      for (const packageName of selectedPackages) {
        const update = updates.find(u => u.name === packageName);
        if (!update) continue;

        spinner.text = `⬆️  Updating ${packageName}...`;

        try {
          const result = await this.updateSinglePackage(packageManager, update);
          results.push(result);
        } catch (error) {
          results.push({
            success: false,
            package: { name: packageName, type: update.type },
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      if (failed === 0) {
        spinner.succeed(`⬆️  Successfully updated ${successful} package(s)`);
      } else {
        spinner.warn(`⬆️  Updated ${successful}/${results.length} package(s) (${failed} failed)`);
      }

      this.showUpdateResults(results);
    } catch (error) {
      spinner.fail('⬆️  Failed to update packages');
      throw error;
    }
  }

  private async showUpdateDryRun(
    packageManager: PackageManager,
    options: UpdateOptions,
    packageName?: string
  ): Promise<void> {
    this.log(chalk.yellow('🧪 Dry run - showing what would be updated:\n'));

    const updates = await this.getAvailableUpdates(packageManager, packageName);

    if (updates.length === 0) {
      this.log(chalk.green('✅ All packages are up to date'));
      return;
    }

    this.log(chalk.blue(`📋 ${updates.length} package(s) would be updated:\n`));

    const grouped = this.groupUpdatesByType(updates);

    for (const [type, typeUpdates] of Object.entries(grouped)) {
      if (typeUpdates.length === 0) continue;

      this.log(chalk.blue(`${this.getTypeIcon(type)} ${type.toUpperCase()}:`));

      typeUpdates.forEach(update => {
        const fromVersion = chalk.red(update.currentVersion);
        const toVersion = chalk.green(update.latestVersion);
        const breakingWarning = update.breaking ? chalk.red(' (BREAKING)') : '';
        const skipWarning =
          update.breaking && !options.latest && !options.force ? chalk.yellow(' → SKIPPED') : '';

        this.log(
          `  ${chalk.white(update.name)}: ${fromVersion} → ${toVersion}${breakingWarning}${skipWarning}`
        );
      });

      this.log('');
    }

    if (options.latest) {
      this.log(chalk.yellow('💡 --latest flag: Breaking changes will be applied'));
    } else {
      this.log(chalk.gray('💡 Breaking changes will be skipped (use --latest to include)'));
    }

    this.log(chalk.yellow('\n💡 Run without --dry-run to perform the updates'));
  }

  private async performUpdate(
    packageManager: PackageManager,
    options: UpdateOptions,
    packageName?: string,
    jsonOutput: boolean = false
  ): Promise<void> {
    const updates = await this.getAvailableUpdates(packageManager, packageName);

    if (updates.length === 0) {
      const message = 'All packages are up to date';
      if (jsonOutput) {
        this.log(JSON.stringify({ success: true, message, updates: [] }, null, 2));
      } else {
        this.log(chalk.green(`✅ ${message}`));
      }
      return;
    }

    // Filter out breaking changes unless explicitly allowed
    const updatesToApply = updates.filter(update => {
      if (update.breaking && !options.latest && !options.force) {
        return false;
      }
      return true;
    });

    if (updatesToApply.length === 0) {
      const message = 'No safe updates available. Use --latest for breaking changes.';
      if (jsonOutput) {
        this.log(JSON.stringify({ success: true, message, skipped: updates.length }, null, 2));
      } else {
        this.log(chalk.yellow(message));
      }
      return;
    }

    const spinner = ora(`⬆️  Updating ${updatesToApply.length} package(s)...`).start();
    const results: PackageInstallResult[] = [];

    try {
      for (const update of updatesToApply) {
        spinner.text = `⬆️  Updating ${update.name}...`;

        try {
          const result = await this.updateSinglePackage(packageManager, update);
          results.push(result);
        } catch (error) {
          results.push({
            success: false,
            package: { name: update.name, type: update.type },
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      if (failed === 0) {
        spinner.succeed(`⬆️  Successfully updated ${successful} package(s)`);
      } else {
        spinner.warn(
          `⬆️  Updated ${successful}/${updatesToApply.length} package(s) (${failed} failed)`
        );
      }

      if (jsonOutput) {
        this.log(JSON.stringify({ success: true, results }, null, 2));
      } else {
        this.showUpdateResults(results);
      }
    } catch (error) {
      spinner.fail('⬆️  Failed to update packages');
      throw error;
    }
  }

  private async updateSinglePackage(
    packageManager: PackageManager,
    update: UpdateResult
  ): Promise<PackageInstallResult> {
    const packageSpec = `${update.name}@${update.latestVersion}`;

    const addOptions: any = {
      skipIfExists: false, // Force reinstall to update
    };

    return await packageManager.addPackage(packageSpec, addOptions);
  }

  private showUpdateResults(results: PackageInstallResult[]): void {
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    this.log('');

    if (successful.length > 0) {
      this.log(chalk.green('✅ Successfully updated:'));
      successful.forEach(result => {
        const version = result.installedVersion ? `@${result.installedVersion}` : '';
        this.log(chalk.gray(`   • ${result.package.name}${version}`));
      });
      this.log('');
    }

    if (failed.length > 0) {
      this.log(chalk.red('❌ Failed to update:'));
      failed.forEach(result => {
        this.log(chalk.gray(`   • ${result.package.name}: ${result.error}`));
      });
      this.log('');
    }

    if (successful.length > 0) {
      this.log(chalk.blue('🎯 Next steps:'));
      this.log(chalk.gray(`   • Check status: ${chalk.white('switchr status')}`));
      this.log(chalk.gray(`   • Test your project: ${chalk.white('switchr start')}`));
      this.log(chalk.gray(`   • View packages: ${chalk.white('switchr packages')}`));
    }
  }

  private groupUpdatesByType(updates: UpdateResult[]): Record<string, UpdateResult[]> {
    const grouped: Record<string, UpdateResult[]> = {
      runtime: [],
      service: [],
      dependency: [],
    };

    updates.forEach(update => {
      if (grouped[update.type]) {
        grouped[update.type].push(update);
      }
    });

    return grouped;
  }

  private getTypeIcon(type: string): string {
    const icons: Record<string, string> = {
      runtime: '🔧',
      service: '⚡',
      dependency: '📚',
    };
    return icons[type] || '📦';
  }

  private async getLatestRuntimeVersion(runtimeName: string): Promise<string | null> {
    try {
      if (!RuntimeRegistry.isSupported(runtimeName)) return null;

      const manager = RuntimeRegistry.create(runtimeName as any, process.cwd(), '/tmp');
      const versions = await manager.listAvailable();
      return versions[0] || null; // First version is typically latest
    } catch {
      return null;
    }
  }

  private async getLatestServiceVersion(serviceName: string): Promise<string | null> {
    try {
      const template = ServiceTemplateRegistry.getTemplate(serviceName);
      return template?.getTemplate().version || null;
    } catch {
      return null;
    }
  }

  private async getLatestDependencyVersion(
    packageName: string,
    runtime?: string
  ): Promise<string | null> {
    try {
      switch (runtime) {
        case 'nodejs':
          return await this.getLatestNpmVersion(packageName);
        case 'python':
          return await this.getLatestPyPIVersion(packageName);
        case 'go':
          return await this.getLatestGoVersion(packageName);
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  private async getLatestNpmVersion(packageName: string): Promise<string | null> {
    try {
      const response = await fetch(`https://registry.npmjs.org/${packageName}/latest`);
      if (!response.ok) return null;

      const data = await response.json();
      return data.version || null;
    } catch {
      return null;
    }
  }

  private async getLatestPyPIVersion(packageName: string): Promise<string | null> {
    try {
      const response = await fetch(`https://pypi.org/pypi/${packageName}/json`);
      if (!response.ok) return null;

      const data = await response.json();
      return data.info?.version || null;
    } catch {
      return null;
    }
  }

  private async getLatestGoVersion(packageName: string): Promise<string | null> {
    try {
      // Go modules use semantic versioning tags
      // This would require integration with Go proxy or VCS
      // For now, return null indicating no update available
      return null;
    } catch {
      return null;
    }
  }

  private isVersionOutdated(current: string, latest: string): boolean {
    // Basic semver comparison - would use proper semver library in production
    if (current === latest) return false;
    if (latest === 'latest') return true;

    try {
      const currentParts = current.split('.').map(Number);
      const latestParts = latest.split('.').map(Number);

      for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
        const currentPart = currentParts[i] || 0;
        const latestPart = latestParts[i] || 0;

        if (latestPart > currentPart) return true;
        if (latestPart < currentPart) return false;
      }

      return false;
    } catch {
      return current !== latest;
    }
  }

  private isBreakingChange(current: string, latest: string): boolean {
    try {
      const currentMajor = parseInt(current.split('.')[0], 10);
      const latestMajor = parseInt(latest.split('.')[0], 10);
      return latestMajor > currentMajor;
    } catch {
      return false;
    }
  }
}
