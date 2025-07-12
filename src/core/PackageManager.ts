import * as path from 'path';
import * as fs from 'fs-extra';
import { RuntimeRegistry } from './runtime/RuntimeRegistry';
import { ServiceTemplateRegistry } from './service/ServiceTemplateRegistry';
import { LockFileManager } from './LockFileManager';
import { PackageDefinition, RuntimePackage, ServicePackage, LockFile } from '../types/Package';
import { RuntimeType } from '../types/Runtime';
import { logger } from '../utils/Logger';
import { ConfigManager } from './ConfigManager';

export interface PackageManagerOptions {
  projectPath: string;
  cacheDir: string;
  skipLockfileUpdate?: boolean;
  force?: boolean;
}

/**
 * Central package manager for Switchr
 * Handles runtime versions, services, and dependencies
 */
export class PackageManager {
  private projectPath: string;
  private cacheDir: string;
  private lockFileManager: LockFileManager;
  private configManager: ConfigManager;

  constructor(options: PackageManagerOptions) {
    this.projectPath = options.projectPath;
    this.cacheDir = options.cacheDir;
    this.lockFileManager = new LockFileManager(this.projectPath);
    this.configManager = ConfigManager.getInstance();
  }

  /**
   * Install all packages defined in project configuration
   */
  async installAll(): Promise<void> {
    logger.info('Installing all packages for project');

    try {
      const projectConfig = await this.configManager.loadProjectConfig(this.projectPath);
      if (!projectConfig?.packages) {
        logger.info('No packages defined in project configuration');
        return;
      }

      const { runtimes = {}, dependencies = [], services = [] } = projectConfig.packages;

      // Install runtimes first
      await this.installRuntimes(runtimes);

      // Install dependencies
      await this.installDependencies(dependencies);

      // Install services
      await this.installServices(services);

      // Update lock file
      await this.updateLockFile();

      logger.info('Successfully installed all packages');
    } catch (error) {
      logger.error('Failed to install packages', error);
      throw error;
    }
  }

  /**
   * Add a new package to the project
   */
  async addPackage(
    packageSpec: string,
    options: {
      dev?: boolean;
      global?: boolean;
      optional?: boolean;
    } = {}
  ): Promise<void> {
    logger.info(`Adding package: ${packageSpec}`);

    try {
      const packageDef = await this.parsePackageSpec(packageSpec);

      // Add package based on type
      switch (packageDef.type) {
        case 'runtime':
          await this.addRuntime(packageDef as RuntimePackage);
          break;
        case 'service':
          await this.addService(packageDef as ServicePackage);
          break;
        case 'dependency':
          await this.addDependency(packageDef, options);
          break;
        default:
          throw new Error(`Unsupported package type: ${packageDef.type}`);
      }

      // Update project configuration
      await this.updateProjectConfig(packageDef, 'add', options);

      // Update lock file
      await this.updateLockFile();

      logger.info(`Successfully added package: ${packageSpec}`);
    } catch (error) {
      logger.error(`Failed to add package: ${packageSpec}`, error);
      throw error;
    }
  }

  /**
   * Remove a package from the project
   */
  async removePackage(packageName: string): Promise<void> {
    logger.info(`Removing package: ${packageName}`);

    try {
      const projectConfig = await this.configManager.loadProjectConfig(this.projectPath);
      if (!projectConfig?.packages) {
        throw new Error('No packages found in project configuration');
      }

      // Find and remove package
      const packageDef = await this.findPackageInConfig(packageName, projectConfig.packages);
      if (!packageDef) {
        throw new Error(`Package not found: ${packageName}`);
      }

      // Remove based on type
      switch (packageDef.type) {
        case 'runtime':
          await this.removeRuntime(packageDef as RuntimePackage);
          break;
        case 'service':
          await this.removeService(packageDef as ServicePackage);
          break;
        case 'dependency':
          await this.removeDependency(packageDef);
          break;
      }

      // Update project configuration
      await this.updateProjectConfig(packageDef, 'remove');

      // Update lock file
      await this.updateLockFile();

      logger.info(`Successfully removed package: ${packageName}`);
    } catch (error) {
      logger.error(`Failed to remove package: ${packageName}`, error);
      throw error;
    }
  }

