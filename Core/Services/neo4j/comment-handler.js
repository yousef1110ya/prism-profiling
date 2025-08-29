import { driver } from "./Driver.js";

export async function createReply(user_id, comment_id, text, base_comment_id) {
  user_id = parseFloat(user_id);
  comment_id = parseFloat(comment_id);
  base_comment_id = parseFloat(base_comment_id);
  try {
    const session = driver.session();
    await session.run(
      `
      MATCH (u:User {id: $userId})
      MATCH (p:Comment {id: $postId})
      CREATE (c:Comment {id: $commentId, text: $text})
      CREATE (u)-[:WROTE]->(c)
      CREATE (c)-[:COMMENTS_ON]->(p)      
    `,
      {
        userId: user_id,
        postId: base_comment_id,
        commentId: comment_id,
        text: text,
      },
    );
    await session.close();
  } catch (error) {
    console.error("an error accured on neo4j ", error);
  }
}

export async function createComment(userId, commentId, text, postId) {
  console.log("creating a new Comment in node.js");
  userId = parseFloat(userId);
  commentId = parseFloat(commentId);
  postId = parseFloat(postId);

  try {
    const session = driver.session();
    await session.run(
      `
      MATCH (u:User {id: $userId})
      MATCH (p:Post {id: $postId})
      CREATE (c:Comment {id: $commentId, text: $text})
      CREATE (u)-[:WROTE]->(c)
      CREATE (c)-[:COMMENTS_ON]->(p)      
    `,
      {
        userId: userId,
        postId: postId,
        commentId: commentId,
        text: text,
      },
    );
    await session.close();
  } catch (error) {
    console.error("an error accured on neo4j ", error);
  }
}

export async function deleteComment(commentId) {
  commentId = parseFloat(commentId);
  const session = driver.session();
  try {
    await session.run(
      `
      MATCH (c:Comment {id: $commentId})
      DETACH DELETE c
    `,
      {
        commentId: commentId,
      },
    );
    session.close();
  } catch (error) {
    console.error("there was an error deleting the comment", error);
  }
}
