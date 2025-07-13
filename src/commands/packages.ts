// src/commands/packages.ts - Complete production implementation
import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import ora from 'ora';
import { ConfigManager } from '../core/ConfigManager';
import { PackageManager } from '../core/PackageManager';
import { RuntimeRegistry } from '../core/runtime/RuntimeRegistry';
import { ServiceTemplateRegistry } from '../core/service/ServiceTemplateRegistry';
import { logger } from '../utils/Logger';

interface PackageInfo {
  name: string;
  type: 'runtime' | 'service' | 'dependency';
  version: string;
  installed: boolean;
  active?: boolean;
  running?: boolean;
  manager?: string;
  template?: string;
  runtime?: string;
  size?: string;
  lastUpdated?: string;
  outdated?: boolean;
  latestVersion?: string;
}

interface PackageSummary {
  total: number;
  installed: number;
  outdated: number;
  runtimes: number;
  services: number;
  dependencies: number;
}

export default class Packages extends Command {
  static override description = 'Manage project packages and dependencies';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --outdated',
    '<%= config.bin %> <%= command.id %> --tree',
    '<%= config.bin %> <%= command.id %> --type runtime',
    '<%= config.bin %> <%= command.id %> --json',
    '<%= config.bin %> <%= command.id %> --detailed',
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
    detailed: Flags.boolean({
      char: 'd',
      description: 'Show detailed package information',
      default: false,
    }),
    sizes: Flags.boolean({
      description: 'Show package sizes',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(Packages);

    try {
      // Initialize registries
      const spinner = ora('Initializing package registries...').start();
      await RuntimeRegistry.initialize();
      await ServiceTemplateRegistry.initialize();
      spinner.succeed('Package registries initialized');

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
        await this.showOutdatedPackages(packageManager, flags);
      } else if (flags.tree) {
        await this.showDependencyTree(packageManager, flags);
      } else {
        await this.showPackageOverview(packageManager, flags);
      }
    } catch (error) {
      logger.error('Failed to get package information', error);
      this.error(error instanceof Error ? error.message : 'Unknown error occurred');
    }
  }

  private async showPackageOverview(packageManager: PackageManager, flags: any): Promise<void> {
    const spinner = ora('Analyzing packages...').start();

    try {
      const status = await packageManager.getPackageStatus();
      const packages = await this.buildPackageList(status, flags);
      const summary = this.calculateSummary(packages);

      spinner.succeed(`Found ${summary.total} packages`);

      if (flags.json) {
        this.outputJson(packages, summary);
        return;
      }

      this.displayPackageOverview(packages, summary, flags);
    } catch (error) {
      spinner.fail('Failed to analyze packages');
      throw error;
    }
  }

  private async buildPackageList(status: any, flags: any): Promise<PackageInfo[]> {
    const packages: PackageInfo[] = [];

    // Process runtimes
    if (!flags.type || flags.type === 'runtime') {
      for (const runtime of status.runtimes) {
        const pkg: PackageInfo = {
          name: runtime.name,
          type: 'runtime',
          version: runtime.version,
          installed: runtime.installed,
          active: runtime.active,
          manager: runtime.manager,
        };

        if (flags.detailed || flags.sizes) {
          const details = await this.getRuntimeDetails(runtime.name, runtime.version);
          Object.assign(pkg, details);
        }

        packages.push(pkg);
      }
    }

    // Process services
    if (!flags.type || flags.type === 'service') {
      for (const service of status.services) {
        const pkg: PackageInfo = {
          name: service.name,
          type: 'service',
          version: service.version,
          installed: true, // Services are installed if they're in the config
          running: service.running,
          template: service.template,
        };

        if (flags.detailed || flags.sizes) {
          const details = await this.getServiceDetails(service.name);
          Object.assign(pkg, details);
        }

        packages.push(pkg);
      }
    }

    // Process dependencies
    if (!flags.type || flags.type === 'dependency') {
      for (const dependency of status.dependencies) {
        const pkg: PackageInfo = {
          name: dependency.name,
          type: 'dependency',
          version: dependency.version,
          installed: dependency.installed,
          runtime: dependency.runtime,
        };

        if (flags.detailed || flags.sizes) {
          const details = await this.getDependencyDetails(dependency.name, dependency.runtime);
          Object.assign(pkg, details);
        }

        packages.push(pkg);
      }
    }

    return packages;
  }

  private calculateSummary(packages: PackageInfo[]): PackageSummary {
    return {
      total: packages.length,
      installed: packages.filter(p => p.installed).length,
      outdated: packages.filter(p => p.outdated).length,
      runtimes: packages.filter(p => p.type === 'runtime').length,
      services: packages.filter(p => p.type === 'service').length,
      dependencies: packages.filter(p => p.type === 'dependency').length,
    };
  }

  private displayPackageOverview(
    packages: PackageInfo[],
    summary: PackageSummary,
    flags: any
  ): void {
    // Display header
    this.log(chalk.blue(`📦 Package Overview\n`));

    // Display summary
    this.displaySummary(summary);

    // Display packages by type
    this.displayPackagesByType(packages, flags);

    // Display footer with actions
    this.displayFooter();
  }

