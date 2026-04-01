import { useState, useCallback, useEffect } from "react";
import { FileDiff } from "@pierre/diffs/react";
import { parseDiffFromFile } from "@pierre/diffs";
import type { SelectedLineRange, FileContents, FileDiffMetadata } from "@pierre/diffs";
import { ArrowsInSimple, ArrowsOutSimple } from "@phosphor-icons/react";

interface FileChange {
	id: string;
	name: string;
	checked: boolean;
	status: "modified" | "added" | "deleted" | "untracked";
	oldFile: FileContents | null;
	newFile: FileContents;
}

interface Note {
	id: string;
	fileName: string;
	startLine: number;
	endLine: number;
	side: "deletions" | "additions" | null;
	note: string;
}

// Complete file contents for UserService - old version
const USER_SERVICE_OLD: FileContents = {
	name: "src/services/UserService.ts",
	contents: `import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from '../entities/User';
import { EmailService } from './EmailService';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    private emailService: EmailService,
  ) {}

  async findById(id: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { email } });
  }

  async create(data: CreateUserDto): Promise<User> {
    const user = this.userRepo.create(data);
    return this.userRepo.save(user);
  }

  async update(id: string, data: UpdateUserDto): Promise<User> {
    const user = await this.findById(id);
    if (!user) {
      throw new Error('User not found');
    }
    Object.assign(user, data);
    return this.userRepo.save(user);
  }

  async delete(id: string): Promise<void> {
    const user = await this.findById(id);
    if (!user) throw new Error('User not found');
    await this.userRepo.remove(user);
  }
}`,
};

// Complete file contents for UserService - new version with Redis and Logger
const USER_SERVICE_NEW: FileContents = {
	name: "src/services/UserService.ts",
	contents: `import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from '../entities/User';
import { EmailService } from './EmailService';
import { RedisService } from './RedisService';
import { LoggerService } from './LoggerService';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    private redis: RedisService,
    private logger: LoggerService,
    private emailService: EmailService,
  ) {}

  async findById(id: string): Promise<User | null> {
    this.logger.log('Finding user: ' + id);
    const cached = await this.redis.get('user:' + id);
    if (cached) return JSON.parse(cached);
    const user = await this.userRepo.findOne({ where: { id } });
    if (user) await this.redis.setex('user:' + id, 3600, JSON.stringify(user));
    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { email } });
  }

  async create(data: CreateUserDto): Promise<User> {
    this.logger.log('Creating user: ' + data.email);
    const user = this.userRepo.create(data);
    const saved = await this.userRepo.save(user);
    await this.redis.setex('user:' + saved.id, 3600, JSON.stringify(saved));
    return saved;
  }

  async update(id: string, data: UpdateUserDto): Promise<User> {
    const user = await this.findById(id);
    if (!user) {
      throw new Error('User not found');
    }
    Object.assign(user, data);
    return this.userRepo.save(user);
  }

  async delete(id: string): Promise<void> {
    this.logger.log('Deleting user: ' + id);
    const user = await this.findById(id);
    if (!user) throw new Error('User not found');
    await this.userRepo.remove(user);
    await this.redis.del('user:' + id);
  }
}`,
};

// Complete file contents for ApiService - old version
const API_SERVICE_OLD: FileContents = {
	name: "src/services/ApiService.ts",
	contents: `import axios from 'axios';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3000';

export interface ApiConfig {
  baseURL: string;
  timeout: number;
}

export class ApiService {
  private client = axios.create({
    baseURL: API_BASE_URL,
    timeout: 30000,
  });

  constructor(
    private config: ApiConfig,
  ) {}

  async get<T>(path: string): Promise<T> {
    const response = await this.client.get<T>(path);
    return response.data;
  }

  async post<T>(path: string, data: unknown): Promise<T> {
    const response = await this.client.post<T>(path, data);
    return response.data;
  }

  async put<T>(path: string, data: unknown): Promise<T> {
    const response = await this.client.put<T>(path, data);
    return response.data;
  }

  async delete<T>(path: string): Promise<T> {
    const response = await this.client.delete<T>(path);
    return response.data;
  }

  private handleError(error: unknown): never {
    if (axios.isAxiosError(error)) {
      throw new Error(error.response?.data?.message || error.message);
    }
    throw error;
  }
}`,
};

// Complete file contents for ApiService - new version with metrics
const API_SERVICE_NEW: FileContents = {
	name: "src/services/ApiService.ts",
	contents: `import axios from 'axios';
import { MetricsService } from './MetricsService';
import { ErrorReporter } from './ErrorReporter';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3000';

export interface ApiConfig {
  baseURL: string;
  timeout: number;
}

export class ApiService {
  private client = axios.create({
    baseURL: API_BASE_URL,
    timeout: 30000,
    headers: {
      'X-API-Version': 'v2',
    }
  });

  constructor(
    private config: ApiConfig,
    private metrics: MetricsService,
    private errorReporter: ErrorReporter,
  ) {}

  async get<T>(path: string): Promise<T> {
    const response = await this.client.get<T>(path);
    return response.data;
  }

  async post<T>(path: string, data: unknown): Promise<T> {
    this.metrics.increment('api.post');
    const response = await this.client.post<T>(path, data);
    this.metrics.timing('api.post.duration', response.config.timeout || 0);
    return response.data;
  }

  async put<T>(path: string, data: unknown): Promise<T> {
    const response = await this.client.put<T>(path, data);
    return response.data;
  }

  async delete<T>(path: string): Promise<T> {
    const response = await this.client.delete<T>(path);
    return response.data;
  }

  private handleError(error: unknown): never {
    this.errorReporter.report(error);
    if (axios.isAxiosError(error)) {
      this.metrics.increment('api.error');
      throw new Error(error.response?.data?.message || error.message);
    }
    this.metrics.increment('api.unknown_error');
    throw error;
  }
}`,
};

