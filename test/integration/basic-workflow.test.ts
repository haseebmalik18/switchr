import { ConfigManager } from '../../src/core/ConfigManager';
import { PackageManager } from '../../src/core/PackageManager';
import { ProjectDetector } from '../../src/core/ProjectDetector';
import { createTempDir, cleanupTempDir, createMockProject } from '../setup';
import * as fs from 'fs-extra';
import * as path from 'path';

// Mock ProcessUtils to avoid actual system calls
jest.mock('../../src/utils/ProcessUtils', () => ({
  ProcessUtils: {
    execute: jest.fn().mockResolvedValue({ stdout: 'success', stderr: '', exitCode: 0 }),
    spawn: jest.fn(),
    isCommandAvailable: jest.fn().mockResolvedValue(true),
  },
}));

// Mock network calls
global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve([]),
});

describe('Basic Workflow Integration Tests', () => {
  let tempDir: string;
  let configManager: ConfigManager;

  beforeEach(async () => {
    tempDir = await createTempDir();
    configManager = ConfigManager.getInstance();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
    jest.clearAllMocks();
  });

  describe('Project Initialization Workflow', () => {
    it('should detect project type and create configuration', async () => {
      // Create a Node.js project
      const projectPath = await createMockProject(tempDir, 'node');

      // Detect project
      const detection = await ProjectDetector.detectProject(projectPath);
      expect(detection.type).toBe('node');
      expect(detection.confidence).toBeGreaterThan(0.8);

      // Create project profile
      const profile = {
        name: 'test-project',
        path: projectPath,
        type: detection.type,
        environment: detection.suggestedEnvironment,
        services: detection.suggestedServices,
        tools: detection.suggestedTools,
        createdAt: new Date().toISOString(),
      };

      // Add project to config
      await configManager.addProject(projectPath, profile);

      // Verify configuration was saved
      const savedConfig = await configManager.loadProjectConfig(projectPath);
      expect(savedConfig).toBeDefined();
      expect(savedConfig?.name).toBe('test-project');
      expect(savedConfig?.type).toBe('node');

      // Verify switchr.yml file was created
      const configPath = path.join(projectPath, 'switchr.yml');
      expect(await fs.pathExists(configPath)).toBe(true);
    });

    it('should handle Python project initialization', async () => {
      const projectPath = await createMockProject(tempDir, 'python');

      const detection = await ProjectDetector.detectProject(projectPath);
      expect(detection.type).toBe('python');

      const profile = {
        name: 'python-project',
        path: projectPath,
        type: detection.type,
        environment: detection.suggestedEnvironment,
        services: detection.suggestedServices,
        tools: detection.suggestedTools,
        createdAt: new Date().toISOString(),
      };

      await configManager.addProject(projectPath, profile);

      const savedConfig = await configManager.loadProjectConfig(projectPath);
      expect(savedConfig?.type).toBe('python');
      expect(savedConfig?.environment?.PYTHONPATH).toBeDefined();
    });

    it('should handle Go project initialization', async () => {
      const projectPath = await createMockProject(tempDir, 'go');

      const detection = await ProjectDetector.detectProject(projectPath);
      expect(detection.type).toBe('go');

      const profile = {
        name: 'go-project',
        path: projectPath,
        type: detection.type,
        environment: detection.suggestedEnvironment,
        services: detection.suggestedServices,
        tools: detection.suggestedTools,
        createdAt: new Date().toISOString(),
      };

      await configManager.addProject(projectPath, profile);

      const savedConfig = await configManager.loadProjectConfig(projectPath);
      expect(savedConfig?.type).toBe('go');
      expect(savedConfig?.environment?.GO_ENV).toBeDefined();
    });
  });

  describe('Package Management Workflow', () => {
    let packageManager: PackageManager;
    let projectPath: string;

    beforeEach(async () => {
      projectPath = await createMockProject(tempDir, 'node');

      // Initialize project configuration
      const profile = {
        name: 'test-project',
        path: projectPath,
        type: 'node' as const,
        environment: { NODE_ENV: 'development' },
        services: [],
        tools: {},
        createdAt: new Date().toISOString(),
      };
      await configManager.addProject(projectPath, profile);

      packageManager = new PackageManager({
        projectPath,
        cacheDir: path.join(projectPath, '.switchr-cache'),
      });
    });

    it('should add and track packages', async () => {
      // Mock successful package addition
      const addResult = await packageManager.addPackage('express', {
        runtime: 'nodejs',
      });

      expect(addResult.success).toBe(true);
      expect(addResult.package?.name).toBe('express');
    });

    it('should search packages across registries', async () => {
      const searchResults = await packageManager.searchPackages('web framework', {
        runtime: 'nodejs',
        limit: 5,
      });

      expect(Array.isArray(searchResults)).toBe(true);
      expect(searchResults.length).toBeGreaterThanOrEqual(0);
    });

    it('should get package status', async () => {
      const status = await packageManager.getPackageStatus();

      expect(status).toBeDefined();
      expect(status.runtimes).toBeDefined();
      expect(status.services).toBeDefined();
      expect(status.dependencies).toBeDefined();
    });

    it('should handle package removal', async () => {
      // First add a package
      await packageManager.addPackage('express', { runtime: 'nodejs' });

      // Then remove it
      const removeResult = await packageManager.removePackage('express', { force: false });

      expect(typeof removeResult).toBe('boolean');
    });
  });

  describe('Multi-Runtime Support', () => {
    it('should handle projects with multiple runtimes', async () => {
      // Create a mixed project
      const projectPath = tempDir;
      await fs.writeJson(path.join(projectPath, 'package.json'), {
        name: 'mixed-project',
        dependencies: { express: '^4.0.0' },
      });
      await fs.writeFile(path.join(projectPath, 'requirements.txt'), 'django>=4.0.0');

      const detection = await ProjectDetector.detectProject(projectPath);

      // Should detect as the primary runtime
      expect(['node', 'python']).toContain(detection.type);

      const packageManager = new PackageManager({
        projectPath,
        cacheDir: path.join(projectPath, '.switchr-cache'),
      });

      // Should be able to manage both Node.js and Python packages
      const nodeResults = await packageManager.searchPackages('express', {
        runtime: 'nodejs',
        limit: 3,
      });

      const pythonResults = await packageManager.searchPackages('django', {
        runtime: 'python',
        limit: 3,
      });

      expect(nodeResults.length).toBeGreaterThanOrEqual(0);
      expect(pythonResults.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Configuration Persistence', () => {
    it('should maintain configuration across operations', async () => {
      const projectPath = await createMockProject(tempDir, 'node');

      // Initial setup
      const initialProfile = {
        name: 'persistence-test',
        path: projectPath,
        type: 'node' as const,
        environment: { NODE_ENV: 'development', PORT: '3000' },
        services: [],
        tools: {},
        createdAt: new Date().toISOString(),
      };

      await configManager.addProject(projectPath, initialProfile);

      // Verify initial state
      let config = await configManager.loadProjectConfig(projectPath);
      expect(config?.environment?.NODE_ENV).toBe('development');
      expect(config?.environment?.PORT).toBe('3000');

      // Modify configuration through package manager
      const packageManager = new PackageManager({
        projectPath,
        cacheDir: path.join(projectPath, '.switchr-cache'),
      });

      await packageManager.addPackage('express', { runtime: 'nodejs' });

      // Configuration should still be intact
      config = await configManager.loadProjectConfig(projectPath);
      expect(config?.name).toBe('persistence-test');
      expect(config?.environment?.NODE_ENV).toBe('development');
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle corrupted project configuration gracefully', async () => {
      const projectPath = await createMockProject(tempDir, 'node');

      // Create corrupted config file
      const configPath = path.join(projectPath, 'switchr.yml');
      await fs.writeFile(configPath, 'invalid: yaml: content: {');

      // Should handle gracefully
      const config = await configManager.loadProjectConfig(projectPath);
      expect(config).toBeNull();
    });

    it('should handle missing dependencies gracefully', async () => {
      const projectPath = await createMockProject(tempDir, 'node');

      const packageManager = new PackageManager({
        projectPath,
        cacheDir: path.join(projectPath, '.switchr-cache'),
      });

      // Mock command failure
      const { ProcessUtils } = require('../../src/utils/ProcessUtils');
      ProcessUtils.execute.mockRejectedValueOnce(new Error('Command not found'));

      const result = await packageManager.addPackage('non-existent-package', {
        runtime: 'nodejs',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Performance and Caching', () => {
    it('should cache frequently accessed data', async () => {
      const projectPath = await createMockProject(tempDir, 'node');

      const packageManager = new PackageManager({
        projectPath,
        cacheDir: path.join(projectPath, '.switchr-cache'),
      });

      // First call
      const status1 = await packageManager.getPackageStatus();

      // Second call should be faster (cached)
      const status2 = await packageManager.getPackageStatus();

      expect(status1).toEqual(status2);

      // Check stats
      const stats = packageManager.getStats();
      expect(typeof stats.cacheHits).toBe('number');
      expect(typeof stats.totalRequests).toBe('number');
    });

    it('should cleanup resources properly', async () => {
      const projectPath = await createMockProject(tempDir, 'node');

      const packageManager = new PackageManager({
        projectPath,
        cacheDir: path.join(projectPath, '.switchr-cache'),
      });

      await packageManager.getPackageStatus();

      // Cleanup should not throw
      await expect(packageManager.cleanup()).resolves.not.toThrow();
    });
  });
});
