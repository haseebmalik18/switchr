// src/core/runtime/RuntimeRegistry.ts - Complete implementation with all missing methods
import { RuntimeManager } from './RuntimeManager';
import { RuntimeType, VersionManagerInfo } from '../../types/Runtime';
import { logger } from '../../utils/Logger';

// Define the constructor type for runtime managers
interface RuntimeManagerConstructor {
  new (projectPath: string, cacheDir: string): RuntimeManager;
}

/**
 * Registry for all runtime managers
 * Provides factory pattern and auto-initialization
 */
export class RuntimeRegistry {
  private static managers = new Map<RuntimeType, RuntimeManagerConstructor>();
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
      this.register('nodejs', NodeJSRuntimeManager as RuntimeManagerConstructor);
      this.register('python', PythonRuntimeManager as RuntimeManagerConstructor);
      this.register('go', GoRuntimeManager as RuntimeManagerConstructor);

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
  static register(type: RuntimeType, managerClass: RuntimeManagerConstructor): void {
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
    const manager = new ManagerClass(projectPath, cacheDir);
    this.instances.set(cacheKey, manager);

    return manager;
  }

  /**
   * Check if a runtime type is supported
   */
  static isSupported(type: string): type is RuntimeType {
    return this.managers.has(type as RuntimeType);
  }

  /**
   * Get all registered runtime types
   */
  static getRegisteredTypes(): RuntimeType[] {
    return Array.from(this.managers.keys());
  }

  /**
   * Detect project runtime from files and configuration
   */
  static async detectProjectRuntime(projectPath: string): Promise<RuntimeType[]> {
    const { FileSystem } = await import('../../utils/FileSystem');
    const detected: RuntimeType[] = [];

    try {
      const files = await FileSystem.getProjectFiles(projectPath);

      // Node.js detection
      if (files.includes('package.json')) {
        detected.push('nodejs');
      }

      // Python detection
      if (
        files.some(
          f =>
            f === 'requirements.txt' ||
            f === 'setup.py' ||
            f === 'pyproject.toml' ||
            f === 'Pipfile' ||
            f.endsWith('.py')
        )
      ) {
        detected.push('python');
      }

      // Go detection
      if (files.includes('go.mod') || files.includes('go.sum')) {
        detected.push('go');
      }

      // Java detection
      if (
        files.includes('pom.xml') ||
        files.some(f => f.includes('build.gradle')) ||
        files.some(f => f.endsWith('.java'))
      ) {
        detected.push('java');
      }

      // Rust detection
      if (files.includes('Cargo.toml') || files.includes('Cargo.lock')) {
        detected.push('rust');
      }

      // PHP detection
      if (files.includes('composer.json') || files.some(f => f.endsWith('.php'))) {
        detected.push('php');
      }

      // Ruby detection
      if (files.includes('Gemfile') || files.some(f => f.endsWith('.rb'))) {
        detected.push('ruby');
      }

      return detected;
    } catch (error) {
      logger.debug('Failed to detect project runtime', error);
      return [];
    }
  }

  /**
   * Get runtime manager by type (without creating instance)
   */
  static getManager(type: RuntimeType): RuntimeManagerConstructor | null {
    return this.managers.get(type) || null;
  }

  /**
   * Check if runtime is installed on system
   */
  static async isRuntimeInstalled(type: RuntimeType, version?: string): Promise<boolean> {
    try {
      if (!this.isSupported(type)) return false;

      // Use a temporary instance to check installation
      const tempManager = this.create(type, '/tmp', '/tmp');

      if (version) {
        return await tempManager.isInstalled(version);
      } else {
        const current = await tempManager.getCurrentVersion();
        return current !== null;
      }
    } catch {
      return false;
    }
  }

  /**
   * Get available version managers for a runtime
   */
  static async getAvailableManagers(type: RuntimeType): Promise<VersionManagerInfo[]> {
    try {
      if (!this.isSupported(type)) return [];

      const tempManager = this.create(type, '/tmp', '/tmp');
      return await tempManager.getAvailableManagers();
    } catch {
      return [];
    }
  }

  /**
   * Clear all cached instances
   */
  static clearCache(): void {
    this.instances.clear();
    logger.debug('Cleared runtime manager cache');
  }

  /**
   * Get registry statistics
   */
  static getStats(): {
    registeredManagers: number;
    cachedInstances: number;
    supportedTypes: RuntimeType[];
  } {
    return {
      registeredManagers: this.managers.size,
      cachedInstances: this.instances.size,
      supportedTypes: this.getRegisteredTypes(),
    };
  }

  /**
   * Validate registry state
   */
  static validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.initialized) {
      errors.push('Registry not initialized');
    }

    if (this.managers.size === 0) {
      errors.push('No runtime managers registered');
    }

    // Check that all registered managers are valid constructors
    for (const [type, ManagerClass] of this.managers) {
      try {
        if (typeof ManagerClass !== 'function') {
          errors.push(`Invalid manager class for runtime: ${type}`);
        }
      } catch (error) {
        errors.push(`Failed to validate manager for ${type}: ${error}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Unregister a runtime manager
   */
  static unregister(type: RuntimeType): boolean {
    const removed = this.managers.delete(type);

    if (removed) {
      // Clear any cached instances for this type
      const keysToRemove = Array.from(this.instances.keys()).filter(key =>
        key.startsWith(`${type}:`)
      );

      keysToRemove.forEach(key => this.instances.delete(key));

      logger.debug(`Unregistered runtime manager: ${type}`);
    }

    return removed;
  }
}
