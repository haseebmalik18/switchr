import { FileSystem } from '../../src/utils/FileSystem';
import { createTempDir, cleanupTempDir, createMockProject } from '../setup';
import * as fs from 'fs-extra';
import * as path from 'path';

describe('FileSystem', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('findProjectRoot', () => {
    it('should find project root with package.json', async () => {
      await createMockProject(tempDir, 'node');
      const subDir = path.join(tempDir, 'src', 'components');
      await fs.ensureDir(subDir);

      const projectRoot = await FileSystem.findProjectRoot(subDir);

      expect(projectRoot).toBe(tempDir);
    });

    it('should find project root with switchr.yml', async () => {
      await fs.writeFile(path.join(tempDir, 'switchr.yml'), 'name: test-project');
      const subDir = path.join(tempDir, 'src');
      await fs.ensureDir(subDir);

      const projectRoot = await FileSystem.findProjectRoot(subDir);

      expect(projectRoot).toBe(tempDir);
    });

    it('should find project root with .git directory', async () => {
      await fs.ensureDir(path.join(tempDir, '.git'));
      const subDir = path.join(tempDir, 'deep', 'nested', 'dir');
      await fs.ensureDir(subDir);

      const projectRoot = await FileSystem.findProjectRoot(subDir);

      expect(projectRoot).toBe(tempDir);
    });

    it('should return null when no project indicators found', async () => {
      const projectRoot = await FileSystem.findProjectRoot(tempDir);

      expect(projectRoot).toBeNull();
    });
  });

  describe('readJsonFile', () => {
    it('should read valid JSON file', async () => {
      const jsonPath = path.join(tempDir, 'test.json');
      const testData = { name: 'test', version: '1.0.0' };
      await fs.writeJson(jsonPath, testData);

      const result = await FileSystem.readJsonFile(jsonPath);

      expect(result).toEqual(testData);
    });

    it('should return null for non-existent file', async () => {
      const result = await FileSystem.readJsonFile(path.join(tempDir, 'nonexistent.json'));

      expect(result).toBeNull();
    });

    it('should throw error for invalid JSON', async () => {
      const jsonPath = path.join(tempDir, 'invalid.json');
      await fs.writeFile(jsonPath, '{ invalid json }');

      await expect(FileSystem.readJsonFile(jsonPath)).rejects.toThrow();
    });
  });

  describe('writeJsonFile', () => {
    it('should write JSON file successfully', async () => {
      const jsonPath = path.join(tempDir, 'output.json');
      const testData = { name: 'test', version: '1.0.0' };

      await FileSystem.writeJsonFile(jsonPath, testData);

      expect(await fs.pathExists(jsonPath)).toBe(true);
      const content = await fs.readJson(jsonPath);
      expect(content).toEqual(testData);
    });

    it('should create directory if it does not exist', async () => {
      const subDir = path.join(tempDir, 'nested', 'dir');
      const jsonPath = path.join(subDir, 'test.json');
      const testData = { test: true };

      await FileSystem.writeJsonFile(jsonPath, testData);

      expect(await fs.pathExists(jsonPath)).toBe(true);
      expect(await fs.pathExists(subDir)).toBe(true);
    });
  });

  describe('copyFile', () => {
    it('should copy file successfully', async () => {
      const sourcePath = path.join(tempDir, 'source.txt');
      const destPath = path.join(tempDir, 'dest.txt');
      const content = 'Hello, World!';

      await fs.writeFile(sourcePath, content);
      await FileSystem.copyFile(sourcePath, destPath);

      expect(await fs.pathExists(destPath)).toBe(true);
      const copiedContent = await fs.readFile(destPath, 'utf8');
      expect(copiedContent).toBe(content);
    });
  });

  describe('ensureDirExists', () => {
    it('should create directory if it does not exist', async () => {
      const dirPath = path.join(tempDir, 'new', 'nested', 'directory');

      await FileSystem.ensureDirExists(dirPath);

      expect(await fs.pathExists(dirPath)).toBe(true);
      const stats = await fs.stat(dirPath);
      expect(stats.isDirectory()).toBe(true);
    });

    it('should not fail if directory already exists', async () => {
      const dirPath = path.join(tempDir, 'existing');
      await fs.ensureDir(dirPath);

      await expect(FileSystem.ensureDirExists(dirPath)).resolves.not.toThrow();
    });
  });

  describe('deleteFile', () => {
    it('should remove existing file', async () => {
      const filePath = path.join(tempDir, 'to-remove.txt');
      await fs.writeFile(filePath, 'content');

      await FileSystem.deleteFile(filePath);

      expect(await fs.pathExists(filePath)).toBe(false);
    });

    it('should not fail when removing non-existent file', async () => {
      const filePath = path.join(tempDir, 'non-existent.txt');

      await expect(FileSystem.deleteFile(filePath)).resolves.not.toThrow();
    });
  });

  describe('getProjectFiles', () => {
    it('should list all files in project directory', async () => {
      await createMockProject(tempDir, 'node');
      await fs.writeFile(path.join(tempDir, 'README.md'), '# Test Project');
      await fs.writeFile(path.join(tempDir, '.gitignore'), 'node_modules/');

      const files = await FileSystem.getProjectFiles(tempDir);

      expect(files).toContain('package.json');
      expect(files).toContain('README.md');
      expect(files).toContain('.gitignore');
    });

    it('should handle empty directory', async () => {
      const files = await FileSystem.getProjectFiles(tempDir);

      expect(files).toEqual([]);
    });
  });

  describe('isProjectDirectory', () => {
    it('should return true for Node.js project', async () => {
      await createMockProject(tempDir, 'node');

      const isProject = await FileSystem.isProjectDirectory(tempDir);

      expect(isProject).toBe(true);
    });

    it('should return true for Python project', async () => {
      await createMockProject(tempDir, 'python');

      const isProject = await FileSystem.isProjectDirectory(tempDir);

      expect(isProject).toBe(true);
    });

    it('should return false for non-project directory', async () => {
      const isProject = await FileSystem.isProjectDirectory(tempDir);

      expect(isProject).toBe(false);
    });
  });

  describe('utility methods', () => {
    it('should normalize paths correctly', () => {
      const normalized = FileSystem.normalizePath('some\\path\\with\\backslashes');

      expect(normalized).toBe('some/path/with/backslashes');
    });

    it('should get relative paths correctly', () => {
      const relativePath = FileSystem.getRelativePath('/base/path', '/base/path/sub/file.txt');

      expect(relativePath).toBe('sub/file.txt');
    });

    it('should get file size', async () => {
      const filePath = path.join(tempDir, 'test-file.txt');
      const content = 'Hello World!';
      await fs.writeFile(filePath, content);

      const size = await FileSystem.getFileSize(filePath);

      expect(size).toBe(content.length);
    });
  });
});
