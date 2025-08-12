
import {driver} from "../neo4j/Driver.js"; 

/*
 * 
 * this function will work like this : 
 * 1- we will set the user from the auth middleware setted up before 
 * 2- we will get the posts from people he follows and if the posts are not seen 
 * 3- if the usr have seen all the posts from the people he follows then will suggest posts from the tags and hashtags he liked or followed . 
 * 4- we will include reels that has the same tags the user liked before . and reels 
 * and as for the query it sould look something like this : 
 * 1- the posts from people you follow : 
 * MATCH(A:User{id: 2})-[:FOLLOW]->(B:User)-[:CREATED]->(P:Post)
 * WHERE NOT (A)-[:SEEN]->(P)
 * RETURN P
 * 2- posts that are similer to posts you liked but from people you don't follow .
 * MATCH (a:User {id: 1})-[:LIKED]->(p:Post)
MATCH (p2:Post)
WHERE p2 <> p 
  AND NOT (a)-[:SEEN]->(p2)
  AND NOT EXISTS {
    MATCH (a)-[:FOLLOW]->(u:User)-[:CREATED]->(p2)
  }
  AND NOT EXISTS {
    MATCH (a)-[:CREATED]->(p2)
  }
OPTIONAL MATCH (p)-[:HAS_TAG]->(t:Tag)<-[:HAS_TAG]-(p2)
WITH a, p, p2, collect(DISTINCT t) AS sharedTags

OPTIONAL MATCH (p)-[:TAGGED_WITH]->(h:Hashtag)<-[:TAGGED_WITH]-(p2)
WITH a, p2, sharedTags, collect(DISTINCT h) AS sharedHashtags

WITH a, p2, size(sharedTags) AS tagCount, size(sharedHashtags) AS hashtagCount
WITH a, p2, tagCount, hashtagCount, (tagCount + hashtagCount) AS relevanceScore
WHERE relevanceScore > 0

MERGE (a)-[:SEEN]->(p2)

RETURN p2
ORDER BY relevanceScore DESC
LIMIT 3
 * */
export async function feed(req , res) {
  // 1- check if this user have follows anyone :
  const id = req.user.id ; 
  const session = driver.session(); 
  try {
          const tx = session.beginTransaction();
          const follow_count = await tx.run(`
               MATCH (u:User {id: $id})-[f:FOLLOW]->(b:User)
              RETURN COUNT(f) AS follows
          `, 
          {
          id
          });
          
          // this case will handle if the user follows anyone 
          if(follow_count.records[0].get('follows').toInt() != 0 ){
                          const suggestions = await tx.run(`
                                    
                                    MATCH (u:User {id: $id})-[:LIKED]->(p:Post)
                                    MATCH (p)-[:HAS_TAG|:TAGGED_WITH]->(tagOrHash)
                                    MATCH (p2:Post)-[:HAS_TAG|:TAGGED_WITH]->(tagOrHash)
                                    WHERE p2 <> p
                                    AND NOT (u)-[:SEEN]->(p2)
                                    AND NOT EXISTS {
                                            MATCH (u)-[:FOLLOW]->(:User)-[:CREATED]->(p2)
                                    }
                                    AND NOT EXISTS {
                                            MATCH (u)-[:CREATED]->(p2)
                                    }
                                    WITH u, p2, collect(DISTINCT tagOrHash) AS shared
                                    WITH u, p2, size(shared) AS relevanceScore
                                    WHERE relevanceScore > 0
                                    WITH u , p2 , relevanceScore

                                    ORDER BY relevanceScore DESC
                                    LIMIT 3
                                    MERGE (u)-[:SEEN]->(p2)
                                    RETURN p2
                          `,{
                              id
                            });
                          console.log('the suggested posts are :' , suggestions.records ); 
                          const posts = await tx.run(`
                                    MATCH (u:User {id: $id})-[:FOLLOW]->(u2:User)-[:CREATED]->(p:Post) 
                                    WHERE u <> u2
                                    AND NOT (u)-[:SEEN]->(p)
                                    WITH u, p  
                                    LIMIT 4 
                                    MERGE (u)-[:SEEN]->(p) 
                                    RETURN p 
                          `,
                          {
                          id
                          });
                          console.log('the posts from the people you follow are: ', posts.records);
                          // in this block of code I will check for reels from people you follow , if there is no one , I will suggest reels from people you don't follow . 
                          let reels ; 
                          const reels_follows = await tx.run(`
                                  MATCH(u:User {id: $id})-[:FOLLOW]->(followed:User)-[:CREATED]->(reels:REEL) 
                                  WHERE NOT (u)-[:SEEN]->(reels) 
                                  WITH u , reels
                                  LIMIT 2 
                                  MERGE (u)-[:SEEN]->(reels)
                                  RETURN reels
                          `,{id});
                          reels = reels_follows.records.map(rec => rec.get('reels')); 
                          if(reels.length === 0 ){
                                  // this will handle suggestions of reels if there are no reels from people you follow . 
                                  const reels_suggest = await tx.run(`
                                            MATCH (a:User {id: $id})-[:LIKED]->(p:REEL)
                                            MATCH (p2:REEL)
                                            WHERE p2 <> p 
                                            AND NOT (a)-[:SEEN]->(p2)
                                            AND NOT EXISTS {
                                                    MATCH (a)-[:FOLLOW]->(u:User)-[:CREATED]->(p2)
                                            }
                                            AND NOT EXISTS {
                                                    MATCH (a)-[:CREATED]->(p2)
                                            }
                                            OPTIONAL MATCH (p)-[:HAS_TAG]->(t:Tag)<-[:HAS_TAG]-(p2)
                                            WITH a, p, p2, collect(DISTINCT t) AS sharedTags

                                            OPTIONAL MATCH (p)-[:TAGGED_WITH]->(h:Hashtag)<-[:TAGGED_WITH]-(p2)
                                            WITH a, p2, sharedTags, collect(DISTINCT h) AS sharedHashtags

                                            WITH a, p2, size(sharedTags) AS tagCount, size(sharedHashtags) AS hashtagCount
                                            WITH a, p2, tagCount, hashtagCount, (tagCount + hashtagCount) AS relevanceScore
                                            WHERE relevanceScore > 0
                                            WITH a,p2,relevanceScore 
                                            ORDER BY relevanceScore DESC 
                                            LIMIT 3
                                            MERGE (a)-[:SEEN]->(p2)

                                            RETURN p2

                                  `,{id});
                                  reels = reels_suggest.records.map(rec => rec.get('p2'));
                          }
                          await tx.commit(); 
                          res.send(reels);
                          
          }else { // this is the dead case : the user is new and follows no one !! 

          }
  } catch (error) {
          console.error('a feed error' , error);  
  } finally {
          await session.close();
  }
  
}


