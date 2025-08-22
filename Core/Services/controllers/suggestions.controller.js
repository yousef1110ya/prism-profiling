import { driver } from "../neo4j/Driver.js";

export async function suggest_users(req, res) {
  // TODO :
  // 1- suggest users that the people you follow follow .
  // 2- suggest users that are in the same group you are in (and liked one of their posts )
  // 3- suggest the people that follows you .
  const userId = parseInt(req.user.id); // assumes auth middleware sets req.user
  const session = driver.session();

  try {
    const query = `
      
MATCH (me:User {id: $userId})

/* 1. People followed by people I follow */
OPTIONAL MATCH (me)-[:FOLLOW]->(:User)-[:FOLLOW]->(s1:User)
WITH me, COLLECT(DISTINCT {user:s1, priority:1}) AS r1

/* 2. Same group & liked their post */
OPTIONAL MATCH (me)-[:IS_MEMBER]->(g:Group)<-[:IS_MEMBER]-(s2:User)
OPTIONAL MATCH (s2)-[:CREATED]->(p:Post)<-[:LIKED]-(me)
WITH me, r1, COLLECT(DISTINCT {user:s2, priority:2}) AS r2

/* Merge r1 + r2 */
WITH me, r1 + r2 AS r12

/* 3. People who follow me */
OPTIONAL MATCH (s3:User)-[:FOLLOW]->(me)
WITH me, r12, COLLECT(DISTINCT {user:s3, priority:3}) AS r3

/* Merge everything */
WITH me, r12 + r3 AS allSuggestions
UNWIND allSuggestions AS sug
WITH DISTINCT sug.user AS s, min(sug.priority) AS priority, me
WHERE s IS NOT NULL AND s.id <> me.id

/* Following info */
OPTIONAL MATCH (me)-[:FOLLOW]->(s)
WITH s, priority, me, COUNT(*) > 0 AS is_following

OPTIONAL MATCH (me)-[:REQUESTED]->(s)
WITH s, priority, is_following, COUNT(*) > 0 AS is_requested

RETURN {
  id: s.id,
  name: s.name,
  username: s.username,
  avatar: s.avatar,
  is_following: is_following,
  is_requested: false,
  is_private: COALESCE(s.is_private, "0"),
  priority: priority
} AS suggestion

ORDER BY suggestion.priority ASC
LIMIT 10

    `;

    const result = await session.run(query, { userId });

    const suggestions = result.records.map((r) => {
      const sug = r.get("suggestion");
      delete sug.priority; // hide internal sorting field
      return sug;
    });

    res.json({
      type: "suggestion",
      suggestion_type: "profiles",
      list: suggestions,
    });
  } catch (err) {
    console.error("Error suggesting users:", err);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    await session.close();
  }
}
