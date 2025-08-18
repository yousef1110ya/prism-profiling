import { driver } from "../neo4j/Driver.js";
import { formatDateTime, mapContent } from "./feed.controller.js";

export async function reel_suggestions(req, res) {
  const id = req.user.id;
  const reel_id = req.params.id;
  const session = driver.session();
  const tx = session.beginTransaction();

  try {
    let seen_postResults = [];
    let reelResults = [];

    //
    // STEP 1: Reels from followed users
    //
    const reels_follows = await tx.run(
      `
      MATCH (u:User {id: $id})-[:FOLLOW]->(followed:User)-[:CREATED]->(reels:REEL)
      WHERE NOT (u)-[:SEEN]->(reels)
      OPTIONAL MATCH (u)-[f:FOLLOW]->(followed)
      WITH u, reels, followed AS creator, CASE WHEN f IS NULL THEN false ELSE true END AS is_following
      LIMIT 1
      MERGE (u)-[s:SEEN]->(reels)
      SET s.seenAt = datetime()
      RETURN reels AS reels, creator, is_following
      `,
      { id },
    );

    if (reels_follows.records.length > 0) {
      console.log("returning from the reel_follows");
      reelResults = reels_follows.records.map((rec) =>
        mapContent(rec, "reels", "reel"),
      );
    }

    //
    // STEP 2: Reels based on likes/tags
    //
    if (reelResults.length === 0) {
      const reels_suggest = await tx.run(
        `
        MATCH (a:User {id: $id})-[:LIKED]->(p:REEL)
        MATCH (p2:REEL)
        WHERE p2 <> p
          AND NOT (a)-[:SEEN]->(p2)
          AND p2.privacy <> "private"
          AND NOT EXISTS { MATCH (a)-[:FOLLOW]->(:User)-[:CREATED]->(p2) }
          AND NOT (a)-[:CREATED]->(p2)
          AND NOT EXISTS { MATCH (p2)-[:BELONGS_TO]->(:Group {privacy: "private"}) }
          AND NOT EXISTS { MATCH (a)-[:IS_MEMBER|:OWNS]->(:Group)<-[:BELONGS_TO]-(p2) }
        OPTIONAL MATCH (p)-[:HAS_TAG]->(t:Tag)<-[:HAS_TAG]-(p2)
        WITH a, p, p2, collect(DISTINCT t) AS sharedTags
        OPTIONAL MATCH (p)-[:TAGGED_WITH]->(h:Hashtag)<-[:TAGGED_WITH]-(p2)
        WITH a, p2, sharedTags, collect(DISTINCT h) AS sharedHashtags
        WITH a, p2, size(sharedTags) AS tagCount, size(sharedHashtags) AS hashtagCount,
             (size(sharedTags) + size(sharedHashtags)) AS relevanceScore
        WHERE relevanceScore > 0
        MATCH (creator:User)-[:CREATED]->(p2)
        OPTIONAL MATCH (a)-[f:FOLLOW]->(creator)
        WITH a, p2, creator, CASE WHEN f IS NULL THEN false ELSE true END AS is_following, relevanceScore
        ORDER BY relevanceScore DESC
        LIMIT 1
        MERGE (a)-[s:SEEN]->(p2)
        SET s.seenAt = datetime()
        RETURN p2 AS reels, creator, is_following
        `,
        { id },
      );

      if (reels_suggest.records.length > 0) {
        console.log("returning from reel_suggestions");
        reelResults = reels_suggest.records.map((rec) =>
          mapContent(rec, "reels", "reel"),
        );
      }
    }

    //
    // STEP 4: TRENDING fallback (guarantee at least one reel)
    //
    if (reelResults.length === 0) {
      const trending = await tx.run(
        `
  
MATCH (u:User {id: $id})
MATCH (p:REEL)
WHERE p.privacy <> "private"
  AND NOT (u)-[:SEEN]->(p)  // exclude reels the user has already seen
WITH p, u
MATCH (p)<-[s:SEEN]-(:User)
WHERE s.seenAt >= datetime() - duration({days:1})  // trending in last 1 day
WITH p, count(s) AS seenCount, u
MATCH (creator:User)-[:CREATED]->(p)
OPTIONAL MATCH (u)-[f:FOLLOW]->(creator)
WITH p, creator, CASE WHEN f IS NULL THEN false ELSE true END AS is_following, seenCount, u
ORDER BY seenCount DESC
WITH collect(p) AS topReels, collect(creator) AS topCreators, collect(is_following) AS topFollowing, u
// pick one random reel from top trending reels with highest seenCount
WITH topReels[0..10] AS top10Reels, topCreators[0..10] AS top10Creators, topFollowing[0..10] AS top10Following, u
WITH top10Reels[toInteger(rand() * size(top10Reels))] AS p,
     top10Creators[toInteger(rand() * size(top10Creators))] AS creator,
     top10Following[toInteger(rand() * size(top10Following))] AS is_following,
     u
MERGE (u)-[ns:SEEN]->(p)
SET ns.seenAt = datetime()
RETURN p AS reels, creator, is_following
`,
        { id },
      );

      if (trending.records.length > 0) {
        console.log("returning from trending");
        reelResults = trending.records.map((rec) =>
          mapContent(rec, "reels", "reel"),
        );
      } else {
        return res.json({
          message: "no more reels go get a life",
          reel: [],
        });
      }
    }

    const result = [...reelResults, ...seen_postResults];
    res.json({ message: "reel fetched", reel: result });
  } catch (error) {
    console.error("reel_suggestions error", error);
    res.status(500).json({ error: error.message });
  } finally {
    await tx.commit();
    await session.close();
  }
}
