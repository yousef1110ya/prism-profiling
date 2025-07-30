
import { session } from './Driver.js';

// Helper to extract hashtags from text
function extractHashtags(text) {
  const safeText = typeof text === 'string' ? text : '';
  const matches = safeText.match(/#\w+/g);
  return matches ? [...new Set(matches.map(tag => tag.toLowerCase()))] : [];
}

export async function createPost(postData) {
  const {
    id,
    text,
    group_id,
    media,
    privacy,
    created_at,
    user
  } = postData;

  const postType = media.length === 1 && media[0].type === 'video' ? 'REEL' : 'Post';
  const hashtags = extractHashtags(text);
  const mediaJson = JSON.stringify(media); // 👈 serialize media to JSON string

  try {
    // Ensure the user exists
    await session.run(
      `
      MERGE (u:User {id: $userId})
      SET u.name = $name,
          u.username = $username,
          u.avatar = $avatar,
          u.is_private = $is_private
      `,
      {
        userId: user.id,
        name: user.name,
        username: user.username,
        avatar: user.avatar,
        is_private: !!user.is_private
      }
    );

    // Create the Post or REEL node with JSON string media
    await session.run(
      `
      CREATE (p:${postType} {
        id: $postId,
        text: $text,
        privacy: $privacy,
        created_at: datetime($created_at),
        media_json: $mediaJson
      })
      `,
      {
        postId: id,
        text,
        privacy,
        created_at,
        mediaJson
      }
    );

    // Link user to post
    await session.run(
      `
      MATCH (u:User {id: $userId}), (p:${postType} {id: $postId})
      MERGE (u)-[:CREATED]->(p)
      `,
      {
        userId: user.id,
        postId: id
      }
    );

    // Link post to group if applicable
    if (group_id) {
      await session.run(
        `
        MERGE (g:Group {id: $groupId})
        MATCH (p:${postType} {id: $postId})
        MERGE (p)-[:BELONGS_TO]->(g)
        `,
        {
          groupId: group_id,
          postId: id
        }
      );
    }

    // Handle hashtags
    for (const tag of hashtags) {
      await session.run(
        `
        MERGE (h:Hashtag {name: $tag})
        WITH h
        MATCH (p:${postType} {id: $postId})
        MERGE (p)-[:TAGGED_WITH]->(h)
        `,
        {
          tag,
          postId: id
        }
      );
    }

    console.log(`${postType} ${id} created with media as JSON and ${hashtags.length} hashtag(s).`);
  } catch (error) {
    console.error('Error creating post:', error);
    throw error;
  }
}
