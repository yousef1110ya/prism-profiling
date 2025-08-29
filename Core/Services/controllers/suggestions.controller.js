import { driver } from "../neo4j/Driver.js";

export async function users(userId) {
  const session = driver.session();

  try {
    const query = `
MATCH (me:User {id: $userId})

/* 1. People followed by people I follow */
OPTIONAL MATCH (me)-[:FOLLOW]->(:User)-[:FOLLOW]->(s1:User)
WHERE NOT (me)-[:FOLLOW]->(s1) 
WITH me, COLLECT(DISTINCT {user:s1, priority:2}) AS r1

/* 2. Same group & liked their post */
OPTIONAL MATCH (me)-[:IS_MEMBER]->(g:Group)<-[:IS_MEMBER]-(s2:User)
OPTIONAL MATCH (s2)-[:CREATED]->(p:Post)<-[:LIKED]-(me)
WHERE NOT (me)-[:FOLLOW]->(s2)   
WITH me, r1, COLLECT(DISTINCT {user:s2, priority:3}) AS r2

/* Merge r1 + r2 */
WITH me, r1 + r2 AS r12

/* 3. People who follow me */
OPTIONAL MATCH (s3:User)-[:FOLLOW]->(me) 
WHERE NOT (me)-[:FOLLOW]->(s3)
WITH me, r12, COLLECT(DISTINCT {user:s3, priority:1}) AS r3

/* Merge everything */
WITH me, r12 + r3 AS allSuggestions
UNWIND allSuggestions AS sug
WITH DISTINCT sug.user AS s, min(sug.priority) AS priority, me
WHERE s IS NOT NULL 
  AND s.id <> me.id 
  AND NOT (me)-[:BLOCKED]->(s)

/* Following info */
OPTIONAL MATCH (me)-[:FOLLOW]->(s)
WITH s, priority, me, COUNT(*) > 0 AS is_following

OPTIONAL MATCH (me)-[:REQUESTED]->(s)
WITH s, priority, is_following, COUNT(*) > 0 AS is_requested, me

OPTIONAL MATCH (me)-[old: SUGGESTED_TO]->(s)
WITH s, priority, is_following, is_requested, me, coalesce(old.count, 0) AS suggestCount

/* NEW: mutual followings */
OPTIONAL MATCH (me)-[:FOLLOW]->(mf:User)-[:FOLLOW]->(s)
WITH s, priority, is_following, is_requested, me, suggestCount, toInteger(COUNT(DISTINCT mf)) AS mutual_followings

ORDER BY priority ASC, suggestCount ASC
LIMIT 10

MERGE (me)-[st:SUGGESTED_TO]->(s)
ON CREATE SET st.count = 1, st.lastSuggestedAt = datetime()
ON MATCH SET  st.count = coalesce(st.count, 0) + 1, st.lastSuggestedAt = datetime()

RETURN {
  id: s.id,
  name: s.name,
  username: s.username,
  avatar: s.avatar,
  is_following: is_following,
  is_requested: is_requested,
  is_private: COALESCE(s.is_private, "0"),
  priority: priority,
  mutual_followings: mutual_followings
} AS suggestion
`;

    const result = await session.run(query, { userId });

    let suggestions = result.records.map((r) => {
      const sug = r.get("suggestion");
      delete sug.priority;

      return {
        ...sug,
        mutual_followings: sug.mutual_followings?.toNumber?.() ?? 0,
        suggestion_type: "profiles",
      };
    });

    if (suggestions.length < 5) {
      console.log("the suggestion was smaller than 5");
      const trendy_query = `

MATCH (me:User {id: $userId})

MATCH (other:User)<-[st:SUGGESTED_TO]-(:User)
WHERE st.lastSuggestedAt >= datetime() - duration('P2D')

WITH me, other, count(st) AS globalSuggests
WHERE NOT (me)-[:FOLLOW]->(other)   
  AND other <> me
  AND NOT (me)-[:BLOCKED]->(other)

OPTIONAL MATCH (me)-[:FOLLOW]->(other)
WITH me, other, globalSuggests, COUNT(*) > 0 AS is_following

OPTIONAL MATCH (me)-[:REQUESTED]->(other)
WITH me, other, globalSuggests, is_following, COUNT(*) > 0 AS is_requested

OPTIONAL MATCH (me)-[mySt:SUGGESTED_TO]->(other)
WITH me, other, globalSuggests, is_following, is_requested, coalesce(mySt.count, 0) AS mySuggestCount, mySt

/* NEW: mutual followings */
OPTIONAL MATCH (me)-[:FOLLOW]->(mf:User)-[:FOLLOW]->(other)
WITH me, other, globalSuggests, is_following, is_requested, mySuggestCount, toInteger(COUNT(DISTINCT mf)) AS mutual_followings

ORDER BY globalSuggests DESC, mySuggestCount ASC
LIMIT 5

MERGE (me)-[st:SUGGESTED_TO]->(other)
ON CREATE SET st.count = 1, st.lastSuggestedAt = datetime()
ON MATCH SET  st.count = coalesce(st.count, 0) + 1, st.lastSuggestedAt = datetime()

RETURN {
  id: other.id,
  name: other.name,
  username: other.username,
  avatar: other.avatar,
  is_following: is_following,
  is_requested: is_requested,
  is_private: coalesce(other.is_private, "0"),
  mutual_followings: mutual_followings
} AS suggestion
`;

      const trendy_result = await session.run(trendy_query, { userId });
      const trendy = trendy_result.records.map((r) => {
        const sug = r.get("suggestion");
        delete sug.priority;

        return {
          ...sug,
          mutual_followings: sug.mutual_followings?.toNumber?.() ?? 0,
          suggestion_type: "profiles",
        };
      });
      const existingIds = new Set(suggestions.map((s) => s.id));
      const merged = [...suggestions];

      trendy.forEach((t) => {
        if (!existingIds.has(t.id)) {
          merged.push(t);
        }
      });

      suggestions = merged;
    }

    return suggestions;
  } catch (err) {
    console.error("Error suggesting users:", err);
  } finally {
    await session.close();
  }
}