// New auth hook file (no old version since it's added)
const AUTH_HOOK_NEW: FileContents = {
	name: "src/hooks/useAuth.ts",
	contents: `import { useState, useEffect, createContext, useContext } from 'react';

interface User {
  id: string;
  email: string;
  name: string;
}

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      validateToken(token).then(setUser).finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  const login = async (email: string, password: string) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    const { token, user } = await response.json();
    localStorage.setItem('auth_token', token);
    setUser(user);
  };

  const logout = () => {
    localStorage.removeItem('auth_token');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

async function validateToken(token: string): Promise<User> {
  const response = await fetch('/api/auth/validate', {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!response.ok) {
    localStorage.removeItem('auth_token');
    throw new Error('Invalid token');
  }
  return response.json();
}`,
};

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
	onToggleExpand: (id: string) => void;
	onLineSelectionEnd: (fileName: string) => (range: SelectedLineRange | null) => void;
	getStatusIcon: (status: FileChange["status"]) => React.ReactNode;
}

// Separate component to handle diff computation properly
function FileDiffViewer({ file, isExpanded, isDarkMode, onToggleExpand, onLineSelectionEnd, getStatusIcon }: FileDiffViewerProps) {
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
						diffStyle: "split",
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

function App() {
	const [activeTab, setActiveTab] = useState<"changes" | "history">("changes");
	const [files, setFiles] = useState<FileChange[]>([
		{ id: "1", name: "src/services/UserService.ts", checked: true, status: "modified", oldFile: USER_SERVICE_OLD, newFile: USER_SERVICE_NEW },
		{ id: "2", name: "src/services/ApiService.ts", checked: true, status: "modified", oldFile: API_SERVICE_OLD, newFile: API_SERVICE_NEW },
		{ id: "3", name: "src/hooks/useAuth.ts", checked: false, status: "added", oldFile: null, newFile: AUTH_HOOK_NEW },
	]);
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
	const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set(["1", "2", "3"]));
	const [isDarkMode, setIsDarkMode] = useState(false);

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

		let markdown = "# Code Review Notes\\n\\n";
		
		const groupedNotes = notes.reduce((acc, note) => {
			if (!acc[note.fileName]) acc[note.fileName] = [];
			acc[note.fileName].push(note);
			return acc;
		}, {} as Record<string, Note[]>);

		Object.entries(groupedNotes).forEach(([fileName, fileNotes]) => {
			markdown += `## ${fileName}\\n\\n`;
			fileNotes.forEach((note, index) => {
				markdown += `### Comment ${index + 1} (Lines ${note.startLine}-${note.endLine}${note.side ? ` - ${note.side}` : ""})\\n\\n`;
				markdown += `${note.note}\\n\\n`;
				markdown += "---\\n\\n";
			});
		});

		navigator.clipboard.writeText(markdown);
		setIsCopied(true);
		setTimeout(() => setIsCopied(false), 2000);
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

	return (
		<div className="h-screen flex flex-col bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
			{/* Top Navigation Bar */}
			<div className="h-12 border-b border-gray-200 dark:border-gray-700 flex items-center px-4 gap-4 bg-white dark:bg-gray-900">
				<button className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm font-medium">
					<svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
					</svg>
					<span>better-github-desktop</span>
					<svg className="w-3 h-3 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
					</svg>
				</button>

				<div className="w-px h-6 bg-gray-200 dark:bg-gray-700" />

				<button className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm">
					<svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
					</svg>
					<span className="font-medium">feature/ui-redesign</span>
					<svg className="w-3 h-3 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
					</svg>
				</button>

				<div className="w-px h-6 bg-gray-200 dark:bg-gray-700" />

				<button className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm">
					<span className="w-2 h-2 rounded-full bg-green-500" />
					<span className="text-gray-600 dark:text-gray-400">Up to date</span>
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
								{files.map((file) => (
									<FileListItem
										key={file.id}
										file={file}
										isChecked={file.checked}
										onToggle={() => toggleFile(file.id)}
										getStatusIcon={getStatusIcon}
									/>
								))}
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
										disabled={!commitSummary || files.every((f) => !f.checked)}
										className="w-full py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium rounded-md hover:bg-gray-800 dark:hover:bg-gray-200 disabled:bg-gray-200 dark:disabled:bg-gray-800 disabled:text-gray-400 dark:disabled:text-gray-600 disabled:cursor-not-allowed transition-colors"
									>
										Commit to feature/ui-redesign
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
										<FileDiffViewer
											key={file.id}
											file={file}
											isExpanded={expandedFiles.has(file.id)}
											isDarkMode={isDarkMode}
											onToggleExpand={toggleFileExpand}
											onLineSelectionEnd={handleLineSelectionEnd}
											getStatusIcon={getStatusIcon}
										/>
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