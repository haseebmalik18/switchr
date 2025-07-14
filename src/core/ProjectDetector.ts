import * as fs from 'fs-extra';
import * as path from 'path';
import { ProjectType, ProjectDetectionResult, Service, ToolVersions } from '../types/Project';
import { FileSystem } from '../utils/FileSystem';
import { logger } from '../utils/Logger';

interface ProjectIndicator {
  files: string[];
  type: ProjectType;
  confidence: number;
}

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: {
    node?: string;
    npm?: string;
  };
}

export class ProjectDetector {
  private static readonly PROJECT_INDICATORS: ProjectIndicator[] = [
    { files: ['package.json'], type: 'node', confidence: 0.9 },
    { files: ['requirements.txt', 'setup.py', 'pyproject.toml'], type: 'python', confidence: 0.9 },
    { files: ['pom.xml'], type: 'java', confidence: 0.9 },
    { files: ['build.gradle', 'build.gradle.kts'], type: 'java', confidence: 0.8 },
    { files: ['go.mod', 'go.sum'], type: 'go', confidence: 0.9 },
    { files: ['Cargo.toml'], type: 'rust', confidence: 0.9 },
    { files: ['composer.json'], type: 'generic', confidence: 0.7 },
    { files: ['Makefile', 'CMakeLists.txt'], type: 'generic', confidence: 0.6 },
  ];

  static async detectProject(projectPath: string): Promise<ProjectDetectionResult> {
    logger.debug(`Detecting project type in: ${projectPath}`);

    const projectFiles = await FileSystem.getProjectFiles(projectPath);
    const detectedType = await this.detectProjectType(projectPath, projectFiles);

    const suggestedServices = await this.suggestServices(projectPath, detectedType, projectFiles);
    const suggestedTools = await this.suggestTools(projectPath, detectedType);
    const suggestedEnvironment = await this.suggestEnvironment(projectPath, detectedType);

    const result: ProjectDetectionResult = {
      type: detectedType.type,
      suggestedServices,
      suggestedTools,
      suggestedEnvironment,
      confidence: detectedType.confidence,
    };

    logger.info(
      `Detected ${detectedType.type} project with ${Math.round(detectedType.confidence * 100)}% confidence`
    );
    return result;
  }

  private static async detectProjectType(
    projectPath: string,
    projectFiles: string[]
  ): Promise<{ type: ProjectType; confidence: number }> {
    let bestMatch: { type: ProjectType; confidence: number } = {
      type: 'generic',
      confidence: 0.1,
    };

    for (const indicator of this.PROJECT_INDICATORS) {
      const matchingFiles = indicator.files.filter(file => projectFiles.includes(file));

      if (matchingFiles.length > 0) {
        // Use full confidence if any indicator file is found
        // Bonus for having multiple indicator files
        const confidence = indicator.confidence + (matchingFiles.length - 1) * 0.05;

        if (confidence > bestMatch.confidence) {
          bestMatch = { type: indicator.type, confidence };
        }
      }
    }

    if (bestMatch.type === 'node') {
      const enhancedMatch = await this.enhanceNodeDetection(projectPath, bestMatch);
      return enhancedMatch;
    }

    return bestMatch;
  }

  private static async enhanceNodeDetection(
    projectPath: string,
    baseMatch: { type: ProjectType; confidence: number }
  ): Promise<{ type: ProjectType; confidence: number }> {
    try {
      const packageJson = await FileSystem.readJsonFile<PackageJson>(
        path.join(projectPath, 'package.json')
      );

      if (!packageJson) return baseMatch;

      const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
      const frameworks = ['react', 'vue', 'angular', 'next', 'nuxt', 'express', 'fastify', 'nest'];

      const hasFramework = frameworks.some(framework =>
        Object.keys(dependencies).some(dep => dep.includes(framework))
      );

      if (hasFramework) {
        return { type: 'node', confidence: Math.min(baseMatch.confidence + 0.1, 1.0) };
      }

      return baseMatch;
    } catch (error) {
      logger.warn('Failed to enhance Node.js detection', error);
      return baseMatch;
    }
  }

  private static async suggestServices(
    projectPath: string,
    detectedType: { type: ProjectType; confidence: number },
    projectFiles: string[]
  ): Promise<Service[]> {
    const services: Service[] = [];

    switch (detectedType.type) {
      case 'node':
        services.push(...(await this.suggestNodeServices(projectPath)));
        break;
      case 'python':
        services.push(...(await this.suggestPythonServices(projectPath)));
        break;
      case 'java':
        services.push(...(await this.suggestJavaServices(projectPath, projectFiles)));
        break;
      case 'go':
        services.push(...(await this.suggestGoServices(projectPath)));
        break;
      default:
        services.push(...(await this.suggestGenericServices(projectPath, projectFiles)));
    }

    return services;
  }

