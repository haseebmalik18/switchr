import { Command, Args, Flags } from '@oclif/core';
import prompt from 'inquirer';
import chalk from 'chalk';
import * as path from 'path';
import { ProjectDetector } from '../core/ProjectDetector';
import { ConfigManager } from '../core/ConfigManager';
import { FileSystem } from '../utils/FileSystem';
import { ProjectProfile, Service, ProjectDetectionResult, ProjectType } from '../types/Project';

interface InteractiveSetupResponses {
  projectName: string;
  description?: string;
  projectType?: ProjectType;
  useDetectedServices?: boolean;
  useDetectedEnv?: boolean;
  addCustomServices?: boolean;
  customServices?: Service[];
}

export default class Init extends Command {
  static override description = 'Initialize a new project profile for switchr';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> my-project',
    '<%= config.bin %> <%= command.id %> --force',
  ];

  static override args = {
    name: Args.string({
      description: 'Project name (will auto-detect if not provided)',
    }),
  };

  static override flags = {
    force: Flags.boolean({
      char: 'f',
      description: 'Overwrite existing project configuration',
      default: false,
    }),
    interactive: Flags.boolean({
      char: 'i',
      description: 'Run in interactive mode (default)',
      default: true,
    }),
    'skip-detection': Flags.boolean({
      description: 'Skip automatic project detection',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Init);

    try {
      const projectPath = await this.validateProjectDirectory();
      const configManager = ConfigManager.getInstance();

      const existingConfig = await configManager.loadProjectConfig(projectPath);
      if (existingConfig && !flags.force) {
        this.error(`Project already initialized. Use ${chalk.yellow('--force')} to overwrite.`);
      }

      this.log(chalk.blue('🔍 Initializing switchr project...\n'));

      let projectName = args.name;
      let detectionResult;

      if (!flags['skip-detection']) {
        this.log(chalk.gray('Analyzing project structure...'));
        detectionResult = await ProjectDetector.detectProject(projectPath);

        this.log(
          chalk.green(
            `✓ Detected ${detectionResult.type} project (${Math.round(detectionResult.confidence * 100)}% confidence)\n`
          )
        );
      }

      if (flags.interactive) {
        const responses = await this.runInteractiveSetup(projectName, detectionResult, projectPath);
        projectName = responses.projectName;

        const profile = await this.createProjectProfile(responses, projectPath, detectionResult);

        await configManager.addProject(projectPath, profile);

        this.log(chalk.green(`\n✅ Project '${responses.projectName}' initialized successfully!`));
        this.log(chalk.gray(`   Config saved to: ${path.join(projectPath, 'switchr.yml')}`));

        this.showNextSteps(responses.projectName);
      } else {
        if (!projectName) {
          projectName = path.basename(projectPath);
        }
        const profile = await this.createDefaultProfile(projectName, projectPath, detectionResult);
        await configManager.addProject(projectPath, profile);

        this.log(chalk.green(`✅ Project '${projectName}' initialized with default settings.`));
      }
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Unknown error occurred');
    }
  }

  private async validateProjectDirectory(): Promise<string> {
    const projectPath = process.cwd();

    if (!(await FileSystem.isProjectDirectory(projectPath))) {
      const response = await prompt.prompt([
        {
          type: 'confirm',
          name: 'continue',
          message: 'No project files detected. Continue anyway?',
          default: false,
        },
      ]);

      if (!response.continue) {
        this.error('Initialization cancelled.');
      }
    }

    return projectPath;
  }

  private async runInteractiveSetup(
    suggestedName: string | undefined,
    detectionResult: ProjectDetectionResult | undefined,
    projectPath: string
  ) {
    const questions = [];

    const defaultName =
      suggestedName || (detectionResult && detectionResult.type !== 'generic')
        ? `${detectionResult?.type}-${path.basename(projectPath)}`
        : path.basename(projectPath);

    questions.push({
      type: 'input',
      name: 'projectName',
      message: 'Project name:',
      default: defaultName,
      validate: (input: string) => {
        if (!input.trim()) return 'Project name is required';
        if (!/^[a-zA-Z0-9_-]+$/.test(input))
          return 'Project name can only contain letters, numbers, hyphens, and underscores';
        return true;
      },
    });

    questions.push({
      type: 'input',
      name: 'description',
      message: 'Project description (optional):',
    });

    if (detectionResult) {
      questions.push({
        type: 'list',
        name: 'projectType',
        message: 'Project type:',
        choices: [
          { name: `${detectionResult.type} (detected)`, value: detectionResult.type },
          { name: 'node', value: 'node' },
          { name: 'python', value: 'python' },
          { name: 'java', value: 'java' },
          { name: 'go', value: 'go' },
          { name: 'rust', value: 'rust' },
          { name: 'generic', value: 'generic' },
        ],
        default: detectionResult.type,
      });

      if (detectionResult.suggestedServices.length > 0) {
        this.log(chalk.yellow('\n📋 Suggested services:'));
        detectionResult.suggestedServices.forEach((service: Service, index: number) => {
          this.log(
            chalk.gray(
              `  ${index + 1}. ${service.name}: ${service.command}${service.port ? ` (port ${service.port})` : ''}`
            )
          );
        });

        questions.push({
          type: 'confirm',
          name: 'useDetectedServices',
          message: 'Use detected services?',
          default: true,
        });
      }

      if (Object.keys(detectionResult.suggestedEnvironment).length > 0) {
        this.log(chalk.yellow('\n🌍 Suggested environment variables:'));
        Object.entries(detectionResult.suggestedEnvironment).forEach(([key, value]) => {
          this.log(chalk.gray(`  ${key}=${value}`));
        });

        questions.push({
          type: 'confirm',
          name: 'useDetectedEnv',
          message: 'Use suggested environment variables?',
          default: true,
        });
      }
    }

    questions.push({
      type: 'confirm',
      name: 'addCustomServices',
      message: 'Add custom services?',
      default: false,
    });

    const responses = await prompt.prompt(questions);

    if (responses.addCustomServices) {
      responses.customServices = await this.promptForCustomServices();
    }

    return responses;
  }

  private async promptForCustomServices(): Promise<Service[]> {
    const services: Service[] = [];
    let addMore = true;

    while (addMore) {
      const serviceQuestions = [
        {
          type: 'input',
          name: 'name',
          message: 'Service name:',
          validate: (input: string) => (input.trim() ? true : 'Service name is required'),
        },
        {
          type: 'input',
          name: 'command',
          message: 'Command to run:',
          validate: (input: string) => (input.trim() ? true : 'Command is required'),
        },
        {
          type: 'number',
          name: 'port',
          message: 'Port (optional):',
        },
        {
          type: 'confirm',
          name: 'autoRestart',
          message: 'Auto-restart on failure?',
          default: true,
        },
      ];

      const serviceResponse = await prompt.prompt(serviceQuestions);

      services.push({
        name: serviceResponse.name,
        command: serviceResponse.command,
        port: serviceResponse.port || undefined,
        autoRestart: serviceResponse.autoRestart,
        workingDirectory: process.cwd(),
      });

      const continueResponse = await prompt.prompt([
        {
          type: 'confirm',
          name: 'addAnother',
          message: 'Add another service?',
          default: false,
        },
      ]);

      addMore = continueResponse.addAnother;
    }

    return services;
  }

  private async createProjectProfile(
    responses: InteractiveSetupResponses,
    projectPath: string,
    detectionResult: ProjectDetectionResult | undefined
  ): Promise<ProjectProfile> {
    const services: Service[] = [];

    if (responses.useDetectedServices && detectionResult?.suggestedServices) {
      services.push(...detectionResult.suggestedServices);
    }

    if (responses.customServices) {
      services.push(...responses.customServices);
    }

    let environment = {};
    if (responses.useDetectedEnv && detectionResult?.suggestedEnvironment) {
      environment = detectionResult.suggestedEnvironment;
    }

    return {
      name: responses.projectName,
      path: projectPath,
      type: responses.projectType || detectionResult?.type || 'generic',
      ...(responses.description && { description: responses.description }),
      environment,
      services,
      tools: detectionResult?.suggestedTools || {},
      scripts: {},
      createdAt: new Date().toISOString(),
    };
  }

  private async createDefaultProfile(
    projectName: string,
    projectPath: string,
    detectionResult: ProjectDetectionResult | undefined
  ): Promise<ProjectProfile> {
    const name = projectName;

    return {
      name,
      path: projectPath,
      type: detectionResult?.type || 'generic',
      environment: detectionResult?.suggestedEnvironment || {},
      services: detectionResult?.suggestedServices || [],
      tools: detectionResult?.suggestedTools || {},
      scripts: {},
      createdAt: new Date().toISOString(),
    };
  }

  private showNextSteps(projectName: string): void {
    this.log(chalk.blue('\n🚀 Next steps:'));
    this.log(chalk.gray(`   1. Review configuration: ${chalk.white('cat switchr.yml')}`));
    this.log(
      chalk.gray(`   2. Switch to project: ${chalk.white(`switchr switch ${projectName}`)}`)
    );
    this.log(chalk.gray(`   3. Check status: ${chalk.white('switchr status')}`));
    this.log(chalk.gray(`   4. List all projects: ${chalk.white('switchr list')}`));
  }
}
