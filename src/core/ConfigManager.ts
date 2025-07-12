import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';
import { GlobalConfig, ProjectConfigFile } from '../types/Config';
import { ProjectProfile, IDEConfig, Service } from '../types/Project';

export class ConfigManager {
  private static instance: ConfigManager;
  private readonly configDir: string;
  private readonly globalConfigPath: string;
  private globalConfig: GlobalConfig | null = null;

  private constructor() {
    this.configDir = path.join(os.homedir(), '.switchr');
    this.globalConfigPath = path.join(this.configDir, 'config.yml');
  }

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  async ensureConfigDir(): Promise<void> {
    await fs.ensureDir(this.configDir);
  }

  async loadGlobalConfig(): Promise<GlobalConfig> {
    if (this.globalConfig) {
      return this.globalConfig;
    }

    await this.ensureConfigDir();

    if (!(await fs.pathExists(this.globalConfigPath))) {
      this.globalConfig = this.createDefaultGlobalConfig();
      await this.saveGlobalConfig();
      return this.globalConfig;
    }

    try {
      const content = await fs.readFile(this.globalConfigPath, 'utf8');
      this.globalConfig = yaml.parse(content) as GlobalConfig;

      this.globalConfig = this.validateGlobalConfig(this.globalConfig);

      return this.globalConfig;
    } catch (error) {
      throw new Error(
        `Failed to load global config: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async saveGlobalConfig(): Promise<void> {
    if (!this.globalConfig) {
      throw new Error('No global config to save');
    }

    await this.ensureConfigDir();

    try {
      const content = yaml.stringify(this.globalConfig, {
        indent: 2,
        lineWidth: 100,
        minContentWidth: 0,
      });

      await fs.writeFile(this.globalConfigPath, content, 'utf8');
    } catch (error) {
      throw new Error(
        `Failed to save global config: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async addProject(projectPath: string, profile: ProjectProfile): Promise<void> {
    const config = await this.loadGlobalConfig();

    config.projects[profile.name] = {
      name: profile.name,
      path: path.resolve(projectPath),
      lastUsed: new Date().toISOString(),
      favorite: false,
    };

    await this.saveGlobalConfig();
    await this.saveProjectConfig(projectPath, profile);
  }

  async removeProject(projectName: string): Promise<void> {
    const config = await this.loadGlobalConfig();

    if (!config.projects[projectName]) {
      throw new Error(`Project '${projectName}' not found`);
    }

    delete config.projects[projectName];

    if (config.settings.currentProject === projectName) {
      delete config.settings.currentProject;
    }

    await this.saveGlobalConfig();
  }

  async getProject(projectName: string): Promise<ProjectProfile | null> {
    const config = await this.loadGlobalConfig();
    const projectInfo = config.projects[projectName];

    if (!projectInfo) {
      return null;
    }

    return await this.loadProjectConfig(projectInfo.path);
  }

  async getAllProjects(): Promise<
    Array<{ info: GlobalConfig['projects'][string]; profile: ProjectProfile }>
  > {
    const config = await this.loadGlobalConfig();
    const projects: Array<{ info: GlobalConfig['projects'][string]; profile: ProjectProfile }> = [];

    for (const [name, info] of Object.entries(config.projects)) {
      try {
        const profile = await this.loadProjectConfig(info.path);
        if (profile) {
          projects.push({ info, profile });
        }
      } catch (error) {
        console.warn(
          `Warning: Could not load project '${name}': ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    return projects;
  }

  async setCurrentProject(projectName: string): Promise<void> {
    const config = await this.loadGlobalConfig();

    if (!config.projects[projectName]) {
      throw new Error(`Project '${projectName}' not found`);
    }

    config.settings.currentProject = projectName;
    config.projects[projectName].lastUsed = new Date().toISOString();

    await this.saveGlobalConfig();
  }

  async getCurrentProject(): Promise<ProjectProfile | null> {
    const config = await this.loadGlobalConfig();

    if (!config.settings.currentProject) {
      return null;
    }

    return await this.getProject(config.settings.currentProject);
  }

  async loadProjectConfig(projectPath: string): Promise<ProjectProfile | null> {
    const configPath = path.join(projectPath, 'switchr.yml');

    if (!(await fs.pathExists(configPath))) {
      return null;
    }

    try {
      const content = await fs.readFile(configPath, 'utf8');
      const configFile = yaml.parse(content) as ProjectConfigFile;

      return this.projectConfigToProfile(configFile, projectPath);
    } catch (error) {
      throw new Error(
        `Failed to load project config at ${configPath}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async saveProjectConfig(projectPath: string, profile: ProjectProfile): Promise<void> {
    const configPath = path.join(projectPath, 'switchr.yml');
    const configFile = this.projectProfileToConfig(profile);

    try {
      const content = yaml.stringify(configFile, {
        indent: 2,
        lineWidth: 100,
        minContentWidth: 0,
      });

      await fs.writeFile(configPath, content, 'utf8');
    } catch (error) {
      throw new Error(
        `Failed to save project config at ${configPath}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  getConfigDir(): string {
    return this.configDir;
  }

  private createDefaultGlobalConfig(): GlobalConfig {
    return {
      projects: {},
      settings: {
        version: '0.1.0',
        projectsDir: path.join(os.homedir(), 'projects'),
        configDir: this.configDir,
        logLevel: 'info',
        defaultIDE: 'vscode',
        autoStart: true,
        healthCheckInterval: 30000,
        portRange: {
          start: 3000,
          end: 9999,
        },
      },
    };
  }

  private validateGlobalConfig(config: GlobalConfig): GlobalConfig {
    const defaultConfig = this.createDefaultGlobalConfig();

    return {
      projects: config.projects || {},
      settings: {
        ...defaultConfig.settings,
        ...config.settings,
      },
    };
  }

  private projectConfigToProfile(config: ProjectConfigFile, projectPath: string): ProjectProfile {
    return {
      name: config.name,
      path: projectPath,
      type: config.type,
      ...(config.description && { description: config.description }),
      environment: config.environment || {},
      services:
        config.services?.map(
          service =>
            ({
              ...service,
              environment: {},
              workingDirectory: projectPath,
              autoRestart: service.autoRestart ?? false,
            }) as Service
        ) || [],
      tools: config.tools || {},
      ...(config.ide && {
        ide: {
          type: config.ide.type as IDEConfig['type'],
          ...(config.ide.workspace && { workspace: config.ide.workspace }),
          ...(config.ide.extensions && { extensions: config.ide.extensions }),
          ...(config.ide.settings && { settings: config.ide.settings }),
        },
      }),
      ...(config.scripts && { scripts: config.scripts }),
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
    };
  }

  private projectProfileToConfig(profile: ProjectProfile): ProjectConfigFile {
    return {
      name: profile.name,
      type: profile.type,
      ...(profile.description && { description: profile.description }),
      ...(Object.keys(profile.environment).length > 0 && { environment: profile.environment }),
      ...(profile.services.length > 0 && {
        services: profile.services.map(service => ({
          name: service.name,
          ...(service.command && { command: service.command }),
          ...(service.port && { port: service.port }),
          ...(service.healthCheck && { healthCheck: service.healthCheck }),
          ...(service.dependencies &&
            service.dependencies.length > 0 && { dependencies: service.dependencies }),
          ...(service.autoRestart !== undefined && { autoRestart: service.autoRestart }),
        })),
      }),
      ...(Object.keys(profile.tools).length > 0 && { tools: profile.tools }),
      ...(profile.ide && {
        ide: {
          type: profile.ide.type,
          ...(profile.ide.workspace && { workspace: profile.ide.workspace }),
          ...(profile.ide.extensions &&
            profile.ide.extensions.length > 0 && { extensions: profile.ide.extensions }),
          ...(profile.ide.settings &&
            Object.keys(profile.ide.settings).length > 0 && { settings: profile.ide.settings }),
        },
      }),
      ...(profile.scripts &&
        Object.keys(profile.scripts).length > 0 && { scripts: profile.scripts }),
    };
  }
}
