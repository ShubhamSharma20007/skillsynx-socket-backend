import dotenv from "dotenv";
dotenv.config();
import { createServer } from "http";
import { Server } from "socket.io";
import fs from "fs";
import { connectToDatabase } from './db.js';
import OpenAI from "openai"
import userModel from "./models/user-model.js"
import aiChatModel from "./models/ai-chat-model.js";
import mongoose from "mongoose";
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

io.on('connection', async (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('chat_message', async ({ msg, user }) => {
    try {
      const userDets = await getThreadId(user);
      console.log('userDets', userDets);
  
      if (!userDets) {
        socket.emit('error', { message: 'Failed to retrieve user details' });
        return;
      }
  
      socket.threadId = userDets.threadId;
      socket.currentUser = userDets.name;
      socket.currentUserId = userDets.userId;
  
      const thread = socket.threadId;
      const userId = socket.currentUserId;
  
      if (!thread) {
        socket.emit('error', { message: 'Thread ID not found' });
        return;
      }
  
      await storeChats({ role: 'user', content: msg, userId });
  
  
      await aiModel.beta.threads.messages.create(thread, {
        role: 'assistant',
        content: `You are a helpful AI assistant for user query. 
          - ${socket.currentUser ? 'The current user is ' + socket.currentUser + '.' : ''} 
          - You are not code generator. 
          - You must be mentioned of username in initial first message.
          - Mention the user's name no more than twice.`
      });
  
      // Send user message to assistant
      await aiModel.beta.threads.messages.create(thread, {
        role: 'user',
        content: msg
      });
  
      let fullResponse = '';
      const stream = await aiModel.beta.threads.runs.stream(thread, {
        assistant_id: process.env.ASSISTANT_ID,
        stream: true,
      });
  
      stream.on('textDelta', (textDelta) => {
        if (textDelta.value) {
          fullResponse += textDelta.value;
          io.to(socket.id).emit('chat_response', {
            content: textDelta.value,
            stream: true,
            role: 'assistant'
          });
        }
      });
  
      stream.on('toolCallDone', async () => {
        io.to(socket.id).emit('stream_complete', {
          content: fullResponse,
          role: 'assistant'
        });
      });
  
      stream.on('end', async () => {
        io.to(socket.id).emit('stream_complete', {
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