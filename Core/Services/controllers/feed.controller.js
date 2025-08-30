import { driver } from "../neo4j/Driver.js";
import * as SUGGEST from "./suggestions.controller.js";
import { get_ad } from "./ad.controller.js";
// TODO :
// 1- let the return of already seen posts be returning posts created by a week ago  (or a day is better );
// 2- remvoe the blocked people .
// Format Neo4j DateTime into ISO string

const url = process.env.URL || "localhost:6000/api";

export function formatDateTime(dt) {
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

export function mapContent(record, key, post_type) {
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
      name: creator.name || null,
      username: creator.username || null,
      avatar: creator.avatar || null,
      is_following,
      is_private: creator.is_private || 0,
    },
  };
}
async function suggestion_query(tx, id) {
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
WITH u, p, p2, tagOrHash, g
OPTIONAL MATCH (p)-[:HAS_TAG]->(t:Tag)<-[:HAS_TAG]-(p2)
OPTIONAL MATCH (p)-[:TAGGED_WITH]->(h:Hashtag)<-[:TAGGED_WITH]-(p2)
WITH u, p2, collect(DISTINCT t) AS sharedTags, collect(DISTINCT h) AS sharedHashtags
WITH u, p2, size(sharedTags) AS tagCount, size(sharedHashtags) AS hashtagCount, (size(sharedTags) + size(sharedHashtags)) AS relevanceScore
WHERE relevanceScore > 0
MATCH (creator:User)-[:CREATED]->(p2)
WHERE creator.privacy <> "private"
  AND NOT EXISTS { MATCH (u)-[:BLOCKED]->(creator) }   // 🚫 exclude blocked creators
OPTIONAL MATCH (u)-[f:FOLLOW]->(creator)
WITH u, p2, creator, COALESCE(f IS NOT NULL, false) AS is_following, relevanceScore
ORDER BY relevanceScore DESC
LIMIT 3
MERGE (u)-[s:SEEN]->(p2)
SET s.seenAt = datetime()
RETURN p2, creator, is_following        `,
    { id },
  );
  return suggestions;
}

async function posts_query(tx, id) {
  const posts = await tx.run(
    `
        MATCH (u:User {id: $id})

        OPTIONAL MATCH (u)-[:FOLLOW]->(u2:User)-[:CREATED]->(p:Post)
        WHERE u <> u2

        OPTIONAL MATCH (u)-[:IS_MEMBER]->(g:Group)<-[:BELONGS_TO]-(p)

        OPTIONAL MATCH (u)-[:OWNS]->(g:Group)<-[:BELONGS_TO]-(p)

        WITH DISTINCT u, p, u2, g
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
  return posts;
}