export async function groups(userId) {
  const session = driver.session();
  console.log("entered the group suggestion function");
  try {
    const query = `
MATCH (me:User {id: $userId})

/* 1. Groups my followings are in, excluding groups I already joined or own */
OPTIONAL MATCH (me)-[:FOLLOW]->(f:User)-[:IS_MEMBER|OWNS]->(g:Group)
WHERE NOT (me)-[:IS_MEMBER|OWNS]->(g)
WITH me, g, COUNT(DISTINCT f) AS mutual_followings
WHERE g IS NOT NULL
WITH me, COLLECT(DISTINCT {group:g, priority:1, mutual_followings: mutual_followings}) AS r1

/* 2. Groups with posts containing liked tags or hashtags, excluding groups already joined or in r1 */
OPTIONAL MATCH (me)-[:LIKED]->(:Post)-[:HAS_TAG|TAGGED_WITH]->(t)
OPTIONAL MATCH (p2:Post)-[:BELONGS_TO]->(g2:Group)-[:BELONGS_TO*0..0]-(p2)
WHERE (p2)-[:HAS_TAG|TAGGED_WITH]->(t) AND NOT (me)-[:IS_MEMBER|OWNS]->(g2) AND NOT g2 IN [r IN r1 | r.group]
WITH me, r1, COLLECT(DISTINCT {group:g2, priority:2, mutual_followings:0}) AS r2

/* 3. Groups with most new members in last 1 day, excluding groups already joined or in r1+r2 */
OPTIONAL MATCH (g3:Group)<-[:IS_MEMBER|OWNS]-(u3:User)
WHERE u3.joinedAt >= datetime() - duration('P1D') AND NOT (me)-[:IS_MEMBER|OWNS]->(g3)
WITH me, r1 + r2 AS previous, COLLECT(DISTINCT {group:g3, priority:3, mutual_followings:0}) AS r3

/* Merge all suggestions */
WITH me, previous + r3 AS allSuggestions
UNWIND allSuggestions AS sug
WITH DISTINCT sug.group AS g, sug.priority AS priority, sug.mutual_followings AS mutual_followings, me
ORDER BY priority ASC, mutual_followings DESC
LIMIT 20

/* Compute final group info, members count including IS_MEMBER and OWNS */
WITH g, priority, mutual_followings, me
OPTIONAL MATCH (g)<-[:IS_MEMBER|OWNS]-(members)
WITH g, priority, mutual_followings, me, COUNT(DISTINCT members) AS members_count
OPTIONAL MATCH (me)-[:IS_MEMBER|OWNS]->(g)
WITH g, priority, mutual_followings, members_count, COUNT(*) > 0 AS is_member,
     g.name AS name, g.avatar AS avatar, g.bio AS bio,
     g.privacy AS privacy
RETURN {
  id: g.id,
  name: name,
  mutual_followings: mutual_followings,
  privacy: COALESCE(privacy, "public"),
  join_status: CASE WHEN is_member THEN "joined" ELSE "not_joined" END,
  avatar: avatar,
  bio: bio,
  members_count: members_count
} AS groupSuggestion
`;

    const result = await session.run(query, { userId });

    const suggestions = result.records.map((r) => {
      const g = r.get("groupSuggestion");
      return {
        ...g,
        mutual_followings: g.mutual_followings?.toNumber?.() ?? 0,
        members_count: g.members_count?.toNumber?.() ?? 0,
      };
    });

    return suggestions;
  } catch (err) {
    console.error("Error suggesting groups:", err);
    return [];
  } finally {
    await session.close();
  }
}
