// src/core/runtime/GoRuntimeManager.ts - Professional Go runtime manager
import * as path from 'path';
import * as fs from 'fs-extra';
import { RuntimeManager } from './RuntimeManager';
import { VersionManagerDetector } from './VersionManagerDetector';
import { RuntimeEnvironment, RuntimeInstallOptions, VersionManagerInfo } from '../../types/Runtime';
import { ProcessUtils } from '../../utils/ProcessUtils';

export class GoRuntimeManager extends RuntimeManager {
  private static readonly GO_VERSION_FILE = '.go-version';
  private static readonly GO_MOD_FILE = 'go.mod';

  constructor(projectPath: string, cacheDir: string) {
    super('go', projectPath, cacheDir);
  }

  async getAvailableManagers(): Promise<VersionManagerInfo[]> {
    return VersionManagerDetector.detectManagers('go');
  }

  async getBestManager(): Promise<VersionManagerInfo | null> {
    return VersionManagerDetector.getBestManager('go');
  }

  async install(options: RuntimeInstallOptions): Promise<RuntimeEnvironment> {
    this.log('info', `Installing Go ${options.version}`);

    const manager = await this.getBestManager();
    if (!manager) {
      throw new Error('No Go version manager found. Please install g or asdf.');
    }

    try {
      if (options.skipIfExists && (await this.isInstalled(options.version))) {
        this.log('info', `Go ${options.version} already installed, skipping`);
        return this.getEnvironment(options.version);
      }

      await this.installWithManager(manager, options.version);
      await this.createProjectEnvironment();
      await this.createGoVersionFile(options.version);

      this.log('info', `Successfully installed Go ${options.version}`);
      return this.getEnvironment(options.version);
    } catch (error) {
      this.log('error', `Failed to install Go ${options.version}`, error);
      throw new Error(
        `Go installation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
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
      const projectVersion = await this.getProjectVersion();
      if (projectVersion) {
        return this.getEnvironment(projectVersion);
      }

      const result = await ProcessUtils.execute('go', ['version']);
      const versionMatch = result.stdout.match(/go(\d+\.\d+\.\d+)/);
      const version = versionMatch ? versionMatch[1] : null;

      return version ? this.getEnvironment(version) : null;
    } catch {
      return null;
    }
  }

  async activate(version: string): Promise<void> {
    this.log('info', `Activating Go ${version}`);

    try {
      const manager = await this.getBestManager();
      if (!manager) {
        throw new Error('No Go version manager available');
      }

      await this.activateWithManager(manager, version);
      await this.createGoVersionFile(version);
      await this.initializeGoModule();

      this.log('info', `Successfully activated Go ${version}`);
    } catch (error) {
      this.log('error', `Failed to activate Go ${version}`, error);
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
      this.log('warn', 'Failed to list installed Go versions', error);
      return [];
    }
  }

  async listAvailable(): Promise<string[]> {
    try {
      const manager = await this.getBestManager();
      if (!manager) return [];

      return this.getAvailableVersionsFromManager(manager);
    } catch (error) {
      this.log('warn', 'Failed to list available Go versions', error);
      return [];
    }
  }

  async uninstall(version: string): Promise<void> {
    this.log('info', `Uninstalling Go ${version}`);

    try {
      const manager = await this.getBestManager();
      if (!manager) {
        throw new Error('No Go version manager available');
      }

      await this.uninstallWithManager(manager, version);

      this.log('info', `Successfully uninstalled Go ${version}`);
    } catch (error) {
      this.log('error', `Failed to uninstall Go ${version}`, error);
      throw error;
    }
  }

  async getEnvironmentVars(): Promise<Record<string, string>> {
    const currentVersion = await this.getCurrentVersion();
    if (!currentVersion) {
      return {};
    }

    return {
      GO_VERSION: currentVersion.version,
      GOROOT: currentVersion.path,
      GOPATH: path.join(this.projectPath, '.go'),
      PATH: `${currentVersion.binPath}:${process.env.PATH}`,
    };
  }

  // Private implementation methods
  private async installWithManager(manager: VersionManagerInfo, version: string): Promise<void> {
    switch (manager.name) {
      case 'g':
        await ProcessUtils.execute('g', ['install', version]);
        break;
      case 'asdf':
        await ProcessUtils.execute('asdf', ['plugin', 'add', 'golang']);
        await ProcessUtils.execute('asdf', ['install', 'golang', version]);
        break;
      default:
        throw new Error(`Unsupported Go version manager: ${manager.name}`);
    }
  }

  private async activateWithManager(manager: VersionManagerInfo, version: string): Promise<void> {
    switch (manager.name) {
      case 'g':
        await ProcessUtils.execute('g', ['use', version]);
        break;
      case 'asdf':
        await ProcessUtils.execute('asdf', ['local', 'golang', version]);
        break;
      default:
        throw new Error(`Unsupported Go version manager: ${manager.name}`);
    }
  }

  private async getInstalledVersionsFromManager(manager: VersionManagerInfo): Promise<string[]> {
    try {
      let result: { stdout: string };

      switch (manager.name) {
        case 'g':
          result = await ProcessUtils.execute('g', ['list']);
          return result.stdout
            .split('\n')
            .filter(v => v.trim())
            .map(v => v.trim());
        case 'asdf':
          result = await ProcessUtils.execute('asdf', ['list', 'golang']);
          return result.stdout
            .split('\n')
            .map(v => v.trim())
            .filter(v => v && !v.startsWith('*'));
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
        case 'asdf':
          result = await ProcessUtils.execute('asdf', ['list-all', 'golang']);
          return result.stdout
            .split('\n')
            .filter(line => line.trim().match(/^\d+\.\d+\.\d+$/))
            .slice(0, 20);
        default:
          return [];
      }
    } catch {
      return [];
    }
  }

  private async uninstallWithManager(manager: VersionManagerInfo, version: string): Promise<void> {
    switch (manager.name) {
      case 'g':
        await ProcessUtils.execute('g', ['uninstall', version]);
        break;
      case 'asdf':
        await ProcessUtils.execute('asdf', ['uninstall', 'golang', version]);
        break;
      default:
        throw new Error(`Uninstall not supported for ${manager.name}`);
    }
  }

  private async getEnvironment(version: string): Promise<RuntimeEnvironment> {
    const manager = await this.getBestManager();
    const runtimePath = await this.getRuntimePath(manager, version);
    const binPath = path.join(runtimePath, 'bin');

    return {
      type: 'go',
      version,
      path: runtimePath,
      binPath,
      envVars: await this.getEnvironmentVars(),
      isActive: await this.isActiveVersion(version),
      ...(manager && { manager: manager.name }),
    };
  }

  private async getRuntimePath(
    manager: VersionManagerInfo | null,
    version: string
  ): Promise<string> {
    if (!manager) {
      const result = await ProcessUtils.execute('which', ['go']);
      return path.dirname(path.dirname(result.stdout.trim()));
    }

    switch (manager.name) {
      case 'g':
        const gRoot = process.env.G_HOME || path.join(process.env.HOME || '', '.g');
        return path.join(gRoot, 'versions', version);
      case 'asdf':
        const asdfDir = process.env.ASDF_DATA_DIR || path.join(process.env.HOME || '', '.asdf');
        return path.join(asdfDir, 'installs', 'golang', version);
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

  private async createGoVersionFile(version: string): Promise<void> {
    const versionFile = path.join(this.projectPath, GoRuntimeManager.GO_VERSION_FILE);
    await fs.writeFile(versionFile, version, 'utf8');
  }

  private async getProjectVersion(): Promise<string | null> {
    // Check .go-version first
    const versionFilePath = path.join(this.projectPath, GoRuntimeManager.GO_VERSION_FILE);
    if (await fs.pathExists(versionFilePath)) {
      const version = await fs.readFile(versionFilePath, 'utf8');
      return version.trim();
    }

    // Check go.mod for Go version directive
    const goModPath = path.join(this.projectPath, GoRuntimeManager.GO_MOD_FILE);
    if (await fs.pathExists(goModPath)) {
      try {
        const content = await fs.readFile(goModPath, 'utf8');
        const versionMatch = content.match(/go\s+(\d+\.\d+(?:\.\d+)?)/);
        if (versionMatch) {
          return versionMatch[1];
        }
      } catch {
        // Ignore parsing errors
      }
    }

    return null;
  }

  private async initializeGoModule(): Promise<void> {
    const goModPath = path.join(this.projectPath, GoRuntimeManager.GO_MOD_FILE);

    if (!(await fs.pathExists(goModPath))) {
      this.log('info', 'Initializing Go module');
      const projectName = path.basename(this.projectPath);
      await ProcessUtils.execute('go', ['mod', 'init', projectName], { cwd: this.projectPath });
    } else {
      // Ensure dependencies are up to date
      this.log('info', 'Updating Go dependencies');
      await ProcessUtils.execute('go', ['mod', 'tidy'], { cwd: this.projectPath });
    }
  }
}
