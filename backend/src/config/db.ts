import mongoose from 'mongoose';

export const connectDB = async () => {
  try {
    mongoose.connection.on('disconnected', () => {
      console.warn('[MongoDB] Connection lost. Mongoose will attempt to reconnect...');
    });

    mongoose.connection.on('error', (err) => {
      console.error(`[MongoDB] Connection Error: ${err.message}`);
    });

    mongoose.connection.on('reconnected', () => {
      console.log('[MongoDB] Successfully reconnected!');
    });

    const conn = await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/vynora');
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error: any) {
    console.error(`Error connecting to MongoDB: ${error.message}`);
    // Ignore process.exit in development if you prefer, but usually good for fail-fast
    process.exit(1);
  }
};
