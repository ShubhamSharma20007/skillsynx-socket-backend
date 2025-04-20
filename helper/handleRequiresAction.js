import dotenv from "dotenv";
dotenv.config();
import OpenAI from "openai";
import { promises as fsPromises } from "fs";
import { storeChats } from "../index.js";
import { instructions } from "../data/prompt.js";
export const aiModel = new OpenAI({
  apiKey: process.env.OPEN_API,
});

const getFileResponse = async (input) => {
  try {
    // Adjust the file path as needed.
    // const instructions = await fsPromises.readFile('./project.txt', 'utf-8');
    const response = await aiModel.responses.create({
      model: "gpt-4o-mini",
      max_output_tokens:1000,
      temperature: 0.5,
      instructions:instructions,
      input:`
        <user_query>
        ${input}
      </user_query>
      `
     

    });
    const output = response.output_text
    return output;
  } catch (error) {
    console.error("Error in getFileResponse:", error);
    throw new Error(error.message || error);
  }
};


const  submitToolOutputs =async(toolOutputs, runId, threadId, socket, io, userId)=>{
    let fullResponse = '';
        try {
            const stream = await aiModel.beta.threads.runs.submitToolOutputsStream(
                threadId,
                runId,
                {
                    tool_outputs: toolOutputs,

                }
            )
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
                      role: 'assistant',
                      stream: false,
                    });
                  });
              
                  stream.on('end', async () => {

                    console.log("Stream ended:", fullResponse);
                    io.to(socket.id).emit('stream_complete', {
                      content: fullResponse,
                      role: 'assistant',
                      stream: true,
                    });
                    await storeChats({ role: 'assistant', content: fullResponse, userId });
                  });

        } catch (error) {
            console.error("Error in submitToolOutputs:", error);
            throw new Error(error.message || error);
            
        }

}

export const handleRequiresAction = async (data, runId, threadId, socket, io, userId) => {
  try {
    // Ensure the expected structure exists in data
    if (!data?.required_action?.submit_tool_outputs?.tool_calls) {
      throw new Error("Invalid data structure in handleRequiresAction");
    }
    io.to(socket.id).emit('chat_response', {
      content: '',
      stream: true,
      role: 'assistant',
      functionCall: true
    });
    
    const toolOutputs = await Promise.all(
      data.required_action.submit_tool_outputs.tool_calls.map(async (toolCall) => {
        if (toolCall.function.name === 'get_file_data') {
          const args = JSON.parse(toolCall.function.arguments);
          console.log("Arguments:", args);
          const input = args.input;
          const output = await getFileResponse(input);
          return {
            tool_call_id: toolCall.id,
            output,
          };
        } else {
          return null; 
        }
      })
    );


     await submitToolOutputs(toolOutputs.filter(Boolean), runId, threadId, socket, io, userId);
  } catch (error) {
    console.error("Error in handleRequiresAction:", error);
    throw new Error(error.message || error);
  }
};
