// src/commands/shell.ts - Production-quality shell command
import { Command, Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import { spawn } from 'child_process';
import * as fs from 'fs-extra';
import * as path from 'path';
import { ConfigManager } from '../core/ConfigManager';
import { RuntimeRegistry } from '../core/runtime/RuntimeRegistry';
import { logger } from '../utils/Logger';
import { ProjectProfile } from '../types/Project';
import { RuntimeType } from '../types/Runtime';

interface ShellCommandFlags {
  service: string | undefined;
  clean: boolean;
  'export-env': string | undefined;
  command: string | undefined;
  runtime: string | undefined;
  'print-env': boolean;
  shell: string | undefined;
}

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
    currentProject: ProjectProfile,
    flags: ShellCommandFlags
  ): Promise<Record<string, string>> {
    logger.debug('Building project environment...');

    // Start with base environment (or clean if requested)
    const environment = flags.clean
      ? this.getMinimalEnvironment()
      : ({ ...process.env } as Record<string, string>);

    // Add project environment variables
    if (currentProject.environment) {
      Object.assign(environment, currentProject.environment);
    }

    // Add runtime environments
    await this.addRuntimeEnvironment(environment, currentProject, flags);

    // Add service-specific environment if specified
    if (flags.service) {
      await this.addServiceEnvironment(environment, currentProject, flags.service);
    }

    // Build project paths
    environment.PROJECT_PATH = currentProject.path;
    environment.PROJECT_NAME = currentProject.name;
    environment.PATH = this.buildProjectPaths(currentProject, environment.PATH || '');

    return environment;
  }

  private async addRuntimeEnvironment(
    environment: Record<string, string>,
    currentProject: ProjectProfile,
    flags: ShellCommandFlags
  ): Promise<void> {
    const runtimes = await this.determineRuntimes(currentProject, flags);

    for (const runtimeType of runtimes) {
      try {
        // Initialize runtime registry if needed
        await RuntimeRegistry.initialize();

        // Create runtime manager instance to get environment
        const manager = RuntimeRegistry.create(
          runtimeType,
          currentProject.path,
          this.getCacheDir()
        );
        const runtimeEnv = await manager.getEnvironmentVars();

        // Merge runtime environment
        Object.assign(environment, runtimeEnv);

        logger.debug(`Added environment variables from ${runtimeType} runtime`);
      } catch (error) {
        logger.warn(`Failed to load runtime environment for ${runtimeType}:`, error);
      }
    }
  }

  private async determineRuntimes(
    currentProject: ProjectProfile,
    flags: ShellCommandFlags
  ): Promise<RuntimeType[]> {
    // If specific runtime is requested via flags
    if (flags.runtime && RuntimeRegistry.isSupported(flags.runtime)) {
      return [flags.runtime as RuntimeType];
    }

    // Auto-detect from project
    const detectedRuntimes: RuntimeType[] = [];

    // Check project packages for runtimes
    if (currentProject.packages?.runtimes) {
      Object.keys(currentProject.packages.runtimes).forEach(runtime => {
        if (RuntimeRegistry.isSupported(runtime as RuntimeType)) {
          detectedRuntimes.push(runtime as RuntimeType);
        }
      });
    }

    // Fallback to project tools
    if (detectedRuntimes.length === 0 && currentProject.tools) {
      Object.keys(currentProject.tools).forEach(tool => {
        if (RuntimeRegistry.isSupported(tool as RuntimeType)) {
          detectedRuntimes.push(tool as RuntimeType);
        }
      });
    }

    return detectedRuntimes;
  }

  private async addServiceEnvironment(
    environment: Record<string, string>,
    currentProject: ProjectProfile,
    serviceName: string
  ): Promise<void> {
    const service = currentProject.services.find(s => s.name === serviceName);
    if (!service) {
      logger.warn(`Service '${serviceName}' not found in project`);
      return;
    }

    // Add service-specific environment variables
    if (service.environment) {
      Object.assign(environment, service.environment);
    }

    // Add service working directory if specified
    if (service.workingDirectory) {
      environment.SERVICE_WORKING_DIR = path.resolve(currentProject.path, service.workingDirectory);
    }

    // Add service port if specified
    if (service.port) {
      environment.SERVICE_PORT = service.port.toString();
    }
  }

  private buildProjectPaths(currentProject: ProjectProfile, currentPath: string): string {
    const projectPaths = [
      path.join(currentProject.path, 'node_modules', '.bin'),
      path.join(currentProject.path, 'bin'),
      path.join(currentProject.path, 'scripts'),
    ];

    // Filter existing paths
    const existingPaths = projectPaths.filter(p => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    });

    return [...existingPaths, currentPath].join(':');
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
    flags: ShellCommandFlags
  ): Promise<void> {
    logger.debug(`Running command: ${command}`);

    const shell = this.determineShell(flags);
    const child = spawn(shell, ['-c', command], {
      stdio: 'inherit',
      env: environment,
      cwd: environment.PROJECT_PATH,
    });

    return new Promise((resolve, reject) => {
      child.on('close', code => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command exited with code ${code}`));
        }
      });

      child.on('error', reject);
    });
  }

  private async startInteractiveShell(
    environment: Record<string, string>,
    flags: ShellCommandFlags,
    projectName: string
  ): Promise<void> {
    const shell = this.determineShell(flags);
    const promptIndicator = `(${projectName})`;

    // Setup shell prompt
    this.setupShellPrompt(environment, shell, promptIndicator);

    logger.debug(`Starting ${shell} with project environment`);

    const child = spawn(shell, [], {
      stdio: 'inherit',
      env: environment,
      cwd: environment.PROJECT_PATH,
    });

    return new Promise((resolve, reject) => {
      child.on('close', code => {
        this.log(chalk.blue(`\n👋 Exited project shell (code: ${code})`));
        resolve();
      });

      child.on('error', reject);
    });
  }

  private determineShell(flags: ShellCommandFlags): string {
    // Priority: flag > SHELL env var > default
    if (flags.shell) {
      return flags.shell;
    }

    return process.env.SHELL || '/bin/bash';
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
      runtime: [],
      project: [],
      system: [],
    };

    for (const [key, value] of Object.entries(environment)) {
      const maskedValue = this.maskSensitiveValue(key, value);

      if (this.isRuntimeVariable(key)) {
        groups.runtime.push({ key, value: maskedValue });
      } else if (this.isProjectVariable(key)) {
        groups.project.push({ key, value: maskedValue });
      } else {
        groups.system.push({ key, value: maskedValue });
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
    const sensitiveKeys = ['password', 'secret', 'key', 'token', 'api', 'auth'];

    if (sensitiveKeys.some(keyword => key.toLowerCase().includes(keyword))) {
      return value.length > 0 ? '*'.repeat(Math.min(value.length, 8)) : '';
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

  private getCacheDir(): string {
    const configManager = ConfigManager.getInstance();
    return configManager.getConfigDir();
  }
}
