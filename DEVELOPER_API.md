# Intelligence Ingestor API Documentation

## Overview
The Intelligence Ingestor is a FastAPI service that processes and stores community intelligence data in ChromaDB Cloud. It's designed to ingest posts and comments from various platforms and sources.

## Base URL
**Production:** `https://intelligence-ingestor-production.up.railway.app`

## Authentication
All endpoints require Bearer token authentication.

```http
Authorization: Bearer YOUR_TOKEN_HERE
```

## Endpoints

### Health Check
Check if the service and ChromaDB connection are healthy.

```http
GET /health
Authorization: Bearer YOUR_TOKEN_HERE
```

**Response:**
```json
{
  "status": "healthy",
  "chroma": "connected"
}
```

### Ingest Data
Process and store community intelligence data.

```http
POST /ingest?test=false
Content-Type: application/json
Authorization: Bearer YOUR_TOKEN_HERE
```

**Query Parameters:**
- `test` (optional): Set to `true` to use the test collection instead of production

**Request Body:**
```json
{
  "platform": "string",      // Platform name (e.g., "Lovable", "Replit")
  "source": "string",        // Source name (e.g., "Reddit", "Discord")
  "id": "string",           // Original post/thread ID from source
  "timestamp": "2024-01-15T10:30:00Z",  // ISO 8601 format
  "deeplink": "https://example.com/post", // Direct link to content
  "author": "string",        // Author profile or identifier
  "title": "string",        // Post/comment title
  "body": "string",         // Content to embed
  "isComment": false,       // true for comments, false for posts
  "comments": 42,           // (Optional) Number of comments on the post
  "likes": 123              // (Optional) Number of likes/upvotes on the post
}
```

**Response:**
```json
{
  "status": "success",
  "chroma_ids": ["platform_source_post_id", "platform_source_post_id_chunk_1"],
  "chunks_created": 2,
  "base_id": "platform_source_post_id"
}
```

### Retrieve Content by ID
Retrieve specific content using its ChromaDB ID.

```http
GET /retrieve/{chroma_id}?test=false
Authorization: Bearer YOUR_TOKEN_HERE
```

**Response:**
```json
{
  "id": "platform_source_post_id",
  "content": "The actual content text",
  "metadata": {
    "platform": "Lovable",
    "source": "Reddit",
    "title": "Post title",
    ...
  }
}
```

### Semantic Search
Search content using natural language queries.

```http
POST /search?query=API+best+practices&limit=5&test=false
Authorization: Bearer YOUR_TOKEN_HERE
```

**Query Parameters:**
- `query` (required): Search query text
- `limit` (optional): Number of results (1-20, default: 5)
- `test` (optional): Set to `true` to search test collection

**Response:**
```json
{
  "query": "API best practices",
  "results": [
    {
      "id": "platform_source_post_id",
      "content": "Here are some best practices for API development...",
      "metadata": {...},
      "distance": 0.123
    }
  ],
  "count": 1
}
```

## Data Processing Behavior

### ID Generation
The service generates unique ChromaDB IDs based on:
- **Posts:** `{platform}_{source}_post_{id}`
- **Comments:** `{platform}_{source}_comment_{id}_{hash}`

Where `{hash}` is an 8-character MD5 hash of timestamp + author to ensure comment uniqueness.

### Duplicate Handling
- **Same ID sent twice:** The service uses `upsert` operations, so existing records are updated with new data
- **No error thrown:** Duplicate ingestion is handled gracefully
- **Metadata updated:** All metadata fields are refreshed with the latest values

### Content Chunking
Long content is automatically split into chunks:
- **Single chunk:** Uses base ChromaDB ID
- **Multiple chunks:** Appends `_chunk_{index}` to the ID
- **Metadata preserved:** Each chunk maintains full metadata context

### Metadata Structure
Each ingested item includes:
```json
{
  "platform": "source platform",
  "source": "content source",
  "original_id": "source ID",
  "timestamp": "ISO timestamp",
  "deeplink": "original URL",
  "author": "author profile or identifier",
  "title": "content title",
  "is_comment": true/false,
  "parent_post_id": "ID if comment",
  "ingested_at": "processing timestamp",
  "chunk_index": 0,
  "total_chunks": 1,
  "comments": 42,  // Optional: included only if provided
  "likes": 123     // Optional: included only if provided
}
```

## Error Responses

### Authentication Errors
```json
{
  "detail": "Invalid authentication token"
}
```

### Service Unavailable
```json
{
  "detail": "Service temporarily unavailable"
}
```

### Validation Errors
```json
{
  "detail": [
    {
      "loc": ["body", "field_name"],
      "msg": "field required",
      "type": "value_error.missing"
    }
  ]
}
```

## Example Usage

### Ingest a Blog Post
```bash
curl -X POST "https://intelligence-ingestor-production.up.railway.app/ingest?test=true" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "Lovable",
    "source": "Reddit",
    "id": "abc123",
    "timestamp": "2024-01-15T10:30:00Z",
    "deeplink": "https://reddit.com/r/programming/comments/abc123",
    "author": "developer",
    "title": "How to Build Better APIs",
    "body": "Here are some best practices for API development...",
    "isComment": false,
    "comments": 42,
    "likes": 156
  }'
```

### Ingest a Comment
```bash
curl -X POST "https://intelligence-ingestor-production.up.railway.app/ingest?test=true" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "Replit",
    "source": "Discord",
    "id": "parent_post_id",
    "timestamp": "2024-01-15T10:35:00Z",
    "deeplink": "https://discord.com/channels/123/456/789",
    "author": "user987654",
    "title": "",
    "body": "Great point about API versioning!",
    "isComment": true,
    "likes": 8
  }'
```

### Retrieve Content by ID
```bash
curl -X GET "https://intelligence-ingestor-production.up.railway.app/retrieve/lovable_reddit_post_abc123" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Search Content
```bash
curl -X POST "https://intelligence-ingestor-production.up.railway.app/search?query=API%20development&limit=3" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Best Practices

1. **Use test collection:** Set `?test=true` during development
2. **Unique IDs:** Ensure source IDs are unique within platform+source combination
3. **Valid timestamps:** Use proper ISO 8601 format
4. **Meaningful titles:** Provide descriptive titles for posts (can be empty for comments)
5. **Error handling:** Check response status and handle failures gracefully

## Rate Limits
No explicit rate limits are currently enforced, but please be respectful of the service resources.

## Support
For issues or questions, please check the deployment logs or contact the development team.