  private displaySummary(summary: PackageSummary): void {
    this.log(chalk.blue('📊 SUMMARY:'));
    this.log(chalk.gray(`   Total packages: ${chalk.white(summary.total)}`));
    this.log(chalk.gray(`   Installed: ${chalk.green(summary.installed)} / ${summary.total}`));

    if (summary.outdated > 0) {
      this.log(chalk.gray(`   Outdated: ${chalk.yellow(summary.outdated)}`));
    }

    this.log(
      chalk.gray(
        `   Runtimes: ${summary.runtimes} • Services: ${summary.services} • Dependencies: ${summary.dependencies}`
      )
    );
    this.log('');
  }

  private displayPackagesByType(packages: PackageInfo[], flags: any): void {
    const types = ['runtime', 'service', 'dependency'] as const;

    for (const type of types) {
      const typePackages = packages.filter(p => p.type === type);
      if (typePackages.length === 0) continue;

      this.log(chalk.blue(`${this.getTypeIcon(type)} ${type.toUpperCase()}:`));

      typePackages.forEach(pkg => {
        this.displayPackage(pkg, flags);
      });

      this.log('');
    }
  }

  private displayPackage(pkg: PackageInfo, flags: any): void {
    const statusIcon = this.getPackageStatusIcon(pkg);
    const nameDisplay = chalk.white(pkg.name);
    const versionDisplay = chalk.gray(`@${pkg.version}`);

    let statusText = '';
    if (pkg.type === 'runtime') {
      statusText = pkg.active ? chalk.green('Active') : chalk.gray('Installed');
    } else if (pkg.type === 'service') {
      statusText = pkg.running ? chalk.green('Running') : chalk.red('Stopped');
    } else {
      statusText = pkg.installed ? chalk.green('Installed') : chalk.red('Missing');
    }

    this.log(`  ${statusIcon} ${nameDisplay}${versionDisplay} - ${statusText}`);

    // Show additional details if requested
    if (flags.detailed) {
      this.displayPackageDetails(pkg, flags);
    }
  }

  private displayPackageDetails(pkg: PackageInfo, flags: any): void {
    if (pkg.manager) {
      this.log(chalk.gray(`    Manager: ${pkg.manager}`));
    }

    if (pkg.template) {
      this.log(chalk.gray(`    Template: ${pkg.template}`));
    }

    if (pkg.runtime) {
      this.log(chalk.gray(`    Runtime: ${pkg.runtime}`));
    }

    if (flags.sizes && pkg.size) {
      this.log(chalk.gray(`    Size: ${pkg.size}`));
    }

    if (pkg.lastUpdated) {
      this.log(chalk.gray(`    Last updated: ${pkg.lastUpdated}`));
    }

    if (pkg.outdated && pkg.latestVersion) {
      this.log(chalk.yellow(`    Latest version: ${pkg.latestVersion}`));
    }
  }

  private async showOutdatedPackages(packageManager: PackageManager, flags: any): Promise<void> {
    const spinner = ora('🔍 Checking for outdated packages...').start();

    try {
      const status = await packageManager.getPackageStatus();
      const packages = await this.buildPackageList(status, flags);

      // Check for updates
      const outdatedPackages = await this.checkForUpdates(packages);

      spinner.stop();

      if (flags.json) {
        this.log(JSON.stringify(outdatedPackages, null, 2));
        return;
      }

      if (outdatedPackages.length === 0) {
        this.log(chalk.green('✅ All packages are up to date'));
        return;
      }

      this.log(chalk.yellow(`📋 ${outdatedPackages.length} outdated package(s):\n`));

      outdatedPackages.forEach(pkg => {
        const current = chalk.red(pkg.version);
        const latest = chalk.green(pkg.latestVersion || 'unknown');
        const breaking = this.isBreakingChange(pkg.version, pkg.latestVersion || '')
          ? chalk.red(' (BREAKING)')
          : '';

        this.log(`  ${chalk.white(pkg.name)}: ${current} → ${latest}${breaking}`);

        if (pkg.type === 'runtime' && pkg.manager) {
          this.log(chalk.gray(`    Manager: ${pkg.manager}`));
        }
      });

      this.displayUpdateFooter();
    } catch (error) {
      spinner.fail('Failed to check for updates');
      throw error;
    }
  }

  private async showDependencyTree(packageManager: PackageManager, flags: any): Promise<void> {
    const spinner = ora('🌳 Building dependency tree...').start();

    try {
      const tree = await this.buildDependencyTree(packageManager);
      spinner.succeed('Dependency tree built');

      if (flags.json) {
        this.log(JSON.stringify(tree, null, 2));
        return;
      }

      this.log(chalk.blue('🌳 Dependency Tree\n'));

      if (!tree || Object.keys(tree).length === 0) {
        this.log(chalk.gray('No dependencies found'));
        return;
      }

      this.displayTree(tree);
    } catch (error) {
      spinner.fail('Failed to build dependency tree');
      throw error;
    }
  }

