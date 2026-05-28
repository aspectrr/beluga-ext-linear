// ── Linear Extension ──────────────────────────────────────────
// Linear integration for Beluga. Uses Linear's GraphQL API to
// list/search/create/update issues, add comments, and list teams.
// 7 tools registered.

import type {
	Extension,
	ExtensionContext,
	Tool,
	ToolDef,
	ToolContext,
} from "@aspectrr/beluga-sdk";
import type { Logger } from "pino";

// ── Config ─────────────────────────────────────────────────────

interface LinearConfig {
	enabled: boolean;
	api_key: string;
	team_id?: string;
	base_url?: string;
}

// ── Types ──────────────────────────────────────────────────────

interface LinearTeam {
	id: string;
	name: string;
	key: string;
	description?: string;
}

interface LinearState {
	id: string;
	name: string;
	type: string;
	color: string;
}

interface LinearUser {
	id: string;
	name: string;
	email: string;
	displayName?: string;
	avatarUrl?: string;
}

interface LinearLabel {
	id: string;
	name: string;
	color: string;
}

interface LinearIssue {
	id: string;
	identifier: string;
	title: string;
	description?: string;
	priority?: number;
	priorityLabel?: string;
	url: string;
	createdAt: string;
	updatedAt: string;
	state?: LinearState;
	assignee?: LinearUser;
	creator?: LinearUser;
	labels?: { nodes: LinearLabel[] };
	team?: LinearTeam;
	dueDate?: string;
	estimate?: number;
}

interface LinearComment {
	id: string;
	body: string;
	createdAt: string;
	user?: LinearUser;
}

// ── GraphQL helpers ────────────────────────────────────────────

interface GQLResponse<T> {
	data?: T;
	errors?: Array<{ message: string; path?: string[] }>;
}

function gql(strings: TemplateStringsArray): string {
	return strings[0];
}

function priorityNumber(label: string): number | undefined {
	const map: Record<string, number> = {
		urgent: 1,
		high: 2,
		medium: 3,
		low: 4,
		no_priority: 0,
	};
	return map[label.toLowerCase()];
}

function priorityLabel(num: number | undefined | null): string {
	const map: Record<number, string> = {
		0: "No priority",
		1: "Urgent",
		2: "High",
		3: "Medium",
		4: "Low",
	};
	return map[num ?? 0] ?? "No priority";
}

// ── Linear API Client ──────────────────────────────────────────

class LinearClient {
	private apiKey: string;
	private baseUrl: string;
	private logger: Logger;

	constructor(apiKey: string, baseUrl: string, logger: Logger) {
		this.apiKey = apiKey;
		this.baseUrl = baseUrl;
		this.logger = logger;
	}

	async query<T>(queryStr: string, variables?: Record<string, unknown>): Promise<T> {
		const resp = await fetch(this.baseUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: this.apiKey,
			},
			body: JSON.stringify({ query: queryStr, variables }),
		});

		if (!resp.ok) {
			const text = await resp.text();
			throw new Error(`Linear API ${resp.status}: ${text}`);
		}

		const json = (await resp.json()) as GQLResponse<T>;
		if (json.errors?.length) {
			const msg = json.errors.map((e) => e.message).join("; ");
			throw new Error(`Linear GraphQL error: ${msg}`);
		}
		return json.data as T;
	}
}

// ── Fragment: issue fields ─────────────────────────────────────

const ISSUE_FIELDS = gql`
	fragment IssueFields on Issue {
		id
		identifier
		title
		description
		priority
		url
		createdAt
		updatedAt
		dueDate
		estimate
		state { id name type color }
		assignee { id name displayName email avatarUrl }
		creator { id name displayName email avatarUrl }
		labels { nodes { id name color } }
		team { id name key }
	}
`;

// ── Tool: list_teams ───────────────────────────────────────────

class ListTeamsTool implements Tool {
	private client: LinearClient;

	constructor(client: LinearClient) {
		this.client = client;
	}

	definition(): ToolDef {
		return {
			name: "linear_list_teams",
			description:
				"List all Linear teams the authenticated user has access to. Returns team ID, name, key, and description.",
			parameters: {
				type: "object",
				properties: {},
			},
		};
	}

	async execute(
		_args: Record<string, unknown>,
		_ctx: ToolContext,
	): Promise<Record<string, unknown>> {
		const data = await this.client.query<{ teams: { nodes: LinearTeam[] } }>(`
			query ListTeams {
				teams { nodes { id name key description } }
			}
		`);
		return { teams: data.teams.nodes };
	}
}

