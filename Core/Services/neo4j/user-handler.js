import { session } from './Driver.js';

export async function createUser(id, email) {
  const result = await session.run(
    'CREATE (u:User {id: $id , email: $email}) RETURN u',
    { id, email}
  );
  console.log('a new user was created in the createUser methode '); 
  console.log(result.records[0]?.get('u').properties);
}


export async function updateUser(id , updates){
   const query = `
    MATCH (u:User {id: $id})
    SET u += $updates
    RETURN u
  `;
  const params = { id, updates };

  try {
    const result = await session.run(query, params);
    console.log('User updated:', result.records[0].get('u').properties);
  } catch (error) {
    console.error('Error updating user:', error);
  }
}

export async function deleteUser(id){
  const query = `
      MATCH (u:User {id: $id})
      DETACH DELETE u
      RETURN COUNT(u) AS deletedCount
    `;

    try {
      const result = await session.run(query, { id });
      const deletedCount = result.records[0].get('deletedCount').toInt();

      if (deletedCount === 0) {
        console.warn(`No user found with id ${id}`);
      } else {
        console.log(`User with id ${id} deleted`);
      }

    } catch (error) {
      console.error('Error deleting user:', error);
      throw error;
    }
}


export async function blockUser(id , target){
  const query = `
    MATCH (a:User {id: $id}), (b:User {id: $target})
    MERGE (a)-[:BLOCKED]->(b)
    RETURN a, b
  `;
  const params = { id , target };

  try {
    const result = await session.run(query, params);
    console.log(`User ${id} blocked user ${target}`);
  } catch (error) {
    console.error('Error blocking user:', error);
  } 
}



export async function unblockUser(id , target){
  const query = `
    MATCH (a:User {id: $id})-[r:BLOCKED]->(b:User {id: $target})
    DELETE r
    RETURN COUNT(r) AS removed
  `;
  const params = { id, target };

  try {
    const result = await session.run(query, params);
    const removed = result.records[0].get('removed').toInt();

    if (removed > 0) {
      console.log(`User ${blockerId} unblocked user ${blockedId}`);
    } else {
      console.warn(`No BLOCKED relationship found between ${blockerId} and ${blockedId}`);
    }
  } catch (error) {
    console.error('Error unblocking user:', error);
  }
}



export async function followUser(id , target){
   const query = `
    MATCH (a:User {id: $id}), (b:User {id: $target})
    MERGE (a)-[:FOLLOW]->(b)
    RETURN a, b
  `;
  const params = { id , target };

  try {
    const result = await session.run(query, params);
    console.log(`User ${id} follows user ${target}`);
  } catch (error) {
    console.error('Error followign user:', error);
  }  
}

export async function unfollowUser(id , target){
 const query = `
    MATCH (a:User {id: $id})-[r:FOLLOW]->(b:User {id: $target})
    DELETE r
    RETURN COUNT(r) AS removed
  `;
  const params = { id, target };

  try {
    const result = await session.run(query, params);
    const removed = result.records[0].get('removed').toInt();

    if (removed > 0) {
      console.log(`User ${id} unfollowed user ${target}`);
    } else {
      console.warn(`No follow relationship found between ${id} and ${target}`);
    }
  } catch (error) {
    console.error('Error unfollowing user:', error);
  }

}

























