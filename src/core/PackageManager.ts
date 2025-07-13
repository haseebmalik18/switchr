// src/core/PackageManager.ts - Complete professional implementation with all fixes
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

// Interface definitions for type safety
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
}

interface RuntimeStatus {
  name: string;
  version: string;
  installed: boolean;
  active: boolean;
  manager?: string;
}

interface ServiceStatus {
  name: string;
  version: string;
  running: boolean;
  template?: string;
}

export interface PackageManagerOptions {
  projectPath: string;
  cacheDir: string;
  skipLockfileUpdate?: boolean;
  force?: boolean;
}

export interface AddPackageOptions {
  dev?: boolean;
  global?: boolean;
  optional?: boolean;
  runtime?: string;
  manager?: string;
  skipIfExists?: boolean;
}

export interface SearchPackageOptions {
  limit?: number;
  type?: PackageType;
  category?: string;
  runtime?: RuntimeType;
  sortBy?: 'relevance' | 'downloads' | 'updated';
}

interface DependencyStatus {
  name: string;
  version: string;
  installed: boolean;
  runtime?: string;
}

interface ProjectPackageStatus {
  runtimes: RuntimeStatus[];
  services: ServiceStatus[];
  dependencies: DependencyStatus[];
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
  private readonly registries: Map<string, any> = new Map();

  constructor(options: PackageManagerOptions) {
    this.projectPath = options.projectPath;
    this.cacheDir = options.cacheDir;
    this.lockFileManager = new LockFileManager(this.projectPath);
    this.configManager = ConfigManager.getInstance();
    this.initializeRegistries();
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
      await this.updateLockFile();

      const successful = results.filter(r => r.success).length;
      logger.info(`Successfully installed ${successful}/${results.length} packages`);

      return results;
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
    options: AddPackageOptions = {}
  ): Promise<PackageInstallResult> {
    logger.info(`Adding package: ${packageSpec}`);

    try {
      const packageDef = await this.parsePackageSpec(packageSpec, options);

      // Validate package
      await this.validatePackage(packageDef);

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
        await this.updateLockFile();

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
  async removePackage(packageName: string): Promise<boolean> {
    logger.info(`Removing package: ${packageName}`);

    try {
      const projectConfig = await this.configManager.loadProjectConfig(this.projectPath);
      if (!projectConfig?.packages) {
        throw new Error('No packages found in project configuration');
      }

      // Find package in configuration
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
          await this.removeDependency(packageDef as DependencyPackage);
          break;
      }

      // Update project configuration
      await this.updateProjectConfig(packageDef, 'remove');

      // Update lock file
      await this.updateLockFile();

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
      await RuntimeRegistry.initialize();
      await ServiceTemplateRegistry.initialize();

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
   * Get comprehensive package status
   */
  async getPackageStatus(): Promise<ProjectPackageStatus> {
    const status: ProjectPackageStatus = {
      runtimes: [],
      services: [],
      dependencies: [],
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
            const bestManager = await manager.getBestManager();

            const runtimeStatus: RuntimeStatus = {
              name: runtimeType,
              version,
              installed,
              active,
            };

            // Only add manager if it exists
            if (bestManager?.name) {
              runtimeStatus.manager = bestManager.name;
            }

            status.runtimes.push(runtimeStatus);
          }
        }
      }

      // Check service status
      if (projectConfig.packages.services) {
        for (const service of projectConfig.packages.services) {
          const serviceStatus = await this.getServiceStatus(service.name);

          const serviceStatusObj: ServiceStatus = {
            name: service.name,
            version: service.version || 'latest',
            running: serviceStatus.running,
            template: service.template,
          };

          status.services.push(serviceStatusObj);
        }
      }

      // Check dependency status
      if (projectConfig.packages.dependencies) {
        for (const dep of projectConfig.packages.dependencies) {
          const installed = await this.isDependencyInstalled(dep);

          const dependencyStatus: DependencyStatus = {
            name: dep.name,
            version: dep.version || 'latest',
            installed,
          };

          // Only add runtime if it exists
          if (dep.runtime) {
            dependencyStatus.runtime = dep.runtime;
          }

          status.dependencies.push(dependencyStatus);
        }
      }

      return status;
    } catch (error) {
      logger.error('Failed to get package status', error);
      return status;
    }
  }

  // Private implementation methods...

