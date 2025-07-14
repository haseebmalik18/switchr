import * as fs from 'fs-extra';
import * as path from 'path';

export class FileSystem {
  static async findProjectRoot(startPath: string = process.cwd()): Promise<string | null> {
    const indicators = [
      'package.json',
      'requirements.txt',
      'pom.xml',
      'go.mod',
      'Cargo.toml',
      '.git',
      'switchr.yml',
    ];

    let currentPath = path.resolve(startPath);
    const root = path.parse(currentPath).root;

    while (currentPath !== root) {
      for (const indicator of indicators) {
        const indicatorPath = path.join(currentPath, indicator);
        if (await fs.pathExists(indicatorPath)) {
          return currentPath;
        }
      }
      currentPath = path.dirname(currentPath);
    }

    return null;
  }

  static async getProjectFiles(projectPath: string): Promise<string[]> {
    try {
      const files = await fs.readdir(projectPath);
      const fullPaths = await Promise.all(
        files.map(async file => {
          const filePath = path.join(projectPath, file);
          const stat = await fs.stat(filePath);
          return stat.isFile() ? file : null;
        })
      );

      return fullPaths.filter((file): file is string => file !== null);
    } catch (error) {
      throw new Error(
        `Failed to read project directory: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  static async isProjectDirectory(dirPath: string): Promise<boolean> {
    const projectIndicators = [
      'package.json',
      'requirements.txt',
      'pom.xml',
      'go.mod',
      'Cargo.toml',
      'composer.json',
      'build.gradle',
      'CMakeLists.txt',
    ];

    for (const indicator of projectIndicators) {
      if (await fs.pathExists(path.join(dirPath, indicator))) {
        return true;
      }
    }

    return false;
  }

  static async readJsonFile<T = unknown>(filePath: string): Promise<T | null> {
    try {
      if (!(await fs.pathExists(filePath))) {
        return null;
      }

      const content = await fs.readFile(filePath, 'utf8');
      return JSON.parse(content) as T;
    } catch (error) {
      throw new Error(
        `Failed to read JSON file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  static async writeJsonFile(filePath: string, data: unknown): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(filePath));
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
      throw new Error(
        `Failed to write JSON file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  static async ensureDirExists(dirPath: string): Promise<void> {
    try {
      await fs.ensureDir(dirPath);
    } catch (error) {
      throw new Error(
        `Failed to create directory ${dirPath}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  static async copyFile(source: string, destination: string): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(destination));
      await fs.copy(source, destination);
    } catch (error) {
      throw new Error(
        `Failed to copy file from ${source} to ${destination}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  static async deleteFile(filePath: string): Promise<void> {
    try {
      if (await fs.pathExists(filePath)) {
        await fs.remove(filePath);
      }
    } catch (error) {
      throw new Error(
        `Failed to delete file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  static async getFileSize(filePath: string): Promise<number> {
    try {
      const stats = await fs.stat(filePath);
      return stats.size;
    } catch (error) {
      throw new Error(
        `Failed to get file size for ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  static async isExecutable(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath, fs.constants.F_OK | fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  static normalizePath(inputPath: string): string {
    return path.resolve(path.normalize(inputPath));
  }

  static getRelativePath(from: string, to: string): string {
    return path.relative(from, to);
  }
}
