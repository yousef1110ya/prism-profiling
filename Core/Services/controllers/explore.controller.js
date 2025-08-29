import { driver } from "../neo4j/Driver.js";
import is_following from "../helpers/is_following.helper.js";

export async function explore(req, res) {
  const session = driver.session();
  try {
    const userId = parseFloat(req.user.id);
    let result;

    // 1️⃣ Most seen posts in past day, excluding own posts and recently seen
    result = await session.run(
      `
      MATCH (p:Post)<-[:CREATED]-(author:User)
      WHERE toInteger(author.id) <> toInteger($userId)
      OPTIONAL MATCH (u:User {id: $userId})-[v:SEEN]->(p)
      WHERE v.seenAt IS NULL OR v.seenAt < datetime() - duration({hours:1})
      OPTIONAL MATCH (:User)-[v2:SEEN]->(p)
      WITH p, author, COUNT(v2) AS viewsCount
      ORDER BY viewsCount DESC, rand() // add randomness
      LIMIT 10
      RETURN p, author, viewsCount
      `,
      { userId },
    );

    // 2️⃣ Fallback: latest posts not authored by user and not recently seen
    if (result.records.length === 0) {
      result = await session.run(
        `
        MATCH (p:Post)<-[:CREATED]-(author:User)
        OPTIONAL MATCH (u:User {id: $userId})-[v:SEEN]->(p)
        WHERE v.seenAt IS NULL OR v.seenAt < datetime() - duration({hours:1})
        WHERE toInteger(author.id) <> toInteger($userId)
        RETURN p, author, 0 AS viewsCount
        ORDER BY p.created_at DESC, rand()
        LIMIT 10
        `,
        { userId },
      );
    }

    // 3️⃣ Fallback: posts user has seen, ordered by latest seen, ignoring last hour
    if (result.records.length === 0) {
      result = await session.run(
        `
        MATCH (u:User {id: $userId})-[v:SEEN]->(p:Post)<-[:CREATED]-(author:User)
        WHERE v.seenAt < datetime() - duration({hours:1})
        RETURN p, author
        ORDER BY v.seenAt DESC, rand()
        LIMIT 10
        `,
        { userId },
      );
    }

    // Map posts to desired JSON format
    const feed = [];
    for (const record of result.records) {
      const postNode = record.get("p");
      const authorNode = record.get("author");
      const postProps = postNode.properties;
      const authorProps = authorNode.properties;

      const following = await is_following(userId, authorProps.id);

      feed.push({
        id: postProps.id,
        text: postProps.text,
        group_id: postProps.groupId || null,
        media: postProps.media || [],
        privacy: postProps.privacy || "public",
        created_at: postProps.createdAt,
        post_type: postProps.post_type || "post",
        user: {
          id: authorProps.id,
          name: authorProps.name || null,
          username: authorProps.username || null,
          avatar: authorProps.avatar || null,
          is_following: following || false,
          is_private: authorProps.is_private || false,
        },
      });
    }

    return res.json({
      message: "feed fetched succesfully",
      feed,
      pageination: {
        next_page: `http://localhost:6000/api/explore?page=1`,
        more: `http://localhost:6000/api/explore?page=0`,
      },
    });
  } catch (error) {
    console.error("Error in explore:", error);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    await session.close();
  }
}
