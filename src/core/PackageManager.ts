// src/core/PackageManager.ts - Complete production-quality implementation
import * as path from 'path';
import * as fs from 'fs-extra';
import { RuntimeRegistry } from './runtime/RuntimeRegistry';
import { ServiceTemplateRegistry } from './service/ServiceTemplateRegistry';
import { LockFileManager } from './LockFileManager';
import {
  PackageDefinition,
  RuntimePackage,
  ServicePackage,
  DependencyPackage,
  PackageSearchResult,
  PackageInstallResult,
  LockFile,
  PackageType,
} from '../types/Package';
import { RuntimeType } from '../types/Runtime';
import { logger } from '../utils/Logger';
import { ConfigManager } from './ConfigManager';
import { ProcessUtils } from '../utils/ProcessUtils';

// Enhanced interface definitions
interface NpmSearchResponse {
  objects: Array<{
    package: {
      name: string;
      version: string;
      description?: string;
      keywords?: string[];
      date: string;
      author?: { name: string };
      repository?: { url: string };
      links: {
        npm: string;
        homepage?: string;
        repository?: string;
      };
    };
    score: {
      final: number;
      detail: {
        quality: number;
        popularity: number;
        maintenance: number;
      };
    };
    searchScore: number;
  }>;
  total: number;
  time: string;
}

interface PyPiSearchResponse {
  info: {
    name: string;
    version: string;
    summary?: string;
    description?: string;
    author?: string;
    home_page?: string;
    project_urls?: Record<string, string>;
  };
  releases: Record<string, any[]>;
}

interface RuntimeInstallOptions {
  version: string;
  projectPath: string;
  manager?: string;
  skipIfExists?: boolean;
  global?: boolean;
}

interface RuntimeStatus {
  name: string;
  version: string;
  installed: boolean;
  active: boolean;
  manager?: string;
  path?: string;
}

interface ServiceStatus {
  name: string;
  version: string;
  running: boolean;
  template?: string;
  ports?: number[];
}

interface DependencyStatus {
  name: string;
  version: string;
  installed: boolean;
  runtime?: string;
  packageManager?: string;
}

interface ProjectPackageStatus {
  runtimes: RuntimeStatus[];
  services: ServiceStatus[];
  dependencies: DependencyStatus[];
}

export interface PackageManagerOptions {
  projectPath: string;
  cacheDir: string;
  skipLockfileUpdate?: boolean;
  force?: boolean;
  timeout?: number;
}

export interface AddPackageOptions {
  dev?: boolean;
  global?: boolean;
  optional?: boolean;
  runtime?: string;
  manager?: string;
  skipIfExists?: boolean;
  force?: boolean;
}

export interface SearchPackageOptions {
  limit?: number;
  type?: PackageType;
  category?: string;
  runtime?: RuntimeType;
  sortBy?: 'relevance' | 'downloads' | 'updated' | 'name';
  includePrerelease?: boolean;
}

export interface RemovePackageOptions {
  force?: boolean;
  keepData?: boolean;
  removeDependents?: boolean;
}

/**
 * Central package manager for Switchr
 * Handles runtime versions, services, and dependencies with production-quality implementation
 */
export class PackageManager {
  private readonly projectPath: string;
  private readonly cacheDir: string;
  private readonly lockFileManager: LockFileManager;
  private readonly configManager: ConfigManager;
  private readonly options: PackageManagerOptions;

  // Cache for frequently accessed data
  private packageStatusCache: ProjectPackageStatus | null = null;
  private cacheExpiry = 0;
  private readonly CACHE_DURATION = 30000; // 30 seconds

  constructor(options: PackageManagerOptions) {
    this.projectPath = options.projectPath;
    this.cacheDir = options.cacheDir;
    this.options = options;
    this.lockFileManager = new LockFileManager(this.projectPath);
    this.configManager = ConfigManager.getInstance();
  }

