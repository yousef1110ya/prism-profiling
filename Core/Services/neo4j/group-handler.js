import { driver } from "./Driver.js";
import axios from "axios";
import { Client } from "@elastic/elasticsearch";
const client = new Client({ node: "http://localhost:9200" });
async function upsertGroup(id, data) {
  // Remove `id` from doc body — Elasticsearch doesn't want it in doc
  const doc = {
    id: data.id,
    name: data.name,
    privacy: data.privacy,
    bio: data.bio,
    avatar: data.avatar,
    owner: {
      id: data.owner.id,
      name: data.owner.name,
      username: data.owner.username,
      avatar: data.owner.avatar,
    },
  };

  try {
    const res = await axios.post(
      `http://localhost:9200/groups/_update/${id}`,
      {
        doc,
        doc_as_upsert: true,
      },
      {
        headers: {
          "Content-Type":
            "application/vnd.elasticsearch+json; compatible-with=8",
          Accept: "application/vnd.elasticsearch+json; compatible-with=8",
        },
      },
    );

    console.log("Upsert successful:", res.data);
  } catch (err) {
    console.error(
      "Elasticsearch upsert error",
      err.response?.data || err.message,
    );
  }
}

export async function createGroup(data) {
  try {
    await upsertGroup(data.id, data);
    const session = driver.session();
    await session.run(
      `
    MERGE (g:Group {id: $groupId})
      SET g.name = $groupName,
          g.privacy = $privacy,
          g.bio = $bio,
          g.avatar = $groupAvatar
    WITH g
    MATCH (u:User {id: $userId}) 
    MERGE (u)-[:OWNS]->(g) 
    `,
      {
        groupId: data.id,
        groupName: data.name,
        privacy: data.privacy,
        bio: data.bio,
        groupAvatar: data.avatar,
        userId: data.owner.id,
      },
    );
    session.close();
  } catch (error) {
    console.error("there was an error creating the group", error);
  }
}

export async function deleteGroup(id) {
  try {
    const session = driver.session();
    await session.run(
      `
    MATCH (g:Group {id: $groupId})
    DETACH DELETE g
    `,
      {
        groupId: id,
      },
    );
    session.close();
  } catch (error) {
    console.error("there was an error deleting the group", error);
  }
}

export async function joinGroup(groupId, userId) {
  groupId = parseFloat(groupId);
  userId = parseFloat(userId);

  try {
    const session = driver.session();
    await session.run(
      `
    MATCH(u:User {id: $userId}) 
    MATCH(g:Group {id: $groupId}) 
    MERGE (u)-[l:IS_MEMBER]->(g)
    SET l.joinedAt = datetime()  
    `,
      {
        userId: userId,
        groupId: groupId,
      },
    );
  } catch (error) {
    console.error("there was an error joining the group", error);
  }
}

export async function leaveGroup(groupId, userId) {
  groupId = parseFloat(groupId);
  userId = parseFloat(userId);

  try {
    const session = driver.session();
    await session.run(
      `
    MATCH (u:User {id: $userId})-[r:IS_MEMBER]->(g:Group {id: $groupId})
    DELETE r
    `,
      {
        userId: userId,
        groupId: groupId,
      },
    );
  } catch (error) {
    console.error("there was an error joining the group", error);
  }
}
