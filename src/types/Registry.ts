// src/types/Registry.ts - New file for registry types
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

export interface PackageRegistry {
  search(query: string, options?: SearchOptions): Promise<PackageSearchResult[]>;
  getPackageInfo(name: string, version?: string): Promise<PackageDefinition | null>;
  getVersions(name: string): Promise<string[]>;
  getLatestVersion(name: string): Promise<string | null>;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  sortBy?: 'relevance' | 'downloads' | 'updated';
  category?: string;
  keywords?: string[];
}