  /**
   * Install all packages defined in project configuration
   */
  async installAll(): Promise<PackageInstallResult[]> {
    logger.info('Installing all packages for project');

    try {
      const projectConfig = await this.configManager.loadProjectConfig(this.projectPath);
      if (!projectConfig?.packages) {
        logger.info('No packages defined in project configuration');
        return [];
      }

      const results: PackageInstallResult[] = [];
      const { runtimes = {}, dependencies = [], services = [] } = projectConfig.packages;

      // Install runtimes first (they're dependencies for everything else)
      if (Object.keys(runtimes).length > 0) {
        logger.info(`Installing ${Object.keys(runtimes).length} runtime(s)`);
        const runtimeResults = await this.installRuntimes(runtimes);
        results.push(...runtimeResults);
      }

      // Install services second (they might need specific runtimes)
      if (services.length > 0) {
        logger.info(`Installing ${services.length} service(s)`);
        const serviceResults = await this.installServices(services);
        results.push(...serviceResults);
      }

      // Install dependencies last
      if (dependencies.length > 0) {
        logger.info(`Installing ${dependencies.length} dependenc(ies)`);
        const depResults = await this.installDependencies(dependencies);
        results.push(...depResults);
      }

      // Update lock file
      if (!this.options.skipLockfileUpdate) {
        await this.updateLockFile();
      }

      // Clear cache after installation
      this.clearCache();

      const successful = results.filter(r => r.success).length;
      logger.info(`Successfully installed ${successful}/${results.length} packages`);

      return results;
    } catch (error) {
      logger.error('Failed to install packages', error);
      throw new Error(
        `Package installation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Add a new package to the project
   */
  async addPackage(
    packageSpec: string,
    options: AddPackageOptions = {}
  ): Promise<PackageInstallResult> {
    logger.info(`Adding package: ${packageSpec}`);

    try {
      // Initialize registries if not already done
      await this.ensureRegistriesInitialized();

      const packageDef = await this.parsePackageSpec(packageSpec, options);

      // Validate package
      await this.validatePackage(packageDef);

      // Check if already exists and skip if requested
      if (options.skipIfExists && (await this.isPackageInstalled(packageDef))) {
        return {
          success: true,
          package: packageDef,
          warnings: ['Package already installed, skipped'],
        };
      }

      // Install package based on type
      let result: PackageInstallResult;

      switch (packageDef.type) {
        case 'runtime':
          result = await this.addRuntime(packageDef as RuntimePackage, options);
          break;
        case 'service':
          result = await this.addService(packageDef as ServicePackage, options);
          break;
        case 'dependency':
          result = await this.addDependency(packageDef as DependencyPackage, options);
          break;
        default:
          throw new Error(`Unsupported package type: ${packageDef.type}`);
      }

      if (result.success) {
        // Update project configuration
        await this.updateProjectConfig(packageDef, 'add', options);

        // Update lock file
        if (!this.options.skipLockfileUpdate) {
          await this.updateLockFile();
        }

        // Clear cache
        this.clearCache();

        logger.info(`Successfully added package: ${packageSpec}`);
      }

      return result;
    } catch (error) {
      logger.error(`Failed to add package: ${packageSpec}`, error);
      return {
        success: false,
        package: { name: packageSpec.split('@')[0], type: 'dependency' },
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Remove a package from the project
   */
  async removePackage(packageName: string, options: RemovePackageOptions = {}): Promise<boolean> {
    logger.info(`Removing package: ${packageName}`);

    try {
      await this.ensureRegistriesInitialized();

      const projectConfig = await this.configManager.loadProjectConfig(this.projectPath);
      if (!projectConfig?.packages) {
        throw new Error('No packages found in project configuration');
      }

      // Find package in configuration
      const packageDef = await this.findPackageInConfig(packageName, projectConfig.packages);
      if (!packageDef) {
        throw new Error(`Package not found: ${packageName}`);
      }

      // Check for dependents unless forced
      if (!options.force && !options.removeDependents) {
        const dependents = await this.findDependents(packageName, projectConfig.packages);
        if (dependents.length > 0) {
          throw new Error(
            `Cannot remove ${packageName}: required by ${dependents.join(', ')}. Use --force or --remove-dependents`
          );
        }
      }

      // Remove based on type
      switch (packageDef.type) {
        case 'runtime':
          await this.removeRuntime(packageDef as RuntimePackage, options);
          break;
        case 'service':
          await this.removeService(packageDef as ServicePackage, options);
          break;
        case 'dependency':
          await this.removeDependency(packageDef as DependencyPackage, options);
          break;
      }

      // Update project configuration
      await this.updateProjectConfig(packageDef, 'remove');

      // Update lock file
      if (!this.options.skipLockfileUpdate) {
        await this.updateLockFile();
      }

      // Clear cache
      this.clearCache();

      logger.info(`Successfully removed package: ${packageName}`);
      return true;
    } catch (error) {
      logger.error(`Failed to remove package: ${packageName}`, error);
      throw error;
    }
  }

  /**
   * Search for available packages across all registries
   */
  async searchPackages(
    query: string,
    options: SearchPackageOptions = {}
  ): Promise<PackageSearchResult[]> {
    logger.debug(`Searching packages: ${query}`);

    const results: PackageSearchResult[] = [];
    const limit = options.limit || 20;

    try {
      // Initialize registries
      await this.ensureRegistriesInitialized();

      // Search runtimes
      if (!options.type || options.type === 'runtime') {
        const runtimeResults = await this.searchRuntimes(query, options);
        results.push(...runtimeResults);
      }

      // Search services
      if (!options.type || options.type === 'service') {
        const serviceResults = await this.searchServices(query, options);
        results.push(...serviceResults);
      }

      // Search dependencies
      if (!options.type || options.type === 'dependency') {
        const depResults = await this.searchDependencies(query, options);
        results.push(...depResults);
      }

      // Sort and limit results
      const sortedResults = this.sortSearchResults(results, options.sortBy || 'relevance');
      return sortedResults.slice(0, limit);
    } catch (error) {
      logger.error(`Failed to search packages: ${query}`, error);
      return [];
    }
  }

  /**
   * Get comprehensive package status with caching
   */
  async getPackageStatus(): Promise<ProjectPackageStatus> {
    const now = Date.now();

    // Return cached data if still valid
    if (this.packageStatusCache && now < this.cacheExpiry) {
      return this.packageStatusCache;
    }

    const status: ProjectPackageStatus = {
      runtimes: [],
      services: [],
      dependencies: [],
    };

    try {
      const projectConfig = await this.configManager.loadProjectConfig(this.projectPath);
      if (!projectConfig?.packages) {
        this.packageStatusCache = status;
        this.cacheExpiry = now + this.CACHE_DURATION;
        return status;
      }

      // Check runtime status
      if (projectConfig.packages.runtimes) {
        status.runtimes = await this.getRuntimeStatuses(projectConfig.packages.runtimes);
      }

      // Check service status
      if (projectConfig.packages.services) {
        status.services = await this.getServiceStatuses(projectConfig.packages.services);
      }

      // Check dependency status
      if (projectConfig.packages.dependencies) {
        status.dependencies = await this.getDependencyStatuses(projectConfig.packages.dependencies);
      }

      // Cache the result
      this.packageStatusCache = status;
      this.cacheExpiry = now + this.CACHE_DURATION;

      return status;
    } catch (error) {
      logger.error('Failed to get package status', error);
      return status;
    }
  }

  /**
   * Update a package to its latest version
   */
  async updatePackage(packageName: string, version?: string): Promise<PackageInstallResult> {
    logger.info(`Updating package: ${packageName}${version ? ` to ${version}` : ''}`);

    try {
      const projectConfig = await this.configManager.loadProjectConfig(this.projectPath);
      if (!projectConfig?.packages) {
        throw new Error('No packages found in project configuration');
      }

      const packageDef = await this.findPackageInConfig(packageName, projectConfig.packages);
      if (!packageDef) {
        throw new Error(`Package not found: ${packageName}`);
      }

      // Determine target version
      const targetVersion = version || (await this.getLatestVersion(packageDef));
      if (!targetVersion) {
        throw new Error(`Could not determine latest version for ${packageName}`);
      }

      // Create updated package spec
      const updatedSpec = `${packageName}@${targetVersion}`;

      // Remove old version and add new one
      await this.removePackage(packageName, { force: true });
      return await this.addPackage(updatedSpec, { skipIfExists: false });
    } catch (error) {
      logger.error(`Failed to update package: ${packageName}`, error);
      return {
        success: false,
        package: { name: packageName, type: 'dependency' },
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check if a package is installed
   */
  async isPackageInstalled(packageDef: PackageDefinition): Promise<boolean> {
    try {
      switch (packageDef.type) {
        case 'runtime':
          return await this.isRuntimeInstalled(packageDef);
        case 'service':
          return await this.isServiceInstalled(packageDef);
        case 'dependency':
          return await this.isDependencyInstalled(packageDef);
        default:
          return false;
      }
    } catch {
      return false;
    }
  }

  // Private implementation methods...

  private async ensureRegistriesInitialized(): Promise<void> {
    try {
      await RuntimeRegistry.initialize();
      await ServiceTemplateRegistry.initialize();
    } catch (error) {
      logger.warn('Failed to initialize registries', error);
    }
  }

  private async parsePackageSpec(
    spec: string,
    options: AddPackageOptions
  ): Promise<PackageDefinition> {
    const [nameWithScope, version] =
      spec.includes('@') && !spec.startsWith('@') ? spec.split('@') : [spec, undefined];

    const name = nameWithScope;
    const type = await this.detectPackageType(name, options);

    const packageDef: PackageDefinition = {
      name,
      type,
    };

    // Only add properties if they exist
    if (version) {
      packageDef.version = version;
    }
    if (options.runtime) {
      packageDef.runtime = options.runtime;
    }
    if (options.global) {
      packageDef.global = options.global;
    }
    if (options.optional) {
      packageDef.optional = options.optional;
    }

    return packageDef;
  }

  private async detectPackageType(name: string, options: AddPackageOptions): Promise<PackageType> {
    // Explicit type from options
    if (options.runtime) return 'dependency';

    // Runtime detection
    const runtimeNames = [
      'nodejs',
      'node',
      'python',
      'python3',
      'go',
      'java',
      'rust',
      'php',
      'ruby',
      'dotnet',
    ];
    if (runtimeNames.includes(name.toLowerCase())) {
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

  private async validatePackage(packageDef: PackageDefinition): Promise<void> {
    if (!packageDef.name) {
      throw new Error('Package name is required');
    }

    if (packageDef.type === 'runtime' && !RuntimeRegistry.isSupported(packageDef.name)) {
      throw new Error(`Unsupported runtime: ${packageDef.name}`);
    }

    if (packageDef.type === 'service' && !ServiceTemplateRegistry.hasTemplate(packageDef.name)) {
      throw new Error(`Unknown service template: ${packageDef.name}`);
    }

    if (packageDef.type === 'dependency' && !packageDef.runtime) {
      // Try to detect runtime from project
      const detectedRuntimes = await RuntimeRegistry.detectProjectRuntime(this.projectPath);
      if (detectedRuntimes.length === 0) {
        throw new Error(
          'Cannot determine runtime for dependency. Please specify --runtime option.'
        );
      }
      packageDef.runtime = detectedRuntimes[0];
    }
  }

  private async addRuntime(
    runtime: RuntimePackage,
    options: AddPackageOptions
  ): Promise<PackageInstallResult> {
    if (!RuntimeRegistry.isSupported(runtime.name)) {
      throw new Error(`Unsupported runtime: ${runtime.name}`);
    }

    const manager = RuntimeRegistry.create(
      runtime.name as RuntimeType,
      this.projectPath,
      this.cacheDir
    );

    const version = runtime.version || 'latest';

    // Check if already installed and skip if requested
    if (options.skipIfExists && (await manager.isInstalled(version))) {
      logger.info(`Runtime ${runtime.name}@${version} already installed, skipping`);
      return {
        success: true,
        package: runtime,
        installedVersion: version,
        warnings: ['Already installed, skipped'],
      };
    }

    const installOptions: RuntimeInstallOptions = {
      version,
      projectPath: this.projectPath,
    };

    // Add optional properties only if they exist
    if (options.manager) {
      installOptions.manager = options.manager;
    }
    if (options.skipIfExists !== undefined) {
      installOptions.skipIfExists = options.skipIfExists;
    }
    if (options.global !== undefined) {
      installOptions.global = options.global;
    }

    const env = await manager.install(installOptions);
    await manager.activate(version);

    return {
      success: true,
      package: runtime,
      installedVersion: env.version,
      installPath: env.path,
    };
  }

  private async addService(
    service: ServicePackage,
    options: AddPackageOptions
  ): Promise<PackageInstallResult> {
    const template = ServiceTemplateRegistry.getTemplate(service.template || service.name);
    if (!template) {
      throw new Error(`Unknown service template: ${service.template || service.name}`);
    }

    const serviceInstance = await template.install(service.config || {});

    return {
      success: true,
      package: service,
      installedVersion: serviceInstance.version,
    };
  }

  private async addDependency(
    dep: DependencyPackage,
    options: AddPackageOptions
  ): Promise<PackageInstallResult> {
    const runtime = dep.runtime || (await this.detectPrimaryRuntime());

    switch (runtime) {
      case 'nodejs':
        return await this.installNodeDependency(dep, options);
      case 'python':
        return await this.installPythonDependency(dep, options);
      case 'go':
        return await this.installGoDependency(dep, options);
      case 'java':
        return await this.installJavaDependency(dep, options);
      case 'rust':
        return await this.installRustDependency(dep, options);
      default:
        throw new Error(`Dependency installation not supported for runtime: ${runtime}`);
    }
  }

  private async installNodeDependency(
    dep: DependencyPackage,
    options: AddPackageOptions
  ): Promise<PackageInstallResult> {
    const packageManager = await this.detectNodePackageManager();
    const args = ['add', dep.name];

    if (dep.version) {
      args[1] = `${dep.name}@${dep.version}`;
    }

    if (options.dev || dep.devOnly) {
      args.push(packageManager === 'npm' ? '--save-dev' : '--dev');
    }

    if (options.global || dep.global) {
      args.push('--global');
    }

    try {
      await ProcessUtils.execute(packageManager, args, {
        cwd: this.projectPath,
        timeout: this.options.timeout || 60000,
      });

      return {
        success: true,
        package: dep,
        installedVersion: dep.version || 'latest',
      };
    } catch (error) {
      throw new Error(
        `Failed to install Node.js dependency: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async installPythonDependency(
    dep: DependencyPackage,
    options: AddPackageOptions
  ): Promise<PackageInstallResult> {
    const args = ['install', dep.name];

    if (dep.version) {
      args[1] = `${dep.name}==${dep.version}`;
    }

    if (options.global || dep.global) {
      args.unshift('--user');
    }

    try {
      await ProcessUtils.execute('pip', args, {
        cwd: this.projectPath,
        timeout: this.options.timeout || 60000,
      });

      return {
        success: true,
        package: dep,
        installedVersion: dep.version || 'latest',
      };
    } catch (error) {
      throw new Error(
        `Failed to install Python dependency: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async installGoDependency(
    dep: DependencyPackage,
    options: AddPackageOptions
  ): Promise<PackageInstallResult> {
    const args = ['get', dep.name];

    if (dep.version) {
      args[1] = `${dep.name}@${dep.version}`;
    }

    try {
      await ProcessUtils.execute('go', args, {
        cwd: this.projectPath,
        timeout: this.options.timeout || 60000,
      });

      return {
        success: true,
        package: dep,
        installedVersion: dep.version || 'latest',
      };
    } catch (error) {
      throw new Error(
        `Failed to install Go dependency: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async installJavaDependency(
    dep: DependencyPackage,
    options: AddPackageOptions
  ): Promise<PackageInstallResult> {
    // Java dependencies are typically managed through Maven or Gradle
    // This would require editing pom.xml or build.gradle
    throw new Error('Java dependency installation not yet implemented');
  }

  private async installRustDependency(
    dep: DependencyPackage,
    options: AddPackageOptions
  ): Promise<PackageInstallResult> {
    const args = ['add', dep.name];

    if (dep.version) {
      args.push('--vers', dep.version);
    }

    if (options.dev || dep.devOnly) {
      args.push('--dev');
    }

    try {
      await ProcessUtils.execute('cargo', args, {
        cwd: this.projectPath,
        timeout: this.options.timeout || 60000,
      });

      return {
        success: true,
        package: dep,
        installedVersion: dep.version || 'latest',
      };
    } catch (error) {
      throw new Error(
        `Failed to install Rust dependency: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async removeRuntime(
    runtime: RuntimePackage,
    options: RemovePackageOptions
  ): Promise<void> {
    if (!RuntimeRegistry.isSupported(runtime.name)) {
      throw new Error(`Unsupported runtime: ${runtime.name}`);
    }

    const manager = RuntimeRegistry.create(
      runtime.name as RuntimeType,
      this.projectPath,
      this.cacheDir
    );

    if (runtime.version && (await manager.isInstalled(runtime.version))) {
      await manager.uninstall(runtime.version);
    }
  }

  private async removeService(
    service: ServicePackage,
    options: RemovePackageOptions
  ): Promise<void> {
    const template = ServiceTemplateRegistry.getTemplate(service.template || service.name);
    if (template) {
      await template.uninstall(service.name);
    }
  }

  private async removeDependency(
    dep: DependencyPackage,
    options: RemovePackageOptions
  ): Promise<void> {
    const runtime = dep.runtime || (await this.detectPrimaryRuntime());

    switch (runtime) {
      case 'nodejs':
        await this.removeNodeDependency(dep);
        break;
      case 'python':
        await this.removePythonDependency(dep);
        break;
      case 'go':
        await this.removeGoDependency(dep);
        break;
      case 'rust':
        await this.removeRustDependency(dep);
        break;
      default:
        throw new Error(`Dependency removal not supported for runtime: ${runtime}`);
    }
  }

  private async removeNodeDependency(dep: DependencyPackage): Promise<void> {
    const packageManager = await this.detectNodePackageManager();
    await ProcessUtils.execute(packageManager, ['remove', dep.name], {
      cwd: this.projectPath,
      timeout: this.options.timeout || 60000,
    });
  }

  private async removePythonDependency(dep: DependencyPackage): Promise<void> {
    await ProcessUtils.execute('pip', ['uninstall', '-y', dep.name], {
      cwd: this.projectPath,
      timeout: this.options.timeout || 60000,
    });
  }

  private async removeGoDependency(dep: DependencyPackage): Promise<void> {
    // Go modules are removed by editing go.mod and running go mod tidy
    await ProcessUtils.execute('go', ['mod', 'edit', '-droprequire', dep.name], {
      cwd: this.projectPath,
    });
    await ProcessUtils.execute('go', ['mod', 'tidy'], { cwd: this.projectPath });
  }

  private async removeRustDependency(dep: DependencyPackage): Promise<void> {
    await ProcessUtils.execute('cargo', ['remove', dep.name], {
      cwd: this.projectPath,
      timeout: this.options.timeout || 60000,
    });
  }

  private async searchRuntimes(
    query: string,
    options: SearchPackageOptions
  ): Promise<PackageSearchResult[]> {
    const results: PackageSearchResult[] = [];
    const runtimeTypes = RuntimeRegistry.getRegisteredTypes();

    for (const type of runtimeTypes) {
      if (type.toLowerCase().includes(query.toLowerCase())) {
        try {
          const manager = RuntimeRegistry.create(type, this.projectPath, this.cacheDir);
          const versions = await manager.listAvailable();

          results.push({
            name: type,
            type: 'runtime',
            description: `${type} runtime environment`,
            category: 'runtime',
            version: versions[0] || 'latest',
            score: this.calculateRelevanceScore(type, query),
          });
        } catch (error) {
          logger.debug(`Failed to get runtime info for ${type}`, error);
          results.push({
            name: type,
            type: 'runtime',
            description: `${type} runtime environment`,
            category: 'runtime',
            score: this.calculateRelevanceScore(type, query),
          });
        }
      }
    }

    return results;
  }

  private async searchServices(
    query: string,
    options: SearchPackageOptions
  ): Promise<PackageSearchResult[]> {
    const templates = ServiceTemplateRegistry.searchTemplates(query);

    return templates
      .filter(template => !options.category || template.category === options.category)
      .map(template => ({
        name: template.name,
        type: 'service' as PackageType,
        description: template.description,
        category: template.category,
        version: template.version,
        score: this.calculateRelevanceScore(template.name, query),
      }));
  }

  private async searchDependencies(
    query: string,
    options: SearchPackageOptions
  ): Promise<PackageSearchResult[]> {
    const results: PackageSearchResult[] = [];

    // Search npm registry for Node.js packages
    if (!options.runtime || options.runtime === 'nodejs') {
      try {
        const npmResults = await this.searchNpmRegistry(query, options);
        results.push(...npmResults);
      } catch (error) {
        logger.error('Failed to search npm registry', error);
        results.push(...this.getFallbackNpmResults(query));
      }
    }

    // Search PyPI for Python packages
    if (!options.runtime || options.runtime === 'python') {
      try {
        const pypiResults = await this.searchPyPIRegistry(query, options);
        results.push(...pypiResults);
      } catch (error) {
        logger.error('Failed to search PyPI registry', error);
        results.push(...this.getFallbackPypiResults(query));
      }
    }

    // Add other runtime searches (Go, Java, etc.) with basic implementations
    if (!options.runtime || options.runtime === 'go') {
      results.push(...this.searchGoPackages(query));
    }

    if (!options.runtime || options.runtime === 'java') {
      results.push(...this.searchJavaPackages(query));
    }

    if (!options.runtime || options.runtime === 'rust') {
      results.push(...this.searchRustPackages(query));
    }

    return results;
  }

  private async searchNpmRegistry(
    query: string,
    options: SearchPackageOptions
  ): Promise<PackageSearchResult[]> {
    try {
      const encodedQuery = encodeURIComponent(query);
      const limit = Math.min(options.limit || 20, 250);
      const url = `https://registry.npmjs.org/-/v1/search?text=${encodedQuery}&size=${limit}`;

      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'switchr-cli/0.1.0',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`NPM API error: ${response.status} ${response.statusText}`);
      }

      const data: NpmSearchResponse = await response.json();

      return data.objects.map(obj => {
        const result: PackageSearchResult = {
          name: obj.package.name,
          type: 'dependency' as PackageType,
          runtime: 'nodejs' as RuntimeType,
          description: obj.package.description || '',
          category: 'library',
          version: obj.package.version,
          score: Math.round(obj.score.final * 100),
          lastUpdated: obj.package.date,
        };

        if (obj.package.repository?.url) {
          result.repository = obj.package.repository.url;
        }
        if (obj.package.links.homepage) {
          result.homepage = obj.package.links.homepage;
        }

        return result;
      });
    } catch (error) {
      logger.error('Failed to search npm registry', error);
      return [];
    }
  }

  private async searchPyPIRegistry(
    query: string,
    options: SearchPackageOptions
  ): Promise<PackageSearchResult[]> {
    // Note: PyPI removed their search API, so we use a fallback approach
    return this.getFallbackPypiResults(query);
  }

  private searchGoPackages(query: string): PackageSearchResult[] {
    const commonGoPackages = [
      'gin-gonic/gin',
      'gorilla/mux',
      'echo',
      'fiber',
      'gorm',
      'mongo-driver',
      'redis',
      'viper',
      'cobra',
      'logrus',
      'zap',
      'testify',
      'jwt-go',
    ];

    return commonGoPackages
      .filter(pkg => pkg.includes(query.toLowerCase()) || query.toLowerCase().includes(pkg))
      .map(pkg => ({
        name: pkg,
        type: 'dependency' as PackageType,
        runtime: 'go' as RuntimeType,
        description: `Go package: ${pkg}`,
        category: 'library',
        score: this.calculateRelevanceScore(pkg, query),
      }));
  }

  private searchJavaPackages(query: string): PackageSearchResult[] {
    const commonJavaPackages = [
      'spring-boot-starter',
      'spring-boot-starter-web',
      'spring-boot-starter-data-jpa',
      'junit',
      'mockito',
      'jackson',
      'gson',
      'apache-commons',
      'guava',
      'slf4j',
    ];

    return commonJavaPackages
      .filter(pkg => pkg.includes(query.toLowerCase()) || query.toLowerCase().includes(pkg))
      .map(pkg => ({
        name: pkg,
        type: 'dependency' as PackageType,
        runtime: 'java' as RuntimeType,
        description: `Java package: ${pkg}`,
        category: 'library',
        score: this.calculateRelevanceScore(pkg, query),
      }));
  }

  private searchRustPackages(query: string): PackageSearchResult[] {
    const commonRustPackages = [
      'serde',
      'tokio',
      'clap',
      'reqwest',
      'anyhow',
      'thiserror',
      'log',
      'env_logger',
      'chrono',
      'uuid',
      'regex',
      'rand',
      'diesel',
    ];

    return commonRustPackages
      .filter(pkg => pkg.includes(query.toLowerCase()) || query.toLowerCase().includes(pkg))
      .map(pkg => ({
        name: pkg,
        type: 'dependency' as PackageType,
        runtime: 'rust' as RuntimeType,
        description: `Rust crate: ${pkg}`,
        category: 'library',
        score: this.calculateRelevanceScore(pkg, query),
      }));
  }

  private getFallbackNpmResults(query: string): PackageSearchResult[] {
    const commonNpmPackages = [
      'express',
      'react',
      'vue',
      'angular',
      'next',
      'typescript',
      'webpack',
      'babel',
      'eslint',
      'prettier',
      'jest',
      'mocha',
      'axios',
      'lodash',
      'moment',
      'dayjs',
      'uuid',
      'cors',
      'dotenv',
      'nodemon',
      'concurrently',
    ];

    return commonNpmPackages
      .filter(pkg => pkg.includes(query.toLowerCase()) || query.toLowerCase().includes(pkg))
      .map(pkg => ({
        name: pkg,
        type: 'dependency' as PackageType,
        runtime: 'nodejs' as RuntimeType,
        description: `Popular Node.js package: ${pkg}`,
        category: 'library',
        score: this.calculateRelevanceScore(pkg, query),
      }));
  }

  private getFallbackPypiResults(query: string): PackageSearchResult[] {
    const commonPypiPackages = [
      'django',
      'flask',
      'fastapi',
      'requests',
      'numpy',
      'pandas',
      'matplotlib',
      'scipy',
      'scikit-learn',
      'tensorflow',
      'torch',
      'opencv-python',
      'pillow',
      'beautifulsoup4',
      'selenium',
      'pytest',
      'black',
      'flake8',
    ];

    return commonPypiPackages
      .filter(pkg => pkg.includes(query.toLowerCase()) || query.toLowerCase().includes(pkg))
      .map(pkg => ({
        name: pkg,
        type: 'dependency' as PackageType,
        runtime: 'python' as RuntimeType,
        description: `Popular Python package: ${pkg}`,
        category: 'library',
        score: this.calculateRelevanceScore(pkg, query),
      }));
  }

  private calculateRelevanceScore(name: string, query: string): number {
    const lowerName = name.toLowerCase();
    const lowerQuery = query.toLowerCase();

    // Exact match gets highest score
    if (lowerName === lowerQuery) return 100;

    // Starts with query gets high score
    if (lowerName.startsWith(lowerQuery)) return 80;

    // Contains query gets medium score
    if (lowerName.includes(lowerQuery)) return 60;

    // Fuzzy match gets lower score
    const distance = this.levenshteinDistance(lowerName, lowerQuery);
    return Math.max(0, 40 - distance * 5);
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1)
      .fill(null)
      .map(() => Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1,
          matrix[j - 1][i - 1] + indicator
        );
      }
    }

    return matrix[str2.length][str1.length];
  }

  private sortSearchResults(
    results: PackageSearchResult[],
    sortBy: 'relevance' | 'downloads' | 'updated' | 'name'
  ): PackageSearchResult[] {
    switch (sortBy) {
      case 'relevance':
        return results.sort((a, b) => (b.score || 0) - (a.score || 0));
      case 'downloads':
        return results.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
      case 'updated':
        return results.sort((a, b) => {
          const aDate = new Date(a.lastUpdated || 0);
          const bDate = new Date(b.lastUpdated || 0);
          return bDate.getTime() - aDate.getTime();
        });
      case 'name':
        return results.sort((a, b) => a.name.localeCompare(b.name));
      default:
        return results;
    }
  }

  private async getRuntimeStatuses(runtimes: Record<string, string>): Promise<RuntimeStatus[]> {
    const statuses: RuntimeStatus[] = [];

    for (const [runtimeType, version] of Object.entries(runtimes)) {
      if (RuntimeRegistry.isSupported(runtimeType)) {
        try {
          const manager = RuntimeRegistry.create(
            runtimeType as RuntimeType,
            this.projectPath,
            this.cacheDir
          );

          const installed = await manager.isInstalled(version);
          const currentEnv = await manager.getCurrentVersion();
          const active = currentEnv?.version === version;
          const bestManager = await manager.getBestManager();

          const runtimeStatus: RuntimeStatus = {
            name: runtimeType,
            version,
            installed,
            active,
            path: currentEnv?.path,
          };

          if (bestManager?.name) {
            runtimeStatus.manager = bestManager.name;
          }

          statuses.push(runtimeStatus);
        } catch (error) {
          logger.debug(`Failed to get status for runtime ${runtimeType}`, error);
          statuses.push({
            name: runtimeType,
            version,
            installed: false,
            active: false,
          });
        }
      }
    }

    return statuses;
  }

  private async getServiceStatuses(services: any[]): Promise<ServiceStatus[]> {
    const statuses: ServiceStatus[] = [];

    for (const service of services) {
      try {
        const serviceStatus = await this.getServiceStatus(service.name);
        statuses.push({
          name: service.name,
          version: service.version || 'latest',
          running: serviceStatus.running,
          template: service.template,
          ports: serviceStatus.ports,
        });
      } catch (error) {
        logger.debug(`Failed to get status for service ${service.name}`, error);
        statuses.push({
          name: service.name,
          version: service.version || 'latest',
          running: false,
          template: service.template,
        });
      }
    }

    return statuses;
  }

  private async getDependencyStatuses(dependencies: any[]): Promise<DependencyStatus[]> {
    const statuses: DependencyStatus[] = [];

    for (const dep of dependencies) {
      try {
        const installed = await this.isDependencyInstalled(dep);
        statuses.push({
          name: dep.name,
          version: dep.version || 'latest',
          installed,
          runtime: dep.runtime,
          packageManager: await this.getPackageManagerForRuntime(dep.runtime),
        });
      } catch (error) {
        logger.debug(`Failed to get status for dependency ${dep.name}`, error);
        statuses.push({
          name: dep.name,
          version: dep.version || 'latest',
          installed: false,
          runtime: dep.runtime,
        });
      }
    }

    return statuses;
  }

  private async getServiceStatus(
    serviceName: string
  ): Promise<{ running: boolean; ports?: number[] }> {
    try {
      // Check if service is running via Docker
      const result = await ProcessUtils.execute('docker', [
        'ps',
        '--filter',
        `name=${serviceName}`,
        '--format',
        '{{.Names}}',
      ]);
      const running = result.stdout.includes(serviceName);

      // Get port information if running
      let ports: number[] | undefined;
      if (running) {
        try {
          const portResult = await ProcessUtils.execute('docker', ['port', serviceName]);
          ports = this.parseDockerPorts(portResult.stdout);
        } catch {
          // Port info not available
        }
      }

      return { running, ports };
    } catch {
      return { running: false };
    }
  }

  private parseDockerPorts(portOutput: string): number[] {
    const ports: number[] = [];
    const lines = portOutput.split('\n');

    for (const line of lines) {
      const match = line.match(/:(\d+)/);
      if (match) {
        ports.push(parseInt(match[1], 10));
      }
    }

    return ports;
  }

  private async isRuntimeInstalled(packageDef: PackageDefinition): Promise<boolean> {
    if (!RuntimeRegistry.isSupported(packageDef.name)) return false;

    try {
      const manager = RuntimeRegistry.create(
        packageDef.name as RuntimeType,
        this.projectPath,
        this.cacheDir
      );
      return await manager.isInstalled(packageDef.version || 'latest');
    } catch {
      return false;
    }
  }

  private async isServiceInstalled(packageDef: PackageDefinition): Promise<boolean> {
    return ServiceTemplateRegistry.hasTemplate(packageDef.name);
  }

  private async isDependencyInstalled(packageDef: PackageDefinition): Promise<boolean> {
    try {
      switch (packageDef.runtime) {
        case 'nodejs':
          return await this.isNodeDependencyInstalled(packageDef.name);
        case 'python':
          return await this.isPythonDependencyInstalled(packageDef.name);
        case 'go':
          return await this.isGoDependencyInstalled(packageDef.name);
        case 'rust':
          return await this.isRustDependencyInstalled(packageDef.name);
        default:
          return false;
      }
    } catch {
      return false;
    }
  }

  private async isNodeDependencyInstalled(packageName: string): Promise<boolean> {
    const packageJsonPath = path.join(this.projectPath, 'package.json');
    if (!(await fs.pathExists(packageJsonPath))) return false;

    try {
      const packageJson = await fs.readJson(packageJsonPath);
      return !!(
        packageJson.dependencies?.[packageName] ||
        packageJson.devDependencies?.[packageName] ||
        packageJson.peerDependencies?.[packageName]
      );
    } catch {
      return false;
    }
  }

  private async isPythonDependencyInstalled(packageName: string): Promise<boolean> {
    try {
      await ProcessUtils.execute('pip', ['show', packageName], { cwd: this.projectPath });
      return true;
    } catch {
      return false;
    }
  }

  private async isGoDependencyInstalled(packageName: string): Promise<boolean> {
    const goModPath = path.join(this.projectPath, 'go.mod');
    if (!(await fs.pathExists(goModPath))) return false;

    try {
      const goMod = await fs.readFile(goModPath, 'utf8');
      return goMod.includes(packageName);
    } catch {
      return false;
    }
  }

  private async isRustDependencyInstalled(packageName: string): Promise<boolean> {
    const cargoTomlPath = path.join(this.projectPath, 'Cargo.toml');
    if (!(await fs.pathExists(cargoTomlPath))) return false;

    try {
      const cargoToml = await fs.readFile(cargoTomlPath, 'utf8');
      return cargoToml.includes(packageName);
    } catch {
      return false;
    }
  }

  private async detectNodePackageManager(): Promise<string> {
    const lockFiles = [
      { file: 'yarn.lock', manager: 'yarn' },
      { file: 'pnpm-lock.yaml', manager: 'pnpm' },
      { file: 'package-lock.json', manager: 'npm' },
    ];

    for (const { file, manager } of lockFiles) {
      const lockPath = path.join(this.projectPath, file);
      if (await fs.pathExists(lockPath)) {
        return manager;
      }
    }

    return 'npm'; // Default fallback
  }

  private async detectPrimaryRuntime(): Promise<string> {
    const detectedRuntimes = await RuntimeRegistry.detectProjectRuntime(this.projectPath);
    return detectedRuntimes[0] || 'nodejs';
  }

  private async getPackageManagerForRuntime(runtime?: string): Promise<string> {
    if (!runtime) return 'unknown';

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

  private async getLatestVersion(packageDef: PackageDefinition): Promise<string | null> {
    try {
      switch (packageDef.type) {
        case 'runtime':
          return await this.getLatestRuntimeVersion(packageDef.name);
        case 'service':
          return await this.getLatestServiceVersion(packageDef.name);
        case 'dependency':
          return await this.getLatestDependencyVersion(packageDef.name, packageDef.runtime);
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  private async getLatestRuntimeVersion(runtimeName: string): Promise<string | null> {
    try {
      if (!RuntimeRegistry.isSupported(runtimeName)) return null;

      const manager = RuntimeRegistry.create(
        runtimeName as RuntimeType,
        this.projectPath,
        this.cacheDir
      );
      const versions = await manager.listAvailable();
      return versions[0] || null;
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

  private async findPackageInConfig(
    name: string,
    packages: any
  ): Promise<PackageDefinition | null> {
    // Check runtimes
    if (packages.runtimes?.[name]) {
      return {
        name,
        version: packages.runtimes[name],
        type: 'runtime',
      };
    }

    // Check services
    const service = packages.services?.find((s: any) => s.name === name);
    if (service) {
      return {
        name: service.name,
        version: service.version,
        type: 'service',
        runtime: service.template,
      };
    }

    // Check dependencies
    const dependency = packages.dependencies?.find((d: any) => d.name === name);
    if (dependency) {
      return {
        name: dependency.name,
        version: dependency.version,
        type: 'dependency',
        runtime: dependency.runtime,
      };
    }

    return null;
  }

  private async findDependents(packageName: string, packages: any): Promise<string[]> {
    const dependents: string[] = [];

    // Check if any services depend on this package
    if (packages.services) {
      packages.services.forEach((service: any) => {
        if (service.dependencies && service.dependencies.includes(packageName)) {
          dependents.push(service.name);
        }
      });
    }

    // For runtimes, check if any dependencies use this runtime
    if (packages.dependencies) {
      packages.dependencies.forEach((dep: any) => {
        if (dep.runtime === packageName) {
          dependents.push(dep.name);
        }
      });
    }

    return dependents;
  }

  private async updateProjectConfig(
    packageDef: PackageDefinition,
    action: 'add' | 'remove',
    options?: AddPackageOptions
  ): Promise<void> {
    const projectConfig = await this.configManager.loadProjectConfig(this.projectPath);
    if (!projectConfig) {
      throw new Error('Project configuration not found');
    }

    // Initialize packages section if it doesn't exist
    if (!projectConfig.packages) {
      projectConfig.packages = {};
    }

    switch (action) {
      case 'add':
        await this.addPackageToConfig(projectConfig.packages, packageDef, options);
        break;
      case 'remove':
        await this.removePackageFromConfig(projectConfig.packages, packageDef);
        break;
    }

    await this.configManager.saveProjectConfig(this.projectPath, projectConfig);
  }

  private async addPackageToConfig(
    packages: any,
    packageDef: PackageDefinition,
    options?: AddPackageOptions
  ): Promise<void> {
    switch (packageDef.type) {
      case 'runtime':
        if (!packages.runtimes) packages.runtimes = {};
        packages.runtimes[packageDef.name] = packageDef.version || 'latest';
        break;

      case 'service':
        if (!packages.services) packages.services = [];
        packages.services.push({
          name: packageDef.name,
          template: packageDef.name,
          version: packageDef.version,
        });
        break;

      case 'dependency':
        if (!packages.dependencies) packages.dependencies = [];
        const depConfig: any = {
          name: packageDef.name,
          version: packageDef.version,
          runtime: packageDef.runtime,
        };

        if (options?.dev) depConfig.dev = true;
        if (options?.optional) depConfig.optional = true;
        if (options?.global) depConfig.global = true;

        packages.dependencies.push(depConfig);
        break;
    }
  }

  private async removePackageFromConfig(
    packages: any,
    packageDef: PackageDefinition
  ): Promise<void> {
    switch (packageDef.type) {
      case 'runtime':
        if (packages.runtimes) {
          delete packages.runtimes[packageDef.name];
        }
        break;

      case 'service':
        if (packages.services) {
          packages.services = packages.services.filter((s: any) => s.name !== packageDef.name);
        }
        break;

      case 'dependency':
        if (packages.dependencies) {
          packages.dependencies = packages.dependencies.filter(
            (d: any) => d.name !== packageDef.name
          );
        }
        break;
    }
  }

  private async updateLockFile(): Promise<void> {
    try {
      const lockFile = await this.generateLockFile();
      await this.lockFileManager.write(lockFile);
    } catch (error) {
      logger.warn('Failed to update lock file', error);
    }
  }

  private async generateLockFile(): Promise<LockFile> {
    const projectConfig = await this.configManager.loadProjectConfig(this.projectPath);

    return {
      lockfileVersion: 1,
      name: projectConfig?.name || 'unknown',
      switchrVersion: '0.1.0',
      generated: new Date().toISOString(),
      runtimes: await this.generateRuntimeLocks(projectConfig?.packages?.runtimes || {}),
      packages: await this.generatePackageLocks(projectConfig?.packages?.dependencies || []),
      services: await this.generateServiceLocks(projectConfig?.packages?.services || []),
    };
  }

  private async generateRuntimeLocks(runtimes: Record<string, string>): Promise<any> {
    const locks: any = {};

    for (const [name, version] of Object.entries(runtimes)) {
      if (RuntimeRegistry.isSupported(name)) {
        try {
          const manager = RuntimeRegistry.create(
            name as RuntimeType,
            this.projectPath,
            this.cacheDir
          );
          const env = await manager.getCurrentVersion();

          if (env) {
            locks[name] = {
              version: env.version,
              resolved: env.path,
              manager: env.manager,
            };
          }
        } catch (error) {
          logger.debug(`Failed to generate lock for runtime ${name}`, error);
        }
      }
    }

    return locks;
  }

  private async generatePackageLocks(dependencies: any[]): Promise<any> {
    const locks: any = {};

    for (const dep of dependencies) {
      locks[dep.name] = {
        version: dep.version || 'latest',
        runtime: dep.runtime,
      };
    }

    return locks;
  }

  private async generateServiceLocks(services: any[]): Promise<any> {
    const locks: any = {};

    for (const service of services) {
      locks[service.name] = {
        template: service.template,
        version: service.version || 'latest',
        config: service.config || {},
      };
    }

    return locks;
  }

  private async installRuntimes(runtimes: Record<string, string>): Promise<PackageInstallResult[]> {
    const results: PackageInstallResult[] = [];

    for (const [runtimeType, version] of Object.entries(runtimes)) {
      try {
        const result = await this.addRuntime(
          { name: runtimeType, version, type: 'runtime' },
          { skipIfExists: true }
        );
        results.push(result);
      } catch (error) {
        results.push({
          success: false,
          package: { name: runtimeType, version, type: 'runtime' },
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return results;
  }

  private async installServices(services: any[]): Promise<PackageInstallResult[]> {
    const results: PackageInstallResult[] = [];

    for (const service of services) {
      try {
        const result = await this.addService(service, {});
        results.push(result);
      } catch (error) {
        results.push({
          success: false,
          package: { name: service.name, type: 'service' },
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return results;
  }

  private async installDependencies(dependencies: any[]): Promise<PackageInstallResult[]> {
    const results: PackageInstallResult[] = [];

    for (const dep of dependencies) {
      try {
        const result = await this.addDependency(dep, {});
        results.push(result);
      } catch (error) {
        results.push({
          success: false,
          package: { name: dep.name, type: 'dependency' },
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return results;
  }

  private clearCache(): void {
    this.packageStatusCache = null;
    this.cacheExpiry = 0;
  }

  /**
   * Get package manager statistics
   */
  getStats(): {
    cacheHits: number;
    totalRequests: number;
    averageResponseTime: number;
  } {
    // This would track actual statistics in a real implementation
    return {
      cacheHits: 0,
      totalRequests: 0,
      averageResponseTime: 0,
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    this.clearCache();
    // Additional cleanup if needed
  }
}
