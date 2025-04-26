import OpenAI from "openai";

const aiModel = new OpenAI({
    apiKey: process.env.OPEN_API, 
});

async function createAssistant() {
  try {
    const myAssistant = await aiModel.beta.assistants.create({
      instructions: "You are a helpful assistant. Always remember previous context from the conversation and refer back to it when answering questions. Maintain information about the user throughout the conversation.",
      name: "SkillSynx AI Assistant",
      tools: [], 
      model: "gpt-4o-mini",
    });

   return myAssistant.id
  } catch (error) {
    console.error("Error creating assistant:", error.message || error);
  }
}

createAssistant(); // <-- not main(), because you called the function `createAssistant`
