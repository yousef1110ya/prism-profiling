import amqp from 'amqplib';
import * as neo4jService from './neo4jService.js';
//import * as redisService from './redisService.js';
import * as User from  './neo4j/user-handler.js';
import * as Post from  './neo4j/post-handler.js';
export async function startConsumer() {
  // Connect Redis
 // await redisService.connect();

  // Connect RabbitMQ
  const connection = await amqp.connect('amqp://localhost');
  const channel = await connection.createChannel();

  const exchangeName = 'app_events';
  const exchangeType = 'fanout';

  await channel.assertExchange(exchangeName, exchangeType, { durable: true });
  const { queue } = await channel.assertQueue('', { exclusive: true });
  await channel.bindQueue(queue, exchangeName, '');

  console.log(`[x] Waiting for messages in queue: ${queue}`);

  channel.consume(queue, async (msg) => {
    if (msg !== null) {
      const content = msg.content.toString();
      console.log(`[x] Received: ${content}`);

      try {
        const event = JSON.parse(content);
        const cacheKey = `event_cache:${event.event_type}:${event.data.id || 'default'}`;
        // messages handling for each type of events . 
      switch (event.event_type) {
        case "UserCreated":
            console.log("There is a user created");
            await User.createUser(event.data.id, event.data.email);
            break;
        case "UserUpdated":
            const { id, ...updates } = event.data;
            await User.updateUser(id, updates);
            break;
        case "UserDeleted":
            await User.deleteUser(event.data.id);
            break;
        case "BlockedUser":
            await User.blockUser(event.data.id , event.data.target); 
            break;
        case "UnblockUser" : 
            await User.blockUser(event.data.id , event.data.target);
            break;
        case "UserFollowed" : 
            await User.followUser(event.data.id , event.data.target);
            break;
        case "UserUnFollow":
            await User.unfollowUser(event.data.id , event.data.target); 
            break;
        case "PostCreated" : 
            console.log("creating a post in the event handler")
            await Post.createPost(event.data);
            break;
        case "Like" : 
            if (event.data.likeable_type === "App\\Models\\Post") {
              await Post.likePost(event.data.id , event.data.likeable_id);
              console.log("finished the likePost function");
            }
            break;
        case "Unlike":
            if (event.data.likeable_type === "App\\Models\\Post") {
              await Post.unlikePost(event.data.id , event.data.likeable_id);
              console.log("hanled the unlike function"); 
            }
            break;
        default:
            console.warn(`Unhandled event type: ${event.event_type}`);
      }

      channel.ack(msg);
      } catch (err) {
        console.error('Error processing message:', err);
        channel.ack(msg); // Ack anyway to avoid blocking queue
      }
    }
  }, { noAck: false });

  // Cleanup on exit
  process.on('SIGINT', async () => {
    console.log('Closing connections...');
    //await redisService.disconnect();
    await neo4jService.close();
    await channel.close();
    await connection.close();
    process.exit(0);
  });
}