// ── Tool: list_issues ──────────────────────────────────────────

class ListIssuesTool implements Tool {
	private client: LinearClient;
	private defaultTeamId?: string;

	constructor(client: LinearClient, defaultTeamId?: string) {
		this.client = client;
		this.defaultTeamId = defaultTeamId;
	}

	definition(): ToolDef {
		return {
			name: "linear_list_issues",
			description:
				"List issues in a Linear team. Supports filtering by status, assignee, priority, and label.",
			parameters: {
				type: "object",
				properties: {
					team_id: {
						type: "string",
						description: "Team ID (defaults to configured team)",
					},
					status: {
						type: "string",
						description: "Filter by status name (e.g. 'In Progress', 'Done', 'Backlog')",
					},
					assignee_email: {
						type: "string",
						description: "Filter by assignee email",
					},
					priority: {
						type: "string",
						description: "Filter by priority: urgent, high, medium, low, no_priority",
					},
					label: {
						type: "string",
						description: "Filter by label name",
					},
					limit: {
						type: "integer",
						description: "Max issues to return (default 25)",
					},
					include_closed: {
						type: "boolean",
						description: "Include completed/cancelled issues (default false)",
					},
				},
			},
		};
	}

	async execute(
		args: Record<string, unknown>,
		_ctx: ToolContext,
	): Promise<Record<string, unknown>> {
		const teamId = (args.team_id as string) || this.defaultTeamId;
		if (!teamId) throw new Error("team_id is required (or configure a default team)");

		const limit = (args.limit as number) || 25;
		const filterParts: string[] = [];
		filterParts.push(`team: { id: { eq: "${teamId}" } }`);

		if (args.status) {
			const status = String(args.status);
			filterParts.push(`state: { name: { eq: "${status}" } }`);
		}
		if (args.assignee_email) {
			filterParts.push(`assignee: { email: { eq: "${args.assignee_email}" } }`);
		}
		if (args.priority) {
			const pNum = priorityNumber(String(args.priority));
			if (pNum !== undefined) filterParts.push(`priority: { eq: ${pNum} }`);
		}
		if (args.label) {
			filterParts.push(`labels: { name: { eq: "${args.label}" } }`);
		}
		if (!args.include_closed) {
			filterParts.push(`state: { type: { neq: "completed" } }`);
		}

		const filter = `{ ${filterParts.join(", ")} }`;

		const data = await this.client.query<{ issues: { nodes: LinearIssue[] } }>(`
			${ISSUE_FIELDS}
			query ListIssues {
				issues(filter: ${filter}, first: ${limit}, orderBy: updatedAt) {
					nodes { ...IssueFields }
				}
			}
		`);

		return {
			issues: data.issues.nodes.map((i) => ({
				...i,
				priorityLabel: priorityLabel(i.priority),
			})),
		};
	}
}

// ── Tool: get_issue ────────────────────────────────────────────

class GetIssueTool implements Tool {
	private client: LinearClient;

	constructor(client: LinearClient) {
		this.client = client;
	}

	definition(): ToolDef {
		return {
			name: "linear_get_issue",
			description:
				"Get full details for a Linear issue by ID or identifier (e.g. 'ENG-123'). Includes description, comments, and metadata.",
			parameters: {
				type: "object",
				properties: {
					issue_id: {
						type: "string",
						description: "Issue ID (UUID) or identifier (e.g. 'ENG-123')",
					},
				},
				required: ["issue_id"],
			},
		};
	}

	async execute(
		args: Record<string, unknown>,
		_ctx: ToolContext,
	): Promise<Record<string, unknown>> {
		const issueId = String(args.issue_id);
		const isUuid = issueId.includes("-");

		let issueData: { issue: LinearIssue };
		if (isUuid) {
			issueData = await this.client.query<{ issue: LinearIssue }>(`
				${ISSUE_FIELDS}
				query GetIssue {
					issue(id: "${issueId}") { ...IssueFields }
				}
			`);
		} else {
			issueData = await this.client.query<{ issue: LinearIssue }>(`
				${ISSUE_FIELDS}
				query GetIssueByIdentifier {
					issue(identifier: "${issueId}") { ...IssueFields }
				}
			`);
		}

		if (!issueData.issue) throw new Error(`issue not found: ${issueId}`);

		// Fetch comments
		const commentData = await this.client.query<{
			issue: { comments: { nodes: LinearComment[] } };
		}>(`
			query IssueComments {
				issue(id: "${issueData.issue.id}") {
					comments(first: 50) {
						nodes {
							id body createdAt
							user { id name displayName avatarUrl }
						}
					}
				}
			}
		`);

		return {
			issue: {
				...issueData.issue,
				priorityLabel: priorityLabel(issueData.issue.priority),
			},
			comments: commentData.issue?.comments?.nodes ?? [],
		};
	}
}

