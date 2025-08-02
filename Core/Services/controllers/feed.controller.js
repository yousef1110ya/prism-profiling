
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
async function feed(req , res) {
  
}
