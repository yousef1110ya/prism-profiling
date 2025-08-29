import { driver } from "../neo4j/Driver.js";
async function user_group_status(user_id, group_id) {
  const session = driver.session();
  try {
    const query = `
      MATCH (g:Group {id: $groupId})
      OPTIONAL MATCH (u:User {id: $userId})
      
      // Check relationships
      OPTIONAL MATCH (u)-[r:REQUESTED]->(g)
      OPTIONAL MATCH (u)-[m:IS_MEMBER]->(g)
      OPTIONAL MATCH (u)-[o:OWNS]->(g)
      
      // Count total members (including this user if they are a member)
      OPTIONAL MATCH (g)<-[member:IS_MEMBER]-()
      WITH g, u, r, m, o, COUNT(member) + 1 AS membersCount

      RETURN
        CASE
          WHEN o IS NOT NULL THEN 'joined'
          WHEN m IS NOT NULL THEN 'joined'
          WHEN r IS NOT NULL THEN 'pending'
          ELSE 'not_joined'
        END AS join_status,
        membersCount AS members_count,
        CASE
          WHEN o IS NOT NULL THEN 'admin'
          WHEN m IS NOT NULL THEN 'member'
          ELSE NULL
        END AS role
    `;

    const result = await session.run(query, {
      userId: user_id,
      groupId: group_id,
    });

    if (result.records.length === 0) {
      // In case group or user does not exist
      return {
        join_status: "not_joined",
        members_count: 1,
        role: null,
      };
    }

    const record = result.records[0];
    return {
      join_status: record.get("join_status"),
      members_count: record.get("members_count").toInt(),
      role: record.get("role"),
    };
  } catch (error) {
    console.error("error in user_group_status", error);
    throw error;
  } finally {
    await session.close();
  }
}

export default user_group_status;
