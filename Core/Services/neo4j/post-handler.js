import { driver } from './Driver.js';
import axios from 'axios';
import {Client} from '@elastic/elasticsearch';
const client = new Client({node: 'http://localhost:9200'});

async function upsertPost(postId , postData){
  const {
    id,
    text,
    group_id,
    media,
    privacy,
    created_at,
    user
  } = postData;

  // Remove `id` from doc body — Elasticsearch doesn't want it in doc
  const doc = {
    text,
    group_id: group_id ?? null,
    media: Array.isArray(media) ? media : [],
    privacy: privacy || 'public',
    created_at: new Date(created_at).toISOString(),
    user: {
      id: user?.id ?? null,
      name: user?.name ?? null,
      username: user?.username ?? null,
      avatar: user?.avatar ?? null,
      is_private: user?.is_private ?? 0
    }
  };

  try {
    const res = await axios.post(
      `http://localhost:9200/posts/_update/${id}`,
      {
        doc,
        doc_as_upsert: true
      },
      {
        headers: {
          'Content-Type': 'application/vnd.elasticsearch+json; compatible-with=8',
          'Accept': 'application/vnd.elasticsearch+json; compatible-with=8'
        }
      }
    );

    console.log('Upsert successful:', res.data);
  } catch (err) {
    console.error('Elasticsearch upsert error', err.response?.data || err.message);
  }
}


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
  const mediaJson = JSON.stringify(media); 
  const mediaURLs = media.map(item => item.url);
  if (postType === 'Post' && privacy === 'public'&& user.is_private === 0) { // if these 2 are true then save that post to the elasticsearch cluster 
    await upsertPost(id , postData); 
    console.log('entered the upsertPost condition in post creating function'); 
    
  }
  const keywordsResponse = await axios.post(`http://localhost:5000/extract_keywords`, { text },{timeout : 50000});
  const Tags = Array.isArray(keywordsResponse.data.keywords)
  ? keywordsResponse.data.keywords.map(([word]) => word)
  : [];

  const session = driver.session();
 try {
  const tx = session.beginTransaction();

  // Ensure the user exists
  await tx.run(
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
  await tx.run(
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
  await tx.run(
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
    await tx.run(
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
    await tx.run(
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

  for (const tag of Tags) {
    await tx.run(
      `
      MERGE (h:Tag {name: $tag})
      WITH h
      MATCH (p:${postType} {id: $postId})
      MERGE (p)-[:HAS_TAG]->(h)
      `,
      {
        tag,
        postId: id
      }
    );
  }

  // Commit the transaction after all queries finish
  await tx.commit();

  console.log(`${postType} ${id} created with media as JSON and ${hashtags.length} hashtag(s).`);
} catch (error) {
  console.error('Error creating post:', error);
  throw error;
} finally {
  await session.close();
}}
export async function unlikePost(userId , postId){
  const session = driver.session();
  userId = parseFloat(userId);
  postId = parseFloat(postId);
  console.log("entering the unlike function");
  try{
    const posts = await session.run(`
      MATCH(u:User {id: $userId})-[l:LIKED]->(p:Post {id: $postId}) 
      WITH l  
      DELETE l 
      RETURN count(l) AS dc 
    `,{
        userId: userId, 
        postId: postId
      });
    const deletedCount = posts.records[0].get('dc').toNumber(); 
    if(deletedCount === 1) {
      console.log("deleted the like relationship and all is fun and games ");
    } else {
      const Reels = await session.run(`
      MATCH(u:User {id: $userId})-[l:LIKED]->(p:REEL {id: $postId}) 
      WITH l  
      DELETE l 
      RETURN count(l) AS dc 
       
      `,{
          userId: userId, 
          postId: postId
        });
    const Count = Reels.records[0].get('dc').toNumber(); 
    if(Count === 1) {
      console.log("deleted the like relationship for a REEL !!  and all is fun and games ");
    } 
    }

  await session.close(); 
  }catch(err){
    console.error("there was an error ", err); 
  }
  
  
}

export async function likePost(userId , postId){
  const session = driver.session();
  console.log("the userId is :" , userId); 
  postId = parseFloat(postId); 
  console.log("the postId is :" , postId);
  try {

const posts = await session.run(`
    MATCH (u:User {id: $userId})
   MATCH (p:Post {id: $postId})

  MERGE (u)-[l:LIKED]->(p)
    ON CREATE SET l.likedAt = timestamp(), l.likeCount = 1

  MERGE (u)-[s:SEEN]->(p)
    ON CREATE SET s.seenAt = timestamp(), s.seenCount = 1
    RETURN p 
`, {
  userId: userId,
  postId: postId 
});
    // if there was no posts found for this id then we will try with reels . 
   if(!posts.records[0]){
      const reels = await session.run(`
      MATCH (u:User {id: $userId})
      MATCH (r:REEL {id: $postId})
      MERGE (u)-[l:LIKED]->(r)
        ON CREATE SET l.likedAt = timestamp() 
      MERGE (u)-[s:SEEN]->(r)
        ON CREATE SET s.seetAt = timestamp()
      RETURN r
      `,{
          userId: userId , 
          postId: postId
        });
      if (!reels.records[0]) {
        console.log('there was no reels nor posts found with this id !!!!!!!!'); 
      }
    }
  await session.close(); 
  } catch (err) {
    console.error("error creating a like relationship" , err);
  }
}
