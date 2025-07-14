import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

// Global test configuration
jest.setTimeout(30000);

// Mock console to reduce noise in tests
const originalConsole = console;
beforeAll(() => {
  global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
});

afterAll(() => {
  global.console = originalConsole;
});

// Helper to create temporary test directories
export const createTempDir = async (): Promise<string> => {
  const tempDir = path.join(os.tmpdir(), 'switchr-test-' + Date.now());
  await fs.ensureDir(tempDir);
  return tempDir;
};

// Helper to clean up test directories
export const cleanupTempDir = async (dir: string): Promise<void> => {
  try {
    await fs.remove(dir);
  } catch (error) {
    // Ignore cleanup errors
  }
};

// Mock file system utilities for tests
export const createMockProject = async (
  tempDir: string,
  type: 'node' | 'python' | 'go' = 'node'
) => {
  const projectFiles: Record<string, any> = {
    node: {
      'package.json': {
        name: 'test-project',
        version: '1.0.0',
        scripts: {
          start: 'node index.js',
          dev: 'nodemon index.js',
        },
        dependencies: {
          express: '^4.18.0',
          react: '^18.0.0',
        },
        devDependencies: {
          '@types/node': '^20.0.0',
          typescript: '^5.0.0',
        },
      },
    },
    python: {
      'requirements.txt': 'django>=4.0.0\nrequests>=2.28.0\npytest>=7.0.0',
      'setup.py': 'from setuptools import setup\nsetup(name="test-project")',
      'main.py': 'print("Hello Python")',
    },
    go: {
      'go.mod': 'module test-project\n\ngo 1.21\n\nrequire github.com/gin-gonic/gin v1.9.0',
      'main.go': 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello Go")\n}',
    },
  };

  const files = projectFiles[type];
  for (const [filename, content] of Object.entries(files)) {
    const filePath = path.join(tempDir, filename);
    if (typeof content === 'object') {
      await fs.writeJson(filePath, content, { spaces: 2 });
    } else {
      await fs.writeFile(filePath, content as string);
    }
  }

  return tempDir;
};

// Helper to create mock switchr config
export const createMockSwitchrConfig = async (projectPath: string, config: any = {}) => {
  const defaultConfig = {
    name: 'test-project',
    type: 'node',
    environment: {
      NODE_ENV: 'development',
      PORT: '3000',
    },
    services: [],
    tools: {},
    ...config,
  };

  const configPath = path.join(projectPath, 'switchr.yml');
  await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2));
  return configPath;
};
