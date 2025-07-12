import { ServiceTemplate, ServiceTemplateBase } from './ServiceTemplate';
import { PostgreSQLTemplate } from './templates/PostgreSQLTemplate';
import { RedisTemplate } from './templates/RedisTemplate';
import { MongoDBTemplate } from './templates/MongoDBTemplate';

/**
 * Registry for all available service templates
 */
export class ServiceTemplateRegistry {
  private static templates = new Map<string, ServiceTemplateBase>();
  private static initialized = false;

  /**
   * Initialize built-in templates
   */
  static async initialize(): Promise<void> {
    if (this.initialized) return;

    // Register built-in templates
    this.register('postgresql', new PostgreSQLTemplate());
    this.register('redis', new RedisTemplate());
    this.register('mongodb', new MongoDBTemplate());

    this.initialized = true;
    logger.debug(`Initialized ${this.templates.size} service templates`);
  }

  /**
   * Register a service template
   */
  static register(name: string, template: ServiceTemplateBase): void {
    this.templates.set(name, template);
    logger.debug(`Registered service template: ${name}`);
  }

  /**
   * Get a service template by name
   */
  static getTemplate(name: string): ServiceTemplateBase | null {
    return this.templates.get(name) || null;
  }

  /**
   * Get all available templates
   */
  static getAllTemplates(): ServiceTemplate[] {
    return Array.from(this.templates.values()).map(t => t.getTemplate());
  }

  /**
   * Get templates by category
   */
  static getTemplatesByCategory(category: string): ServiceTemplate[] {
    return this.getAllTemplates().filter(t => t.category === category);
  }

  /**
   * Check if template exists
   */
  static hasTemplate(name: string): boolean {
    return this.templates.has(name);
  }

  /**
   * Search templates
   */
  static searchTemplates(query: string): ServiceTemplate[] {
    const lowercaseQuery = query.toLowerCase();

    return this.getAllTemplates().filter(
      template =>
        template.name.toLowerCase().includes(lowercaseQuery) ||
        template.description.toLowerCase().includes(lowercaseQuery) ||
        template.category.toLowerCase().includes(lowercaseQuery)
    );
  }

  /**
   * Get template suggestions based on project type
   */
  static getTemplatesByProjectType(projectType: string): ServiceTemplate[] {
    const suggestions: Record<string, string[]> = {
      nodejs: ['postgresql', 'redis', 'mongodb'],
      python: ['postgresql', 'redis', 'mongodb', 'elasticsearch'],
      java: ['postgresql', 'redis', 'kafka', 'elasticsearch'],
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
