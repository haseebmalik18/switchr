// src/types/Registry.ts - Fixed with proper imports and production quality
import { PackageSearchResult, PackageDefinition } from './Package';

export interface RegistryConfig {
  name: string;
  url: string;
  type: 'npm' | 'pypi' | 'crates' | 'maven' | 'nuget' | 'hex' | 'pub';
  auth?: {
    token?: string;
    username?: string;
    password?: string;
  };
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  sortBy?: 'relevance' | 'downloads' | 'updated';
  category?: string;
  keywords?: string[];
}

export interface PackageRegistry {
  search(query: string, options?: SearchOptions): Promise<PackageSearchResult[]>;
  getPackageInfo(name: string, version?: string): Promise<PackageDefinition | null>;
  getVersions(name: string): Promise<string[]>;
  getLatestVersion(name: string): Promise<string | null>;
}

export interface RegistryManager {
  addRegistry(config: RegistryConfig): Promise<void>;
  removeRegistry(name: string): Promise<void>;
  getRegistry(name: string): Promise<PackageRegistry | null>;
  getAllRegistries(): Promise<RegistryConfig[]>;
  searchAcrossRegistries(query: string, options?: SearchOptions): Promise<PackageSearchResult[]>;
}

export interface RegistryCredentials {
  token?: string;
  username?: string;
  password?: string;
  scope?: string;
}

export interface RegistryMetadata {
  name: string;
  url: string;
  type: RegistryConfig['type'];
  lastSync?: Date;
  packageCount?: number;
  status: 'active' | 'inactive' | 'error';
  errorMessage?: string;
}

export interface PackageMetadata {
  name: string;
  version: string;
  registry: string;
  publishedAt: Date;
  size?: number;
  license?: string;
  maintainers?: string[];
  tags?: string[];
  deprecated?: boolean;
  deprecationReason?: string;
}

export interface VersionInfo {
  version: string;
  publishedAt: Date;
  isPrerelease: boolean;
  isLatest: boolean;
  changelog?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface RegistryResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    hasNext: boolean;
  };
}

export interface RegistryStats {
  totalPackages: number;
  totalDownloads: number;
  averageRating: number;
  lastUpdated: Date;
  popularPackages: Array<{
    name: string;
    downloads: number;
    rating: number;
  }>;
}

// Registry-specific types
export interface NpmRegistryResponse {
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

export interface PyPiRegistryResponse {
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
    license?: string;
    home_page?: string;
    download_url?: string;
    project_urls?: Record<string, string>;
    classifiers?: string[];
  };
  releases: Record<
    string,
    Array<{
      filename: string;
      packagetype: string;
      python_version: string;
      size: number;
      upload_time: string;
      url: string;
    }>
  >;
}

// Registry configuration presets
export const REGISTRY_PRESETS: Record<string, Omit<RegistryConfig, 'name'>> = {
  npm: {
    url: 'https://registry.npmjs.org',
    type: 'npm',
  },
  pypi: {
    url: 'https://pypi.org/simple',
    type: 'pypi',
  },
  crates: {
    url: 'https://crates.io',
    type: 'crates',
  },
  maven: {
    url: 'https://repo1.maven.org/maven2',
    type: 'maven',
  },
  nuget: {
    url: 'https://api.nuget.org/v3/index.json',
    type: 'nuget',
  },
  hex: {
    url: 'https://hex.pm/api',
    type: 'hex',
  },
  pub: {
    url: 'https://pub.dev/api',
    type: 'pub',
  },
} as const;

// Type guards
export function isRegistryConfig(obj: unknown): obj is RegistryConfig {
  return (
    obj !== null &&
    obj !== undefined &&
    typeof obj === 'object' &&
    'name' in obj &&
    'url' in obj &&
    'type' in obj &&
    typeof (obj as Record<string, unknown>).name === 'string' &&
    typeof (obj as Record<string, unknown>).url === 'string' &&
    typeof (obj as Record<string, unknown>).type === 'string' &&
    ['npm', 'pypi', 'crates', 'maven', 'nuget', 'hex', 'pub'].includes(
      (obj as Record<string, unknown>).type as string
    )
  );
}

export function isSearchOptions(obj: unknown): obj is SearchOptions {
  const record = obj as Record<string, unknown>;
  return (
    obj !== null &&
    obj !== undefined &&
    typeof obj === 'object' &&
    (record.limit === undefined || typeof record.limit === 'number') &&
    (record.offset === undefined || typeof record.offset === 'number') &&
    (record.sortBy === undefined ||
      ['relevance', 'downloads', 'updated'].includes(record.sortBy as string)) &&
    (record.category === undefined || typeof record.category === 'string') &&
    (record.keywords === undefined || Array.isArray(record.keywords))
  );
}

// Utility functions
export function createRegistryUrl(
  baseUrl: string,
  endpoint: string,
  params?: Record<string, string>
): string {
  const url = new URL(endpoint, baseUrl);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });
  }

  return url.toString();
}

export function normalizePackageName(name: string, registryType: RegistryConfig['type']): string {
  switch (registryType) {
    case 'npm':
      // NPM allows scoped packages like @scope/package
      return name.toLowerCase();
    case 'pypi':
      // PyPI normalizes names by replacing underscores and hyphens
      return name.toLowerCase().replace(/[-_.]+/g, '-');
    case 'maven':
      // Maven uses groupId:artifactId format
      return name;
    default:
      return name.toLowerCase();
  }
}

export function parseRegistryError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as Record<string, unknown>).message);
  }

  return 'Unknown registry error';
}
