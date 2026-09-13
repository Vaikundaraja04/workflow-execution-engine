import mongoose from 'mongoose';

let isConnected = false;

export async function connectDB(uri: string): Promise<void> {
  if (isConnected) return;
  await mongoose.connect(uri);
  isConnected = true;
}

export async function disconnectDB(): Promise<void> {
  if (!isConnected) return;
  await mongoose.disconnect();
  isConnected = false;
}
