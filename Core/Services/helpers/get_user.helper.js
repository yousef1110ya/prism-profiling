import { driver } from "../neo4j/Driver.js";
import { formatDateTime } from "../controllers/feed.controller.js";
async function get_user(user_id) {
  user_id = parseFloat(user_id);

  const session = driver.session();
  try {
    const query = `
    MATCH (u1:User {id: $user_id})
    RETURN u1
    `;
    const result = await session.run(query, { user_id });
    if (result.records.length === 0) {
      return [];
    }
    const creator = result.records[0].get("u1").properties;
    const returned = {
      id: user_id,
      name: creator.name || null,
      username: creator.username || null,
      avatar: creator.avatar || null,
      is_private: creator.is_private || 0,
    };
    return returned;
  } catch (error) {
    console.error("an error in get_user :", error);
  } finally {
    await session.close();
  }
}

export default get_user;
