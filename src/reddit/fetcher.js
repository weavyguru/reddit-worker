import { RedditClient } from './client.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('RedditFetcher');

export class RedditFetcher {
  constructor(clientId, clientSecret, subreddit) {
    this.client = new RedditClient(clientId, clientSecret, subreddit);
    this.subreddit = subreddit;
  }

  /**
   * Calculate the Unix timestamp for the time window
   */
  calculateTimeWindow(hours = null, days = null) {
    const now = Date.now();
    let windowMs = 0;

    if (hours) {
      windowMs = hours * 60 * 60 * 1000;
    } else if (days) {
      windowMs = days * 24 * 60 * 60 * 1000;
    } else {
      throw new Error('Must specify either hours or days');
    }

    return Math.floor((now - windowMs) / 1000); // Return Unix timestamp in seconds
  }

  /**
   * Recursively flatten comment tree
   */
  flattenComments(commentData, depth = 0) {
    const comments = [];

    if (!commentData || commentData.kind !== 'Listing') {
      return comments;
    }

    for (const item of commentData.data.children) {
      if (item.kind === 't1') { // Comment
        const comment = item.data;

        // Skip deleted/removed comments
        if (comment.author === '[deleted]' || comment.body === '[deleted]' || comment.body === '[removed]') {
          continue;
        }

        const commentObj = {
          id: comment.id,
          author: comment.author,
          body: comment.body,
          score: comment.score,
          created_utc: comment.created_utc,
          depth: depth,
          permalink: comment.permalink,
          parent_id: comment.parent_id,
          replies: []
        };

        // Recursively process replies
        if (comment.replies && typeof comment.replies === 'object') {
          commentObj.replies = this.flattenComments(comment.replies, depth + 1);
        }

        comments.push(commentObj);
      } else if (item.kind === 'more') {
        // Note: We could fetch "more" comments here, but it would require additional API calls
        // For now, we'll skip them. Could be implemented later if needed.
        logger.debug(`Skipping ${item.data.count} more comments for performance`);
      }
    }

    return comments;
  }

  /**
   * Extract full post data including comments
   */
  async extractPostData(postData) {
    const post = postData.data;

    // Build the post object
    const postObj = {
      id: post.id,
      title: post.title,
      author: post.author,
      content: post.selftext || '', // Text posts have selftext, link posts don't
      url: `https://reddit.com${post.permalink}`,
      created_utc: post.created_utc,
      score: post.score,
      upvote_ratio: post.upvote_ratio,
      num_comments: post.num_comments,
      awards: post.all_awardings?.length || 0,
      flair: post.link_flair_text || '',
      is_self: post.is_self, // True for text posts, false for links
      domain: post.domain // Domain of linked content
    };

    // Fetch comments for this post
    let comments = [];
    try {
      const commentData = await this.client.fetchPostComments(post.id);

      // commentData is an array: [0] is post, [1] is comments
      if (commentData && commentData.length > 1) {
        comments = this.flattenComments(commentData[1]);
      }

      logger.debug(`Fetched ${comments.length} comments for post ${post.id}`);
    } catch (error) {
      logger.error(`Failed to fetch comments for post ${post.id}: ${error.message}`);
    }

    return {
      post: postObj,
      comments: comments
    };
  }

  /**
   * Fetch posts within the specified time window
   */
  async fetchPosts(hours = null, days = null, testMode = false) {
    const cutoffTime = this.calculateTimeWindow(hours, days);
    const posts = [];
    let after = null;
    let beforeReachedCutoff = false;
    const maxPosts = testMode ? 5 : Infinity;

    logger.info(`Fetching posts from ${this.subreddit} since ${new Date(cutoffTime * 1000).toISOString()}`);

    try {
      // Authenticate first
      await this.client.authenticate();

      // Paginate through posts until we reach the cutoff time or max posts
      while (!beforeReachedCutoff && posts.length < maxPosts) {
        const data = await this.client.fetchNewPosts(100, null, after);

        if (!data.data.children || data.data.children.length === 0) {
          logger.info(`No more posts available for ${this.subreddit}`);
          break;
        }

        for (const postData of data.data.children) {
          if (postData.kind === 't3') { // Post
            const postCreatedTime = postData.data.created_utc;

            // Check if we've gone past our time window
            if (postCreatedTime < cutoffTime) {
              beforeReachedCutoff = true;
              logger.info(`Reached posts older than cutoff time for ${this.subreddit}`);
              break;
            }

            // Skip deleted/removed posts
            if (postData.data.author === '[deleted]' || postData.data.selftext === '[removed]') {
              continue;
            }

            // Extract full post data with comments
            logger.debug(`Processing post ${postData.data.id}: ${postData.data.title}`);
            const fullPostData = await this.extractPostData(postData);

            posts.push({
              id: `reddit_post_${fullPostData.post.id}`,
              source: 'reddit',
              subreddit: this.subreddit,
              post: fullPostData.post,
              comments: fullPostData.comments,
              metadata: {
                fetched_at: new Date().toISOString(),
                time_window: hours ? `${hours}_hours` : `${days}_days`,
                test_mode: testMode
              }
            });

            // Check if we've hit the test mode limit
            if (testMode && posts.length >= maxPosts) {
              logger.info(`Test mode: reached max posts limit (${maxPosts}) for ${this.subreddit}`);
              beforeReachedCutoff = true;
              break;
            }
          }
        }

        // Get the next page token
        after = data.data.after;

        // If no more pages, stop
        if (!after) {
          logger.info(`No more pages available for ${this.subreddit}`);
          break;
        }
      }

      logger.info(`Fetched ${posts.length} posts from ${this.subreddit}`);
      return posts;

    } catch (error) {
      logger.error(`Failed to fetch posts from ${this.subreddit}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Count total comments recursively
   */
  countComments(comments) {
    let count = comments.length;
    for (const comment of comments) {
      if (comment.replies && comment.replies.length > 0) {
        count += this.countComments(comment.replies);
      }
    }
    return count;
  }
}
