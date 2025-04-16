import mongoose from 'mongoose';

const ChatMessageSchema = new mongoose.Schema({
    role: {
      type: String,
      enum: ['user', 'assistant'],
      required: true
    },
    content: {
      type: String,
      required: true
    },
    createdAt: {
      type: Date,
      default: () => Date.now()
    }
  }, { _id: false });

const AiChatSchema = new mongoose.Schema({
    userId:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    },
    chats:[ChatMessageSchema]
}, {
    timestamps: true,
    versionKey: false
})
export default  mongoose.model('Ai-Chat', AiChatSchema);
