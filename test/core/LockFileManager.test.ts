import { LockFileManager } from '../../src/core/LockFileManager';
import { createTempDir, cleanupTempDir } from '../setup';
import * as fs from 'fs-extra';
import * as path from 'path';

describe('LockFileManager', () => {
  let tempDir: string;
  let lockFileManager: LockFileManager;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lockFileManager = new LockFileManager(tempDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('constructor', () => {
    it('should initialize with project path', () => {
      expect(lockFileManager).toBeDefined();
    });
  });

  describe('exists', () => {
    it('should return true when lock file exists', async () => {
      const lockFilePath = path.join(tempDir, 'switchr.lock');
      await fs.writeFile(lockFilePath, '{}');

      const exists = await lockFileManager.exists();

      expect(exists).toBe(true);
    });

    it('should return false when lock file does not exist', async () => {
      const exists = await lockFileManager.exists();

      expect(exists).toBe(false);
    });
  });

  describe('read', () => {
    it('should read existing lock file', async () => {
      const mockLockContent = {
        lockfileVersion: 1,
        name: 'test-project',
        generated: new Date().toISOString(),
        switchrVersion: '0.1.0',
        runtimes: {},
        packages: {},
        services: {},
      };

      const lockFilePath = path.join(tempDir, 'switchr.lock');
      await fs.writeJson(lockFilePath, mockLockContent);

      const loadedLockFile = await lockFileManager.read();

      expect(loadedLockFile).toBeDefined();
      expect(loadedLockFile?.lockfileVersion).toBe(1);
      expect(loadedLockFile?.generated).toBeDefined();
    });

    it('should return null for non-existent lock file', async () => {
      const loadedLockFile = await lockFileManager.read();

      expect(loadedLockFile).toBeNull();
    });

    it('should handle corrupted lock file gracefully', async () => {
      const lockFilePath = path.join(tempDir, 'switchr.lock');
      await fs.writeFile(lockFilePath, 'invalid json content');

      const loadedLockFile = await lockFileManager.read();

      expect(loadedLockFile).toBeNull();
    });
  });

  describe('write', () => {
    it('should write lock file to disk', async () => {
      const mockLockFile = {
        lockfileVersion: 1,
        name: 'test-project',
        generated: new Date().toISOString(),
        switchrVersion: '0.1.0',
        runtimes: {
          nodejs: {
            version: '18.17.0',
            resolved: 'https://nodejs.org/dist/v18.17.0/node-v18.17.0-linux-x64.tar.gz',
            integrity: 'sha512-mock',
          },
        },
        packages: {
          express: {
            version: '4.18.0',
            runtime: 'nodejs',
            resolved: 'https://registry.npmjs.org/express/-/express-4.18.0.tgz',
            integrity: 'sha512-mock',
            dependencies: [],
          },
        },
        services: {},
      };

      await lockFileManager.write(mockLockFile);

      const lockFilePath = path.join(tempDir, 'switchr.lock');
      expect(await fs.pathExists(lockFilePath)).toBe(true);

      const savedContent = await fs.readJson(lockFilePath);
      expect(savedContent.lockfileVersion).toBe(1);
      expect(Object.keys(savedContent.packages)).toHaveLength(1);
    });

    it('should create nested directories if they do not exist', async () => {
      const nestedDir = path.join(tempDir, 'nested', 'path');
      const nestedLockManager = new LockFileManager(nestedDir);

      const mockLockFile = {
        lockfileVersion: 1,
        name: 'nested-project',
        generated: new Date().toISOString(),
        switchrVersion: '0.1.0',
        runtimes: {},
        packages: {},
        services: {},
      };

      await nestedLockManager.write(mockLockFile);

      const lockFilePath = path.join(nestedDir, 'switchr.lock');
      expect(await fs.pathExists(lockFilePath)).toBe(true);
    });
  });

  describe('delete', () => {
    it('should remove existing lock file', async () => {
      const lockFilePath = path.join(tempDir, 'switchr.lock');
      await fs.writeFile(lockFilePath, '{}');

      await lockFileManager.delete();

      expect(await fs.pathExists(lockFilePath)).toBe(false);
    });

    it('should not throw error when removing non-existent lock file', async () => {
      await expect(lockFileManager.delete()).resolves.not.toThrow();
    });
  });

  describe('validate', () => {
    it('should validate existing lock file', async () => {
      const validLockFile = {
        lockfileVersion: 1,
        name: 'test-project',
        generated: new Date().toISOString(),
        switchrVersion: '0.1.0',
        runtimes: {},
        packages: {},
        services: {},
      };

      const lockFilePath = path.join(tempDir, 'switchr.lock');
      await fs.writeJson(lockFilePath, validLockFile);

      const validation = await lockFileManager.validate();

      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);
    });

    it('should detect invalid lock file', async () => {
      const invalidLockFile = {
        // missing required fields
        packages: {},
      };

      const lockFilePath = path.join(tempDir, 'switchr.lock');
      await fs.writeJson(lockFilePath, invalidLockFile);

      const validation = await lockFileManager.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });

    it('should handle non-existent lock file', async () => {
      const validation = await lockFileManager.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });
  });

  describe('static factory method', () => {
    it('should create lock file from project data', async () => {
      const lockFile = await LockFileManager.createFromProject(
        tempDir,
        'test-project',
        { nodejs: '18.17.0' },
        [
          {
            name: 'express',
            version: '4.18.0',
            runtime: 'nodejs',
          },
        ],
        []
      );

      expect(lockFile).toBeDefined();
      expect(lockFile.runtimes.nodejs.version).toBe('18.17.0');
      expect(Object.keys(lockFile.packages)).toHaveLength(1);
      expect(lockFile.packages.express.version).toBe('4.18.0');
      expect(lockFile.generated).toBeDefined();
      expect(lockFile.switchrVersion).toBeDefined();
    });

    it('should handle empty project data', async () => {
      const lockFile = await LockFileManager.createFromProject(
        tempDir,
        'empty-project',
        {},
        [],
        []
      );

      expect(lockFile).toBeDefined();
      expect(Object.keys(lockFile.runtimes)).toHaveLength(0);
      expect(lockFile.packages).toEqual({});
      expect(lockFile.services).toEqual({});
    });
  });

  describe('integrity validation', () => {
    it('should validate file integrity', async () => {
      // Create a test file with known content
      const testFilePath = path.join(tempDir, 'test.txt');
      const content = 'Hello, World!';
      await fs.writeFile(testFilePath, content);

      // Calculate expected hash
      const crypto = require('crypto');
      const expectedHash = crypto.createHash('sha256').update(content).digest('hex');
      const integrity = `sha256-${Buffer.from(expectedHash, 'hex').toString('base64')}`;

      const isValid = await lockFileManager.validateIntegrity(`file://${testFilePath}`, integrity);

      expect(isValid).toBe(true);
    });

    it('should reject invalid integrity', async () => {
      const testFilePath = path.join(tempDir, 'test.txt');
      await fs.writeFile(testFilePath, 'Hello, World!');

      const invalidIntegrity = 'sha256-invalidhash';

      const isValid = await lockFileManager.validateIntegrity(
        `file://${testFilePath}`,
        invalidIntegrity
      );

      expect(isValid).toBe(false);
    });
  });

  describe('workflow integration', () => {
    it('should support complete read-write cycle', async () => {
      const originalLockFile = {
        lockfileVersion: 1,
        name: 'test-project',
        generated: new Date().toISOString(),
        switchrVersion: '0.1.0',
        runtimes: {
          nodejs: {
            version: '18.17.0',
            resolved: 'https://nodejs.org/dist/v18.17.0/node-v18.17.0-linux-x64.tar.gz',
            integrity: 'sha512-mock',
          },
          python: {
            version: '3.9.0',
            resolved: 'https://python.org/downloads/release/python-390/',
            integrity: 'sha512-mock',
          },
        },
        packages: {
          express: {
            version: '4.18.0',
            runtime: 'nodejs',
            resolved: 'https://registry.npmjs.org/express/-/express-4.18.0.tgz',
            integrity: 'sha512-mock',
            dependencies: [],
          },
        },
        services: {},
      };

      // Write
      await lockFileManager.write(originalLockFile);

      // Read
      const readLockFile = await lockFileManager.read();

      // Verify
      expect(readLockFile).toBeDefined();
      expect(readLockFile?.runtimes.nodejs.version).toBe('18.17.0');
      expect(Object.keys(readLockFile?.packages || {})).toHaveLength(1);
      expect(readLockFile?.packages.express.version).toBe('4.18.0');

      // Validate
      const validation = await lockFileManager.validate();
      expect(validation.valid).toBe(true);

      // Delete
      await lockFileManager.delete();
      expect(await lockFileManager.exists()).toBe(false);
    });
  });
});
