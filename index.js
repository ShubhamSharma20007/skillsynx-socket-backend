import dotenv from "dotenv";
dotenv.config();
import { createServer } from "http";
import { Server } from "socket.io";
import fs from "fs";
import { connectToDatabase } from './db.js';
import OpenAI from "openai"
import userModel from "./models/user-model.js"
import aiChatModel from "./models/ai-chat-model.js";
const PORT = 4000
const FRONTEND_URL = process.env.FRONTEND_URL ||  "https://skillsynx.vercel.app";

export const aiModel = new OpenAI({
    apiKey: process.env.OPEN_API,
});

export const storeChats = async ({ role, content, userId }) => {

      let user;
      try {
        if (!userId) throw new Error("id not found");
        user = await userModel.findById(new mongoose.Types.ObjectId(userId));
        if (!user) throw new Error("User not found");
      } catch (error) {
        console.log('Error finding user:', error.message || error);
        return;
      }
    
      const payload = { role, content };
    
      try {
        const chats = await aiChatModel.findOneAndUpdate(
          { userId: user._id },
          { $push: { chats: payload } },
          { new: true, upsert: true }
        );
        return JSON.parse(JSON.stringify(chats));
      } catch (error) {
        throw new Error(error.message || error);
      }
    };
export const createThread = async () => {
    try {
      const thread = await aiModel.beta.threads.create();
      return thread.id;
    } catch (error) {
      console.error("Failed to create thread:", error);
      return false;
    }
  };

 const getThreadId = async (user) => {
    try {
      let findUser = await userModel.findOne(
        { clerkUserId: user },
        { name: 1, threadId: 1}
      );
      if (findUser?.threadId) {
        return {
          name: findUser.name,
          threadId: findUser.threadId,
          userId: findUser._id,
        };
      } else {
        const threadId = await createThread();
  
        await userModel.updateOne(
          { clerkUserId: user },
          { threadId }
        );
  
        const updatedUser = await userModel.findOne(
          { clerkUserId: user },
          { name: 1, threadId: 1 }
        );
  
        return {
          name: updatedUser?.name,
          threadId,
          userId: updatedUser?._id,
        };
      }
    } catch (error) {
      console.log('error in getThreadId', error?.message || error);
      return false;
    }
  };

  

const httpServer = createServer((req, res) => {
  // Basic health check endpoint
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('WebSocket server is running');
    return;
  }
  
  res.writeHead(404);
  res.end('Not found');
});

// Set up Socket.IO with proper CORS for production
const io = new Server(httpServer, {
  cors: {
    origin: FRONTEND_URL ? [FRONTEND_URL] : "*", // Replace with your frontend URL in production
    methods: ["GET", "POST"],
    credentials: true,
  }
});

// Thread management
let threadMap = new Map();

io.on('connection', async (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('chat_message', async ({msg, user}) => {
    try {
      const userDets = await getThreadId(user);
      if (userDets !== false) {
        if (
          !threadMap.has('threadId') ||
          !threadMap.has('current_user') ||
          !threadMap.has('current_user_id')
        ) {
          threadMap.set('threadId', userDets.threadId);
          threadMap.set('current_user', userDets.name);
          threadMap.set('current_user_id', userDets.userId);
        }
      }
      
      const thread = threadMap.get('threadId');
      const userId = threadMap.get('current_user_id'); 
      if (!thread) {
        console.error("Thread ID not found");
        socket.emit('error', { message: 'Thread ID not found' });
        return;
      }

      await storeChats({ role: 'user', content: msg, userId });
      
      // Read project data
      const file = fs.readFileSync('./project.json', 'utf8');
      const rawData = JSON.parse(file);
      
      // Send system message to assistant
      await aiModel.beta.threads.messages.create(thread, {
        role: 'assistant',
        content: `You are a helpful AI assistant for user query. 
        - ${threadMap.get('current_user') ? 'The current user is ' + threadMap.get('current_user') + '.' : ''} 
        - Do not generate code. 
        - You must be mentioned of username in initial first message.
        - Mention the user's name no more than twice.`
      });

      // Send user message to assistant
      await aiModel.beta.threads.messages.create(thread, {
        role: 'user',
        content: msg
      });

      let fullResponse = '';

      // Stream the response
      const stream = await aiModel.beta.threads.runs.stream(thread, {
        assistant_id: process.env.ASSISTANT_ID, // Note: removed NEXT_PUBLIC_ prefix
        stream: true,
      });

      stream.on('textDelta', (textDelta) => {
        if (textDelta.value) {
          fullResponse += textDelta.value;
          socket.emit('chat_response', {
            content: textDelta.value,
            stream: true,
            role: 'assistant'
          });
        }
      });

      stream.on('toolCallDone', async() => {
        socket.emit('stream_complete', {
          content: fullResponse,
          role: 'assistant'
        });
      });

      stream.on('end', async() => {
        socket.emit('stream_complete', {
          content: fullResponse,
          role: 'assistant'
        });
        await storeChats({ role: 'assistant', content: fullResponse, userId });
      });

      stream.on('error', (error) => {
        console.error("Stream error:", error);
        socket.emit('error', {
          message: 'An error occurred with the AI response'
        });
      });
    } catch (error) {
      console.error("Error processing message:", error);
      socket.emit('error', {
        message: 'Server error processing your message'
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Start the server
try {
    await connectToDatabase();
    
    // Start your server after database connection is established
    httpServer.listen(PORT, () => {
      console.log(`WebSocket server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server due to database connection error:', error);
    process.exit(1);
  }