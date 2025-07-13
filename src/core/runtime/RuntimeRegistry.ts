// src/core/runtime/RuntimeRegistry.ts - Complete implementation
import { RuntimeManager } from './RuntimeManager';
import { RuntimeType, VersionManagerInfo } from '../../types/Runtime';
import { logger } from '../../utils/Logger';

/**
 * Registry for all runtime managers
 * Provides factory pattern and auto-initialization
 */
export class RuntimeRegistry {
  private static managers = new Map<RuntimeType, typeof RuntimeManager>();
  private static instances = new Map<string, RuntimeManager>();
  private static initialized = false;

  /**
   * Initialize the registry with built-in runtime managers
   */
  static async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Dynamic imports to avoid circular dependencies
      const { NodeJSRuntimeManager } = await import('./NodeJSRuntimeManager');
      const { PythonRuntimeManager } = await import('./PythonRuntimeManager');
      const { GoRuntimeManager } = await import('./GoRuntimeManager');

      // Register built-in runtime managers
      this.register('nodejs', NodeJSRuntimeManager as any);
      this.register('python', PythonRuntimeManager as any);
      this.register('go', GoRuntimeManager as any);

      this.initialized = true;
      logger.debug(`Initialized RuntimeRegistry with ${this.managers.size} runtime managers`);
    } catch (error) {
      logger.error('Failed to initialize RuntimeRegistry', error);
      throw new Error('Runtime registry initialization failed');
    }
  }

  /**
   * Register a runtime manager class
   */
  static register(type: RuntimeType, managerClass: typeof RuntimeManager): void {
    this.managers.set(type, managerClass);
    logger.debug(`Registered runtime manager: ${type}`);
  }

  /**
   * Create or get cached runtime manager instance
   */
  static create(type: RuntimeType, projectPath: string, cacheDir: string): RuntimeManager {
    const cacheKey = `${type}:${projectPath}`;

    // Return cached instance if available
    if (this.instances.has(cacheKey)) {
      return this.instances.get(cacheKey)!;
    }

    const ManagerClass = this.managers.get(type);
    if (!ManagerClass) {
      throw new Error(`No runtime manager registered for type: ${type}`);
    }

    // Create new instance
    const manager = new ManagerClass(type, projectPath, cacheDir) as RuntimeManager;
    this.instances.set(cacheKey, manager);

    return manager;
  }

  /**
   * Get all registered runtime types
   */
  static getRegisteredTypes(): RuntimeType[] {
    return Array.from(this.managers.keys());
  }

  /**
   * Check if a runtime type is supported
   */
  static isSupported(type: string): type is RuntimeType {
    return this.managers.has(type as RuntimeType);
  }

  /**
   * Get available version managers for all runtimes
   */
  static async getAvailableManagers(): Promise<Record<RuntimeType, VersionManagerInfo[]>> {
    await this.ensureInitialized();

    const result: Record<string, VersionManagerInfo[]> = {};

    for (const type of this.getRegisteredTypes()) {
      try {
        const tempManager = this.create(type, process.cwd(), '/tmp');
        result[type] = await tempManager.getAvailableManagers();
      } catch (error) {
        logger.warn(`Failed to get managers for ${type}`, error);
        result[type] = [];
      }
    }

    return result as Record<RuntimeType, VersionManagerInfo[]>;
  }

  /**
   * Detect runtime type from project files
   */
  static async detectProjectRuntime(projectPath: string): Promise<RuntimeType[]> {
    const { FileSystem } = await import('../../utils/FileSystem');

    const detectedRuntimes: RuntimeType[] = [];
    const files = await FileSystem.getProjectFiles(projectPath);

    // Detection patterns
    const patterns: Record<RuntimeType, string[]> = {
      nodejs: ['package.json', 'yarn.lock', 'package-lock.json'],
      python: ['requirements.txt', 'setup.py', 'pyproject.toml', 'Pipfile'],
      go: ['go.mod', 'go.sum'],
      java: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
      rust: ['Cargo.toml', 'Cargo.lock'],
      php: ['composer.json', 'composer.lock'],
      ruby: ['Gemfile', 'Gemfile.lock'],
      dotnet: ['*.csproj', '*.sln', 'project.json'],
    };

    for (const [runtime, indicators] of Object.entries(patterns)) {
      const hasIndicator = indicators.some(indicator =>
        files.some(file => {
          if (indicator.includes('*')) {
            const pattern = indicator.replace('*', '.*');
            return new RegExp(pattern).test(file);
          }
          return file === indicator;
        })
      );

      if (hasIndicator && this.isSupported(runtime)) {
        detectedRuntimes.push(runtime as RuntimeType);
      }
    }

    return detectedRuntimes;
  }

  /**
   * Clear all cached instances
   */
  static clearCache(): void {
    this.instances.clear();
    logger.debug('Cleared runtime manager cache');
  }

  /**
   * Get system-wide runtime information
   */
  static async getSystemRuntimes(): Promise<Record<RuntimeType, string | null>> {
    const { ProcessUtils } = await import('../../utils/ProcessUtils');
    const result: Record<string, string | null> = {};

    const commands: Record<RuntimeType, string[]> = {
      nodejs: ['node', '--version'],
      python: ['python3', '--version'],
      go: ['go', 'version'],
      java: ['java', '-version'],
      rust: ['rustc', '--version'],
      php: ['php', '--version'],
      ruby: ['ruby', '--version'],
      dotnet: ['dotnet', '--version'],
    };

    for (const [runtime, command] of Object.entries(commands)) {
      try {
        const output = await ProcessUtils.execute(command[0], command.slice(1));
        result[runtime] = this.extractVersion(output.stdout || output.stderr);
      } catch {
        result[runtime] = null;
      }
    }

    return result as Record<RuntimeType, string | null>;
  }

  /**
   * Ensure registry is initialized
   */
  private static async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Extract version from command output
   */
  private static extractVersion(output: string): string | null {
    const versionRegex = /(\d+\.\d+\.\d+)/;
    const match = output.match(versionRegex);
    return match ? match[1] : null;
  }
}
