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

	getCommitHistory(count: number = 50): Array<{
		hash: string;
		message: string;
		author: string;
		date: string;
		branches: string[];
		isHead: boolean;
	}> {
		// Get commit log with graph
		const logOutput = this.execGit([
			"log",
			"--all",
			"--graph",
			"--decorate",
			"--oneline",
			"--format='%H|%s|%an|%ai|%D'",
			`-${count}`,
		]);

		const lines = logOutput.split("\n").filter(line => line.trim());
		
		return lines.map((line) => {
			// Strip leading/trailing quotes if present
			const cleanLine = line.replace(/^'|'$/g, "");
			const parts = cleanLine.split("|");
			// Handle the graph characters at the start
			const hash = parts[0]?.replace(/^[\s*|\/\\-]+/, "").trim() || "";
			const message = parts[1] || "";
			const author = parts[2] || "";
			const date = parts[3] || "";
			const decorations = parts[4] || "";
			
			// Parse branches from decorations
			const branches: string[] = [];
			const isHead = decorations.includes("HEAD");
			
			// Extract branch names from decorations (format: "HEAD -> branch-name, origin/branch-name")
			const branchMatch = decorations.match(/(?:HEAD -> )?([^,\s]+)/g);
			if (branchMatch) {
				branchMatch.forEach(b => {
					if (!b.includes("HEAD")) {
						branches.push(b.replace("origin/", ""));
					}
				});
			}
			
			return { hash, message, author, date, branches, isHead };
		}).filter(c => c.hash);
	}

	getBranches(): Array<{
		name: string;
		isCurrent: boolean;
		isRemote: boolean;
		ahead: number;
		behind: number;
	}> {
		// Get branch list with verbose info
		const output = this.execGit([
			"branch",
			"-vv",
		]);

		return output.split("\n").filter(line => line.trim()).map((line) => {
			// Parse line like: * main                abc1234 [origin/main: ahead 2, behind 1] commit message
			// or:   feature            abc1234 commit message
			const isCurrent = line.trim().startsWith("*");
			const cleanLine = line.replace(/^\*?\s*/, "");
			
			// Extract branch name (first word)
			const nameMatch = cleanLine.match(/^(\S+)/);
			const name = nameMatch ? nameMatch[1] : "";
			
			// Check if remote branch
			const isRemote = name.startsWith("origin/");
			
			// Extract ahead/behind from bracket notation [origin/main: ahead 2, behind 1]
			let ahead = 0;
			let behind = 0;
			const bracketMatch = cleanLine.match(/\[.+?:\s*(ahead\s*(\d+))?\s*,?\s*(behind\s*(\d+))?\]/);
			if (bracketMatch) {
				ahead = parseInt(bracketMatch[2]) || 0;
				behind = parseInt(bracketMatch[4]) || 0;
			}
			
			return {
				name,
				isCurrent,
				isRemote,
				ahead,
				behind,
			};
		});
	}

	getCommitGraph(offset: number = 0, count: number = 100): Array<{
		hash: string;
		message: string;
		author: string;
		date: string;
		parents: string[];
		branches: string[];
		isHead: boolean;
	}> {
		// Get log with parent hashes for building graph structure
		const logOutput = this.execGit([
			"log",
			"--all",
			"--decorate",
			"--format='%H|%P|%s|%an|%ai|%D'",
			"--skip", offset.toString(),
			"-n", count.toString(),
		]);

		const lines = logOutput.split("\n").filter(line => line.trim());
		
		return lines.map((line) => {
			// Strip leading/trailing quotes if present
			const cleanLine = line.replace(/^'|'$/g, "");
			const parts = cleanLine.split("|");
			
			const hash = parts[0] || "";
			const parents = parts[1] ? parts[1].split(" ").filter(p => p) : [];
			const message = parts[2] || "";
			const author = parts[3] || "";
			const date = parts[4] || "";
			const decorations = parts[5] || "";
			
			// Parse branches from decorations
			const branches: string[] = [];
			const isHead = decorations.includes("HEAD");
			
			// Extract branch names from decorations
			const branchMatches = decorations.match(/(?:HEAD\s*->\s*)?([^,\s(]+)/g);
			if (branchMatches) {
				branchMatches.forEach(b => {
					const cleanBranch = b.replace("HEAD -> ", "").replace("origin/", "").trim();
					if (cleanBranch && !cleanBranch.includes("tag:") && !branches.includes(cleanBranch)) {
						branches.push(cleanBranch);
					}
				});
			}
			
			return { hash, message, author, date, parents, branches, isHead };
		}).filter(c => c.hash);
	}

	getCommitDetails(hash: string): {
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
	} | null {
		try {
			// Get commit info
			const infoOutput = this.execGit([
				"show",
				"--format='%H|%s|%b|%an|%ae|%ai'",
				"--no-patch",
				hash,
			]);
			
			const infoLine = infoOutput.replace(/^'|'$/g, "");
			const [commitHash, subject, body, author, authorEmail, date] = infoLine.split("|");
			
			// Get file changes
			const statOutput = this.execGit([
				"show",
				"--format=''",
				"--stat",
				hash,
			]);
			
			// Parse stats
			let filesChanged = 0;
			let insertions = 0;
			let deletions = 0;
			
			const statMatch = statOutput.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/);
			if (statMatch) {
				filesChanged = parseInt(statMatch[1]) || 0;
				insertions = parseInt(statMatch[2]) || 0;
				deletions = parseInt(statMatch[3]) || 0;
			}
			
			// Parse file list
			const files: Array<{path: string; status: string; additions: number; deletions: number}> = [];
			const fileLines = statOutput.split("\n").filter(l => l.includes("|"));
			fileLines.forEach(line => {
				const match = line.match(/^(.+)\s*\|\s*(\d+)\s*([\-+]*)/);
				if (match) {
					const path = match[1].trim();
					const changes = match[2];
					const signs = match[3];
					const adds = (signs.match(/\+/g) || []).length;
					const dels = (signs.match(/-/g) || []).length;
					files.push({
						path,
						status: "modified", // Could be improved by checking actual status
						additions: adds || parseInt(changes) || 0,
						deletions: dels || 0,
					});
				}
			});
			
			return {
				hash: commitHash || hash,
				message: subject || "",
				body: body || "",
				author: author || "",
				authorEmail: authorEmail || "",
				date: date || "",
				files,
				stats: {
					filesChanged,
					insertions,
					deletions,
				},
			};
		} catch (error) {
			console.error("Failed to get commit details:", error);
			return null;
		}
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
