const mongoose = require('mongoose');

const otpVerificationSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    purpose: {
      type: String,
      enum: ['signup', 'login'],
      required: true,
      index: true,
    },
    otpHash: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
    attempts: {
      type: Number,
      default: 0,
    },
    loginUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    pendingSignup: {
      name: {
        type: String,
        trim: true,
      },
      passwordHash: String,
    },
  },
  {
    timestamps: true,
    collection: 'otp_verifications',
  }
);

otpVerificationSchema.index({ email: 1, purpose: 1 }, { unique: true });

module.exports = mongoose.model('OtpVerification', otpVerificationSchema);
