const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Username is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false, // Don't return password by default
    },
    // Future-ready fields for collaboration
    avatar: {
      type: String,
      default: '',
    },
    activeRooms: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Room',
      },
    ],
    lastActive: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: 'users', // Explicit collection name within the Synapse database
  }
);

// Hash password before saving
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  if (/^\$2[aby]\$\d{2}\$/.test(this.password)) return;

  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Remove sensitive fields when converting to JSON
userSchema.methods.toSafeObject = function () {
  return {
    userId: this._id.toString(),
    name: this.name,
    email: this.email,
    avatar: this.avatar,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('User', userSchema);
