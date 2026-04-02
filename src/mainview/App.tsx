import { useState, useCallback, useEffect } from "react";
import { FileDiff } from "@pierre/diffs/react";
import { parseDiffFromFile } from "@pierre/diffs";
import type { SelectedLineRange, FileContents, FileDiffMetadata } from "@pierre/diffs";
import { ArrowsInSimple, ArrowsOutSimple, FolderOpen, Plus, Download, Rows, SquaresFour } from "@phosphor-icons/react";
import { Electroview } from "electrobun/view";

// RPC type definitions matching backend
interface Repository {
  id: string;
  path: string;
  name: string;
  isValid: boolean;
}

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
      getChangedFiles: { params: void; response: Array<{ path: string; status: "modified" | "added" | "deleted" | "untracked" | "staged" }> };
      getFileDiff: { params: { path: string }; response: { oldFile: FileContents | null; newFile: FileContents } };
      stageFile: { params: { path: string }; response: void };
      unstageFile: { params: { path: string }; response: void };
      commit: { params: { message: string }; response: void };
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

// Define RPC from webview side
const gitRPC = Electroview.defineRPC<GitRPCSchema>({
  handlers: {
    requests: {},
    messages: {},
  },
});

// Create electroview instance - this sets up the connection
new Electroview({ rpc: gitRPC });

interface FileChange {
  id: string;
  name: string;
  checked: boolean;
  status: "modified" | "added" | "deleted" | "untracked" | "staged";
  oldFile: FileContents | null;
  newFile: FileContents;
  isLoading: boolean;
  isLoaded: boolean;
}

interface Note {
  id: string;
  fileName: string;
  startLine: number;
  endLine: number;
  side: "deletions" | "additions" | null;
  note: string;
}

// Compute diff lines from fileDiff
function countLinesChanged(fileDiff: FileDiffMetadata) {
  let added = 0;
  let deleted = 0;
  
  for (const hunk of fileDiff.hunks) {
    for (const content of hunk.hunkContent) {
      if (content.type === "change") {
        added += content.additions;
        deleted += content.deletions;
      }
    }
  }
  
  return { added, deleted };
}

interface FileDiffViewerProps {
  file: FileChange;
  isExpanded: boolean;
  isDarkMode: boolean;
  diffStyle: "split" | "unified";
  onToggleExpand: (id: string) => void;
  onLineSelectionEnd: (fileName: string) => (range: SelectedLineRange | null) => void;
  getStatusIcon: (status: FileChange["status"]) => React.ReactNode;
}

