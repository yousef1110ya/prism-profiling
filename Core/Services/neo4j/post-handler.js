
import { session } from './Driver.js';
import axios from 'axios'; 
/*
function getTagsFromTextAndMedia(text , mediaUrls , topN =5) {
  return new Promise((resolve , reject) => {
    const scriptPath = path.join(__dirname,'..','..','..','AI-Model','app.py');
    const pyshell = new PythonShell(scriptPath); 

    const input = JSON.stringify({
      text: text , 
      media_urls: mediaUrls , 
      top_n: topN
    });
    let outpupData = '';
    pyshell.send(input); 
    pyshell.on('message',(message) => {
      outpupData += message ; 
    });

    pyshell.end((err) => {
      if(err) return reject(err); 

      try{
        const resulet = JSON.parse(outpupData);
        resolve(resulet); 

      }catch(e){
        reject(new Error('Failed to parse Python code '));
      }
    });
  });
}

*/

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

  const keywordsResponse = await axios.post(`http://localhost:5000/extract_keywords`, { text },{timeout : 5000});
  const Tags = Array.isArray(keywordsResponse.data.keywords)
  ? keywordsResponse.data.keywords.map(([word]) => word)
  : [];

  /*
  try {
      const tags = await getTagsFromTextAndMedia(text , mediaURLs , 5);
      for (const tag of tags) {
        await session.run(
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
    } catch(err) {
        console.log('Error', err); 
    }

  })();
*/

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
      for (const tag of Tags) {
        await session.run(
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
 
    console.log(`${postType} ${id} created with media as JSON and ${hashtags.length} hashtag(s).`);
  } catch (error) {
    console.error('Error creating post:', error);
    throw error;
  }
}
export async function unlikePost(userId , postId){
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
    if(deletedCount === 1) console.log("deleted the like relationship and all is fun and games ");
  }catch(err){
    console.error("there was an error ", err); 
  }
  
  
}

export async function likePost(userId , postId){
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
  } catch (err) {
    console.error("error creating a like relationship" , err);
  }
}
