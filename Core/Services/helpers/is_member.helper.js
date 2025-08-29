import { driver } from "../neo4j/Driver.js";

async function is_member(user_id, group_id) {
  const session = driver.session();
  try {
    const query = `
    MATCH (u1:User {id: $user_id})
    MATCH (u2:Group {id: $group_id})
    RETURN EXISTS((u1)-[:IS_MEMBER|:OWNS]->(u2)) AS isMember
    `;
    const result = await session.run(query, { user_id, group_id });
    return result.records[0].get("isMember");
  } catch (error) {
    console.error("an error in is_member :", error);
  } finally {
    await session.close();
  }
}

export default is_member;
