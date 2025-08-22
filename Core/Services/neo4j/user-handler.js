import { driver } from "./Driver.js";
import axios from "axios";
import { Client } from "@elastic/elasticsearch";
const client = new Client({ node: "http://localhost:9200" });

async function upsertUser(userId, userData) {
  const { name, username, avatar, is_private, bio, personal_info } = userData;

  // Remove `id` from doc body — Elasticsearch doesn't want it in doc
  const doc = {
    id: userId,
    name: userData?.name ?? null,
    username: userData?.username ?? null,
    avatar: userData?.avatar ?? null,
    is_private: userData?.is_private ?? 0,
    bio: userData?.bio ?? null,
    personal_info: userData?.personal_info ?? null,
  };

  try {
    const res = await axios.post(
      `http://localhost:9200/users/_update/${userId}`,
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

export async function createUser(id, email) {
  const session = driver.session();

  const result = await session.run(
    "CREATE (u:User {id: $id , email: $email}) RETURN u",
    { id, email },
  );
  await session.close();
  console.log("a new user was created in the createUser methode ");
  console.log(result.records[0]?.get("u").properties);
}

export async function updateUser(id, updates) {
  const session = driver.session();
  const query = `
    MATCH (u:User {id: $id})
    SET u += $updates
    RETURN u
  `;
  const params = { id, updates };

  try {
    const result = await session.run(query, params);
    await session.close();
    console.log("updating the personal_info of the user ");
    await upsertUser(id, updates);
    console.log("User updated:", result.records[0].get("u").properties);
  } catch (error) {
    console.error("Error updating user:", error);
  }
}

export async function deleteUser(id) {
  const query = `
      MATCH (u:User {id: $id})
      DETACH DELETE u
      RETURN COUNT(u) AS deletedCount
    `;

  try {
    const session = driver.session();
    const result = await session.run(query, { id });
    const deletedCount = result.records[0].get("deletedCount").toInt();

    if (deletedCount === 0) {
      console.warn(`No user found with id ${id}`);
    } else {
      console.log(`User with id ${id} deleted`);
    }

    await session.close();
  } catch (error) {
    console.error("Error deleting user:", error);
    throw error;
  }
}

export async function blockUser(id, target) {
  const session = driver.session();
  const query = `
    MATCH (a:User {id: $id}), (b:User {id: $target})
    MERGE (a)-[:BLOCKED]->(b)
    RETURN a, b
  `;
  const params = { id, target };

  try {
    const result = await session.run(query, params);
    console.log(`User ${id} blocked user ${target}`);
    await session.close();
  } catch (error) {
    console.error("Error blocking user:", error);
  }
}

export async function unblockUser(id, target) {
  const query = `
    MATCH (a:User {id: $id})-[r:BLOCKED]->(b:User {id: $target})
    DELETE r
    RETURN COUNT(r) AS removed
  `;
  const params = { id, target };

  const session = driver.session();
  try {
    const result = await session.run(query, params);
    const removed = result.records[0].get("removed").toInt();

    await session.close();
    if (removed > 0) {
      console.log(`User ${blockerId} unblocked user ${blockedId}`);
    } else {
      console.warn(
        `No BLOCKED relationship found between ${blockerId} and ${blockedId}`,
      );
    }
  } catch (error) {
    console.error("Error unblocking user:", error);
  }
}

export async function followUser(id, target) {
  const session = driver.session();
  const query = `
  MATCH (a:User {id: $id}), (b:User {id: $target})
  OPTIONAL MATCH (a)-[r:REQUESTED]->(b)
  DELETE r
  MERGE (a)-[:FOLLOW]->(b)
  RETURN a, b
  `;

  const params = { id, target };

  try {
    const result = await session.run(query, params);
    console.log(`User ${id} follows user ${target}`);
    await session.close();
  } catch (error) {
    console.error("Error followign user:", error);
  }
}

export async function unfollowUser(id, target) {
  const session = driver.session();
  const query = `
    MATCH (a:User {id: $id})-[r:FOLLOW]->(b:User {id: $target})
    DELETE r
    RETURN COUNT(r) AS removed
  `;
  const params = { id, target };

  try {
    const result = await session.run(query, params);
    const removed = result.records[0].get("removed").toInt();

    await session.close();
    if (removed > 0) {
      console.log(`User ${id} unfollowed user ${target}`);
    } else {
      console.warn(`No follow relationship found between ${id} and ${target}`);
    }
  } catch (error) {
    console.error("Error unfollowing user:", error);
  }
}

export async function request_follow(id, target) {
  const sesstion = driver.session();
  const query = `
    MATCH (a:User {id: $id}), (b:User {id: $target})
    MERGE (a)-[:REQUESTED]->(b)
    RETURN a, b
  `;
  const params = { id, target };

  try {
    const result = await session.run(query, params);
    console.log(`User ${id} requested to follow user ${target}`);
    await session.close();
  } catch (error) {
    console.error("Error requesting follow user:", error);
  }
}

export async function request_follow_withdrawn(id, target) {
  const session = driver.session();
  const query = `
    MATCH (a:User {id: $id})-[r:REQUESTED]->(b:User {id: $target})
    DELETE r
    RETURN COUNT(r) AS removed
  `;
  const params = { id, target };

  try {
    const result = await session.run(query, params);
    const removed = result.records[0].get("removed").toInt();

    await session.close();
    if (removed > 0) {
      console.log(`User ${id} withdrawn the request user ${target}`);
    } else {
      console.warn(`No follow relationship found between ${id} and ${target}`);
    }
  } catch (error) {
    console.error("Error unfollowing user:", error);
  }
}
