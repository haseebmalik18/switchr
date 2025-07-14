// src/core/registry/PyPIRegistry.ts - Production PyPI Registry implementation
import { logger } from '../../utils/Logger';
import { PackageSearchResult, PackageDefinition } from '../../types/Package';

interface PyPIPackageResponse {
  info: {
    name: string;
    version: string;
    summary?: string;
    description?: string;
    keywords?: string;
    author?: string;
    author_email?: string;
    maintainer?: string;
    maintainer_email?: string;
    home_page?: string;
    download_url?: string;
    project_urls?: Record<string, string>;
    classifiers?: string[];
    requires_dist?: string[];
    requires_python?: string;
    license?: string;
  };
  releases: Record<string, any[]>;
  urls: Array<{
    filename: string;
    url: string;
    digests: {
      md5: string;
      sha256: string;
    };
    upload_time: string;
  }>;
}

interface PyPIStatsResponse {
  data: {
    last_day: number;
    last_month: number;
    last_week: number;
  };
  package: string;
  type: string;
}

export class PyPIRegistry {
  private static readonly PYPI_API_URL = 'https://pypi.org/pypi';
  private static readonly PYPI_SIMPLE_URL = 'https://pypi.org/simple';
  private static readonly PYPI_STATS_URL = 'https://pypistats.org/api/packages';

  // Rate limiting
  private static requestCount = 0;
  private static lastResetTime = Date.now();
  private static readonly MAX_REQUESTS_PER_HOUR = 1000; // PyPI is more generous
  private static readonly RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour

  // Simple search using package name matching (since PyPI removed XML-RPC search)
  private static packageCache: string[] | null = null;
  private static cacheExpiry = 0;
  private static readonly CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Search for packages in PyPI registry
   * Note: PyPI deprecated their search API, so we use package name matching
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
      // Get all package names (cached)
      const allPackages = await this.getAllPackageNames();

      // Filter packages by query
      const lowerQuery = query.toLowerCase();
      const matchingPackages = allPackages.filter(
        pkg => pkg.toLowerCase().includes(lowerQuery) || lowerQuery.includes(pkg.toLowerCase())
      );

      // Apply pagination
      const start = options.offset || 0;
      const limit = Math.min(options.limit || 20, 100);
      const paginatedPackages = matchingPackages.slice(start, start + limit);

      // Get detailed info for matching packages (limited to avoid too many requests)
      const results: PackageSearchResult[] = [];
      const maxDetailsToFetch = Math.min(paginatedPackages.length, 10);

      for (let i = 0; i < maxDetailsToFetch; i++) {
        const packageName = paginatedPackages[i];
        try {
          const packageInfo = await this.getPackageInfo(packageName);
          if (packageInfo) {
            const result = this.transformToSearchResult(packageInfo, query);

            // Add download stats if sorting by downloads
            if (options.sortBy === 'downloads') {
              const stats = await this.getDownloadStats(packageName);
              if (stats !== null) {
                result.downloads = stats;
              }
            }

            results.push(result);
          }
        } catch (error) {
          logger.debug(`Failed to get details for ${packageName}`, error);
          // Add basic result without details
          results.push({
            name: packageName,
            type: 'dependency',
            runtime: 'python',
            description: `Python package: ${packageName}`,
            category: 'library',
            score: this.calculateRelevanceScore(packageName, query),
          });
        }
      }

      // Add remaining packages as basic results
      for (let i = maxDetailsToFetch; i < paginatedPackages.length; i++) {
        const packageName = paginatedPackages[i];
        results.push({
          name: packageName,
          type: 'dependency',
          runtime: 'python',
          description: `Python package: ${packageName}`,
          category: 'library',
          score: this.calculateRelevanceScore(packageName, query),
        });
      }

      // Sort results
      this.sortSearchResults(results, options.sortBy || 'relevance');

