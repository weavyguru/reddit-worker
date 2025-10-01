# Reddit Intelligence Daemon

A Node.js background service that fetches Reddit posts from configured subreddits and ingests them into a vector database for intelligence gathering.

## Features

- 🔄 Parallel processing of multiple subreddits using worker threads
- 📊 Fetches posts with full comment trees
- 🔐 OAuth2 authentication with automatic token refresh
- ⚡ Rate limiting and exponential backoff
- 📝 Comprehensive logging with Winston
- 🧪 Test mode for rapid development
- 🔁 Automatic retry logic for failed operations
- 📈 Detailed execution summary reports

## Prerequisites

- Node.js 18+ (requires ES modules and worker threads support)
- Reddit API credentials (client ID and secret)
- Vector DB API token

## Installation

```bash
npm install
```

## Configuration

### 1. Environment Variables

Create a `.env` file in the root directory:

```env
VECTORDB_API_TOKEN=your_token_here
LOG_LEVEL=info
```

### 2. Channel Configuration

Edit `config/channels.json` to add your subreddits:

```json
{
  "r/lovable": {
    "clientId": "YOUR_CLIENT_ID_HERE",
    "clientSecret": "YOUR_CLIENT_SECRET_HERE",
    "enabled": true
  },
  "r/technology": {
    "clientId": "ANOTHER_CLIENT_ID",
    "clientSecret": "ANOTHER_CLIENT_SECRET",
    "enabled": false
  }
}
```

## Usage

### Basic Commands

Fetch posts from the last 24 hours:
```bash
npm start -- --hours 24
```

Fetch posts from the last 7 days:
```bash
npm start -- --days 7
```

Test mode (max 5 posts per channel):
```bash
npm start -- --hours 1 --test
```

### Command Line Options

- `--hours <number>`: Fetch posts from last N hours
- `--days <number>`: Fetch posts from last N days
- `--test`: Test mode - limits to 5 posts per channel
- `--config <path>`: Custom path to channels.json

**Note:** You must specify either `--hours` or `--days`, but not both.

## How It Works

1. **Configuration Loading**: Reads `config/channels.json` and filters enabled channels
2. **Worker Spawning**: Creates a worker thread for each enabled subreddit
3. **Reddit Fetching**: Each worker:
   - Authenticates with Reddit OAuth2
   - Fetches posts sorted by new, paginating backwards in time
   - Retrieves full comment trees for each post
   - Stops when reaching the time cutoff
4. **Vector DB Ingestion**: Transforms and ingests data into the vector database
5. **Summary Report**: Displays statistics for all channels

## Project Structure

```
reddit-intelligence-daemon/
├── src/
│   ├── index.js                 # Main entry point and CLI
│   ├── config/
│   │   └── loader.js            # Configuration file loader
│   ├── reddit/
│   │   ├── client.js            # Reddit API client with OAuth2
│   │   └── fetcher.js           # Post and comment fetching logic
│   ├── ingestion/
│   │   └── vectordb.js          # Vector DB ingestion
│   ├── utils/
│   │   └── logger.js            # Winston logger setup
│   └── workers/
│       └── channelWorker.js     # Worker thread for each channel
├── config/
│   └── channels.json            # Channel configuration
├── .env                         # Environment variables (not in git)
└── DEVELOPER_API.md             # Vector DB API documentation
```

## Data Format

Each post is ingested with the following structure:

```javascript
{
  platform: "r/subreddit",
  source: "Reddit",
  id: "post_id",
  timestamp: "2024-01-15T10:30:00Z",
  deeplink: "https://reddit.com/...",
  author: "username",
  title: "Post title",
  body: "Post content",
  isComment: false,
  comments: 42,
  likes: 156
}
```

Comments are ingested separately with `isComment: true`.

## Error Handling

The daemon implements comprehensive error handling:

- **Authentication failures**: Automatic token refresh
- **Rate limiting**: Exponential backoff and retry
- **API errors**: Up to 3 retries per request
- **Worker failures**: Continues processing other channels
- **Ingestion failures**: Logs errors and continues

## Logging

Uses Winston logger with the following levels:

- `ERROR`: API failures, authentication issues
- `WARN`: Rate limiting, retries
- `INFO`: Worker status, posts fetched, ingestion results
- `DEBUG`: Individual API calls, data transformation

Set log level in `.env`:
```env
LOG_LEVEL=debug
```

## Performance

- **Parallel Processing**: 3 channels processed concurrently
- **Rate Limiting**: Respects Reddit's 60 requests/minute limit
- **Worker Threads**: True parallelism for CPU-intensive operations
- **Batching**: Small delays between ingestions to avoid overwhelming the API

## Example Output

```
2024-01-15 10:30:00 info: Loading channel configuration...
2024-01-15 10:30:00 info: Found 2 enabled channels: r/lovable, r/technology
2024-01-15 10:30:00 info: Fetching posts from last 24 hours
2024-01-15 10:30:01 info: [r/lovable] Status: started
2024-01-15 10:30:02 info: [r/lovable] Status: fetching
2024-01-15 10:30:15 info: [r/lovable] Status: ingesting (15 posts)
2024-01-15 10:30:45 info: [r/lovable] Completed successfully

============================================================
EXECUTION SUMMARY
============================================================
✓ r/lovable: 15 posts, 342 comments (357 successful, 0 failed)
Total: 15 posts, 342 comments
Ingestion: 357 successful, 0 failed
Channels: 1 successful, 0 failed
Execution time: 45.32s
============================================================
```

## Development

### Adding New Features

1. **Custom Data Transformation**: Edit `src/ingestion/vectordb.js`
2. **Additional Reddit Data**: Modify `src/reddit/fetcher.js`
3. **New CLI Options**: Update `src/index.js`

### Testing

Use `--test` flag for rapid iteration:
```bash
npm start -- --hours 1 --test
```

This limits to 5 posts per channel and uses the test collection in the vector DB.

## Troubleshooting

### "Configuration file not found"
Ensure `config/channels.json` exists and is valid JSON.

### "VECTORDB_API_TOKEN environment variable is not set"
Create a `.env` file with your API token.

### "Authentication failed"
Verify your Reddit client ID and secret in `config/channels.json`.

### Rate limiting errors
The daemon automatically handles rate limiting with exponential backoff. If persistent, reduce the number of concurrent channels or increase delays.

## License

MIT

## Author

reddit-intelligence-daemon/1.0 by Ill-Basket3443
