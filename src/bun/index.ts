import { BrowserWindow, BrowserView } from "electrobun/bun";
import { getRepoManager, type Repository } from "./repo";
import type { GitFileChange } from "./git";
import type { FileContents } from "@pierre/diffs";
import { homedir } from "os";
import { execSync } from "child_process";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

// Initialize with default path (current working directory)
const repoManager = getRepoManager(process.cwd());

// Check if Vite dev server is running for HMR
async function getMainViewUrl(): Promise<string> {
  try {
    await fetch(DEV_SERVER_URL, { method: "HEAD" });
    console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
    return DEV_SERVER_URL;
  } catch {
    return "views://mainview/index.html";
  }
}

// Show native folder picker dialog (macOS)
function showFolderPicker(): string | null {
  try {
    console.log("Opening folder picker dialog...");
    // Use osascript to show native macOS folder picker
    const script = 'POSIX path of (choose folder with prompt "Select a Git repository folder")';
    console.log("Running osascript...");
    const result = execSync(
      `osascript -e '${script}'`,
      { encoding: "utf-8", timeout: 30000 }
    );
    console.log("Folder picker result:", result);
    return result.trim();
  } catch (error: any) {
    console.log("Folder picker error:", error.message);
    // User cancelled or error
    return null;
  }
}

// Define RPC schema for Git operations
interface GitRPCSchema {
  bun: {
    requests: {
      // Repo management
      getRepos: { params: void; response: { repos: Repository[]; activeRepoId: string | null } };
      openRepo: { params: { path: string }; response: Repository | null };
      initRepo: { params: { path: string }; response: Repository };
      cloneRepo: { params: { remoteUrl: string; localPath: string }; response: Repository };
      setActiveRepo: { params: { id: string }; response: boolean };
      removeRepo: { params: { id: string }; response: boolean };
      selectFolder: { params: void; response: string | null };
      // Git operations
      getStatus: { params: void; response: { isRepo: boolean; branch: string; ahead: number; behind: number } };
      getChangedFiles: { params: void; response: GitFileChange[] };
      getFileDiff: { params: { path: string }; response: { oldFile: FileContents | null; newFile: FileContents } };
      stageFile: { params: { path: string }; response: void };
      unstageFile: { params: { path: string }; response: void };
      commit: { params: { message: string }; response: void };
      getCommitHistory: { params: { count?: number }; response: Array<{
        hash: string;
        message: string;
        author: string;
        date: string;
        branches: string[];
        isHead: boolean;
      }> };
      getCommitGraph: { params: { offset?: number; count?: number }; response: Array<{
        hash: string;
        message: string;
        author: string;
        date: string;
        parents: string[];
        branches: string[];
        isHead: boolean;
      }> };
      getCommitDetails: { params: { hash: string }; response: {
        hash: string;
        message: string;
        body: string;
        author: string;
        authorEmail: string;
        date: string;
        files: Array<{
          path: string;
          status: string;
          additions: number;
          deletions: number;
        }>;
        stats: {
          filesChanged: number;
          insertions: number;
          deletions: number;
        };
      } | null };
      getBranches: { params: void; response: Array<{
        name: string;
        isCurrent: boolean;
        isRemote: boolean;
        ahead: number;
        behind: number;
      }> };
      // System
      getHomeDirectory: { params: void; response: string };
    };
    messages: {};
  };
  webview: {
    requests: {};
    messages: {};
  };
}

