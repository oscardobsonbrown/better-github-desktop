// Git service for tracking repository changes
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { FileContents } from "@pierre/diffs";

export interface GitFileChange {
  path: string;
  status: "modified" | "added" | "deleted" | "untracked" | "renamed" | "copied" | "staged";
  oldPath?: string;
}

export interface GitStatus {
	branch: string;
	ahead: number;
	behind: number;
	files: GitFileChange[];
}

export class GitService {
	private repoPath: string;

	constructor(repoPath: string = process.cwd()) {
		this.repoPath = repoPath;
	}

	isGitRepository(): boolean {
		return existsSync(join(this.repoPath, ".git"));
	}

	getStatus(): GitStatus {
		if (!this.isGitRepository()) {
			throw new Error("Not a git repository");
		}

		// Get current branch and tracking info
		const branchOutput = this.execGit([
			"rev-parse",
			"--abbrev-ref",
			"HEAD",
		]);
		const branch = branchOutput.trim() || "HEAD";

		// Get ahead/behind count
		let ahead = 0;
		let behind = 0;
		try {
			const trackingOutput = this.execGit([
				"rev-list",
				"--left-right",
				"--count",
				`HEAD...@{upstream}`,
			]);
			const [a, b] = trackingOutput.trim().split("\\t").map(Number);
			ahead = a || 0;
			behind = b || 0;
		} catch {
			// No upstream branch
		}

		// Get file status
		const statusOutput = this.execGit([
			"status",
			"--porcelain",
			"-u", // Show untracked files
		]);

    const files: GitFileChange[] = [];
    for (const line of statusOutput.split("\n")) {
      if (!line.trim()) continue;

      const indexStatus = line[0]; // Staging area status
      const workTreeStatus = line[1]; // Working tree status
      const filePath = line.substring(3).trim();

      // Parse status code - prioritize working tree, but mark as staged if index has changes
      let status: GitFileChange["status"];
      
      if (workTreeStatus === "?" || indexStatus === "?") {
        status = "untracked";
      } else if (workTreeStatus === "A" || indexStatus === "A") {
        status = indexStatus === "A" && workTreeStatus === " " ? "staged" : "added";
      } else if (workTreeStatus === "D" || indexStatus === "D") {
        status = indexStatus === "D" && workTreeStatus === " " ? "staged" : "deleted";
      } else if (workTreeStatus === "M" || indexStatus === "M") {
        status = indexStatus === "M" && workTreeStatus === " " ? "staged" : "modified";
      } else if (workTreeStatus === "R" || indexStatus === "R") {
        status = "renamed";
      } else if (workTreeStatus === "C" || indexStatus === "C") {
        status = "copied";
      } else {
        status = "modified";
      }

      // Handle renames
      if (status === "renamed" && filePath.includes(" -> ")) {
        const [oldPath, newPath] = filePath.split(" -> ");
        files.push({ path: newPath, status, oldPath });
      } else {
        files.push({ path: filePath, status });
      }
    }

		return { branch, ahead, behind, files };
	}

	getFileDiff(filePath: string): { oldFile: FileContents | null; newFile: FileContents } {
		if (!this.isGitRepository()) {
			throw new Error("Not a git repository");
		}

		console.log(`Getting diff for file: ${filePath}`);

		// Check if file is tracked
		let isTracked = false;
		let isStaged = false;
		try {
			const trackedOutput = this.execGit(["ls-files", filePath]);
			isTracked = trackedOutput.trim() !== "";
			console.log(`File ${filePath} is tracked: ${isTracked}`);
			
			// Check if file has staged changes
			if (isTracked) {
				try {
					const diffOutput = this.execGit(["diff", "--cached", "--name-only", filePath]);
					isStaged = diffOutput.trim() !== "";
					console.log(`File ${filePath} has staged changes: ${isStaged}`);
				} catch {
					isStaged = false;
				}
			}
		} catch (err) {
			console.log(`Error checking if file is tracked: ${err}`);
		}

		let oldContent: string | null = null;
		let newContent: string;

		if (isTracked) {
			// Get old version from HEAD
			try {
				oldContent = this.execGit(["show", `HEAD:${filePath}`]);
				console.log(`Got old content for ${filePath} from HEAD, length: ${oldContent.length}`);
			} catch (err) {
				console.log(`Could not get old content for ${filePath} from HEAD: ${err}`);
				// File might be new in this commit
				oldContent = null;
			}
		}

		// For new content, ALWAYS read from the working directory file system
		// git show :./path reads from staging area, which may not have changes
		try {
			const fullPath = `${this.repoPath}/${filePath}`;
			newContent = readFileSync(fullPath, "utf-8");
			console.log(`Got new content for ${filePath} from working directory, length: ${newContent.length}`);
		} catch (err) {
			console.log(`Could not read ${filePath} from working directory: ${err}`);
			// File doesn't exist in working tree (deleted)
			// Fall back to staged version
			try {
				newContent = this.execGit(["show", `:./${filePath}`]);
				console.log(`Falling back to staged version for ${filePath}, length: ${newContent.length}`);
			} catch {
				newContent = "";
			}
		}

		console.log(`Returning diff for ${filePath} - old: ${oldContent ? "yes" : "no"}, new: ${newContent ? "yes" : "no"}`);

		return {
			oldFile: oldContent !== null ? { name: filePath, contents: oldContent } : null,
			newFile: { name: filePath, contents: newContent },
		};
	}

	getStagedFileDiff(filePath: string): { oldFile: FileContents | null; newFile: FileContents } {
		if (!this.isGitRepository()) {
			throw new Error("Not a git repository");
		}

		// Get old version from HEAD
		let oldContent: string | null = null;
		try {
			oldContent = this.execGit(["show", `HEAD:${filePath}`]);
		} catch {
			// File is new
			oldContent = null;
		}

		// Get staged version
		let newContent: string;
		try {
			newContent = this.execGit(["show", `:0:${filePath}`]);
		} catch {
			newContent = "";
		}

		return {
			oldFile: oldContent !== null ? { name: filePath, contents: oldContent } : null,
			newFile: { name: filePath, contents: newContent },
		};
	}

	stageFile(filePath: string): void {
		this.execGit(["add", filePath]);
	}

	unstageFile(filePath: string): void {
		this.execGit(["reset", "HEAD", filePath]);
	}

	commit(message: string): void {
		this.execGit(["commit", "-m", message]);
	}

	getCommitHistory(count: number = 20): Array<{
		hash: string;
		message: string;
		author: string;
		date: string;
	}> {
		const output = this.execGit([
			"log",
			`-${count}`,
			"--pretty=format:%H|%s|%an|%ai",
		]);

    return output.split("\n").map((line) => {
			const [hash, message, author, date] = line.split("|");
			return { hash, message, author, date };
		});
	}

	private execGit(args: string[]): string {
		const command = `git ${args.join(" ")}`;
		try {
			return execSync(command, {
				cwd: this.repoPath,
				encoding: "utf-8",
				maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large files
			});
		} catch (error: any) {
			throw new Error(`Git command failed: ${command}\\n${error.message}`);
		}
	}
}

// Singleton instance
let gitService: GitService | null = null;

export function getGitService(repoPath?: string): GitService {
	if (!gitService || repoPath) {
		gitService = new GitService(repoPath);
	}
	return gitService;
}
