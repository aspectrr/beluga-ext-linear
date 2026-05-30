# beluga-ext-linear

Linear integration for Beluga. Uses Linear's GraphQL API to manage issues, comments, and teams. Optional webhook listener for Linear agent session events (mentionable/assignable app actors).

## Configuration

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `api_key` | string | ✅ | Linear API key (personal or OAuth token) |
| `team_id` | string | ❌ | Default team ID for creating/listing issues |
| `base_url` | string | ❌ | GraphQL API URL (default: `https://api.linear.app/graphql`) |
| `webhook_port` | integer | ❌ | Port for webhook listener. Enables webhook mode when set (default: `3099`) |
| `webhook_path` | string | ❌ | URL path for webhook endpoint (default: `/linear/webhook`) |
| `webhook_secret` | string | ❌ | Linear webhook signing secret for HMAC verification |
| `webhook_agent` | string | ❌ | Default agent name to route webhook sessions to |

## Tools

| Tool | Description |
|------|-------------|
| `linear_list_teams` | List all accessible Linear teams |
| `linear_list_issues` | List issues with filters (status, assignee, priority, label) |
| `linear_get_issue` | Get full issue details including comments |
| `linear_create_issue` | Create a new issue with title, description, priority, etc. |
| `linear_update_issue` | Update issue fields (title, description, status, priority, assignee, labels, due date) |
| `linear_create_comment` | Add a comment to an issue |
| `linear_search_issues` | Search issues by text query |

## Example: Tool-only (personal API key)

```json
{
  "extensions": {
    "linear": {
      "api_key": "lin_api_xxx...",
      "team_id": "abc-123-def"
    }
  }
}
```

## Example: Webhook mode (app actor)

When `webhook_port` is set, the extension starts an HTTP listener that receives Linear agent session webhooks. This enables the @mention → Beluga agent flow.

```json
{
  "routing": {
    "linear": "wedding-planner"
  },
  "agents": {
    "wedding-planner": {
      "provider": "anthropic",
      "model": "claude-sonnet-4",
      "extensions": ["linear"]
    }
  },
  "extensions": {
    "linear": {
      "api_key": "lin_oauth_xxx...",
      "team_id": "abc-123-def",
      "webhook_port": 3099,
      "webhook_secret": "whsec_xxx...",
      "webhook_agent": "wedding-planner"
    }
  }
}
```

### Setting up the Linear app actor

1. Go to **Linear → Settings → API → Applications → New Application**
2. Name it (this is how it appears when @mentioned)
3. Set a recognizable icon
4. Enable **webhooks** and select **Agent session events**
5. Add scopes: `app:mentionable`, `app:assignable`
6. Add `actor=app` to the OAuth authorization URL
7. Install into workspace (requires admin)
8. Set the webhook URL to `http://your-beluga-host:3099/linear/webhook`
9. Copy the webhook signing secret into `webhook_secret` config

### Webhook flow

```
User @mentions agent in Linear issue
  → Linear sends AgentSessionEvent webhook
  → Extension verifies HMAC signature
  → Extension calls createSession("linear", issueId, promptContext)
  → Beluga routes to configured agent
  → Agent uses linear_* tools to respond
  → Comments appear as the app actor
```

Follow-up @mentions on the same issue call `continueSession` on the existing session.

## Getting an API Key

1. Go to **Linear → Settings → API**
2. For personal use: create a **Personal API Key**
3. For app actors: create an **OAuth Application** with `actor=app`

## License

MIT