  /**
   * Search for available packages
   */
  async searchPackages(query: string, type?: PackageType): Promise<PackageDefinition[]> {
    logger.debug(`Searching packages: ${query}`);

    const results: PackageDefinition[] = [];

    try {
      // Search runtimes
      if (!type || type === 'runtime') {
        const runtimeResults = await this.searchRuntimes(query);
        results.push(...runtimeResults);
      }

      // Search services
      if (!type || type === 'service') {
        const serviceResults = await this.searchServices(query);
        results.push(...serviceResults);
      }

      // Search dependencies (package managers)
      if (!type || type === 'dependency') {
        const depResults = await this.searchDependencies(query);
        results.push(...depResults);
      }

      return results.slice(0, 50); // Limit results
    } catch (error) {
      logger.error(`Failed to search packages: ${query}`, error);
      return [];
    }
  }

  /**
   * Update all packages to latest compatible versions
   */
  async updatePackages(packageName?: string): Promise<void> {
    logger.info(packageName ? `Updating package: ${packageName}` : 'Updating all packages');

    try {
      const projectConfig = await this.configManager.loadProjectConfig(this.projectPath);
      if (!projectConfig?.packages) {
        logger.info('No packages to update');
        return;
      }

      const lockFile = await this.lockFileManager.read();

      if (packageName) {
        await this.updateSinglePackage(packageName, projectConfig.packages, lockFile);
      } else {
        await this.updateAllPackages(projectConfig.packages, lockFile);
      }

      // Update lock file with new versions
      await this.updateLockFile();

      logger.info('Successfully updated packages');
    } catch (error) {
      logger.error('Failed to update packages', error);
      throw error;
    }
  }

  /**
   * Get current package status
   */
  async getPackageStatus(): Promise<{
    runtimes: Array<{ name: string; version: string; installed: boolean; active: boolean }>;
    services: Array<{ name: string; version: string; running: boolean }>;
    dependencies: Array<{ name: string; version: string; installed: boolean }>;
  }> {
    const status = {
      runtimes: [] as any[],
      services: [] as any[],
      dependencies: [] as any[],
    };

    try {
      const projectConfig = await this.configManager.loadProjectConfig(this.projectPath);
      if (!projectConfig?.packages) {
        return status;
      }

      // Check runtime status
      if (projectConfig.packages.runtimes) {
        for (const [runtimeType, version] of Object.entries(projectConfig.packages.runtimes)) {
          if (RuntimeRegistry.isSupported(runtimeType)) {
            const manager = RuntimeRegistry.create(
              runtimeType as RuntimeType,
              this.projectPath,
              this.cacheDir
            );
            const installed = await manager.isInstalled(version);
            const currentEnv = await manager.getCurrentVersion();
            const active = currentEnv?.version === version;

            status.runtimes.push({
              name: runtimeType,
              version,
              installed,
              active,
            });
          }
        }
      }

      // Check service status
      if (projectConfig.packages.services) {
        for (const service of projectConfig.packages.services) {
          // This would integrate with your existing service status checking
          status.services.push({
            name: service.name,
            version: service.version || 'latest',
            running: false, // TODO: Integrate with existing service status
          });
        }
      }

      return status;
    } catch (error) {
      logger.error('Failed to get package status', error);
      return status;
    }
  }

  // Private helper methods

  private async installRuntimes(runtimes: Record<string, string>): Promise<void> {
    for (const [runtimeType, version] of Object.entries(runtimes)) {
      if (RuntimeRegistry.isSupported(runtimeType)) {
        logger.info(`Installing ${runtimeType}@${version}`);

        const manager = RuntimeRegistry.create(
          runtimeType as RuntimeType,
          this.projectPath,
          this.cacheDir
        );
        await manager.install({
          version,
          projectPath: this.projectPath,
          skipIfExists: true,
        });
        await manager.activate(version);
      } else {
        logger.warn(`Unsupported runtime: ${runtimeType}`);
      }
    }
  }

  private async installDependencies(dependencies: PackageDefinition[]): Promise<void> {
    // Group dependencies by runtime
    const runtimeGroups = new Map<string, PackageDefinition[]>();

    for (const dep of dependencies) {
      const runtime = dep.runtime || 'system';
      if (!runtimeGroups.has(runtime)) {
        runtimeGroups.set(runtime, []);
      }
      runtimeGroups.get(runtime)!.push(dep);
    }

    // Install dependencies for each runtime
    for (const [runtime, deps] of runtimeGroups) {
      await this.installDependenciesForRuntime(runtime, deps);
    }
  }

  private async installServices(services: ServicePackage[]): Promise<void> {
    for (const service of services) {
      logger.info(`Installing service: ${service.name}`);

      const template = ServiceTemplateRegistry.getTemplate(service.template);
      if (template) {
        await template.install(service.config || {});
      } else {
        logger.warn(`Unknown service template: ${service.template}`);
      }
    }
  }

