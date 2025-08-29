import { driver } from "./Driver.js";

export async function create(data) {
  const ad_id = parseInt(data.id);
  const text = data.text;
  const media = data.media;
  const created_at = data.created_at;
  const user_id = parseInt(data.user_id);
  const remaining_users = data.remaining_users;

  const mediaJson = JSON.stringify(media);
  console.log("the data is :", data);
  const session = driver.session();
  try {
    const query = `
      MATCH (u:User {id: $user_id})
      CREATE (a:Ad {
        id: $ad_id,
        text: $text,
        media: $mediaJson,
        created_at: datetime($created_at),
        remaining_users: $remaining_users
      })
      CREATE (u)-[:CREATED]->(a)
    `;

    const result = await session.run(query, {
      ad_id,
      text,
      mediaJson,
      created_at,
      remaining_users,
      user_id,
    });

    console.log("Created AD and connected to user:", result.records[0]);
  } catch (error) {
    console.error("error creating AD", error);
  } finally {
    await session.close();
  }
}

export async function delete_ad(ad_id) {
  const session = driver.session();
  try {
    const query = `
    MATCH (a:Ad {id: $ad_id})
    DETACH DELETE a
    RETURN $ad_id AS deletedAdId
    `;

    const result = await session.run(query, { ad_id });

    if (result.records.length === 0) {
      console.log(`No Ad found with id: ${ad_id}`);
      return null;
    }

    console.log(`Deleted Ad with id: ${result.records[0].get("deletedAdId")}`);
  } catch (error) {
    console.error("Error deleting Ad:", error);
  } finally {
    await session.close();
  }
}