      return results;
    } catch (error) {
      logger.error('PyPI registry search failed', error);
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
        ? `${this.PYPI_API_URL}/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}/json`
        : `${this.PYPI_API_URL}/${encodeURIComponent(packageName)}/json`;

      logger.debug(`PyPI package info: ${url}`);

      const response = await this.fetchWithRetry(url);

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`PyPI package info failed: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as PyPIPackageResponse;
      this.requestCount++;

      return this.transformPackageInfo(data, version);
    } catch (error) {
      logger.error(`PyPI package info failed for ${packageName}`, error);
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

      const url = `${this.PYPI_API_URL}/${encodeURIComponent(packageName)}/json`;
      const response = await this.fetchWithRetry(url);

      if (!response.ok) return [];

      const data = (await response.json()) as PyPIPackageResponse;
      this.requestCount++;

      return Object.keys(data.releases).sort((a, b) => {
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
      return packageInfo?.version || null;
    } catch (error) {
      logger.error(`Failed to get latest version for ${packageName}`, error);
      return null;
    }
  }

  /**
   * Get download statistics for a package
   */
  static async getDownloadStats(packageName: string): Promise<number | null> {
    this.checkRateLimit();

    try {
      const url = `${this.PYPI_STATS_URL}/${encodeURIComponent(packageName)}/recent`;
      logger.debug(`PyPI download stats: ${url}`);

      const response = await this.fetchWithRetry(url);

      if (!response.ok) {
        if (response.status === 404) {
          return 0;
        }
        throw new Error(`PyPI download stats failed: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as PyPIStatsResponse;
      this.requestCount++;

      return data.data?.last_month || 0;
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

  /**
   * Get all package names from PyPI (cached)
   */
  private static async getAllPackageNames(): Promise<string[]> {
    const now = Date.now();

    // Return cached data if still valid
    if (this.packageCache && now < this.cacheExpiry) {
      return this.packageCache;
    }

    try {
      // Use the simple API to get all package names
      const response = await this.fetchWithRetry(this.PYPI_SIMPLE_URL, 1);

      if (!response.ok) {
        throw new Error(`Failed to fetch package list: ${response.status}`);
      }

      const html = await response.text();

      // Parse HTML to extract package names
      const packages = this.parsePackageNamesFromHTML(html);

      // Cache the results
      this.packageCache = packages;
      this.cacheExpiry = now + this.CACHE_DURATION;

      logger.info(`Loaded ${packages.length} PyPI package names`);
      return packages;
    } catch (error) {
      logger.error('Failed to load PyPI package names', error);

      // Return fallback list if cache loading fails
      return this.getFallbackPackageList();
    }
  }

  private static parsePackageNamesFromHTML(html: string): string[] {
    // Simple HTML parsing to extract package names from <a> tags
    const linkRegex = /<a\s+href="[^"]*">([^<]+)<\/a>/gi;
    const packages: string[] = [];
    let match;

    while ((match = linkRegex.exec(html)) !== null) {
      const packageName = match[1].trim();
      if (packageName && !packageName.includes('/')) {
        packages.push(packageName);
      }
    }

    return packages.sort();
  }

  private static getFallbackPackageList(): string[] {
    // Popular Python packages as fallback
    return [
      'django',
      'flask',
      'fastapi',
      'requests',
      'numpy',
      'pandas',
      'matplotlib',
      'scipy',
      'scikit-learn',
      'tensorflow',
      'pytorch',
      'opencv-python',
      'pillow',
      'beautifulsoup4',
      'selenium',
      'pytest',
      'black',
      'flake8',
      'mypy',
      'pip',
      'setuptools',
      'wheel',
      'virtualenv',
      'pipenv',
      'poetry',
      'click',
      'sqlalchemy',
      'alembic',
      'redis',
      'celery',
      'gunicorn',
      'uvicorn',
      'httpx',
      'aiohttp',
      'jinja2',
      'pydantic',
    ].sort();
  }

  private static transformPackageInfo(
    data: PyPIPackageResponse,
    specificVersion?: string
  ): PackageDefinition {
    const info = data.info;

    const result: PackageDefinition = {
      name: info.name,
      type: 'dependency' as const,
      runtime: 'python',
      version: specificVersion || info.version,
      description: info.summary || info.description || '',
      category: 'library',
    };

    // Add optional properties only if they exist
    if (info.keywords) {
      result.keywords = info.keywords
        .split(',')
        .map((k: string) => k.trim())
        .filter((k: string) => k);
    }

    if (info.project_urls?.['Homepage']) {
      result.homepage = info.project_urls['Homepage'];
    } else if (info.home_page) {
      result.homepage = info.home_page;
    }

    if (info.project_urls?.['Repository'] || info.project_urls?.['Source']) {
      result.repository = info.project_urls?.['Repository'] || info.project_urls?.['Source'];
    }

    if (info.license) {
      result.license = info.license;
    }

    if (info.author || info.maintainer) {
      result.maintainers = [info.author || info.maintainer!].filter(Boolean);
    }

    return result;
  }

  private static transformToSearchResult(
    packageDef: PackageDefinition,
    query: string
  ): PackageSearchResult {
    return {
      ...packageDef,
      score: this.calculateRelevanceScore(packageDef.name, query),
    };
  }

  private static calculateRelevanceScore(packageName: string, query: string): number {
    const lowerName = packageName.toLowerCase();
    const lowerQuery = query.toLowerCase();

    // Exact match gets highest score
    if (lowerName === lowerQuery) return 100;

    // Starts with query gets high score
    if (lowerName.startsWith(lowerQuery)) return 80;

    // Contains query gets medium score
    if (lowerName.includes(lowerQuery)) return 60;

    // Query contains package name gets lower score
    if (lowerQuery.includes(lowerName)) return 40;

    // Fuzzy match gets lowest score
    const distance = this.levenshteinDistance(lowerName, lowerQuery);
    return Math.max(0, 20 - distance * 2);
  }

  private static levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1)
      .fill(null)
      .map(() => Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1,
          matrix[j - 1][i - 1] + indicator
        );
      }
    }

    return matrix[str2.length][str1.length];
  }

  private static sortSearchResults(results: PackageSearchResult[], sortBy: string): void {
    switch (sortBy) {
      case 'relevance':
        results.sort((a, b) => (b.score || 0) - (a.score || 0));
        break;
      case 'downloads':
        results.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
        break;
      case 'updated':
        results.sort((a, b) => {
          const aDate = new Date(a.lastUpdated || 0);
          const bDate = new Date(b.lastUpdated || 0);
          return bDate.getTime() - aDate.getTime();
        });
        break;
      case 'name':
        results.sort((a, b) => a.name.localeCompare(b.name));
        break;
    }
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
          signal: AbortSignal.timeout(15000),
        });

        return response;
      } catch (error) {
        if (i === retries - 1) throw error;

        // Exponential backoff
        const delay = Math.pow(2, i) * 1000;
        logger.debug(`PyPI registry request failed, retrying in ${delay}ms`, error);
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
        `PyPI registry rate limit exceeded. Reset in ${Math.ceil(resetIn / 1000 / 60)} minutes.`
      );
    }
  }

  private static compareVersions(a: string, b: string): number {
    // Basic version comparison for Python packages
    const normalize = (v: string) => v.split('.').map(n => parseInt(n, 10) || 0);
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
      const response = await this.fetchWithRetry(`${this.PYPI_API_URL}/pip/json`, 1);
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
