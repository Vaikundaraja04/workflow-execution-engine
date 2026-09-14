import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IUser extends Document<Types.ObjectId> {
  email: string;
  passwordHash: string;
  defaultWorkspaceId?: Types.ObjectId | null;
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
  defaultWorkspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null },
}, { timestamps: true });

UserSchema.index({ defaultWorkspaceId: 1 });

export const UserModel = mongoose.model<IUser>('User', UserSchema);