// ── Tool: create_issue ─────────────────────────────────────────

class CreateIssueTool implements Tool {
	private client: LinearClient;
	private defaultTeamId?: string;

	constructor(client: LinearClient, defaultTeamId?: string) {
		this.client = client;
		this.defaultTeamId = defaultTeamId;
	}

	definition(): ToolDef {
		return {
			name: "linear_create_issue",
			description:
				"Create a new Linear issue. Requires title. Team ID defaults to configured team.",
			parameters: {
				type: "object",
				properties: {
					title: { type: "string", description: "Issue title" },
					description: { type: "string", description: "Issue description (markdown)" },
					team_id: { type: "string", description: "Team ID (defaults to configured team)" },
					priority: {
						type: "string",
						description: "Priority: urgent, high, medium, low",
					},
					assignee_email: {
						type: "string",
						description: "Assignee email",
					},
					label_ids: {
						type: "array",
						items: { type: "string" },
						description: "Label IDs to apply",
					},
					due_date: {
						type: "string",
						description: "Due date (YYYY-MM-DD)",
					},
					estimate: {
						type: "integer",
						description: "Effort estimate",
					},
				},
				required: ["title"],
			},
		};
	}

	async execute(
		args: Record<string, unknown>,
		_ctx: ToolContext,
	): Promise<Record<string, unknown>> {
		const teamId = (args.team_id as string) || this.defaultTeamId;
		if (!teamId) throw new Error("team_id is required (or configure a default team)");

		const title = String(args.title);
		if (!title) throw new Error("title is required");

		const inputParts: string[] = [];
		inputParts.push(`title: ${JSON.stringify(title)}`);
		inputParts.push(`teamId: ${JSON.stringify(teamId)}`);

		if (args.description) inputParts.push(`description: ${JSON.stringify(String(args.description))}`);
		if (args.priority) {
			const pNum = priorityNumber(String(args.priority));
			if (pNum !== undefined && pNum > 0) inputParts.push(`priority: ${pNum}`);
		}
		if (args.due_date) inputParts.push(`dueDate: ${JSON.stringify(String(args.due_date))}`);
		if (args.estimate) inputParts.push(`estimate: ${Number(args.estimate)}`);
		if (args.label_ids && Array.isArray(args.label_ids) && args.label_ids.length > 0) {
			const ids = args.label_ids.map((id: unknown) => JSON.stringify(String(id))).join(", ");
			inputParts.push(`labelIds: [${ids}]`);
		}

		// If assignee_email provided, resolve to user ID first
		if (args.assignee_email) {
			const userData = await this.client.query<{
				users: { nodes: LinearUser[] };
			}>(`
				query FindUser {
					users(filter: { email: { eq: ${JSON.stringify(String(args.assignee_email))} } }, first: 1) {
						nodes { id name email }
					}
				}
			`);
			const user = userData.users.nodes[0];
			if (user) inputParts.push(`assigneeId: ${JSON.stringify(user.id)}`);
		}

		const input = `{ ${inputParts.join(", ")} }`;

		const data = await this.client.query<{
			issueCreate: { success: boolean; issue: LinearIssue };
		}>(`
			${ISSUE_FIELDS}
			mutation CreateIssue {
				issueCreate(input: ${input}) {
					success
					issue { ...IssueFields }
				}
			}
		`);

		if (!data.issueCreate.success) throw new Error("failed to create issue");

		return {
			issue: {
				...data.issueCreate.issue,
				priorityLabel: priorityLabel(data.issueCreate.issue.priority),
			},
		};
	}
}

// ── Tool: update_issue ─────────────────────────────────────────

class UpdateIssueTool implements Tool {
	private client: LinearClient;

	constructor(client: LinearClient) {
		this.client = client;
	}