async function reels_query(tx, id) {
  let reels;
  const reels_follows = await tx.run(
    `
        MATCH (u:User {id: $id})-[:FOLLOW]->(followed:User)-[:CREATED]->(reels:REEL)
        OPTIONAL MATCH (u)-[:IS_MEMBER]->(g1:Group)<-[:BELONGS_TO]-(reels) 
        OPTIONAL MATCH (u)-[:OWNS]->(g2:Group)<-[:BELONGS_TO]-(reels) 
        WITH DISTINCT u, reels, followed, g1 , g2
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
  AND NOT (a)-[s:SEEN]->(p2)
          WHERE s.seenAt >= datetime() -duration('P1D') 
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

  return reels;
}

async function suggested_reels(id) {
  let reels;
  const session = driver.session();
  try {
    const reels_suggest = await session.run(
      `
MATCH (a:User {id: $id})-[:LIKED]->(p:REEL)
MATCH (p2:REEL)
WHERE p2 <> p 
  AND NOT EXISTS{ 
    MATCH (a)-[s:SEEN]->(p2)
    WHERE  s.seenAt >= datetime() - duration('P1D') 
  }
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
LIMIT 5 
MERGE (a)-[s:SEEN]->(p2)
SET s.seenAt = datetime()
RETURN p2 AS reels, creator, is_following
          `,
      { id },
    );
    reels = reels_suggest.records.map((rec) =>
      mapContent(rec, "reels", "reel"),
    );
    console.log("the reels are :", reels);
    return reels;
  } catch (error) {
    console.log("error suggesting reels", error);
  } finally {
    await session.close();
  }
}

async function suggestion_filler_query(tx, id, remaining) {
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
  return suggestion_filler;
}

async function seen_posts_query(tx, id, remainder) {
  const seen_posts = await tx.run(
    `
     MATCH (u:User {id: $id})

OPTIONAL MATCH (u)-[:FOLLOW]->(u2:User)-[:CREATED]->(p:Post)
WHERE u <> u2

OPTIONAL MATCH (u)-[:IS_MEMBER]->(g:Group)<-[:BELONGS_TO]-(p)

OPTIONAL MATCH (u)-[:OWNS]->(g:Group)<-[:BELONGS_TO]-(p)

WHERE (u)-[:SEEN]->(p)

WITH DISTINCT u, p, u2, g
MATCH (u)-[f:FOLLOW]->(u2)

WITH u, p,
    CASE WHEN u2 IS NOT NULL THEN u2 END AS creator,
    CASE WHEN g IS NOT NULL THEN g END AS group,
    CASE WHEN f IS NULL THEN false ELSE true END AS is_following

MERGE (u)-[s:SEEN]->(p)
ON CREATE SET s.seenAt = datetime(), s.count = 1
ON MATCH SET  s.seenAt = datetime(), s.count = coalesce(s.count,0) + 1

WITH p, creator, group, is_following, s
ORDER BY s.count ASC, s.seenAt DESC  
LIMIT toInteger($remainder)

RETURN p, creator, group, is_following
`,
    { id, remainder },
  );
  return seen_posts;
}

async function dead_case_query(tx, id) {
  // TODO:
  // 1- check if the user liked any posts
  // 2- suggest posts and reels 8/2 for the user based on :
  //      1- the most seen posts in the past day if he didn't like any posts / reels
  //      2- normal suggestions if he has liked posts and reels
  //
  // --- Else case: user follows no one ---
  // Step 1: check if user liked any posts or reels
  const liked_count = await tx.run(
    `
        MATCH (u:User {id: $id})-[:LIKED]->(c)
        WHERE c:Post OR c:REEL
        RETURN COUNT(c) AS likes
        `,
    { id },
  );
  const hasLikes = liked_count.records[0].get("likes").toInt() > 0;

  let postResults = [];
  let reelResults = [];

  if (hasLikes) {
    // --- Case 1: user has likes → suggest posts/reels ---

    // 8 posts suggestions
    const suggestedPosts = await tx.run(
      `
          MATCH (u:User {id: $id})-[:LIKED]->(p:Post)
          MATCH (p)-[:HAS_TAG|:TAGGED_WITH]->(tagOrHash)
          MATCH (p2:Post)-[:HAS_TAG|:TAGGED_WITH]->(tagOrHash)
          WHERE p2 <> p
            AND NOT (u)-[:SEEN]->(p2)
            AND p2.privacy <> "private"
          OPTIONAL MATCH (creator:User)-[:CREATED]->(p2)
          OPTIONAL MATCH (u)-[f:FOLLOW]->(creator)
          WITH u, p2, creator, COALESCE(f IS NOT NULL, false) AS is_following, COUNT(tagOrHash) AS relevanceScore
          ORDER BY relevanceScore DESC
          LIMIT 8
          MERGE (u)-[s:SEEN]->(p2)
          SET s.seenAt = datetime()
          RETURN p2, creator, is_following
          `,
      { id },
    );
    postResults = suggestedPosts.records.map((rec) =>
      mapContent(rec, "p2", "post"),
    );

    // 2 reels suggestions
    const suggestedReels = await tx.run(
      `
          MATCH (u:User {id: $id})-[:LIKED]->(p:REEL)
          MATCH (p2:REEL)
          WHERE p2 <> p
            AND NOT (u)-[:SEEN]->(p2)
            AND p2.privacy <> "private"
          OPTIONAL MATCH (creator:User)-[:CREATED]->(p2)
          OPTIONAL MATCH (u)-[f:FOLLOW]->(creator)
          WITH u, p2, creator, COALESCE(f IS NOT NULL, false) AS is_following
          LIMIT 2
          MERGE (u)-[s:SEEN]->(p2)
          SET s.seenAt = datetime()
          RETURN p2 AS reels, creator, is_following
          `,
      { id },
    );
    reelResults = suggestedReels.records.map((rec) =>
      mapContent(rec, "reels", "reel"),
    );
  } else {
    // --- Case 2: no likes → trending content (seen the most in past 1 day) ---

    // 8 trending posts
    const trendingPosts = await tx.run(
      `
          
MATCH (u:User {id: $id})
MATCH (p:Post)<-[s:SEEN]-()
WHERE s.seenAt > datetime() - duration('P10D')
  AND NOT (u)-[:SEEN]->(p)
WITH u, p, COUNT(s) AS seenCount
ORDER BY seenCount DESC
LIMIT 8
MATCH (creator:User)-[:CREATED]->(p)
OPTIONAL MATCH (u)-[f:FOLLOW]->(creator)
WITH u, p, creator, COALESCE(f IS NOT NULL, false) AS is_following
MERGE (u)-[s2:SEEN]->(p)
SET s2.seenAt = datetime()
RETURN p, creator, is_following
         `,
      { id },
    );
    postResults = trendingPosts.records.map((rec) =>
      mapContent(rec, "p", "post"),
    );

    // 2 trending reels
    const trendingReels = await tx.run(
      `
          
MATCH (u:User {id: $id})
MATCH (r:REEL)<-[s:SEEN]-()
WHERE s.seenAt > datetime() - duration('P1D')
  AND NOT (u)-[:SEEN]->(r)
WITH u, r, COUNT(s) AS seenCount
ORDER BY seenCount DESC
LIMIT 2
MATCH (creator:User)-[:CREATED]->(r)
OPTIONAL MATCH (u)-[f:FOLLOW]->(creator)
WITH u, r, creator, COALESCE(f IS NOT NULL, false) AS is_following
MERGE (u)-[s2:SEEN]->(r)
SET s2.seenAt = datetime()
RETURN r AS reels, creator, is_following

          `,
      { id },
    );
    reelResults = trendingReels.records.map((rec) =>
      mapContent(rec, "reels", "reel"),
    );
  }
  console.log("just finished the dead=case");
  const full_results = [...postResults, ...reelResults];
  if (!full_results) return [];
  return full_results;
}

async function random_suggestions(id) {
  console.log("entered the random suggestion function");
  const session = driver.session();
  const tx = session.beginTransaction();
  try {
    let full_results = await dead_case_query(tx, id);
    if (full_results.length === 0) {
      console.log("entered the seen posts");
      const seen = await seen_posts_query(
        tx,
        id,
        Math.floor(Math.random() * (5 - 3 + 1)) + 3,
      );
      console.log(seen);
      const seen_postResults = seen.records.map((rec) =>
        mapContent(rec, "p", "post"),
      );
      console.log("========");
      console.log(seen_postResults);
      return seen_postResults;
    }
    return full_results;
  } catch (error) {
    console.log("a random suggestions error : ", error);
    return [];
  } finally {
    await tx.commit();
    await session.close();
  }
}

async function feed_builder(id) {
  const session = driver.session();
  const tx = session.beginTransaction();

  try {
    // --- Step 1: Check follows ---
    console.log("checking for follows");
    const follow_count = await tx.run(
      `
      MATCH (u:User {id: $id})-[f:FOLLOW]->(b:User)
      RETURN COUNT(f) AS follows
      `,
      { id },
    );

    if (follow_count.records[0].get("follows").toInt() !== 0) {
      // --- Step 2: Suggestions ---
      const suggestions = await suggestion_query(tx, id);
      // --- Step 3: Posts from followed users ---
      const posts = await posts_query(tx, id);
      // --- Step 4: Reels ---
      console.log("entering the ad feild");
      const ad = await get_ad(id);
      // --- Step 5: Map results ---
      const suggestionResults = suggestions.records.map((rec) =>
        mapContent(rec, "p2", "suggestion"),
      );
      const postResults = posts.records.map((rec) =>
        mapContent(rec, "p", "post"),
      );
      // --- step 6: arrangin array ---
      console.log("the ad is:", ad);
      let allResults = [...postResults, ...suggestionResults];
      if (ad) {
        allResults = [...allResults, ad];
      }
      // --- step 7: filling missing posts ---
      if (allResults.length < 10) {
        const remaining = Math.floor(10 - allResults.length);
        console.log(remaining);
        const suggestion_filler = await suggestion_filler_query(
          tx,
          id,
          remaining,
        );
        // --- maping suggestion filler ---
        const suggestion_filler_result = suggestion_filler.records.map((rec) =>
          mapContent(rec, "p2", "suggestion"),
        );
        allResults = [...allResults, ...suggestion_filler_result];
        // --- filling with already seen posts ---
        if (allResults.length < 10) {
          const remainder = Math.floor(10 - allResults.length);
          const seen_posts = await seen_posts_query(tx, id, remainder);
          // --- mapping seen posts ---
          const seen_postResults = seen_posts.records.map((rec) =>
            mapContent(rec, "p", "post"),
          );
          allResults = [...allResults, ...seen_postResults];
        }
      }

      return allResults;
    } else {
      // --- handling the dead_case "the user follows no one" ---
      const ad = await get_ad(id);
      let full_results = await dead_case_query(tx, id);
      full_results = [...full_results, ad];
      return full_results;
    }
  } catch (error) {
    console.error("a feed error", error);
    return null;
  } finally {
    await tx.commit();
    await session.close();
  }
}

async function call_function(page, req) {
  switch (page % 6) {
    case 1:
      // --- suggest profiles ---
      let profiles = await SUGGEST.users(parseInt(req.user.id));

      const result = {
        feed_type: "suggestions",
        suggestion_type: "profiles",
        feed: profiles,
      };
      return result;
      break;
    case 2:
      // --- suggest a random number of suggested posts ---
      let random = await random_suggestions(parseInt(req.user.id));
      if (!random) {
        random = [];
      }
      const random_result = {
        feed_type: "posts",
        suggestion_type: null,
        feed: random,
      };
      return random_result;
      break;
    case 3:
      // --- suggesting groups : with 20% chanse to get already seen posts ---
      if (Math.random() < 0.2) {
        // --- returning a small number of already seen posts ---
        console.log("you are among the lucky 20%");
        const session = driver.session();
        const tx = session.beginTransaction();
        try {
          const seen = await seen_posts_query(
            tx,
            parseInt(req.user.id),
            Math.floor(Math.random() * (3 - 1 + 1)) + 1,
          );
          console.log(seen);
          const seen_postResults = seen.records.map((rec) =>
            mapContent(rec, "p", "post"),
          );
          console.log("========");
          console.log(seen_postResults);
          const seen_post_restule = {
            feed_type: "posts",
            suggestion_type: null,
            feed: seen_postResults,
          };
          return seen_post_restule;
        } catch (error) {
          console.log("error returning seen posts fillers", error);
        } finally {
          await tx.commit();
          await session.close();
        }
      }
      // --- suggesting normal groups ---
      const groups = await SUGGEST.groups(parseInt(req.user.id));
      const group_results = {
        feed_type: "suggestions",
        suggestion_type: "groups",
        feed: groups,
      };
      return group_results;
      break;
    case 4:
      const feed_copy = await feed_builder(parseFloat(req.user.id));
      const feed_copy_result = {
        feed_type: "posts",
        suggestion_type: null,
        feed: feed_copy,
      };

      return feed_copy_result;
      break;
    case 5:
      //TODO:
      // 1- suggest 5 reels for the user .
      const suggested_reels_result = await suggested_reels(
        parseInt(req.user.id),
      );
      const reel_results = {
        feed_type: "suggestions",
        suggestion_type: "groups",
        feed: suggested_reels_result,
      };

      return reel_results;
      break;
    default:
      const feed_array = await feed_builder(parseFloat(req.user.id));
      const feed_result = {
        feed_type: "posts",
        suggestion_type: null,
        feed: feed_array,
      };

      return feed_result;
      break;
  }
}
export async function feed(req, res) {
  // TODO:
  // 1- return the normal feed from the feed builder if no params are provided .
  // 2- if the params % 4 == 1 then return

  let page = parseInt(req.query.page || "0", 10);

  if (isNaN(page) || page < 0) {
    return res.status(400).send("Invalid number");
  }

  const result = await call_function(page, req);
  const pageination = {
    next_page: `http://` + url + `/feed?page=${page + 1}`,
    more: `http://` + url + `/feed?page=${page}`,
  };
  res.json({
    message: "feed fetched succesfully",
    feed_type: result.feed_type,
    suggestion_type: result.suggestion_type || null,
    feed: result.feed,
    pageination,
  });
}
