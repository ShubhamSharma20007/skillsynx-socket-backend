import mongoose from 'mongoose';

// Track connection status
let isConnected = false;
export async function connectToDatabase() {
    if (isConnected) {
      console.log('Using existing MongoDB connection');
      return mongoose.connection;
    }
  
    // Check if MONGO_URL is provided
    if (!process.env.MONGO_URL) {
      throw new Error('MONGO_URL environment variable is not defined');
    }
  
    try {
      console.log('Establishing new MongoDB connection...');
      
      // Set mongoose options
      const options = {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      };
      
      // Connect to MongoDB
      await mongoose.connect(process.env.MONGO_URL, options);
      
      // Update connection status
      isConnected = true;
      console.log('MongoDB connected successfully!');
      
      // Listen for connection errors after initial connect
      mongoose.connection.on('error', (err) => {
        console.error('MongoDB connection error:', err);
        isConnected = false;
      });
      
      mongoose.connection.on('disconnected', () => {
        console.warn('MongoDB disconnected');
        isConnected = false;
      });
      
      // Return the mongoose connection
      return mongoose.connection;
    } catch (error) {
      console.error('Error connecting to MongoDB:', error);
      isConnected = false;
      throw error;
    }
  }
  
  /**
   * Closes the MongoDB connection
   */
  export async function disconnectFromDatabase() {
    if (!isConnected) {
      return;
    }
    
    try {
      await mongoose.disconnect();
      isConnected = false;
      console.log('MongoDB disconnected successfully');
    } catch (error) {
      console.error('Error disconnecting from MongoDB:', error);
      throw error;
    }
}