  private async parsePackageSpec(spec: string): Promise<PackageDefinition> {
    // Parse package specifications like:
    // nodejs@18.17.0
    // postgresql@15
    // express@4.18.0

    const [nameWithScope, version] = spec.split('@');
    const name = nameWithScope;

    // Determine package type
    let type: PackageType = 'dependency';

    if (['nodejs', 'python', 'go', 'java', 'rust'].includes(name)) {
      type = 'runtime';
    } else if (ServiceTemplateRegistry.hasTemplate(name)) {
      type = 'service';
    }

    return {
      name,
      version,
      type,
    };
  }

  private async addRuntime(runtime: RuntimePackage): Promise<void> {
    if (!RuntimeRegistry.isSupported(runtime.name)) {
      throw new Error(`Unsupported runtime: ${runtime.name}`);
    }

    const manager = RuntimeRegistry.create(
      runtime.name as RuntimeType,
      this.projectPath,
      this.cacheDir
    );
    await manager.install({
      version: runtime.version!,
      projectPath: this.projectPath,
    });
    await manager.activate(runtime.version!);
  }

  private async addService(service: ServicePackage): Promise<void> {
    const template = ServiceTemplateRegistry.getTemplate(service.template);
    if (!template) {
      throw new Error(`Unknown service template: ${service.template}`);
    }

    await template.install(service.config || {});
  }

  private async addDependency(dep: PackageDefinition, options: any): Promise<void> {
    const runtime = dep.runtime || (await this.detectPrimaryRuntime());
    await this.installDependenciesForRuntime(runtime, [dep]);
  }

  private async installDependenciesForRuntime(
    runtime: string,
    deps: PackageDefinition[]
  ): Promise<void> {
    // This would integrate with existing package managers
    // npm, pip, go mod, cargo, etc.
    logger.debug(`Installing ${deps.length} dependencies for ${runtime}`);

    // Implementation would depend on the runtime
    switch (runtime) {
      case 'nodejs':
        await this.installNodeDependencies(deps);
        break;
      case 'python':
        await this.installPythonDependencies(deps);
        break;
      // Add other runtimes...
    }
  }

  private async installNodeDependencies(deps: PackageDefinition[]): Promise<void> {
    // Use npm/yarn/pnpm to install packages
    // This would integrate with your existing Node.js detection
  }

  private async installPythonDependencies(deps: PackageDefinition[]): Promise<void> {
    // Use pip to install packages in virtual environment
  }

  private async detectPrimaryRuntime(): Promise<string> {
    // Detect primary runtime from project files
    const projectConfig = await this.configManager.loadProjectConfig(this.projectPath);
    return projectConfig?.type || 'nodejs';
  }

  private async updateLockFile(): Promise<void> {
    // Generate new lock file with current package state
    const lockFile = await this.generateLockFile();
    await this.lockFileManager.write(lockFile);
  }

  private async generateLockFile(): Promise<LockFile> {
    // Implementation to generate lock file from current state
    const projectConfig = await this.configManager.loadProjectConfig(this.projectPath);

    return {
      lockfileVersion: 1,
      name: projectConfig?.name || 'unknown',
      switchrVersion: '0.1.0', // Get from package.json
      generated: new Date().toISOString(),
      runtimes: {},
      packages: {},
      services: {},
    };
  }

  private async findPackageInConfig(
    name: string,
    packages: any
  ): Promise<PackageDefinition | null> {
    // Search through configuration to find package
    return null; // Implementation needed
  }

  private async updateProjectConfig(
    packageDef: PackageDefinition,
    action: 'add' | 'remove',
    options?: any
  ): Promise<void> {
    // Update the project configuration file
    // This would modify switchr.yml
  }

  // Placeholder methods for search functionality
  private async searchRuntimes(query: string): Promise<PackageDefinition[]> {
    return [];
  }

  private async searchServices(query: string): Promise<PackageDefinition[]> {
    return [];
  }

  private async searchDependencies(query: string): Promise<PackageDefinition[]> {
    return [];
  }

  private async removeRuntime(runtime: RuntimePackage): Promise<void> {
    // Implementation for removing runtime
  }

  private async removeService(service: ServicePackage): Promise<void> {
    // Implementation for removing service
  }

  private async removeDependency(dep: PackageDefinition): Promise<void> {
    // Implementation for removing dependency
  }

  private async updateSinglePackage(
    name: string,
    packages: any,
    lockFile: LockFile | null
  ): Promise<void> {
    // Implementation for updating single package
  }

  private async updateAllPackages(packages: any, lockFile: LockFile | null): Promise<void> {
    // Implementation for updating all packages
  }
}
