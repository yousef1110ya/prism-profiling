
import {session} from "../neo4j/Driver.js"; 

/*
 * 
 * this function will work like this : 
 * 1- we will set the user from the auth middleware setted up before 
 * 2- we will get the posts from people he follows and if the posts are not seen 
 * 3- if the usr have seen all the posts from the people he follows then will suggest posts from the tags and hashtags he liked or followed . 
 * 4- we will include reels that has the same tags the user liked before . and reels 
 * 5- 
 * */
async function feed(req , res) {
  
}
