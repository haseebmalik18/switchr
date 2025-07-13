// src/commands/shell.ts - Production-quality shell command
import { Command, Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import { ConfigManager } from '../core/ConfigManager';
import { RuntimeRegistry } from '../core/runtime/RuntimeRegistry';
import { ProcessUtils } from '../utils/ProcessUtils';
import { logger } from '../utils/Logger';
import { RuntimeType } from '../types/Runtime';

export default class Shell extends Command {
  static override description = 'Enter a shell with the project environment loaded';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --runtime nodejs',
    '<%= config.bin %> <%= command.id %> --shell bash',
    '<%= config.bin %> <%= command.id %> --command "npm run dev"',
    '<%= config.bin %> <%= command.id %> --service api',
  ];

  static override args = {
    command: Args.string({
      description: 'Command to run in the environment (optional)',
    }),
  };

  static override flags = {
    runtime: Flags.string({
      char: 'r',
      description: 'Specific runtime environment to load',
      options: ['nodejs', 'python', 'go', 'java', 'rust'],
    }),
    shell: Flags.string({
      char: 's',
      description: 'Shell to use',
      options: ['bash', 'zsh', 'fish', 'sh'],
    }),
    command: Flags.string({
      char: 'c',
      description: 'Run a specific command instead of interactive shell',
    }),
    service: Flags.string({
      description: 'Load environment for a specific service',
    }),
    'print-env': Flags.boolean({
      description: 'Print environment variables and exit',
      default: false,
    }),
    'export-env': Flags.string({
      description: 'Export environment to file',
    }),
    clean: Flags.boolean({
      description: 'Start with a clean environment',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Shell);

    try {
      const configManager = ConfigManager.getInstance();
      const currentProject = await configManager.getCurrentProject();

      if (!currentProject) {
        this.error(
          `No active project. Run ${chalk.white('switchr switch <project-name>')} to activate a project.`
        );
      }

      // Build environment
      const environment = await this.buildProjectEnvironment(currentProject, flags);

      if (flags['print-env']) {
        this.printEnvironment(environment);
        return;
      }

      if (flags['export-env']) {
        await this.exportEnvironment(environment, flags['export-env']);
        return;
      }

      // Determine command to run
      const command = flags.command || args.command;

      if (command) {
        await this.runCommand(command, environment, flags);
      } else {
        await this.startInteractiveShell(environment, flags, currentProject.name);
      }
    } catch (error) {
      logger.error('Failed to start shell', error);
      this.error(error instanceof Error ? error.message : 'Unknown error occurred');
    }
  }

  private async buildProjectEnvironment(
    currentProject: any,
    flags: any
  ): Promise<Record<string, string>> {
    logger.debug('Building project environment...');

    // Start with base environment (or clean if requested)
    let environment = flags.clean
      ? this.getMinimalEnvironment()
      : ProcessUtils.getEnvironmentVariables();

    // Add project environment variables
    if (currentProject.environment) {
      environment = { ...environment, ...currentProject.environment };
    }

    // Add runtime-specific environment
    await this.addRuntimeEnvironment(environment, currentProject, flags);

    // Add service-specific environment
    if (flags.service) {
      await this.addServiceEnvironment(environment, currentProject, flags.service);
    }

    // Add switchr-specific environment variables
    environment = {
      ...environment,
      SWITCHR_PROJECT: currentProject.name,
      SWITCHR_PROJECT_PATH: currentProject.path,
      SWITCHR_ACTIVE: 'true',
    };

    // Add project paths to PATH
    environment.PATH = this.buildProjectPaths(currentProject, environment.PATH || '');

    logger.debug(`Built environment with ${Object.keys(environment).length} variables`);
    return environment;
  }

  private async addRuntimeEnvironment(
    environment: Record<string, string>,
    currentProject: any,
    flags: any
  ): Promise<void> {
    // Initialize runtime registry
    await RuntimeRegistry.initialize();

    // Determine which runtimes to load
    const runtimesToLoad = await this.determineRuntimes(currentProject, flags);

    for (const runtimeType of runtimesToLoad) {
      try {
        logger.debug(`Loading runtime environment: ${runtimeType}`);

        const manager = RuntimeRegistry.create(runtimeType, currentProject.path, '/tmp');
        const runtimeEnv = await manager.getEnvironmentVars();

        // Merge runtime environment
        Object.assign(environment, runtimeEnv);

        logger.debug(
          `Added ${Object.keys(runtimeEnv).length} variables from ${runtimeType} runtime`
        );
      } catch (error) {
        logger.warn(`Failed to load ${runtimeType} runtime environment`, error);
      }
    }
  }

  private async determineRuntimes(currentProject: any, flags: any): Promise<RuntimeType[]> {
    const runtimes: RuntimeType[] = [];

    // Explicit runtime from flags
    if (flags.runtime && RuntimeRegistry.isSupported(flags.runtime)) {
      runtimes.push(flags.runtime as RuntimeType);
      return runtimes;
    }

    // Runtimes from project packages
    if (currentProject.packages?.runtimes) {
      for (const runtimeName of Object.keys(currentProject.packages.runtimes)) {
        if (RuntimeRegistry.isSupported(runtimeName)) {
          runtimes.push(runtimeName as RuntimeType);
        }
      }
    }

    // Auto-detect runtimes if none specified
    if (runtimes.length === 0) {
      const detectedRuntimes = await RuntimeRegistry.detectProjectRuntime(currentProject.path);
      runtimes.push(...detectedRuntimes);
    }

    return runtimes;
  }

  private async addServiceEnvironment(
    environment: Record<string, string>,
    currentProject: any,
    serviceName: string
  ): Promise<void> {
    const service = currentProject.services.find((s: any) => s.name === serviceName);

    if (!service) {
      throw new Error(`Service '${serviceName}' not found in project`);
    }

    // Add service-specific environment variables
    if (service.environment) {
      Object.assign(environment, service.environment);
    }

    // Add service context variables
    environment.SWITCHR_SERVICE = service.name;
    if (service.port) {
      environment.SWITCHR_SERVICE_PORT = service.port.toString();
    }

    logger.debug(`Added environment for service: ${serviceName}`);
  }

  private buildProjectPaths(currentProject: any, currentPath: string): string {
    const projectPaths: string[] = [];

    // Add project root
    projectPaths.push(currentProject.path);

    // Add common project directories
    const commonDirs = ['bin', 'scripts', 'node_modules/.bin', '.venv/bin', 'vendor/bin'];

    for (const dir of commonDirs) {
      const fullPath = `${currentProject.path}/${dir}`;
      projectPaths.push(fullPath);
    }

    // Add switchr bin directory
    projectPaths.push(`${currentProject.path}/.switchr/bin`);

    // Combine with existing PATH, removing duplicates
    const allPaths = [...projectPaths, ...currentPath.split(':')];
    const uniquePaths = Array.from(new Set(allPaths)).filter(Boolean);

    return uniquePaths.join(':');
  }

  private getMinimalEnvironment(): Record<string, string> {
    // Minimal environment for clean shell
    return {
      HOME: process.env.HOME || '',
      USER: process.env.USER || '',
      SHELL: process.env.SHELL || '/bin/bash',
      TERM: process.env.TERM || 'xterm-256color',
      PATH: '/usr/local/bin:/usr/bin:/bin',
    };
  }

  private async runCommand(
    command: string,
    environment: Record<string, string>,
    flags: any
  ): Promise<void> {
    this.log(chalk.blue(`🔧 Running: ${chalk.bold(command)}`));

    try {
      const { command: cmd, args } = ProcessUtils.parseCommand(command);

      const result = await ProcessUtils.execute(cmd, args, {
        env: environment,
        cwd: process.cwd(),
        stdio: 'inherit',
      });

      if (result.exitCode !== 0) {
        this.error(`Command failed with exit code ${result.exitCode}`);
      }

      this.log(chalk.green('✅ Command completed successfully'));
    } catch (error) {
      logger.error('Command execution failed', error);
      this.error(`Command failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async startInteractiveShell(
    environment: Record<string, string>,
    flags: any,
    projectName: string
  ): Promise<void> {
    const shell = this.determineShell(flags);

    // Create a custom prompt indicator
    const promptIndicator = `(switchr:${projectName})`;

    // Set up shell-specific prompt
    this.setupShellPrompt(environment, shell, promptIndicator);

    this.log(chalk.blue(`🐚 Starting ${shell} with project environment...`));
    this.log(chalk.gray(`   Project: ${projectName}`));
    this.log(chalk.gray(`   Use ${chalk.white('exit')} or ${chalk.white('Ctrl+D')} to return`));
    this.log('');

    try {
      // Start the shell with the environment
      const child = ProcessUtils.spawn(shell, [], {
        env: environment,
        cwd: process.cwd(),
        stdio: 'inherit',
      });

      // Wait for shell to exit
      await new Promise<void>((resolve, reject) => {
        child.on('exit', code => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Shell exited with code ${code}`));
          }
        });

        child.on('error', error => {
          reject(error);
        });
      });

      this.log(chalk.blue('🐚 Shell session ended'));
    } catch (error) {
      logger.error('Shell execution failed', error);
      this.error(`Shell failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private determineShell(flags: any): string {
    // Explicit shell from flags
    if (flags.shell) {
      return flags.shell;
    }

    // Use user's default shell
    const userShell = process.env.SHELL;
    if (userShell) {
      return userShell;
    }

    // Try to detect available shells
    const availableShells = ['/bin/zsh', '/bin/bash', '/bin/sh'];

    for (const shell of availableShells) {
      try {
        require('fs').accessSync(shell, require('fs').constants.F_OK);
        return shell;
      } catch {
        continue;
      }
    }

    // Fallback
    return '/bin/sh';
  }

  private setupShellPrompt(
    environment: Record<string, string>,
    shell: string,
    promptIndicator: string
  ): void {
    const shellName = shell.split('/').pop() || shell;

    switch (shellName) {
      case 'bash':
        // Bash prompt with switchr indicator
        environment.PS1 = `${promptIndicator} \\[\\033[01;32m\\]\\u@\\h\\[\\033[00m\\]:\\[\\033[01;34m\\]\\w\\[\\033[00m\\]\\$ `;
        break;

      case 'zsh':
        // Zsh prompt with switchr indicator
        environment.PROMPT = `${promptIndicator} %F{green}%n@%m%f:%F{blue}%~%f%# `;
        break;

      case 'fish':
        // Fish shell prompt
        environment.FISH_PROMPT_OVERRIDE = `echo -n "${promptIndicator} "; fish_prompt`;
        break;

      default:
        // Generic prompt
        environment.PS1 = `${promptIndicator} $ `;
        break;
    }
  }

  private printEnvironment(environment: Record<string, string>): void {
    this.log(chalk.blue('🌍 Project Environment Variables:\n'));

    // Group environment variables
    const groups = this.groupEnvironmentVariables(environment);

    for (const [groupName, vars] of Object.entries(groups)) {
      if (vars.length === 0) continue;

      this.log(chalk.blue(`${groupName.toUpperCase()}:`));

      const sortedVars = vars.sort((a, b) => a.key.localeCompare(b.key));

      for (const { key, value } of sortedVars) {
        const displayValue = this.maskSensitiveValue(key, value);
        this.log(chalk.gray(`  ${key}=${displayValue}`));
      }

      this.log('');
    }

    this.log(chalk.gray(`Total: ${Object.keys(environment).length} variables`));
  }

  private groupEnvironmentVariables(
    environment: Record<string, string>
  ): Record<string, Array<{ key: string; value: string }>> {
    const groups: Record<string, Array<{ key: string; value: string }>> = {
      switchr: [],
      runtime: [],
      project: [],
      system: [],
    };

    for (const [key, value] of Object.entries(environment)) {
      const keyLower = key.toLowerCase();

      if (key.startsWith('SWITCHR_')) {
        groups.switchr.push({ key, value });
      } else if (this.isRuntimeVariable(key)) {
        groups.runtime.push({ key, value });
      } else if (this.isProjectVariable(key)) {
        groups.project.push({ key, value });
      } else {
        groups.system.push({ key, value });
      }
    }

    return groups;
  }

  private isRuntimeVariable(key: string): boolean {
    const runtimePrefixes = [
      'NODE_',
      'NPM_',
      'PYTHON',
      'PIP_',
      'VIRTUAL_ENV',
      'CONDA_',
      'GO',
      'JAVA_',
      'CARGO_',
      'RUSTC_',
      'PHP_',
      'RUBY_',
    ];

    return runtimePrefixes.some(prefix => key.startsWith(prefix));
  }

  private isProjectVariable(key: string): boolean {
    const projectKeys = [
      'PROJECT_',
      'APP_',
      'DATABASE_',
      'DB_',
      'API_',
      'PORT',
      'HOST',
      'DEBUG',
      'LOG_LEVEL',
      'ENV',
      'ENVIRONMENT',
    ];

    return projectKeys.some(prefix => key.includes(prefix));
  }

  private maskSensitiveValue(key: string, value: string): string {
    const sensitivePatterns = [
      'password',
      'secret',
      'key',
      'token',
      'auth',
      'credential',
      'private',
      'cert',
      'ssl',
      'tls',
    ];

    const isSensitive = sensitivePatterns.some(pattern => key.toLowerCase().includes(pattern));

    if (isSensitive && value.length > 3) {
      return value.substring(0, 3) + '*'.repeat(Math.min(value.length - 3, 8));
    }

    // Truncate very long values
    if (value.length > 100) {
      return value.substring(0, 97) + '...';
    }

    return value;
  }

  private async exportEnvironment(
    environment: Record<string, string>,
    filePath: string
  ): Promise<void> {
    try {
      let content = '';
      const format = this.determineExportFormat(filePath);

      switch (format) {
        case 'shell':
          content = this.generateShellExport(environment);
          break;
        case 'json':
          content = JSON.stringify(environment, null, 2);
          break;
        case 'dotenv':
          content = this.generateDotenvExport(environment);
          break;
        case 'yaml':
          content = this.generateYamlExport(environment);
          break;
        default:
          content = this.generateShellExport(environment);
      }

      const fs = await import('fs-extra');
      await fs.writeFile(filePath, content, 'utf8');

      this.log(chalk.green(`✅ Environment exported to: ${filePath}`));
      this.log(chalk.gray(`   Format: ${format}`));
      this.log(chalk.gray(`   Variables: ${Object.keys(environment).length}`));

      if (format === 'shell') {
        this.log(chalk.gray(`   Usage: source ${filePath}`));
      }
    } catch (error) {
      this.error(
        `Failed to export environment: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private determineExportFormat(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();

    switch (ext) {
      case 'json':
        return 'json';
      case 'env':
      case 'dotenv':
        return 'dotenv';
      case 'yml':
      case 'yaml':
        return 'yaml';
      case 'sh':
      case 'bash':
      case 'zsh':
        return 'shell';
      default:
        return 'shell';
    }
  }

  private generateShellExport(environment: Record<string, string>): string {
    let content = '#!/bin/bash\n';
    content += '# Switchr Project Environment\n';
    content += `# Generated at: ${new Date().toISOString()}\n\n`;

    for (const [key, value] of Object.entries(environment)) {
      // Escape shell special characters
      const escapedValue = value.replace(/'/g, "'\"'\"'");
      content += `export ${key}='${escapedValue}'\n`;
    }

    content += '\necho "Switchr environment loaded"\n';
    return content;
  }

  private generateDotenvExport(environment: Record<string, string>): string {
    let content = '# Switchr Project Environment\n';
    content += `# Generated at: ${new Date().toISOString()}\n\n`;

    for (const [key, value] of Object.entries(environment)) {
      // Escape dotenv special characters
      const escapedValue =
        value.includes(' ') || value.includes('#') ? `"${value.replace(/"/g, '\\"')}"` : value;
      content += `${key}=${escapedValue}\n`;
    }

    return content;
  }

  private generateYamlExport(environment: Record<string, string>): string {
    let content = '# Switchr Project Environment\n';
    content += `# Generated at: ${new Date().toISOString()}\n\n`;
    content += 'environment:\n';

    for (const [key, value] of Object.entries(environment)) {
      // YAML string escaping
      const escapedValue =
        value.includes(':') || value.includes('\n') ? `"${value.replace(/"/g, '\\"')}"` : value;
      content += `  ${key}: ${escapedValue}\n`;
    }

    return content;
  }
}
