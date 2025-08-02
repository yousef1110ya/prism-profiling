import jwt from 'jsonwebtoken';
import dotenv from 'dotenv'; 

dotenv.config(); 

const SECRET_KEY = process.env.JWT_KEY ; 

 function authMiddleware(req ,res , next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authorization token missing' });
  }

  const token = authHeader.split(' ')[1];
  const JWT_SECRET = process.env.JWT_KEY;

  let decoded; 
  let user;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
    console.log('Decoded payload:', decoded);
  } catch (err) {
    console.error('Invalid token:', err.message);
    return res.status(401).json({ message: 'Invalid token' });
  }
  const streamer = {
    streamerName: decoded.name,
    streamerId: parseInt(decoded.sub, 10),
    streamerImage: decoded.avatar,
  };
    // Attach user to request
    req.streamer = streamer;
    next();
}

export default authMiddleware ; 