	definition(): ToolDef {
		return {
			name: "linear_update_issue",
			description:
				"Update an existing Linear issue. Can change title, description, status, priority, assignee, labels, due date, and estimate.",
			parameters: {
				type: "object",
				properties: {
					issue_id: {
						type: "string",
						description: "Issue ID (UUID) or identifier (e.g. 'ENG-123')",
					},
					title: { type: "string", description: "New title" },
					description: { type: "string", description: "New description (markdown)" },
					status: { type: "string", description: "New status name (e.g. 'In Progress', 'Done')" },
					priority: {
						type: "string",
						description: "Priority: urgent, high, medium, low, no_priority",
					},
					assignee_email: {
						type: "string",
						description: "New assignee email",
					},
					label_ids: {
						type: "array",
						items: { type: "string" },
						description: "New label IDs (replaces existing)",
					},
					due_date: {
						type: "string",
						description: "New due date (YYYY-MM-DD)",
					},
					estimate: {
						type: "integer",
						description: "New effort estimate",
					},
				},
				required: ["issue_id"],
			},
		};
	}

	async execute(
		args: Record<string, unknown>,
		_ctx: ToolContext,
	): Promise<Record<string, unknown>> {
		const issueId = String(args.issue_id);
		if (!issueId) throw new Error("issue_id is required");

		// Resolve identifier to UUID if needed
		let uuid = issueId;
		if (!issueId.includes("-")) {
			const lookup = await this.client.query<{ issue: { id: string } }>(`
				query LookupIssue {
					issue(identifier: "${issueId}") { id }
				}
			`);
			if (!lookup.issue) throw new Error(`issue not found: ${issueId}`);
			uuid = lookup.issue.id;
		}

		const inputParts: string[] = [];

		if (args.title) inputParts.push(`title: ${JSON.stringify(String(args.title))}`);
		if (args.description) inputParts.push(`description: ${JSON.stringify(String(args.description))}`);
		if (args.priority) {
			const pNum = priorityNumber(String(args.priority));
			if (pNum !== undefined) inputParts.push(`priority: ${pNum}`);
		}
		if (args.due_date) inputParts.push(`dueDate: ${JSON.stringify(String(args.due_date))}`);
		if (args.estimate !== undefined) inputParts.push(`estimate: ${Number(args.estimate)}`);
		if (args.label_ids && Array.isArray(args.label_ids)) {
			const ids = args.label_ids.map((id: unknown) => JSON.stringify(String(id))).join(", ");
			inputParts.push(`labelIds: [${ids}]`);
		}

		// Resolve status name to state ID
		if (args.status) {
			const statusName = String(args.status);
			const stateData = await this.client.query<{
				workflowStates: { nodes: LinearState[] };
			}>(`
				query FindState {
					workflowStates(filter: { name: { eq: ${JSON.stringify(statusName)} } }, first: 1) {
						nodes { id name }
					}
				}
			`);
			const state = stateData.workflowStates.nodes[0];
			if (state) inputParts.push(`stateId: ${JSON.stringify(state.id)}`);
			else throw new Error(`status not found: ${statusName}`);
		}

		// Resolve assignee email
		if (args.assignee_email) {
			const userData = await this.client.query<{
				users: { nodes: LinearUser[] };
			}>(`
				query FindUser {
					users(filter: { email: { eq: ${JSON.stringify(String(args.assignee_email))} } }, first: 1) {
						nodes { id name email }
					}
				}
			`);
			const user = userData.users.nodes[0];
			if (user) inputParts.push(`assigneeId: ${JSON.stringify(user.id)}`);
		}

		if (inputParts.length === 0) throw new Error("no fields to update");

		const input = `{ ${inputParts.join(", ")} }`;

		const data = await this.client.query<{
			issueUpdate: { success: boolean; issue: LinearIssue };
		}>(`
			${ISSUE_FIELDS}
			mutation UpdateIssue {
				issueUpdate(id: ${JSON.stringify(uuid)}, input: ${input}) {
					success
					issue { ...IssueFields }
				}
			}
		`);

		if (!data.issueUpdate.success) throw new Error("failed to update issue");

		return {
			issue: {
				...data.issueUpdate.issue,
				priorityLabel: priorityLabel(data.issueUpdate.issue.priority),
			},
		};
	}
}

// ── Tool: create_comment ───────────────────────────────────────

class CreateCommentTool implements Tool {
	private client: LinearClient;

	constructor(client: LinearClient) {
		this.client = client;
	}

	definition(): ToolDef {
		return {
			name: "linear_create_comment",
			description: "Add a comment to a Linear issue.",
			parameters: {
				type: "object",
				properties: {
					issue_id: {
						type: "string",
						description: "Issue ID (UUID) or identifier (e.g. 'ENG-123')",
					},
					body: {
						type: "string",
						description: "Comment body (markdown)",
					},
				},
				required: ["issue_id", "body"],
			},
		};
	}

