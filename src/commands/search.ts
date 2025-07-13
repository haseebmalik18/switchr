// src/commands/search.ts - Production-quality implementation
import { Command, Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import ora from 'ora';
import { ConfigManager } from '../core/ConfigManager';
import { PackageManager, type SearchPackageOptions } from '../core/PackageManager';
import { RuntimeRegistry } from '../core/runtime/RuntimeRegistry';
import { ServiceTemplateRegistry } from '../core/service/ServiceTemplateRegistry';
import { logger } from '../utils/Logger';
import { PackageType, PackageSearchResult } from '../types/Package';
import { RuntimeType } from '../types/Runtime';

export default class Search extends Command {
  static override description = 'Search for available packages, runtimes, and services';

  static override examples = [
    '<%= config.bin %> <%= command.id %> postgres',
    '<%= config.bin %> <%= command.id %> node --type runtime',
    '<%= config.bin %> <%= command.id %> database --type service',
    '<%= config.bin %> <%= command.id %> express --type dependency --runtime nodejs',
    '<%= config.bin %> <%= command.id %> python --category runtime --limit 10',
  ];

  static override args = {
    query: Args.string({
      description: 'Search query',
      required: true,
    }),
  };

  static override flags = {
    type: Flags.string({
      char: 't',
      description: 'Filter by package type',
      options: ['runtime', 'service', 'dependency', 'tool'],
    }),
    category: Flags.string({
      char: 'c',
      description: 'Filter services by category',
      options: ['database', 'cache', 'queue', 'search', 'monitoring', 'web'],
    }),
    runtime: Flags.string({
      char: 'r',
      description: 'Filter dependencies by runtime',
      options: ['nodejs', 'python', 'go', 'java', 'rust'],
    }),
    limit: Flags.integer({
      char: 'l',
      description: 'Limit number of results',
      default: 20,
      min: 1,
      max: 100,
    }),
    'sort-by': Flags.string({
      char: 's',
      description: 'Sort results by',
      options: ['relevance', 'downloads', 'updated', 'name'],
      default: 'relevance',
    }),
    json: Flags.boolean({
      description: 'Output in JSON format',
      default: false,
    }),
    detailed: Flags.boolean({
      char: 'd',
      description: 'Show detailed information',
      default: false,
    }),
    'show-installed': Flags.boolean({
      description: 'Show installation status',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Search);

    try {
      const spinner = ora(`Searching for: ${chalk.bold(args.query)}`).start();

      await this.initializeRegistries();

      const configManager = ConfigManager.getInstance();
      const packageManager = new PackageManager({
        projectPath: process.cwd(),
        cacheDir: configManager.getConfigDir(),
      });

      const searchOptions = this.buildSearchOptions(flags);
      const results = await packageManager.searchPackages(args.query, searchOptions);

      spinner.stop();

      if (flags.json) {
        this.outputJson(results);
        return;
      }

      if (results.length === 0) {
        this.showNoResults(args.query, flags);
        return;
      }

      await this.displayResults(results, flags);
    } catch (error) {
      logger.error('Search operation failed', error);
      this.error(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async initializeRegistries(): Promise<void> {
    try {
      await Promise.all([RuntimeRegistry.initialize(), ServiceTemplateRegistry.initialize()]);
    } catch (error) {
      logger.warn('Failed to initialize some registries', error);
      // Continue with partial initialization
    }
  }

  private buildSearchOptions(flags: any): SearchPackageOptions {
    const options: SearchPackageOptions = {
      limit: flags.limit,
    };

    // Handle sortBy with proper validation
    const sortBy = flags['sort-by'];
    if (sortBy && this.isValidSortBy(sortBy)) {
      options.sortBy = sortBy;
    }

    if (flags.type && this.isValidPackageType(flags.type)) {
      options.type = flags.type as PackageType;
    }

    if (flags.category) {
      options.category = flags.category;
    }

    if (flags.runtime && this.isValidRuntimeType(flags.runtime)) {
      options.runtime = flags.runtime as RuntimeType;
    }

    return options;
  }

  private isValidPackageType(type: string): type is PackageType {
    return ['runtime', 'service', 'dependency', 'tool'].includes(type);
  }

  private isValidRuntimeType(type: string): type is RuntimeType {
    return ['nodejs', 'python', 'go', 'java', 'rust', 'php', 'ruby', 'dotnet'].includes(type);
  }

  private isValidSortBy(sortBy: string): sortBy is NonNullable<SearchPackageOptions['sortBy']> {
    return ['relevance', 'downloads', 'updated', 'name'].includes(sortBy);
  }

  private outputJson(results: PackageSearchResult[]): void {
    const sanitized = results.map(result => ({
      name: result.name,
      type: result.type,
      version: result.version,
      description: result.description,
      category: result.category,
      score: result.score,
      ...(result.runtime && { runtime: result.runtime }),
      ...(result.downloads && { downloads: result.downloads }),
      ...(result.lastUpdated && { lastUpdated: result.lastUpdated }),
      ...(result.repository && { repository: result.repository }),
      ...(result.homepage && { homepage: result.homepage }),
    }));

    this.log(JSON.stringify(sanitized, null, 2));
  }

  private showNoResults(query: string, flags: any): void {
    this.log(chalk.yellow(`No packages found matching: ${chalk.bold(query)}`));

    this.log(chalk.blue('\n💡 Search suggestions:'));
    this.log(chalk.gray(`   • Try broader terms: ${chalk.white('switchr search db')}`));
    this.log(chalk.gray(`   • Remove filters: Remove --type, --category, or --runtime flags`));
    this.log(chalk.gray(`   • Check spelling: Ensure the package name is correct`));

    if (flags.type) {
      this.log(
        chalk.gray(`   • Try different type: Remove ${chalk.white(`--type ${flags.type}`)} flag`)
      );
    }

    if (flags.category) {
      this.log(
        chalk.gray(
          `   • Try different category: Remove ${chalk.white(`--category ${flags.category}`)} flag`
        )
      );
    }

    this.showPopularPackages(flags.type);
  }

  private showPopularPackages(type?: string): void {
    this.log(chalk.blue('\n🔥 Popular packages:'));

    const popular: Record<string, string[]> = {
      runtime: ['nodejs@18', 'python@3.11', 'go@1.21', 'java@17'],
      service: ['postgresql@15', 'redis@7', 'mongodb@6', 'nginx@latest'],
      dependency: ['express', 'react', 'django', 'fastapi'],
    };

    const packagesToShow =
      type && popular[type]
        ? popular[type]
        : [
            ...popular.runtime.slice(0, 2),
            ...popular.service.slice(0, 2),
            ...popular.dependency.slice(0, 2),
          ];

    packagesToShow.forEach(pkg => {
      this.log(chalk.gray(`   • ${chalk.white(`switchr add ${pkg}`)}`));
    });
  }

  private async displayResults(results: PackageSearchResult[], flags: any): Promise<void> {
    this.log(chalk.green(`\n📦 Found ${results.length} package(s):\n`));

    const grouped = this.groupByType(results);

    for (const [type, packages] of Object.entries(grouped)) {
      if (packages.length === 0) continue;

      this.log(chalk.blue(`${this.getTypeIcon(type)} ${type.toUpperCase()}:`));

      for (const pkg of packages) {
        await this.displayPackage(pkg, flags);
      }

      this.log('');
    }

    this.showSearchFooter(results.length, flags);
  }

  private groupByType(results: PackageSearchResult[]): Record<string, PackageSearchResult[]> {
    const grouped: Record<string, PackageSearchResult[]> = {};

    for (const pkg of results) {
      if (!grouped[pkg.type]) {
        grouped[pkg.type] = [];
      }
      grouped[pkg.type].push(pkg);
    }

    return grouped;
  }

  private async displayPackage(pkg: PackageSearchResult, flags: any): Promise<void> {
    const nameColor = chalk.white;
    const versionInfo = pkg.version ? chalk.gray(`@${pkg.version}`) : '';
    const scoreInfo = pkg.score ? chalk.gray(` (${Math.round(pkg.score)}%)`) : '';

    let line = `  ${nameColor(pkg.name)}${versionInfo}${scoreInfo}`;

    if (flags['show-installed']) {
      const installed = await this.checkInstallationStatus(pkg);
      const statusIcon = installed ? chalk.green('✓') : chalk.gray('○');
      line = `  ${statusIcon} ${nameColor(pkg.name)}${versionInfo}${scoreInfo}`;
    }

    this.log(line);

    if (pkg.description) {
      this.log(chalk.gray(`    ${pkg.description}`));
    }

    if (flags.detailed) {
      await this.showDetailedInfo(pkg);
    }
  }

  private async showDetailedInfo(pkg: PackageSearchResult): Promise<void> {
    if (pkg.category && pkg.category !== pkg.type) {
      this.log(chalk.gray(`    Category: ${pkg.category}`));
    }

    if (pkg.runtime) {
      this.log(chalk.gray(`    Runtime: ${pkg.runtime}`));
    }

    if (pkg.type === 'service') {
      await this.showServiceDetails(pkg);
    }

    if (pkg.type === 'runtime') {
      await this.showRuntimeDetails(pkg);
    }

    if (pkg.downloads) {
      this.log(chalk.gray(`    Downloads: ${this.formatNumber(pkg.downloads)}`));
    }

    if (pkg.lastUpdated) {
      const date = new Date(pkg.lastUpdated);
      this.log(chalk.gray(`    Last updated: ${this.formatDate(date)}`));
    }

    if (pkg.repository) {
      this.log(chalk.gray(`    Repository: ${pkg.repository}`));
    }

    if (pkg.homepage && pkg.homepage !== pkg.repository) {
      this.log(chalk.gray(`    Homepage: ${pkg.homepage}`));
    }
  }

  private async showServiceDetails(pkg: PackageSearchResult): Promise<void> {
    const template = ServiceTemplateRegistry.getTemplate(pkg.name);
    if (!template) return;

    const templateInfo = template.getTemplate();

    if (templateInfo.ports.length > 0) {
      this.log(chalk.gray(`    Default ports: ${templateInfo.ports.join(', ')}`));
    }

    if (templateInfo.dependencies?.length) {
      this.log(chalk.gray(`    Dependencies: ${templateInfo.dependencies.join(', ')}`));
    }
  }

  private async showRuntimeDetails(pkg: PackageSearchResult): Promise<void> {
    if (!RuntimeRegistry.isSupported(pkg.name)) return;

    try {
      const manager = RuntimeRegistry.create(pkg.name as RuntimeType, process.cwd(), '/tmp');
      const availableManagers = await manager.getAvailableManagers();
      const activeManager = availableManagers.find(m => m.available);

      if (activeManager) {
        this.log(chalk.gray(`    Version manager: ${activeManager.name}`));
      }
    } catch (error) {
      logger.debug('Failed to get runtime details', error);
      // Don't show error to user for detailed info
    }
  }

  private async checkInstallationStatus(pkg: PackageSearchResult): Promise<boolean> {
    try {
      switch (pkg.type) {
        case 'runtime':
          return await this.isRuntimeInstalled(pkg);
        case 'service':
          return ServiceTemplateRegistry.hasTemplate(pkg.name);
        case 'dependency':
          return await this.isDependencyInstalled(pkg);
        default:
          return false;
      }
    } catch (error) {
      logger.debug(`Failed to check installation status for ${pkg.name}`, error);
      return false;
    }
  }

  private async isRuntimeInstalled(pkg: PackageSearchResult): Promise<boolean> {
    if (!RuntimeRegistry.isSupported(pkg.name)) return false;

    try {
      const manager = RuntimeRegistry.create(pkg.name as RuntimeType, process.cwd(), '/tmp');
      return await manager.isInstalled(pkg.version || 'latest');
    } catch {
      return false;
    }
  }

  private async isDependencyInstalled(pkg: PackageSearchResult): Promise<boolean> {
    const { FileSystem } = await import('../utils/FileSystem');

    try {
      switch (pkg.runtime) {
        case 'nodejs':
          return await this.isNodePackageInstalled(pkg.name);
        case 'python':
          return await this.isPythonPackageInstalled(pkg.name);
        case 'go':
          return await this.isGoPackageInstalled(pkg.name);
        default:
          return false;
      }
    } catch {
      return false;
    }
  }

  private async isNodePackageInstalled(packageName: string): Promise<boolean> {
    const { FileSystem } = await import('../utils/FileSystem');
    const packageJsonPath = `${process.cwd()}/package.json`;

    const packageJson = await FileSystem.readJsonFile(packageJsonPath);
    if (!packageJson) return false;

    return !!(
      packageJson.dependencies?.[packageName] || packageJson.devDependencies?.[packageName]
    );
  }

  private async isPythonPackageInstalled(packageName: string): Promise<boolean> {
    const fs = await import('fs-extra');
    const requirementsPath = `${process.cwd()}/requirements.txt`;

    if (!(await fs.pathExists(requirementsPath))) return false;

    const content = await fs.readFile(requirementsPath, 'utf8');
    return content.includes(packageName);
  }

  private async isGoPackageInstalled(packageName: string): Promise<boolean> {
    const fs = await import('fs-extra');
    const goModPath = `${process.cwd()}/go.mod`;

    if (!(await fs.pathExists(goModPath))) return false;

    const content = await fs.readFile(goModPath, 'utf8');
    return content.includes(packageName);
  }

  private showSearchFooter(resultCount: number, flags: any): void {
    this.log(chalk.blue('🎯 Quick actions:'));
    this.log(chalk.gray(`   • Add package: ${chalk.white('switchr add <package-name>')}`));
    this.log(chalk.gray(`   • View details: ${chalk.white('switchr search <query> --detailed')}`));
    this.log(
      chalk.gray(`   • Filter results: ${chalk.white('switchr search <query> --type <type>')}`)
    );

    if (resultCount >= flags.limit) {
      this.log(chalk.yellow(`\n💡 Showing ${flags.limit} results. Use --limit to see more.`));
    }

    this.log(chalk.gray(`\n💡 Use ${chalk.white('switchr add --help')} for installation options`));
  }

  private getTypeIcon(type: string): string {
    const icons: Record<string, string> = {
      runtime: '🔧',
      service: '⚡',
      dependency: '📚',
      tool: '🛠️',
    };
    return icons[type] || '📦';
  }

  private formatNumber(num: number): string {
    if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(1)}M`;
    } else if (num >= 1_000) {
      return `${(num / 1_000).toFixed(1)}K`;
    }
    return num.toString();
  }

  private formatDate(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
  }
}
