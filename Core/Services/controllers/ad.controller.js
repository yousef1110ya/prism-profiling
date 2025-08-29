import { driver } from "../neo4j/Driver.js";
import { formatDateTime } from "./feed.controller.js";

export async function get_ad(user_id) {
  const session = driver.session();
  //const tx = session.beginTransaction();
  try {
    user_id = parseFloat(user_id);
    console.log("the user id is :", user_id);
    const query = `
MATCH (u:User {id: $user_id})

  // Try to find an ad not advertised to the user
  OPTIONAL MATCH (a:Ad)
    WHERE NOT (a)-[:ADVERTISED_TO]->(u)
  WITH u, a
  ORDER BY a.created_at ASC
  LIMIT 1

  // If all ads have been advertised, pick ad with least count
  OPTIONAL MATCH (b:Ad)-[r:ADVERTISED_TO]->(u)
  WITH u, a, b, r
  ORDER BY r.count ASC
  WITH u, COALESCE(a, b) AS ad
  WHERE ad IS NOT NULL 
  WITH u ,ad LIMIT 1
  // Create or update ADVERTISED_TO relationship
  MERGE (ad)-[rel:ADVERTISED_TO]->(u)
    ON CREATE SET rel.count = 1, rel.advertised_at = datetime()
    ON MATCH SET rel.count = rel.count + 1, rel.advertised_at = datetime()

  RETURN ad
`;
    console.log("starting to send the query");
    let result = await session.run(query, { user_id });
    console.log("sent the query");
    if (result.records.length === 0) {
      console.log(`No ads available for user ${user_id}`);
      return null;
    }

    let ad = result.records[0].get("ad");
    if (!ad) {
      console.log(`No ad returned for user ${user_id}`);
      await session.close();
      return null;
    }
    console.log("got ad with ADVERTISED_TO relationship", ad.properties);
    const ad_id = ad.properties.id;
    console.log("i got an ad id ", ad_id);
    // Step 4: Get creator info
    result = await session.run(
      `
      MATCH (creator:User)-[:CREATED]->(a:Ad {id: $ad_id})
      RETURN creator
    `,
      { ad_id },
    );

    const creator = result.records.length
      ? result.records[0].get("creator").properties
      : null;
    console.log("got the creator info", creator);
    // Step 5: Send POST request to decrement endpoint
    try {
      const res = await fetch(
        `http://localhost:8001/api/ads/${ad_id}/decrement`,
        {
          method: "POST",
        },
      );
      if (!res.ok) {
        throw new Error(`HTTP error! Status: ${res.status}`);
      }
      const data = await res.json();
      console.log("================================================");
      console.log("the message is ", data);
      if (data.message === "finished this ad") {
        // do something special here
        console.log("Ad finished – running custom logic...");
        // removing the ad from the database .
        await session.run(
          `
MATCH (a:Ad {id: $ad_id})
DETACH DELETE a
        `,
          { ad_id },
        );
      } else {
        console.log("Continuing as usual...");
      }
    } catch (err) {
      console.error(err);
    } finally {
      await session.close();
    }
    console.log("decremented the ad view by one");
    // Step 6: Build final response
    const adResponse = {
      id: ad.properties.id,
      text: ad.properties.text,
      group_id: null,
      media: JSON.parse(ad.properties.media),
      privacy: "public",
      created_at: formatDateTime(ad.properties.created_at),
      post_type: "ad",
      user: creator
        ? {
            id: creator.id,
            name: creator.name,
            username: creator.username,
            avatar: creator.avatar,
            is_following: true,
            is_private: creator.is_private,
          }
        : null,
    };

    return adResponse;
  } catch (error) {
    console.error("Error getting an ad:", error);
    throw error;
  } finally {
  }
}
