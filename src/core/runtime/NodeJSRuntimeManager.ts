import * as path from 'path';
import * as fs from 'fs-extra';
import { RuntimeManager } from './RuntimeManager';
import { VersionManagerDetector } from './VersionManagerDetector';
import { RuntimeEnvironment, RuntimeInstallOptions, VersionManagerInfo } from '../../types/Runtime';
import { ProcessUtils } from '../../utils/ProcessUtils';
import { FileSystem } from '../../utils/FileSystem';

/**
 * Node.js runtime manager
 * Handles Node.js version installation, activation, and environment management
 */
export class NodeJSRuntimeManager extends RuntimeManager {
  private static readonly NODE_VERSION_FILE = '.nvmrc';
  private static readonly PACKAGE_JSON = 'package.json';

  constructor(projectPath: string, cacheDir: string) {
    super('nodejs', projectPath, cacheDir);
  }

  async getAvailableManagers(): Promise<VersionManagerInfo[]> {
    return VersionManagerDetector.detectManagers('nodejs');
  }

  async getBestManager(): Promise<VersionManagerInfo | null> {
    return VersionManagerDetector.getBestManager('nodejs');
  }

  async install(options: RuntimeInstallOptions): Promise<RuntimeEnvironment> {
    this.log('info', `Installing Node.js ${options.version}`);

    const manager = await this.getBestManager();
    if (!manager) {
      throw new Error('No Node.js version manager found. Please install nvm, fnm, or asdf.');
    }

    try {
      // Check if already installed
      if (options.skipIfExists && (await this.isInstalled(options.version))) {
        this.log('info', `Node.js ${options.version} already installed, skipping`);
        return this.getEnvironment(options.version);
      }

      // Install using the best available manager
      await this.installWithManager(manager, options.version);

      // Create project-specific environment
      await this.createProjectEnvironment();

      // Set up project-specific Node version
      await this.createNodeVersionFile(options.version);

      this.log('info', `Successfully installed Node.js ${options.version}`);
      return this.getEnvironment(options.version);
    } catch (error) {
      this.log('error', `Failed to install Node.js ${options.version}`, error);
      throw new Error(
        `Node.js installation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async isInstalled(version: string): Promise<boolean> {
    try {
      const manager = await this.getBestManager();
      if (!manager) return false;

      const installedVersions = await this.listInstalled();
      return installedVersions.some(env => env.version === version);
    } catch {
      return false;
    }
  }

  async getCurrentVersion(): Promise<RuntimeEnvironment | null> {
    try {
      // Check project-specific version first
      const projectVersion = await this.getProjectVersion();
      if (projectVersion) {
        return this.getEnvironment(projectVersion);
      }

      // Fall back to system version
      const result = await ProcessUtils.execute('node', ['--version']);
      const version = result.stdout.trim().replace('v', '');
      return this.getEnvironment(version);
    } catch {
      return null;
    }
  }

  async activate(version: string): Promise<void> {
    this.log('info', `Activating Node.js ${version}`);

    try {
      const manager = await this.getBestManager();
      if (!manager) {
        throw new Error('No Node.js version manager available');
      }

      // Activate version using manager
      await this.activateWithManager(manager, version);

      // Create/update project version file
      await this.createNodeVersionFile(version);

      // Install project dependencies if package.json exists
      await this.installProjectDependencies();

      this.log('info', `Successfully activated Node.js ${version}`);
    } catch (error) {
      this.log('error', `Failed to activate Node.js ${version}`, error);
      throw error;
    }
  }

  async listInstalled(): Promise<RuntimeEnvironment[]> {
    try {
      const manager = await this.getBestManager();
      if (!manager) return [];

      const versions = await this.getInstalledVersionsFromManager(manager);

      return Promise.all(versions.map(version => this.getEnvironment(version)));
    } catch (error) {
      this.log('warn', 'Failed to list installed Node.js versions', error);
      return [];
    }
  }

  async listAvailable(): Promise<string[]> {
    try {
      const manager = await this.getBestManager();
      if (!manager) return [];

      return this.getAvailableVersionsFromManager(manager);
    } catch (error) {
      this.log('warn', 'Failed to list available Node.js versions', error);
      return [];
    }
  }

  async uninstall(version: string): Promise<void> {
    this.log('info', `Uninstalling Node.js ${version}`);

    try {
      const manager = await this.getBestManager();
      if (!manager) {
        throw new Error('No Node.js version manager available');
      }

      await this.uninstallWithManager(manager, version);

      // Clean up project-specific environment if it exists
      await this.cleanupProjectEnvironment(version);

      this.log('info', `Successfully uninstalled Node.js ${version}`);
    } catch (error) {
      this.log('error', `Failed to uninstall Node.js ${version}`, error);
      throw error;
    }
  }

  async getEnvironmentVars(): Promise<Record<string, string>> {
    const currentVersion = await this.getCurrentVersion();
    if (!currentVersion) {
      return {};
    }

    const projectEnvDir = await this.createProjectEnvironment();
    const nodeModulesPath = path.join(this.projectPath, 'node_modules', '.bin');

    return {
      NODE_VERSION: currentVersion.version,
      NODE_PATH: path.join(projectEnvDir, 'node_modules'),
      PATH: `${currentVersion.binPath}:${nodeModulesPath}:${process.env.PATH}`,
      npm_config_prefix: projectEnvDir,
    };
  }

  // Private helper methods

  private async installWithManager(manager: VersionManagerInfo, version: string): Promise<void> {
    switch (manager.name) {
      case 'nvm':
        await ProcessUtils.execute('bash', [
          '-c',
          `source ~/.nvm/nvm.sh && nvm install ${version}`,
        ]);
        break;
      case 'fnm':
        await ProcessUtils.execute('fnm', ['install', version]);
        break;
      case 'asdf':
        await ProcessUtils.execute('asdf', ['plugin', 'add', 'nodejs']);
        await ProcessUtils.execute('asdf', ['install', 'nodejs', version]);
        break;
      case 'volta':
        await ProcessUtils.execute('volta', ['install', `node@${version}`]);
        break;
      case 'n':
        await ProcessUtils.execute('n', [version]);
        break;
      default:
        throw new Error(`Unsupported Node.js version manager: ${manager.name}`);
    }
  }

  private async activateWithManager(manager: VersionManagerInfo, version: string): Promise<void> {
    switch (manager.name) {
      case 'nvm':
        await ProcessUtils.execute('bash', ['-c', `source ~/.nvm/nvm.sh && nvm use ${version}`]);
        break;
      case 'fnm':
        await ProcessUtils.execute('fnm', ['use', version]);
        break;
      case 'asdf':
        await ProcessUtils.execute('asdf', ['local', 'nodejs', version]);
        break;
      case 'volta':
        // Volta automatically uses the version from package.json or .node-version
        break;
      case 'n':
        await ProcessUtils.execute('n', [version]);
        break;
      default:
        throw new Error(`Unsupported Node.js version manager: ${manager.name}`);
    }
  }

  private async getInstalledVersionsFromManager(manager: VersionManagerInfo): Promise<string[]> {
    try {
      let result: { stdout: string };

      switch (manager.name) {
        case 'nvm':
          result = await ProcessUtils.execute('bash', ['-c', 'source ~/.nvm/nvm.sh && nvm list']);
          return this.parseNvmVersions(result.stdout);
        case 'fnm':
          result = await ProcessUtils.execute('fnm', ['list']);
          return this.parseFnmVersions(result.stdout);
        case 'asdf':
          result = await ProcessUtils.execute('asdf', ['list', 'nodejs']);
          return this.parseAsdfVersions(result.stdout);
        case 'volta':
          result = await ProcessUtils.execute('volta', ['list', 'node']);
          return this.parseVoltaVersions(result.stdout);
        default:
          return [];
      }
    } catch {
      return [];
    }
  }

  private async getAvailableVersionsFromManager(manager: VersionManagerInfo): Promise<string[]> {
    try {
      let result: { stdout: string };

      switch (manager.name) {
        case 'nvm':
          result = await ProcessUtils.execute('bash', [
            '-c',
            'source ~/.nvm/nvm.sh && nvm list-remote --lts',
          ]);
          return this.parseNvmRemoteVersions(result.stdout);
        case 'fnm':
          result = await ProcessUtils.execute('fnm', ['list-remote']);
          return this.parseFnmRemoteVersions(result.stdout);
        case 'asdf':
          result = await ProcessUtils.execute('asdf', ['list-all', 'nodejs']);
          return this.parseAsdfRemoteVersions(result.stdout);
        default:
          return [];
      }
    } catch {
      return [];
    }
  }

  private async uninstallWithManager(manager: VersionManagerInfo, version: string): Promise<void> {
    switch (manager.name) {
      case 'nvm':
        await ProcessUtils.execute('bash', [
          '-c',
          `source ~/.nvm/nvm.sh && nvm uninstall ${version}`,
        ]);
        break;
      case 'fnm':
        await ProcessUtils.execute('fnm', ['uninstall', version]);
        break;
      case 'asdf':
        await ProcessUtils.execute('asdf', ['uninstall', 'nodejs', version]);
        break;
      default:
        throw new Error(`Uninstall not supported for ${manager.name}`);
    }
  }

  private async getEnvironment(version: string): Promise<RuntimeEnvironment> {
    const manager = await this.getBestManager();
    const runtimePath = await this.getRuntimePath(manager, version);
    const binPath = path.join(runtimePath, 'bin');
    const installedAt = await this.getInstallDate(version);

    const environment: RuntimeEnvironment = {
      type: 'nodejs',
      version,
      path: runtimePath,
      binPath,
      envVars: await this.getEnvironmentVars(),
      isActive: await this.isActiveVersion(version),
    };

    if (installedAt) {
      environment.installedAt = installedAt;
    }

    return environment;
  }

  private async getRuntimePath(
    manager: VersionManagerInfo | null,
    version: string
  ): Promise<string> {
    if (!manager) {
      // Fallback to system Node.js
      const result = await ProcessUtils.execute('which', ['node']);
      return path.dirname(path.dirname(result.stdout.trim()));
    }

    switch (manager.name) {
      case 'nvm':
        const nvmDir = process.env.NVM_DIR || path.join(process.env.HOME || '', '.nvm');
        return path.join(nvmDir, 'versions', 'node', `v${version}`);
      case 'fnm':
        const fnmDir = process.env.FNM_DIR || path.join(process.env.HOME || '', '.fnm');
        return path.join(fnmDir, 'node-versions', `v${version}`, 'installation');
      case 'asdf':
        const asdfDir = process.env.ASDF_DATA_DIR || path.join(process.env.HOME || '', '.asdf');
        return path.join(asdfDir, 'installs', 'nodejs', version);
      default:
        throw new Error(`Cannot determine runtime path for ${manager.name}`);
    }
  }

  private async isActiveVersion(version: string): Promise<boolean> {
    try {
      const current = await this.getCurrentVersion();
      return current?.version === version;
    } catch {
      return false;
    }
  }

  private async getInstallDate(version: string): Promise<Date | undefined> {
    try {
      const manager = await this.getBestManager();
      const runtimePath = await this.getRuntimePath(manager, version);
      const stats = await fs.stat(runtimePath);
      return stats.birthtime;
    } catch {
      return undefined;
    }
  }

  protected async createProjectEnvironment(): Promise<string> {
    const envDir = path.join(this.projectPath, '.switchr', 'runtime', 'nodejs');
    await FileSystem.ensureDirExists(envDir);
    return envDir;
  }

  private async createNodeVersionFile(version: string): Promise<void> {
    const versionFile = path.join(this.projectPath, NodeJSRuntimeManager.NODE_VERSION_FILE);
    await fs.writeFile(versionFile, version, 'utf8');
  }

  private async getProjectVersion(): Promise<string | null> {
    // Check .nvmrc first
    const nvmrcPath = path.join(this.projectPath, NodeJSRuntimeManager.NODE_VERSION_FILE);
    if (await fs.pathExists(nvmrcPath)) {
      const version = await fs.readFile(nvmrcPath, 'utf8');
      return version.trim();
    }

    // Check package.json engines.node
    const packageJsonPath = path.join(this.projectPath, NodeJSRuntimeManager.PACKAGE_JSON);
    if (await fs.pathExists(packageJsonPath)) {
      try {
        const packageJson = await fs.readJson(packageJsonPath);
        if (packageJson.engines?.node) {
          // Extract version from range (basic implementation)
          const nodeVersion = packageJson.engines.node.replace(/[^\d.]/g, '');
          return nodeVersion || null;
        }
      } catch {
        // Ignore JSON parse errors
      }
    }

    return null;
  }

  private async installProjectDependencies(): Promise<void> {
    const packageJsonPath = path.join(this.projectPath, NodeJSRuntimeManager.PACKAGE_JSON);

    if (await fs.pathExists(packageJsonPath)) {
      this.log('info', 'Installing project dependencies');

      try {
        // Detect package manager
        const packageManager = await this.detectPackageManager();
        await ProcessUtils.execute(packageManager, ['install'], { cwd: this.projectPath });

        this.log('info', 'Project dependencies installed successfully');
      } catch (error) {
        this.log('warn', 'Failed to install project dependencies', error);
      }
    }
  }

  private async detectPackageManager(): Promise<string> {
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

  private async cleanupProjectEnvironment(version: string): Promise<void> {
    const envDir = path.join(this.projectPath, '.switchr', 'runtime', 'nodejs', version);

    if (await fs.pathExists(envDir)) {
      await fs.remove(envDir);
      this.log('debug', `Cleaned up project environment for Node.js ${version}`);
    }
  }

  // Version parsing helpers
  private parseNvmVersions(output: string): string[] {
    return output
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.match(/v\d+\.\d+\.\d+/))
      .map(line => line.replace(/[^\d.]/g, ''));
  }

  private parseFnmVersions(output: string): string[] {
    return output
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.match(/\d+\.\d+\.\d+/))
      .map(line => line.replace(/[^\d.]/g, ''));
  }

  private parseAsdfVersions(output: string): string[] {
    return output
      .split('\n')
      .map(line => line.trim().replace('*', '').trim())
      .filter(line => line.match(/^\d+\.\d+\.\d+$/));
  }

  private parseVoltaVersions(output: string): string[] {
    return output
      .split('\n')
      .filter(line => line.includes('node'))
      .map(line => line.match(/\d+\.\d+\.\d+/)?.[0])
      .filter((version): version is string => !!version);
  }

  private parseNvmRemoteVersions(output: string): string[] {
    return output
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.match(/v\d+\.\d+\.\d+/))
      .map(line => line.replace(/[^\d.]/g, ''))
      .slice(0, 20); // Limit to recent versions
  }

  private parseFnmRemoteVersions(output: string): string[] {
    return output
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.match(/^\d+\.\d+\.\d+$/))
      .slice(0, 20); // Limit to recent versions
  }

  private parseAsdfRemoteVersions(output: string): string[] {
    return output
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.match(/^\d+\.\d+\.\d+$/))
      .slice(0, 20); // Limit to recent versions
  }
}
