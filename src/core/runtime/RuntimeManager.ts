import {
  RuntimeType,
  RuntimeVersion,
  RuntimeEnvironment,
  RuntimeInstallOptions,
} from '../../types/Runtime';
import { logger } from '../../utils/Logger';

/**
 * Abstract base class for all runtime managers
 * Provides consistent interface for Node.js, Python, Go, etc.
 */
export abstract class RuntimeManager {
  protected type: RuntimeType;
  protected projectPath: string;
  protected cacheDir: string;

  constructor(type: RuntimeType, projectPath: string, cacheDir: string) {
    this.type = type;
    this.projectPath = projectPath;
    this.cacheDir = cacheDir;
  }

  /**
   * Get all available version managers for this runtime
   */
  abstract getAvailableManagers(): Promise<VersionManagerInfo[]>;

  /**
   * Get the best available version manager
   */
  abstract getBestManager(): Promise<VersionManagerInfo | null>;

  /**
   * Install a specific version of the runtime
   */
  abstract install(options: RuntimeInstallOptions): Promise<RuntimeEnvironment>;

  /**
   * Check if a version is already installed
   */
  abstract isInstalled(version: string): Promise<boolean>;

  /**
   * Get the currently active version
   */
  abstract getCurrentVersion(): Promise<RuntimeEnvironment | null>;

  /**
   * Set a specific version as active for the project
   */
  abstract activate(version: string): Promise<void>;

  /**
   * List all installed versions
   */
  abstract listInstalled(): Promise<RuntimeEnvironment[]>;

  /**
   * List all available versions from remote
   */
  abstract listAvailable(): Promise<string[]>;

  /**
   * Uninstall a specific version
   */
  abstract uninstall(version: string): Promise<void>;

  /**
   * Get environment variables for the active version
   */
  abstract getEnvironmentVars(): Promise<Record<string, string>>;

  /**
   * Validate version string format
   */
  protected parseVersion(versionStr: string): RuntimeVersion {
    const semverRegex =
      /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
    const match = versionStr.match(semverRegex);

    if (!match) {
      throw new Error(`Invalid version format: ${versionStr}`);
    }

    return {
      version: versionStr,
      major: parseInt(match[1], 10),
      minor: parseInt(match[2], 10),
      patch: parseInt(match[3], 10),
      prerelease: match[4],
      build: match[5],
    };
  }

  /**
   * Check if version satisfies a range (basic implementation)
   */
  protected satisfiesRange(version: string, range: string): boolean {
    // Basic implementation - can be enhanced with proper semver library
    if (range.startsWith('^')) {
      const targetVersion = this.parseVersion(range.slice(1));
      const currentVersion = this.parseVersion(version);

      return (
        currentVersion.major === targetVersion.major &&
        (currentVersion.minor > targetVersion.minor ||
          (currentVersion.minor === targetVersion.minor &&
            currentVersion.patch >= targetVersion.patch))
      );
    }

    if (range.startsWith('~')) {
      const targetVersion = this.parseVersion(range.slice(1));
      const currentVersion = this.parseVersion(version);

      return (
        currentVersion.major === targetVersion.major &&
        currentVersion.minor === targetVersion.minor &&
        currentVersion.patch >= targetVersion.patch
      );
    }

    return version === range;
  }

  /**
   * Create project-specific environment directory
   */
  protected async createProjectEnvironment(): Promise<string> {
    const envDir = `${this.projectPath}/.switchr/runtime/${this.type}`;
    const { FileSystem } = await import('../../utils/FileSystem');
    await FileSystem.ensureDirExists(envDir);
    return envDir;
  }

  /**
   * Log runtime manager activity
   */
  protected log(level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: any): void {
    logger[level](`[${this.type.toUpperCase()}] ${message}`, meta);
  }
}
