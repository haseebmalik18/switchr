// src/core/service/ServiceTemplateRegistry.ts - Fixed export/import issues
import { ServiceTemplate, ServiceTemplateBase } from './ServiceTemplate';
import { logger } from '../../utils/Logger';

// Import all service templates
import { PostgreSQLTemplate } from './templates/PostgreSQLTemplate';
import { RedisTemplate } from './templates/RedisTemplate';
import { MongoDBTemplate } from './templates/MongoDBTemplate';
import { MySQLTemplate } from './templates/MySQLTemplate';
import { NginxTemplate } from './templates/NginxTemplate';
import { ElasticsearchTemplate } from './templates/ElasticsearchTemplate';

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
      this.register('mysql', new MySQLTemplate());
      this.register('nginx', new NginxTemplate());
      this.register('elasticsearch', new ElasticsearchTemplate());
      this.register('elastic', new ElasticsearchTemplate()); // Alias

      this.initialized = true;
      logger.debug(`Initialized ${this.templates.size} service templates`);
    } catch (error) {
      logger.error('Failed to initialize service templates', error);
      throw error;
    }
  }

  static register(name: string, template: ServiceTemplateBase): void {
    this.templates.set(name.toLowerCase(), template);
    logger.debug(`Registered service template: ${name}`);
  }

  static getTemplate(name: string): ServiceTemplateBase | null {
    return this.templates.get(name.toLowerCase()) || null;
  }

  static getAllTemplates(): ServiceTemplate[] {
    return Array.from(this.templates.values()).map(t => t.getTemplate());
  }

  static getTemplatesByCategory(category: string): ServiceTemplate[] {
    return this.getAllTemplates().filter(t => t.category === category);
  }

  static hasTemplate(name: string): boolean {
    return this.templates.has(name.toLowerCase());
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
      nodejs: ['postgresql', 'redis', 'mongodb', 'nginx'],
      python: ['postgresql', 'redis', 'mongodb', 'elasticsearch'],
      java: ['postgresql', 'redis', 'mysql', 'elasticsearch'],
      go: ['postgresql', 'redis', 'mongodb', 'nginx'],
      rust: ['postgresql', 'redis', 'nginx'],
    };

    const templateNames = suggestions[projectType] || [];
    return templateNames
      .map(name => this.getTemplate(name))
      .filter((template): template is ServiceTemplateBase => template !== null)
      .map(template => template.getTemplate());
  }

  /**
   * Get template names matching a pattern
   */
  static getTemplateNames(pattern?: string): string[] {
    const names = Array.from(this.templates.keys());

    if (!pattern) {
      return names;
    }

    const lowercasePattern = pattern.toLowerCase();
    return names.filter(name => name.includes(lowercasePattern) || lowercasePattern.includes(name));
  }

  /**
   * Get templates by tags/keywords
   */
  static getTemplatesByTags(tags: string[]): ServiceTemplate[] {
    const lowercaseTags = tags.map(tag => tag.toLowerCase());

    return this.getAllTemplates().filter(template => {
      const templateKeywords = [
        template.name.toLowerCase(),
        template.category.toLowerCase(),
        ...template.description.toLowerCase().split(' '),
      ];

      return lowercaseTags.some(tag => templateKeywords.some(keyword => keyword.includes(tag)));
    });
  }

  /**
   * Validate template configuration
   */
  static validateTemplate(
    name: string,
    config: Record<string, any>
  ): { valid: boolean; errors: string[] } {
    const template = this.getTemplate(name);

    if (!template) {
      return {
        valid: false,
        errors: [`Template '${name}' not found`],
      };
    }

    return template.validateConfig(config);
  }

  /**
   * Get template statistics
   */
  static getStats(): {
    totalTemplates: number;
    categories: Record<string, number>;
    mostPopular: string[];
  } {
    const templates = this.getAllTemplates();
    const categories: Record<string, number> = {};

    templates.forEach(template => {
      categories[template.category] = (categories[template.category] || 0) + 1;
    });

    // Mock popularity data - in real implementation would track usage
    const mostPopular = ['postgresql', 'redis', 'mongodb', 'nginx', 'mysql'];

    return {
      totalTemplates: templates.length,
      categories,
      mostPopular: mostPopular.filter(name => this.hasTemplate(name)),
    };
  }

  /**
   * Check registry health
   */
  static validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.initialized) {
      errors.push('Service template registry not initialized');
    }

    if (this.templates.size === 0) {
      errors.push('No service templates registered');
    }

    // Validate each template
    for (const [name, template] of this.templates) {
      try {
        const templateInfo = template.getTemplate();

        if (!templateInfo.name) {
          errors.push(`Template '${name}' missing name`);
        }

        if (!templateInfo.version) {
          errors.push(`Template '${name}' missing version`);
        }

        if (!templateInfo.description) {
          errors.push(`Template '${name}' missing description`);
        }

        if (!templateInfo.category) {
          errors.push(`Template '${name}' missing category`);
        }
      } catch (error) {
        errors.push(`Template '${name}' validation failed: ${error}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Clear all templates (for testing)
   */
  static clear(): void {
    this.templates.clear();
    this.initialized = false;
    logger.debug('Cleared all service templates');
  }

  /**
   * Unregister a template
   */
  static unregister(name: string): boolean {
    const removed = this.templates.delete(name.toLowerCase());

    if (removed) {
      logger.debug(`Unregistered service template: ${name}`);
    }

    return removed;
  }

  /**
   * Get template suggestions based on project analysis
   */
  static async suggestTemplates(projectPath: string): Promise<ServiceTemplate[]> {
    return new Promise(async resolve => {
      try {
        // This would integrate with ProjectDetector to analyze the project
        // For now, return common templates
        const commonTemplates = ['postgresql', 'redis'];

        const suggestions = commonTemplates
          .map(name => this.getTemplate(name))
          .filter((template): template is ServiceTemplateBase => template !== null)
          .map(template => template.getTemplate());

        resolve(suggestions);
      } catch (error) {
        logger.warn('Failed to suggest templates', error);
        resolve([]);
      }
    });
  }

  /**
   * Get registry information for debugging
   */
  static getRegistryInfo(): {
    initialized: boolean;
    templateCount: number;
    templateNames: string[];
    categories: string[];
  } {
    const templates = this.getAllTemplates();
    const categories = Array.from(new Set(templates.map(t => t.category)));

    return {
      initialized: this.initialized,
      templateCount: this.templates.size,
      templateNames: Array.from(this.templates.keys()),
      categories,
    };
  }

  /**
   * Force re-initialization (useful for testing)
   */
  static async forceReinitialize(): Promise<void> {
    this.clear();
    await this.initialize();
  }
}
