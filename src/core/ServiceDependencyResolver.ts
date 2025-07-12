import { Service } from '../types/Project';
import { logger } from '../utils/Logger';

export interface ServiceNode {
  service: Service;
  dependencies: string[];
  dependents: string[];
  status: 'pending' | 'starting' | 'ready' | 'failed';
}

export interface StartupPlan {
  phases: Service[][];
  totalServices: number;
  maxPhases: number;
}

export class ServiceDependencyResolver {
  private serviceMap: Map<string, ServiceNode> = new Map();

  constructor(services: Service[]) {
    this.buildDependencyGraph(services);
  }

  /**
   * Creates a startup plan with services grouped by phases
   * Phase 0: Services with no dependencies
   * Phase 1: Services that depend only on Phase 0 services
   * etc.
   */
  createStartupPlan(): StartupPlan {
    this.validateDependencies();
    this.detectCircularDependencies();

    const phases: Service[][] = [];
    const processed = new Set<string>();

    while (processed.size < this.serviceMap.size) {
      const phaseServices: Service[] = [];

      for (const [serviceName, node] of this.serviceMap) {
        if (processed.has(serviceName)) continue;

        // Check if all dependencies are already processed
        const canStart = node.dependencies.every(dep => processed.has(dep));

        if (canStart) {
          phaseServices.push(node.service);
          processed.add(serviceName);
        }
      }

      if (phaseServices.length === 0) {
        // This shouldn't happen if circular dependency detection works
        const remaining = Array.from(this.serviceMap.keys()).filter(name => !processed.has(name));
        throw new Error(`Unable to resolve dependencies for services: ${remaining.join(', ')}`);
      }

      phases.push(phaseServices);
    }

    logger.debug(`Created startup plan with ${phases.length} phases`);
    phases.forEach((phase, index) => {
      logger.debug(`Phase ${index}: ${phase.map(s => s.name).join(', ')}`);
    });

    return {
      phases,
      totalServices: this.serviceMap.size,
      maxPhases: phases.length,
    };
  }

  /**
   * Gets the dependency tree for visualization
   */
  getDependencyTree(): Record<string, string[]> {
    const tree: Record<string, string[]> = {};

    for (const [serviceName, node] of this.serviceMap) {
      tree[serviceName] = node.dependencies;
    }

    return tree;
  }

  /**
   * Gets services that depend on a given service
   */
  getDependents(serviceName: string): string[] {
    const node = this.serviceMap.get(serviceName);
    return node ? node.dependents : [];
  }

  /**
   * Checks if a service can be stopped safely (no running dependents)
   */
  canStopSafely(
    serviceName: string,
    runningServices: string[]
  ): { canStop: boolean; blockedBy: string[] } {
    const dependents = this.getDependents(serviceName);
    const runningDependents = dependents.filter(dep => runningServices.includes(dep));

    return {
      canStop: runningDependents.length === 0,
      blockedBy: runningDependents,
    };
  }

  /**
   * Gets the optimal shutdown order (reverse of startup)
   */
  createShutdownPlan(): Service[][] {
    const startupPlan = this.createStartupPlan();
    // Reverse the phases for shutdown
    return startupPlan.phases.reverse();
  }

  private buildDependencyGraph(services: Service[]): void {
    // First pass: create all nodes
    for (const service of services) {
      this.serviceMap.set(service.name, {
        service,
        dependencies: service.dependencies || [],
        dependents: [],
        status: 'pending',
      });
    }

    // Second pass: build dependent relationships
    for (const [serviceName, node] of this.serviceMap) {
      for (const dependency of node.dependencies) {
        const depNode = this.serviceMap.get(dependency);
        if (depNode) {
          depNode.dependents.push(serviceName);
        }
      }
    }
  }

  private validateDependencies(): void {
    const errors: string[] = [];

    for (const [serviceName, node] of this.serviceMap) {
      for (const dependency of node.dependencies) {
        if (!this.serviceMap.has(dependency)) {
          errors.push(`Service '${serviceName}' depends on unknown service '${dependency}'`);
        }
      }
    }

    if (errors.length > 0) {
      throw new Error(`Dependency validation failed:\n${errors.join('\n')}`);
    }
  }

  private detectCircularDependencies(): void {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycle = (serviceName: string, path: string[] = []): boolean => {
      if (recursionStack.has(serviceName)) {
        const cycleStart = path.indexOf(serviceName);
        const cycle = [...path.slice(cycleStart), serviceName];
        throw new Error(`Circular dependency detected: ${cycle.join(' → ')}`);
      }

      if (visited.has(serviceName)) {
        return false;
      }

      visited.add(serviceName);
      recursionStack.add(serviceName);

      const node = this.serviceMap.get(serviceName);
      if (node) {
        for (const dependency of node.dependencies) {
          if (hasCycle(dependency, [...path, serviceName])) {
            return true;
          }
        }
      }

      recursionStack.delete(serviceName);
      return false;
    };

    for (const serviceName of this.serviceMap.keys()) {
      if (!visited.has(serviceName)) {
        hasCycle(serviceName);
      }
    }
  }

  /**
   * Visualizes the dependency graph in a tree format
   */
  visualizeDependencyTree(): string {
    const tree = this.getDependencyTree();
    const output: string[] = [];

    output.push('📊 Service Dependency Tree:\n');

    // Find root services (no dependencies)
    const rootServices = Object.keys(tree).filter(service => tree[service].length === 0);

    if (rootServices.length === 0) {
      output.push('⚠️  No root services found (all services have dependencies)');
      return output.join('\n');
    }

    const visited = new Set<string>();

    const printTree = (serviceName: string, indent: string = '', isLast: boolean = true): void => {
      if (visited.has(serviceName)) {
        return; // Avoid infinite loops in complex graphs
      }
      visited.add(serviceName);

      const prefix = indent + (isLast ? '└── ' : '├── ');
      output.push(`${prefix}${serviceName}`);

      const dependents = this.getDependents(serviceName);
      dependents.forEach((dependent, index) => {
        const isLastDependent = index === dependents.length - 1;
        const newIndent = indent + (isLast ? '    ' : '│   ');
        printTree(dependent, newIndent, isLastDependent);
      });
    };

    rootServices.forEach((root, index) => {
      const isLastRoot = index === rootServices.length - 1;
      printTree(root, '', isLastRoot);
    });

    return output.join('\n');
  }

  /**
   * Gets startup phases in a human-readable format
   */
  getStartupPhasesSummary(): string {
    const plan = this.createStartupPlan();
    const output: string[] = [];

    output.push('🚀 Service Startup Plan:\n');

    plan.phases.forEach((phase, index) => {
      output.push(`Phase ${index + 1}: ${phase.map(s => s.name).join(', ')}`);
    });

    output.push(`\nTotal: ${plan.totalServices} services in ${plan.maxPhases} phases`);

    return output.join('\n');
  }
}
