// src/commands/packages.ts - Complete production implementation
import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import ora from 'ora';
import { ConfigManager } from '../core/ConfigManager';
import { PackageManager } from '../core/PackageManager';
import { RuntimeRegistry } from '../core/runtime/RuntimeRegistry';
import { ServiceTemplateRegistry } from '../core/service/ServiceTemplateRegistry';
import { NPMRegistry } from '../core/registry/NPMRegistry';
import { PyPIRegistry } from '../core/registry/PyPiRegistry';
import { ProcessUtils } from '../utils/ProcessUtils';
import { logger } from '../utils/Logger';
import { RuntimeType } from '../types/Runtime';
import * as fs from 'fs-extra';
import * as path from 'path';

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
  downloadCount?: number;
  description?: string;
  homepage?: string;
  repository?: string;
}

interface PackageSummary {
  total: number;
  installed: number;
  outdated: number;
  runtimes: number;
  services: number;
  dependencies: number;
}

interface PackagesCommandFlags {
  outdated: boolean;
  tree: boolean;
  json: boolean;
  type: string | undefined;
  detailed: boolean;
}

interface PackageStatus {
  runtimes: Array<{ name: string; version: string; manager?: string }>;
  services: Array<{ name: string; template?: string; version?: string; running?: boolean }>;
  dependencies: Array<{ name: string; version?: string; runtime?: string; dev?: boolean }>;
}

interface DependencyTreeNode {
  name: string;
  version?: string;
  dependencies?: DependencyTreeNode[];
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

  private configManager: ConfigManager;

  constructor(argv: string[], config: import('@oclif/core').Config) {
    super(argv, config);
    this.configManager = ConfigManager.getInstance();
  }

