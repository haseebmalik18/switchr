import * as path from 'path';
import * as fs from 'fs-extra';
import * as crypto from 'crypto';
import { LockFile } from '../types/Package';
import { logger } from '../utils/Logger';

/**
 * Manages lock files for reproducible environments
 * Similar to package-lock.json but for entire development environment
 */
export class LockFileManager {
  private static readonly LOCK_FILE_NAME = 'switchr.lock';
  private static readonly LOCK_FILE_VERSION = 1;

  private projectPath: string;
  private lockFilePath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.lockFilePath = path.join(projectPath, LockFileManager.LOCK_FILE_NAME);
  }

  /**
   * Read existing lock file
   */
  async read(): Promise<LockFile | null> {
    try {
      if (!(await fs.pathExists(this.lockFilePath))) {
        return null;
      }

      const content = await fs.readFile(this.lockFilePath, 'utf8');
      const lockFile = JSON.parse(content) as LockFile;

      // Validate lock file version
      if (lockFile.lockfileVersion !== LockFileManager.LOCK_FILE_VERSION) {
        logger.warn(
          `Lock file version mismatch. Expected ${LockFileManager.LOCK_FILE_VERSION}, got ${lockFile.lockfileVersion}`
        );
      }

      return lockFile;
    } catch (error) {
      logger.error('Failed to read lock file', error);
      throw new Error(
        `Failed to read lock file: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Write lock file
   */
  async write(lockFile: LockFile): Promise<void> {
    try {
      lockFile.lockfileVersion = LockFileManager.LOCK_FILE_VERSION;
      lockFile.generated = new Date().toISOString();

      const content = JSON.stringify(lockFile, null, 2);
      await fs.writeFile(this.lockFilePath, content, 'utf8');

      logger.debug('Lock file updated successfully');
    } catch (error) {
      logger.error('Failed to write lock file', error);
      throw new Error(
        `Failed to write lock file: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Check if lock file exists
   */
  async exists(): Promise<boolean> {
    return fs.pathExists(this.lockFilePath);
  }

  /**
   * Validate lock file integrity
   */
  async validate(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    try {
      const lockFile = await this.read();
      if (!lockFile) {
        return { valid: false, errors: ['Lock file not found'] };
      }

      // Validate structure
      if (!lockFile.name) errors.push('Missing project name');
      if (!lockFile.switchrVersion) errors.push('Missing Switchr version');
      if (!lockFile.runtimes) errors.push('Missing runtimes section');
      if (!lockFile.packages) errors.push('Missing packages section');
      if (!lockFile.services) errors.push('Missing services section');

      // Validate runtime integrity
      for (const [name, runtime] of Object.entries(lockFile.runtimes)) {
        if (!runtime.version) errors.push(`Runtime ${name} missing version`);
        if (!runtime.resolved) errors.push(`Runtime ${name} missing resolved URL`);

        // Validate integrity if provided
        if (runtime.integrity && runtime.resolved) {
          const isValid = await this.validateIntegrity(runtime.resolved, runtime.integrity);
          if (!isValid) {
            errors.push(`Runtime ${name} integrity check failed`);
          }
        }
      }

      // Validate service integrity
      for (const [name, service] of Object.entries(lockFile.services)) {
        if (!service.template) errors.push(`Service ${name} missing template`);
        if (!service.version) errors.push(`Service ${name} missing version`);
      }

      return { valid: errors.length === 0, errors };
    } catch (error) {
      return {
        valid: false,
        errors: [`Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  /**
   * Generate integrity hash for a resource
   */
  async generateIntegrity(data: string | Buffer): Promise<string> {
    const hash = crypto.createHash('sha256');
    hash.update(data);
    return `sha256-${hash.digest('base64')}`;
  }

  /**
   * Validate integrity hash
   */
  async validateIntegrity(url: string, expectedIntegrity: string): Promise<boolean> {
    try {
      // This is a simplified implementation
      // In practice, you'd fetch the resource and validate its hash
      const [algorithm, hash] = expectedIntegrity.split('-');

      if (algorithm !== 'sha256') {
        logger.warn(`Unsupported integrity algorithm: ${algorithm}`);
        return false;
      }

      // For now, assume integrity is valid
      // TODO: Implement actual URL fetching and hash validation
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a backup of the current lock file
   */
  async backup(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${this.lockFilePath}.backup.${timestamp}`;

    if (await this.exists()) {
      await fs.copy(this.lockFilePath, backupPath);
      logger.debug(`Lock file backed up to: ${backupPath}`);
    }

    return backupPath;
  }

  /**
   * Restore from backup
   */
  async restore(backupPath: string): Promise<void> {
    if (!(await fs.pathExists(backupPath))) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }

    await fs.copy(backupPath, this.lockFilePath);
    logger.info(`Lock file restored from: ${backupPath}`);
  }

  /**
   * Get lock file statistics
   */
  async getStats(): Promise<{
    size: number;
    created: Date;
    modified: Date;
    runtimeCount: number;
    packageCount: number;
    serviceCount: number;
  }> {
    if (!(await this.exists())) {
      throw new Error('Lock file not found');
    }

    const stats = await fs.stat(this.lockFilePath);
    const lockFile = await this.read();

    return {
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      runtimeCount: lockFile ? Object.keys(lockFile.runtimes).length : 0,
      packageCount: lockFile ? Object.keys(lockFile.packages).length : 0,
      serviceCount: lockFile ? Object.keys(lockFile.services).length : 0,
    };
  }
}
