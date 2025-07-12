export default class Search extends Command {
  static override description = 'Search for available packages, runtimes, and services';

  static override examples = [
    '<%= config.bin %> <%= command.id %> postgres',
    '<%= config.bin %> <%= command.id %> node --type runtime',
    '<%= config.bin %> <%= command.id %> database --type service',
    '<%= config.bin %> <%= command.id %> express --type dependency',
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
    limit: Flags.integer({
      char: 'l',
      description: 'Limit number of results',
      default: 20,
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
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Search);

    try {
      await ServiceTemplateRegistry.initialize();

      this.log(chalk.blue(`🔍 Searching for: ${chalk.bold(args.query)}`));

      const configManager = ConfigManager.getInstance();
      const packageManager = new PackageManager({
        projectPath: process.cwd(),
        cacheDir: configManager.getConfigDir(),
      });

      const results = await packageManager.searchPackages(args.query, flags.type as any, {
        category: flags.category,
      });

      const limitedResults = results.slice(0, flags.limit);

      if (flags.json) {
        this.log(JSON.stringify(limitedResults, null, 2));
        return;
      }

      if (limitedResults.length === 0) {
        this.log(chalk.yellow(`No packages found matching: ${args.query}`));
        this.showSearchSuggestions(args.query);
        return;
      }

      this.log(chalk.green(`\n📦 Found ${limitedResults.length} package(s):\n`));

      // Group by type
      const grouped = limitedResults.reduce(
        (acc, pkg) => {
          if (!acc[pkg.type]) acc[pkg.type] = [];
          acc[pkg.type].push(pkg);
          return acc;
        },
        {} as Record<string, typeof limitedResults>
      );

      for (const [type, packages] of Object.entries(grouped)) {
        this.log(chalk.blue(`${this.getTypeIcon(type)} ${type.toUpperCase()}:`));

        packages.forEach(pkg => {
          this.displayPackage(pkg, flags.detailed);
        });

        this.log('');
      }

      this.log(chalk.gray(`💡 Add packages with: ${chalk.white('switchr add <package-name>')}`));
    } catch (error) {
      logger.error('Failed to search packages', error);
      this.error(error instanceof Error ? error.message : 'Unknown error occurred');
    }
  }

  private displayPackage(pkg: any, detailed: boolean): void {
    const versionInfo = pkg.version ? chalk.gray(`@${pkg.version}`) : '';
    const description = pkg.description ? chalk.gray(` - ${pkg.description}`) : '';

    this.log(`  ${chalk.white(pkg.name)}${versionInfo}${description}`);

    if (detailed) {
      if (pkg.category) {
        this.log(chalk.gray(`    Category: ${pkg.category}`));
      }
      if (pkg.ports && pkg.ports.length > 0) {
        this.log(chalk.gray(`    Ports: ${pkg.ports.join(', ')}`));
      }
      if (pkg.dependencies && pkg.dependencies.length > 0) {
        this.log(chalk.gray(`    Dependencies: ${pkg.dependencies.join(', ')}`));
      }
    }
  }

  private showSearchSuggestions(query: string): void {
    this.log(chalk.blue('\n💡 Search suggestions:'));
    this.log(chalk.gray(`   • Try broader terms: ${chalk.white('switchr search db')}`));
    this.log(
      chalk.gray(`   • Filter by type: ${chalk.white(`switchr search ${query} --type service`)}`)
    );
    this.log(
      chalk.gray(`   • Browse all services: ${chalk.white('switchr search "" --type service')}`)
    );
  }

  private getTypeIcon(type: string): string {
    const icons = {
      runtime: '🔧',
      service: '⚡',
      dependency: '📚',
      tool: '🛠️',
    };
    return icons[type as keyof typeof icons] || '📦';
  }
}
