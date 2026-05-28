# beluga-ext-linear

Linear integration for Beluga. Uses Linear's GraphQL API to manage issues, comments, and teams.

## Configuration

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `api_key` | string | ✅ | Linear API key (personal or OAuth token) |
| `team_id` | string | ❌ | Default team ID for creating/listing issues |
| `base_url` | string | ❌ | GraphQL API URL (default: `https://api.linear.app/graphql`) |

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

## Example

```yaml
extensions:
  linear:
    api_key: "lin_api_xxx..."
    team_id: "abc-123-def"
```

## Getting an API Key

1. Go to **Linear → Settings → API**
2. Create a **Personal API Key** or an **OAuth Application**
3. Use the token as `api_key` in config

## License

MIT
