import axios from 'axios';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('VectorDBIngestion');

export class VectorDBIngestion {
  constructor(apiUrl, authToken) {
    this.apiUrl = apiUrl || 'https://intelligence-ingestor-production.up.railway.app';
    this.authToken = authToken || process.env.VECTORDB_API_TOKEN;
    this.batchSize = 10; // Ingest 10 posts at a time
    this.maxRetries = 3;

    if (!this.authToken) {
      throw new Error('Vector DB API token is required. Set VECTORDB_API_TOKEN environment variable.');
    }
  }

  /**
   * Transform Reddit post data to Vector DB format
   */
  transformPostToVectorFormat(redditPost, platformName) {
    const items = [];
    const { post, comments, subreddit, metadata } = redditPost;

    // Transform the main post
    const postItem = {
      platform: platformName || subreddit,
      source: 'Reddit',
      id: post.id,
      timestamp: new Date(post.created_utc * 1000).toISOString(),
      deeplink: post.url,
      author: post.author,
      title: post.title,
      body: post.content || post.title, // Use title if no content
      isComment: false,
      comments: post.num_comments,
      likes: post.score
    };

    items.push(postItem);

    // Transform comments
    if (comments && comments.length > 0) {
      const commentItems = this.transformCommentsToVectorFormat(
        comments,
        post.id,
        platformName || subreddit
      );
      items.push(...commentItems);
    }

    return items;
  }

  /**
   * Recursively transform comments to Vector DB format
   */
  transformCommentsToVectorFormat(comments, postId, subreddit, parentCommentId = null) {
    const items = [];

    for (const comment of comments) {
      const commentItem = {
        platform: subreddit,
        source: 'Reddit',
        id: parentCommentId ? `${postId}_${comment.id}` : comment.id,
        timestamp: new Date(comment.created_utc * 1000).toISOString(),
        deeplink: `https://reddit.com${comment.permalink}`,
        author: comment.author,
        title: '', // Comments don't have titles
        body: comment.body,
        isComment: true,
        likes: comment.score
      };

      items.push(commentItem);

      // Recursively process replies
      if (comment.replies && comment.replies.length > 0) {
        const replyItems = this.transformCommentsToVectorFormat(
          comment.replies,
          postId,
          subreddit,
          comment.id
        );
        items.push(...replyItems);
      }
    }

    return items;
  }

  /**
   * Ingest a single item into the vector database
   */
  async ingestItem(item, testMode = false) {
    const url = `${this.apiUrl}/ingest?test=${testMode}`;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await axios.post(url, item, {
          headers: {
            'Authorization': `Bearer ${this.authToken}`,
            'Content-Type': 'application/json'
          }
        });

        logger.debug(`Ingested ${item.isComment ? 'comment' : 'post'} ${item.id}: ${response.data.base_id}`);
        return {
          success: true,
          id: item.id,
          chromaId: response.data.base_id,
          chunks: response.data.chunks_created
        };

      } catch (error) {
        const status = error.response?.status;

        // Handle authentication errors
        if (status === 401 || status === 403) {
          logger.error(`Authentication failed for Vector DB: ${error.message}`);
          throw new Error('Vector DB authentication failed. Check your API token.');
        }

        // Handle validation errors
        if (status === 422) {
          logger.error(`Validation error for item ${item.id}: ${JSON.stringify(error.response.data)}`);
          return {
            success: false,
            id: item.id,
            error: 'Validation error',
            details: error.response.data
          };
        }

        // Handle rate limiting or server errors with exponential backoff
        if (status === 429 || status >= 500) {
          const backoffTime = Math.pow(2, attempt) * 1000;
          logger.warn(`Server error (${status}) for item ${item.id}. Retrying in ${backoffTime}ms (${attempt + 1}/${this.maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, backoffTime));
          continue;
        }

        // Other errors
        logger.error(`Failed to ingest item ${item.id}: ${error.message}`);
        return {
          success: false,
          id: item.id,
          error: error.message
        };
      }
    }

    return {
      success: false,
      id: item.id,
      error: `Max retries (${this.maxRetries}) exceeded`
    };
  }

  /**
   * Ingest Reddit posts in batches
   */
  async ingestPosts(redditPosts, platformName, testMode = false) {
    const results = {
      total: 0,
      successful: 0,
      failed: 0,
      posts: 0,
      comments: 0,
      errors: []
    };

    logger.info(`Starting ingestion of ${redditPosts.length} Reddit posts for platform: ${platformName}`);

    for (const redditPost of redditPosts) {
      try {
        // Transform to Vector DB format
        const items = this.transformPostToVectorFormat(redditPost, platformName);
        results.total += items.length;

        logger.info(`Ingesting post ${redditPost.post.id} with ${items.length - 1} comments`);

        // Ingest each item
        for (const item of items) {
          const result = await this.ingestItem(item, testMode);

          if (result.success) {
            results.successful++;
            if (item.isComment) {
              results.comments++;
            } else {
              results.posts++;
            }
          } else {
            results.failed++;
            results.errors.push({
              id: item.id,
              error: result.error,
              details: result.details
            });
          }

          // Small delay between items to avoid overwhelming the API
          await new Promise(resolve => setTimeout(resolve, 100));
        }

      } catch (error) {
        logger.error(`Failed to process post ${redditPost.post.id}: ${error.message}`);
        results.failed++;
        results.errors.push({
          id: redditPost.post.id,
          error: error.message
        });
      }
    }

    logger.info(`Ingestion complete: ${results.successful}/${results.total} items successful (${results.posts} posts, ${results.comments} comments)`);

    if (results.failed > 0) {
      logger.warn(`${results.failed} items failed to ingest`);
    }

    return results;
  }

  /**
   * Test the Vector DB connection
   */
  async testConnection() {
    try {
      const response = await axios.get(`${this.apiUrl}/health`, {
        headers: {
          'Authorization': `Bearer ${this.authToken}`
        }
      });

      logger.info(`Vector DB connection test: ${response.data.status}`);
      return response.data.status === 'healthy';
    } catch (error) {
      logger.error(`Vector DB connection test failed: ${error.message}`);
      return false;
    }
  }
}