  private async initializeRegistries(): Promise<void> {
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
        return await this.installNodeDependency(dep);
      case 'python':
        return await this.installPythonDependency(dep);
      case 'go':
        return await this.installGoDependency(dep);
      default:
        throw new Error(`Dependency installation not supported for runtime: ${runtime}`);
    }
  }

  private async installNodeDependency(dep: DependencyPackage): Promise<PackageInstallResult> {
    const { ProcessUtils } = await import('../utils/ProcessUtils');

    const packageManager = await this.detectNodePackageManager();
    const args = ['add', dep.name];

    if (dep.version) {
      args[1] = `${dep.name}@${dep.version}`;
    }

    if (dep.devOnly) {
      args.push(packageManager === 'npm' ? '--save-dev' : '--dev');
    }

    if (dep.global) {
      args.push('--global');
    }

    try {
      await ProcessUtils.execute(packageManager, args, { cwd: this.projectPath });

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

  private async installPythonDependency(dep: DependencyPackage): Promise<PackageInstallResult> {
    const { ProcessUtils } = await import('../utils/ProcessUtils');

    const args = ['install', dep.name];

    if (dep.version) {
      args[1] = `${dep.name}==${dep.version}`;
    }

    try {
      await ProcessUtils.execute('pip', args, { cwd: this.projectPath });

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

  private async installGoDependency(dep: DependencyPackage): Promise<PackageInstallResult> {
    const { ProcessUtils } = await import('../utils/ProcessUtils');

    const args = ['get', dep.name];

    if (dep.version) {
      args[1] = `${dep.name}@${dep.version}`;
    }

    try {
      await ProcessUtils.execute('go', args, { cwd: this.projectPath });

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

  private async searchRuntimes(
    query: string,
    options: SearchPackageOptions
  ): Promise<PackageSearchResult[]> {
    const results: PackageSearchResult[] = [];
    const runtimeTypes = RuntimeRegistry.getRegisteredTypes();

    for (const type of runtimeTypes) {
      if (type.toLowerCase().includes(query.toLowerCase())) {
        // Get available versions for this runtime
        const manager = RuntimeRegistry.create(type, this.projectPath, this.cacheDir);
        const versions = await manager.listAvailable();

        results.push({
          name: type,
          type: 'runtime',
          description: `${type} runtime environment`,
          category: 'runtime',
          version: versions[0], // Latest version
          score: this.calculateRelevanceScore(type, query),
        });
      }
    }

    return results;
  }

  private async searchServices(
    query: string,
    options: SearchPackageOptions
  ): Promise<PackageSearchResult[]> {
    const templates = ServiceTemplateRegistry.searchTemplates(query);

    return templates.map(template => ({
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
      const npmResults = await this.searchNpmRegistry(query, options);
      results.push(...npmResults);
    }

    // Search PyPI for Python packages
    if (!options.runtime || options.runtime === 'python') {
      const pypiResults = await this.searchPyPIRegistry(query, options);
      results.push(...pypiResults);
    }

    return results;
  }

  private async searchNpmRegistry(
    query: string,
    options: SearchPackageOptions
  ): Promise<PackageSearchResult[]> {
    try {
      const encodedQuery = encodeURIComponent(query);
      const limit = options.limit || 20;
      const url = `https://registry.npmjs.org/-/v1/search?text=${encodedQuery}&size=${limit}`;

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`NPM API error: ${response.status} ${response.statusText}`);
      }

      // Fix: Properly type the response
      const data = (await response.json()) as NpmSearchResponse;

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

        // Only add optional properties if they exist
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
    // Note: PyPI removed their search API, so we'll use a simple package list approach
    // In a real implementation, you'd use pypi.org's JSON API or xmlrpc
    const commonPackages = [
      'django',
      'flask',
      'fastapi',
      'requests',
      'numpy',
      'pandas',
      'pytest',
      'black',
      'flake8',
      'pip',
      'setuptools',
    ];

    return commonPackages
      .filter(pkg => pkg.includes(query.toLowerCase()))
      .map(pkg => ({
        name: pkg,
        type: 'dependency' as PackageType,
        runtime: 'python' as RuntimeType,
        description: `Python package: ${pkg}`,
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
    sortBy: 'relevance' | 'downloads' | 'updated'
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
      default:
        return results;
    }
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

  private async getServiceStatus(serviceName: string): Promise<{ running: boolean }> {
    // This would integrate with your existing service status checking
    // For now, return a placeholder
    return { running: false };
  }

  private async isDependencyInstalled(dep: { name: string; runtime?: string }): Promise<boolean> {
    try {
      switch (dep.runtime) {
        case 'nodejs':
          return await this.isNodeDependencyInstalled(dep.name);
        case 'python':
          return await this.isPythonDependencyInstalled(dep.name);
        case 'go':
          return await this.isGoDependencyInstalled(dep.name);
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

    const packageJson = await fs.readJson(packageJsonPath);
    return !!(
      packageJson.dependencies?.[packageName] || packageJson.devDependencies?.[packageName]
    );
  }

  private async isPythonDependencyInstalled(packageName: string): Promise<boolean> {
    const { ProcessUtils } = await import('../utils/ProcessUtils');

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

    const goMod = await fs.readFile(goModPath, 'utf8');
    return goMod.includes(packageName);
  }

  private async removeRuntime(runtime: RuntimePackage): Promise<void> {
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

  private async removeService(service: ServicePackage): Promise<void> {
    const template = ServiceTemplateRegistry.getTemplate(service.template || service.name);
    if (template) {
      await template.uninstall(service.name);
    }
  }

  private async removeDependency(dep: DependencyPackage): Promise<void> {
    const { ProcessUtils } = await import('../utils/ProcessUtils');

    switch (dep.runtime) {
      case 'nodejs':
        const packageManager = await this.detectNodePackageManager();
        await ProcessUtils.execute(packageManager, ['remove', dep.name], { cwd: this.projectPath });
        break;
      case 'python':
        await ProcessUtils.execute('pip', ['uninstall', '-y', dep.name], { cwd: this.projectPath });
        break;
      case 'go':
        // Go modules are removed by editing go.mod and running go mod tidy
        await ProcessUtils.execute('go', ['mod', 'edit', '-droprequire', dep.name], {
          cwd: this.projectPath,
        });
        await ProcessUtils.execute('go', ['mod', 'tidy'], { cwd: this.projectPath });
        break;
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
        packages.dependencies.push({
          name: packageDef.name,
          version: packageDef.version,
          runtime: packageDef.runtime,
          dev: options?.dev,
          optional: options?.optional,
          global: options?.global,
        });
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
    const lockFile = await this.generateLockFile();
    await this.lockFileManager.write(lockFile);
  }

  private async generateLockFile(): Promise<LockFile> {
    const projectConfig = await this.configManager.loadProjectConfig(this.projectPath);

    return {
      lockfileVersion: 1,
      name: projectConfig?.name || 'unknown',
      switchrVersion: '0.1.0', // Get from package.json
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
}
