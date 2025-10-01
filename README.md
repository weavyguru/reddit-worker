# Reddit Intelligence Daemon

A Node.js background service that fetches Reddit posts from configured subreddits and ingests them into a vector database for intelligence gathering.

## Features

- 🌐 **Web UI**: Monitor and control jobs via real-time dashboard
- 🔄 Parallel processing of multiple subreddits using worker threads
- 📊 Fetches posts with full comment trees
- 🔐 OAuth2 authentication with automatic token refresh
- ⚡ Rate limiting and exponential backoff
- 📝 Comprehensive logging with Winston
- 🧪 Test mode for rapid development
- 🔁 Automatic retry logic for failed operations
- 📈 Real-time job progress via WebSocket
- 🎛️ Channel management UI for adding/removing subreddits

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

### 2. Reddit API Credentials

Add your Reddit API credentials to the `.env` file:

```env
REDDIT_CLIENT_ID=your_client_id_here
REDDIT_CLIENT_SECRET=your_client_secret_here
```

### 3. Channel Configuration

Edit `config/channels.json` to add your subreddits:

```json
{
  "r/lovable": {
    "enabled": true
  },
  "r/technology": {
    "enabled": false
  }
}
```

Note: All channels share the same Reddit credentials from the `.env` file.

## Usage

### Web UI (Recommended)

Start the web server:
```bash
npm run web
```

Then open your browser to `http://localhost:3001`

The web UI allows you to:
- Start new ingestion jobs with custom time windows
- Monitor active jobs in real-time
- View job history and statistics
- Add/remove/enable/disable channels
- Toggle test mode for quick testing

### CLI Mode

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
│   ├── workers/
│   │   └── channelWorker.js     # Worker thread for each channel
│   └── web/
│       ├── server.js            # Express web server & API
│       └── jobManager.js        # Job state management
├── public/
│   ├── index.html               # Web UI HTML
│   ├── style.css                # Web UI styles
│   └── app.js                   # Web UI client-side JS
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

## Deployment to Railway

### Prerequisites
- Railway account (https://railway.app)
- GitHub repository with your code

### Steps

1. **Push to GitHub**:
```bash
git remote add origin https://github.com/yourusername/reddit-worker.git
git push -u origin master
```

2. **Create New Project on Railway**:
- Go to https://railway.app/new
- Select "Deploy from GitHub repo"
- Choose your repository

3. **Configure Environment Variables**:
In Railway's project settings, add these variables:
- `VECTORDB_API_TOKEN`: Your vector DB API token
- `REDDIT_CLIENT_ID`: Your Reddit client ID
- `REDDIT_CLIENT_SECRET`: Your Reddit client secret
- `PORT`: Railway will auto-assign this
- `LOG_LEVEL`: `info` (optional)

4. **Deploy**:
Railway will automatically:
- Detect the `Procfile`
- Run `npm install`
- Start the web server with `npm run web`

5. **Access Your App**:
Railway will provide a public URL (e.g., `https://your-app.railway.app`)

### Important Notes
- Railway uses the `Procfile` to determine how to run your app
- The web server runs on the `PORT` environment variable
- Channels can be managed through the web UI once deployed
- Make sure `config/channels.json` is committed to your repo

## Troubleshooting

### "Configuration file not found"
Ensure `config/channels.json` exists and is valid JSON.

### "VECTORDB_API_TOKEN environment variable is not set"
Create a `.env` file with your API token (locally) or set environment variables in Railway (production).

### "Authentication failed"
Verify your Reddit client ID and secret in `.env` or Railway environment variables.

### Rate limiting errors
The daemon automatically handles rate limiting with exponential backoff. If persistent, reduce the number of concurrent channels or increase delays.

## License

MIT

## Author

reddit-intelligence-daemon/1.0 by Ill-Basket3443