// Define RPC handlers
const gitRpc = BrowserView.defineRPC<GitRPCSchema>({
  handlers: {
    requests: {
      // Repo management
      getRepos: () => {
        console.log("RPC: getRepos called");
        return {
          repos: repoManager.getAllRepos(),
          activeRepoId: repoManager.getActiveRepo()?.id || null,
        };
      },
      openRepo: ({ path }) => {
        console.log("RPC: openRepo called with path:", path);
        return repoManager.openRepo(path);
      },
      initRepo: ({ path }) => {
        console.log("RPC: initRepo called with path:", path);
        return repoManager.initRepo(path);
      },
      cloneRepo: ({ remoteUrl, localPath }) => {
        console.log("RPC: cloneRepo called");
        return repoManager.cloneRepo(remoteUrl, localPath);
      },
      setActiveRepo: ({ id }) => {
        console.log("RPC: setActiveRepo called with id:", id);
        return repoManager.setActiveRepo(id);
      },
      removeRepo: ({ id }) => {
        console.log("RPC: removeRepo called with id:", id);
        return repoManager.removeRepo(id);
      },
      selectFolder: () => {
        console.log("RPC: selectFolder called");
        return showFolderPicker();
      },
      getHomeDirectory: () => {
        console.log("RPC: getHomeDirectory called");
        return homedir();
      },
      // Git operations
      getStatus: () => {
        const gitService = repoManager.getGitService();
        if (!gitService || !gitService.isGitRepository()) {
          return { isRepo: false, branch: "", ahead: 0, behind: 0 };
        }
        try {
          const status = gitService.getStatus();
          return {
            isRepo: true,
            branch: status.branch,
            ahead: status.ahead,
            behind: status.behind,
          };
        } catch {
          return { isRepo: false, branch: "", ahead: 0, behind: 0 };
        }
      },
      getChangedFiles: () => {
        const gitService = repoManager.getGitService();
        if (!gitService) return [];
        try {
          const status = gitService.getStatus();
          return status.files;
        } catch {
          return [];
        }
      },
      getFileDiff: ({ path }) => {
        const gitService = repoManager.getGitService();
        if (!gitService) {
          return { oldFile: null, newFile: { name: path, contents: "" } };
        }
        return gitService.getFileDiff(path);
      },
      stageFile: ({ path }) => {
        const gitService = repoManager.getGitService();
        if (!gitService) return;
        gitService.stageFile(path);
      },
      unstageFile: ({ path }) => {
        const gitService = repoManager.getGitService();
        if (!gitService) return;
        gitService.unstageFile(path);
      },
      commit: ({ message }) => {
        const gitService = repoManager.getGitService();
        if (!gitService) {
          throw new Error("No active repository");
        }
        gitService.commit(message);
      },
      getCommitHistory: ({ count }) => {
        const gitService = repoManager.getGitService();
        if (!gitService) return [];
        try {
          return gitService.getCommitHistory(count || 50);
        } catch {
          return [];
        }
      },
      getCommitGraph: ({ offset, count }) => {
        const gitService = repoManager.getGitService();
        if (!gitService) return [];
        try {
          return gitService.getCommitGraph(offset || 0, count || 100);
        } catch {
          return [];
        }
      },
      getCommitDetails: ({ hash }) => {
        const gitService = repoManager.getGitService();
        if (!gitService) return null;
        try {
          return gitService.getCommitDetails(hash);
        } catch {
          return null;
        }
      },
      getBranches: () => {
        const gitService = repoManager.getGitService();
        if (!gitService) return [];
        try {
          return gitService.getBranches();
        } catch {
          return [];
        }
      },
    },
  },
});

// Create the main application window
const url = await getMainViewUrl();

new BrowserWindow({
  title: "Better Github Desktop",
  url,
  rpc: gitRpc,
  frame: {
    width: 1200,
    height: 800,
    x: 200,
    y: 200,
  },
});

const activeRepo = repoManager.getActiveRepo();
console.log(`Better Github Desktop started!`);
console.log(`Active Repository: ${activeRepo?.path || "None"}`);
console.log(`Is Git repo: ${activeRepo?.isValid || false}`);
console.log(`RPC handlers registered: getRepos, openRepo, initRepo, cloneRepo, setActiveRepo, removeRepo, selectFolder, getHomeDirectory, getStatus, etc.`);
