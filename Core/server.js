
import { startConsumer } from './services/rabbitmqConsumer.js';

startConsumer().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
