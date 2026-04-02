// Repository manager for handling multiple git repositories
import { execSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { GitService, getGitService } from "./git";

export interface Repository {
  id: string;
  path: string;
  name: string;
  isValid: boolean;
}

class RepoManager {
  private repos: Map<string, Repository> = new Map();
  private activeRepoId: string | null = null;

  // Initialize with a default path
  constructor(initialPath?: string) {
    if (initialPath && existsSync(initialPath)) {
      this.addRepo(initialPath, true);
    }
  }

  // Add a repository
  addRepo(path: string, setActive: boolean = false): Repository {
    const id = crypto.randomUUID();
    const name = path.split("/").pop() || path;
    const gitService = getGitService(path);
    
    const repo: Repository = {
      id,
      path,
      name,
      isValid: gitService.isGitRepository(),
    };

    this.repos.set(id, repo);
    
    if (setActive || !this.activeRepoId) {
      this.activeRepoId = id;
    }

    return repo;
  }

  // Open existing repository (file picker would be done via native dialog)
  openRepo(path: string): Repository | null {
    if (!existsSync(path)) {
      return null;
    }

    const gitService = getGitService(path);
    if (!gitService.isGitRepository()) {
      return null;
    }

    return this.addRepo(path, true);
  }

  // Initialize a new git repository
  initRepo(path: string): Repository {
    // Create directory if it doesn't exist
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
    }

    // Initialize git
    try {
      execSync("git init", { cwd: path, encoding: "utf-8" });
      execSync("git config user.email 'user@example.com'", { cwd: path, encoding: "utf-8" });
      execSync("git config user.name 'User'", { cwd: path, encoding: "utf-8" });
    } catch (error) {
      throw new Error(`Failed to initialize git repository: ${error}`);
    }

    return this.addRepo(path, true);
  }

  // Clone a repository from remote
  cloneRepo(remoteUrl: string, localPath: string): Repository {
    // Create parent directory if it doesn't exist
    const parentDir = dirname(localPath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    // Clone the repository
    try {
      execSync(`git clone "${remoteUrl}" "${localPath}"`, {
        encoding: "utf-8",
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large repos
      });
    } catch (error) {
      throw new Error(`Failed to clone repository: ${error}`);
    }

    return this.addRepo(localPath, true);
  }

  // Get currently active repository
  getActiveRepo(): Repository | null {
    if (!this.activeRepoId) return null;
    return this.repos.get(this.activeRepoId) || null;
  }

  // Set active repository
  setActiveRepo(id: string): boolean {
    if (this.repos.has(id)) {
      this.activeRepoId = id;
      return true;
    }
    return false;
  }

  // Get all repositories
  getAllRepos(): Repository[] {
    return Array.from(this.repos.values());
  }

  // Get git service for active repo
  getGitService(): GitService | null {
    const activeRepo = this.getActiveRepo();
    if (!activeRepo) return null;
    return getGitService(activeRepo.path);
  }

  // Remove a repository from the list
  removeRepo(id: string): boolean {
    const deleted = this.repos.delete(id);
    if (deleted && this.activeRepoId === id) {
      // Set new active repo if available
      const remaining = this.getAllRepos();
      this.activeRepoId = remaining.length > 0 ? remaining[0].id : null;
    }
    return deleted;
  }
}

// Singleton instance
let repoManager: RepoManager | null = null;

export function getRepoManager(initialPath?: string): RepoManager {
  if (!repoManager) {
    repoManager = new RepoManager(initialPath);
  }
  return repoManager;
}

export function resetRepoManager(): void {
  repoManager = null;
}
