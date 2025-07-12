import { RuntimeManager } from './RuntimeManager';
import { RuntimeType } from '../../types/Runtime';

/**
 * Registry for all runtime managers
 * Provides factory pattern for creating runtime managers
 */
export class RuntimeRegistry {
  private static managers = new Map<RuntimeType, typeof RuntimeManager>();

  /**
   * Register a runtime manager class
   */
  static register(type: RuntimeType, managerClass: typeof RuntimeManager): void {
    this.managers.set(type, managerClass);
  }

  /**
   * Create a runtime manager instance
   */
  static create(type: RuntimeType, projectPath: string, cacheDir: string): RuntimeManager {
    const ManagerClass = this.managers.get(type);

    if (!ManagerClass) {
      throw new Error(`No runtime manager registered for type: ${type}`);
    }

    return new ManagerClass(type, projectPath, cacheDir) as RuntimeManager;
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
}
