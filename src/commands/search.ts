// src/commands/search.ts - Complete production implementation with strong typing
import { Command, Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import ora from 'ora';
import { PackageManager, SearchPackageOptions } from '../core/PackageManager';
import { RuntimeRegistry } from '../core/runtime/RuntimeRegistry';
import { ServiceTemplateRegistry } from '../core/service/ServiceTemplateRegistry';
import { ConfigManager } from '../core/ConfigManager';
import { logger } from '../utils/Logger';
import { PackageSearchResult, PackageType } from '../types/Package';
import { RuntimeType } from '../types/Runtime';

interface SearchCommandFlags {
  type: PackageType | undefined;
  runtime: RuntimeType | undefined;
  limit: number;
  detailed: boolean;
  json: boolean;
  sort: 'relevance' | 'downloads' | 'updated' | 'name';
  category: string | undefined;
  prerelease: boolean;
}

interface SearchContext {
  query: string;
  flags: SearchCommandFlags;
  packageManager: PackageManager;
  projectPath: string;
}

interface SearchStats {
  totalResults: number;
  runtimeResults: number;
  serviceResults: number;
  dependencyResults: number;
  searchTime: number;
}

export default class Search extends Command {
  static override description = 'Search for packages, runtimes, and services';

  static override examples = [
    '<%= config.bin %> <%= command.id %> redis',
    '<%= config.bin %> <%= command.id %> postgres --type service',
    '<%= config.bin %> <%= command.id %> express --runtime nodejs',
    '<%= config.bin %> <%= command.id %> django --detailed',
    '<%= config.bin %> <%= command.id %> react --limit 5 --sort downloads',
    '<%= config.bin %> <%= command.id %> tensorflow --json',
  ];

  static override args = {
    query: Args.string({
      description: 'Search query for packages, services, or runtimes',
      required: true,
    }),
  };

  static override flags = {
    type: Flags.string({
      char: 't',
      description: 'Filter by package type',
      options: ['runtime', 'service', 'dependency'],
    }),
    runtime: Flags.string({
      char: 'r',
      description: 'Filter dependencies by runtime',
      options: ['nodejs', 'python', 'go', 'java', 'rust', 'php', 'ruby'],
    }),
    limit: Flags.integer({
      char: 'l',
      description: 'Maximum number of results to show',
      default: 20,
      min: 1,
      max: 100,
    }),
    detailed: Flags.boolean({
      char: 'd',
      description: 'Show detailed package information',
      default: false,
    }),
    json: Flags.boolean({
      char: 'j',
      description: 'Output results in JSON format',
      default: false,
    }),
    sort: Flags.string({
      char: 's',
      description: 'Sort results by criteria',
      options: ['relevance', 'downloads', 'updated', 'name'],
      default: 'relevance',
    }),
    category: Flags.string({
      char: 'c',
      description: 'Filter by package category',
    }),
    prerelease: Flags.boolean({
      description: 'Include prerelease versions',
      default: false,
    }),
  };

  private configManager: ConfigManager;

  constructor(argv: string[], config: import('@oclif/core').Config) {
    super(argv, config);
    this.configManager = ConfigManager.getInstance();
  }

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Search);

    try {
      // Initialize registries
      await Promise.all([RuntimeRegistry.initialize(), ServiceTemplateRegistry.initialize()]);

      const currentProject = await this.configManager.getCurrentProject();
      const projectPath = currentProject?.path || process.cwd();

      const packageManager = new PackageManager({
        projectPath,
        cacheDir: this.configManager.getConfigDir(),
      });

      const searchContext: SearchContext = {
        query: args.query,
        flags: flags as SearchCommandFlags,
        packageManager,
        projectPath,
      };

      await this.performSearch(searchContext);
    } catch (error) {
      logger.error('Search failed', error);
      this.error(error instanceof Error ? error.message : 'Search failed');
    }
  }

  private async performSearch(context: SearchContext): Promise<void> {
    const { query, flags } = context;
    const spinner = ora(`Searching for "${query}"...`).start();

    try {
      const startTime = Date.now();
      const options = this.buildSearchOptions(flags);

      const results = await context.packageManager.searchPackages(query, options);
      const searchTime = Date.now() - startTime;

      spinner.stop();

      if (results.length === 0) {
        this.showNoResults(query, flags);
        return;
      }

      const stats = this.calculateSearchStats(results, searchTime);

      if (flags.json) {
        this.outputJson(results, stats);
      } else {
        await this.displayResults(results, flags, stats);
      }
    } catch (error) {
      spinner.fail(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  private buildSearchOptions(flags: SearchCommandFlags): SearchPackageOptions {
    const options: SearchPackageOptions = {
      limit: flags.limit,
      sortBy: flags.sort,
      includePrerelease: flags.prerelease,
    };

    if (flags.type) {
      options.type = flags.type;
    }

    if (flags.runtime) {
      options.runtime = flags.runtime;
    }

    if (flags.category) {
      options.category = flags.category;
    }

    return options;
  }

  private calculateSearchStats(results: PackageSearchResult[], searchTime: number): SearchStats {
    return {
      totalResults: results.length,
      runtimeResults: results.filter(r => r.type === 'runtime').length,
      serviceResults: results.filter(r => r.type === 'service').length,
      dependencyResults: results.filter(r => r.type === 'dependency').length,
      searchTime,
    };
  }

  private showNoResults(query: string, flags: SearchCommandFlags): void {
    this.log(chalk.yellow(`🔍 No results found for "${query}"`));
    this.log('');

    if (flags.type) {
      this.log(chalk.gray(`Try searching without the --type filter`));
    }

    if (flags.runtime) {
      this.log(chalk.gray(`Try searching without the --runtime filter`));
    }

    if (flags.category) {
      this.log(chalk.gray(`Try searching without the --category filter`));
    }

    this.log(chalk.gray('Suggestions:'));
    this.log(chalk.gray('• Check your spelling'));
    this.log(chalk.gray('• Try broader search terms'));
    this.log(chalk.gray('• Remove filters to see more results'));
    this.log(chalk.gray(`• Use ${chalk.white('switchr search --help')} for more options`));
  }

  private async displayResults(
    results: PackageSearchResult[],
    flags: SearchCommandFlags,
    stats: SearchStats
  ): Promise<void> {
    // Header
    this.displaySearchHeader(stats);

    // Group results by type
    const groupedResults = this.groupResultsByType(results);

    // Display each type
    for (const [type, typeResults] of Object.entries(groupedResults)) {
      if (typeResults.length > 0) {
        this.displayTypeHeader(type, typeResults.length);

        for (const result of typeResults) {
          await this.displayPackage(result, flags);
        }

        this.log('');
      }
    }

    this.showSearchFooter(stats.totalResults, flags);
  }

  private displaySearchHeader(stats: SearchStats): void {
    this.log(chalk.blue('🔍 Search Results\n'));

    this.log(chalk.blue('📊 Summary:'));
    this.log(chalk.gray(`   Total results: ${chalk.white(stats.totalResults)}`));
    this.log(chalk.gray(`   Search time: ${chalk.white(stats.searchTime)}ms`));

    if (stats.runtimeResults > 0) {
      this.log(chalk.gray(`   Runtimes: ${stats.runtimeResults}`));
    }
    if (stats.serviceResults > 0) {
      this.log(chalk.gray(`   Services: ${stats.serviceResults}`));
    }
    if (stats.dependencyResults > 0) {
      this.log(chalk.gray(`   Dependencies: ${stats.dependencyResults}`));
    }

    this.log('');
  }

  private groupResultsByType(
    results: PackageSearchResult[]
  ): Record<string, PackageSearchResult[]> {
    return results.reduce(
      (acc, result) => {
        if (!acc[result.type]) {
          acc[result.type] = [];
        }
        acc[result.type].push(result);
        return acc;
      },
      {} as Record<string, PackageSearchResult[]>
    );
  }

  private displayTypeHeader(type: string, count: number): void {
    const icon = this.getTypeIcon(type);
    const typeName = type.charAt(0).toUpperCase() + type.slice(1) + 's';

    this.log(chalk.blue(`${icon} ${typeName} (${count}):`));
  }

  private async displayPackage(pkg: PackageSearchResult, flags: SearchCommandFlags): Promise<void> {
    const nameColor = this.getNameColor(pkg.type);
    const name = nameColor(pkg.name);
    const version = pkg.version ? chalk.gray(`@${pkg.version}`) : '';
    const score = pkg.score ? chalk.gray(`(${pkg.score})`) : '';

    this.log(`   📦 ${name}${version} ${score}`);

    if (pkg.description) {
      this.log(chalk.gray(`      ${pkg.description}`));
    }

    if (flags.detailed) {
      await this.displayPackageDetails(pkg);
    }

    this.log('');
  }

  private async displayPackageDetails(pkg: PackageSearchResult): Promise<void> {
    if (pkg.runtime) {
      this.log(chalk.gray(`      Runtime: ${pkg.runtime}`));
    }

    if (pkg.category) {
      this.log(chalk.gray(`      Category: ${pkg.category}`));
    }

    if ('author' in pkg && pkg.author) {
      this.log(chalk.gray(`      Author: ${pkg.author}`));
    }

    if ('license' in pkg && pkg.license) {
      this.log(chalk.gray(`      License: ${pkg.license}`));
    }

    if (pkg.homepage) {
      this.log(chalk.gray(`      Homepage: ${pkg.homepage}`));
    }

    if (pkg.repository) {
      this.log(chalk.gray(`      Repository: ${pkg.repository}`));
    }

    if (pkg.lastUpdated) {
      this.log(chalk.gray(`      Updated: ${this.formatDate(pkg.lastUpdated)}`));
    }

    if (pkg.downloads !== undefined) {
      this.log(chalk.gray(`      Downloads: ${this.formatDownloads(pkg.downloads)}`));
    }

    if (pkg.keywords && pkg.keywords.length > 0) {
      const keywords = pkg.keywords.slice(0, 5).join(', ');
      this.log(chalk.gray(`      Keywords: ${keywords}`));
    }
  }

  private showSearchFooter(resultCount: number, flags: SearchCommandFlags): void {
    this.log(chalk.gray('💡 Next steps:'));
    this.log(chalk.gray(`   Add package: ${chalk.white('switchr add <package-name>')}`));
    this.log(chalk.gray(`   Package info: ${chalk.white('switchr info <package-name>')}`));

    if (!flags.detailed && resultCount > 0) {
      this.log(chalk.gray(`   More details: ${chalk.white('switchr search <query> --detailed')}`));
    }

    if (resultCount >= flags.limit) {
      this.log(chalk.gray(`   More results: ${chalk.white('switchr search <query> --limit 50')}`));
    }
  }

  private outputJson(results: PackageSearchResult[], stats: SearchStats): void {
    const output = {
      results,
      stats,
      timestamp: new Date().toISOString(),
    };

    this.log(JSON.stringify(output, null, 2));
  }

  private getTypeIcon(type: string): string {
    const icons: Record<string, string> = {
      runtime: '🔧',
      service: '⚡',
      dependency: '📚',
    };
    return icons[type] || '📦';
  }

  private getNameColor(type: string): (text: string) => string {
    switch (type) {
      case 'runtime':
        return chalk.cyan;
      case 'service':
        return chalk.magenta;
      case 'dependency':
        return chalk.green;
      default:
        return chalk.white;
    }
  }

  private formatDate(dateString: string): string {
    try {
      const date = new Date(dateString);
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
    } catch {
      return dateString;
    }
  }

  private formatDownloads(downloads: number): string {
    if (downloads >= 1000000) {
      return `${(downloads / 1000000).toFixed(1)}M`;
    } else if (downloads >= 1000) {
      return `${(downloads / 1000).toFixed(1)}K`;
    } else {
      return downloads.toString();
    }
  }
}