  private static async suggestNodeServices(projectPath: string): Promise<Service[]> {
    const services: Service[] = [];

    try {
      const packageJson = await FileSystem.readJsonFile<PackageJson>(
        path.join(projectPath, 'package.json')
      );

      if (!packageJson?.scripts) return services;

      const scripts = packageJson.scripts;
      let port = 3000;

      if (scripts.dev || scripts.develop) {
        services.push({
          name: 'dev-server',
          command: scripts.dev || scripts.develop,
          port: port++,
          autoRestart: true,
          workingDirectory: projectPath,
        });
      }

      if (scripts.start) {
        services.push({
          name: 'app',
          command: scripts.start,
          port: port++,
          autoRestart: true,
          workingDirectory: projectPath,
        });
      }

      const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };

      if (dependencies.react || dependencies['@vitejs/plugin-react']) {
        services.push({
          name: 'frontend',
          command: scripts.dev || 'npm run dev',
          port: 3000,
          autoRestart: true,
          workingDirectory: projectPath,
        });
      }

      if (dependencies.express || dependencies.fastify) {
        services.push({
          name: 'api',
          command: scripts.start || 'npm start',
          port: 3001,
          autoRestart: true,
          workingDirectory: projectPath,
        });
      }

      // Suggest database services for web projects
      if (
        dependencies.express ||
        dependencies.fastify ||
        dependencies.react ||
        dependencies.next ||
        dependencies.vue
      ) {
        services.push({
          name: 'postgresql',
          template: 'postgresql',
          version: '15',
          port: 5432,
          autoRestart: true,
          environment: {
            POSTGRES_DB: 'app_db',
            POSTGRES_USER: 'app_user',
            POSTGRES_PASSWORD: 'app_password',
          },
        });

        services.push({
          name: 'redis',
          template: 'redis',
          version: '7',
          port: 6379,
          autoRestart: true,
        });
      }

      return services;
    } catch (error) {
      logger.warn('Failed to suggest Node.js services', error);
      return [];
    }
  }

  private static async suggestPythonServices(projectPath: string): Promise<Service[]> {
    const services: Service[] = [];

    const requirementsPath = path.join(projectPath, 'requirements.txt');

    try {
      if (await fs.pathExists(requirementsPath)) {
        const requirements = await fs.readFile(requirementsPath, 'utf8');

        if (requirements.includes('django')) {
          services.push({
            name: 'django-server',
            command: 'python manage.py runserver',
            port: 8000,
            autoRestart: true,
            workingDirectory: projectPath,
          });
        }

        if (requirements.includes('flask')) {
          services.push({
            name: 'flask-server',
            command: 'python app.py',
            port: 5000,
            autoRestart: true,
            workingDirectory: projectPath,
          });
        }

        if (requirements.includes('fastapi')) {
          services.push({
            name: 'fastapi-server',
            command: 'uvicorn main:app --reload',
            port: 8000,
            autoRestart: true,
            workingDirectory: projectPath,
          });
        }

        // Suggest database services for web frameworks
        if (
          requirements.includes('django') ||
          requirements.includes('flask') ||
          requirements.includes('fastapi')
        ) {
          services.push({
            name: 'postgresql',
            template: 'postgresql',
            version: '15',
            port: 5432,
            autoRestart: true,
            environment: {
              POSTGRES_DB: 'app_db',
              POSTGRES_USER: 'app_user',
              POSTGRES_PASSWORD: 'app_password',
            },
          });

          services.push({
            name: 'redis',
            template: 'redis',
            version: '7',
            port: 6379,
            autoRestart: true,
          });
        }
      }
    } catch (error) {
      logger.warn('Failed to suggest Python services', error);
    }

    return services;
  }

  private static async suggestJavaServices(
    projectPath: string,
    projectFiles: string[]
  ): Promise<Service[]> {
    const services: Service[] = [];

    if (projectFiles.includes('pom.xml')) {
      services.push({
        name: 'maven-app',
        command: 'mvn spring-boot:run',
        port: 8080,
        autoRestart: true,
        workingDirectory: projectPath,
      });
    }

    if (projectFiles.includes('build.gradle') || projectFiles.includes('build.gradle.kts')) {
      services.push({
        name: 'gradle-app',
        command: './gradlew bootRun',
        port: 8080,
        autoRestart: true,
        workingDirectory: projectPath,
      });
    }

    return services;
  }

  private static async suggestGoServices(projectPath: string): Promise<Service[]> {
    const services: Service[] = [];

    const files = await FileSystem.getProjectFiles(projectPath);
    const hasMain = files.includes('main.go');
    const hasServer = files.some(file => file.includes('server') && file.endsWith('.go'));

    if (hasMain || hasServer) {
      services.push({
        name: 'go-server',
        command: 'go run .',
        port: 8080,
        autoRestart: true,
        workingDirectory: projectPath,
      });
    }

    return services;
  }

  private static async suggestGenericServices(
    projectPath: string,
    projectFiles: string[]
  ): Promise<Service[]> {
    const services: Service[] = [];

    if (projectFiles.some(file => file.startsWith('docker-compose'))) {
      services.push({
        name: 'docker-services',
        command: 'docker-compose up',
        autoRestart: false,
        workingDirectory: projectPath,
      });
    }

    if (projectFiles.includes('Makefile')) {
      services.push({
        name: 'make-run',
        command: 'make run',
        autoRestart: true,
        workingDirectory: projectPath,
      });
    }

    return services;
  }

  private static async suggestTools(
    projectPath: string,
    detectedType: { type: ProjectType; confidence: number }
  ): Promise<ToolVersions> {
    const tools: ToolVersions = {};

    switch (detectedType.type) {
      case 'node':
        tools.nodejs = await this.detectNodeVersion(projectPath);
        tools.npm = await this.detectNpmVersion();
        break;
      case 'python':
        tools.python = await this.detectPythonVersion();
        break;
      case 'java':
        tools.java = await this.detectJavaVersion();
        break;
      case 'go':
        tools.go = await this.detectGoVersion();
        break;
    }

    return tools;
  }

  private static async detectNodeVersion(projectPath: string): Promise<string> {
    try {
      const packageJson = await FileSystem.readJsonFile<PackageJson>(
        path.join(projectPath, 'package.json')
      );

      if (packageJson?.engines?.node) {
        return packageJson.engines.node.replace(/[^\d.]/g, '');
      }

      return process.version.slice(1);
    } catch {
      return '18.0.0';
    }
  }

  private static async detectNpmVersion(): Promise<string> {
    try {
      const { ProcessUtils } = await import('../utils/ProcessUtils');
      const result = await ProcessUtils.execute('npm', ['--version']);
      return result.stdout.trim();
    } catch {
      return '9.0.0';
    }
  }

  private static async detectPythonVersion(): Promise<string> {
    try {
      const { ProcessUtils } = await import('../utils/ProcessUtils');
      const result = await ProcessUtils.execute('python3', ['--version']);
      const version = result.stdout.match(/Python (\d+\.\d+\.\d+)/);
      return version ? version[1] : '3.11.0';
    } catch {
      return '3.11.0';
    }
  }

  private static async detectJavaVersion(): Promise<string> {
    try {
      const { ProcessUtils } = await import('../utils/ProcessUtils');
      const result = await ProcessUtils.execute('java', ['-version']);
      const version = result.stderr.match(/version "(\d+)\.(\d+)\.(\d+)/);
      return version ? `${version[1]}.${version[2]}.${version[3]}` : '17';
    } catch {
      return '17';
    }
  }

  private static async detectGoVersion(): Promise<string> {
    try {
      const { ProcessUtils } = await import('../utils/ProcessUtils');
      const result = await ProcessUtils.execute('go', ['version']);
      const version = result.stdout.match(/go(\d+\.\d+\.\d+)/);
      return version ? version[1] : '1.21.0';
    } catch {
      return '1.21.0';
    }
  }

  private static async suggestEnvironment(
    projectPath: string,
    detectedType: { type: ProjectType; confidence: number }
  ): Promise<Record<string, string>> {
    const environment: Record<string, string> = {};

    switch (detectedType.type) {
      case 'node':
        environment.NODE_ENV = 'development';
        environment.PORT = '3000';
        break;
      case 'python':
        environment.PYTHONPATH = projectPath;
        environment.FLASK_ENV = 'development';
        environment.DJANGO_SETTINGS_MODULE = 'settings.development';
        break;
      case 'java':
        environment.JAVA_OPTS = '-Xmx512m';
        environment.SPRING_PROFILES_ACTIVE = 'development';
        break;
      case 'go':
        environment.GO_ENV = 'development';
        break;
    }

    return environment;
  }
}