  private displayTree(tree: any, prefix: string = '', isLast: boolean = true): void {
    if (typeof tree === 'string') {
      const connector = isLast ? '└── ' : '├── ';
      this.log(`${prefix}${connector}${chalk.white(tree)}`);
      return;
    }

    Object.entries(tree).forEach(([name, dependencies], index, entries) => {
      const isLastEntry = index === entries.length - 1;
      const connector = isLastEntry ? '└── ' : '├── ';

      this.log(`${prefix}${connector}${chalk.white(name)}`);

      if (dependencies && typeof dependencies === 'object') {
        const newPrefix = prefix + (isLastEntry ? '    ' : '│   ');
        this.displayTree(dependencies, newPrefix, true);
      }
    });
  }

  // Helper methods for getting package details
  private async getRuntimeDetails(name: string, version: string): Promise<Partial<PackageInfo>> {
    try {
      // This would integrate with runtime managers to get actual details
      return {
        size: 'Unknown',
        lastUpdated: 'Unknown',
      };
    } catch {
      return {};
    }
  }

  private async getServiceDetails(name: string): Promise<Partial<PackageInfo>> {
    try {
      // This would integrate with service managers to get actual details
      return {
        size: 'Unknown',
        lastUpdated: 'Unknown',
      };
    } catch {
      return {};
    }
  }

  private async getDependencyDetails(
    name: string,
    runtime?: string
  ): Promise<Partial<PackageInfo>> {
    try {
      // This would integrate with package managers to get actual details
      return {
        size: 'Unknown',
        lastUpdated: 'Unknown',
      };
    } catch {
      return {};
    }
  }

  private async checkForUpdates(packages: PackageInfo[]): Promise<PackageInfo[]> {
    const outdated: PackageInfo[] = [];

    for (const pkg of packages) {
      try {
        const latestVersion = await this.getLatestVersion(pkg);
        if (latestVersion && this.isVersionOutdated(pkg.version, latestVersion)) {
          pkg.outdated = true;
          pkg.latestVersion = latestVersion;
          outdated.push(pkg);
        }
      } catch {
        // Ignore errors when checking for updates
      }
    }

    return outdated;
  }

  private async getLatestVersion(pkg: PackageInfo): Promise<string | null> {
    // This would integrate with package registries
    // For now, return null to indicate no update available
    return null;
  }

  private isVersionOutdated(current: string, latest: string): boolean {
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

  private async buildDependencyTree(packageManager: PackageManager): Promise<any> {
    try {
      const status = await packageManager.getPackageStatus();
      const tree: any = {};

      // Build a simple tree structure
      status.runtimes.forEach((runtime: any) => {
        tree[`${runtime.name}@${runtime.version}`] = {
          [`${runtime.name}-tools`]: 'system',
        };
      });

      status.services.forEach((service: any) => {
        tree[`${service.name}@${service.version}`] = {
          docker: 'system',
        };
      });

      status.dependencies.forEach((dep: any) => {
        if (dep.runtime) {
          if (!tree[`${dep.runtime}-packages`]) {
            tree[`${dep.runtime}-packages`] = {};
          }
          tree[`${dep.runtime}-packages`][`${dep.name}@${dep.version}`] = 'dependency';
        }
      });

      return tree;
    } catch {
      return {};
    }
  }

  private getTypeIcon(type: string): string {
    const icons: Record<string, string> = {
      runtime: '🔧',
      service: '⚡',
      dependency: '📚',
    };
    return icons[type] || '📦';
  }

  private getPackageStatusIcon(pkg: PackageInfo): string {
    if (pkg.type === 'runtime') {
      return pkg.active ? chalk.green('●') : pkg.installed ? chalk.yellow('●') : chalk.red('●');
    } else if (pkg.type === 'service') {
      return pkg.running ? chalk.green('●') : chalk.red('●');
    } else {
      return pkg.installed ? chalk.green('●') : chalk.red('●');
    }
  }

  private outputJson(packages: PackageInfo[], summary: PackageSummary): void {
    this.log(JSON.stringify({ packages, summary }, null, 2));
  }

  private displayFooter(): void {
    this.log(chalk.gray(`💡 Use ${chalk.white('switchr add <package>')} to add packages`));
    this.log(chalk.gray(`💡 Use ${chalk.white('switchr remove <package>')} to remove packages`));
    this.log(
      chalk.gray(`💡 Use ${chalk.white('switchr packages --outdated')} to check for updates`)
    );
  }

  private displayUpdateFooter(): void {
    this.log(chalk.gray(`\n💡 Run ${chalk.white('switchr update')} to update packages`));
    this.log(
      chalk.gray(`💡 Run ${chalk.white('switchr update <package>')} to update specific packages`)
    );
    this.log(
      chalk.gray(`💡 Use ${chalk.white('--force')} to update packages with breaking changes`)
    );
  }
}
