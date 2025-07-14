// src/commands/remove.ts - Fixed version with exactOptionalPropertyTypes support
import { Command, Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { ConfigManager } from '../core/ConfigManager';
import { PackageManager } from '../core/PackageManager';
import { RuntimeRegistry } from '../core/runtime/RuntimeRegistry';
import { ServiceTemplateRegistry } from '../core/service/ServiceTemplateRegistry';
import { logger } from '../utils/Logger';
import {
  ProjectProfile,
  ProjectPackages,
  DependencyDefinition,
  ServicePackageDefinition,
  Service,
} from '../types/Project';

interface PackageExistsResult {
  found: boolean;
  type?: string;
  version?: string;
  description?: string;
  installedAt?: string;
}

interface RemoveCommandFlags {
  force: boolean;
  'keep-data': boolean;
  'dry-run': boolean;
  'remove-unused': boolean;
}

interface DependentPackage {
  name: string;
  type: string;
}

export default class Remove extends Command {
  static override description = 'Remove packages, runtimes, or services from the current project';

  static override examples = [
    '<%= config.bin %> <%= command.id %> postgresql',
    '<%= config.bin %> <%= command.id %> nodejs@18',
    '<%= config.bin %> <%= command.id %> express',
    '<%= config.bin %> <%= command.id %> typescript --force',
    '<%= config.bin %> <%= command.id %> redis --keep-data',
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
    'remove-unused': Flags.boolean({
      description: 'Also remove unused dependencies',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Remove);

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

      if (flags['dry-run']) {
        await this.showDryRun(args.package, currentProject, flags);
        return;
      }

      // Get confirmation unless forced
      if (!flags.force) {
        const confirmed = await this.getConfirmation(args.package, currentProject, flags);
        if (!confirmed) {
          this.log(chalk.yellow('Removal cancelled.'));
          return;
        }
      }

      this.log(chalk.blue(`🗑️  Removing package: ${chalk.bold(args.package)}`));

      const packageManager = new PackageManager({
        projectPath: currentProject.path,
        cacheDir: configManager.getConfigDir(),
      });

      const success = await packageManager.removePackage(args.package);

      if (success) {
        this.log(chalk.green(`✅ Successfully removed ${args.package}`));
        this.showNextSteps(args.package);
      } else {
        this.error(`Failed to remove ${args.package}`);
      }
    } catch (error) {
      logger.error('Failed to remove package', error);
      this.error(error instanceof Error ? error.message : 'Unknown error occurred');
    }
  }

  private async showDryRun(
    packageName: string,
    project: ProjectProfile,
    flags: RemoveCommandFlags
  ): Promise<void> {
    this.log(chalk.yellow('🧪 Dry run - showing what would be removed:\n'));

    // Check if package exists in project
    const packageExists = await this.checkPackageExists(packageName, project);

    if (!packageExists.found) {
      this.log(chalk.red(`❌ Package '${packageName}' not found in project`));
      this.showSimilarPackages(packageName, project);
      return;
    }

    this.log(chalk.red(`🗑️  Would remove: ${chalk.white(packageName)}`));
    this.log(chalk.gray(`   Type: ${packageExists.type}`));
    this.log(chalk.gray(`   From project: ${project.name}`));

    if (packageExists.version) {
      this.log(chalk.gray(`   Version: ${packageExists.version}`));
    }

    if (packageExists.description) {
      this.log(chalk.gray(`   Description: ${packageExists.description}`));
    }

    if (packageExists.installedAt) {
      this.log(chalk.gray(`   Installed: ${packageExists.installedAt}`));
    }

    // Show dependent services/packages
    const dependents = await this.findDependents(packageName, project);
    if (dependents.length > 0) {
      this.log(chalk.yellow(`   ⚠️  Packages that depend on this:`));
      dependents.forEach(dep => {
        this.log(chalk.gray(`     • ${dep.name} (${dep.type})`));
      });
    }

    // Show what data would be removed
    if (packageExists.type === 'service' && !flags['keep-data']) {
      this.log(chalk.yellow(`   ⚠️  Service data will be removed`));
      this.log(chalk.gray(`     Use --keep-data to preserve data`));
    }

    this.log(chalk.yellow('\n💡 Run without --dry-run to remove the package'));
  }

  private async getConfirmation(
    packageName: string,
    project: ProjectProfile,
    flags: RemoveCommandFlags
  ): Promise<boolean> {
    const packageExists = await this.checkPackageExists(packageName, project);

    if (!packageExists.found) {
      this.log(chalk.red(`Package '${packageName}' not found in project.`));
      return false;
    }

    // Show what will be removed
    this.log(chalk.blue(`\nPackage to remove:`));
    this.log(chalk.gray(`   Name: ${packageName}`));
    this.log(chalk.gray(`   Type: ${packageExists.type}`));
    if (packageExists.version) {
      this.log(chalk.gray(`   Version: ${packageExists.version}`));
    }

    // Show warnings
    const dependents = await this.findDependents(packageName, project);
    if (dependents.length > 0) {
      this.log(chalk.yellow(`\n⚠️  Warning: ${dependents.length} package(s) depend on this:`));
      dependents.forEach(dep => {
        this.log(chalk.gray(`   • ${dep.name}`));
      });
    }

    if (packageExists.type === 'service' && !flags['keep-data']) {
      this.log(chalk.yellow(`\n⚠️  Warning: Service data will be permanently deleted`));
    }

    // Interactive confirmation
    try {
      const { confirmed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmed',
          message: `Are you sure you want to remove ${chalk.white(packageName)}?`,
          default: false,
        },
      ]);

      return confirmed;
    } catch (error) {
      // Handle cases where inquirer fails (e.g., non-interactive environments)
      logger.warn('Could not prompt for confirmation, defaulting to false');
      return false;
    }
  }

  private async checkPackageExists(
    packageName: string,
    project: ProjectProfile
  ): Promise<PackageExistsResult> {
    // Type-safe access to project packages
    const packages: ProjectPackages | undefined = project.packages;
    if (!packages) {
      return { found: false };
    }

    // Check runtimes
    if (packages.runtimes && packages.runtimes[packageName]) {
      const result: PackageExistsResult = {
        found: true,
        type: 'runtime',
        version: packages.runtimes[packageName],
        description: `${packageName} runtime environment`,
      };

      // Only add installedAt if we can determine it
      try {
        const installDate = await this.getInstallDate(packageName, 'runtime');
        if (installDate) {
          result.installedAt = installDate;
        }
      } catch {
        // Ignore errors getting install date
      }

      return result;
    }

    // Check services
    if (packages.services) {
      const service: ServicePackageDefinition | undefined = packages.services.find(
        (s: ServicePackageDefinition) => s.name === packageName
      );
      if (service) {
        const result: PackageExistsResult = {
          found: true,
          type: 'service',
          description: `${service.template || packageName} service`,
          ...(service.version && { version: service.version }),
        };

        // Only add installedAt if we can determine it
        try {
          const installDate = await this.getInstallDate(packageName, 'service');
          if (installDate) {
            result.installedAt = installDate;
          }
        } catch {
          // Ignore errors getting install date
        }

        return result;
      }
    }

    // Check dependencies
    if (packages.dependencies) {
      const dependency: DependencyDefinition | undefined = packages.dependencies.find(
        (d: DependencyDefinition) => d.name === packageName
      );
      if (dependency) {
        const result: PackageExistsResult = {
          found: true,
          type: 'dependency',
          description: `${dependency.runtime || 'unknown'} dependency`,
          ...(dependency.version && { version: dependency.version }),
        };

        // Only add installedAt if we can determine it
        try {
          const installDate = await this.getInstallDate(packageName, 'dependency');
          if (installDate) {
            result.installedAt = installDate;
          }
        } catch {
          // Ignore errors getting install date
        }

        return result;
      }
    }

    return { found: false };
  }

  private async getInstallDate(_packageName: string, _type: string): Promise<string | null> {
    try {
      // This would integrate with your package managers to get actual install dates
      // For now, return null to avoid undefined issues
      return null;
    } catch {
      return null;
    }
  }

  private async findDependents(
    packageName: string,
    project: ProjectProfile
  ): Promise<DependentPackage[]> {
    const dependents: DependentPackage[] = [];

    // Check if any services depend on this package
    if (project.services) {
      project.services.forEach((service: Service) => {
        if (service.dependencies && service.dependencies.includes(packageName)) {
          dependents.push({ name: service.name, type: 'service' });
        }
      });
    }

    // For runtimes, check if any dependencies use this runtime
    const packages: ProjectPackages | undefined = project.packages;
    if (packages?.dependencies) {
      packages.dependencies.forEach((dep: DependencyDefinition) => {
        if (dep.runtime === packageName) {
          dependents.push({ name: dep.name, type: 'dependency' });
        }
      });
    }

    return dependents;
  }

  private showSimilarPackages(packageName: string, project: ProjectProfile): void {
    const packages: ProjectPackages | undefined = project.packages;
    if (!packages) return;

    const allPackages = [
      ...Object.keys(packages.runtimes || {}),
      ...(packages.services || []).map((s: ServicePackageDefinition) => s.name),
      ...(packages.dependencies || []).map((d: DependencyDefinition) => d.name),
    ];

    const similar = allPackages.filter(
      pkg =>
        pkg.toLowerCase().includes(packageName.toLowerCase()) ||
        packageName.toLowerCase().includes(pkg.toLowerCase())
    );

    if (similar.length > 0) {
      this.log(chalk.blue('\n💡 Similar packages found:'));
      similar.forEach(pkg => {
        this.log(chalk.gray(`   • ${pkg}`));
      });
    } else {
      this.log(chalk.blue('\n💡 Available packages:'));
      allPackages.slice(0, 5).forEach(pkg => {
        this.log(chalk.gray(`   • ${pkg}`));
      });
    }
  }

  private showNextSteps(_packageName: string): void {
    this.log(chalk.blue('\n🎯 Next steps:'));
    this.log(chalk.gray(`   • Check project status: ${chalk.white('switchr status')}`));
    this.log(chalk.gray(`   • View remaining packages: ${chalk.white('switchr packages')}`));
    this.log(chalk.gray(`   • Add other packages: ${chalk.white('switchr add <package>')}`));
    this.log(chalk.gray(`   • Clean up unused files: ${chalk.white('switchr clean')}`));
  }
}
