// src/core/registry/NPMRegistry.ts - Production NPM Registry implementation
import { logger } from '../../utils/Logger';
import { PackageSearchResult, PackageDefinition } from '../../types/Package';

interface NPMSearchResponse {
  objects: Array<{
    package: {
      name: string;
      version: string;
      description?: string;
      keywords?: string[];
      date: string;
      author?: {
        name: string;
        email?: string;
      };
      publisher?: {
        username: string;
        email?: string;
      };
      maintainers?: Array<{
        username: string;
        email?: string;
      }>;
      repository?: {
        type: string;
        url: string;
      };
      links: {
        npm: string;
        homepage?: string;
        repository?: string;
        bugs?: string;
      };
    };
    score: {
      final: number;
      detail: {
        quality: number;
        popularity: number;
        maintenance: number;
      };
    };
    searchScore: number;
  }>;
  total: number;
  time: string;
}

interface NPMPackageResponse {
  name: string;
  description?: string;
  'dist-tags': {
    latest: string;
    [tag: string]: string;
  };
  versions: Record<string, any>;
  time: Record<string, string>;
  maintainers?: Array<{
    name: string;
    email?: string;
  }>;
  repository?: {
    type: string;
    url: string;
  };
  homepage?: string;
  bugs?: {
    url?: string;
    email?: string;
  };
  license?: string;
  keywords?: string[];
}

export class NPMRegistry {
  private static readonly REGISTRY_URL = 'https://registry.npmjs.org';
  private static readonly SEARCH_URL = 'https://registry.npmjs.org/-/v1/search';
  private static readonly DOWNLOAD_STATS_URL = 'https://api.npmjs.org/downloads';

  // Rate limiting
  private static requestCount = 0;
  private static lastResetTime = Date.now();
  private static readonly MAX_REQUESTS_PER_HOUR = 300;
  private static readonly RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour

