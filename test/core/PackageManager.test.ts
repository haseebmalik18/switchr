import { PackageManager } from '../../src/core/PackageManager';
import { createTempDir, cleanupTempDir, createMockProject } from '../setup';
import * as fs from 'fs-extra';
import * as path from 'path';

// Mock ProcessUtils to avoid actually executing commands
jest.mock('../../src/utils/ProcessUtils', () => ({
  ProcessUtils: {
    execute: jest.fn().mockResolvedValue({ stdout: 'mocked output', stderr: '', exitCode: 0 }),
    spawn: jest.fn(),
    isCommandAvailable: jest.fn().mockResolvedValue(true),
  },
}));

describe('PackageManager', () => {
  let tempDir: string;
  let packageManager: PackageManager;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await createMockProject(tempDir, 'node');

    packageManager = new PackageManager({
      projectPath: tempDir,
      cacheDir: path.join(tempDir, '.cache'),
    });
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with project path and cache directory', () => {
      expect(packageManager).toBeDefined();
    });
  });

  describe('addPackage', () => {
    it('should add a dependency package', async () => {
      const result = await packageManager.addPackage('express', {
        runtime: 'nodejs',
      });

      expect(result.success).toBe(true);
      expect(result.package?.name).toBe('express');
    });

    it('should add a runtime package with version', async () => {
      const result = await packageManager.addPackage('nodejs@18.17.0', {
        runtime: 'nodejs',
      });

      expect(result.success).toBe(true);
      expect(result.package?.name).toBe('nodejs');
    });

    it('should add service package', async () => {
      const result = await packageManager.addPackage('postgresql', {
        runtime: 'nodejs',
      });

      expect(result.success).toBe(true);
      expect(result.package?.name).toBe('postgresql');
    });

    it('should handle package installation errors gracefully', async () => {
      const { ProcessUtils } = require('../../src/utils/ProcessUtils');
      ProcessUtils.execute.mockRejectedValueOnce(new Error('Installation failed'));

      const result = await packageManager.addPackage('invalid-package', {
        runtime: 'nodejs',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Installation failed');
    });
  });

  describe('removePackage', () => {
    it('should remove an existing package', async () => {
      // First add a package
      await packageManager.addPackage('express', {
        runtime: 'nodejs',
      });

      const result = await packageManager.removePackage('express', {
        force: false,
      });

      expect(result).toBe(true);
    });

    it('should handle removal of non-existent package gracefully', async () => {
      const result = await packageManager.removePackage('non-existent', {
        force: false,
      });

      expect(result).toBe(false);
    });
  });

  describe('searchPackages', () => {
    it('should search for packages across registries', async () => {
      const results = await packageManager.searchPackages('express', {
        runtime: 'nodejs',
        limit: 10,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toContain('express');
      expect(results[0].runtime).toBe('nodejs');
    });

    it('should search Python packages', async () => {
      const pythonDir = await createTempDir();
      await createMockProject(pythonDir, 'python');
      const pythonPackageManager = new PackageManager({
        projectPath: pythonDir,
        cacheDir: path.join(pythonDir, '.cache'),
      });

      const results = await pythonPackageManager.searchPackages('django', {
        runtime: 'python',
        limit: 5,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toContain('django');
      expect(results[0].runtime).toBe('python');

      await cleanupTempDir(pythonDir);
    });

    it('should return fallback results when search fails', async () => {
      // Mock network failure
      jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Network error'));

      const results = await packageManager.searchPackages('react', {
        runtime: 'nodejs',
        limit: 5,
      });

      // Should still return some fallback results
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('updatePackage', () => {
    it('should update a specific package', async () => {
      // Add a package first
      await packageManager.addPackage('express', { runtime: 'nodejs' });

      const result = await packageManager.updatePackage('express');

      expect(result.success).toBe(true);
      expect(result.package?.name).toBe('express');
    });

    it('should update package to specific version', async () => {
      await packageManager.addPackage('express', { runtime: 'nodejs' });

      const result = await packageManager.updatePackage('express', '4.18.0');

      expect(result.success).toBe(true);
      expect(result.package?.version).toBe('4.18.0');
    });
  });

  describe('getPackageStatus', () => {
    it('should get project package status', async () => {
      const status = await packageManager.getPackageStatus();

      expect(status).toBeDefined();
      expect(status.runtimes).toBeDefined();
      expect(status.services).toBeDefined();
      expect(status.dependencies).toBeDefined();
      expect(Array.isArray(status.runtimes)).toBe(true);
      expect(Array.isArray(status.services)).toBe(true);
      expect(Array.isArray(status.dependencies)).toBe(true);
    });
  });

  describe('installAll', () => {
    it('should install all packages from project configuration', async () => {
      // Create a project config with packages
      const projectConfigPath = path.join(tempDir, 'switchr.yml');
      const config = {
        name: 'test-project',
        type: 'node',
        packages: {
          runtimes: {
            nodejs: '18.17.0',
          },
          dependencies: [
            {
              name: 'express',
              version: '^4.18.0',
              runtime: 'nodejs',
            },
          ],
          services: [
            {
              name: 'postgresql',
              version: '15',
            },
          ],
        },
      };

      await fs.writeJson(projectConfigPath, config);

      const results = await packageManager.installAll();

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
    });

    it('should return empty array when no packages defined', async () => {
      const results = await packageManager.installAll();

      expect(results).toEqual([]);
    });
  });

  describe('isPackageInstalled', () => {
    it('should check if dependency package is installed', async () => {
      const packageDef = {
        name: 'express',
        type: 'dependency' as const,
        runtime: 'nodejs' as const,
        version: '4.18.0',
      };

      const isInstalled = await packageManager.isPackageInstalled(packageDef);

      expect(typeof isInstalled).toBe('boolean');
    });
  });

  describe('cleanup', () => {
    it('should cleanup resources', async () => {
      await expect(packageManager.cleanup()).resolves.not.toThrow();
    });
  });

  describe('getStats', () => {
    it('should return performance statistics', () => {
      const stats = packageManager.getStats();

      expect(stats).toBeDefined();
      expect(typeof stats.cacheHits).toBe('number');
      expect(typeof stats.totalRequests).toBe('number');
      expect(typeof stats.averageResponseTime).toBe('number');
    });
  });
});
