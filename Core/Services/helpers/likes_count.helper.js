import { driver } from "../neo4j/Driver.js";

async function like_count(post_id) {
  const session = driver.session();
  try {
  } catch (error) {
    console.error("error in like_count", error);
  } finally {
    await session.close();
  }
}

export default like_count;
