import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { ConfigManager } from '../core/ConfigManager';
import { logger } from '../utils/Logger';
import { Service, ProjectProfile } from '../types/Project';
import { GlobalConfig } from '../types/Config';

interface ProjectListItem {
  info: GlobalConfig['projects'][string];
  profile: ProjectProfile;
}

export default class List extends Command {
  static override description = 'List all switchr projects';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --verbose',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static override flags = {
    verbose: Flags.boolean({
      char: 'v',
      description: 'Show detailed project information',
      default: false,
    }),
    json: Flags.boolean({
      char: 'j',
      description: 'Output in JSON format',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(List);

    try {
      const configManager = ConfigManager.getInstance();
      const projects = await configManager.getAllProjects();

      if (projects.length === 0) {
        this.log(chalk.yellow('📭 No projects found.'));
        this.log(chalk.gray(`   Run ${chalk.white('switchr init')} to create your first project.`));
        return;
      }

      // Sort projects by last used date (most recent first)
      const sortedProjects = projects.sort((a, b) => {
        const aDate = new Date(a.info.lastUsed || '1970-01-01');
        const bDate = new Date(b.info.lastUsed || '1970-01-01');
        return bDate.getTime() - aDate.getTime();
      });

      // Get current project
      const currentProject = await configManager.getCurrentProject();
      const currentProjectName = currentProject?.name;

      if (flags.json) {
        this.outputJson(sortedProjects);
      } else {
        this.outputTable(sortedProjects, currentProjectName, flags.verbose);
      }
    } catch (error) {
      logger.error('Failed to list projects', error);
      this.error(error instanceof Error ? error.message : 'Unknown error occurred');
    }
  }

  private outputJson(projects: ProjectListItem[]): void {
    const output = projects.map(({ info, profile }) => ({
      name: profile.name,
      type: profile.type,
      path: profile.path,
      description: profile.description,
      lastUsed: info.lastUsed,
      favorite: info.favorite,
      services: profile.services.length,
      tools: Object.keys(profile.tools),
    }));

    this.log(JSON.stringify(output, null, 2));
  }

  private outputTable(
    projects: ProjectListItem[],
    currentProjectName?: string,
    verbose: boolean = false
  ): void {
    this.log(
      chalk.blue(`📋 Found ${projects.length} project${projects.length === 1 ? '' : 's'}:\n`)
    );

    // Sort projects: current first, then by last used, then alphabetically
    const sortedProjects = projects.sort((a, b) => {
      if (a.profile.name === currentProjectName) return -1;
      if (b.profile.name === currentProjectName) return 1;

      // Sort by last used (most recent first)
      const aTime = new Date(a.info.lastUsed || 0).getTime();
      const bTime = new Date(b.info.lastUsed || 0).getTime();
      if (aTime !== bTime) return bTime - aTime;

      // Alphabetical fallback
      return a.profile.name.localeCompare(b.profile.name);
    });

    sortedProjects.forEach(({ info, profile }, index) => {
      const isCurrent = profile.name === currentProjectName;
      const prefix = isCurrent ? chalk.green('►') : ' ';
      const favoriteIcon = info.favorite ? '⭐' : '  ';

      // Project name and type
      const nameDisplay = isCurrent ? chalk.green.bold(profile.name) : chalk.white(profile.name);

      const typeDisplay = chalk.gray(`[${profile.type}]`);

      this.log(`${prefix} ${favoriteIcon} ${nameDisplay} ${typeDisplay}`);

      if (verbose) {
        // Description
        if (profile.description) {
          this.log(chalk.gray(`    📝 ${profile.description}`));
        }

        // Path
        this.log(chalk.gray(`    📁 ${profile.path}`));

        // Services
        if (profile.services.length > 0) {
          const serviceNames = profile.services.map((s: Service) => s.name).join(', ');
          this.log(chalk.gray(`    ⚙️  Services: ${serviceNames}`));
        }

        // Tools
        if (Object.keys(profile.tools).length > 0) {
          const toolList = Object.entries(profile.tools)
            .map(([name, version]) => `${name}@${version}`)
            .join(', ');
          this.log(chalk.gray(`    🔧 Tools: ${toolList}`));
        }

        // Last used
        if (info.lastUsed) {
          const lastUsed = new Date(info.lastUsed);
          const timeAgo = this.getTimeAgo(lastUsed);
          this.log(chalk.gray(`    🕐 Last used: ${timeAgo}`));
        }

        if (index < sortedProjects.length - 1) {
          this.log(''); // Add spacing between projects in verbose mode
        }
      } else {
        // Compact mode - show key info on same line
        const details = [];

        if (profile.description) {
          details.push(profile.description);
        }

        if (profile.services.length > 0) {
          details.push(
            `${profile.services.length} service${profile.services.length === 1 ? '' : 's'}`
          );
        }

        if (info.lastUsed) {
          const timeAgo = this.getTimeAgo(new Date(info.lastUsed));
          details.push(`used ${timeAgo}`);
        }

        if (details.length > 0) {
          this.log(chalk.gray(`    ${details.join(' • ')}`));
        }
      }
    });

    // Show helpful footer
    this.log('');
    if (currentProjectName) {
      this.log(chalk.gray(`Current project: ${chalk.green(currentProjectName)}`));
    } else {
      this.log(chalk.gray('No active project'));
    }

    this.log(
      chalk.gray(`\nUse ${chalk.white('switchr switch <project-name>')} to switch projects`)
    );
    this.log(chalk.gray(`Use ${chalk.white('switchr list --verbose')} for detailed information`));
  }

  private getTimeAgo(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
    return `${Math.floor(diffDays / 365)}y ago`;
  }
}
