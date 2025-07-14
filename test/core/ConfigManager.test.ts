import { ConfigManager } from '../../src/core/ConfigManager';
import {
  createTempDir,
  cleanupTempDir,
  createMockProject,
  createMockSwitchrConfig,
} from '../setup';
import * as fs from 'fs-extra';
import * as path from 'path';

describe('ConfigManager', () => {
  let tempDir: string;
  let configManager: ConfigManager;

  beforeEach(async () => {
    tempDir = await createTempDir();
    configManager = ConfigManager.getInstance();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('getInstance', () => {
    it('should return a singleton instance', () => {
      const instance1 = ConfigManager.getInstance();
      const instance2 = ConfigManager.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('addProject', () => {
    it('should add a new project profile', async () => {
      const projectPath = await createMockProject(tempDir, 'node');
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

      const retrievedProfile = await configManager.getProject('test-project');
      expect(retrievedProfile).toBeDefined();
      expect(retrievedProfile?.name).toBe('test-project');
      expect(retrievedProfile?.type).toBe('node');
    });

    it('should save project config to switchr.yml file', async () => {
      const projectPath = await createMockProject(tempDir, 'node');
      const profile = {
        name: 'test-project',
        path: projectPath,
        type: 'node' as const,
        environment: {},
        services: [],
        tools: {},
        createdAt: new Date().toISOString(),
      };

      await configManager.addProject(projectPath, profile);

      const configPath = path.join(projectPath, 'switchr.yml');
      expect(await fs.pathExists(configPath)).toBe(true);
    });
  });

  describe('loadProjectConfig', () => {
    it('should load existing project configuration', async () => {
      const projectPath = await createMockProject(tempDir, 'node');
      await createMockSwitchrConfig(projectPath, {
        name: 'existing-project',
        type: 'python',
        environment: { PYTHON_ENV: 'test' },
      });

      const config = await configManager.loadProjectConfig(projectPath);
      expect(config).toBeDefined();
      expect(config?.name).toBe('existing-project');
      expect(config?.type).toBe('python');
      expect(config?.environment?.PYTHON_ENV).toBe('test');
    });

    it('should return null for non-existent configuration', async () => {
      const config = await configManager.loadProjectConfig(tempDir);
      expect(config).toBeNull();
    });
  });

  describe('removeProject', () => {
    it('should remove project from global registry', async () => {
      const projectPath = await createMockProject(tempDir, 'node');
      const profile = {
        name: 'removable-project',
        path: projectPath,
        type: 'node' as const,
        environment: {},
        services: [],
        tools: {},
        createdAt: new Date().toISOString(),
      };

      await configManager.addProject(projectPath, profile);
      expect(await configManager.getProject('removable-project')).toBeDefined();

      await configManager.removeProject('removable-project');
      expect(await configManager.getProject('removable-project')).toBeNull();
    });
  });

  describe('getAllProjects', () => {
    it('should return empty array when no projects exist', async () => {
      const projects = await configManager.getAllProjects();
      expect(projects).toEqual([]);
    });

    it('should return all registered projects', async () => {
      const projectPath1 = await createMockProject(tempDir, 'node');
      const projectPath2 = path.join(tempDir, 'project2');
      await createMockProject(projectPath2, 'python');

      const profile1 = {
        name: 'project1',
        path: projectPath1,
        type: 'node' as const,
        environment: {},
        services: [],
        tools: {},
        createdAt: new Date().toISOString(),
      };

      const profile2 = {
        name: 'project2',
        path: projectPath2,
        type: 'python' as const,
        environment: {},
        services: [],
        tools: {},
        createdAt: new Date().toISOString(),
      };

      await configManager.addProject(projectPath1, profile1);
      await configManager.addProject(projectPath2, profile2);

      const projects = await configManager.getAllProjects();
      expect(projects.length).toBe(2);
    });
  });

  describe('currentProject management', () => {
    it('should set and get current project', async () => {
      const projectPath = await createMockProject(tempDir, 'node');
      const profile = {
        name: 'current-project',
        path: projectPath,
        type: 'node' as const,
        environment: {},
        services: [],
        tools: {},
        createdAt: new Date().toISOString(),
      };

      await configManager.addProject(projectPath, profile);
      await configManager.setCurrentProject('current-project');

      const currentProject = await configManager.getCurrentProject();
      expect(currentProject?.name).toBe('current-project');
    });

    it('should return null when no current project is set', async () => {
      const currentProject = await configManager.getCurrentProject();
      expect(currentProject).toBeNull();
    });
  });

  describe('saveProjectConfig', () => {
    it('should save project configuration to file', async () => {
      const projectPath = await createMockProject(tempDir, 'node');
      const profile = {
        name: 'save-test',
        path: projectPath,
        type: 'node' as const,
        environment: { NODE_ENV: 'test' },
        services: [],
        tools: {},
        createdAt: new Date().toISOString(),
      };

      await configManager.saveProjectConfig(projectPath, profile);

      const configPath = path.join(projectPath, 'switchr.yml');
      expect(await fs.pathExists(configPath)).toBe(true);

      const savedConfig = await configManager.loadProjectConfig(projectPath);
      expect(savedConfig?.name).toBe('save-test');
      expect(savedConfig?.environment?.NODE_ENV).toBe('test');
    });
  });
});
