// src/commands/search.ts - Fixed implementation with proper types
import { Command, Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import ora from 'ora';
import { ConfigManager } from '../core/ConfigManager';
import { PackageManager } from '../core/PackageManager';
import { RuntimeRegistry } from '../core/runtime/RuntimeRegistry';
import { ServiceTemplateRegistry } from '../core/service/ServiceTemplateRegistry';
import { logger } from '../utils/Logger';
import { PackageType, RuntimeType } from '../types/Package';

// Define search result interface
interface SearchResult {
  name: string;
  type: PackageType;
  version?: string;
  description?: string;
  category?: string;
  runtime?: RuntimeType;
  score?: number;
  downloads?: number;
  lastUpdated?: string;
  repository?: string;
  homepage?: string;
}

// Define search options interface
interface SearchOptions {
  type?: PackageType;
  category?: string;
  runtime?: RuntimeType;
  limit: number;
  sortBy: 'relevance' | 'downloads' | 'updated' | 'name';
}

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

      // Initialize registries
      await RuntimeRegistry.initialize();
      await ServiceTemplateRegistry.initialize();

      const configManager = ConfigManager.getInstance();
      const projectPath = process.cwd();

      const packageManager = new PackageManager({
        projectPath,
        cacheDir: configManager.getConfigDir(),
      });

      // Build search options with proper typing
      const searchOptions: SearchOptions = {
        limit: flags.limit,
        sortBy: flags['sort-by'] as 'relevance' | 'downloads' | 'updated' | 'name',
      };

      // Add optional properties only if they exist
      if (flags.type) {
        searchOptions.type = flags.type as PackageType;
      }
      if (flags.category) {
        searchOptions.category = flags.category;
      }
      if (flags.runtime) {
        searchOptions.runtime = flags.runtime as RuntimeType;
      }

      // Search for packages
      const results = await packageManager.searchPackages(args.query, searchOptions);

      spinner.stop();

      if (flags.json) {
        this.outputJson(results, flags);
        return;
      }

      if (results.length === 0) {
        this.showNoResults(args.query, flags);
        return;
      }

      await this.displayResults(results, flags);
    } catch (error) {
      logger.error('Failed to search packages', error);
      this.error(error instanceof Error ? error.message : 'Unknown error occurred');
    }
  }

  private outputJson(results: SearchResult[], _flags: any): void {
    const output = results.map(result => ({
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

    this.log(JSON.stringify(output, null, 2));
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

  private async displayResults(results: SearchResult[], flags: any): Promise<void> {
    this.log(chalk.green(`\n📦 Found ${results.length} package(s):\n`));

    // Group by type for better organization
    const grouped: Record<string, SearchResult[]> = {};

    for (const pkg of results) {
      if (!grouped[pkg.type]) {
        grouped[pkg.type] = [];
      }
      grouped[pkg.type].push(pkg);
    }

    // Display each type group
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

  private async displayPackage(pkg: SearchResult, flags: any): Promise<void> {
    const nameColor = chalk.white;
    const versionInfo = pkg.version ? chalk.gray(`@${pkg.version}`) : '';
    const scoreInfo = pkg.score ? chalk.gray(` (${Math.round(pkg.score)}%)`) : '';

    let line = `  ${nameColor(pkg.name)}${versionInfo}${scoreInfo}`;

    // Add installation status if requested
    if (flags['show-installed']) {
      const installed = await this.checkInstallationStatus(pkg);
      const statusIcon = installed ? chalk.green('✓') : chalk.gray('○');
      line = `  ${statusIcon} ${nameColor(pkg.name)}${versionInfo}${scoreInfo}`;
    }

    this.log(line);

    // Description
    if (pkg.description) {
      this.log(chalk.gray(`    ${pkg.description}`));
    }

    // Show detailed information if requested
    if (flags.detailed) {
      await this.showDetailedInfo(pkg);
    }
  }

  private async showDetailedInfo(pkg: SearchResult): Promise<void> {
    // Category/Runtime info
    if (pkg.category && pkg.category !== pkg.type) {
      this.log(chalk.gray(`    Category: ${pkg.category}`));
    }

    if (pkg.runtime) {
      this.log(chalk.gray(`    Runtime: ${pkg.runtime}`));
    }

    // Service-specific details
    if (pkg.type === 'service') {
      const template = ServiceTemplateRegistry.getTemplate(pkg.name);
      if (template) {
        const templateInfo = template.getTemplate();

        if (templateInfo.ports.length > 0) {
          this.log(chalk.gray(`    Default ports: ${templateInfo.ports.join(', ')}`));
        }

        if (templateInfo.dependencies && templateInfo.dependencies.length > 0) {
          this.log(chalk.gray(`    Dependencies: ${templateInfo.dependencies.join(', ')}`));
        }
      }
    }

    // Runtime-specific details
    if (pkg.type === 'runtime') {
      try {
        if (RuntimeRegistry.isSupported(pkg.name)) {
          const manager = RuntimeRegistry.create(pkg.name as RuntimeType, process.cwd(), '/tmp');
          const availableManagers = await manager.getAvailableManagers();
          const activeManager = availableManagers.find(m => m.available);

          if (activeManager) {
            this.log(chalk.gray(`    Version manager: ${activeManager.name}`));
          }
        }
      } catch {
        // Ignore errors in detailed info
      }
    }

    // Statistics
    if (pkg.downloads) {
      this.log(chalk.gray(`    Downloads: ${this.formatNumber(pkg.downloads)}`));
    }

    if (pkg.lastUpdated) {
      const date = new Date(pkg.lastUpdated);
      this.log(chalk.gray(`    Last updated: ${this.formatDate(date)}`));
    }

    // Links
    if (pkg.repository) {
      this.log(chalk.gray(`    Repository: ${pkg.repository}`));
    }

    if (pkg.homepage && pkg.homepage !== pkg.repository) {
      this.log(chalk.gray(`    Homepage: ${pkg.homepage}`));
    }
  }

  private async checkInstallationStatus(pkg: SearchResult): Promise<boolean> {
    try {
      switch (pkg.type) {
        case 'runtime':
          if (RuntimeRegistry.isSupported(pkg.name)) {
            const manager = RuntimeRegistry.create(pkg.name as RuntimeType, process.cwd(), '/tmp');
            return await manager.isInstalled(pkg.version || 'latest');
          }
          return false;

        case 'service':
          // Check if service template is available
          return ServiceTemplateRegistry.hasTemplate(pkg.name);

        case 'dependency':
          // For dependencies, check if they exist in project files
          return await this.isDependencyInstalled(pkg);

        default:
          return false;
      }
    } catch {
      return false;
    }
  }

  private async isDependencyInstalled(pkg: SearchResult): Promise<boolean> {
    const fs = await import('fs-extra');
    const path = await import('path');

    try {
      switch (pkg.runtime) {
        case 'nodejs':
          const packageJsonPath = path.join(process.cwd(), 'package.json');
          if (await fs.pathExists(packageJsonPath)) {
            const packageJson = await fs.readJson(packageJsonPath);
            return !!(
              packageJson.dependencies?.[pkg.name] || packageJson.devDependencies?.[pkg.name]
            );
          }
          return false;

        case 'python':
          // Check requirements.txt or installed packages
          const requirementsPath = path.join(process.cwd(), 'requirements.txt');
          if (await fs.pathExists(requirementsPath)) {
            const content = await fs.readFile(requirementsPath, 'utf8');
            return content.includes(pkg.name);
          }
          return false;

        case 'go':
          const goModPath = path.join(process.cwd(), 'go.mod');
          if (await fs.pathExists(goModPath)) {
            const content = await fs.readFile(goModPath, 'utf8');
            return content.includes(pkg.name);
          }
          return false;

        default:
          return false;
      }
    } catch {
      return false;
    }
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
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    } else if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
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
