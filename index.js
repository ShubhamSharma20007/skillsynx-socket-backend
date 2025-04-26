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
import { handleRequiresAction } from "./helper/handleRequiresAction.js";
const PORT = 4000
const FRONTEND_URL = process.env.FRONTEND_URL ||  "https://skillsynx.vercel.app";

export const aiModel = new OpenAI({
    apiKey: process.env.OPEN_API,
});

// store chats in database
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
  
// create thread for user

export const createThread = async () => {
    try {
      const thread = await aiModel.beta.threads.create();
      return thread.id;
    } catch (error) {
      console.error("Failed to create thread:", error);
      return false;
    }
  };

//  get thread id
const getThreadId = async (user) => {
  try {
    let findUser = await userModel.findOne({ clerkUserId: user }, { name: 1, threadId: 1 });

    let threadId = findUser?.threadId;

    if (threadId) {
      try {
        await aiModel.beta.threads.retrieve(threadId);
      } catch (err) {
        if (err.status === 404) {
          console.log("Thread is invalid/deleted, creating a new one...");
          threadId = await createThread();
          await userModel.updateOne({ clerkUserId: user }, { threadId });
        }
      }
    } else {
      threadId = await createThread();
      await userModel.updateOne({ clerkUserId: user }, { threadId });
    }
    return {
      name: findUser.name,
      threadId,
      userId: findUser._id,
    };
  } catch (error) {
    console.log('error in getThreadId', error?.message || error);
    return false;
  }
};



  const retrieveAssistant = async(assistantId) => {
    try {
      const status = await aiModel.beta.assistants.retrieve(assistantId);
      console.log({status})
      return status;
    } catch (error) {
      console.error("Error retrieving assistant:", error.response?.data || error.message || error);
      throw new Error(error?.message || error);
    }
  }
  
  

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


const io = new Server(httpServer, {
  cors: {
    origin: FRONTEND_URL ? [FRONTEND_URL] : "*", 
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
     
      const assistantStatus = await retrieveAssistant(process.env.ASSISTANT_ID);
      console.log('assistantStatus:',assistantStatus)
      // check the thread status  
      try {
        const activeRuns = await aiModel.beta.threads.runs.list(thread);
      const runInProgress = activeRuns.data.find(run => {
          return ['in_progress', 'queued', 'requires_action'].includes(run.status)
      })

      } catch (error) {
        console.log('Error checking thread status:',error)
        
      }
      
      try {
        if (runInProgress) {
          await aiModel.beta.threads.runs.cancel(thread, runInProgress.id);
          await new Promise(resolve => setTimeout(resolve, 1000));
      }
      } catch (error) {
       console.error("Error cancelling run:", error); 
      }

      if (!thread) {
        socket.emit('error', { message: 'Thread ID not found' });
        return;
      }
  
      await storeChats({ role: 'user', content: msg, userId });
  
      // const file = await aiModel.files.create({
      //   file: fs.createReadStream('./product.txt'),
      //   purpose: 'assistants',
      // })
  
      await aiModel.beta.threads.messages.create(thread, {
        role: 'assistant',
        content: `You are a helpful AI assistant this Project which is name of **SkillSynx Ai**. 
          - ${socket.currentUser ? 'The current user is ' + socket.currentUser + '.' : ''} 
          - You are not code generator. 
          - You must be mentioned of username in initial first message.
          - Mention the user's name no more than twice in a same thread.`
      });
  
      // Send user message to assistant
      await aiModel.beta.threads.messages.create(thread, {
        role: 'user',
        content: msg,
      });
  
      let fullResponse = '';

      
      const stream = await aiModel.beta.threads.runs.stream(thread, {
        assistant_id: process.env.ASSISTANT_ID,
        stream: true,
        tools:[
          {
            type:'function',
            function:{
              name: 'get_file_data',
              description: 'get the information of  skillsynx project',
              parameters:{
                type:'object',
                properties:{
                    input:{
                      type:'string',
                      description:'if the user ask about the project, then you can use this file',
                      example:'what is the skillsynx project',
                      file_name:'project.txt',
                      file_type:'text/plain',
                      file_location:fs.readFileSync('./project.txt','utf8'),
                    },
                    
                },
                required:['input']
              }
            }
          }
        ]
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
          role: 'assistant',
          stream: false,
        });
        await storeChats({ role: 'assistant', content: fullResponse, userId });
      });
  
      stream.on('error', (error) => {
        console.error("Stream error:", error);
        socket.emit('error', {
          message: 'An error occurred with the AI response'
        });
      });
   
      for await(const event  of stream){
        console.log("Event:", event);
        console.log("--------------------- Function Call ---------------------")
        if(event.event === 'thread.run.requires_action'){
          io.to(socket.id).emit('chat_response', {
            content: fullResponse,
            role: 'assistant',
            stream: true,
          });
        await handleRequiresAction(event.data,event.data.id,event.data.thread_id,socket, io, socket.currentUserId) 
        
        
        }
      }
  
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