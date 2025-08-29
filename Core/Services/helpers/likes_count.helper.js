import { driver } from "../neo4j/Driver.js";

async function like_count(post_id) {
  const session = driver.session();
  try {
    const query = `
      MATCH (u:User)-[l:LIKED]->(p:Post {id: $post_id})
      RETURN count(l) AS likeCount
    `;

    const result = await session.run(query, { post_id });

    if (result.records.length === 0) {
      return 0;
    }
    const likeCount = result.records[0].get("likeCount").toInt();
    return likeCount;
  } catch (error) {
    console.error("error in like_count", error);
  } finally {
    await session.close();
  }
}

export default like_count;
