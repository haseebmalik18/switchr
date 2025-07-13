// src/commands/search.ts - Updated with real registry implementations
import { Command, Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import ora from 'ora';
import { ConfigManager } from '../core/ConfigManager';
import { PackageManager, type SearchPackageOptions } from '../core/PackageManager';
import { RuntimeRegistry } from '../core/runtime/RuntimeRegistry';
import { ServiceTemplateRegistry } from '../core/service/ServiceTemplateRegistry';
import { NPMRegistry } from '../core/registry/NPMRegistry';
import { PyPIRegistry } from '../core/registry/PyPIRegistry';
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
    '<%= config.bin %> <%= command.id %> django --runtime python --limit 10',
    '<%= config.bin %> <%= command.id %> redis --category cache',
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
    'include-stats': Flags.boolean({
      description: 'Include download statistics (slower)',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Search);

    try {
      const spinner = ora(`Searching for: ${chalk.bold(args.query)}`).start();

      await this.initializeRegistries();

      const searchOptions = this.buildSearchOptions(flags);
      const results = await this.performSearch(args.query, searchOptions, flags);

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

  private async performSearch(
    query: string,
    options: SearchPackageOptions,
    flags: any
  ): Promise<PackageSearchResult[]> {
    const results: PackageSearchResult[] = [];

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
      const depResults = await this.searchDependencies(query, options, flags);
      results.push(...depResults);
    }

    // Sort and limit results
    const sortedResults = this.sortSearchResults(results, options.sortBy || 'relevance');
    return sortedResults.slice(0, options.limit || 20);
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
          // Get available versions for this runtime
          const manager = RuntimeRegistry.create(type, process.cwd(), '/tmp');
          const versions = await manager.listAvailable();

          results.push({
            name: type,
            type: 'runtime',
            description: `${type} runtime environment`,
            category: 'runtime',
            version: versions[0] || 'latest', // Latest version
            score: this.calculateRelevanceScore(type, query),
          });
        } catch (error) {
          logger.debug(`Failed to get runtime info for ${type}`, error);
          // Add basic result without version info
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
    options: SearchPackageOptions,
    flags: any
  ): Promise<PackageSearchResult[]> {
    const results: PackageSearchResult[] = [];

    // Search npm registry for Node.js packages
    if (!options.runtime || options.runtime === 'nodejs') {
      try {
        const npmResults = await NPMRegistry.searchPackages(query, {
          limit: Math.min(options.limit || 20, 50),
          sortBy: options.sortBy,
        });

        // Add download stats if requested
        if (flags['include-stats']) {
          for (const result of npmResults) {
            try {
              const downloads = await NPMRegistry.getDownloadStats(result.name);
              if (downloads !== null) {
                result.downloads = downloads;
              }
            } catch (error) {
              logger.debug(`Failed to get download stats for ${result.name}`, error);
            }
          }
        }

        results.push(...npmResults);
      } catch (error) {
        logger.error('NPM registry search failed', error);
        // Add fallback results
        results.push(...this.getFallbackNpmResults(query));
      }
    }

    // Search PyPI for Python packages
    if (!options.runtime || options.runtime === 'python') {
      try {
        const pypiResults = await PyPIRegistry.searchPackages(query, {
          limit: Math.min(options.limit || 20, 50),
          sortBy: options.sortBy,
        });

        // Add download stats if requested
        if (flags['include-stats']) {
          for (const result of pypiResults) {
            try {
              const downloads = await PyPIRegistry.getDownloadStats(result.name);
              if (downloads !== null) {
                result.downloads = downloads;
              }
            } catch (error) {
              logger.debug(`Failed to get download stats for ${result.name}`, error);
            }
          }
        }

        results.push(...pypiResults);
      } catch (error) {
        logger.error('PyPI registry search failed', error);
        // Add fallback results
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

    // Add download info if available
    if (pkg.downloads && pkg.downloads > 0) {
      const downloadInfo = chalk.cyan(` (${this.formatNumber(pkg.downloads)} downloads/month)`);
      line += downloadInfo;
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

    if (pkg.keywords?.length) {
      this.log(chalk.gray(`    Keywords: ${pkg.keywords.slice(0, 5).join(', ')}`));
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

    if (flags['include-stats']) {
      this.log(chalk.gray(`   • Download stats included for supported registries`));
    } else {
      this.log(chalk.gray(`   • Add --include-stats for download statistics (slower)`));
    }

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
