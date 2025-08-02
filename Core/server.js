
import { startConsumer } from './services/rabbitmqConsumer.js';
import express from 'express'; 
import mainRouter from './Services/routers/PostsRouter.js';
const app = express(); 
const PORT = 6000; 
startConsumer().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

app.use(express.json()); 
app.use('/api', mainRouter); 

app.listen(PORT , ()=> {
  console.log("the express server is now working on port 6000"); 
});
