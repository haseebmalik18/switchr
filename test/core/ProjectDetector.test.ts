import { ProjectDetector } from '../../src/core/ProjectDetector';
import { createTempDir, cleanupTempDir, createMockProject } from '../setup';
import * as fs from 'fs-extra';
import * as path from 'path';

describe('ProjectDetector', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('detectProject', () => {
    it('should detect Node.js project correctly', async () => {
      const projectPath = await createMockProject(tempDir, 'node');

      const result = await ProjectDetector.detectProject(projectPath);

      expect(result.type).toBe('node');
      expect(result.confidence).toBeGreaterThan(0.8);
      expect(result.suggestedServices).toBeDefined();
      expect(result.suggestedTools).toBeDefined();
      expect(result.suggestedEnvironment).toBeDefined();
    });

    it('should detect Python project correctly', async () => {
      const projectPath = await createMockProject(tempDir, 'python');

      const result = await ProjectDetector.detectProject(projectPath);

      expect(result.type).toBe('python');
      expect(result.confidence).toBeGreaterThan(0.8);
      expect(result.suggestedEnvironment.PYTHONPATH).toBeDefined();
    });

    it('should detect Go project correctly', async () => {
      const projectPath = await createMockProject(tempDir, 'go');

      const result = await ProjectDetector.detectProject(projectPath);

      expect(result.type).toBe('go');
      expect(result.confidence).toBeGreaterThan(0.8);
      expect(result.suggestedEnvironment.GO_ENV).toBeDefined();
    });

    it('should suggest appropriate services for Node.js projects', async () => {
      const projectPath = await createMockProject(tempDir, 'node');

      const result = await ProjectDetector.detectProject(projectPath);

      expect(result.suggestedServices.length).toBeGreaterThan(0);
      // Should suggest database services for web projects
      const serviceNames = result.suggestedServices.map(s => s.name);
      expect(serviceNames).toContain('postgresql');
    });

    it('should suggest appropriate services for Python projects', async () => {
      const projectPath = await createMockProject(tempDir, 'python');

      const result = await ProjectDetector.detectProject(projectPath);

      expect(result.suggestedServices.length).toBeGreaterThan(0);
      const serviceNames = result.suggestedServices.map(s => s.name);
      expect(serviceNames).toContain('postgresql');
    });

    it('should handle projects with multiple indicators', async () => {
      // Create a project with both Node.js and Python files
      const projectPath = tempDir;
      await fs.writeJson(path.join(projectPath, 'package.json'), {
        name: 'mixed-project',
        dependencies: { express: '^4.0.0' },
      });
      await fs.writeFile(path.join(projectPath, 'requirements.txt'), 'django>=4.0.0');

      const result = await ProjectDetector.detectProject(projectPath);

      // Should detect the project with highest confidence
      expect(['node', 'python']).toContain(result.type);
      expect(result.confidence).toBeGreaterThan(0.7);
    });

    it('should default to generic for unknown projects', async () => {
      // Create a project with only a README
      await fs.writeFile(path.join(tempDir, 'README.md'), '# Unknown Project');

      const result = await ProjectDetector.detectProject(tempDir);

      expect(result.type).toBe('generic');
      expect(result.confidence).toBeLessThan(0.5);
    });

    it('should enhance Node.js detection for framework projects', async () => {
      const projectPath = tempDir;
      await fs.writeJson(path.join(projectPath, 'package.json'), {
        name: 'react-app',
        dependencies: {
          react: '^18.0.0',
          'react-dom': '^18.0.0',
        },
      });

      const result = await ProjectDetector.detectProject(projectPath);

      expect(result.type).toBe('node');
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it('should suggest environment variables based on project type', async () => {
      const nodeProject = await createMockProject(tempDir, 'node');
      const nodeResult = await ProjectDetector.detectProject(nodeProject);

      expect(nodeResult.suggestedEnvironment.NODE_ENV).toBe('development');
      expect(nodeResult.suggestedEnvironment.PORT).toBe('3000');

      const pythonDir = await createTempDir();
      const pythonProject = await createMockProject(pythonDir, 'python');
      const pythonResult = await ProjectDetector.detectProject(pythonProject);

      expect(pythonResult.suggestedEnvironment.PYTHONPATH).toBe(pythonProject);
      expect(pythonResult.suggestedEnvironment.FLASK_ENV).toBe('development');

      await cleanupTempDir(pythonDir);
    });

    it('should suggest appropriate tools for each project type', async () => {
      const nodeProject = await createMockProject(tempDir, 'node');
      const nodeResult = await ProjectDetector.detectProject(nodeProject);

      expect(nodeResult.suggestedTools.nodejs).toBeDefined();
      expect(nodeResult.suggestedTools.npm).toBeDefined();
    });
  });
});