	async execute(
		args: Record<string, unknown>,
		_ctx: ToolContext,
	): Promise<Record<string, unknown>> {
		const issueId = String(args.issue_id);
		const body = String(args.body);
		if (!issueId) throw new Error("issue_id is required");
		if (!body) throw new Error("body is required");

		// Resolve identifier to UUID if needed
		let uuid = issueId;
		if (!issueId.includes("-")) {
			const lookup = await this.client.query<{ issue: { id: string } }>(`
				query LookupIssue {
					issue(identifier: "${issueId}") { id }
				}
			`);
			if (!lookup.issue) throw new Error(`issue not found: ${issueId}`);
			uuid = lookup.issue.id;
		}

		const data = await this.client.query<{
			commentCreate: { success: boolean; comment: LinearComment };
		}>(`
			mutation CreateComment {
				commentCreate(input: { issueId: ${JSON.stringify(uuid)}, body: ${JSON.stringify(body)} }) {
					success
					comment { id body createdAt user { id name displayName avatarUrl } }
				}
			}
		`);

		if (!data.commentCreate.success) throw new Error("failed to create comment");

		return { comment: data.commentCreate.comment };
	}
}

// ── Tool: search_issues ────────────────────────────────────────

class SearchIssuesTool implements Tool {
	private client: LinearClient;
	private defaultTeamId?: string;

	constructor(client: LinearClient, defaultTeamId?: string) {
		this.client = client;
		this.defaultTeamId = defaultTeamId;
	}

	definition(): ToolDef {
		return {
			name: "linear_search_issues",
			description:
				"Search Linear issues by text query. Searches across title and description.",
			parameters: {
				type: "object",
				properties: {
					query: {
						type: "string",
						description: "Search text",
					},
					team_id: {
						type: "string",
						description: "Limit to team ID (defaults to configured team)",
					},
					limit: {
						type: "integer",
						description: "Max results (default 25)",
					},
				},
				required: ["query"],
			},
		};
	}

	async execute(
		args: Record<string, unknown>,
		_ctx: ToolContext,
	): Promise<Record<string, unknown>> {
		const queryStr = String(args.query);
		if (!queryStr) throw new Error("query is required");

		const limit = (args.limit as number) || 25;
		const teamId = (args.team_id as string) || this.defaultTeamId;

		const filterParts: string[] = [];
		if (teamId) filterParts.push(`team: { id: { eq: "${teamId}" } }`);

		const filter = filterParts.length > 0 ? `{ ${filterParts.join(", ")} }` : "{}";

		const data = await this.client.query<{
			searchIssues: { nodes: LinearIssue[] };
		}>(`
			${ISSUE_FIELDS}
			query SearchIssues {
				searchIssues(query: ${JSON.stringify(queryStr)}, filter: ${filter}, first: ${limit}) {
					nodes { ...IssueFields }
				}
			}
		`);

		return {
			issues: data.searchIssues.nodes.map((i) => ({
				...i,
				priorityLabel: priorityLabel(i.priority),
			})),
		};
	}
}

// ── Extension ──────────────────────────────────────────────────

class LinearExtension implements Extension {
	name = "linear";
	private client?: LinearClient;
	private defaultTeamId?: string;

	async init(ctx: ExtensionContext): Promise<void> {
		const cfg = ctx.config as unknown as LinearConfig;

		if (!cfg.api_key) {
			throw new Error("linear extension requires api_key config");
		}

		const baseUrl = cfg.base_url || "https://api.linear.app/graphql";
		this.client = new LinearClient(cfg.api_key, baseUrl, ctx.logger);
		this.defaultTeamId = cfg.team_id;

		ctx.registry.register(new ListTeamsTool(this.client));
		ctx.registry.register(new ListIssuesTool(this.client, this.defaultTeamId));
		ctx.registry.register(new GetIssueTool(this.client));
		ctx.registry.register(new CreateIssueTool(this.client, this.defaultTeamId));
		ctx.registry.register(new UpdateIssueTool(this.client));
		ctx.registry.register(new CreateCommentTool(this.client));
		ctx.registry.register(new SearchIssuesTool(this.client, this.defaultTeamId));

		ctx.logger.info("linear extension initialized");
	}

	async start(_signal: AbortSignal): Promise<void> {
		// No background work needed
	}

	async stop(): Promise<void> {
		// No resources to clean up
	}
}

export default new LinearExtension();