  /**
   * Search for packages in the NPM registry
   */
  static async searchPackages(
    query: string,
    options: {
      limit?: number;
      offset?: number;
      sortBy?: 'relevance' | 'downloads' | 'updated';
    } = {}
  ): Promise<PackageSearchResult[]> {
    this.checkRateLimit();

    try {
      const searchParams = new URLSearchParams({
        text: query,
        size: Math.min(options.limit || 20, 250).toString(), // NPM max is 250
        from: (options.offset || 0).toString(),
      });

      // Add quality scoring parameters for better results
      if (options.sortBy === 'downloads') {
        searchParams.append('quality', '0.5');
        searchParams.append('popularity', '1.0');
        searchParams.append('maintenance', '0.5');
      } else if (options.sortBy === 'updated') {
        searchParams.append('quality', '0.5');
        searchParams.append('popularity', '0.5');
        searchParams.append('maintenance', '1.0');
      }

      const url = `${this.SEARCH_URL}?${searchParams}`;
      logger.debug(`NPM Registry search: ${url}`);

      const response = await this.fetchWithRetry(url);

      if (!response.ok) {
        throw new Error(`NPM search failed: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as NPMSearchResponse;
      this.requestCount++;

      return data.objects.map(obj => this.transformSearchResult(obj));
    } catch (error) {
      logger.error('NPM registry search failed', error);
      return [];
    }
  }

  /**
   * Get detailed package information
   */
  static async getPackageInfo(
    packageName: string,
    version?: string
  ): Promise<PackageDefinition | null> {
    this.checkRateLimit();

    try {
      const url = version
        ? `${this.REGISTRY_URL}/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`
        : `${this.REGISTRY_URL}/${encodeURIComponent(packageName)}`;

      logger.debug(`NPM Registry package info: ${url}`);

      const response = await this.fetchWithRetry(url);

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`NPM package info failed: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as NPMPackageResponse;
      this.requestCount++;

      return this.transformPackageInfo(data, version);
    } catch (error) {
      logger.error(`NPM registry package info failed for ${packageName}`, error);
      return null;
    }
  }

  /**
   * Get all available versions for a package
   */
  static async getPackageVersions(packageName: string): Promise<string[]> {
    this.checkRateLimit();

    try {
      const packageInfo = await this.getPackageInfo(packageName);
      if (!packageInfo) return [];

      const url = `${this.REGISTRY_URL}/${encodeURIComponent(packageName)}`;
      const response = await this.fetchWithRetry(url);

      if (!response.ok) return [];

      const data = (await response.json()) as NPMPackageResponse;
      this.requestCount++;

      return Object.keys(data.versions).sort((a, b) => {
        // Sort versions in descending order (latest first)
        return this.compareVersions(b, a);
      });
    } catch (error) {
      logger.error(`Failed to get versions for ${packageName}`, error);
      return [];
    }
  }

  /**
   * Get latest version of a package
   */
  static async getLatestVersion(packageName: string): Promise<string | null> {
    try {
      const packageInfo = await this.getPackageInfo(packageName);
      if (!packageInfo) return null;

      const url = `${this.REGISTRY_URL}/${encodeURIComponent(packageName)}`;
      const response = await this.fetchWithRetry(url);

      if (!response.ok) return null;

      const data = (await response.json()) as NPMPackageResponse;
      return data['dist-tags']?.latest || null;
    } catch (error) {
      logger.error(`Failed to get latest version for ${packageName}`, error);
      return null;
    }
  }

  /**
   * Get download statistics for a package
   */
  static async getDownloadStats(
    packageName: string,
    period: 'last-day' | 'last-week' | 'last-month' = 'last-month'
  ): Promise<number | null> {
    this.checkRateLimit();

    try {
      const url = `${this.DOWNLOAD_STATS_URL}/point/${period}/${encodeURIComponent(packageName)}`;
      logger.debug(`NPM download stats: ${url}`);

      const response = await this.fetchWithRetry(url);

      if (!response.ok) {
        if (response.status === 404) {
          return 0; // Package exists but no download data
        }
        throw new Error(`NPM download stats failed: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as { downloads?: number };
      this.requestCount++;

      return data.downloads || 0;
    } catch (error) {
      logger.debug(`Failed to get download stats for ${packageName}`, error);
      return null;
    }
  }

  /**
   * Check if package exists
   */
  static async packageExists(packageName: string): Promise<boolean> {
    try {
      const packageInfo = await this.getPackageInfo(packageName);
      return packageInfo !== null;
    } catch {
      return false;
    }
  }

  // Private helper methods

  private static transformSearchResult(obj: NPMSearchResponse['objects'][0]): PackageSearchResult {
    const pkg = obj.package;

    const result: PackageSearchResult = {
      name: pkg.name,
      type: 'dependency' as const,
      runtime: 'nodejs',
      version: pkg.version,
      description: pkg.description || '',
      category: 'library',
      score: Math.round(obj.score.final * 100),
      lastUpdated: pkg.date,
    };

    // Add optional properties only if they exist
    if (pkg.keywords?.length) {
      result.keywords = pkg.keywords;
    }

    if (pkg.repository?.url) {
      result.repository = pkg.repository.url;
    }

    if (pkg.links.homepage) {
      result.homepage = pkg.links.homepage;
    }

    if (pkg.maintainers) {
      result.maintainers = pkg.maintainers.map(m => m.username);
    }

    return result;
  }

  private static transformPackageInfo(
    data: NPMPackageResponse,
    specificVersion?: string
  ): PackageDefinition {
    const result: PackageDefinition = {
      name: data.name,
      type: 'dependency' as const,
      runtime: 'nodejs',
      version: specificVersion || data['dist-tags']?.latest || 'unknown',
      description: data.description || '',
      category: 'library',
    };

    // Add optional properties only if they exist
    if (data.keywords?.length) {
      result.keywords = data.keywords;
    }

    if (data.repository?.url) {
      result.repository = data.repository.url;
    }

    if (data.homepage) {
      result.homepage = data.homepage;
    }

    if (data.license) {
      result.license = data.license;
    }

    return result;
  }

  private static async fetchWithRetry(url: string, retries = 3): Promise<Response> {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'switchr-cli/0.1.0',
          },
          // Add timeout
          signal: AbortSignal.timeout(10000),
        });

        return response;
      } catch (error) {
        if (i === retries - 1) throw error;

        // Exponential backoff
        const delay = Math.pow(2, i) * 1000;
        logger.debug(`NPM registry request failed, retrying in ${delay}ms`, error);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw new Error('All retry attempts failed');
  }

  private static checkRateLimit(): void {
    const now = Date.now();

    // Reset counter if window has passed
    if (now - this.lastResetTime > this.RATE_LIMIT_WINDOW) {
      this.requestCount = 0;
      this.lastResetTime = now;
    }

    if (this.requestCount >= this.MAX_REQUESTS_PER_HOUR) {
      const resetIn = this.lastResetTime + this.RATE_LIMIT_WINDOW - now;
      throw new Error(
        `NPM registry rate limit exceeded. Reset in ${Math.ceil(resetIn / 1000 / 60)} minutes.`
      );
    }
  }

  private static compareVersions(a: string, b: string): number {
    // Basic semver comparison (would use proper semver library in production)
    const normalize = (v: string) =>
      v
        .replace(/^v/, '')
        .split('.')
        .map(n => parseInt(n, 10) || 0);
    const aParts = normalize(a);
    const bParts = normalize(b);
    const maxLength = Math.max(aParts.length, bParts.length);

    for (let i = 0; i < maxLength; i++) {
      const aPart = aParts[i] || 0;
      const bPart = bParts[i] || 0;

      if (aPart > bPart) return 1;
      if (aPart < bPart) return -1;
    }

    return 0;
  }

  /**
   * Get registry health status
   */
  static async getHealthStatus(): Promise<{ healthy: boolean; latency?: number; error?: string }> {
    const startTime = Date.now();

    try {
      const response = await this.fetchWithRetry(`${this.REGISTRY_URL}/-/ping`);
      const latency = Date.now() - startTime;

      return {
        healthy: response.ok,
        latency,
        ...(response.ok ? {} : { error: `HTTP ${response.status}` }),
      };
    } catch (error) {
      return {
        healthy: false,
        latency: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get rate limit status
   */
  static getRateLimitStatus(): { remaining: number; resetIn: number } {
    const now = Date.now();
    const resetIn = Math.max(0, this.lastResetTime + this.RATE_LIMIT_WINDOW - now);
    const remaining = Math.max(0, this.MAX_REQUESTS_PER_HOUR - this.requestCount);

    return { remaining, resetIn };
  }
}