// Separate component to handle diff computation properly
function FileDiffViewer({ file, isExpanded, isDarkMode, diffStyle, onToggleExpand, onLineSelectionEnd, getStatusIcon }: FileDiffViewerProps) {
  // Create empty old file for new files
  const oldFile = file.oldFile ?? { name: file.newFile.name, contents: "" };
  
  // Compute the diff
  const fileDiff = parseDiffFromFile(oldFile, file.newFile);
  
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <button
        onClick={() => onToggleExpand(file.id)}
        className={`w-full bg-gray-100 dark:bg-gray-700 px-2.5 py-1 flex items-center justify-between hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors ${
          isExpanded ? 'border-b border-gray-200 dark:border-gray-600' : ''
        }`}
      >
        <div className="flex items-center gap-1.5">
          <svg
            className={`w-3 h-3 text-gray-500 dark:text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          {getStatusIcon(file.status)}
          <span className="font-mono text-xs text-gray-700 dark:text-gray-300">{file.name}</span>
        </div>
      </button>
      {isExpanded && (
        <FileDiff
          fileDiff={fileDiff}
          options={{
            theme: isDarkMode ? "pierre-dark" : "pierre-light",
            diffStyle: diffStyle,
            enableLineSelection: true,
            disableFileHeader: true,
            onLineSelectionEnd: onLineSelectionEnd(file.name),
          }}
        />
      )}
    </div>
  );
}

interface FileListItemProps {
  file: FileChange;
  isChecked: boolean;
  onToggle: () => void;
  getStatusIcon: (status: FileChange["status"]) => React.ReactNode;
}

// Component to render a file item in the sidebar with diff line counts
function FileListItem({ file, isChecked, onToggle, getStatusIcon }: FileListItemProps) {
  // Compute the diff for line counting
  const oldFile = file.oldFile ?? { name: file.newFile.name, contents: "" };
  const fileDiff = parseDiffFromFile(oldFile, file.newFile);
  const lineCount = countLinesChanged(fileDiff);
  
  return (
    <div
      onClick={onToggle}
      className="flex items-center gap-3 px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors"
    >
      <input
        type="checkbox"
        checked={isChecked}
        onChange={onToggle}
        className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white focus:ring-gray-900 dark:bg-gray-700"
      />
      {getStatusIcon(file.status)}
      <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{file.name}</span>
      <div className="flex items-center gap-1.5 text-xs ml-auto">
        {lineCount.added > 0 && (
          <span className="text-green-600 dark:text-green-400 font-medium">+{lineCount.added}</span>
        )}
        {lineCount.deleted > 0 && (
          <span className="text-red-600 dark:text-red-400 font-medium">-{lineCount.deleted}</span>
        )}
      </div>
    </div>
  );
}

// Repository Manager Component
function RepoManager({ 
  onRepoSelected, 
  homeDir 
}: { 
  onRepoSelected: () => void;
  homeDir: string;
}) {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [activeTab, setActiveTab] = useState<"existing" | "create" | "clone">("existing");
  const [existingRepoPath, setExistingRepoPath] = useState(homeDir);
  const [newRepoPath, setNewRepoPath] = useState(homeDir);
  const [cloneUrl, setCloneUrl] = useState("");
  const [clonePath, setClonePath] = useState(homeDir);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load existing repos on mount
  useEffect(() => {
    loadRepos();
  }, []);

  // Update paths when homeDir is loaded
  useEffect(() => {
    if (homeDir) {
      setExistingRepoPath(homeDir);
      setNewRepoPath(homeDir);
      setClonePath(homeDir);
    }
  }, [homeDir]);

  const loadRepos = async () => {
    const result = await gitRPC.request.getRepos();
    setRepos(result.repos);
  };

  const handleOpenRepo = async () => {
    if (!existingRepoPath.trim()) {
      setError("Please enter a path");
      return;
    }

    setIsLoading(true);
    setError(null);
    
    try {
      const repo = await gitRPC.request.openRepo({ path: existingRepoPath });
      if (repo) {
        await loadRepos();
        onRepoSelected();
      } else {
        setError("Not a valid Git repository");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open repository");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateRepo = async () => {
    if (!newRepoPath.trim()) {
      setError("Please enter a path");
      return;
    }

    setIsLoading(true);
    setError(null);
    
    try {
      await gitRPC.request.initRepo({ path: newRepoPath });
      await loadRepos();
      onRepoSelected();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create repository");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCloneRepo = async () => {
    if (!cloneUrl.trim() || !clonePath.trim()) {
      setError("Please enter both URL and local path");
      return;
    }

    setIsLoading(true);
    setError(null);
    
    try {
      await gitRPC.request.cloneRepo({ remoteUrl: cloneUrl, localPath: clonePath });
      await loadRepos();
      onRepoSelected();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clone repository");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectRepo = async (id: string) => {
    await gitRPC.request.setActiveRepo({ id });
    onRepoSelected();
  };

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-2xl">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2 text-center">
          Better GitHub Desktop
        </h1>
        <p className="text-gray-500 dark:text-gray-400 text-center mb-8">
          Select or create a repository to get started
        </p>

        {repos.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
              Recent Repositories
            </h2>
            <div className="space-y-2">
              {repos.map((repo) => (
                <button
                  key={repo.id}
                  onClick={() => handleSelectRepo(repo.id)}
                  className="w-full flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
                >
                  <FolderOpen className="w-5 h-5 text-gray-400" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 dark:text-white truncate">
                      {repo.name}
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400 truncate">
                      {repo.path}
                    </div>
                  </div>
                  <span className={`w-2 h-2 rounded-full ${repo.isValid ? "bg-green-500" : "bg-red-500"}`} />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg overflow-hidden">
          <div className="flex border-b border-gray-200 dark:border-gray-700">
            <button
              onClick={() => setActiveTab("existing")}
              className={`flex-1 py-3 px-4 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                activeTab === "existing"
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              }`}
            >
              <FolderOpen className="w-4 h-4" />
              Open Existing
            </button>
            <button
              onClick={() => setActiveTab("create")}
              className={`flex-1 py-3 px-4 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                activeTab === "create"
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              }`}
            >
              <Plus className="w-4 h-4" />
              Create New
            </button>
            <button
              onClick={() => setActiveTab("clone")}
              className={`flex-1 py-3 px-4 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                activeTab === "clone"
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              }`}
            >
              <Download className="w-4 h-4" />
              Clone
            </button>
          </div>

          <div className="p-6">
            {activeTab === "existing" && (
              <div className="space-y-4">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Open an existing Git repository from your file system.
                </p>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Repository Path
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={existingRepoPath}
                      onChange={(e) => setExistingRepoPath(e.target.value)}
                      placeholder="/path/to/existing/repo"
                      className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-100 focus:border-transparent outline-none dark:bg-gray-700 dark:text-white"
                    />
                    <button
                      onClick={async () => {
                        console.log("Browse button clicked");
                        try {
                          const selected = await gitRPC.request.selectFolder();
                          console.log("Selected folder:", selected);
                          if (selected) {
                            setExistingRepoPath(selected);
                          }
                        } catch (err) {
                          console.error("Error selecting folder:", err);
                        }
                      }}
                      disabled={isLoading}
                      className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors whitespace-nowrap"
                    >
                      Browse...
                    </button>
                  </div>
                </div>
                <button
                  onClick={handleOpenRepo}
                  disabled={isLoading}
                  className="w-full py-2.5 px-4 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg font-medium hover:bg-gray-800 dark:hover:bg-gray-200 disabled:opacity-50 transition-colors"
                >
                  {isLoading ? "Opening..." : "Open Repository"}
                </button>
              </div>
            )}

            {activeTab === "create" && (
              <div className="space-y-4">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Create a new Git repository at the specified location.
                </p>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Repository Path
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newRepoPath}
                      onChange={(e) => setNewRepoPath(e.target.value)}
                      placeholder="/path/to/new/repo"
                      className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-100 focus:border-transparent outline-none dark:bg-gray-700 dark:text-white"
                    />
                    <button
                      onClick={async () => {
                        const selected = await gitRPC.request.selectFolder();
                        if (selected) {
                          setNewRepoPath(selected);
                        }
                      }}
                      disabled={isLoading}
                      className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors whitespace-nowrap"
                    >
                      Browse...
                    </button>
                  </div>
                </div>
                <button
                  onClick={handleCreateRepo}
                  disabled={isLoading}
                  className="w-full py-2.5 px-4 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg font-medium hover:bg-gray-800 dark:hover:bg-gray-200 disabled:opacity-50 transition-colors"
                >
                  {isLoading ? "Creating..." : "Create Repository"}
                </button>
              </div>
            )}

            {activeTab === "clone" && (
              <div className="space-y-4">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Clone a repository from a remote URL (GitHub, GitLab, etc.)
                </p>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Repository URL
                  </label>
                  <input
                    type="text"
                    value={cloneUrl}
                    onChange={(e) => setCloneUrl(e.target.value)}
                    placeholder="https://github.com/username/repo.git"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-100 focus:border-transparent outline-none dark:bg-gray-700 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Local Path
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={clonePath}
                      onChange={(e) => setClonePath(e.target.value)}
                      placeholder="/path/to/clone/to"
                      className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-100 focus:border-transparent outline-none dark:bg-gray-700 dark:text-white"
                    />
                    <button
                      onClick={async () => {
                        const selected = await gitRPC.request.selectFolder();
                        if (selected) {
                          setClonePath(selected);
                        }
                      }}
                      disabled={isLoading}
                      className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors whitespace-nowrap"
                    >
                      Browse...
                    </button>
                  </div>
                </div>
                <button
                  onClick={handleCloneRepo}
                  disabled={isLoading}
                  className="w-full py-2.5 px-4 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg font-medium hover:bg-gray-800 dark:hover:bg-gray-200 disabled:opacity-50 transition-colors"
                >
                  {isLoading ? "Cloning..." : "Clone Repository"}
                </button>
              </div>
            )}

            {error && (
              <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm">
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState<"changes" | "history">("changes");
  const [files, setFiles] = useState<FileChange[]>([]);
  const [repoStatus, setRepoStatus] = useState<{ isRepo: boolean; branch: string; ahead: number; behind: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasRepo, setHasRepo] = useState(false);
  const [homeDir, setHomeDir] = useState("");
  const [currentRepo, setCurrentRepo] = useState<Repository | null>(null);
  const [commitSummary, setCommitSummary] = useState("");
  const [commitDescription, setCommitDescription] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedRange, setSelectedRange] = useState<{
    range: SelectedLineRange | null;
    fileName: string;
  } | null>(null);
  const [noteText, setNoteText] = useState("");
  const [isCopied, setIsCopied] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [showRepoManager, setShowRepoManager] = useState(false);
  const [diffStyle, setDiffStyle] = useState<"split" | "unified">("split");

  // Load home directory on mount
  useEffect(() => {
    gitRPC.request.getHomeDirectory().then(setHomeDir);
  }, []);

  // Load repository status and changed files
  const loadRepoData = useCallback(async () => {
    setIsLoading(true);
    
    try {
      // Get repo status
      const status = await gitRPC.request.getStatus();
      setRepoStatus(status);
      
      if (!status.isRepo) {
        setHasRepo(false);
        setFiles([]);
        return;
      }
      
      setHasRepo(true);
      
      // Get changed files
      const changedFiles = await gitRPC.request.getChangedFiles();
      
      // Initialize files with loading state
      const initialFiles: FileChange[] = changedFiles.map((f) => ({
        id: f.path,
        name: f.path,
        checked: f.status !== "untracked",
        status: f.status,
        oldFile: null,
        newFile: { name: f.path, contents: "" },
        isLoading: true,
        isLoaded: false,
      }));
      
      setFiles(initialFiles);
      
      // Load file diffs for each file
      for (const file of initialFiles) {
        console.log(`Loading diff for: ${file.name}`);
        try {
          const diff = await gitRPC.request.getFileDiff({ path: file.name });
          console.log(`Got diff for ${file.name}:`, {
            hasOldFile: !!diff.oldFile,
            hasNewFile: !!diff.newFile,
            oldLength: diff.oldFile?.contents?.length || 0,
            newLength: diff.newFile?.contents?.length || 0
          });
          setFiles((prev) =>
            prev.map((f: FileChange) =>
              f.id === file.id
                ? { ...f, oldFile: diff.oldFile, newFile: diff.newFile, isLoading: false, isLoaded: true }
                : f
            )
          );
        } catch (err) {
          console.error(`Failed to load diff for ${file.name}:`, err);
          setFiles((prev) =>
            prev.map((f: FileChange) =>
              f.id === file.id ? { ...f, isLoading: false, isLoaded: false } : f
            )
          );
        }
      }
      
      // Expand all loaded files by default
      setExpandedFiles(new Set(initialFiles.map(f => f.id)));
    } catch (err) {
      console.error("Failed to load repository:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadRepoData();
  }, [loadRepoData]);

  // Check for repo on mount
  useEffect(() => {
    const checkRepo = async () => {
      const repos = await gitRPC.request.getRepos();
      setHasRepo(repos.repos.length > 0 && repos.activeRepoId !== null);
    };
    checkRepo();
  }, []);

  const handleRepoSelected = async () => {
    setShowRepoManager(false);
    const repos = await gitRPC.request.getRepos();
    const activeRepo = repos.repos.find(r => r.id === repos.activeRepoId);
    if (activeRepo) {
      setCurrentRepo(activeRepo);
      setHasRepo(true);
      await loadRepoData();
    }
  };

  const toggleFile = (id: string) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, checked: !f.checked } : f))
    );
  };

  const toggleFileExpand = (id: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedFiles(new Set(checkedFiles.map((f) => f.id)));
  };

  const collapseAll = () => {
    setExpandedFiles(new Set());
  };

  const getStatusIcon = (status: FileChange["status"]) => {
    switch (status) {
      case "modified":
        return <span className="w-2 h-2 rounded-full bg-yellow-500" />;
      case "added":
        return <span className="w-2 h-2 rounded-full bg-green-500" />;
      case "deleted":
        return <span className="w-2 h-2 rounded-full bg-red-500" />;
      case "untracked":
        return <span className="w-2 h-2 rounded-full bg-gray-400" />;
      case "staged":
        return <span className="w-2 h-2 rounded-full bg-blue-500" />;
    }
  };

  const handleLineSelectionEnd = useCallback(
    (fileName: string) => (range: SelectedLineRange | null) => {
      if (range && range.start !== range.end) {
        setSelectedRange({ range, fileName });
        setIsModalOpen(true);
        setNoteText("");
      }
    },
    []
  );

  const handleSaveNote = () => {
    if (selectedRange && noteText.trim()) {
      const newNote: Note = {
        id: crypto.randomUUID(),
        fileName: selectedRange.fileName,
        startLine: selectedRange.range!.start,
        endLine: selectedRange.range!.end,
        side: selectedRange.range!.side || null,
        note: noteText.trim(),
      };
      setNotes((prev) => [...prev, newNote]);
      setIsModalOpen(false);
      setSelectedRange(null);
      setNoteText("");
    }
  };

  const handleDeleteNote = (noteId: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
  };

  const handleCopyToLLM = () => {
    if (notes.length === 0) return;

    let markdown = "# Code Review Notes\n\n";
    
    const groupedNotes = notes.reduce((acc, note) => {
      if (!acc[note.fileName]) acc[note.fileName] = [];
      acc[note.fileName].push(note);
      return acc;
    }, {} as Record<string, Note[]>);

    Object.entries(groupedNotes).forEach(([fileName, fileNotes]) => {
      markdown += `## ${fileName}\n\n`;
      fileNotes.forEach((note, index) => {
        markdown += `### Comment ${index + 1} (Lines ${note.startLine}-${note.endLine}${note.side ? ` - ${note.side}` : ""})\n\n`;
        markdown += `${note.note}\n\n`;
        markdown += "---\n\n";
      });
    });

    navigator.clipboard.writeText(markdown);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleCommit = async () => {
    if (!commitSummary || files.every((f) => !f.checked)) return;
    
    setIsCommitting(true);
    try {
      const fullMessage = commitDescription 
        ? `${commitSummary}\n\n${commitDescription}` 
        : commitSummary;
      
      await gitRPC.request.commit({ message: fullMessage });
      
      // Clear commit fields and reload
      setCommitSummary("");
      setCommitDescription("");
      setNotes([]);
      await loadRepoData();
    } catch (err) {
      console.error("Failed to commit:", err);
      alert(err instanceof Error ? err.message : "Failed to commit");
    } finally {
      setIsCommitting(false);
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedRange(null);
    setNoteText("");
  };

  const checkedFiles = files.filter((f) => f.checked);

  const areAllExpanded = checkedFiles.length > 0 && checkedFiles.every((f) => expandedFiles.has(f.id));

  const toggleAll = () => {
    if (areAllExpanded) {
      collapseAll();
    } else {
      expandAll();
    }
  };

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setIsDarkMode(mediaQuery.matches);
    
    const handler = (e: MediaQueryListEvent) => setIsDarkMode(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // Show repo manager if explicitly requested or no repo available
  if (showRepoManager || (!hasRepo && !isLoading)) {
    return (
      <RepoManager 
        onRepoSelected={handleRepoSelected} 
        homeDir={homeDir} 
      />
    );
  }

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-white dark:bg-gray-900">
        <div className="text-gray-600 dark:text-gray-400 text-lg">Loading repository...</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
      {/* Top Navigation Bar */}
      <div className="h-12 border-b border-gray-200 dark:border-gray-700 flex items-center px-4 gap-4 bg-white dark:bg-gray-900">
        <button 
          onClick={() => setShowRepoManager(true)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm font-medium"
        >
          <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <span>{currentRepo?.name || "better-github-desktop"}</span>
          <svg className="w-3 h-3 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <div className="w-px h-6 bg-gray-200 dark:bg-gray-700" />

        <button className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm">
          <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
          </svg>
          <span className="font-medium">{repoStatus?.branch || "unknown"}</span>
          <svg className="w-3 h-3 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <div className="w-px h-6 bg-gray-200 dark:bg-gray-700" />

        <button className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm">
          <span className={`w-2 h-2 rounded-full ${
            repoStatus?.behind ? "bg-yellow-500" : "bg-green-500"
          }`} />
          <span className="text-gray-600 dark:text-gray-400">
            {repoStatus?.behind 
              ? `${repoStatus.behind} behind` 
              : repoStatus?.ahead 
                ? `${repoStatus.ahead} ahead` 
                : "Up to date"
            }
          </span>
          <svg className="w-3 h-3 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <div className="flex-1" />

        <div className="flex items-center gap-3">
          {notes.length > 0 && (
            <button
              onClick={() => {}}
              className="flex items-center gap-2 px-3 py-1.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                {notes.length}
              </span>
              <span className="text-sm">Notes</span>
            </button>
            )}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar */}
        <div className="w-80 border-r border-gray-200 dark:border-gray-700 flex flex-col bg-gray-50 dark:bg-gray-800">
          <div className="flex border-b border-gray-200 dark:border-gray-700">
            <button
              onClick={() => setActiveTab("changes")}
              className={`flex-1 h-10 text-sm font-medium transition-colors relative flex items-center justify-center ${
                activeTab === "changes" ? "text-gray-900 dark:text-white" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              Changes ({checkedFiles.length})
              {activeTab === "changes" && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-900 dark:bg-gray-100" />}
            </button>
            <button
              onClick={() => setActiveTab("history")}
              className={`flex-1 h-10 text-sm font-medium transition-colors relative flex items-center justify-center ${
                activeTab === "history" ? "text-gray-900 dark:text-white" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              History
              {activeTab === "history" && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-900 dark:bg-gray-100" />}
            </button>
          </div>

          {activeTab === "changes" && (
            <>
              <div className="flex-1 overflow-auto py-2 scrollbar-stable">
                {files.length === 0 ? (
                  <div className="text-center py-8 text-gray-400 dark:text-gray-500">
                    No changes to display
                  </div>
                ) : (
                  files.map((file) => (
                    <FileListItem
                      key={file.id}
                      file={file}
                      isChecked={file.checked}
                      onToggle={() => toggleFile(file.id)}
                      getStatusIcon={getStatusIcon}
                    />
                  ))
                )}
              </div>

              <div className="border-t border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-900">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500" />
                  <input
                      type="text"
                      value={commitSummary}
                      onChange={(e) => setCommitSummary(e.target.value)}
                      placeholder="Summary (required)"
                      className="flex-1 px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-100 focus:border-transparent dark:bg-gray-800 dark:text-white"
                    />
                  </div>
                  <textarea
                    value={commitDescription}
                    onChange={(e) => setCommitDescription(e.target.value)}
                    placeholder="Description"
                    rows={3}
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-100 focus:border-transparent dark:bg-gray-800 dark:text-white mb-3"
                  />
                  <button
                    onClick={handleCommit}
                    disabled={!commitSummary || files.every((f) => !f.checked) || isCommitting}
                    className="w-full py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium rounded-md hover:bg-gray-800 dark:hover:bg-gray-200 disabled:bg-gray-200 dark:disabled:bg-gray-800 disabled:text-gray-400 dark:disabled:text-gray-600 disabled:cursor-not-allowed transition-colors"
                  >
                    {isCommitting ? "Committing..." : `Commit to ${repoStatus?.branch || "branch"}`}
                  </button>
                </div>
              </>
            )}

            {activeTab === "history" && (
              <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-500">
                <div className="text-center">
                  <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-sm">Commit history will appear here</p>
                </div>
              </div>
            )}
          </div>

          {/* Right Content Area - Diffs */}
          <div className="flex-1 bg-white dark:bg-gray-900 flex flex-col overflow-hidden">
            {/* Toolbar */}
            {checkedFiles.length > 0 && (
              <div className="h-10 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 bg-white dark:bg-gray-900 flex-shrink-0">
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {checkedFiles.length} file{checkedFiles.length !== 1 ? 's' : ''}
                </span>
                <div className="flex items-center gap-2">
                  {notes.length > 0 && (
                    <button
                      onClick={handleCopyToLLM}
                      disabled={notes.length === 0}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                        notes.length === 0
                          ? "text-gray-400 cursor-not-allowed"
                          : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                      }`}
                    >
                      {isCopied ? "Copied!" : "Copy notes"}
                    </button>
                    )}
                  <button
                    onClick={() => setDiffStyle(diffStyle === "split" ? "unified" : "split")}
                    className="p-1.5 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
                    title={diffStyle === "split" ? "Switch to inline view" : "Switch to side-by-side view"}
                  >
                    {diffStyle === "split" ? (
                      <Rows className="w-4 h-4" weight="bold" />
                    ) : (
                      <SquaresFour className="w-4 h-4" weight="bold" />
                    )}
                  </button>
                  <button
                    onClick={toggleAll}
                    className="p-1.5 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
                    title={areAllExpanded ? "Collapse all" : "Expand all"}
                  >
                    {areAllExpanded ? (
                      <ArrowsInSimple className="w-4 h-4" weight="bold" />
                    ) : (
                      <ArrowsOutSimple className="w-4 h-4" weight="bold" />
                    )}
                  </button>
                </div>
              </div>
            )}
            <div className="flex-1 overflow-auto scrollbar-stable">
              <div className="pl-3.5 pr-1 pb-6 pt-2 space-y-3">
                {checkedFiles.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500">
                    <div className="text-center">
                      <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <p className="text-lg font-medium text-gray-600 dark:text-gray-400">No files selected</p>
                      <p className="text-sm mt-2">Check files in the sidebar to view diffs</p>
                    </div>
                  </div>
                ) : (
                  <>
                  {checkedFiles.map((file) => (
                    file.isLoaded && (
                      <FileDiffViewer
                        key={file.id}
                        file={file}
                        isExpanded={expandedFiles.has(file.id)}
                        isDarkMode={isDarkMode}
                        diffStyle={diffStyle}
                        onToggleExpand={toggleFileExpand}
                        onLineSelectionEnd={handleLineSelectionEnd}
                        getStatusIcon={getStatusIcon}
                      />
                    )
                    ))}
                  </>
                  )}
                </div>
              </div>
            </div>

            {/* Note Modal */}
            {isModalOpen && selectedRange && (
              <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50">
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg mx-4">
                  <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Add Note</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      {selectedRange.fileName} • Lines {selectedRange.range?.start}-{selectedRange.range?.end}
                      {selectedRange.range?.side && ` (${selectedRange.range.side})`}
                    </p>
                  </div>
                  <div className="p-6">
                    <textarea
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      placeholder="Enter your note about this code..."
                      className="w-full h-32 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg resize-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-100 focus:border-transparent outline-none dark:bg-gray-700 dark:text-white"
                      autoFocus
                    />
                  </div>
                  <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
                    <button
                      onClick={closeModal}
                      className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveNote}
                      disabled={!noteText.trim()}
                      className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                        noteText.trim() ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200" : "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed"
                      }`}
                    >
                      Save Note
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Notes Panel */}
            {notes.length > 0 && (
              <div className="fixed right-4 bottom-4 w-80 max-h-[60vh] overflow-auto bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-4 z-20">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900 dark:text-white">Notes ({notes.length})</h3>
                </div>
                <div className="space-y-3">
                  {notes.map((note) => (
                    <div key={note.id} className="p-3 bg-gray-50 dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600 text-sm">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-gray-700 dark:text-gray-300">{note.fileName.split("/").pop()}</span>
                        <button
                          onClick={() => handleDeleteNote(note.id)}
                          className="text-red-500 hover:text-red-700"
                        >
                          ×
                        </button>
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                        Lines {note.startLine}-{note.endLine}{note.side && ` (${note.side})`}
                      </div>
                      <p className="text-gray-800 dark:text-gray-200">{note.note}</p>
                    </div>
                  ))}
                  </div>
                </div>
              )}
            </div>
          </div>
  );
}

export default App;
