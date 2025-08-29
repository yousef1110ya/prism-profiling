import { driver } from "../neo4j/Driver.js";

async function is_requested(user_id, target_id) {
  const session = driver.session();
  try {
    const query = `
    MATCH (u1:User {id: $user_id})
    MATCH (u2:User {id: $target_id})
    RETURN EXISTS((u1)-[:REQUESTED]->(u2)) AS isFollowing
    `;
    const result = await session.run(query, { user_id, target_id });
    if (result.records.length === 0) {
      return 0;
    }
    return result.records[0].get("isFollowing");
  } catch (error) {
    console.error("an error in is_following :", error);
  } finally {
    await session.close();
  }
}

export default is_requested;
