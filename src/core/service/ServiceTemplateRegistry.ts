// src/core/service/ServiceTemplateRegistry.ts - FIXED VERSION
import { ServiceTemplate, ServiceTemplateBase } from './ServiceTemplate';
import { PostgreSQLTemplate } from './templates/POSTgreSQLTemplate';
import { RedisTemplate } from './templates/RedisTemplate';
import { MongoDBTemplate } from './templates/MongoDBTemplate';
import { logger } from '../../utils/Logger';

export class ServiceTemplateRegistry {
  private static templates = new Map<string, ServiceTemplateBase>();
  private static initialized = false;

  static async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Register built-in templates
      this.register('postgresql', new PostgreSQLTemplate());
      this.register('postgres', new PostgreSQLTemplate()); // Alias
      this.register('redis', new RedisTemplate());
      this.register('mongodb', new MongoDBTemplate());
      this.register('mongo', new MongoDBTemplate()); // Alias

      this.initialized = true;
      logger.debug(`Initialized ${this.templates.size} service templates`);
    } catch (error) {
      logger.error('Failed to initialize service templates', error);
      throw error;
    }
  }

  static register(name: string, template: ServiceTemplateBase): void {
    this.templates.set(name, template);
    logger.debug(`Registered service template: ${name}`);
  }

  static getTemplate(name: string): ServiceTemplateBase | null {
    return this.templates.get(name) || null;
  }

  static getAllTemplates(): ServiceTemplate[] {
    return Array.from(this.templates.values()).map(t => t.getTemplate());
  }

  static getTemplatesByCategory(category: string): ServiceTemplate[] {
    return this.getAllTemplates().filter(t => t.category === category);
  }

  static hasTemplate(name: string): boolean {
    return this.templates.has(name);
  }

  static searchTemplates(query: string): ServiceTemplate[] {
    const lowercaseQuery = query.toLowerCase();

    return this.getAllTemplates().filter(
      template =>
        template.name.toLowerCase().includes(lowercaseQuery) ||
        template.description.toLowerCase().includes(lowercaseQuery) ||
        template.category.toLowerCase().includes(lowercaseQuery)
    );
  }

  static getTemplatesByProjectType(projectType: string): ServiceTemplate[] {
    const suggestions: Record<string, string[]> = {
      nodejs: ['postgresql', 'redis', 'mongodb'],
      python: ['postgresql', 'redis', 'mongodb'],
      java: ['postgresql', 'redis'],
      go: ['postgresql', 'redis', 'mongodb'],
      rust: ['postgresql', 'redis'],
    };

    const templateNames = suggestions[projectType] || [];
    return templateNames
      .map(name => this.getTemplate(name))
      .filter((template): template is ServiceTemplateBase => template !== null)
      .map(template => template.getTemplate());
  }
}
