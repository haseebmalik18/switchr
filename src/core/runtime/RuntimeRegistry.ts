// src/core/runtime/RuntimeRegistry.ts - Fixed implementation
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
}
