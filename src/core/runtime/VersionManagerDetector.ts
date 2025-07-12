import { ProcessUtils } from '../../utils/ProcessUtils';
import { VersionManagerInfo } from '../../types/Runtime';

/**
 * Detects and validates available version managers on the system
 */
export class VersionManagerDetector {
  private static cache = new Map<string, VersionManagerInfo[]>();

  /**
   * Detect all available version managers for a runtime type
   */
  static async detectManagers(runtimeType: string): Promise<VersionManagerInfo[]> {
    const cacheKey = runtimeType;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const managers = await this.getManagersForRuntime(runtimeType);
    const results: VersionManagerInfo[] = [];

    for (const manager of managers) {
      try {
        const available = await this.isManagerAvailable(manager.command);
        const version = available ? await this.getManagerVersion(manager.command) : undefined;

        results.push({
          ...manager,
          available,
          version,
        });
      } catch (error) {
        results.push({
          ...manager,
          available: false,
        });
      }
    }

    // Sort by priority (higher is better) and availability
    results.sort((a, b) => {
      if (a.available && !b.available) return -1;
      if (!a.available && b.available) return 1;
      return b.priority - a.priority;
    });

    this.cache.set(cacheKey, results);
    return results;
  }

  /**
   * Get the best available manager for a runtime
   */
  static async getBestManager(runtimeType: string): Promise<VersionManagerInfo | null> {
    const managers = await this.detectManagers(runtimeType);
    return managers.find(m => m.available) || null;
  }

  /**
   * Clear the detection cache
   */
  static clearCache(): void {
    this.cache.clear();
  }

  private static async getManagersForRuntime(
    runtimeType: string
  ): Promise<Omit<VersionManagerInfo, 'available' | 'version'>[]> {
    switch (runtimeType) {
      case 'nodejs':
        return [
          { name: 'fnm', command: 'fnm', priority: 10 },
          { name: 'nvm', command: 'nvm', priority: 9 },
          { name: 'asdf', command: 'asdf', priority: 8 },
          { name: 'volta', command: 'volta', priority: 7 },
          { name: 'n', command: 'n', priority: 6 },
        ];
      case 'python':
        return [
          { name: 'pyenv', command: 'pyenv', priority: 10 },
          { name: 'asdf', command: 'asdf', priority: 9 },
          { name: 'conda', command: 'conda', priority: 8 },
        ];
      case 'go':
        return [
          { name: 'g', command: 'g', priority: 10 },
          { name: 'asdf', command: 'asdf', priority: 9 },
        ];
      case 'java':
        return [
          { name: 'jenv', command: 'jenv', priority: 10 },
          { name: 'asdf', command: 'asdf', priority: 9 },
          { name: 'sdkman', command: 'sdk', priority: 8 },
        ];
      case 'rust':
        return [
          { name: 'rustup', command: 'rustup', priority: 10 },
          { name: 'asdf', command: 'asdf', priority: 9 },
        ];
      default:
        return [];
    }
  }

  private static async isManagerAvailable(command: string): Promise<boolean> {
    try {
      const isWindows = process.platform === 'win32';
      const whichCommand = isWindows ? 'where' : 'which';

      await ProcessUtils.execute(whichCommand, [command]);
      return true;
    } catch {
      return false;
    }
  }

  private static async getManagerVersion(command: string): Promise<string | undefined> {
    try {
      const result = await ProcessUtils.execute(command, ['--version']);
      // Extract version from output (basic implementation)
      const versionMatch = result.stdout.match(/(\d+\.\d+\.\d+)/);
      return versionMatch ? versionMatch[1] : undefined;
    } catch {
      return undefined;
    }
  }
}
