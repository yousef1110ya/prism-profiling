import { driver } from "../neo4j/Driver.js";

async function comment_count(post_id) {
  const session = driver.session();
  try {
    const query = `
      MATCH (p:Post {id: $post_id})
      MATCH (c)-[:COMMENTS_ON*]->(p)
      RETURN count(c) AS totalComments
    `;

    const result = await session.run(query, { post_id });

    if (result.records.length === 0) {
      return 0;
    }

    const totalComments = result.records[0].get("totalComments").toInt();
    return totalComments;
  } catch (error) {
    console.error("error in comment_count", error);
    throw error;
  } finally {
    await session.close();
  }
}

export default comment_count;