  public async run(): Promise<void> {
    const { flags } = await this.parse(Packages);

    try {
      // Initialize registries
      const spinner = ora('Initializing package registries...').start();
      await RuntimeRegistry.initialize();
      await ServiceTemplateRegistry.initialize();
      spinner.succeed('Package registries initialized');

      const currentProject = await this.configManager.getCurrentProject();

      if (!currentProject) {
        this.error(
          `No active project. Run ${chalk.white('switchr switch <project-name>')} to activate a project.`
        );
      }

      const packageManager = new PackageManager({
        projectPath: currentProject.path,
        cacheDir: this.configManager.getConfigDir(),
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

  private async showPackageOverview(
    packageManager: PackageManager,
    flags: PackagesCommandFlags
  ): Promise<void> {
    const spinner = ora('Analyzing packages...').start();

    try {
      const status = await packageManager.getPackageStatus();
      const packages = await this.buildPackageList(status, flags);
      const summary = this.calculateSummary(packages);

      spinner.stop();

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

  private async buildPackageList(
    status: PackageStatus,
    flags: PackagesCommandFlags
  ): Promise<PackageInfo[]> {
    const packages: PackageInfo[] = [];

    // Add runtimes
    for (const runtime of status.runtimes) {
      const details = await this.getRuntimeDetails(runtime.name, runtime.version);
      packages.push({
        name: runtime.name,
        type: 'runtime',
        version: runtime.version,
        installed: true,
        ...(runtime.manager && { manager: runtime.manager }),
        ...details,
      });
    }

    // Add services
    for (const service of status.services) {
      const details = await this.getServiceDetails(service.name);
      packages.push({
        name: service.name,
        type: 'service',
        version: service.version || 'latest',
        installed: true,
        ...(service.template && { template: service.template }),
        ...(service.running !== undefined && { running: service.running }),
        ...details,
      });
    }

    // Add dependencies
    for (const dep of status.dependencies) {
      const details = await this.getDependencyDetails(dep.name, dep.runtime);
      packages.push({
        name: dep.name,
        type: 'dependency',
        version: dep.version || 'unknown',
        installed: true,
        ...(dep.runtime && { runtime: dep.runtime }),
        ...details,
      });
    }

    // Filter by type if specified
    if (flags.type) {
      return packages.filter(pkg => pkg.type === flags.type);
    }

    // Check for updates if requested
    if (flags.outdated) {
      return this.checkForUpdates(packages);
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
    flags: PackagesCommandFlags
  ): void {
    this.log(chalk.blue('📦 Project Packages\n'));

    this.displaySummary(summary);

    if (flags.outdated) {
      const outdatedPackages = packages.filter(pkg => pkg.outdated);
      if (outdatedPackages.length > 0) {
        this.log(chalk.yellow(`\n⚠️  ${outdatedPackages.length} packages have updates available:`));
        outdatedPackages.forEach(pkg => this.displayPackage(pkg, flags));
      } else {
        this.log(chalk.green('\n✅ All packages are up to date'));
      }
    } else {
      this.displayPackagesByType(packages, flags);
    }

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

  private displayPackagesByType(packages: PackageInfo[], flags: PackagesCommandFlags): void {
    const packagesByType = packages.reduce(
      (acc, pkg) => {
        acc[pkg.type].push(pkg);
        return acc;
      },
      { runtime: [], service: [], dependency: [] } as Record<string, PackageInfo[]>
    );

    Object.entries(packagesByType).forEach(([type, typePackages]) => {
      if (typePackages.length > 0) {
        this.log(
          chalk.blue(
            `\n${this.getTypeIcon(type)} ${type.charAt(0).toUpperCase() + type.slice(1)}s:`
          )
        );
        typePackages.forEach(pkg => this.displayPackage(pkg, flags));
      }
    });
  }

  private displayPackage(pkg: PackageInfo, flags: PackagesCommandFlags): void {
    const statusIcon = this.getPackageStatusIcon(pkg);
    const versionDisplay =
      pkg.outdated && pkg.latestVersion
        ? chalk.yellow(`${pkg.version} → ${pkg.latestVersion}`)
        : pkg.version;

    this.log(`   ${statusIcon} ${chalk.white(pkg.name)} ${chalk.gray(versionDisplay)}`);

    if (flags.detailed) {
      this.displayPackageDetails(pkg, flags);
    }
  }

  private displayPackageDetails(pkg: PackageInfo, _flags: PackagesCommandFlags): void {
    if (pkg.manager) {
      this.log(chalk.gray(`     Manager: ${pkg.manager}`));
    }
    if (pkg.template) {
      this.log(chalk.gray(`     Template: ${pkg.template}`));
    }
    if (pkg.runtime && pkg.type === 'dependency') {
      this.log(chalk.gray(`     Runtime: ${pkg.runtime}`));
    }
    if (pkg.size) {
      this.log(chalk.gray(`     Size: ${pkg.size}`));
    }
    if (pkg.lastUpdated) {
      this.log(chalk.gray(`     Updated: ${pkg.lastUpdated}`));
    }
  }

  private async showOutdatedPackages(
    packageManager: PackageManager,
    flags: PackagesCommandFlags
  ): Promise<void> {
    const spinner = ora('Checking for updates...').start();

    try {
      const status = await packageManager.getPackageStatus();
      const packages = await this.buildPackageList(status, flags);
      const outdatedPackages = await this.checkForUpdates(packages);

      spinner.stop();

      const outdated = outdatedPackages.filter(pkg => pkg.outdated);

      if (outdated.length === 0) {
        this.log(chalk.green('✅ All packages are up to date'));
        return;
      }

      this.log(chalk.yellow(`⚠️  ${outdated.length} packages have updates available:\n`));

      outdated.forEach(pkg => {
        const versionDisplay = pkg.latestVersion
          ? `${pkg.version} → ${chalk.green(pkg.latestVersion)}`
          : pkg.version;

        this.log(`   ${this.getTypeIcon(pkg.type)} ${chalk.white(pkg.name)} ${versionDisplay}`);

        if (pkg.manager) {
          this.log(
            chalk.gray(`     Update with: ${pkg.manager} install ${pkg.name}@${pkg.latestVersion}`)
          );
        }
      });

      this.displayUpdateFooter();
    } catch (error) {
      spinner.fail('Failed to check for updates');
      throw error;
    }
  }

  private async showDependencyTree(
    packageManager: PackageManager,
    flags: PackagesCommandFlags
  ): Promise<void> {
    const spinner = ora('Building dependency tree...').start();

    try {
      const tree = await this.buildDependencyTree(packageManager);
      spinner.stop();

      if (flags.json) {
        this.log(JSON.stringify(tree, null, 2));
        return;
      }

      this.log(chalk.blue('🌳 Dependency Tree\n'));
      this.displayTree(tree);
    } catch (error) {
      spinner.fail('Failed to build dependency tree');
      throw error;
    }
  }

  private displayTree(tree: DependencyTreeNode, prefix: string = '', isLast: boolean = true): void {
    const connector = isLast ? '└── ' : '├── ';
    const versionDisplay = tree.version ? chalk.gray(`@${tree.version}`) : '';

    this.log(`${prefix}${connector}${chalk.white(tree.name)}${versionDisplay}`);

    if (tree.dependencies && tree.dependencies.length > 0) {
      const newPrefix = prefix + (isLast ? '    ' : '│   ');
      tree.dependencies.forEach((dep, index) => {
        const isLastDep = index === tree.dependencies!.length - 1;
        this.displayTree(dep, newPrefix, isLastDep);
      });
    }
  }

  // Helper methods for getting package details
  private async getRuntimeDetails(name: string, version: string): Promise<Partial<PackageInfo>> {
    try {
      // Initialize RuntimeRegistry if not already done
      await RuntimeRegistry.initialize();

      if (!RuntimeRegistry.isSupported(name)) {
        return {};
      }

      const manager = RuntimeRegistry.create(
        name as RuntimeType,
        this.configManager.getConfigDir(),
        this.configManager.getConfigDir()
      );

      // Get runtime environment info
      const currentEnv = await manager.getCurrentVersion();
      const bestManager = await manager.getBestManager();

      const details: Partial<PackageInfo> = {};

      // Get manager info
      if (bestManager) {
        details.manager = bestManager.name;
      }

      // Get installation size
      details.size = await this.getRuntimeSize(name, version);

      // Get last updated date
      details.lastUpdated = await this.getRuntimeLastUpdated(name, version);

      // Check if runtime is active
      details.active = currentEnv?.version === version;

      return details;
    } catch (error) {
      logger.debug(`Failed to get runtime details for ${name}:`, error);
      return {};
    }
  }

  private async getServiceDetails(name: string): Promise<Partial<PackageInfo>> {
    try {
      // Initialize ServiceTemplateRegistry if not already done
      await ServiceTemplateRegistry.initialize();

      const template = ServiceTemplateRegistry.getTemplate(name);
      if (!template) {
        return {};
      }

      const templateInfo = template.getTemplate();
      const details: Partial<PackageInfo> = {};

      // Get template info
      details.template = templateInfo.name;
      details.description = templateInfo.description;

      // Get service size
      details.size = await this.getServiceSize(name);

      // Get last updated date
      details.lastUpdated = await this.getServiceLastUpdated(name);

      // Check if service is running
      details.running = await this.isServiceRunning(name);

      return details;
    } catch (error) {
      logger.debug(`Failed to get service details for ${name}:`, error);
      return {};
    }
  }

  private async getDependencyDetails(
    name: string,
    runtime?: string
  ): Promise<Partial<PackageInfo>> {
    try {
      if (!runtime) {
        return {};
      }

      const details: Partial<PackageInfo> = {};

      // Get package manager for runtime
      const manager = await this.getPackageManagerForRuntime(runtime);
      if (manager) {
        details.manager = manager;
      }

      // Get dependency size and details
      const size = await this.getDependencySize(name, runtime);
      if (size) {
        details.size = size;
      }

      const lastUpdated = await this.getDependencyLastUpdated(name, runtime);
      if (lastUpdated) {
        details.lastUpdated = lastUpdated;
      }

      // Get additional package info from registries
      const packageInfo = await this.getDependencyRegistryInfo(name, runtime);
      if (packageInfo) {
        if (packageInfo.description) {
          details.description = packageInfo.description;
        }
        if (packageInfo.homepage) {
          details.homepage = packageInfo.homepage;
        }
        if (packageInfo.repository) {
          details.repository = packageInfo.repository;
        }
        if (packageInfo.downloadCount) {
          details.downloadCount = packageInfo.downloadCount;
        }
      }

      return details;
    } catch (error) {
      logger.debug(`Failed to get dependency details for ${name}:`, error);
      return {};
    }
  }

  private async checkForUpdates(packages: PackageInfo[]): Promise<PackageInfo[]> {
    const results = [...packages];

    // Process packages in parallel for better performance
    const updatePromises = results.map(async pkg => {
      try {
        const latestVersion = await this.getLatestVersion(pkg);
        if (latestVersion && this.isVersionOutdated(pkg.version, latestVersion)) {
          pkg.outdated = true;
          pkg.latestVersion = latestVersion;
        }
      } catch (error) {
        logger.debug(`Failed to check updates for ${pkg.name}:`, error);
      }
    });

    await Promise.allSettled(updatePromises);
    return results;
  }

  private async getLatestVersion(pkg: PackageInfo): Promise<string | null> {
    try {
      switch (pkg.type) {
        case 'runtime':
          return await this.getLatestRuntimeVersion(pkg.name);
        case 'service':
          return await this.getLatestServiceVersion(pkg.name);
        case 'dependency':
          return await this.getLatestDependencyVersion(pkg.name, pkg.runtime);
        default:
          return null;
      }
    } catch (error) {
      logger.debug(`Failed to get latest version for ${pkg.name}:`, error);
      return null;
    }
  }

  // Runtime-specific methods
  private async getRuntimeSize(name: string, _version: string): Promise<string> {
    try {
      const manager = RuntimeRegistry.create(
        name as RuntimeType,
        this.configManager.getConfigDir(),
        this.configManager.getConfigDir()
      );
      const env = await manager.getCurrentVersion();

      if (env?.path) {
        const size = await this.getDirectorySize(env.path);
        return this.formatSize(size);
      }
    } catch {
      // Ignore errors
    }
    return 'Unknown';
  }

  private async getRuntimeLastUpdated(name: string, _version: string): Promise<string> {
    try {
      const manager = RuntimeRegistry.create(
        name as RuntimeType,
        this.configManager.getConfigDir(),
        this.configManager.getConfigDir()
      );
      const env = await manager.getCurrentVersion();

      if (env?.path) {
        const stats = await fs.stat(env.path);
        return this.formatDate(stats.mtime);
      }
    } catch {
      // Ignore errors
    }
    return 'Unknown';
  }

  private async getLatestRuntimeVersion(runtimeName: string): Promise<string | null> {
    try {
      const manager = RuntimeRegistry.create(
        runtimeName as RuntimeType,
        this.configManager.getConfigDir(),
        this.configManager.getConfigDir()
      );
      const available = await manager.listAvailable();

      if (available.length > 0) {
        // Return the latest stable version (assumes versions are sorted)
        return available.filter(v => !v.includes('-')).pop() || available[0];
      }
    } catch {
      // Ignore errors
    }
    return null;
  }

  // Service-specific methods
  private async getServiceSize(name: string): Promise<string> {
    try {
      // For Docker-based services, get image size
      const result = await ProcessUtils.execute('docker', [
        'images',
        '--format',
        'table {{.Repository}}:{{.Tag}}\t{{.Size}}',
      ]);
      const lines = result.stdout.split('\n');

      for (const line of lines) {
        if (line.toLowerCase().includes(name.toLowerCase())) {
          const parts = line.split('\t');
          if (parts.length > 1) {
            return parts[1];
          }
        }
      }
    } catch {
      // Ignore errors
    }
    return 'Unknown';
  }

  private async getServiceLastUpdated(name: string): Promise<string> {
    try {
      // Check Docker image creation date
      const result = await ProcessUtils.execute('docker', [
        'inspect',
        '--format',
        '{{.Created}}',
        name,
      ]);
      if (result.exitCode === 0) {
        const createdDate = new Date(result.stdout.trim());
        return this.formatDate(createdDate);
      }
    } catch {
      // Ignore errors
    }
    return 'Unknown';
  }

  private async getLatestServiceVersion(serviceName: string): Promise<string | null> {
    try {
      const template = ServiceTemplateRegistry.getTemplate(serviceName);
      if (template) {
        const templateInfo = template.getTemplate();
        return templateInfo.version;
      }
    } catch {
      // Ignore errors
    }
    return null;
  }

  private async isServiceRunning(serviceName: string): Promise<boolean> {
    try {
      const result = await ProcessUtils.execute('docker', [
        'ps',
        '--filter',
        `name=${serviceName}`,
        '--format',
        '{{.Names}}',
      ]);
      return result.stdout.includes(serviceName);
    } catch {
      return false;
    }
  }

  // Dependency-specific methods
  private async getDependencySize(name: string, runtime?: string): Promise<string> {
    try {
      switch (runtime) {
        case 'nodejs':
          return await this.getNodePackageSize(name);
        case 'python':
          return await this.getPythonPackageSize(name);
        default:
          return 'Unknown';
      }
    } catch {
      return 'Unknown';
    }
  }

  private async getDependencyLastUpdated(name: string, runtime?: string): Promise<string> {
    try {
      switch (runtime) {
        case 'nodejs':
          return await this.getNodePackageLastUpdated(name);
        case 'python':
          return await this.getPythonPackageLastUpdated(name);
        default:
          return 'Unknown';
      }
    } catch {
      return 'Unknown';
    }
  }

  private async getLatestDependencyVersion(name: string, runtime?: string): Promise<string | null> {
    try {
      switch (runtime) {
        case 'nodejs':
          const npmInfo = await NPMRegistry.getPackageInfo(name);
          return npmInfo?.version || null;
        case 'python':
          const pypiInfo = await PyPIRegistry.getPackageInfo(name);
          return pypiInfo?.version || null;
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  private async getDependencyRegistryInfo(
    name: string,
    runtime?: string
  ): Promise<Partial<PackageInfo> | null> {
    try {
      switch (runtime) {
        case 'nodejs':
          const npmInfo = await NPMRegistry.getPackageInfo(name);
          if (npmInfo) {
            return {
              ...(npmInfo.description && { description: npmInfo.description }),
              ...(npmInfo.homepage && { homepage: npmInfo.homepage }),
              ...(npmInfo.repository && { repository: npmInfo.repository }),
            };
          }
          break;
        case 'python':
          const pypiInfo = await PyPIRegistry.getPackageInfo(name);
          if (pypiInfo) {
            return {
              ...(pypiInfo.description && { description: pypiInfo.description }),
              ...(pypiInfo.homepage && { homepage: pypiInfo.homepage }),
              ...(pypiInfo.repository && { repository: pypiInfo.repository }),
            };
          }
          break;
      }
    } catch {
      // Ignore errors
    }
    return null;
  }

  // Package manager detection
  private async getPackageManagerForRuntime(runtime: string): Promise<string> {
    switch (runtime) {
      case 'nodejs':
        return await this.detectNodePackageManager();
      case 'python':
        return await this.detectPythonPackageManager();
      case 'go':
        return 'go mod';
      case 'java':
        return await this.detectJavaPackageManager();
      case 'rust':
        return 'cargo';
      default:
        return 'unknown';
    }
  }

  private async detectNodePackageManager(): Promise<string> {
    try {
      const projectPath = (await this.configManager.getCurrentProject())?.path || process.cwd();

      // Check for lock files to determine package manager
      if (await fs.pathExists(path.join(projectPath, 'yarn.lock'))) {
        return 'yarn';
      }
      if (await fs.pathExists(path.join(projectPath, 'pnpm-lock.yaml'))) {
        return 'pnpm';
      }
      if (await fs.pathExists(path.join(projectPath, 'bun.lockb'))) {
        return 'bun';
      }
      return 'npm';
    } catch {
      return 'npm';
    }
  }

  private async detectPythonPackageManager(): Promise<string> {
    try {
      const projectPath = (await this.configManager.getCurrentProject())?.path || process.cwd();

      if (await fs.pathExists(path.join(projectPath, 'Pipfile'))) {
        return 'pipenv';
      }
      if (await fs.pathExists(path.join(projectPath, 'poetry.lock'))) {
        return 'poetry';
      }
      if (await fs.pathExists(path.join(projectPath, 'requirements.txt'))) {
        return 'pip';
      }
      return 'pip';
    } catch {
      return 'pip';
    }
  }

  private async detectJavaPackageManager(): Promise<string> {
    try {
      const projectPath = (await this.configManager.getCurrentProject())?.path || process.cwd();

      if (await fs.pathExists(path.join(projectPath, 'pom.xml'))) {
        return 'maven';
      }
      if (await fs.pathExists(path.join(projectPath, 'build.gradle'))) {
        return 'gradle';
      }
      return 'maven';
    } catch {
      return 'maven';
    }
  }

  // Node.js specific package info
  private async getNodePackageSize(packageName: string): Promise<string> {
    try {
      const projectPath = (await this.configManager.getCurrentProject())?.path || process.cwd();
      const packagePath = path.join(projectPath, 'node_modules', packageName);

      if (await fs.pathExists(packagePath)) {
        const size = await this.getDirectorySize(packagePath);
        return this.formatSize(size);
      }
    } catch {
      // Ignore errors
    }
    return 'Unknown';
  }

  private async getNodePackageLastUpdated(packageName: string): Promise<string> {
    try {
      const projectPath = (await this.configManager.getCurrentProject())?.path || process.cwd();
      const packageJsonPath = path.join(projectPath, 'node_modules', packageName, 'package.json');

      if (await fs.pathExists(packageJsonPath)) {
        const stats = await fs.stat(packageJsonPath);
        return this.formatDate(stats.mtime);
      }
    } catch {
      // Ignore errors
    }
    return 'Unknown';
  }

  // Python specific package info
  private async getPythonPackageSize(packageName: string): Promise<string> {
    try {
      // Use pip show to get package info
      const result = await ProcessUtils.execute('pip', ['show', packageName]);
      if (result.exitCode === 0) {
        const lines = result.stdout.split('\n');
        const locationLine = lines.find(line => line.startsWith('Location:'));

        if (locationLine) {
          const location = locationLine.split(':')[1].trim();
          const packagePath = path.join(location, packageName);

          if (await fs.pathExists(packagePath)) {
            const size = await this.getDirectorySize(packagePath);
            return this.formatSize(size);
          }
        }
      }
    } catch {
      // Ignore errors
    }
    return 'Unknown';
  }

  private async getPythonPackageLastUpdated(packageName: string): Promise<string> {
    try {
      // Use pip show to get package info
      const result = await ProcessUtils.execute('pip', ['show', packageName]);
      if (result.exitCode === 0) {
        const lines = result.stdout.split('\n');
        const locationLine = lines.find(line => line.startsWith('Location:'));

        if (locationLine) {
          const location = locationLine.split(':')[1].trim();
          const packagePath = path.join(location, packageName);

          if (await fs.pathExists(packagePath)) {
            const stats = await fs.stat(packagePath);
            return this.formatDate(stats.mtime);
          }
        }
      }
    } catch {
      // Ignore errors
    }
    return 'Unknown';
  }

  // Enhanced version comparison with semantic versioning support
  private isVersionOutdated(current: string, latest: string): boolean {
    if (current === latest) return false;
    if (latest === 'latest') return true;

    try {
      // Handle semantic versioning
      const currentVersion = this.parseSemanticVersion(current);
      const latestVersion = this.parseSemanticVersion(latest);

      // Compare major.minor.patch
      if (latestVersion.major > currentVersion.major) return true;
      if (latestVersion.major < currentVersion.major) return false;

      if (latestVersion.minor > currentVersion.minor) return true;
      if (latestVersion.minor < currentVersion.minor) return false;

      if (latestVersion.patch > currentVersion.patch) return true;
      if (latestVersion.patch < currentVersion.patch) return false;

      // If base versions are equal, check prerelease
      if (currentVersion.prerelease && !latestVersion.prerelease) return true;
      if (!currentVersion.prerelease && latestVersion.prerelease) return false;

      return false;
    } catch {
      // Fallback to string comparison
      return current !== latest;
    }
  }

  private parseSemanticVersion(version: string): {
    major: number;
    minor: number;
    patch: number;
    prerelease?: string;
  } {
    const semverRegex = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?/;
    const match = version.match(semverRegex);

    if (!match) {
      throw new Error(`Invalid semantic version: ${version}`);
    }

    return {
      major: parseInt(match[1], 10),
      minor: parseInt(match[2], 10),
      patch: parseInt(match[3], 10),
      prerelease: match[4],
    };
  }

  // Utility methods
  private async getDirectorySize(dirPath: string): Promise<number> {
    try {
      let totalSize = 0;
      const files = await fs.readdir(dirPath);

      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stats = await fs.stat(filePath);

        if (stats.isDirectory()) {
          totalSize += await this.getDirectorySize(filePath);
        } else {
          totalSize += stats.size;
        }
      }

      return totalSize;
    } catch {
      return 0;
    }
  }

  private formatSize(bytes: number): string {
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 B';

    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = bytes / Math.pow(1024, i);

    return `${size.toFixed(1)} ${sizes[i]}`;
  }

  private formatDate(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return 'Today';
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
    } else if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return `${months} month${months > 1 ? 's' : ''} ago`;
    } else {
      const years = Math.floor(diffDays / 365);
      return `${years} year${years > 1 ? 's' : ''} ago`;
    }
  }

  private async buildDependencyTree(packageManager: PackageManager): Promise<DependencyTreeNode> {
    const status = await packageManager.getPackageStatus();
    const tree: DependencyTreeNode = {
      name: 'project',
      dependencies: [],
    };

    // Add runtimes as top-level dependencies
    status.runtimes.forEach(runtime => {
      tree.dependencies!.push({
        name: runtime.name,
        version: runtime.version,
        dependencies: [],
      });
    });

    // Add services
    status.services.forEach(service => {
      tree.dependencies!.push({
        name: service.name,
        version: service.version,
        dependencies: [],
      });
    });

    // Add dependencies grouped by runtime
    status.dependencies.forEach(dep => {
      const runtimeNode = tree.dependencies!.find(node => node.name === dep.runtime);
      if (runtimeNode) {
        if (!runtimeNode.dependencies) {
          runtimeNode.dependencies = [];
        }
        runtimeNode.dependencies.push({
          name: dep.name,
          version: dep.version,
        });
      }
    });

    return tree;
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

  // TODO: Will be needed for analyzing semantic version breaking changes
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // @ts-expect-error - Method reserved for future use
  private _isBreakingChange(_currentVersion: string, _newVersion: string): boolean {
    // This method will be used to detect breaking changes between versions
    // by analyzing semantic versioning and changelog data
    return false;
  }
}
