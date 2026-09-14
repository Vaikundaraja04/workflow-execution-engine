import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IUser extends Document<Types.ObjectId> {
  email: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    maxlength: 254,
  },
  passwordHash: { type: String, required: true, select: false },
}, { timestamps: true });

export const UserModel = mongoose.model<IUser>('User', UserSchema);