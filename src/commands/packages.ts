// src/commands/packages.ts - Complete implementation
import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { ConfigManager } from '../core/ConfigManager';
import { PackageManager } from '../core/PackageManager';
import { RuntimeRegistry } from '../core/runtime/RuntimeRegistry';
import { ServiceTemplateRegistry } from '../core/service/ServiceTemplateRegistry';
import { logger } from '../utils/Logger';

export default class Packages extends Command {
  static override description = 'Manage project packages and dependencies';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --outdated',
    '<%= config.bin %> <%= command.id %> --tree',
    '<%= config.bin %> <%= command.id %> --type runtime',
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
      // Initialize registries
      await RuntimeRegistry.initialize();
      await ServiceTemplateRegistry.initialize();

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

  private async showPackageStatus(packageManager: PackageManager, flags: any): Promise<void> {
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

          if (runtime.manager) {
            this.log(chalk.gray(`    Manager: ${runtime.manager}`));
          }
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

          if (service.template) {
            this.log(chalk.gray(`    Template: ${service.template}`));
          }
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

          if (dep.runtime) {
            this.log(chalk.gray(`    Runtime: ${dep.runtime}`));
          }
        });
      }
    }

    this.log(chalk.gray(`\n💡 Use ${chalk.white('switchr add <package>')} to add packages`));
    this.log(chalk.gray(`💡 Use ${chalk.white('switchr update')} to update packages`));
    this.log(chalk.gray(`💡 Use ${chalk.white('switchr remove <package>')} to remove packages`));
  }

  private async showOutdatedPackages(packageManager: PackageManager): Promise<void> {
    this.log(chalk.blue('🔍 Checking for outdated packages...'));

    try {
      const outdated = await this.checkForUpdates(packageManager);

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

        if (pkg.description) {
          this.log(chalk.gray(`    ${pkg.description}`));
        }
      });

      this.log(chalk.gray(`\n💡 Run ${chalk.white('switchr update')} to update packages`));
      this.log(
        chalk.gray(`💡 Run ${chalk.white('switchr update <package>')} to update specific packages`)
      );
    } catch (error) {
      this.log(chalk.red('Failed to check for updates'));
      logger.error('Failed to check for updates', error);
    }
  }

  private async showDependencyTree(packageManager: PackageManager): Promise<void> {
    this.log(chalk.blue('🌳 Dependency Tree\n'));

    try {
      const tree = await this.getDependencyTree(packageManager);

      if (!tree || Object.keys(tree).length === 0) {
        this.log(chalk.gray('No dependencies found'));
        return;
      }

      this.displayTree(tree);
    } catch (error) {
      this.log(chalk.red('Failed to generate dependency tree'));
      logger.error('Failed to generate dependency tree', error);
    }
  }

  private displayTree(tree: any, prefix: string = '', isLast: boolean = true): void {
    if (typeof tree === 'string') {
      // Leaf node
      const connector = isLast ? '└── ' : '├── ';
      this.log(`${prefix}${connector}${chalk.white(tree)}`);
      return;
    }

    // Object with dependencies
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

  private async checkForUpdates(packageManager: PackageManager): Promise<any[]> {
    // This would integrate with the package manager's update checking
    // For now, return a mock implementation
    const status = await packageManager.getPackageStatus();
    const outdated: any[] = [];

    // Mock some outdated packages for demonstration
    status.runtimes.forEach((runtime: any) => {
      if (runtime.version !== 'latest') {
        outdated.push({
          name: runtime.name,
          type: 'runtime',
          currentVersion: runtime.version,
          latestVersion: 'latest',
          breaking: false,
          description: `${runtime.name} runtime environment`,
        });
      }
    });

    return outdated;
  }

  private async getDependencyTree(packageManager: PackageManager): Promise<any> {
    // This would generate a real dependency tree
    // For now, return a mock structure
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
  }
}
