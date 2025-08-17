import { driver } from "../neo4j/Driver.js";
// TODO :
// 3- fix ( it's returning the same posts even thoug they are seen by the user !!! )
// 4- add the dead-case (return 8 posts and 2 reels to the user in this case ) .
//
// Format Neo4j DateTime into ISO string
function formatDateTime(dt) {
  if (!dt) return null;
  const { year, month, day, hour, minute, second } = dt;
  return new Date(
    year.low,
    month.low - 1, // JS months are 0-based
    day.low,
    hour.low,
    minute.low,
    second.low,
  ).toISOString();
}

// Parse post/reel with creator + post_type
function mapContent(record, key, post_type) {
  const node = record.get(key);
  const props = node.properties;

  const creator = record.get("creator")?.properties || {};
  const is_following = record.get("is_following") || false;

  return {
    id: props.id,
    text: props.text,
    group_id: props.group_id || null,
    media: JSON.parse(props.media_json || "[]"),
    privacy: props.privacy,
    created_at: formatDateTime(props.created_at),
    post_type,
    user: {
      id: creator.id,
      name: creator.name,
      username: creator.username,
      avatar: creator.avatar,
      is_following,
      is_private: creator.is_private || 0,
    },
  };
}

export async function feed(req, res) {
  const id = req.user.id;
  const session = driver.session();
  const tx = session.beginTransaction();

  try {
    // --- Step 1: Check follows ---
    const follow_count = await tx.run(
      `
      MATCH (u:User {id: $id})-[f:FOLLOW]->(b:User)
      RETURN COUNT(f) AS follows
      `,
      { id },
    );

    if (follow_count.records[0].get("follows").toInt() !== 0) {
      // --- Step 2: Suggestions ---
      const suggestions = await tx.run(
        `
        
MATCH (u:User {id: $id})-[:LIKED]->(p:Post)
MATCH (p)-[:HAS_TAG|:TAGGED_WITH]->(tagOrHash)
MATCH (p2:Post)-[:HAS_TAG|:TAGGED_WITH]->(tagOrHash)
WHERE p2 <> p
  AND NOT (u)-[:SEEN]->(p2)
  AND p2.privacy <> "private"
  AND NOT EXISTS { MATCH (u)-[:FOLLOW]->(:User)-[:CREATED]->(p2) }
  AND NOT EXISTS { MATCH (u)-[:CREATED]->(p2) }
OPTIONAL MATCH (p2)-[:BELONGS_TO]->(g:Group)
WHERE g IS NULL OR (g.privacy <> "private" AND NOT (u)-[:IS_MEMBER|:OWNS]->(g))
WITH u, p2, tagOrHash, g
OPTIONAL MATCH (p)-[:HAS_TAG]->(t:Tag)<-[:HAS_TAG]-(p2)
OPTIONAL MATCH (p)-[:TAGGED_WITH]->(h:Hashtag)<-[:TAGGED_WITH]-(p2)
WITH u, p2, collect(DISTINCT t) AS sharedTags, collect(DISTINCT h) AS sharedHashtags
WITH u, p2, size(sharedTags) AS tagCount, size(sharedHashtags) AS hashtagCount, (size(sharedTags) + size(sharedHashtags)) AS relevanceScore
WHERE relevanceScore > 0
MATCH (creator:User)-[:CREATED]->(p2)
OPTIONAL MATCH (u)-[f:FOLLOW]->(creator)
WITH u, p2, creator, COALESCE(f IS NOT NULL, false) AS is_following, relevanceScore
ORDER BY relevanceScore DESC
LIMIT 3
MERGE (u)-[s:SEEN]->(p2)
SET s.seenAt = datetime()
RETURN p2, creator, is_following

        `,
        { id },
      );

      // --- Step 3: Posts from followed users ---
      const posts = await tx.run(
        `
        MATCH (u:User {id: $id})

        OPTIONAL MATCH (u)-[:FOLLOW]->(u2:User)-[:CREATED]->(p:Post)
        WHERE u <> u2

        OPTIONAL MATCH (u)-[:IS_MEMBER]->(g:Group)<-[:BELONGS_TO]-(p)

        OPTIONAL MATCH (u)-[:OWNS]->(g:Group)<-[:BELONGS_TO]-(p)

        WHERE NOT (u)-[:SEEN]->(p)

        WITH DISTINCT u, p, u2, g
        MATCH (u)-[f:FOLLOW]->(u2)

        WITH u, p,
            CASE WHEN u2 IS NOT NULL THEN u2 END AS creator,
            CASE WHEN g IS NOT NULL THEN g END AS group,
            CASE WHEN f IS NULL THEN false ELSE true END AS is_following

        LIMIT 4

        MERGE (u)-[s:SEEN]->(p)
        SET s.seenAt = datetime() 
        RETURN p, creator, group, is_following
        `,
        { id },
      );

      // --- Step 4: Reels ---
      let reels;
      const reels_follows = await tx.run(
        `
        MATCH (u:User {id: $id})-[:FOLLOW]->(followed:User)-[:CREATED]->(reels:REEL)
        OPTIONAL MATCH (u)-[:IS_MEMBER]->(g1:Group)<-[:BELONGS_TO]-(reels) 
        OPTIONAL MATCH (u)-[:OWNS]->(g2:Group)<-[:BELONGS_TO]-(reels) 
        WHERE NOT (u)-[:SEEN]->(reels) 
        WITH u, reels, followed
        OPTIONAL MATCH (u)-[f:FOLLOW]->(followed)
        WITH u, reels, followed AS creator, CASE WHEN f IS NULL THEN false ELSE true END AS is_following
        LIMIT 2 
        MERGE (u)-[s:SEEN]->(reels)
        SET s.seenAt = datetime()
        RETURN reels, creator, is_following
        `,
        { id },
      );

      reels = reels_follows.records;

      if (reels.length === 0) {
        const reels_suggest = await tx.run(
          `
         
MATCH (a:User {id: $id})-[:LIKED]->(p:REEL)
MATCH (p2:REEL)
WHERE p2 <> p 
  AND NOT (a)-[:SEEN]->(p2)
  AND p2.privacy <> "private"
  AND NOT EXISTS {
    MATCH (a)-[:FOLLOW]->(:User)-[:CREATED]->(p2)
  }
  AND NOT EXISTS {
    MATCH (a)-[:CREATED]->(p2)
  }
  // exclude reels from private groups
  AND NOT EXISTS {
    MATCH (p2)-[:BELONGS_TO]->(:Group {privacy: "private"})
  }
  // exclude any group reels where the user is a member/owner
  AND NOT EXISTS {
    MATCH (a)-[:IS_MEMBER|:OWNS]->(:Group)<-[:BELONGS_TO]-(p2)
  }
OPTIONAL MATCH (p)-[:HAS_TAG]->(t:Tag)<-[:HAS_TAG]-(p2)
WITH a, p, p2, collect(DISTINCT t) AS sharedTags
OPTIONAL MATCH (p)-[:TAGGED_WITH]->(h:Hashtag)<-[:TAGGED_WITH]-(p2)
WITH a, p2, sharedTags, collect(DISTINCT h) AS sharedHashtags
WITH a, p2, size(sharedTags) AS tagCount, size(sharedHashtags) AS hashtagCount
WITH a, p2, tagCount, hashtagCount, (tagCount + hashtagCount) AS relevanceScore
WHERE relevanceScore > 0
MATCH (creator:User)-[:CREATED]->(p2)
OPTIONAL MATCH (a)-[f:FOLLOW]->(creator)
WITH a, p2, creator, CASE WHEN f IS NULL THEN false ELSE true END AS is_following, relevanceScore 
ORDER BY relevanceScore DESC 
LIMIT 3
MERGE (a)-[s:SEEN]->(p2)
SET s.seenAt = datetime()
RETURN p2 AS reels, creator, is_following
          `,
          { id },
        );
        reels = reels_suggest.records;
      }

      // --- Step 5: Map results ---
      const suggestionResults = suggestions.records.map((rec) =>
        mapContent(rec, "p2", "suggestion"),
      );
      const postResults = posts.records.map((rec) =>
        mapContent(rec, "p", "post"),
      );
      const reelResults = reels.map((rec) => mapContent(rec, "reels", "reel"));

      let allResults = [...suggestionResults, ...postResults, ...reelResults];
      if (allResults.length < 10) {
        const remaining = Math.floor(10 - allResults.length);
        console.log(remaining);
        const suggestion_filler = await tx.run(
          `
        MATCH (u:User {id: $id})-[:LIKED]->(p:Post)
        MATCH (p)-[:HAS_TAG|:TAGGED_WITH]->(tagOrHash)
        MATCH (p2:Post)-[:HAS_TAG|:TAGGED_WITH]->(tagOrHash)
        WHERE p2 <> p
          AND NOT (u)-[:SEEN]->(p2)
          AND NOT EXISTS {
            MATCH (u)-[:FOLLOW]->(:User)-[:CREATED]->(p2)
          }
          AND NOT EXISTS {
            MATCH (u)-[:CREATED]->(p2)
          }
        WITH u, p2, collect(DISTINCT tagOrHash) AS shared
        WITH u, p2, size(shared) AS relevanceScore
        WHERE relevanceScore > 0
        WITH u, p2, relevanceScore
        MATCH (creator:User)-[:CREATED]->(p2)
        OPTIONAL MATCH (u)-[f:FOLLOW]->(creator)
        WITH u, p2, creator, CASE WHEN f IS NULL THEN false ELSE true END AS is_following, relevanceScore
        ORDER BY relevanceScore DESC
        LIMIT toInteger($remaining)
        MERGE (u)-[s:SEEN]->(p2)
        SET s.seenAt = datetime()
        RETURN p2, creator, is_following
        `,
          { id, remaining },
        );
        const suggestion_filler_result = suggestion_filler.records.map((rec) =>
          mapContent(rec, "p2", "suggestion"),
        );
        allResults = [...allResults, ...suggestion_filler_result];
      }

      res.json(allResults);
    } else {
      // TODO:
      // 1- check if the user liked any posts
      // 2- suggest posts and reels 8/2 for the user based on :
      //      1- the most seen posts in the past day if he didn't like any posts / reels
      //      2- normal suggestions if he has liked posts and reels
      //
      // --- Else case: user follows no one ---
      res.send("this is the else case");
    }
  } catch (error) {
    console.error("a feed error", error);
    res.status(500).send("Internal server error");
  } finally {
    await tx.commit();
    await session.close();
  }
}
