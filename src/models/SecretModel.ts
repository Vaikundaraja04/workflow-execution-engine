import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ISecret extends Document<Types.ObjectId> {
  workspaceId?: Types.ObjectId;
  name: string;
  environment: 'development' | 'staging' | 'production';
  encryptedValue: string; // ciphertext
  iv: string; // initialization vector
  tag: string; // authentication tag
  kekVersion: string; // Key Encryption Key version for rotation
  createdBy?: Types.ObjectId;
  accessedAt?: Date;
  accessCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const SecretSchema = new Schema<ISecret>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', index: true },
    name: { type: String, required: true, maxlength: 128, index: true },
    environment: { type: String, enum: ['development', 'staging', 'production'], required: true, index: true },
    encryptedValue: { type: String, required: true },
    iv: { type: String, required: true },
    tag: { type: String, required: true },
    kekVersion: { type: String, required: true, default: 'v1' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    accessedAt: { type: Date },
    accessCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

SecretSchema.index({ workspaceId: 1, name: 1, environment: 1 }, { unique: true });
SecretSchema.index({ kekVersion: 1 });
SecretSchema.index({ accessCount: -1 });

export const SecretModel = mongoose.model<ISecret>('Secret', SecretSchema);