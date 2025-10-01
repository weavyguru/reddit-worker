import axios from 'axios';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('RedditClient');

export class RedditClient {
  constructor(clientId, clientSecret, subreddit) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    // Strip "r/" prefix if present
    this.subreddit = subreddit.startsWith('r/') ? subreddit.substring(2) : subreddit;
    this.subredditDisplay = subreddit; // Keep original for display purposes
    this.accessToken = null;
    this.tokenExpiry = null;
    this.userAgent = 'reddit-intelligence-daemon/1.0 by Ill-Basket3443';
    this.baseUrl = 'https://oauth.reddit.com';
    this.authUrl = 'https://www.reddit.com/api/v1/access_token';

    // Rate limiting: 60 requests per minute
    this.requestQueue = [];
    this.lastRequestTime = 0;
    this.minRequestInterval = 1000; // 1 second between requests to be safe
  }

  /**
   * Authenticate with Reddit using OAuth2 client credentials flow
   */
  async authenticate() {
    try {
      const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

      const response = await axios.post(
        this.authUrl,
        'grant_type=client_credentials',
        {
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': this.userAgent
          }
        }
      );

      this.accessToken = response.data.access_token;
      // Set expiry 5 minutes before actual expiry to ensure we refresh in time
      this.tokenExpiry = Date.now() + (response.data.expires_in - 300) * 1000;

      logger.info(`Authenticated successfully for ${this.subredditDisplay}`);
      return true;
    } catch (error) {
      logger.error(`Authentication failed for ${this.subreddit}: ${error.message}`);
      throw new Error(`Reddit authentication failed: ${error.message}`);
    }
  }

  /**
   * Check if token is expired and refresh if needed
   */
  async ensureAuthenticated() {
    if (!this.accessToken || Date.now() >= this.tokenExpiry) {
      await this.authenticate();
    }
  }

  /**
   * Rate limiting implementation
   */
  async waitForRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.minRequestInterval) {
      const waitTime = this.minRequestInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Make authenticated request to Reddit API with retry logic
   */
  async makeRequest(url, params = {}, retries = 3) {
    await this.ensureAuthenticated();
    await this.waitForRateLimit();

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        logger.debug(`Making request to ${url} with params: ${JSON.stringify(params)}`);
        const response = await axios.get(url, {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'User-Agent': this.userAgent
          },
          params: {
            ...params,
            raw_json: 1
          }
        });

        return response.data;
      } catch (error) {
        const status = error.response?.status;
        logger.error(`Request failed: ${error.message}, Response: ${JSON.stringify(error.response?.data)}`);

        // Handle rate limiting
        if (status === 429) {
          const retryAfter = error.response.headers['retry-after'] || Math.pow(2, attempt) * 1000;
          logger.warn(`Rate limited for ${this.subreddit}. Waiting ${retryAfter}ms before retry ${attempt + 1}/${retries}`);
          await new Promise(resolve => setTimeout(resolve, retryAfter));
          continue;
        }

        // Handle token expiry
        if (status === 401) {
          logger.warn(`Token expired for ${this.subreddit}. Re-authenticating...`);
          await this.authenticate();
          continue;
        }

        // Handle server errors with exponential backoff
        if (status >= 500) {
          const backoffTime = Math.pow(2, attempt) * 1000;
          logger.warn(`Server error (${status}) for ${this.subreddit}. Retrying in ${backoffTime}ms (${attempt + 1}/${retries})`);
          await new Promise(resolve => setTimeout(resolve, backoffTime));
          continue;
        }

        // Other errors - don't retry
        logger.error(`Request failed for ${this.subreddit}: ${error.message}`);
        throw error;
      }
    }

    throw new Error(`Max retries (${retries}) exceeded for ${url}`);
  }

  /**
   * Fetch posts from subreddit sorted by new
   */
  async fetchNewPosts(limit = 100, before = null, after = null) {
    const url = `${this.baseUrl}/r/${this.subreddit}/new.json`;
    const params = {
      limit,
      t: 'all'
    };

    if (before) params.before = before;
    if (after) params.after = after;

    logger.debug(`Fetching new posts from ${this.subreddit} (limit: ${limit}, before: ${before}, after: ${after})`);

    return await this.makeRequest(url, params);
  }

  /**
   * Fetch comments for a specific post
   */
  async fetchPostComments(postId, limit = 500, depth = 10) {
    const url = `${this.baseUrl}/r/${this.subreddit}/comments/${postId}.json`;
    const params = {
      limit,
      depth,
      sort: 'top'
    };

    logger.debug(`Fetching comments for post ${postId} from ${this.subreddit}`);

    return await this.makeRequest(url, params);
  }

  /**
   * Fetch more comments (for "load more comments" links)
   */
  async fetchMoreComments(linkId, children) {
    const url = `${this.baseUrl}/api/morechildren.json`;
    const params = {
      api_type: 'json',
      link_id: linkId,
      children: children.join(','),
      limit_children: false
    };

    logger.debug(`Fetching more comments for ${linkId}`);

    return await this.makeRequest(url, params);
  }
}
