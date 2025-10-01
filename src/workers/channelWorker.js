import { parentPort, workerData } from 'worker_threads';
import { RedditFetcher } from '../reddit/fetcher.js';
import { VectorDBIngestion } from '../ingestion/vectordb.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger(`Worker-${workerData.subreddit}`);

/**
 * Worker thread for processing a single subreddit channel
 */
async function processChannel() {
  const { clientId, clientSecret, subreddit, platform, hours, days, testMode } = workerData;

  try {
    logger.info(`Starting channel worker for ${subreddit}`);

    // Send progress update
    parentPort.postMessage({
      type: 'progress',
      subreddit,
      status: 'started'
    });

    // Initialize fetcher
    const fetcher = new RedditFetcher(clientId, clientSecret, subreddit);

    // Fetch posts
    logger.info(`Fetching posts from ${subreddit}...`);
    parentPort.postMessage({
      type: 'progress',
      subreddit,
      status: 'fetching'
    });

    const posts = await fetcher.fetchPosts(hours, days, testMode);

    if (posts.length === 0) {
      logger.info(`No posts found for ${subreddit} in the specified time window`);
      parentPort.postMessage({
        type: 'complete',
        subreddit,
        success: true,
        stats: {
          posts: 0,
          comments: 0,
          successful: 0,
          failed: 0
        }
      });
      return;
    }

    // Initialize Vector DB ingestion
    const vectorDB = new VectorDBIngestion();

    // Test connection first
    logger.info(`Testing Vector DB connection...`);
    const connectionOk = await vectorDB.testConnection();

    if (!connectionOk) {
      throw new Error('Vector DB connection test failed');
    }

    // Ingest posts
    logger.info(`Ingesting ${posts.length} posts from ${subreddit}...`);
    parentPort.postMessage({
      type: 'progress',
      subreddit,
      status: 'ingesting',
      postsCount: posts.length
    });

    const ingestionResults = await vectorDB.ingestPosts(posts, platform, testMode);

    // Send completion message
    parentPort.postMessage({
      type: 'complete',
      subreddit,
      success: true,
      stats: {
        posts: ingestionResults.posts,
        comments: ingestionResults.comments,
        successful: ingestionResults.successful,
        failed: ingestionResults.failed,
        errors: ingestionResults.errors
      }
    });

    logger.info(`Channel worker completed for ${subreddit}`);

  } catch (error) {
    logger.error(`Channel worker failed for ${subreddit}: ${error.message}`);

    parentPort.postMessage({
      type: 'error',
      subreddit,
      error: error.message,
      stack: error.stack
    });
  }
}

// Start processing
processChannel().catch(error => {
  logger.error(`Unhandled error in worker: ${error.message}`);
  parentPort.postMessage({
    type: 'error',
    subreddit: workerData.subreddit,
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});
